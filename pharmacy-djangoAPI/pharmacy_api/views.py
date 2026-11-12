import hashlib
import json
import logging
import re
import uuid
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

from django.contrib.auth.hashers import check_password, make_password
from django.db import IntegrityError, transaction
from django.db.models import Case, Count, F, IntegerField, Q, Sum, Value, When
from django.db.models.functions import Coalesce
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from .auth import issue_token, permissions_for
from .models import (
    AuditLog,
    Category,
    Medicine,
    MedicineBatch,
    MedicineCreationRequest,
    PharmacyPreference,
    PharmacySettings,
    PharmacyUser,
    StockMovement,
    UserAccess,
)

logger = logging.getLogger(__name__)


class ApiError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def fail(message, status=400):
    raise ApiError(message, status)


def response(data, status=200):
    result = JsonResponse({"data": data}, status=status, safe=False)
    result["Cache-Control"] = "no-store"
    return result


def body(request):
    try:
        value = json.loads(request.body or b"{}")
    except (UnicodeDecodeError, json.JSONDecodeError):
        fail("A valid JSON object is required.")
    if not isinstance(value, dict):
        fail("A JSON object is required.")
    return value


def only_fields(data, allowed):
    if not isinstance(data, dict):
        fail("A JSON object is required.")
    extra = set(data) - set(allowed)
    if extra:
        fail(f"Unexpected field: {sorted(extra)[0]}.")


def text(value, name, maximum, required=False):
    if value is None and not required:
        return None
    if not isinstance(value, str):
        fail(f"{name} must be text.")
    value = value.strip()
    if (required and not value) or len(value) > maximum:
        fail(f"{name} is required and must be at most {maximum} characters.")
    return value or None


def integer(value, name, minimum=0, maximum=2147483647):
    if isinstance(value, bool) or not re.fullmatch(r"[0-9]+", str(value or "")):
        fail(f"{name} must be a whole number between {minimum} and {maximum}.")
    parsed = int(value)
    if not minimum <= parsed <= maximum:
        fail(f"{name} must be a whole number between {minimum} and {maximum}.")
    return parsed


def money(value, name, max_whole_digits=10):
    if not re.fullmatch(rf"(0|[1-9][0-9]{{0,{max_whole_digits - 1}}})(\.[0-9]{{1,2}})?", str(value)):
        fail(f"{name} must be a non-negative price with at most two decimal places.")
    try:
        return Decimal(value).quantize(Decimal("0.01"))
    except InvalidOperation:
        fail(f"{name} must be a valid amount.")


def parse_date(value, name):
    if not isinstance(value, str):
        fail(f"{name} must be a valid date.")
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        fail(f"{name} must be a valid date.")
    if parsed.isoformat() != value or value < "1900-01-01":
        fail(f"{name} must be a valid date.")
    return parsed


def parse_page(request, maximum=100):
    page = integer(request.GET.get("page", 1), "Page", 1, 1_000_000)
    limit = integer(request.GET.get("limit", 10), "Page size", 1, maximum)
    search = text(request.GET.get("search", ""), "Search", 150) or ""
    return page, limit, search


