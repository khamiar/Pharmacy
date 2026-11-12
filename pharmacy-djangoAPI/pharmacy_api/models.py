import uuid

from django.db import models
from django.db.models import Q


class PharmacyUser(models.Model):
    class Role(models.TextChoices):
        ADMIN = "admin", "Administrator"
        PHARMACIST = "pharmacist", "Pharmacist"
        STAFF = "staff", "Staff"

    full_name = models.CharField(max_length=150)
    email = models.EmailField(max_length=150, unique=True)
    phone = models.CharField(max_length=30)
    password = models.CharField(max_length=255)
    role = models.CharField(max_length=24, choices=Role.choices, default=Role.STAFF)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]


class UserAccess(models.Model):
    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        ACTIVE = "ACTIVE", "Active"
        REJECTED = "REJECTED", "Rejected"
        SUSPENDED = "SUSPENDED", "Suspended"

    user = models.OneToOneField(PharmacyUser, primary_key=True, on_delete=models.PROTECT, related_name="access")
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.PENDING)
    version = models.PositiveIntegerField(default=1)
    reviewed_by = models.ForeignKey(PharmacyUser, null=True, blank=True, on_delete=models.PROTECT, related_name="reviewed_accounts")
    reviewed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class AdministrationLock(models.Model):
    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)


class AuditLog(models.Model):
    user = models.ForeignKey(PharmacyUser, null=True, blank=True, on_delete=models.PROTECT, related_name="audit_entries")
    action = models.CharField(max_length=100)
    entity = models.CharField(max_length=100)
    entity_id = models.IntegerField()
    description = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-id"]
        indexes = [models.Index(fields=["entity", "entity_id", "created_at"])]


class Category(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "Active"
        INACTIVE = "INACTIVE", "Inactive"

    name = models.CharField(max_length=150, unique=True)
    description = models.TextField(null=True, blank=True)
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.ACTIVE)
    version = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class Medicine(models.Model):
    class Type(models.TextChoices):
        TABLET = "Tablet", "Tablet"
        CAPSULE = "Capsule", "Capsule"
        SYRUP = "Syrup", "Syrup"
        INJECTION = "Injection", "Injection"
        CREAM = "Cream", "Cream"
        OINTMENT = "Ointment", "Ointment"
        DROPS = "Drops", "Drops"
        INHALER = "Inhaler", "Inhaler"
        OTHER = "Other", "Other"

    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "Active"
        ARCHIVED = "ARCHIVED", "Archived"

    name = models.CharField(max_length=150)
    generic_name = models.CharField(max_length=150, null=True, blank=True)
    brand_name = models.CharField(max_length=150, null=True, blank=True)
    category = models.ForeignKey(Category, null=True, blank=True, on_delete=models.PROTECT, related_name="medicines")
    medicine_type = models.CharField(max_length=20, choices=Type.choices, default=Type.OTHER)
    description = models.TextField(null=True, blank=True)
    manufacturer = models.CharField(max_length=150, null=True, blank=True)
    barcode = models.CharField(max_length=100, null=True, blank=True, unique=True)
    purchase_price = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    selling_price = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    minimum_stock = models.PositiveIntegerField(default=10)
    storage_location = models.CharField(max_length=150, null=True, blank=True)
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.ACTIVE)
    version = models.PositiveIntegerField(default=1)
    created_by = models.ForeignKey(PharmacyUser, on_delete=models.PROTECT, related_name="medicines_created")
    updated_by = models.ForeignKey(PharmacyUser, on_delete=models.PROTECT, related_name="medicines_updated")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [models.Index(fields=["name"]), models.Index(fields=["status"])]
        constraints = [
            models.CheckConstraint(condition=Q(purchase_price__gte=0) & Q(selling_price__gte=0), name="medicine_prices_nonnegative"),
        ]


class MedicineBatch(models.Model):
    medicine = models.ForeignKey(Medicine, on_delete=models.PROTECT, related_name="batches")
    batch_number = models.CharField(max_length=100)
    expiry_date = models.DateField()
    quantity = models.IntegerField(default=0)
    purchase_price = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["medicine", "batch_number"], name="medicine_batch_number_uniq"),
            models.CheckConstraint(condition=Q(quantity__gte=0), name="batch_quantity_nonnegative"),
            models.CheckConstraint(condition=Q(purchase_price__gte=0), name="batch_price_nonnegative"),
        ]
        indexes = [models.Index(fields=["expiry_date"])]


