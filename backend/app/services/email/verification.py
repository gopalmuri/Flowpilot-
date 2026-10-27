import asyncio
import hashlib
import logging
import secrets
import smtplib
from datetime import datetime, timedelta, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional, Tuple
import uuid

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.email_verification import EmailVerification
from app.models.user import User

logger = logging.getLogger(__name__)

OTP_EXPIRY_MINUTES = 15
MAX_FAILED_ATTEMPTS = 5
RESEND_COOLDOWN_SECONDS = 60


def generate_otp() -> str:
    """Generate a cryptographically secure 6-digit numeric OTP."""
    code = secrets.randbelow(900000) + 100000
    return str(code)


def hash_otp(otp: str, salt: str = "") -> str:
    """Hash OTP using SHA-256 for secure storage."""
    payload = f"{salt}:{otp}:{settings.SECRET_KEY}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def verify_otp_hash(plain_otp: str, hashed_otp: str, salt: str = "") -> bool:
    """Securely verify an entered OTP against the stored hash."""
    expected_hash = hash_otp(plain_otp, salt=salt)
    return secrets.compare_digest(expected_hash, hashed_otp)


def _send_smtp_sync(to_email: str, otp_code: str, purpose: str = "verification") -> bool:
    """Synchronous SMTP email delivery."""
    msg = MIMEMultipart("alternative")
    is_login = purpose == "login"
    msg["Subject"] = (
        f"Your FlowPilot Sign-In Verification Code: {otp_code}"
        if is_login
        else f"Your FlowPilot Verification Code: {otp_code}"
    )
    msg["From"] = f"{settings.EMAILS_FROM_NAME} <{settings.EMAILS_FROM_EMAIL}>"
    msg["To"] = to_email

    greeting = "Welcome back to FlowPilot!" if is_login else "Welcome to FlowPilot!"
    action_text = (
        "Please enter the following 6-digit code to securely sign in to your FlowPilot organization account:"
        if is_login
        else "Please enter the following 6-digit code to complete your organization account setup:"
    )

    text_content = (
        f"{greeting}\n\n"
        f"Your verification code is: {otp_code}\n\n"
        f"{action_text}\n\n"
        f"This code will expire in {OTP_EXPIRY_MINUTES} minutes.\n"
        f"If you did not request this verification, you can safely ignore this email.\n"
    )

    header_title = "FlowPilot Sign-In Verification" if is_login else "FlowPilot Verification"

    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>{header_title}</title>
      <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0f172a; color: #f8fafc; padding: 24px; }}
        .card {{ max-width: 480px; margin: 0 auto; background-color: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 32px; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5); }}
        .header {{ font-size: 20px; font-weight: 700; color: #38bdf8; margin-bottom: 12px; }}
        .otp-box {{ background-color: #0f172a; border: 2px dashed #0284c7; border-radius: 8px; font-size: 32px; letter-spacing: 8px; font-weight: 800; text-align: center; padding: 16px; margin: 24px 0; color: #38bdf8; }}
        .footer {{ font-size: 13px; color: #94a3b8; margin-top: 24px; line-height: 1.5; }}
      </style>
    </head>
    <body>
      <div class="card">
        <div class="header">{header_title}</div>
        <p>{action_text}</p>
        <div class="otp-box">{otp_code}</div>
        <p class="footer">
          This verification code will expire in <strong>{OTP_EXPIRY_MINUTES} minutes</strong>.<br>
          If you didn't request this code, please secure your account immediately.
        </p>
      </div>
    </body>
    </html>
    """

    msg.attach(MIMEText(text_content, "plain"))
    msg.attach(MIMEText(html_content, "html"))

    try:
        if settings.SMTP_TLS:
            with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as server:
                server.starttls()
                if settings.SMTP_USER and settings.SMTP_PASSWORD:
                    server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
                server.send_message(msg)
        else:
            with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as server:
                if settings.SMTP_USER and settings.SMTP_PASSWORD:
                    server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
                server.send_message(msg)
        logger.info("Successfully sent verification email to %s via SMTP (purpose=%s)", to_email, purpose)
        return True
    except Exception as e:
        logger.error("Failed to send email via SMTP to %s: %s", to_email, e)
        return False


async def send_verification_email(to_email: str, otp_code: str, purpose: str = "verification") -> bool:
    """
    Deliver verification email via SMTP if credentials are configured;
    otherwise fallback to logging the code prominently in server logs.
    """
    if settings.SMTP_USER and settings.SMTP_PASSWORD:
        return await asyncio.to_thread(_send_smtp_sync, to_email, otp_code, purpose)
    else:
        # Development fallback log
        banner = "=" * 60
        print(f"\n{banner}\n[FLOWPILOT DEV EMAIL VERIFICATION (purpose={purpose})]\nTo: {to_email}\nOTP Code: {otp_code}\nExpires: {OTP_EXPIRY_MINUTES} minutes\n{banner}\n", flush=True)
        logger.warning(
            "[DEV MODE] SMTP credentials not set. OTP for %s is %s",
            to_email,
            otp_code,
        )
        return True


async def create_or_refresh_verification(
    db: AsyncSession,
    user: User,
    purpose: str = "verification",
) -> Tuple[EmailVerification, str]:
    """
    Generate fresh OTP, invalidate existing verification record, and save new one.
    """
    # Delete old verification attempts for this user/email
    await db.execute(
        delete(EmailVerification).where(
            (EmailVerification.user_id == user.id) | (EmailVerification.email == user.email)
        )
    )

    otp_code = generate_otp()
    hashed = hash_otp(otp_code, salt=str(user.id))
    expires = datetime.now(timezone.utc) + timedelta(minutes=OTP_EXPIRY_MINUTES)

    verification = EmailVerification(
        user_id=user.id,
        email=user.email,
        otp_hash=hashed,
        attempts=0,
        expires_at=expires,
    )
    db.add(verification)
    await db.commit()
    await db.refresh(verification)

    # Deliver the email asynchronously
    await send_verification_email(user.email, otp_code, purpose=purpose)

    return verification, otp_code

