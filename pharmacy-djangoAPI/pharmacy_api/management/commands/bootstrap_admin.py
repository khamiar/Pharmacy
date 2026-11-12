import json

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from pharmacy_api.models import AdministrationLock, AuditLog, PharmacyUser, UserAccess


class Command(BaseCommand):
    help = "Promote one existing account to the initial active administrator."

    def add_arguments(self, parser):
        parser.add_argument("account_id", type=int)

    def handle(self, *args, **options):
        with transaction.atomic():
            AdministrationLock.objects.get_or_create(pk=1)
            AdministrationLock.objects.select_for_update().get(pk=1)
            if UserAccess.objects.filter(user__role="admin", status="ACTIVE").exists():
                raise CommandError("An active administrator already exists.")
            try:
                user = PharmacyUser.objects.select_for_update().get(pk=options["account_id"])
            except PharmacyUser.DoesNotExist as error:
                raise CommandError("The selected account does not exist.") from error
            access, _ = UserAccess.objects.select_for_update().get_or_create(user=user)
            before = {"role": user.role, "status": access.status}
            user.role = "admin"
            user.save(update_fields=["role", "updated_at"])
            access.status = "ACTIVE"
            access.version += 1
            access.reviewed_by = None
            access.reviewed_at = timezone.now()
            access.save()
            AuditLog.objects.create(
                user=None,
                action="INITIAL_ADMIN_SETUP",
                entity="User",
                entity_id=user.pk,
                description=json.dumps({"before": before, "after": {"role": "admin", "status": "ACTIVE"}}),
            )
        self.stdout.write(self.style.SUCCESS(f"Administrator enabled for {user.email}. Existing password preserved."))