class MedicineCreationRequest(models.Model):
    request_key = models.UUIDField(primary_key=True)
    request_hash = models.CharField(max_length=64)
    user = models.ForeignKey(PharmacyUser, on_delete=models.PROTECT)
    medicine = models.OneToOneField(Medicine, on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)


class Supplier(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "Active"
        INACTIVE = "INACTIVE", "Inactive"

    name = models.CharField(max_length=150)
    company = models.CharField(max_length=150, null=True, blank=True)
    phone = models.CharField(max_length=30, null=True, blank=True)
    email = models.CharField(max_length=150, null=True, blank=True)
    address = models.TextField(null=True, blank=True)
    registration_number = models.CharField(max_length=100, null=True, blank=True, unique=True)
    contact_person = models.CharField(max_length=150, null=True, blank=True)
    notes = models.TextField(null=True, blank=True)
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.ACTIVE)
    version = models.PositiveIntegerField(default=1)
    created_by = models.ForeignKey(PharmacyUser, on_delete=models.PROTECT, related_name="suppliers_created")
    updated_by = models.ForeignKey(PharmacyUser, on_delete=models.PROTECT, related_name="suppliers_updated")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [models.Index(fields=["name"]), models.Index(fields=["status"])]


class Purchase(models.Model):
    class PaymentStatus(models.TextChoices):
        PAID = "PAID", "Paid"
        PARTIAL = "PARTIAL", "Partial"
        UNPAID = "UNPAID", "Unpaid"

    supplier = models.ForeignKey(Supplier, on_delete=models.PROTECT, related_name="purchases")
    purchase_number = models.CharField(max_length=50, unique=True)
    supplier_name = models.CharField(max_length=150)
    purchase_date = models.DateField()
    invoice_number = models.CharField(max_length=100)
    payment_status = models.CharField(max_length=8, choices=PaymentStatus.choices)
    amount_paid = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    total_amount = models.DecimalField(max_digits=14, decimal_places=2)
    notes = models.TextField(null=True, blank=True)
    request_key = models.UUIDField(unique=True)
    request_hash = models.CharField(max_length=64)
    created_by = models.ForeignKey(PharmacyUser, on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["supplier", "invoice_number"], name="supplier_invoice_uniq"),
            models.CheckConstraint(condition=Q(total_amount__gte=0) & Q(amount_paid__gte=0) & Q(amount_paid__lte=models.F("total_amount")), name="purchase_amounts_valid"),
        ]
        indexes = [models.Index(fields=["purchase_date"])]


class PurchaseItem(models.Model):
    purchase = models.ForeignKey(Purchase, on_delete=models.PROTECT, related_name="items")
    medicine = models.ForeignKey(Medicine, on_delete=models.PROTECT)
    medicine_name = models.CharField(max_length=150)
    batch = models.ForeignKey(MedicineBatch, on_delete=models.PROTECT)
    batch_number = models.CharField(max_length=100)
    quantity = models.PositiveIntegerField()
    purchase_price = models.DecimalField(max_digits=12, decimal_places=2)
    selling_price = models.DecimalField(max_digits=12, decimal_places=2)
    expiry_date = models.DateField()
    subtotal = models.DecimalField(max_digits=14, decimal_places=2)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["purchase", "batch"], name="purchase_batch_uniq"),
            models.CheckConstraint(condition=Q(quantity__gt=0) & Q(purchase_price__gte=0) & Q(selling_price__gte=0) & Q(subtotal__gte=0), name="purchase_item_values_valid"),
        ]