def paginate(queryset, request):
    page, limit, _ = parse_page(request)
    total = queryset.count()
    items = list(queryset[(page - 1) * limit:page * limit])
    return items, {"total": total, "page": page, "limit": limit, "pages": max(1, (total + limit - 1) // limit)}


def require_user(request):
    user = getattr(request, "pharmacy_user", None)
    if user:
        return user
    if request.headers.get("Authorization", "").startswith("Bearer "):
        fail("Token is invalid or has expired.", 401)
    fail("No token provided. Please login first.", 401)


def require_permission(user, permission):
    if permission not in permissions_for(user.role):
        fail("You do not have permission to access this module.", 403)


def public_user(user):
    try:
        access = user.access
    except UserAccess.DoesNotExist:
        access = None
    return {
        "id": user.pk,
        "full_name": user.full_name,
        "email": user.email,
        "phone": user.phone,
        "role": user.role,
        "created_at": user.created_at,
        "status": access.status if access else "PENDING",
        "version": access.version if access else 1,
        "reviewed_by": access.reviewed_by_id if access else None,
        "reviewed_at": access.reviewed_at if access else None,
    }


def audit(user, action, entity, entity_id, description):
    AuditLog.objects.create(user=user, action=action, entity=entity, entity_id=entity_id, description=description)


def ensure_settings():
    settings, _ = PharmacySettings.objects.get_or_create(pk=1)
    PharmacyPreference.objects.get_or_create(settings=settings)
    return settings


def setting_data():
    settings = ensure_settings()
    preferences = settings.preferences
    return {
        "id": settings.pk,
        "version": settings.version,
        "pharmacy_name": settings.pharmacy_name,
        "address": settings.address,
        "phone": settings.phone,
        "email": settings.email,
        "logo_url": settings.logo_url,
        "registration_number": settings.registration_number,
        "currency": settings.currency,
        "low_stock_threshold": settings.low_stock_threshold,
        "expiry_warning_days": settings.expiry_warning_days,
        "invoice_prefix": settings.invoice_prefix,
        "invoice_footer": settings.invoice_footer,
        "alerts_enabled": preferences.alerts_enabled,
        "alert_expiry_days": preferences.alert_expiry_days,
        "alert_stock_quantity": preferences.alert_stock_quantity,
        "alert_interval_minutes": preferences.alert_interval_minutes,
        "invoice_title": preferences.invoice_title,
        "invoice_terms": preferences.invoice_terms,
        "invoice_show_logo": preferences.invoice_show_logo,
        "website": preferences.website,
        "business_hours": preferences.business_hours,
    }


def medicine_queryset():
    today = timezone.localdate()
    return Medicine.objects.select_related("category").annotate(
        quantity=Coalesce(Sum("batches__quantity"), Value(0)),
        usable_quantity=Coalesce(Sum(Case(When(batches__expiry_date__gte=today, then=F("batches__quantity")), default=Value(0), output_field=IntegerField())), Value(0)),
    )


def medicine_data(medicine, detail=False):
    today = timezone.localdate()
    if hasattr(medicine, "quantity"):
        quantity = medicine.quantity
        usable_quantity = medicine.usable_quantity
    else:
        quantity = medicine.batches.aggregate(value=Coalesce(Sum("quantity"), Value(0)))["value"]
        usable_quantity = medicine.batches.filter(expiry_date__gte=today).aggregate(value=Coalesce(Sum("quantity"), Value(0)))["value"]
    expiry_date = medicine.batches.filter(quantity__gt=0).order_by("expiry_date").values_list("expiry_date", flat=True).first()
    from .models import MedicineImage

    image = MedicineImage.objects.filter(medicine=medicine).select_related("image").first()
    image_url = f"/api/media/{image.image_id}" if image else None
    result = {
        "id": medicine.pk,
        "name": medicine.name,
        "generic_name": medicine.generic_name,
        "brand_name": medicine.brand_name,
        "category_id": medicine.category_id,
        "category_name": medicine.category.name if medicine.category_id else None,
        "medicine_type": medicine.medicine_type,
        "description": medicine.description,
        "manufacturer": medicine.manufacturer,
        "barcode": medicine.barcode,
        "purchase_price": str(medicine.purchase_price),
        "selling_price": str(medicine.selling_price),
        "minimum_stock": medicine.minimum_stock,
        "storage_location": medicine.storage_location,
        "status": medicine.status,
        "version": medicine.version,
        "created_by": medicine.created_by_id,
        "updated_by": medicine.updated_by_id,
        "created_at": medicine.created_at,
        "updated_at": medicine.updated_at,
        "quantity": quantity,
        "usable_quantity": usable_quantity,
        "expiry_date": expiry_date,
        "image_url": image_url,
    }
    if detail:
        result["batches"] = [{
            "id": batch.pk,
            "batch_number": batch.batch_number,
            "expiry_date": batch.expiry_date,
            "quantity": batch.quantity,
            "purchase_price": str(batch.purchase_price),
        } for batch in medicine.batches.order_by("expiry_date", "id")]
        result["suppliers"] = [
            {"id": row["purchase__supplier_id"], "name": row["purchase__supplier_name"]}
            for row in medicine.purchaseitem_set.values("purchase__supplier_id", "purchase__supplier_name").distinct()
        ]
        result["opening_stock_movements"] = list(StockMovement.objects.filter(medicine=medicine, reference=f"OPENING-{medicine.pk}", type="ADJUSTMENT").values("quantity", "previous_stock", "new_stock", "reference", "reason", "created_at", staff=F("created_by__full_name")))
    return result


def category_data(category):
    return {
        "id": category.pk,
        "name": category.name,
        "description": category.description,
        "status": category.status,
        "version": category.version,
        "created_at": category.created_at,
        "updated_at": category.updated_at,
        "medicine_count": getattr(category, "medicine_count", category.medicines.filter(status="ACTIVE").count()),
    }


def catalog_list(resource, request):
    page, limit, search = parse_page(request)
    status = request.GET.get("status", "")
    sort = request.GET.get("sort", "name")
    direction = request.GET.get("direction", "asc")
    if direction not in ("asc", "desc"):
        fail("Invalid sort direction.")
    if resource == "medicines":
        allowed_sort = {"name": "name", "selling_price": "selling_price", "quantity": "quantity", "created_at": "created_at"}
        if status not in ("", "ACTIVE", "ARCHIVED"):
            fail("Invalid status filter.")
        stock = request.GET.get("stock", "")
        expiry = request.GET.get("expiry", "")
        if stock not in ("", "low", "out", "in"):
            fail("Invalid stock filter.")
        if expiry not in ("", "expired", "30", "60", "90"):
            fail("Invalid expiry filter.")
        queryset = medicine_queryset()
        if search:
            queryset = queryset.filter(Q(name__icontains=search) | Q(generic_name__icontains=search) | Q(brand_name__icontains=search) | Q(barcode__icontains=search))
        if status:
            queryset = queryset.filter(status=status)
        if request.GET.get("category"):
            queryset = queryset.filter(category_id=integer(request.GET["category"], "Category", 1))
        if stock == "low":
            queryset = queryset.filter(quantity__lte=F("minimum_stock"))
        elif stock == "out":
            queryset = queryset.filter(quantity=0)
        elif stock == "in":
            queryset = queryset.filter(quantity__gt=F("minimum_stock"))
        if expiry == "expired":
            queryset = queryset.filter(batches__quantity__gt=0, batches__expiry_date__lt=timezone.localdate()).distinct()
        elif expiry:
            queryset = queryset.filter(batches__quantity__gt=0, batches__expiry_date__range=(timezone.localdate(), timezone.localdate() + timedelta(days=int(expiry)))).distinct()
        order = allowed_sort.get(sort)
        if not order:
            fail("Invalid sort field.")
        queryset = queryset.order_by(("-" if direction == "desc" else "") + order, "id")
        total = queryset.count()
        data = [medicine_data(row) for row in queryset[(page - 1) * limit:page * limit]]
    else:
        if status not in ("", "ACTIVE", "INACTIVE"):
            fail("Invalid status filter.")
        order = {"name": "name", "created_at": "created_at"}.get(sort)
        if not order:
            fail("Invalid sort field.")
        queryset = Category.objects.annotate(medicine_count=Count("medicines", filter=Q(medicines__status="ACTIVE")))
        if search:
            queryset = queryset.filter(name__icontains=search)
        if status:
            queryset = queryset.filter(status=status)
        queryset = queryset.order_by(("-" if direction == "desc" else "") + order, "id")
        total = queryset.count()
        data = [category_data(row) for row in queryset[(page - 1) * limit:page * limit]]
    return {"items": data, "pagination": {"total": total, "page": page, "limit": limit, "pages": max(1, (total + limit - 1) // limit)}}


def catalog_save(resource, request, user, record_id=None):
    data = body(request)
    editing = record_id is not None
    allowed = {"name", "description"} | ({"version"} if editing else set())
    if resource == "medicines":
        allowed |= {"generic_name", "brand_name", "category_id", "medicine_type", "manufacturer", "barcode", "purchase_price", "selling_price", "minimum_stock", "storage_location", "image_url"}
        if not editing:
            allowed |= {"opening_stock", "request_key"}
    only_fields(data, allowed)
    name = text(data.get("name"), "Name", 150, True)
    description = text(data.get("description"), "Description", 5000)
    values = {"name": name, "description": description}
    if resource == "medicines":
        for field in ("generic_name", "brand_name", "manufacturer", "storage_location", "barcode"):
            values[field] = text(data.get(field), field.replace("_", " "), 150 if field != "barcode" else 100)
        values["category_id"] = integer(data["category_id"], "Category", 1) if data.get("category_id") not in (None, "") else None
        values["medicine_type"] = data.get("medicine_type", "Other")
        if values["medicine_type"] not in Medicine.Type.values:
            fail("Select a valid medicine type.")
        values["purchase_price"] = money(data.get("purchase_price", "0"), "Purchase price")
        values["selling_price"] = money(data.get("selling_price", "0"), "Selling price")
        values["minimum_stock"] = integer(data.get("minimum_stock", 10), "Minimum stock")
    version = integer(data.get("version"), "Version", 1) if editing else None
    opening = data.get("opening_stock")
    if opening is not None:
        require_permission(user, "medicines:opening-stock")
        if resource != "medicines" or editing or not isinstance(opening, dict):
            fail("Opening stock is only allowed when creating a medicine.")
        only_fields(opening, {"quantity", "batch_number", "expiry_date"})
        opening = {
            "quantity": integer(opening.get("quantity"), "Opening quantity", 1, 1_000_000),
            "batch_number": text(opening.get("batch_number"), "Batch number", 100, True),
            "expiry_date": parse_date(opening.get("expiry_date"), "Expiry date"),
        }
        if opening["expiry_date"] < timezone.localdate():
            fail("Opening stock cannot include an expired batch.")
        try:
            request_key = uuid.UUID(str(data.get("request_key")))
        except (ValueError, TypeError, AttributeError):
            fail("A valid request key is required for opening stock.")
        request_hash = hashlib.sha256(json.dumps(data, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        previous = MedicineCreationRequest.objects.filter(pk=request_key).select_related("medicine").first()
        if previous:
            if previous.user_id != user.pk or previous.request_hash != request_hash:
                fail("This form was already submitted with different details. Check the medicine list before starting again.", 409)
            return medicine_data(previous.medicine, True)
    elif data.get("request_key") is not None:
        fail("A request key is only used when adding opening stock.")

    with transaction.atomic():
        if editing:
            model = Medicine if resource == "medicines" else Category
            try:
                record = model.objects.select_for_update().get(pk=record_id)
            except model.DoesNotExist:
                fail("Record not found.", 404)
            if record.version != version:
                fail("This record was changed by another user. Close the form and reload before editing.", 409)
            if record.status != "ACTIVE":
                fail("Restore or activate this record before editing.", 409)
        if resource == "medicines":
            if values["category_id"]:
                category = Category.objects.filter(pk=values["category_id"], status="ACTIVE").first()
                if not category:
                    fail("Select an active category.", 409)
            if editing:
                for key, value in values.items():
                    setattr(record, key, value)
                record.updated_by = user
                record.version += 1
                record.save()
                saved = record
            else:
                saved = Medicine.objects.create(**values, created_by=user, updated_by=user)
            if opening:
                batch = MedicineBatch.objects.create(medicine=saved, **opening, purchase_price=values["purchase_price"])
                StockMovement.objects.create(medicine=saved, batch=batch, type="ADJUSTMENT", quantity=opening["quantity"], previous_stock=0, new_stock=opening["quantity"], reference=f"OPENING-{saved.pk}", reason="Opening stock: existing shelf inventory recorded when medicine was created", created_by=user)
                MedicineCreationRequest.objects.create(request_key=request_key, request_hash=request_hash, user=user, medicine=saved)
                audit(user, "OPENING_STOCK", "Medicine", saved.pk, json.dumps({"quantity": opening["quantity"], "batch_number": opening["batch_number"], "expiry_date": opening["expiry_date"].isoformat()}))
            audit(user, "UPDATED_MEDICINES" if editing else "CREATED_MEDICINES", "medicines", saved.pk, "Catalog record saved.")
            if data.get("image_url") is not None:
                set_medicine_image(saved, data["image_url"])
            return medicine_data(medicine_queryset().get(pk=saved.pk), True)
        if editing:
            record.name, record.description = name, description
            record.version += 1
            record.save()
            saved = record
        else:
            saved = Category.objects.create(name=name, description=description)
        audit(user, "UPDATED_CATEGORIES" if editing else "CREATED_CATEGORIES", "categories", saved.pk, "Catalog record saved.")
        return category_data(saved)


def set_medicine_image(medicine, image_url):
    from .models import ImageUpload, MedicineImage

    if not image_url:
        MedicineImage.objects.filter(medicine=medicine).delete()
        return
    match = re.fullmatch(r"/api/media/([0-9a-fA-F-]{36})", image_url)
    if not match:
        fail("Select an uploaded medicine image.")
    image = ImageUpload.objects.filter(pk=match.group(1), purpose="medicine").first()
    if not image:
        fail("Uploaded medicine image was not found.", 404)
    MedicineImage.objects.update_or_create(medicine=medicine, defaults={"image": image})


def catalog_status(resource, record_id, request, user, active):
    data = body(request)
    only_fields(data, {"version"})
    version = integer(data.get("version"), "Version", 1)
    with transaction.atomic():
        model = Medicine if resource == "medicines" else Category
        try:
            record = model.objects.select_for_update().get(pk=record_id)
        except model.DoesNotExist:
            fail("Record not found.", 404)
        if record.version != version:
            fail("This record changed. Reload before trying again.", 409)
        if resource == "medicines":
            if not active and record.batches.aggregate(total=Coalesce(Sum("quantity"), Value(0)))["total"]:
                fail("A medicine with stock cannot be archived. Use stock transactions first.", 409)
            if active and record.category_id and record.category.status != "ACTIVE":
                fail("Select an active category.", 409)
            record.status = "ACTIVE" if active else "ARCHIVED"
            record.updated_by = user
        else:
            if not active and record.medicines.filter(status="ACTIVE").exists():
                fail("Move or archive the active medicines in this category before deactivating it.", 409)
            record.status = "ACTIVE" if active else "INACTIVE"
        record.version += 1
        record.save()
        audit(user, "CHANGED_CATALOG_STATUS", resource, record.pk, "Activated" if active else "Archived or deactivated")
    return medicine_data(medicine_queryset().get(pk=record_id), True) if resource == "medicines" else category_data(record)


def auth_dispatch(parts, request):
    if parts == ["auth", "register"] and request.method == "POST":
        data = body(request)
        full_name = text(data.get("fullName"), "Name", 150, True)
        email = text(data.get("email"), "Email", 150, True).lower()
        phone = text(data.get("phone"), "Phone", 30, True)
        password = data.get("password")
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
            fail("Use a valid email, a name up to 150 characters, a phone up to 30 characters, and a password of at least 6 characters (maximum 72 bytes).")
        if not isinstance(password, str) or len(password) < 6 or len(password.encode("utf-8")) > 72:
            fail("Use a valid email, a name up to 150 characters, a phone up to 30 characters, and a password of at least 6 characters (maximum 72 bytes).")
        if PharmacyUser.objects.filter(email=email).exists():
            fail("This email is already registered. Sign in with your existing password.", 409)
        with transaction.atomic():
            user = PharmacyUser.objects.create(full_name=full_name, email=email, phone=phone, password=make_password(password))
            UserAccess.objects.create(user=user, status=UserAccess.Status.PENDING)
            audit(user, "STAFF_REGISTERED", "User", user.pk, "Staff account registered; awaiting administrator approval.")
        return JsonResponse({"message": "Registration submitted. An administrator must approve your account before you can sign in.", "user": public_user(user)}, status=201)
    if parts == ["auth", "login"] and request.method == "POST":
        data = body(request)
        email = text(data.get("email"), "Email", 150, True).lower()
        password = data.get("password")
        if not isinstance(password, str) or not password:
            fail("Please fill in all fields.")
        user = PharmacyUser.objects.filter(email=email).first()
        if not user or not check_password(password, user.password):
            fail("Invalid email or password.", 401)
        try:
            state = user.access.status
        except UserAccess.DoesNotExist:
            state = "PENDING"
        if state != "ACTIVE":
            messages = {"PENDING": "Your registration is awaiting administrator approval.", "REJECTED": "Your registration was not approved. Contact your administrator.", "SUSPENDED": "Your account is suspended. Contact your administrator."}
            return JsonResponse({"message": messages.get(state, "Your account requires administrator approval."), "code": "ACCOUNT_INACTIVE"}, status=403)
        return JsonResponse({"message": "Login successful.", "token": issue_token(user), "user": public_user(user)})
    if parts == ["auth", "me"] and request.method == "GET":
        user = require_user(request)
        result = JsonResponse({"user": public_user(user), "permissions": permissions_for(user.role)})
        result["Cache-Control"] = "no-store"
        return result
    return None


def catalog_dispatch(parts, request):
    if parts[0] not in ("medicines", "categories"):
        return None
    user = require_user(request)
    resource = parts[0]
    require_permission(user, resource)
    if resource == "medicines" and parts == ["medicines", "options"] and request.method == "GET":
        return response({
            "categories": list(Category.objects.filter(status="ACTIVE").order_by("name", "id").values("id", "name")),
            "medicineTypes": list(Medicine.Type.values),
            "defaults": setting_data(),
        })
    if len(parts) == 1 and request.method == "GET":
        return response(catalog_list(resource, request))
    if len(parts) == 1 and request.method == "POST":
        require_permission(user, f"{resource}:write")
        return response(catalog_save(resource, request, user), 201)
    if len(parts) == 2 and parts[1].isdigit() and request.method == "GET":
        model = Medicine if resource == "medicines" else Category
        try:
            record = model.objects.get(pk=int(parts[1]))
        except model.DoesNotExist:
            fail("Record not found.", 404)
        return response(medicine_data(record, True) if resource == "medicines" else category_data(record))
    if len(parts) == 2 and parts[1].isdigit() and request.method == "PUT":
        require_permission(user, f"{resource}:write")
        return response(catalog_save(resource, request, user, int(parts[1])))
    if len(parts) == 3 and parts[1].isdigit() and request.method == "PATCH":
        require_permission(user, f"{resource}:archive")
        action = parts[2]
        active = action in ("restore", "activate")
        expected = ("archive", "restore") if resource == "medicines" else ("deactivate", "activate")
        if action in expected:
            return response(catalog_status(resource, int(parts[1]), request, user, active))
    return None


def dashboard(user):
    require_permission(user, "dashboard")
    settings = setting_data()
    today = timezone.localdate()
    permissions = permissions_for(user.role)
    inventory = list(medicine_queryset().filter(status="ACTIVE"))
    available = lambda module: {"status": "not_configured" if module in permissions else "restricted"}
    stats = {
        key: {"value": None, **available(module)}
        for key, module in {
            "totalMedicines": "medicines", "lowStockMedicines": "stock", "expiredMedicines": "stock",
            "totalSuppliers": "suppliers", "todaySales": "sales", "todayPurchases": "purchases",
            "totalCustomers": "customers", "pendingPrescriptions": "prescriptions",
        }.items()
    }
    active = [row for row in inventory]
    low = sum(row.quantity <= row.minimum_stock for row in active)
    out = sum(row.quantity == 0 for row in active)
    expired = sum(row.batches.filter(quantity__gt=0, expiry_date__lt=today).exists() for row in active)
    expiring = sum(row.batches.filter(quantity__gt=0, expiry_date__range=(today, today + timedelta(days=settings["expiry_warning_days"]))).exists() for row in active)
    if "medicines" in permissions:
        stats["totalMedicines"] = {"value": len(active), "status": "ready"}
    if "stock" in permissions:
        stats["lowStockMedicines"] = {"value": low, "status": "ready"}
        stats["expiredMedicines"] = {"value": expired, "status": "ready"}

    from .models import Customer, Prescription, Purchase, Sale, Supplier
    sales_overview = {"status": "restricted" if "sales" not in permissions else "ready", "points": []}
    recent_sales = {"status": "restricted" if "sales" not in permissions else "ready", "items": []}
    if "suppliers" in permissions:
        stats["totalSuppliers"] = {"value": Supplier.objects.filter(status="ACTIVE").count(), "status": "ready"}
    if "purchases" in permissions:
        amount = Purchase.objects.filter(purchase_date=today).aggregate(value=Coalesce(Sum("total_amount"), Value(Decimal("0.00"))))["value"]
        stats["todayPurchases"] = {"value": str(amount), "status": "ready"}
    if "customers" in permissions:
        stats["totalCustomers"] = {"value": Customer.objects.count(), "status": "ready"}
    if "prescriptions" in permissions:
        stats["pendingPrescriptions"] = {"value": Prescription.objects.filter(status__in=("PENDING", "PARTIALLY_DISPENSED")).count(), "status": "ready"}
    if "sales" in permissions:
        sales = Sale.objects.filter(sale_date__range=(today - timedelta(days=29), today))
        total = sales.filter(sale_date=today).aggregate(value=Coalesce(Sum("total_amount"), Value(Decimal("0.00"))))["value"]
        stats["todaySales"] = {"value": str(total), "status": "ready"}
        points = sales.values("sale_date").annotate(amount=Sum("total_amount")).order_by("sale_date")
        sales_overview["points"] = [{"date": row["sale_date"], "amount": str(row["amount"])} for row in points]
        recent_sales["items"] = [{"id": sale.pk, "invoice": sale.invoice_number, "customer": sale.customer_name or "Walk-in", "amount": str(sale.total_amount), "paymentStatus": "PAID", "date": sale.sale_date, "staff": sale.created_by.full_name} for sale in Sale.objects.select_related("created_by").order_by("-id")[:8]]
    if "stock" in permissions:
        low_rows = sorted((row for row in active if row.quantity <= row.minimum_stock), key=lambda row: (row.quantity, row.id))[:8]
        low_items = [{"id": row.pk, "medicine": row.name, "category": row.category.name if row.category else "Uncategorized", "currentStock": row.quantity, "minimumStock": row.minimum_stock, "status": "Out of stock" if row.quantity == 0 else "Low stock"} for row in low_rows]
        stock_overview = {"status": "ready", "inStock": sum(row.quantity > row.minimum_stock for row in active), "lowStock": low - out, "outOfStock": out, "expiringSoon": expiring, "expiryWarningDays": settings["expiry_warning_days"]}
        low_stock = {"status": "ready", "items": low_items}
    else:
        stock_overview = {"status": "restricted", "inStock": None, "lowStock": None, "outOfStock": None, "expiringSoon": None}
        low_stock = {"status": "restricted", "items": []}
    activities = {"status": "restricted", "items": []}
    if "users" in permissions:
        activities = {"status": "ready", "items": [{"id": f"audit-{row.pk}", "action": row.action.replace("_", " "), "entity": row.entity, "entityId": row.entity_id, "occurredAt": row.created_at, "description": f"{row.entity} record updated."} for row in AuditLog.objects.order_by("-id")[:8]]}
    notification_data = {"status": "restricted", "items": []}
    if "notifications" in permissions:
        from .operations import notifications_for
        items, _ = notifications_for(user)
        read_keys = set(__import__("pharmacy_api.models", fromlist=["NotificationRead"]).NotificationRead.objects.filter(user=user).values_list("notification_key", flat=True))
        for item in items:
            item["read"] = item["key"] in read_keys
        notification_data = {"status": "ready", "items": items[:5], "unread": sum(not item["read"] for item in items)}
    return {
        "generatedAt": timezone.now().isoformat(), "currency": "TZS", "timezone": "Africa/Dar_es_Salaam",
        "permissions": permissions, "stats": stats, "salesOverview": sales_overview,
        "stockOverview": stock_overview, "recentSales": recent_sales, "lowStockMedicines": low_stock,
        "recentActivities": activities, "notifications": notification_data,
    }


@csrf_exempt
def api_dispatch(request, route=""):
    parts = [part for part in route.strip("/").split("/") if part]
    if not parts:
        return JsonResponse({"message": "Pharmacy System API is running successfully."})
    try:
        if parts[0] == "auth":
            result = auth_dispatch(parts, request)
            if result is not None:
                return result
        if parts[0] == "dashboard" and request.method == "GET":
            return response(dashboard(require_user(request)))
        result = catalog_dispatch(parts, request)
        if result is not None:
            return result
        if parts[0] == "media" and len(parts) == 2 and request.method == "GET":
            from .operations import auxiliary_dispatch
            result = auxiliary_dispatch(parts, request, None)
            if result is not None:
                return result
        user = require_user(request)
        from .operations import operations_dispatch
        result = operations_dispatch(parts, request, user)
        if result is not None:
            return result
        return JsonResponse({"message": "Route not found."}, status=404)
    except ApiError as error:
        return JsonResponse({"message": str(error)}, status=error.status)
    except IntegrityError:
        return JsonResponse({"message": "This request conflicts with an existing record."}, status=409)
    except Exception:
        logger.exception("Unhandled pharmacy API error on %s %s", request.method, request.path)
        return JsonResponse({"message": "Server error. Try again."}, status=500)
