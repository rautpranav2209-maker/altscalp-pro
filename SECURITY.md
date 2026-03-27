# Security Implementation Guide

## Overview

AltScalp PRO implements defence-in-depth across all critical payment and authentication flows. This document describes the security architecture, threat model, and implementation details.

---

## Payment Flow (Secure)

```
User → Frontend → Razorpay Payment Gateway → Razorpay
                                                  ↓
Razorpay Webhook → /webhooks/razorpay → Verify HMAC → Firestore Update
                                ↓
                        Verify Signature
                        Validate Amount
                        Check User Auth
                        Update DB Securely

Frontend (optional) → /api/verify-payment → Backend Verification → Firestore
```

---

## Critical Fixes Implemented

### 1. Payment Verification (`api/verify-payment.js`)

- **HMAC-SHA256 signature verification** using Razorpay secret key (never exposed to frontend)
- **Timing-safe comparison** (`crypto.timingSafeEqual`) to prevent timing oracle attacks
- **Replay attack prevention** via deduplication in `payments` Firestore collection
- **Input validation** — all fields regex-validated before processing
- **Server-authoritative plan prices** — amounts hardcoded, not derived from request body
- **Firebase ID token verification** — user identity from JWT, not request body

### 2. Webhook Handler (`api/webhooks/razorpay.js`)

- **HMAC-SHA256 webhook signature** verification against `RAZORPAY_WEBHOOK_SECRET`
- **Timing-safe comparison** for signature check
- **Deduplication** prevents double-upgrade on repeated webhook delivery
- Handles `payment.captured` event; all other events are safely ignored

### 3. Session Storage Abuse (`index.html`)

- **Removed** `sessionStorage.getItem('alt_new_signup_active')` check from `checkProStatus()`
- Trial status is now determined solely from:
  1. Firestore `userData` (server-authoritative)
  2. Firebase Auth `creationTime` (from trusted JWT)
- An attacker can no longer call `sessionStorage.setItem('alt_new_signup_active', '1')` to unlock PRO features

### 4. Firestore Security Rules (`firestore.rules`)

- Users can only read **their own** profile document
- **All client writes are blocked** — only the backend Admin SDK writes subscription data
- Payment and audit records are server-write-only
- Explicit deny-all catch-all at the bottom

---

## Middleware

| File | Purpose |
|------|---------|
| `api/middleware/authenticateToken.js` | Verifies Firebase ID token; attaches `req.uid` |
| `api/middleware/rateLimit.js` | Token bucket: 5 req/min per user per endpoint |
| `api/middleware/validatePayment.js` | Validates & sanitises all payment parameters |
| `api/middleware/csrf.js` | Issues and validates CSRF tokens |
| `api/utils/transactionLogger.js` | Writes audit records to `transactions` collection |
| `api/config/razorpay.js` | Centralised Razorpay client; validates env vars at boot |

---

## Rate Limiting

- **Algorithm**: Token bucket (in-memory; upgrade to Redis for horizontal scaling)
- **Limit**: 5 requests per minute per user per endpoint
- **Response**: `429 Too Many Requests` with `Retry-After` header
- **Key**: `uid:endpoint` (falls back to IP for unauthenticated requests)

---

## CSRF Protection

- Server issues a random 32-byte hex token via `GET /api/csrf-token`
- Token is stored in an `__Host-csrf` HTTP-only cookie (`SameSite=Strict; Secure`)
- Frontend reads token from the JSON response body and sends it as `X-CSRF-Token` header
- Server middleware compares header token to cookie token using `crypto.timingSafeEqual`
- Token is invalidated after successful payment and re-fetched on next request

---

## Input Validation

All payment endpoints validate:

| Field | Rule |
|-------|------|
| `razorpay_order_id` | Required, alphanumeric (`/^[A-Za-z0-9_]+$/`) |
| `razorpay_payment_id` | Required, alphanumeric |
| `razorpay_signature` | Required, hex string (`/^[a-f0-9]+$/i`) |
| `plan` | Required, enum: `monthly` \| `yearly` |
| `uid` | Derived from verified JWT token — never from request body |

---

## Audit Logging

Every payment attempt (success and failure) is logged to the `transactions` Firestore collection with:

- User ID, Payment ID, Order ID, Amount, Plan, Timestamp
- Payment status (`success` / `failed` / `refunded`)
- IP address and user agent (for fraud detection)
- `expiresAt` field (90 days) for data retention policy

Users can read their own transaction records. No client writes are permitted.

---

## Environment Variables

See [`.env.example`](.env.example) for the full list. **Never commit `.env` to git.**

Key variables:

| Variable | Description |
|----------|-------------|
| `RAZORPAY_KEY_ID` | Razorpay public key (safe to use in frontend) |
| `RAZORPAY_KEY_SECRET` | Razorpay secret key — **server-only, never expose** |
| `RAZORPAY_WEBHOOK_SECRET` | Webhook HMAC secret — **server-only** |
| `FIREBASE_SERVICE_ACCOUNT` | Base64-encoded Admin SDK service account JSON |

---

## Threat Model

| Threat | Mitigation |
|--------|-----------|
| Fake payment (forged success) | HMAC-SHA256 signature verification on backend |
| Replay attack (reuse payment ID) | Deduplication via `payments` collection |
| Timing oracle on signature | `crypto.timingSafeEqual` comparison |
| SessionStorage PRO unlock | Check removed; only Firestore/Firebase Auth trusted |
| Price manipulation (pay less) | Plan prices hardcoded server-side |
| Firestore direct write | Security rules block all client writes |
| CSRF (cross-site payment) | CSRF token required on all mutating API calls |
| API abuse / DoS | Rate limiting: 5 req/min per user |
| Injection attacks | Regex validation on all payment inputs |
| Secrets in frontend | All keys server-side via environment variables |
