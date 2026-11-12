import hashlib
import base64
import binascii
import io
import json
import re
import uuid
from datetime import timedelta
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.db.models import Case, Exists, F, IntegerField, Min, OuterRef, Q, Sum, Value, When
from django.db.models.functions import Coalesce
from django.http import HttpResponse
from django.utils import timezone

from .auth import permissions_for
from .models import (
    AdministrationLock,
    AuditLog,
    Category,
    Customer,
    ImageUpload,
    Medicine,
    MedicineBatch,
    NotificationRead,
    PharmacyPreference,
    PharmacySettings,
    PharmacyUser,
    Prescription,
    PrescriptionItem,
    Purchase,
    PurchaseItem,
    Sale,
    SaleDetail,
    SaleItem,
    StockMovement,
    Supplier,
    UserAccess,
)
from .views import (
    audit,
    body,
    fail,
    integer,
    money,
    only_fields,
    paginate,
    parse_date,
    parse_page,
    require_permission,
    response,
    setting_data,
    text,
    public_user,
)


def data_supplier(supplier):
    purchases = supplier.purchases.all()
    totals = purchases.aggregate(
        purchase_total=Coalesce(Sum("total_amount"), Value(Decimal("0.00"))),
        paid=Coalesce(Sum("amount_paid"), Value(Decimal("0.00"))),
    )
    return {
        "id": supplier.pk, "name": supplier.name, "company": supplier.company,
        "phone": supplier.phone, "email": supplier.email, "address": supplier.address,
        "registration_number": supplier.registration_number, "contact_person": supplier.contact_person,
        "notes": supplier.notes, "status": supplier.status, "version": supplier.version,
        "created_at": supplier.created_at, "updated_at": supplier.updated_at,
        "total_purchases": str(totals["purchase_total"]),
        "outstanding_balance": str(totals["purchase_total"] - totals["paid"]),
    }


def supplier_fields(data, editing=False):
    allowed = {"name", "company", "phone", "email", "address", "registration_number", "contact_person", "notes"}
    if editing:
        allowed.add("version")
    only_fields(data, allowed)
    values = {"name": text(data.get("name"), "Supplier name", 150, True)}
    for key, limit in {"company": 150, "phone": 30, "email": 150, "address": 2000, "registration_number": 100, "contact_person": 150, "notes": 5000}.items():
        values[key] = text(data.get(key), key.replace("_", " "), limit)
    if values["email"]:
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", values["email"]):
            fail("Enter a valid supplier email.")
        values["email"] = values["email"].lower()
    if editing:
        values["version"] = integer(data.get("version"), "Version", 1)
    return values


def purchase_data(purchase):
    items = []
    for item in purchase.items.select_related("medicine", "batch"):
        items.append({
            "id": item.pk, "medicine_id": item.medicine_id, "medicine_name": item.medicine_name,
            "batch_id": item.batch_id, "batch_number": item.batch_number, "quantity": item.quantity,
            "purchase_price": str(item.purchase_price), "selling_price": str(item.selling_price),
            "expiry_date": item.expiry_date, "subtotal": str(item.subtotal),
        })
    movements = [{
        "id": movement.pk, "medicine_id": movement.medicine_id, "batch_id": movement.batch_id,
        "type": movement.type, "quantity": movement.quantity, "previous_stock": movement.previous_stock,
        "new_stock": movement.new_stock, "reference": movement.reference, "reason": movement.reason,
        "created_at": movement.created_at, "staff": movement.created_by.full_name,
    } for movement in StockMovement.objects.filter(purchase_item__purchase=purchase).select_related("created_by").order_by("id")]
    return {
        **purchase_summary(purchase),
        "items": items,
        "movements": movements,
    }


def purchase_summary(purchase):
    return {
        "id": purchase.pk, "purchase_number": purchase.purchase_number,
        "supplier_id": purchase.supplier_id, "supplier_name": purchase.supplier_name,
        "purchase_date": purchase.purchase_date, "invoice_number": purchase.invoice_number,
        "payment_status": purchase.payment_status, "amount_paid": str(purchase.amount_paid),
        "total_amount": str(purchase.total_amount), "notes": purchase.notes, "status": "COMPLETED",
        "created_by": purchase.created_by_id, "created_at": purchase.created_at,
        "staff": purchase.created_by.full_name,
    }