class StockMovement(models.Model):
    class Type(models.TextChoices):
        PURCHASE = "PURCHASE", "Purchase"
        SALE = "SALE", "Sale"
        RETURN = "RETURN", "Return"
        ADJUSTMENT = "ADJUSTMENT", "Adjustment"
        DAMAGE = "DAMAGE", "Damage"
        EXPIRED = "EXPIRED", "Expired"

    medicine = models.ForeignKey(Medicine, on_delete=models.PROTECT, related_name="movements")
    batch = models.ForeignKey(MedicineBatch, on_delete=models.PROTECT, related_name="movements")
    purchase_item = models.OneToOneField(PurchaseItem, null=True, blank=True, on_delete=models.PROTECT)
    type = models.CharField(max_length=12, choices=Type.choices)
    quantity = models.IntegerField()
    previous_stock = models.IntegerField()
    new_stock = models.IntegerField()
    reference = models.CharField(max_length=100)
    reason = models.CharField(max_length=500)
    created_by = models.ForeignKey(PharmacyUser, on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["medicine", "created_at"])]
        constraints = [
            models.CheckConstraint(condition=Q(previous_stock__gte=0) & Q(new_stock__gte=0), name="movement_stock_nonnegative"),
            models.CheckConstraint(condition=Q(new_stock=models.F("previous_stock") + models.F("quantity")), name="movement_stock_balances"),
        ]


class Customer(models.Model):
    full_name = models.CharField(max_length=150)
    phone = models.CharField(max_length=30, null=True, blank=True)
    email = models.CharField(max_length=150, null=True, blank=True)
    address = models.CharField(max_length=1000, null=True, blank=True)
    date_of_birth = models.DateField(null=True, blank=True)
    notes = models.TextField(null=True, blank=True)
    version = models.PositiveIntegerField(default=1)
    created_by = models.ForeignKey(PharmacyUser, on_delete=models.PROTECT, related_name="customers_created")
    updated_by = models.ForeignKey(PharmacyUser, on_delete=models.PROTECT, related_name="customers_updated")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [models.Index(fields=["full_name"]), models.Index(fields=["phone"])]


class Prescription(models.Model):
    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        DISPENSED = "DISPENSED", "Dispensed"
        PARTIALLY_DISPENSED = "PARTIALLY_DISPENSED", "Partially dispensed"
        CANCELLED = "CANCELLED", "Cancelled"

    prescription_number = models.CharField(max_length=60, unique=True)
    customer = models.ForeignKey(Customer, on_delete=models.PROTECT, related_name="prescriptions")
    doctor = models.CharField(max_length=150)
    prescription_date = models.DateField()
    notes = models.TextField(null=True, blank=True)
    status = models.CharField(max_length=24, choices=Status.choices, default=Status.PENDING)
    version = models.PositiveIntegerField(default=1)
    request_key = models.UUIDField(unique=True)
    created_by = models.ForeignKey(PharmacyUser, on_delete=models.PROTECT, related_name="prescriptions_created")
    updated_by = models.ForeignKey(PharmacyUser, on_delete=models.PROTECT, related_name="prescriptions_updated")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [models.Index(fields=["status"]), models.Index(fields=["prescription_date"])]


class PrescriptionItem(models.Model):
    prescription = models.ForeignKey(Prescription, on_delete=models.PROTECT, related_name="items")
    medicine = models.ForeignKey(Medicine, on_delete=models.PROTECT)
    dosage = models.CharField(max_length=150)
    frequency = models.CharField(max_length=150)
    duration = models.CharField(max_length=150)
    quantity = models.PositiveIntegerField()
    dispensed_quantity = models.PositiveIntegerField(default=0)
    instructions = models.CharField(max_length=1000, null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["prescription", "medicine"], name="prescription_medicine_uniq"),
            models.CheckConstraint(condition=Q(quantity__gt=0) & Q(dispensed_quantity__lte=models.F("quantity")), name="prescription_item_quantity_valid"),
        ]


class PharmacySettings(models.Model):
    pharmacy_name = models.CharField(max_length=150, default="Pharmacy System")
    address = models.CharField(max_length=1000, null=True, blank=True)
    phone = models.CharField(max_length=30, null=True, blank=True)
    email = models.CharField(max_length=150, null=True, blank=True)
    logo_url = models.CharField(max_length=1000, null=True, blank=True)
    registration_number = models.CharField(max_length=150, null=True, blank=True)
    currency = models.CharField(max_length=3, default="TZS")
    low_stock_threshold = models.PositiveIntegerField(default=10)
    expiry_warning_days = models.PositiveIntegerField(default=30)
    invoice_prefix = models.CharField(max_length=12, default="INV")
    invoice_footer = models.CharField(max_length=500, null=True, blank=True)
    version = models.PositiveIntegerField(default=1)


