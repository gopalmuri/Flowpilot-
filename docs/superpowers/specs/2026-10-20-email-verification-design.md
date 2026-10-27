# FlowPilot Email Verification & Database Clean Slate Design Spec

## Overview
This specification defines the 6-digit cryptographic OTP email verification system for FlowPilot and details the database clean slate to wipe existing dummy/test accounts so real organization users can register cleanly.

## Key Requirements & Behavior
1. **Clean Slate**:
   - Truncate all dummy users, memberships, and organizations from PostgreSQL so the user can register fresh as the primary owner.
2. **Schema & Model Updates**:
   - `User.is_verified`: boolean, default `False`.
   - `EmailVerification` table: stores `id`, `user_id`, `email`, `otp_hash`, `attempts`, `expires_at`, `created_at`.
3. **Configuration & Service**:
   - SMTP configuration supporting Gmail SMTP (`smtp.gmail.com:587`).
   - Development fallback: if SMTP is unconfigured, logs the 6-digit OTP prominently in server console output so testing is never blocked.
4. **Authentication Gate**:
   - `POST /api/v1/auth/register`: Creates unverified user, generates 6-digit OTP, returns `requires_verification: true`. Does NOT issue auth tokens.
   - `POST /api/v1/auth/verify-email`: Validates OTP, sets `user.is_verified = True`, deletes verification record, issues JWT tokens and auto-authenticates.
   - `POST /api/v1/auth/resend-otp`: Rate-limited (60-second cooldown), invalidates old OTP and sends a new one.
   - `POST /api/v1/auth/login`: Checks `if not user.is_verified`, returns HTTP 403 `detail="email_not_verified"` and prompts verification.
5. **Frontend User Flow**:
   - `/verify-email` route with 6-digit numeric OTP input boxes, auto-focus, submit action, and 60-second resend countdown.
   - Automatic redirection from `/register` and blocked `/login` to `/verify-email?email=...`.