def make_purchase(data, user):
    allowed = {"supplier_id", "purchase_date", "invoice_number", "notes", "amount_paid", "request_key", "items"}
    only_fields(data, allowed)
    try:
        request_key = uuid.UUID(str(data.get("request_key")))
    except (ValueError, TypeError, AttributeError):
        fail("A valid request key is required.")
    supplier_id = integer(data.get("supplier_id"), "Supplier", 1)
    purchase_date = parse_date(data.get("purchase_date"), "Purchase date")
    if purchase_date > timezone.localdate():
        fail("Purchase date cannot be in the future.")
    invoice = text(data.get("invoice_number"), "Invoice number", 100, True)
    notes = text(data.get("notes"), "Notes", 5000)
    paid = money(data.get("amount_paid"), "Amount paid", 12)
    raw_items = data.get("items")
    if not isinstance(raw_items, list) or not 1 <= len(raw_items) <= 100:
        fail("A purchase needs between 1 and 100 items.")
    items = []
    seen = set()
    sell_prices = {}
    total = Decimal("0.00")
    for raw in raw_items:
        if not isinstance(raw, dict):
            fail("A purchase item must be an object.")
        only_fields(raw, {"medicine_id", "batch_number", "quantity", "purchase_price", "selling_price", "expiry_date"})
        medicine_id = integer(raw.get("medicine_id"), "Medicine", 1)
        batch_number = text(raw.get("batch_number"), "Batch number", 100, True)
        quantity = integer(raw.get("quantity"), "Quantity", 1, 1_000_000)
        purchase_price = money(raw.get("purchase_price"), "Purchase price")
        selling_price = money(raw.get("selling_price"), "Selling price")
        expiry_date = parse_date(raw.get("expiry_date"), "Expiry date")
        key = (medicine_id, batch_number.lower())
        if key in seen:
            fail("Combine duplicate medicine/batch lines into one item.")
        seen.add(key)
        if medicine_id in sell_prices and sell_prices[medicine_id] != selling_price:
            fail("Use the same selling price for all batches of a medicine in this purchase.")
        sell_prices[medicine_id] = selling_price
        subtotal = purchase_price * quantity
        total += subtotal
        if total > Decimal("99999999999999"):
            fail("Purchase total is too large.")
        items.append({"medicine_id": medicine_id, "batch_number": batch_number, "quantity": quantity, "purchase_price": purchase_price, "selling_price": selling_price, "expiry_date": expiry_date, "subtotal": subtotal})
    if paid > total:
        fail("Amount paid cannot exceed the purchase total.")
    normalized = {
        "supplier_id": supplier_id, "purchase_date": purchase_date.isoformat(), "invoice_number": invoice,
        "notes": notes, "amount_paid": str(paid), "request_key": str(request_key),
        "items": [{**item, "expiry_date": item["expiry_date"].isoformat(), "purchase_price": str(item["purchase_price"]), "selling_price": str(item["selling_price"]), "subtotal": str(item["subtotal"])} for item in items],
    }
    digest = hashlib.sha256(json.dumps(normalized, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    existing = Purchase.objects.filter(request_key=request_key).first()
    if existing:
        if existing.created_by_id != user.pk or existing.request_hash != digest:
            fail("This request key was already used for a different purchase. Start a new receipt.", 409)
        return purchase_data(existing), True
    try:
        with transaction.atomic():
            supplier = Supplier.objects.select_for_update().filter(pk=supplier_id, status="ACTIVE").first()
            if not supplier:
                fail("Select an active supplier.", 409)
            medicine_ids = sorted({item["medicine_id"] for item in items})
            medicines = {
                medicine.pk: medicine
                for medicine in Medicine.objects.select_for_update().filter(pk__in=medicine_ids, status="ACTIVE").order_by("pk")
            }
            if len(medicines) != len(medicine_ids):
                fail("A selected medicine is no longer active. Reload the receipt.", 409)
            if any(item["expiry_date"] < timezone.localdate() for item in items):
                fail("Expired batches cannot be received.")
            number = f"PUR-{timezone.localdate():%Y%m%d}-{uuid.uuid4().hex[:12].upper()}"
            purchase = Purchase.objects.create(
                supplier=supplier, supplier_name=supplier.name, purchase_number=number,
                purchase_date=purchase_date, invoice_number=invoice,
                payment_status="PAID" if paid == total else "UNPAID" if paid == 0 else "PARTIAL",
                amount_paid=paid, total_amount=total, notes=notes, request_key=request_key,
                request_hash=digest, created_by=user,
            )
            for item in items:
                medicine = medicines[item["medicine_id"]]
                previous = medicine.batches.aggregate(total=Coalesce(Sum("quantity"), Value(0)))["total"]
                if previous + item["quantity"] > 2_147_483_647:
                    fail("Receiving this quantity would exceed the stock limit.")
                batch = MedicineBatch.objects.select_for_update().filter(medicine=medicine, batch_number__iexact=item["batch_number"]).first()
                if batch:
                    if batch.expiry_date != item["expiry_date"] or batch.purchase_price != item["purchase_price"]:
                        fail("An existing batch has a different expiry date or purchase price. Check the supplier batch details.", 409)
                    batch.quantity += item["quantity"]
                    batch.save(update_fields=["quantity"])
                else:
                    batch = MedicineBatch.objects.create(
                        medicine=medicine, batch_number=item["batch_number"], expiry_date=item["expiry_date"],
                        quantity=item["quantity"], purchase_price=item["purchase_price"],
                    )
                purchase_item = PurchaseItem.objects.create(purchase=purchase, medicine=medicine, medicine_name=medicine.name, batch=batch, batch_number=batch.batch_number, quantity=item["quantity"], purchase_price=item["purchase_price"], selling_price=item["selling_price"], expiry_date=item["expiry_date"], subtotal=item["subtotal"])
                StockMovement.objects.create(medicine=medicine, batch=batch, purchase_item=purchase_item, type="PURCHASE", quantity=item["quantity"], previous_stock=previous, new_stock=previous + item["quantity"], reference=number, reason="Stock received from supplier", created_by=user)
                medicine.purchase_price = item["purchase_price"]
                medicine.selling_price = item["selling_price"]
                medicine.updated_by = user
                medicine.version += 1
                medicine.save(update_fields=["purchase_price", "selling_price", "updated_by", "version", "updated_at"])
            audit(user, "COMPLETED_PURCHASE", "Purchase", purchase.pk, number)
        return purchase_data(purchase), False
    except IntegrityError:
        existing = Purchase.objects.filter(request_key=request_key).first()
        if existing and existing.created_by_id == user.pk and existing.request_hash == digest:
            return purchase_data(existing), True
        fail("This supplier invoice has already been received, or the receipt repeats a batch. Check the existing purchases.", 409)


def list_purchases(request):
    _, _, search = parse_page(request)
    queryset = Purchase.objects.select_related("created_by").all().order_by("-purchase_date", "-id")
    status = request.GET.get("payment_status", "")
    if status not in ("", "PAID", "PARTIAL", "UNPAID"):
        fail("Invalid payment status.")
    if status:
        queryset = queryset.filter(payment_status=status)
    if request.GET.get("supplier_id"):
        queryset = queryset.filter(supplier_id=integer(request.GET["supplier_id"], "Supplier", 1))
    if search:
        queryset = queryset.filter(Q(purchase_number__icontains=search) | Q(invoice_number__icontains=search) | Q(supplier_name__icontains=search))
    from_date = parse_date(request.GET["from"], "Start date") if request.GET.get("from") else None
    to_date = parse_date(request.GET["to"], "End date") if request.GET.get("to") else None
    if from_date and to_date and from_date > to_date:
        fail("Start date must be on or before end date.")
    for field in ("from", "to"):
        if request.GET.get(field):
            queryset = queryset.filter(**{"purchase_date__gte" if field == "from" else "purchase_date__lte": parse_date(request.GET[field], "Start date" if field == "from" else "End date")})
    rows, pagination = paginate(queryset, request)
    return {"items": [purchase_summary(row) for row in rows], "pagination": pagination}


def customer_data(customer):
    return {
        "id": customer.pk, "full_name": customer.full_name, "phone": customer.phone,
        "email": customer.email, "address": customer.address, "date_of_birth": customer.date_of_birth,
        "notes": customer.notes, "version": customer.version,
    }


def sale_data(sale):
    return {
        "id": sale.pk, "invoice_number": sale.invoice_number, "customer_name": sale.customer_name,
        "sale_date": sale.sale_date, "subtotal": str(sale.subtotal), "discount": str(sale.discount),
        "total_amount": str(sale.total_amount), "amount_paid": str(sale.amount_paid),
        "change_amount": str(sale.change_amount), "payment_method": sale.payment_method,
        "payment_status": "PAID", "staff": sale.created_by.full_name if hasattr(sale, "created_by") else "",
        "customer_id": sale.detail.customer_id if hasattr(sale, "detail") else None,
        "prescription_id": sale.detail.prescription_id if hasattr(sale, "detail") else None,
        "pharmacy_profile": sale.detail.pharmacy_profile if hasattr(sale, "detail") else None,
        "created_at": sale.created_at,
        "items": [{
            "medicine_id": item.medicine_id, "medicine_name": item.medicine_name,
            "batch_id": item.batch_id, "batch_number": item.batch_number,
            "quantity": item.quantity, "unit_price": str(item.unit_price),
            "unit_cost": str(item.unit_cost), "subtotal": str(item.subtotal),
        } for item in sale.items.select_related("medicine", "batch")],
    }


def make_sale(data, user):
    only_fields(data, {"request_key", "customer_id", "prescription_id", "customer_name", "discount", "amount_paid", "payment_method", "items"})
    try:
        request_key = uuid.UUID(str(data.get("request_key")))
    except (ValueError, TypeError, AttributeError):
        fail("A valid request key is required.")
    method = data.get("payment_method")
    if method not in Sale.PaymentMethod.values:
        fail("Select a payment method.")
    raw_items = data.get("items")
    if not isinstance(raw_items, list) or not 1 <= len(raw_items) <= 100:
        fail("Select between 1 and 100 medicines.")
    items, seen = [], set()
    for item in raw_items:
        only_fields(item, {"medicine_id", "quantity", "unit_price"})
        mid = integer(item.get("medicine_id"), "Medicine", 1)
        if mid in seen:
            fail("Combine repeated medicines into one cart line.")
        seen.add(mid)
        items.append({"medicine_id": mid, "quantity": integer(item.get("quantity"), "Quantity", 1, 1_000_000), "unit_price": money(item.get("unit_price"), "Unit price")})
    items.sort(key=lambda item: item["medicine_id"])
    discount = money(data.get("discount"), "Discount")
    paid = money(data.get("amount_paid"), "Amount paid")
    customer_id = integer(data["customer_id"], "Customer", 1) if data.get("customer_id") not in (None, "") else None
    prescription_id = integer(data["prescription_id"], "Prescription", 1) if data.get("prescription_id") not in (None, "") else None
    customer_name = text(data.get("customer_name"), "Customer", 150)
    digest_input = {
        "request_key": str(request_key), "customer_id": customer_id, "prescription_id": prescription_id,
        "customer_name": customer_name, "discount": str(discount), "amount_paid": str(paid),
        "payment_method": method, "items": [{**item, "unit_price": str(item["unit_price"])} for item in items],
    }
    digest = hashlib.sha256(json.dumps(digest_input, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    existing = Sale.objects.filter(request_key=request_key).first()
    if existing:
        if existing.created_by_id != user.pk or existing.request_hash != digest:
            fail("This checkout was already submitted with different details. Review sales history.", 409)
        return sale_data(existing), True
    if prescription_id and "prescriptions:write" not in permissions_for(user.role):
        fail("Only a pharmacist or administrator can dispense prescriptions.", 403)
    try:
        with transaction.atomic():
            prescription = None
            if prescription_id:
                prescription = Prescription.objects.select_for_update().filter(pk=prescription_id).first()
                if not prescription or prescription.status not in ("PENDING", "PARTIALLY_DISPENSED"):
                    fail("Prescription is not available for dispensing.", 409)
                if customer_id and customer_id != prescription.customer_id:
                    fail("Customer does not match the prescription.")
                customer_id = prescription.customer_id
                prescribed = {row.medicine_id: row for row in PrescriptionItem.objects.select_for_update().filter(prescription=prescription)}
                for item in items:
                    remaining = prescribed.get(item["medicine_id"])
                    if not remaining or item["quantity"] > remaining.quantity - remaining.dispensed_quantity:
                        fail("Sale exceeds the remaining prescribed quantity.", 409)
            customer = Customer.objects.select_for_update().filter(pk=customer_id).first() if customer_id else None
            if customer_id and not customer:
                fail("Customer not found.", 404)
            if customer:
                customer_name = customer.full_name
            medicines = {
                row.pk: row for row in Medicine.objects.select_for_update().filter(pk__in=[item["medicine_id"] for item in items], status="ACTIVE").order_by("pk")
            }
            if len(medicines) != len(items):
                fail("A medicine is no longer available.", 409)
            lines, subtotal = [], Decimal("0.00")
            for item in items:
                medicine = medicines[item["medicine_id"]]
                if medicine.selling_price != item["unit_price"]:
                    fail("A selling price changed. Refresh the cart before checkout.", 409)
                stock = medicine.batches.aggregate(total=Coalesce(Sum("quantity"), Value(0)))["total"]
                remaining = item["quantity"]
                batches = MedicineBatch.objects.select_for_update().filter(medicine=medicine, quantity__gt=0, expiry_date__gte=timezone.localdate()).order_by("expiry_date", "id")
                for batch in batches:
                    if remaining <= 0:
                        break
                    quantity = min(remaining, batch.quantity)
                    lines.append({"medicine": medicine, "batch": batch, "quantity": quantity, "previous_stock": stock, "new_stock": stock - quantity})
                    subtotal += medicine.selling_price * quantity
                    stock -= quantity
                    remaining -= quantity
                if remaining:
                    fail(f"Insufficient non-expired stock for {medicine.name}.", 409)
            if discount > subtotal:
                fail("Invalid sale total or discount.")
            total = subtotal - discount
            if subtotal > Decimal("99999999999999"):
                fail("Invalid sale total or discount.")
            if paid < total:
                fail("Amount paid must cover the total.")
            settings = PharmacySettings.objects.filter(pk=1).first() or PharmacySettings.objects.create(pk=1)
            invoice = f"{settings.invoice_prefix}-{timezone.localdate():%Y%m%d}-{uuid.uuid4().hex[:12].upper()}"
            sale = Sale.objects.create(invoice_number=invoice, customer_name=customer_name, sale_date=timezone.localdate(), subtotal=subtotal, discount=discount, total_amount=total, amount_paid=paid, change_amount=paid - total, payment_method=method, request_key=request_key, request_hash=digest, created_by=user)
            PharmacyPreference.objects.get_or_create(settings=settings)
            profile = setting_data()
            SaleDetail.objects.create(sale=sale, customer=customer, prescription=prescription, pharmacy_profile=profile)
            for line in lines:
                medicine, batch = line["medicine"], line["batch"]
                SaleItem.objects.create(sale=sale, medicine=medicine, batch=batch, medicine_name=medicine.name, batch_number=batch.batch_number, quantity=line["quantity"], unit_price=medicine.selling_price, unit_cost=batch.purchase_price, subtotal=medicine.selling_price * line["quantity"])
                batch.quantity -= line["quantity"]
                batch.save(update_fields=["quantity"])
                StockMovement.objects.create(medicine=medicine, batch=batch, type="SALE", quantity=-line["quantity"], previous_stock=line["previous_stock"], new_stock=line["new_stock"], reference=invoice, reason="Sale completed", created_by=user)
            if prescription:
                for item in items:
                    PrescriptionItem.objects.filter(prescription=prescription, medicine_id=item["medicine_id"]).update(dispensed_quantity=F("dispensed_quantity") + item["quantity"])
                remaining = PrescriptionItem.objects.filter(prescription=prescription).aggregate(total=Sum(F("quantity") - F("dispensed_quantity")))["total"] or 0
                prescription.status = "DISPENSED" if remaining == 0 else "PARTIALLY_DISPENSED"
                prescription.version += 1
                prescription.updated_by = user
                prescription.save(update_fields=["status", "version", "updated_by", "updated_at"])
                audit(user, "DISPENSED_PRESCRIPTION", "Prescription", prescription.pk, invoice)
            audit(user, "COMPLETED_SALE", "Sale", sale.pk, invoice)
        return sale_data(sale), False
    except IntegrityError:
        existing = Sale.objects.filter(request_key=request_key).first()
        if existing and existing.created_by_id == user.pk and existing.request_hash == digest:
            return sale_data(existing), True
        fail("Sale could not be completed because the request conflicts with an existing transaction.", 409)


def operations_dispatch(parts, request, user):
    root = parts[0]
    if root == "suppliers":
        require_permission(user, "suppliers")
        if len(parts) == 1 and request.method == "GET":
            _, _, search = parse_page(request)
            queryset = Supplier.objects.all().order_by("name", "id")
            status = request.GET.get("status", "")
            if status not in ("", "ACTIVE", "INACTIVE"):
                fail("Invalid supplier status.")
            if status:
                queryset = queryset.filter(status=status)
            if search:
                queryset = queryset.filter(Q(name__icontains=search) | Q(company__icontains=search) | Q(phone__icontains=search) | Q(email__icontains=search))
            rows, pagination = paginate(queryset, request)
            return response({"items": [data_supplier(row) for row in rows], "pagination": pagination})
        if len(parts) == 2 and parts[1].isdigit() and request.method == "GET":
            supplier = Supplier.objects.filter(pk=int(parts[1])).first()
            if not supplier:
                fail("Supplier not found.", 404)
            result = data_supplier(supplier)
            result["recent_purchases"] = [purchase_summary(row) for row in supplier.purchases.select_related("created_by").order_by("-id")[:8]]
            result["medicines"] = list(Medicine.objects.filter(purchaseitem__purchase__supplier=supplier).values("id", "name").distinct()[:100])
            return response(result)
        if len(parts) == 1 and request.method == "POST":
            require_permission(user, "suppliers:write")
            values = supplier_fields(body(request))
            supplier = Supplier.objects.create(**values, created_by=user, updated_by=user)
            audit(user, "CREATED_SUPPLIER", "Supplier", supplier.pk, "Supplier record created.")
            return response(data_supplier(supplier), 201)
        if len(parts) == 2 and parts[1].isdigit() and request.method == "PUT":
            require_permission(user, "suppliers:write")
            values = supplier_fields(body(request), True)
            with transaction.atomic():
                supplier = Supplier.objects.select_for_update().filter(pk=int(parts[1])).first()
                if not supplier:
                    fail("Supplier not found.", 404)
                if supplier.version != values.pop("version"):
                    fail("Supplier changed. Reload before saving.", 409)
                for key, value in values.items():
                    setattr(supplier, key, value)
                supplier.version += 1
                supplier.updated_by = user
                supplier.save()
                audit(user, "UPDATED_SUPPLIER", "Supplier", supplier.pk, "Supplier record updated.")
            return response(data_supplier(supplier))
        if len(parts) == 3 and parts[1].isdigit() and parts[2] in ("activate", "deactivate") and request.method == "PATCH":
            require_permission(user, "suppliers:archive")
            data = body(request)
            only_fields(data, {"version"})
            with transaction.atomic():
                supplier = Supplier.objects.select_for_update().filter(pk=int(parts[1])).first()
                if not supplier:
                    fail("Supplier not found.", 404)
                if supplier.version != integer(data.get("version"), "Version", 1):
                    fail("Supplier changed. Reload before saving.", 409)
                supplier.status = "ACTIVE" if parts[2] == "activate" else "INACTIVE"
                supplier.version += 1
                supplier.updated_by = user
                supplier.save()
                audit(user, "CHANGED_SUPPLIER_STATUS", "Supplier", supplier.pk, supplier.status)
            return response(data_supplier(supplier))
    if root == "purchases":
        require_permission(user, "purchases")
        if parts == ["purchases"] and request.method == "GET":
            return response(list_purchases(request))
        if parts == ["purchases", "medicines"] and request.method == "GET":
            search = text(request.GET.get("search", ""), "Search", 150) or ""
            medicines = Medicine.objects.filter(status="ACTIVE")
            if search:
                medicines = medicines.filter(Q(name__icontains=search) | Q(barcode__icontains=search))
            return response([{"id": row.pk, "name": row.name, "barcode": row.barcode, "purchase_price": str(row.purchase_price), "selling_price": str(row.selling_price)} for row in medicines.order_by("name")[:30]])
        if len(parts) == 2 and parts[1].isdigit() and request.method == "GET":
            purchase = Purchase.objects.filter(pk=int(parts[1])).first()
            if not purchase:
                fail("Purchase not found.", 404)
            return response(purchase_data(purchase))
        if parts == ["purchases"] and request.method == "POST":
            require_permission(user, "purchases:write")
            result, replayed = make_purchase(body(request), user)
            return response(result, 200 if replayed else 201)
    if root == "sales":
        require_permission(user, "sales")
        if len(parts) == 3 and parts[1].isdigit() and parts[2] == "invoice" and request.method == "GET":
            sale = Sale.objects.select_related("created_by", "detail").filter(pk=int(parts[1])).first()
            if not sale:
                fail("Sale not found.", 404)
            return invoice_response(sale)
        if parts == ["sales"] and request.method == "GET":
            page, limit, search = parse_page(request)
            queryset = Sale.objects.all().order_by("-id")
            if search:
                queryset = queryset.filter(Q(invoice_number__icontains=search) | Q(customer_name__icontains=search))
            for key, lookup in (("from", "sale_date__gte"), ("to", "sale_date__lte")):
                if request.GET.get(key):
                    queryset = queryset.filter(**{lookup: parse_date(request.GET[key], "Date")})
            rows, pagination = paginate(queryset, request)
            return response({"items": [sale_data(row) for row in rows], "pagination": pagination})
        if parts == ["sales", "medicines"] and request.method == "GET":
            search = text(request.GET.get("search", ""), "Search", 150) or ""
            queryset = Medicine.objects.filter(status="ACTIVE").annotate(usable=Coalesce(Sum("batches__quantity", filter=Q(batches__expiry_date__gte=timezone.localdate())), Value(0))).filter(usable__gt=0)
            if search:
                queryset = queryset.filter(Q(name__icontains=search) | Q(barcode__icontains=search))
            return response([{"id": row.pk, "name": row.name, "barcode": row.barcode, "selling_price": str(row.selling_price), "quantity": row.usable} for row in queryset.order_by("name")[:30]])
        if len(parts) == 2 and parts[1].isdigit() and request.method == "GET":
            sale = Sale.objects.filter(pk=int(parts[1])).first()
            if not sale:
                fail("Sale not found.", 404)
            return response(sale_data(sale))
        if parts == ["sales"] and request.method == "POST":
            require_permission(user, "sales:write")
            result, replayed = make_sale(body(request), user)
            return response(result, 200 if replayed else 201)
    if root == "stock":
        require_permission(user, "stock")
        if parts == ["stock", "options"] and request.method == "GET":
            return response({
                "categories": list(Category.objects.order_by("name").values("id", "name")),
                "suppliers": list(Supplier.objects.order_by("name").values("id", "name")),
            })
        if len(parts) == 3 and parts[1].isdigit() and parts[2] == "batches" and request.method == "GET":
            batches = MedicineBatch.objects.filter(medicine_id=int(parts[1])).order_by("expiry_date", "id")
            return response([{"id": row.pk, "batch_number": row.batch_number, "expiry_date": row.expiry_date, "quantity": row.quantity, "purchase_price": str(row.purchase_price)} for row in batches])
        if len(parts) == 2 and parts[1] == "movements" and request.method == "GET":
            page, limit, search = parse_page(request)
            queryset = StockMovement.objects.select_related("medicine", "batch", "created_by").order_by("-created_at", "-id")
            if search:
                queryset = queryset.filter(Q(medicine__name__icontains=search) | Q(reference__icontains=search) | Q(batch__batch_number__icontains=search))
            if request.GET.get("type"):
                if request.GET["type"] not in StockMovement.Type.values:
                    fail("Invalid movement type.")
                queryset = queryset.filter(type=request.GET["type"])
            rows, pagination = paginate(queryset, request)
            return response({"items": [{"id": row.pk, "medicine_id": row.medicine_id, "medicine_name": row.medicine.name, "batch_number": row.batch.batch_number, "type": row.type, "quantity": row.quantity, "previous_stock": row.previous_stock, "new_stock": row.new_stock, "reference": row.reference, "reason": row.reason, "staff": row.created_by.full_name, "created_at": row.created_at} for row in rows], "pagination": pagination})
        if parts == ["stock"] and request.method == "GET":
            _, _, search = parse_page(request)
            today = timezone.localdate()
            queryset = Medicine.objects.filter(status="ACTIVE").select_related("category").annotate(
                quantity=Coalesce(Sum("batches__quantity"), Value(0)),
                expired_quantity=Coalesce(Sum("batches__quantity", filter=Q(batches__expiry_date__lt=today)), Value(0)),
                next_expiry=Min("batches__expiry_date", filter=Q(batches__quantity__gt=0)),
            )
            if search:
                queryset = queryset.filter(Q(name__icontains=search) | Q(barcode__icontains=search))
            if request.GET.get("category"):
                queryset = queryset.filter(category_id=integer(request.GET["category"], "Category", 1))
            if request.GET.get("supplier"):
                queryset = queryset.filter(purchaseitem__purchase__supplier_id=integer(request.GET["supplier"], "Supplier", 1)).distinct()
            stock_filter = request.GET.get("stock", "")
            if stock_filter not in ("", "in", "low", "out"):
                fail("Invalid stock filter.")
            if stock_filter == "in":
                queryset = queryset.filter(quantity__gt=F("minimum_stock"))
            elif stock_filter == "low":
                queryset = queryset.filter(quantity__gt=0, quantity__lte=F("minimum_stock"))
            elif stock_filter == "out":
                queryset = queryset.filter(quantity=0)
            expiry_filter = request.GET.get("expiry", "")
            if expiry_filter not in ("", "expired", "30", "60", "90"):
                fail("Invalid expiry filter.")
            if expiry_filter:
                date_filters = {"medicine_id": OuterRef("pk"), "quantity__gt": 0}
                if expiry_filter == "expired":
                    date_filters["expiry_date__lt"] = today
                else:
                    date_filters["expiry_date__range"] = (today, today + timedelta(days=int(expiry_filter)))
                queryset = queryset.filter(Exists(MedicineBatch.objects.filter(**date_filters)))
            rows, pagination = paginate(queryset, request)
            return response({"items": [{
                "id": row.pk, "name": row.name, "barcode": row.barcode,
                "quantity": row.quantity, "usable_quantity": row.quantity - row.expired_quantity,
                "expired_quantity": row.expired_quantity, "next_expiry": row.next_expiry,
                "minimum_stock": row.minimum_stock, "category_name": row.category.name if row.category_id else None,
            } for row in rows], "pagination": pagination})
    if root == "customers":
        return customer_dispatch(parts, request, user)
    if root == "prescriptions":
        return prescription_dispatch(parts, request, user)
    if root == "users":
        return user_dispatch(parts, request, user)
    if root in ("settings", "notifications", "audit", "reports", "media"):
        return auxiliary_dispatch(parts, request, user)
    return None


def invoice_response(sale):
    from html import escape
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_RIGHT
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import Image as PdfImage, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    profile = sale.detail.pharmacy_profile if hasattr(sale, "detail") else {}
    profile = profile or {}
    buffer = io.BytesIO()
    document = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=15 * mm, leftMargin=15 * mm, topMargin=18 * mm, bottomMargin=18 * mm, title=sale.invoice_number, author=profile.get("pharmacy_name") or "Pharmacy")
    styles = getSampleStyleSheet()
    green = colors.HexColor("#157347")
    normal = styles["BodyText"]
    small = ParagraphStyle("InvoiceSmall", parent=normal, fontSize=8, leading=11)
    right = ParagraphStyle("InvoiceRight", parent=small, alignment=TA_RIGHT)
    brand = Paragraph(escape(profile.get("pharmacy_name") or "Pharmacy"), styles["Title"])
    logo_flowable = None
    if profile.get("invoice_show_logo") and isinstance(profile.get("logo_url"), str):
        logo_match = re.fullmatch(r"/api/media/([0-9a-fA-F-]{36})", profile["logo_url"])
        if logo_match:
            logo = ImageUpload.objects.filter(pk=logo_match.group(1), purpose="logo").first()
            if logo:
                logo_flowable = PdfImage(io.BytesIO(bytes(logo.content)), width=20 * mm, height=20 * mm, kind="proportional")
    if logo_flowable:
        story = [Table([[logo_flowable, brand]], colWidths=[25 * mm, 155 * mm], style=TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 4), ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))]
    else:
        story = [brand]
    for line in (profile.get("address"), " | ".join(value for value in (profile.get("phone"), profile.get("email")) if value), profile.get("registration_number"), profile.get("website"), profile.get("business_hours")):
        if line:
            story.append(Paragraph(escape(str(line)), small))
    story.extend([Spacer(1, 8 * mm), Paragraph(escape(profile.get("invoice_title") or "SALES INVOICE"), styles["Heading2"])])
    story.append(Paragraph(escape(f"Invoice: {sale.invoice_number} · Date: {sale.sale_date} · Customer: {sale.customer_name or 'Walk-in customer'} · Served by: {sale.created_by.full_name} · Payment: {sale.payment_method.replace('_', ' ')}"), small))
    rows = [[Paragraph("<b>Medicine / batch</b>", small), Paragraph("<b>Qty</b>", right), Paragraph("<b>Unit (TZS)</b>", right), Paragraph("<b>Amount (TZS)</b>", right)]]
    for item in sale.items.select_related("medicine", "batch").order_by("id"):
        rows.append([Paragraph(escape(f"{item.medicine_name}<br/>Batch: {item.batch_number}"), small), Paragraph(str(item.quantity), right), Paragraph(f"{item.unit_price:,.2f}", right), Paragraph(f"{item.subtotal:,.2f}", right)])
    table = Table(rows, colWidths=[95 * mm, 17 * mm, 30 * mm, 38 * mm], repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), green), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#dce5df")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"), ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f4f8f5")]),
        ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.extend([Spacer(1, 5 * mm), table, Spacer(1, 5 * mm)])
    totals = [["Subtotal", f"{sale.subtotal:,.2f}"], ["Discount", f"{sale.discount:,.2f}"], ["TOTAL (TZS)", f"{sale.total_amount:,.2f}"], ["Amount paid", f"{sale.amount_paid:,.2f}"], ["Change", f"{sale.change_amount:,.2f}"]]
    summary = Table(totals, colWidths=[55 * mm, 35 * mm], hAlign="RIGHT")
    summary.setStyle(TableStyle([("ALIGN", (1, 0), (-1, -1), "RIGHT"), ("BACKGROUND", (0, 2), (-1, 2), colors.HexColor("#e6f4eb")), ("TEXTCOLOR", (0, 2), (-1, 2), green), ("FONTNAME", (0, 2), (-1, 2), "Helvetica-Bold"), ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#dce5df"))]))
    story.append(summary)
    for section in (profile.get("invoice_terms"), profile.get("invoice_footer")):
        if section:
            story.extend([Spacer(1, 4 * mm), Paragraph(escape(str(section)), small)])

    def add_footer(canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(colors.HexColor("#dce5df"))
        canvas.line(15 * mm, 13 * mm, A4[0] - 15 * mm, 13 * mm)
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(colors.HexColor("#56616b"))
        canvas.drawString(15 * mm, 8 * mm, sale.invoice_number)
        canvas.drawRightString(A4[0] - 15 * mm, 8 * mm, f"Page {doc.page}")
        canvas.restoreState()

    document.build(story, onFirstPage=add_footer, onLaterPages=add_footer)
    result = HttpResponse(buffer.getvalue(), content_type="application/pdf")
    result["Content-Disposition"] = f'attachment; filename="{re.sub(r"[^A-Za-z0-9_-]", "_", sale.invoice_number)}.pdf"'
    result["Cache-Control"] = "no-store"
    return result


def customer_dispatch(parts, request, user):
    require_permission(user, "customers")
    if parts == ["customers"] and request.method == "GET":
        page, limit, search = parse_page(request)
        queryset = Customer.objects.order_by("full_name", "id")
        if search:
            queryset = queryset.filter(Q(full_name__icontains=search) | Q(phone__icontains=search) | Q(email__icontains=search))
        rows, pagination = paginate(queryset, request)
        return response({"items": [customer_data(row) for row in rows], "pagination": {key: value for key, value in pagination.items() if key != "limit"}})
    if len(parts) == 3 and parts[2] == "history" and parts[1].isdigit() and request.method == "GET":
        if not Customer.objects.filter(pk=int(parts[1])).exists():
            fail("Customer not found.", 404)
        page, limit, _ = parse_page(request)
        queryset = SaleDetail.objects.filter(customer_id=int(parts[1])).select_related("sale").order_by("-sale_id")
        rows, pagination = paginate(queryset, request)
        return response({"items": [{"id": row.sale.pk, "invoice_number": row.sale.invoice_number, "date": row.sale.sale_date, "total_amount": str(row.sale.total_amount), "payment_status": "PAID"} for row in rows], "pagination": {key: value for key, value in pagination.items() if key != "limit"}})
    if len(parts) == 2 and parts[1].isdigit() and request.method == "GET":
        customer = Customer.objects.filter(pk=int(parts[1])).first()
        if not customer:
            fail("Customer not found.", 404)
        return response(customer_data(customer))
    if parts == ["customers"] and request.method == "POST":
        require_permission(user, "customers:write")
        data = body(request)
        fields = {"full_name", "phone", "email", "address", "date_of_birth", "notes"}
        only_fields(data, fields)
        values = {"full_name": text(data.get("full_name"), "Name", 150, True), "phone": text(data.get("phone"), "Phone", 30), "email": text(data.get("email"), "Email", 150), "address": text(data.get("address"), "Address", 1000), "notes": text(data.get("notes"), "Notes", 5000)}
        values["date_of_birth"] = parse_date(data["date_of_birth"], "Date of birth") if data.get("date_of_birth") else None
        if values["email"]:
            if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", values["email"]):
                fail("Enter a valid email.")
            values["email"] = values["email"].lower()
        if values["date_of_birth"] and values["date_of_birth"] > timezone.localdate():
            fail("Date of birth must be a valid date, not in the future.")
        customer = Customer.objects.create(**values, created_by=user, updated_by=user)
        audit(user, "CREATED_CUSTOMER", "Customer", customer.pk, "Customer record saved.")
        return response(customer_data(customer), 201)
    if len(parts) == 2 and parts[1].isdigit() and request.method == "PUT":
        require_permission(user, "customers:write")
        data = body(request)
        fields = {"full_name", "phone", "email", "address", "date_of_birth", "notes", "version"}
        only_fields(data, fields)
        customer = Customer.objects.filter(pk=int(parts[1])).first()
        if not customer:
            fail("Customer not found.", 404)
        if customer.version != integer(data.get("version"), "Version", 1):
            fail("Customer changed. Reload before saving.", 409)
        for field in ("full_name", "phone", "email", "address", "notes"):
            setattr(customer, field, text(data.get(field), field.replace("_", " "), 1000 if field == "address" else 150, field == "full_name"))
        customer.date_of_birth = parse_date(data["date_of_birth"], "Date of birth") if data.get("date_of_birth") else None
        if customer.date_of_birth and customer.date_of_birth > timezone.localdate():
            fail("Date of birth must be a valid date, not in the future.")
        if customer.email and not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", customer.email):
            fail("Enter a valid email.")
        if customer.email:
            customer.email = customer.email.lower()
        customer.updated_by = user
        customer.version += 1
        customer.save()
        audit(user, "UPDATED_CUSTOMER", "Customer", customer.pk, "Customer record saved.")
        return response(customer_data(customer))
    return None


def prescription_dispatch(parts, request, user):
    require_permission(user, "prescriptions")
    if parts == ["prescriptions"] and request.method == "GET":
        page, limit, search = parse_page(request)
        queryset = Prescription.objects.order_by("-id")
        if search:
            queryset = queryset.filter(prescription_number__icontains=search)
        status = request.GET.get("status", "")
        if status:
            if status not in Prescription.Status.values:
                fail("Invalid prescription status.")
            queryset = queryset.filter(status=status)
        rows, pagination = paginate(queryset, request)
        return response({"items": [{"id": row.pk, "prescription_number": row.prescription_number, "customer_id": row.customer_id, "prescription_date": row.prescription_date, "status": row.status, "version": row.version} for row in rows], "pagination": {key: value for key, value in pagination.items() if key != "limit"}})
    if parts == ["prescriptions"] and request.method == "POST":
        require_permission(user, "prescriptions:write")
        return response(save_prescription(body(request), user), 201)
    if len(parts) == 2 and parts[1].isdigit() and request.method == "PUT":
        require_permission(user, "prescriptions:write")
        return response(save_prescription(body(request), user, int(parts[1])))
    if len(parts) == 2 and parts[1].isdigit() and request.method == "GET":
        rx = Prescription.objects.select_related("customer").filter(pk=int(parts[1])).first()
        if not rx:
            fail("Prescription not found.", 404)
        result = {"id": rx.pk, "prescription_number": rx.prescription_number, "customer_id": rx.customer_id, "customer_name": rx.customer.full_name, "doctor": rx.doctor, "prescription_date": rx.prescription_date, "notes": rx.notes, "status": rx.status, "version": rx.version,
                  "items": [{"id": row.pk, "medicine_id": row.medicine_id, "medicine_name": row.medicine.name, "dosage": row.dosage, "frequency": row.frequency, "duration": row.duration, "quantity": row.quantity, "dispensed_quantity": row.dispensed_quantity, "instructions": row.instructions, "selling_price": str(row.medicine.selling_price)} for row in rx.items.select_related("medicine")],
                  "sales": [{"id": row.sale_id, "invoice_number": row.sale.invoice_number, "total_amount": str(row.sale.total_amount)} for row in SaleDetail.objects.filter(prescription=rx).select_related("sale")]}
        return response(result)
    if len(parts) == 3 and parts[1].isdigit() and parts[2] == "cancel" and request.method == "PATCH":
        require_permission(user, "prescriptions:write")
        data = body(request)
        only_fields(data, {"version"})
        with transaction.atomic():
            rx = Prescription.objects.select_for_update().filter(pk=int(parts[1])).first()
            if not rx:
                fail("Prescription not found.", 404)
            if rx.version != integer(data.get("version"), "Version", 1) or rx.status not in ("PENDING", "PARTIALLY_DISPENSED"):
                fail("This prescription cannot be cancelled. Reload its current status.", 409)
            rx.status, rx.version, rx.updated_by = "CANCELLED", rx.version + 1, user
            rx.save(update_fields=["status", "version", "updated_by", "updated_at"])
            audit(user, "CANCELLED_PRESCRIPTION", "Prescription", rx.pk, "Remaining dispensing cancelled. Existing sales retained.")
        return response({"id": rx.pk, "prescription_number": rx.prescription_number, "status": rx.status, "version": rx.version})
    return None


def save_prescription(data, user, record_id=None):
    allowed = {"customer_id", "doctor", "prescription_date", "notes", "items"}
    allowed.add("version" if record_id else "request_key")
    only_fields(data, allowed)
    customer_id = integer(data.get("customer_id"), "Customer", 1)
    doctor = text(data.get("doctor"), "Doctor", 150, True)
    prescription_date = parse_date(data.get("prescription_date"), "Prescription date")
    if prescription_date > timezone.localdate():
        fail("Prescription date must be a valid date, not in the future.")
    notes = text(data.get("notes"), "Notes", 3000)
    raw_items = data.get("items")
    if not isinstance(raw_items, list) or not 1 <= len(raw_items) <= 100:
        fail("Add between 1 and 100 prescription items.")
    items, seen = [], set()
    for row in raw_items:
        if not isinstance(row, dict):
            fail("A prescription item must be an object.")
        only_fields(row, {"medicine_id", "dosage", "frequency", "duration", "quantity", "instructions"})
        medicine_id = integer(row.get("medicine_id"), "Medicine", 1)
        if medicine_id in seen:
            fail("Combine duplicate medicine lines.")
        seen.add(medicine_id)
        items.append({
            "medicine_id": medicine_id,
            "dosage": text(row.get("dosage"), "Dosage", 150, True),
            "frequency": text(row.get("frequency"), "Frequency", 150, True),
            "duration": text(row.get("duration"), "Duration", 150, True),
            "quantity": integer(row.get("quantity"), "Quantity", 1, 1_000_000),
            "instructions": text(row.get("instructions"), "Instructions", 1000),
        })
    with transaction.atomic():
        if not Customer.objects.filter(pk=customer_id).exists():
            fail("Select an existing customer.")
        active_ids = set(Medicine.objects.filter(pk__in=seen, status="ACTIVE").values_list("pk", flat=True))
        if active_ids != seen:
            fail("Select active medicines.")
        if record_id:
            prescription = Prescription.objects.select_for_update().filter(pk=record_id).first()
            if not prescription:
                fail("Prescription not found.", 404)
            if prescription.version != integer(data.get("version"), "Version", 1) or prescription.status != "PENDING":
                fail("Only an unchanged pending prescription can be edited.", 409)
            prescription.customer_id = customer_id
            prescription.doctor = doctor
            prescription.prescription_date = prescription_date
            prescription.notes = notes
            prescription.updated_by = user
            prescription.version += 1
            prescription.save()
            prescription.items.all().delete()
            action = "UPDATED_PRESCRIPTION"
        else:
            try:
                request_key = uuid.UUID(str(data.get("request_key")))
            except (ValueError, TypeError, AttributeError):
                fail("A valid request key is required.")
            if Prescription.objects.filter(request_key=request_key).exists():
                fail("This prescription form was already submitted. Check the prescription list.", 409)
            prescription = Prescription.objects.create(
                prescription_number=f"RX-{uuid.uuid4().hex.upper()}",
                customer_id=customer_id, doctor=doctor, prescription_date=prescription_date,
                notes=notes, request_key=request_key, created_by=user, updated_by=user,
            )
            action = "CREATED_PRESCRIPTION"
        PrescriptionItem.objects.bulk_create([PrescriptionItem(prescription=prescription, **item) for item in items])
        audit(user, action, "Prescription", prescription.pk, "Prescription saved.")
    return {
        "id": prescription.pk, "prescription_number": prescription.prescription_number,
        "customer_id": prescription.customer_id, "customer_name": prescription.customer.full_name,
        "doctor": prescription.doctor, "prescription_date": prescription.prescription_date,
        "notes": prescription.notes, "status": prescription.status, "version": prescription.version,
        "items": [{
            "id": row.pk, "medicine_id": row.medicine_id, "medicine_name": row.medicine.name,
            "dosage": row.dosage, "frequency": row.frequency, "duration": row.duration,
            "quantity": row.quantity, "dispensed_quantity": row.dispensed_quantity,
            "instructions": row.instructions, "selling_price": str(row.medicine.selling_price),
        } for row in prescription.items.select_related("medicine")],
        "sales": [],
    }


def user_dispatch(parts, request, actor):
    require_permission(actor, "users")
    if parts == ["users"] and request.method == "GET":
        _, _, search = parse_page(request)
        queryset = PharmacyUser.objects.select_related("access").annotate(
            approval_order=Case(When(access__status="PENDING", then=Value(0)), default=Value(1), output_field=IntegerField())
        ).order_by("approval_order", "-created_at", "-id")
        if request.GET.get("status") and request.GET["status"] not in UserAccess.Status.values:
            fail("Invalid approval status.")
        if request.GET.get("role") and request.GET["role"] not in PharmacyUser.Role.values:
            fail("Invalid role.")
        if search:
            queryset = queryset.filter(Q(full_name__icontains=search) | Q(email__icontains=search))
        if request.GET.get("status"):
            queryset = queryset.filter(access__status=request.GET["status"])
        if request.GET.get("role"):
            queryset = queryset.filter(role=request.GET["role"])
        rows, pagination = paginate(queryset, request)
        return response({"items": [public_user(row) for row in rows], "pagination": pagination})
    if len(parts) == 3 and parts[1].isdigit() and request.method == "PATCH":
        action = parts[2]
        if action not in ("approve", "reject", "suspend", "activate", "role"):
            return None
        require_permission(actor, "settings")
        data = body(request)
        only_fields(data, {"version", "role"} if action == "role" else {"version"})
        with transaction.atomic():
            AdministrationLock.objects.get_or_create(pk=1)
            AdministrationLock.objects.select_for_update().get(pk=1)
            actor = PharmacyUser.objects.select_for_update().get(pk=actor.pk)
            actor_access = UserAccess.objects.select_for_update().filter(user=actor).first()
            if actor.role != "admin" or not actor_access or actor_access.status != "ACTIVE":
                fail("Only an active administrator can manage staff.", 403)
            target = PharmacyUser.objects.select_for_update().filter(pk=int(parts[1])).first()
            if not target:
                fail("Staff account not found.", 404)
            if target.pk == actor.pk:
                fail("You cannot change your own role or approval status. Ask another administrator.", 409)
            access, _ = UserAccess.objects.select_for_update().get_or_create(user=target)
            if access.version != integer(data.get("version"), "Version", 1):
                fail("This account changed. Reload the staff list before trying again.", 409)
            before_role, before_status = target.role, access.status
            if action == "approve":
                if access.status not in ("PENDING", "REJECTED"):
                    fail("Only pending or rejected staff can be approved.", 409)
                target.role, access.status = "staff", "ACTIVE"
            elif action == "reject":
                if access.status != "PENDING":
                    fail("Only pending registrations can be rejected.", 409)
                access.status = "REJECTED"
            elif action == "suspend":
                if access.status != "ACTIVE":
                    fail("Only active accounts can be suspended.", 409)
                access.status = "SUSPENDED"
            elif action == "activate":
                if access.status != "SUSPENDED":
                    fail("Only suspended accounts can be reactivated.", 409)
                access.status = "ACTIVE"
            else:
                role = data.get("role")
                if role not in ("staff", "pharmacist", "admin"):
                    fail("Select a valid staff role.")
                if access.status != "ACTIVE":
                    fail("Approve the staff account before assigning a role.", 409)
                if role == target.role:
                    fail("This account already has that role.", 409)
                target.role = role
            if before_role == "admin" and before_status == "ACTIVE" and (target.role != "admin" or access.status != "ACTIVE") and UserAccess.objects.filter(status="ACTIVE", user__role="admin").count() <= 1:
                fail("The last active administrator must be retained.", 409)
            target.save(update_fields=["role", "updated_at"])
            access.version += 1
            access.reviewed_by = actor
            access.reviewed_at = timezone.now()
            access.save()
            audit(actor, f"USER_{action.upper()}", "User", target.pk, json.dumps({"before": {"role": before_role, "status": before_status}, "after": {"role": target.role, "status": access.status}}))
        return response(public_user(target))
    return None


def auxiliary_dispatch(parts, request, user):
    root = parts[0]
    if root == "media":
        if len(parts) == 2 and request.method == "GET":
            try:
                image_id = uuid.UUID(parts[1])
            except ValueError:
                return HttpResponse(status=404)
            image = ImageUpload.objects.filter(pk=image_id).first()
            if not image:
                return HttpResponse(status=404)
            result = HttpResponse(bytes(image.content), content_type=image.content_type)
            result["X-Content-Type-Options"] = "nosniff"
            result["Cache-Control"] = "public, max-age=31536000, immutable"
            result["Content-Security-Policy"] = "default-src 'none'"
            return result
        if parts == ["media"] and request.method == "POST":
            user = user or __import__("pharmacy_api.views", fromlist=["require_user"]).require_user(request)
            data = body(request)
            only_fields(data, {"purpose", "image"})
            purpose, image_data = data.get("purpose"), data.get("image")
            if purpose not in ("medicine", "logo"):
                fail("Choose a valid image purpose.")
            require_permission(user, "settings" if purpose == "logo" else "medicines:write")
            if not isinstance(image_data, str) or len(image_data) > 2_800_000:
                fail("Image must be at most 2 MB.")
            match = re.fullmatch(r"data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})", image_data)
            if not match:
                fail("Select a JPEG, PNG or WebP image.")
            try:
                original = base64.b64decode(match.group(2), validate=True)
            except (binascii.Error, ValueError):
                fail("Select a JPEG, PNG or WebP image.")
            if not original or len(original) > 2 * 1024 * 1024:
                fail("Image must be at most 2 MB.")
            from PIL import Image, ImageOps, UnidentifiedImageError
            try:
                with Image.open(io.BytesIO(original)) as source:
                    if source.format.lower() not in ("png", "jpeg", "webp") or getattr(source, "n_frames", 1) != 1:
                        fail("Use a single-frame JPEG, PNG or WebP image.")
                    if source.width * source.height > 20_000_000:
                        fail("This image could not be decoded. Choose a valid image up to 20 megapixels.")
                    source = ImageOps.exif_transpose(source)
                    source.thumbnail((1200, 1200))
                    output = io.BytesIO()
                    source.convert("RGBA" if source.mode in ("RGBA", "LA") else "RGB").save(output, format="PNG", optimize=True)
                    width, height = source.size
            except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
                fail("This image could not be decoded. Choose a valid image up to 20 megapixels.")
            image = ImageUpload.objects.create(purpose=purpose, content=output.getvalue(), content_type="image/png", width=width, height=height, created_by=user)
            return response({"url": f"/api/media/{image.pk}", "width": width, "height": height}, 201)
        return None

    if root == "settings":
        user = user or __import__("pharmacy_api.views", fromlist=["require_user"]).require_user(request)
        if parts == ["settings", "profile"] and request.method == "GET":
            result = setting_data()
            result.pop("id", None)
            result.pop("version", None)
            return response(result)
        require_permission(user, "settings")
        if parts == ["settings"] and request.method == "GET":
            return response(setting_data())
        if parts == ["settings"] and request.method == "PUT":
            data = body(request)
            allowed = {
                "version", "pharmacy_name", "address", "phone", "email", "logo_url",
                "registration_number", "currency", "low_stock_threshold", "expiry_warning_days",
                "invoice_prefix", "invoice_footer", "alerts_enabled", "alert_expiry_days",
                "alert_stock_quantity", "alert_interval_minutes", "invoice_title",
                "invoice_terms", "invoice_show_logo", "website", "business_hours",
            }
            only_fields(data, allowed)
            version = integer(data.get("version"), "Version", 1)
            fields = {
                "pharmacy_name": text(data.get("pharmacy_name"), "Pharmacy name", 150, True),
                "address": text(data.get("address"), "Address", 1000),
                "phone": text(data.get("phone"), "Phone", 30),
                "email": text(data.get("email"), "Email", 150),
                "registration_number": text(data.get("registration_number"), "Registration number", 150),
                "logo_url": text(data.get("logo_url"), "Logo", 1000),
                "invoice_prefix": text(data.get("invoice_prefix"), "Invoice prefix", 12, True),
                "invoice_footer": text(data.get("invoice_footer"), "Invoice footer", 500),
                "low_stock_threshold": integer(data.get("low_stock_threshold"), "Low-stock threshold", 0, 1_000_000),
                "expiry_warning_days": integer(data.get("expiry_warning_days"), "Expiry warning days", 1, 365),
                "currency": data.get("currency"),
                "invoice_title": text(data.get("invoice_title"), "Invoice title", 60, True),
                "invoice_terms": text(data.get("invoice_terms"), "Invoice terms", 1000),
                "website": text(data.get("website"), "Website", 250),
                "business_hours": text(data.get("business_hours"), "Business hours", 250),
                "alert_expiry_days": integer(data.get("alert_expiry_days"), "Alert expiry days", 1, 365),
                "alert_stock_quantity": integer(data.get("alert_stock_quantity"), "Alert stock quantity", 0, 1_000_000),
                "alert_interval_minutes": integer(data.get("alert_interval_minutes"), "Alert interval minutes", 1, 1440),
            }
            if fields["currency"] != "TZS":
                fail("Accounting currency must remain TZS.")
            if not re.fullmatch(r"[A-Z0-9-]{1,12}", fields["invoice_prefix"]):
                fail("Invoice prefix must use 1 to 12 uppercase letters, digits or hyphens.")
            flags = {}
            for key in ("alerts_enabled", "invoice_show_logo"):
                value = data.get(key)
                if value not in (0, 1, False, True):
                    fail(f"{key.replace('_', ' ')} must be enabled or disabled.")
                flags[key] = bool(value)
            if fields["email"] and not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", fields["email"]):
                fail("Enter a valid email.")
            if fields["logo_url"]:
                match = re.fullmatch(r"/api/media/([0-9a-fA-F-]{36})", fields["logo_url"])
                if match:
                    if not ImageUpload.objects.filter(pk=match.group(1), purpose="logo").exists():
                        fail("The selected logo is unavailable or has the wrong purpose.")
                else:
                    from urllib.parse import urlparse
                    parsed_url = urlparse(fields["logo_url"])
                    if parsed_url.scheme not in ("http", "https") or not parsed_url.netloc or parsed_url.username or parsed_url.password:
                        fail("Logo URL must use HTTP or HTTPS without credentials.")
            if fields["website"]:
                from urllib.parse import urlparse
                parsed_url = urlparse(fields["website"])
                if parsed_url.scheme not in ("http", "https") or not parsed_url.netloc or parsed_url.username or parsed_url.password:
                    fail("Website must be an HTTP or HTTPS URL without credentials.")
            with transaction.atomic():
                settings = PharmacySettings.objects.select_for_update().filter(pk=1).first() or PharmacySettings.objects.create(pk=1)
                if settings.version != version:
                    fail("Settings changed. Reload before saving.", 409)
                preferences, _ = PharmacyPreference.objects.get_or_create(settings=settings)
                for key in ("pharmacy_name", "address", "phone", "email", "registration_number", "logo_url", "invoice_prefix", "invoice_footer", "low_stock_threshold", "expiry_warning_days"):
                    setattr(settings, key, fields[key])
                settings.version += 1
                settings.save()
                for key in ("invoice_title", "invoice_terms", "website", "business_hours", "alert_expiry_days", "alert_stock_quantity", "alert_interval_minutes"):
                    setattr(preferences, key, fields[key])
                preferences.alerts_enabled = flags["alerts_enabled"]
                preferences.invoice_show_logo = flags["invoice_show_logo"]
                preferences.save()
                audit(user, "CHANGED_SETTINGS", "Settings", 1, "Updated pharmacy profile and system settings.")
            return response(setting_data())
        return None

    if root == "audit":
        require_permission(user, "settings")
        if parts == ["audit"] and request.method == "GET":
            page, limit, search = parse_page(request)
            queryset = AuditLog.objects.select_related("user").order_by("-id")
            if search:
                queryset = queryset.filter(Q(action__icontains=search) | Q(entity__icontains=search))
            rows, pagination = paginate(queryset, request)
            return response({"items": [{"id": row.pk, "action": row.action, "entity": row.entity, "entity_id": row.entity_id, "description": row.description, "created_at": row.created_at, "staff": row.user.full_name if row.user_id else None} for row in rows], "pagination": {"total": pagination["total"], "page": pagination["page"], "pages": pagination["pages"]}})
        return None

    if root == "notifications":
        require_permission(user, "notifications")
        if parts == ["notifications"] and request.method == "GET":
            items, alerts = notifications_for(user)
            filter_type = request.GET.get("type", "")
            if filter_type not in ("", "LOW_STOCK", "OUT_OF_STOCK", "EXPIRED", "EXPIRING", "PURCHASE", "APPROVAL", "SYSTEM"):
                fail("Invalid notification type.")
            unread_only = request.GET.get("unread", "false")
            if unread_only not in ("true", "false"):
                fail("Invalid unread filter.")
            read_keys = set(NotificationRead.objects.filter(user=user).values_list("notification_key", flat=True))
            for item in items:
                item["read"] = item["key"] in read_keys
            filtered = [item for item in items if (not filter_type or item["type"] == filter_type) and (unread_only != "true" or not item["read"])]
            page, limit, _ = parse_page(request)
            total = len(filtered)
            return response({"alerts": alerts, "items": filtered[(page - 1) * limit:page * limit], "unread": sum(not item["read"] for item in items), "pagination": {"total": total, "page": page, "pages": max(1, (total + limit - 1) // limit)}})
        if parts == ["notifications", "read"] and request.method == "POST":
            data = body(request)
            only_fields(data, {"key"})
            key = text(data.get("key"), "Notification key", 160, True)
            items, _ = notifications_for(user)
            if key not in {item["key"] for item in items}:
                fail("Notification is no longer available.", 404)
            NotificationRead.objects.get_or_create(user=user, notification_key=key)
            return response({"key": key, "read": True})
        return None

    if root == "reports":
        require_permission(user, "reports")
        if parts == ["reports"] and request.method == "GET":
            return response(report_data(request))
        return None
    return None


def notifications_for(user):
    settings = PharmacySettings.objects.filter(pk=1).first() or PharmacySettings.objects.create(pk=1)
    preferences, _ = PharmacyPreference.objects.get_or_create(settings=settings)
    permissions = permissions_for(user.role)
    items = []
    today = timezone.localdate()
    alerts = {
        "enabled": preferences.alerts_enabled,
        "intervalMinutes": preferences.alert_interval_minutes,
        "expiryDays": preferences.alert_expiry_days,
        "stockQuantity": preferences.alert_stock_quantity,
        "expiredBatches": 0, "expiringBatches": 0, "lowStockMedicines": 0, "outOfStockMedicines": 0,
    }
    if "stock" in permissions or "medicines" in permissions:
        medicines = Medicine.objects.filter(status="ACTIVE").annotate(
            usable=Coalesce(Sum("batches__quantity", filter=Q(batches__expiry_date__gte=today)), Value(0)),
        )
        for medicine in medicines.filter(usable__lte=F("minimum_stock")).order_by("usable", "id")[:100]:
            items.append({"key": f"stock-{medicine.pk}-{medicine.usable}-{medicine.minimum_stock}", "type": "LOW_STOCK" if medicine.usable else "OUT_OF_STOCK", "title": medicine.name, "message": f"{medicine.usable} usable units in stock; minimum {medicine.minimum_stock}.", "path": "/stock" if "stock" in permissions else "/medicines"})
        batches = MedicineBatch.objects.filter(quantity__gt=0, expiry_date__lte=today + timedelta(days=max(settings.expiry_warning_days, preferences.alert_expiry_days))).select_related("medicine").order_by("expiry_date", "id")[:100]
        for batch in batches:
            expired = batch.expiry_date < today
            items.append({"key": f"expiry-{batch.pk}-{batch.expiry_date}-{int(expired)}", "type": "EXPIRED" if expired else "EXPIRING", "title": batch.medicine.name, "message": f"Batch {batch.batch_number}: {batch.quantity} units, expiry {batch.expiry_date}.", "path": "/stock" if "stock" in permissions else "/medicines"})
        alerts["outOfStockMedicines"] = medicines.filter(usable=0).count()
        alerts["lowStockMedicines"] = medicines.filter(usable__gt=0, usable__lte=preferences.alert_stock_quantity).count()
        alerts["expiredBatches"] = MedicineBatch.objects.filter(quantity__gt=0, expiry_date__lt=today).count()
        alerts["expiringBatches"] = MedicineBatch.objects.filter(quantity__gt=0, expiry_date__range=(today, today + timedelta(days=preferences.alert_expiry_days))).count()
    if "purchases" in permissions:
        for purchase in Purchase.objects.order_by("-id")[:30]:
            items.append({"key": f"purchase-{purchase.pk}", "type": "PURCHASE", "title": "Purchase completed", "message": purchase.purchase_number, "path": "/purchases", "date": purchase.created_at})
    if "users" in permissions:
        for access in UserAccess.objects.filter(status="PENDING").select_related("user").order_by("-user_id")[:30]:
            items.append({"key": f"approval-{access.user_id}", "type": "APPROVAL", "title": "Staff approval required", "message": access.user.full_name, "path": "/users"})
        for entry in AuditLog.objects.order_by("-id")[:30]:
            items.append({"key": f"audit-{entry.pk}", "type": "SYSTEM", "title": entry.action.replace("_", " "), "message": entry.entity, "path": "/settings", "date": entry.created_at})
    return items, alerts


def report_data(request):
    page, limit, _ = parse_page(request)
    today = timezone.localdate()
    start = parse_date(request.GET.get("from", today.isoformat()), "Start date")
    end = parse_date(request.GET.get("to", today.isoformat()), "End date")
    if start > end:
        fail("Start date must be on or before end date.")
    kind = request.GET.get("type", "transactions")
    if kind == "transactions":
        sales = Sale.objects.filter(sale_date__range=(start, end))
        purchases = Purchase.objects.filter(purchase_date__range=(start, end))
        entries = [
            {"reference": row.invoice_number, "transaction_type": "SALE", "date": row.sale_date, "customer_or_supplier": row.customer_name or "Walk-in", "total_amount": str(row.total_amount), "amount_paid": str(row.amount_paid), "payment_status": "PAID", "staff": row.created_by.full_name}
            for row in sales.select_related("created_by")
        ] + [
            {"reference": row.purchase_number, "transaction_type": "PURCHASE", "date": row.purchase_date, "customer_or_supplier": row.supplier_name, "total_amount": str(row.total_amount), "amount_paid": str(row.amount_paid), "payment_status": row.payment_status, "staff": row.created_by.full_name}
            for row in purchases.select_related("created_by")
        ]
        entries.sort(key=lambda row: (row["date"], row["transaction_type"], row["reference"]), reverse=True)
        summary = {
            "sales": {"records": sales.count(), "total_amount": str(sales.aggregate(total=Coalesce(Sum("total_amount"), Value(Decimal("0.00"))))["total"])},
            "purchases": {"records": purchases.count(), "total_amount": str(purchases.aggregate(total=Coalesce(Sum("total_amount"), Value(Decimal("0.00"))))["total"])},
        }
    elif kind == "sales":
        entries = [{"invoice_number": row.invoice_number, "date": row.sale_date, "customer_name": row.customer_name, "subtotal": str(row.subtotal), "discount": str(row.discount), "total_amount": str(row.total_amount), "payment_method": row.payment_method, "staff": row.created_by.full_name} for row in Sale.objects.filter(sale_date__range=(start, end)).select_related("created_by").order_by("-sale_date", "-id")]
        summary = None
    elif kind == "purchases":
        entries = [{"purchase_number": row.purchase_number, "date": row.purchase_date, "supplier_name": row.supplier_name, "total_amount": str(row.total_amount), "amount_paid": str(row.amount_paid), "payment_status": row.payment_status} for row in Purchase.objects.filter(purchase_date__range=(start, end)).order_by("-purchase_date", "-id")]
        summary = None
    elif kind in ("stock", "low_stock"):
        entries = []
        for medicine in Medicine.objects.filter(status="ACTIVE").select_related("category").annotate(quantity=Coalesce(Sum("batches__quantity"), Value(0))):
            if kind == "low_stock" and medicine.quantity > medicine.minimum_stock:
                continue
            expired = medicine.batches.filter(expiry_date__lt=today).aggregate(total=Coalesce(Sum("quantity"), Value(0)))["total"]
            entries.append({"medicine": medicine.name, "category": medicine.category.name if medicine.category else "Uncategorized", "quantity": medicine.quantity, "minimum_stock": medicine.minimum_stock, "expired_units": expired})
        summary = None
    elif kind == "expiry":
        entries = [{"medicine": row.medicine.name, "batch_number": row.batch_number, "quantity": row.quantity, "expiry_date": row.expiry_date} for row in MedicineBatch.objects.filter(quantity__gt=0, expiry_date__lte=today + timedelta(days=90)).select_related("medicine").order_by("expiry_date", "id")]
        summary = None
    elif kind == "suppliers":
        entries = []
        for supplier in Supplier.objects.all().order_by("name"):
            group = supplier.purchases.filter(purchase_date__range=(start, end))
            if group.exists():
                total = group.aggregate(value=Coalesce(Sum("total_amount"), Value(Decimal("0.00"))))["value"]
                outstanding = group.aggregate(value=Coalesce(Sum(F("total_amount") - F("amount_paid")), Value(Decimal("0.00"))))["value"]
                entries.append({"supplier_id": supplier.pk, "supplier_name": supplier.name, "purchases": group.count(), "total_amount": str(total), "outstanding_balance": str(outstanding)})
        summary = None
    elif kind == "medicines":
        rows = SaleItem.objects.filter(sale__sale_date__range=(start, end)).values("medicine_id", "medicine_name").annotate(quantity=Sum("quantity"), revenue_before_discount=Sum("subtotal")).order_by("medicine_name")
        entries = [{**row, "revenue_before_discount": str(row["revenue_before_discount"])} for row in rows]
        summary = None
    elif kind == "profit":
        lines = SaleItem.objects.filter(sale__sale_date__range=(start, end))
        revenue = Sale.objects.filter(sale_date__range=(start, end)).aggregate(value=Coalesce(Sum("total_amount"), Value(Decimal("0.00"))))["value"]
        cost = sum((row.unit_cost * row.quantity for row in lines), Decimal("0.00"))
        entries = [{"net_sales": str(revenue), "cost_of_goods": str(cost), "gross_profit": str(revenue - cost)}]
        summary = None
    else:
        fail("Select a valid report.")
    total = len(entries)
    return {"items": entries[(page - 1) * limit:page * limit], **({"summary": summary} if summary is not None else {}), "pagination": {"total": total, "page": page, "pages": max(1, (total + limit - 1) // limit)}, "from": start, "to": end}
