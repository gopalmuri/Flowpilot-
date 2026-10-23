# Email Verification & Database Clean Slate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement full 6-digit OTP email verification for FlowPilot, gate authentication until email is verified, provide SMTP delivery with console fallback, build the `/verify-email` frontend UI, and wipe dummy accounts from the database.

**Architecture:** Add `is_verified` to `User` and create `EmailVerification` model; create `email_verification` service with cryptographic OTP generation and `aiosmtplib` sending with dev log fallback; add `/verify-email` and `/resend-otp` endpoints and gate `/login`; build `/verify-email` page in React frontend.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 Async, Pydantic v2, Alembic, aiosmtplib, React 18, Vite, Tailwind CSS, Lucide icons.

**Spec:** `docs/superpowers/specs/2026-10-20-email-verification-design.md`

## Global Constraints
- Passwords and OTP hashes must never be exposed in logs or API responses.
- OTPs must be 6 numeric digits and expire after 15 minutes.
- Unverified users must receive HTTP 403 `email_not_verified` on login attempts.
- Development fallback must log the code without failing when SMTP is unconfigured.

## Review Focus
1. User registration does not issue tokens until email verification succeeds.
2. Expired or incorrect OTP inputs reject verification properly and track attempts.
3. Resend OTP enforces a 60-second cooldown rate limit.
4. Login with unverified email redirects to `/verify-email` and refuses token issuance.
5. Database truncation cleanly resets users, organizations, and memberships without foreign key violations.

---

### Task 1: Database Clean Slate & Schema Migration
**Files:**
- Modify: `backend/app/models/user.py`
- Create: `backend/app/models/email_verification.py`
- Modify: `backend/app/models/__init__.py`
- Create: Alembic migration for `is_verified` and `email_verifications`

- [x] **Step 1: Truncate existing test/dummy data in PostgreSQL**
- [x] **Step 2: Add `is_verified` to `User` model and create `EmailVerification` model**
- [x] **Step 3: Export in `models/__init__.py` and create/run Alembic migration**

---

### Task 2: SMTP Configuration & Verification Service
**Files:**
- Modify: `backend/app/core/config.py`
- Modify: `.env` and `.env.example`
- Create: `backend/app/services/email/verification.py`
- Create: `backend/tests/unit/test_email_verification_service.py`

- [x] **Step 1: Add SMTP configuration settings in `app/core/config.py`**
- [x] **Step 2: Implement OTP generation, hashing, verification check, and async email delivery with dev console fallback**
- [x] **Step 3: Write and pass unit tests for OTP generation and validation**

---

### Task 3: Backend Authentication Endpoints & Gating
**Files:**
- Modify: `backend/app/routers/auth.py`
- Modify: `backend/app/schemas/auth.py`
- Modify: `backend/tests/api/test_auth.py` or new test file `backend/tests/api/test_email_verification.py`

- [x] **Step 1: Update `UserRegisterRequest` and register route to not issue tokens and send OTP**
- [x] **Step 2: Add `POST /api/v1/auth/verify-email` and `POST /api/v1/auth/resend-otp` endpoints**
- [x] **Step 3: Update `POST /api/v1/auth/login` to block unverified users with HTTP 403 `email_not_verified`**
- [x] **Step 4: Verify endpoints with automated tests**

---

### Task 4: Frontend Verification Page & Flow Integration
**Files:**
- Create: `frontend/src/pages/auth/VerifyEmailPage.tsx`
- Modify: `frontend/src/routes/AppRoutes.tsx`
- Modify: `frontend/src/pages/auth/RegisterPage.tsx`
- Modify: `frontend/src/pages/auth/LoginPage.tsx`
- Modify: `frontend/src/services/authService.ts`

- [x] **Step 1: Add `verifyEmail` and `resendOtp` functions in `authService.ts`**
- [x] **Step 2: Create `VerifyEmailPage.tsx` with 6-digit OTP input, countdown timer, and resend action**
- [x] **Step 3: Register `/verify-email` route in `AppRoutes.tsx`**
- [x] **Step 4: Connect register and login redirects to `/verify-email`**
- [x] **Step 5: Test and verify end-to-end registration, OTP reception, and verification**
