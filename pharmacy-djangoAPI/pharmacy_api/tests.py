import base64
import io
import json
import uuid
from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth.hashers import check_password, make_password
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase
from django.utils import timezone
from PIL import Image

from .auth import issue_token
from .models import (
    Category,
    Medicine,
    MedicineBatch,
    PharmacyUser,
    StockMovement,
    UserAccess,
)


class PharmacyApiTests(TestCase):
    def setUp(self):
        self.admin = PharmacyUser.objects.create(
            full_name="Owner",
            email="owner@example.test",
            phone="255700000000",
            password=make_password("correct-horse"),
            role="admin",
        )
        UserAccess.objects.create(user=self.admin, status="ACTIVE")
        self.client.defaults["HTTP_AUTHORIZATION"] = f"Bearer {issue_token(self.admin)}"

    def post_json(self, path, payload):
        return self.client.post(path, data=json.dumps(payload), content_type="application/json")

    def test_auth_registration_and_pending_approval(self):
        self.client.defaults.pop("HTTP_AUTHORIZATION")
        response = self.post_json("/api/auth/register", {
            "fullName": "New Staff",
            "email": "new@example.test",
            "phone": "255711111111",
            "password": "valid-password",
        })
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["user"]["status"], "PENDING")
        login = self.post_json("/api/auth/login", {"email": "new@example.test", "password": "valid-password"})
        self.assertEqual(login.status_code, 403)
        self.assertEqual(login.json()["code"], "ACCOUNT_INACTIVE")

    def test_catalog_and_dashboard_contract(self):
        category_response = self.post_json("/api/categories", {"name": "Analgesics", "description": ""})
        self.assertEqual(category_response.status_code, 201)
        category_id = category_response.json()["data"]["id"]
        medicine_response = self.post_json("/api/medicines", {
            "name": "Paracetamol", "description": "", "category_id": category_id,
            "medicine_type": "Tablet", "purchase_price": "2.00", "selling_price": "4.00",
            "minimum_stock": 5,
        })
        self.assertEqual(medicine_response.status_code, 201)
        medicine_id = medicine_response.json()["data"]["id"]
        self.assertEqual(self.client.get("/api/medicines").json()["data"]["items"][0]["quantity"], 0)
        dashboard = self.client.get("/api/dashboard").json()["data"]
        self.assertEqual(dashboard["stats"]["totalMedicines"], {"value": 1, "status": "ready"})
        self.assertEqual(dashboard["stockOverview"]["outOfStock"], 1)
        self.assertEqual(Medicine.objects.get(pk=medicine_id).name, "Paracetamol")

    def test_purchase_then_sale_updates_stock_atomically(self):
        category = Category.objects.create(name="Analgesics")
        medicine = Medicine.objects.create(name="Paracetamol", category=category, purchase_price="2.00", selling_price="4.00", minimum_stock=5, created_by=self.admin, updated_by=self.admin)
        supplier = self.post_json("/api/suppliers", {"name": "Local Supplier"})
        self.assertEqual(supplier.status_code, 201)
        purchase = self.post_json("/api/purchases", {
            "supplier_id": supplier.json()["data"]["id"],
            "purchase_date": timezone.localdate().isoformat(),
            "invoice_number": "INV-001",
            "amount_paid": "20.00",
            "request_key": str(uuid.uuid4()),
            "items": [{
                "medicine_id": medicine.pk,
                "batch_number": "B-001",
                "quantity": 10,
                "purchase_price": "2.00",
                "selling_price": "4.00",
                "expiry_date": (timezone.localdate() + timedelta(days=120)).isoformat(),
            }],
        })
        self.assertEqual(purchase.status_code, 201, purchase.content)
        purchase_details = self.client.get(f"/api/purchases/{purchase.json()['data']['id']}").json()["data"]
        self.assertEqual(len(purchase_details["movements"]), 1)
        self.assertEqual(purchase_details["staff"], "Owner")
        sale = self.post_json("/api/sales", {
            "request_key": str(uuid.uuid4()),
            "discount": "0",
            "amount_paid": "8",
            "payment_method": "CASH",
            "items": [{"medicine_id": medicine.pk, "quantity": 2, "unit_price": "4"}],
        })
        self.assertEqual(sale.status_code, 201, sale.content)
        self.assertEqual(MedicineBatch.objects.get(medicine=medicine).quantity, 8)
        self.assertEqual(StockMovement.objects.filter(medicine=medicine).count(), 2)
        stock = self.client.get(f"/api/stock?supplier={supplier.json()['data']['id']}").json()["data"]
        self.assertEqual(stock["items"][0]["usable_quantity"], 8)
        self.assertEqual(stock["items"][0]["expired_quantity"], 0)
        invoice = self.client.get(f"/api/sales/{sale.json()['data']['id']}/invoice")
        self.assertEqual(invoice.status_code, 200)
        self.assertEqual(invoice["Content-Type"], "application/pdf")
        self.assertTrue(invoice.content.startswith(b"%PDF-"))

    def test_customer_prescription_settings_and_reports(self):
        customer = self.post_json("/api/customers", {"full_name": "Amina Patient"})
        self.assertEqual(customer.status_code, 201, customer.content)
        category = Category.objects.create(name="Antibiotics")
        medicine = Medicine.objects.create(name="Amoxicillin", category=category, purchase_price="3.00", selling_price="5.00", created_by=self.admin, updated_by=self.admin)
        rx = self.post_json("/api/prescriptions", {
            "customer_id": customer.json()["data"]["id"],
            "doctor": "Dr. Example",
            "prescription_date": timezone.localdate().isoformat(),
            "notes": "",
            "request_key": str(uuid.uuid4()),
            "items": [{
                "medicine_id": medicine.pk,
                "dosage": "500 mg",
                "frequency": "Twice daily",
                "duration": "5 days",
                "quantity": 10,
                "instructions": "",
            }],
        })
        self.assertEqual(rx.status_code, 201, rx.content)
        self.assertEqual(rx.json()["data"]["items"][0]["medicine_id"], medicine.pk)
        settings = self.client.get("/api/settings").json()["data"]
        settings.pop("id")
        settings["low_stock_threshold"] = 12
        updated = self.client.put("/api/settings", data=json.dumps(settings), content_type="application/json")
        self.assertEqual(updated.status_code, 200, updated.content)
        self.assertEqual(updated.json()["data"]["low_stock_threshold"], 12)
        reports = self.client.get("/api/reports?type=transactions").json()["data"]
        self.assertIn("pagination", reports)

    def test_media_upload_and_initial_admin_bootstrap(self):
        image_buffer = io.BytesIO()
        Image.new("RGB", (4, 4), "green").save(image_buffer, format="PNG")
        encoded = base64.b64encode(image_buffer.getvalue()).decode("ascii")
        upload = self.post_json("/api/media", {"purpose": "logo", "image": f"data:image/png;base64,{encoded}"})
        self.assertEqual(upload.status_code, 201, upload.content)
        public_image = self.client.get(upload.json()["data"]["url"], HTTP_AUTHORIZATION="")
        self.assertEqual(public_image.status_code, 200)
        self.assertEqual(public_image["Content-Type"], "image/png")

        self.admin.role = "staff"
        self.admin.save(update_fields=["role"])
        self.admin.access.delete()
        output = io.StringIO()
        call_command("bootstrap_admin", self.admin.pk, stdout=output)
        self.admin.refresh_from_db()
        self.assertEqual(self.admin.role, "admin")
        self.assertEqual(self.admin.access.status, "ACTIVE")
        self.assertIn("Existing password preserved", output.getvalue())

    def test_create_initial_admin_without_an_existing_account(self):
        self.admin.role = "staff"
        self.admin.save(update_fields=["role"])
        self.admin.access.status = "PENDING"
        self.admin.access.save(update_fields=["status"])
        answers = iter(["Pharmacy Owner", "owner2@example.test", "255722222222"])
        output = io.StringIO()
        with patch("builtins.input", side_effect=lambda _prompt: next(answers)), patch(
            "getpass.getpass", side_effect=["a-secure-password", "a-secure-password"]
        ):
            call_command("create_initial_admin", stdout=output)

        owner = PharmacyUser.objects.get(email="owner2@example.test")
        self.assertEqual(owner.role, "admin")
        self.assertTrue(check_password("a-secure-password", owner.password))
        self.assertEqual(owner.access.status, "ACTIVE")
        self.assertEqual(UserAccess.objects.filter(user__role="admin", status="ACTIVE").count(), 1)

    def test_create_initial_admin_refuses_when_an_active_admin_exists(self):
        answers = iter(["Other Owner", "other@example.test", "255733333333"])
        with patch("builtins.input", side_effect=lambda _prompt: next(answers)), patch(
            "getpass.getpass", side_effect=["a-secure-password", "a-secure-password"]
        ):
            with self.assertRaisesMessage(CommandError, "An active administrator already exists."):
                call_command("create_initial_admin", stdout=io.StringIO())

# Create your tests here.
