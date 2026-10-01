from django.core.exceptions import ImproperlyConfigured
from django.core.management.base import BaseCommand, CommandError

from twisters.reminders import service


class Command(BaseCommand):
    help = (
        "Hourly (:07): e-mail the practice reminder to everyone whose chosen local hour it is now, who "
        "has not practised today and has not been mailed today. Does nothing while the `reminders` flag "
        "is off. Needs EMAIL_*, WEB_BASE_URL and API_PUBLIC_URL. Safe to re-run: one mail per person per day."
    )

    def handle(self, **_):
        try:
            report = service.send_due()
        except ImproperlyConfigured as error:
            raise CommandError(str(error)) from error
        if report.flag_off:
            self.stdout.write("reminders flag is off; nothing sent")
            return
        self.stdout.write(
            self.style.SUCCESS(
                f"considered={report.considered}, sent={report.sent}, failed={report.failed}"
            )
        )
