import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_active_user, get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.core.rate_limit import (
    login_rate_limiter,
    refresh_rate_limiter,
    register_rate_limiter,
)
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    get_password_hash,
    revoke_access_token,
    revoke_refresh_token,
    rotate_refresh_token,
    store_refresh_token,
    verify_password,
)
from app.models.email_verification import EmailVerification
from app.models.membership import OrganizationMember, OrganizationRole
from app.models.organization import Organization
from app.models.user import User
from app.schemas.auth import (
    LoginInitiateResponse,
    LogoutRequest,
    RefreshTokenRequest,
    ResendLoginOtpRequest,
    ResendOtpRequest,
    ResendOtpResponse,
    TokenResponse,
    UserLoginRequest,
    UserMeResponse,
    UserOrganizationSummary,
    UserRegisterRequest,
    UserRegisterResponse,
    UserResponse,
    VerifyEmailRequest,
    VerifyLoginOtpRequest,
)
from app.services.email.verification import (
    MAX_FAILED_ATTEMPTS,
    RESEND_COOLDOWN_SECONDS,
    create_or_refresh_verification,
    verify_otp_hash,
)

router = APIRouter(prefix="/auth", tags=["Authentication"])


def generate_slug_base(name: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", name).strip("-").lower()
    if not slug:
        slug = f"org-{uuid.uuid4().hex[:8]}"
    return slug[:50]


async def get_unique_slug(db: AsyncSession, base_slug: str) -> str:
    slug = base_slug
    counter = 1
    while True:
        query = select(Organization.id).where(Organization.slug == slug)
        res = await db.execute(query)
        if res.scalar_one_or_none() is None:
            return slug
        slug = f"{base_slug[:45]}-{counter}"
        counter += 1


@router.post(
    "/register",
    response_model=UserRegisterResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register new user",
)
async def register_user(
    req: UserRegisterRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """
    Registers a new user account with Argon2id password hashing.
    User starts with is_verified=False and a 6-digit verification code is generated.
    Optionally creates a default organization with the user as OWNER.
    Rate limited by IP.
    """
    await register_rate_limiter(request, response)

    email_clean = req.email.strip().lower()
    stmt = select(User).where(User.email == email_clean)
    existing = await db.execute(stmt)
    existing_user = existing.scalar_one_or_none()
    if existing_user is not None:
        if not existing_user.is_verified:
            # User already registered but pending email verification: refresh OTP and continue flow
            await create_or_refresh_verification(db, existing_user, purpose="verification")
            return UserRegisterResponse(
                message="Account already created and awaiting verification. A new verification code has been sent.",
                email=existing_user.email,
                requires_verification=True,
                user_id=existing_user.id,
            )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email address already exists",
        )

    password_hash = get_password_hash(req.password)

    new_user = User(
        email=email_clean,
        password_hash=password_hash,
        full_name=req.full_name.strip(),
        is_active=True,
        is_superuser=False,
        is_verified=False,
    )
    db.add(new_user)
    await db.flush()

    if req.organization_name:
        org_name = req.organization_name.strip()
        base_slug = generate_slug_base(org_name)
        slug = await get_unique_slug(db, base_slug)
        new_org = Organization(name=org_name, slug=slug)
        db.add(new_org)
        await db.flush()

        membership = OrganizationMember(
            organization_id=new_org.id,
            user_id=new_user.id,
            role=OrganizationRole.OWNER.value,
        )
        db.add(membership)

    await db.commit()
    await db.refresh(new_user)

    # Generate and send 6-digit OTP verification email
    await create_or_refresh_verification(db, new_user, purpose="verification")

    return UserRegisterResponse(
        message="Verification code sent. Please check your email to complete registration.",
        email=new_user.email,
        requires_verification=True,
        user_id=new_user.id,
    )


@router.post(
    "/verify-email",
    response_model=TokenResponse,
    summary="Verify user email with 6-digit OTP and obtain tokens",
)
async def verify_email(
    req: VerifyEmailRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """
    Validates the 6-digit OTP code against the database.
    Marks user as verified, cleans up verification state, and issues auth tokens.
    """
    email_clean = req.email.strip().lower()
    stmt = (
        select(User)
        .options(selectinload(User.memberships).selectinload(OrganizationMember.organization))
        .where(User.email == email_clean)
    )
    res = await db.execute(stmt)
    user = res.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User account not found",
        )

    if not user.is_verified:
        v_stmt = select(EmailVerification).where(EmailVerification.user_id == user.id)
        v_res = await db.execute(v_stmt)
        verification = v_res.scalar_one_or_none()

        if not verification or verification.expires_at < datetime.now(timezone.utc):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Verification code has expired or is invalid. Please request a new code.",
            )

        if not verify_otp_hash(req.code.strip(), verification.otp_hash, salt=str(user.id)):
            verification.attempts += 1
            if verification.attempts >= MAX_FAILED_ATTEMPTS:
                await db.delete(verification)
                await db.commit()
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Too many failed attempts. Please request a new verification code.",
                )
            await db.commit()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid verification code. Please check your code and try again.",
            )

        user.is_verified = True
        await db.delete(verification)
        await db.commit()
        await db.refresh(user)

    # Issue tokens upon successful email verification
    active_org_id = None
    active_role = None
    if user.memberships:
        first_mem = user.memberships[0]
        active_org_id = str(first_mem.organization_id)
        active_role = first_mem.role

    access_token, _, expires_in = create_access_token(
        user_id=str(user.id),
        email=user.email,
        org_id=active_org_id,
        role=active_role,
    )
    refresh_token, refresh_jti, refresh_expires_in = create_refresh_token(user_id=str(user.id))

    await store_refresh_token(refresh_jti, str(user.id), refresh_expires_in)

    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        secure=settings.ENVIRONMENT == "production",
        samesite="lax",
        max_age=refresh_expires_in,
        path="/api/v1/auth",
    )

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        expires_in=expires_in,
    )


