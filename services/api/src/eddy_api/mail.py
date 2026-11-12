"""Plain-text email from services/api: safeguarding alerts and parent link notices.

Mailpit locally (compose.yaml), Amazon SES in production. A message carries no student words
and no answers; a failure to send is logged and never fails the request that caused it.
"""

import logging
import smtplib
from email.message import EmailMessage
from urllib.parse import urlparse

from eddy_api.config import Settings

logger = logging.getLogger(__name__)


def send(settings: Settings, to: str, subject: str, body: str) -> None:
    """Send one message, raising on failure (the jobs retry on their next run)."""
    url = urlparse(settings.smtp_url)
    message = EmailMessage()
    message["From"] = settings.mail_from
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)
    host = url.hostname or "127.0.0.1"
    if url.scheme == "smtps":
        # Implicit TLS (port 465).
        with smtplib.SMTP_SSL(host, url.port or 465, timeout=10) as smtp:
            if url.username:
                smtp.login(url.username, url.password or "")
            smtp.send_message(message)
        return
    with smtplib.SMTP(host, url.port or 25, timeout=10) as smtp:
        if url.username:
            # Credentials only ever travel over TLS.
            smtp.starttls()
            smtp.login(url.username, url.password or "")
        smtp.send_message(message)


def notify(settings: Settings, to: str, subject: str, body: str) -> bool:
    """Send a notice, logging rather than raising if the mail server is down."""
    try:
        send(settings, to, subject, body)
    except (OSError, smtplib.SMTPException):
        logger.warning("Could not send a notice email (%s)", subject)
        return False
    return True
