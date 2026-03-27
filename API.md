# AltScalp PRO — API Documentation

## Base URL

**Production**: `https://altscalp-pro.vercel.app`  
**Local dev**: `http://localhost:3001`

---

## Authentication

All endpoints (except webhooks and CSRF token issuance) require a Firebase ID token:

```
Authorization: Bearer <firebase-id-token>
```

Obtain the token in the browser:

```javascript
const idToken = await firebase.auth().currentUser.getIdToken(true);
```

---

## CSRF Protection

Mutating endpoints (`POST`) require a CSRF token:

1. Fetch a token: `GET /api/csrf-token`
2. Include in request: `X-CSRF-Token: <token>`

---

## Endpoints

### `GET /api/csrf-token`

Issues a CSRF token cookie and returns the token value.

**Response** `200`
```json
{ "csrfToken": "a3f9c2...64e1" }
```

---

### `POST /api/create-order`

Creates a Razorpay payment order server-side.

**Headers**
```
Authorization: Bearer <id-token>
Content-Type: application/json
X-CSRF-Token: <csrf-token>
```

**Body**
```json
{ "plan": "monthly" }
```

| Field | Type | Values |
|-------|------|--------|
| `plan` | string | `monthly` \| `yearly` |

**Response** `200`
```json
{
  "orderId":  "order_XXXXXXXXXXXXXXXX",
  "amount":   64000,
  "currency": "INR",
  "key":      "rzp_live_XXXXXXXXXXXXXXXX"
}
```

**Errors**

| Status | Meaning |
|--------|---------|
| `400` | Invalid plan |
| `401` | Missing or expired token |
| `403` | CSRF token invalid |
| `429` | Rate limit exceeded (5 req/min) |
| `500` | Server error |

---

### `POST /api/verify-payment`

Verifies a Razorpay payment using HMAC-SHA256 signature and upgrades the user to PRO.

**Headers**
```
Authorization: Bearer <id-token>
Content-Type: application/json
X-CSRF-Token: <csrf-token>
```

**Body**
```json
{
  "razorpay_order_id":   "order_XXXXXXXXXXXXXXXX",
  "razorpay_payment_id": "pay_XXXXXXXXXXXXXXXX",
  "razorpay_signature":  "a3f9c2...64e1",
  "plan":                "monthly"
}
```

| Field | Type | Validation |
|-------|------|-----------|
| `razorpay_order_id` | string | Required, alphanumeric |
| `razorpay_payment_id` | string | Required, alphanumeric |
| `razorpay_signature` | string | Required, hex |
| `plan` | string | `monthly` \| `yearly` |

**Response** `200`
```json
{ "success": true }
```

**Errors**

| Status | Meaning |
|--------|---------|
| `400` | Signature mismatch or invalid input |
| `401` | Missing or expired token |
| `403` | CSRF token invalid |
| `404` | User not found in Firestore |
| `429` | Rate limit exceeded |
| `500` | Internal server error |

---

### `POST /webhooks/razorpay`

Razorpay webhook endpoint. Receives real-time payment events and automatically updates Firestore.

> ⚠️ This endpoint is called by Razorpay servers, not by the frontend.  
> Register the URL in: Razorpay Dashboard → Settings → Webhooks

**Headers** (set by Razorpay)
```
x-razorpay-signature: <hmac-sha256-hex>
Content-Type: application/json
```

**Handled events**

| Event | Action |
|-------|--------|
| `payment.captured` | Activates PRO subscription, deduplicates by payment ID |
| All others | Returns `200 { "status": "ignored" }` |

**Response** `200`
```json
{ "status": "success" }
```

---

### `GET /health`

Health check for uptime monitoring.

**Response** `200`
```json
{ "status": "ok", "ts": 1711555200000 }
```

---

## Plan Prices

| Plan | Amount (paise) | INR | USD (approx) |
|------|----------------|-----|--------------|
| `monthly` | 64,000 | ₹640 | ~$7 |
| `yearly` | 455,000 | ₹4,550 | ~$50 |

> Prices are hardcoded server-side. Any frontend value is ignored.

---

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| `/api/create-order` | 5 req/min per user |
| `/api/verify-payment` | 5 req/min per user |

Exceeded limits return `429 Too Many Requests` with a `Retry-After` header.