@router.post(
    "/resend-otp",
    response_model=ResendOtpResponse,
    summary="Resend 6-digit verification code",
)
async def resend_verification_otp(
    req: ResendOtpRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Resends a fresh 6-digit verification OTP email.
    Enforces a 60-second cooldown rate limit between requests.
    """
    email_clean = req.email.strip().lower()
    stmt = select(User).where(User.email == email_clean)
    res = await db.execute(stmt)
    user = res.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User account not found",
        )

    if user.is_verified:
        return ResendOtpResponse(message="Email is already verified. You can log in directly.")

    v_stmt = select(EmailVerification).where(EmailVerification.user_id == user.id)
    v_res = await db.execute(v_stmt)
    existing_v = v_res.scalar_one_or_none()

    if existing_v:
        elapsed = (datetime.now(timezone.utc) - existing_v.created_at).total_seconds()
        if elapsed < RESEND_COOLDOWN_SECONDS:
            remaining = int(RESEND_COOLDOWN_SECONDS - elapsed)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Please wait {remaining} seconds before requesting a new code.",
            )

    await create_or_refresh_verification(db, user, purpose="verification")
    return ResendOtpResponse(
        message="A new verification code has been sent.",
    )


@router.post(
    "/login",
    response_model=LoginInitiateResponse,
    summary="Authenticate credentials and initiate 2FA OTP verification",
)
async def login_user(
    req: UserLoginRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """
    Authenticates user email and password.
    Requires is_verified=True. If not verified, returns HTTP 403 detail='email_not_verified'.
    Generates a 6-digit login verification OTP, delivers it to the user's email,
    and returns a response requiring OTP verification.
    """
    await login_rate_limiter(request, response)

    email_clean = req.email.strip().lower()
    stmt = (
        select(User)
        .options(selectinload(User.memberships).selectinload(OrganizationMember.organization))
        .where(User.email == email_clean)
    )
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    if not user or not user.is_active or not verify_password(req.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="email_not_verified",
        )

    # Generate fresh 6-digit OTP and send via email with login purpose
    await create_or_refresh_verification(db, user, purpose="login")

    return LoginInitiateResponse(
        message="A 6-digit verification code has been sent to your email.",
        email=user.email,
        requires_otp=True,
    )


@router.post(
    "/verify-login-otp",
    response_model=TokenResponse,
    summary="Verify 6-digit login OTP and obtain JWT tokens",
)
async def verify_login_otp(
    req: VerifyLoginOtpRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """
    Validates the 6-digit login OTP against the database.
    Issues JWT access and refresh tokens, sets HttpOnly cookie, and cleans up OTP.
    """
    email_clean = req.email.strip().lower()
    stmt = (
        select(User)
        .options(selectinload(User.memberships).selectinload(OrganizationMember.organization))
        .where(User.email == email_clean)
    )
    res = await db.execute(stmt)
    user = res.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User account not found or inactive",
        )

    v_stmt = select(EmailVerification).where(EmailVerification.user_id == user.id)
    v_res = await db.execute(v_stmt)
    verification = v_res.scalar_one_or_none()

    if not verification or verification.expires_at < datetime.now(timezone.utc):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Verification code has expired or is invalid. Please request a new code.",
        )

    if not verify_otp_hash(req.code.strip(), verification.otp_hash, salt=str(user.id)):
        verification.attempts += 1
        if verification.attempts >= MAX_FAILED_ATTEMPTS:
            await db.delete(verification)
            await db.commit()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Too many failed attempts. Please sign in again to request a new code.",
            )
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid verification code. Please check your code and try again.",
        )

    # Clean up verification state upon successful OTP validation
    await db.delete(verification)
    await db.commit()

    active_org_id = None
    active_role = None
    if req.organization_id:
        target_membership = next(
            (m for m in user.memberships if m.organization_id == req.organization_id),
            None,
        )
        if not target_membership:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid organization selected",
            )
        active_org_id = str(target_membership.organization_id)
        active_role = target_membership.role
    elif user.memberships:
        first_mem = user.memberships[0]
        active_org_id = str(first_mem.organization_id)
        active_role = first_mem.role

    access_token, _, expires_in = create_access_token(
        user_id=str(user.id),
        email=user.email,
        org_id=active_org_id,
        role=active_role,
    )
    refresh_token, refresh_jti, refresh_expires_in = create_refresh_token(user_id=str(user.id))

    await store_refresh_token(refresh_jti, str(user.id), refresh_expires_in)

    # Set secure HttpOnly cookie
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        secure=settings.ENVIRONMENT == "production",
        samesite="lax",
        max_age=refresh_expires_in,
        path="/api/v1/auth",
    )

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        expires_in=expires_in,
    )


@router.post(
    "/resend-login-otp",
    response_model=ResendOtpResponse,
    summary="Resend 6-digit login verification code",
)
async def resend_login_otp(
    req: ResendLoginOtpRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Resends a fresh 6-digit login OTP email.
    Enforces a 60-second cooldown rate limit between requests.
    """
    email_clean = req.email.strip().lower()
    stmt = select(User).where(User.email == email_clean)
    res = await db.execute(stmt)
    user = res.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User account not found",
        )

    v_stmt = select(EmailVerification).where(EmailVerification.user_id == user.id)
    v_res = await db.execute(v_stmt)
    existing_v = v_res.scalar_one_or_none()

    if existing_v:
        elapsed = (datetime.now(timezone.utc) - existing_v.created_at).total_seconds()
        if elapsed < RESEND_COOLDOWN_SECONDS:
            remaining = int(RESEND_COOLDOWN_SECONDS - elapsed)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Please wait {remaining} seconds before requesting a new code.",
            )

    await create_or_refresh_verification(db, user, purpose="login")
    return ResendOtpResponse(
        message="A new login verification code has been sent to your email.",
    )