class PharmacyPreference(models.Model):
    settings = models.OneToOneField(PharmacySettings, primary_key=True, on_delete=models.PROTECT, related_name="preferences")
    alerts_enabled = models.BooleanField(default=True)
    alert_expiry_days = models.PositiveIntegerField(default=10)
    alert_stock_quantity = models.PositiveIntegerField(default=10)
    alert_interval_minutes = models.PositiveIntegerField(default=10)
    invoice_title = models.CharField(max_length=60, default="SALES INVOICE")
    invoice_terms = models.CharField(max_length=1000, null=True, blank=True)
    invoice_show_logo = models.BooleanField(default=True)
    website = models.CharField(max_length=250, null=True, blank=True)
    business_hours = models.CharField(max_length=250, null=True, blank=True)


class Sale(models.Model):
    class PaymentMethod(models.TextChoices):
        CASH = "CASH", "Cash"
        CARD = "CARD", "Card"
        MOBILE_MONEY = "MOBILE_MONEY", "Mobile money"
        OTHER = "OTHER", "Other"

    invoice_number = models.CharField(max_length=60, unique=True)
    customer_name = models.CharField(max_length=150, null=True, blank=True)
    sale_date = models.DateField()
    subtotal = models.DecimalField(max_digits=14, decimal_places=2)
    discount = models.DecimalField(max_digits=14, decimal_places=2)
    total_amount = models.DecimalField(max_digits=14, decimal_places=2)
    amount_paid = models.DecimalField(max_digits=14, decimal_places=2)
    change_amount = models.DecimalField(max_digits=14, decimal_places=2)
    payment_method = models.CharField(max_length=20, choices=PaymentMethod.choices)
    request_key = models.UUIDField(unique=True)
    request_hash = models.CharField(max_length=64)
    created_by = models.ForeignKey(PharmacyUser, on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["sale_date"])]
        constraints = [
            models.CheckConstraint(condition=Q(subtotal__gte=models.F("discount")) & Q(discount__gte=0) & Q(total_amount=models.F("subtotal") - models.F("discount")) & Q(amount_paid__gte=models.F("total_amount")) & Q(change_amount=models.F("amount_paid") - models.F("total_amount")), name="sale_amounts_valid"),
        ]


class SaleItem(models.Model):
    sale = models.ForeignKey(Sale, on_delete=models.PROTECT, related_name="items")
    medicine = models.ForeignKey(Medicine, on_delete=models.PROTECT)
    batch = models.ForeignKey(MedicineBatch, on_delete=models.PROTECT)
    medicine_name = models.CharField(max_length=150)
    batch_number = models.CharField(max_length=100)
    quantity = models.PositiveIntegerField()
    unit_price = models.DecimalField(max_digits=12, decimal_places=2)
    unit_cost = models.DecimalField(max_digits=12, decimal_places=2)
    subtotal = models.DecimalField(max_digits=14, decimal_places=2)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["sale", "batch"], name="sale_batch_uniq"),
            models.CheckConstraint(condition=Q(quantity__gt=0) & Q(unit_price__gte=0) & Q(unit_cost__gte=0) & Q(subtotal__gte=0), name="sale_item_values_valid"),
        ]


class SaleDetail(models.Model):
    sale = models.OneToOneField(Sale, primary_key=True, on_delete=models.PROTECT, related_name="detail")
    customer = models.ForeignKey(Customer, null=True, blank=True, on_delete=models.PROTECT)
    prescription = models.ForeignKey(Prescription, null=True, blank=True, on_delete=models.PROTECT)
    pharmacy_profile = models.JSONField(default=dict)


class NotificationRead(models.Model):
    user = models.ForeignKey(PharmacyUser, on_delete=models.PROTECT)
    notification_key = models.CharField(max_length=160)
    read_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "notification_key"], name="notification_read_uniq")]


class ImageUpload(models.Model):
    class Purpose(models.TextChoices):
        MEDICINE = "medicine", "Medicine"
        LOGO = "logo", "Logo"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    purpose = models.CharField(max_length=8, choices=Purpose.choices)
    content = models.BinaryField()
    content_type = models.CharField(max_length=30)
    width = models.PositiveIntegerField()
    height = models.PositiveIntegerField()
    created_by = models.ForeignKey(PharmacyUser, on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)


class MedicineImage(models.Model):
    medicine = models.OneToOneField(Medicine, primary_key=True, on_delete=models.PROTECT, related_name="image_link")
    image = models.ForeignKey(ImageUpload, on_delete=models.PROTECT)
