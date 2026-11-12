import getpass
import json

from django.contrib.auth.hashers import make_password
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.core.validators import validate_email
from django.db import IntegrityError, transaction
from django.utils import timezone

from pharmacy_api.models import AdministrationLock, AuditLog, PharmacyUser, UserAccess


class Command(BaseCommand):
    help = "Create the first active pharmacy administrator."

    def handle(self, *args, **options):
        full_name = input("Administrator full name: ").strip()
        email = input("Administrator email: ").strip().lower()
        phone = input("Administrator phone: ").strip()
        try:
            validate_email(email)
        except ValidationError as error:
            raise CommandError("Enter a valid email address.") from error
        if not full_name or not phone:
            raise CommandError("Full name and phone are required.")
        if PharmacyUser.objects.filter(email=email).exists():
            raise CommandError("An account with that email already exists.")

        password = getpass.getpass("Administrator password (minimum 12 characters): ")
        confirmation = getpass.getpass("Confirm administrator password: ")
        if len(password) < 12:
            raise CommandError("The password must contain at least 12 characters.")
        if password != confirmation:
            raise CommandError("The passwords do not match.")

        try:
            with transaction.atomic():
                AdministrationLock.objects.get_or_create(pk=1)
                AdministrationLock.objects.select_for_update().get(pk=1)
                if UserAccess.objects.filter(user__role="admin", status="ACTIVE").exists():
                    raise CommandError("An active administrator already exists.")
                user = PharmacyUser.objects.create(
                    full_name=full_name,
                    email=email,
                    phone=phone,
                    password=make_password(password),
                    role="admin",
                )
                UserAccess.objects.create(
                    user=user,
                    status="ACTIVE",
                    reviewed_at=timezone.now(),
                )
                AuditLog.objects.create(
                    user=None,
                    action="INITIAL_ADMIN_SETUP",
                    entity="User",
                    entity_id=user.pk,
                    description=json.dumps(
                        {"after": {"role": "admin", "status": "ACTIVE"}}
                    ),
                )
        except IntegrityError as error:
            raise CommandError("Could not create the administrator; check that the email is unique.") from error

        self.stdout.write(self.style.SUCCESS(f"Initial administrator created for {user.email}."))