@router.post(
    "/refresh",
    response_model=TokenResponse,
    summary="Rotate refresh token and issue new access token",
)
async def refresh_tokens(
    request: Request,
    response: Response,
    req: RefreshTokenRequest = RefreshTokenRequest(),
    db: AsyncSession = Depends(get_db),
):
    """
    Validates refresh token from body or HttpOnly cookie, rotates it atomically in Redis,
    and issues a fresh token pair.
    Enforces Redis sliding-window rate limiting and CSRF origin verification.
    """
    await refresh_rate_limiter(request, response)

    # CSRF Origin validation for cookie-authenticated refresh requests
    origin_header = request.headers.get("origin")
    if origin_header and settings.ENVIRONMENT.lower() == "production":
        allowed = settings.ALLOWED_CORS_ORIGINS if isinstance(settings.ALLOWED_CORS_ORIGINS, list) else []
        if origin_header not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Cross-site request forgery protection: Origin mismatch",
            )

    token_str = (
        req.refresh_token.strip()
        if (req.refresh_token and req.refresh_token.strip())
        else request.cookies.get("refresh_token")
    )

    if not token_str:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        payload = decode_token(token_str, expected_type="refresh")
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    old_jti = payload.get("jti")
    user_id_str = payload.get("sub")
    if not old_jti or not user_id_str:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Malformed token claims",
            headers={"WWW-Authenticate": "Bearer"},
        )

    new_refresh_token, new_jti, refresh_expires_in = create_refresh_token(user_id=user_id_str)

    rotated = await rotate_refresh_token(
        old_jti=old_jti,
        new_jti=new_jti,
        user_id=user_id_str,
        new_ttl_seconds=refresh_expires_in,
    )
    if not rotated:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or revoked refresh token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        user_uuid = uuid.UUID(user_id_str)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid user ID in token",
        ) from exc

    stmt = select(User).options(selectinload(User.memberships)).where(User.id == user_uuid)
    res = await db.execute(stmt)
    user = res.scalar_one_or_none()

    if not user or not user.is_active:
        await revoke_refresh_token(new_jti)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account is inactive or deleted",
        )

    active_org_id = str(user.memberships[0].organization_id) if user.memberships else None
    active_role = user.memberships[0].role if user.memberships else None

    access_token, _, expires_in = create_access_token(
        user_id=str(user.id),
        email=user.email,
        org_id=active_org_id,
        role=active_role,
    )

    # Set rotated HttpOnly cookie
    response.set_cookie(
        key="refresh_token",
        value=new_refresh_token,
        httponly=True,
        secure=settings.ENVIRONMENT == "production",
        samesite="lax",
        max_age=refresh_expires_in,
        path="/api/v1/auth",
    )

    return TokenResponse(
        access_token=access_token,
        refresh_token=new_refresh_token,
        token_type="bearer",
        expires_in=expires_in,
    )


@router.post(
    "/logout",
    summary="Revoke active access and refresh tokens",
)
async def logout_user(
    request: Request,
    response: Response,
    req: LogoutRequest = LogoutRequest(),
    current_user: User = Depends(get_current_user),
):
    """
    Revokes access token in Redis, revokes refresh token from body or cookie,
    and clears the HttpOnly cookie.
    """
    if hasattr(current_user, "_token_payload") and current_user._token_payload:
        jti = current_user._token_payload.get("jti")
        exp = current_user._token_payload.get("exp", 0)
        now_ts = int(datetime.now(timezone.utc).timestamp())
        remaining = exp - now_ts
        if jti and remaining > 0:
            await revoke_access_token(jti, remaining)

    # Determine refresh token from body or cookie
    token_str = (
        req.refresh_token.strip()
        if (req.refresh_token and req.refresh_token.strip())
        else request.cookies.get("refresh_token")
    )
    if token_str:
        try:
            payload = decode_token(token_str, expected_type="refresh")
            r_jti = payload.get("jti")
            if r_jti:
                await revoke_refresh_token(r_jti)
        except Exception:
            pass

    # Clear cookie
    response.delete_cookie(key="refresh_token", path="/api/v1/auth")
    return {"message": "Successfully logged out"}


@router.get(
    "/me",
    response_model=UserMeResponse,
    summary="Get current authenticated user profile and organizations",
)
async def get_current_user_profile(
    current_user: User = Depends(get_current_active_user),
):
    """Returns the authenticated user's profile and active organization memberships."""
    org_summaries = []
    for mem in current_user.memberships:
        if mem.organization:
            org_summaries.append(
                UserOrganizationSummary(
                    id=mem.organization.id,
                    name=mem.organization.name,
                    slug=mem.organization.slug,
                    role=mem.role,
                )
            )

    active_org_id = None
    active_role = None
    if hasattr(current_user, "_token_payload") and current_user._token_payload:
        raw_org = current_user._token_payload.get("org_id")
        if raw_org:
            try:
                active_org_id = uuid.UUID(raw_org)
            except ValueError:
                pass
        active_role = current_user._token_payload.get("role")

    return UserMeResponse(
        user=UserResponse.model_validate(current_user),
        organizations=org_summaries,
        active_organization_id=active_org_id,
        active_role=active_role,
    )
