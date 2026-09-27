# churchOs ↔ Na'jiki Finance integration

The contract Na'jiki Finance exposes to partner applications, and how churchOs
conforms to it.

- **Upstream:** <https://github.com/jikiservant-cmyk/najiki-finance2>
- **Verified against commit:** `1155fc375047dd2e2f3b937441c1de93b13cd7f9`
- ** churchOs implementation:** `lib/najiki/client.ts` (outbound), `lib/najiki/webhook.ts` (inbound)
- **Tests:** `tests/najiki-contract.test.ts`

Na'jiki is the source of truth. Everything below was read out of its source; the
few genuinely undocumented points are called out in
[Ambiguities and open questions](#ambiguities-and-open-questions).

---

## 1. Endpoints the church app calls

| Method | Path | Purpose | churchOs caller |
| --- | --- | --- | --- |
| `POST` | `/api/messaging/send` | Queue one SMS | `sendNajikiSms()` ← `lib/sms-actions.ts` |
| `POST` | `/api/payments` | Create a payment intent | `createNajikiPayment()` ← `lib/wallet-actions.ts` |
| `GET` | `/api/payments/:reference` | Read a payment's status | `getNajikiPayment()` |

Two more endpoints exist but are **not** for partners: `/api/messaging/quick-send`
requires a super-admin Supabase session, and `/api/messaging/callback` is
Na'jiki's own provider callback.

### Authentication

`Authorization: Bearer <application api key>` — on **every** endpoint.

| Endpoint | Accepted schemes |
| --- | --- |
| `POST /api/payments` | `Authorization: Bearer` **only** |
| `GET /api/payments/:reference` | `Authorization: Bearer` only |
| `POST /api/messaging/send` | `Authorization: Bearer` (with or without the `Bearer ` prefix), or `x-api-key`, or an `apiKey` field in the body |

`/api/payments` reads nothing else: a request authenticated with `x-api-key` is
rejected with `401 {"error":"Missing or invalid authorization header"}`. This is
what the donation fallback used to do.

The key is looked up by SHA-256 hash against `applications.apiKeyHash` (with a
fallback to the legacy cleartext column for un-migrated rows), filtered on
`isActive: true`.

### `POST /api/messaging/send`

Request body:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `to` | string | **yes** | Recipient. Na'jiki re-normalises to E.164 via `normalizeToE164()` before handing it to Africa's Talking. |
| `message` | string | **yes** | Body text. |
| `applicationCode` | string | no | **Must equal the authenticated application's `code`** or Na'jiki answers `403 {"error":"Application code mismatch"}`. |
| `from` | string | no | Sender ID. `from \|\| senderId` wins; only attached when non-empty and the AT username is not `sandbox`. |
| `senderId` | string | no | Alias of `from`. |
| `apiKey` | string | no | Body-level auth fallback; not needed when the header is set. |
| `idempotencyKey` | string | no | Body fallback for the `Idempotency-Key` header. |

Headers: `Authorization`, `Content-Type: application/json`, and optionally
`Idempotency-Key` (≤255 chars, trimmed; the body field is the fallback).

Responses:

```jsonc
// 202 Accepted
{
  "success": true,
  "message": "SMS send job queued successfully",   // or "Duplicate request — the original SMS job was returned"
  "smsId": "clx…",          // Na'jiki's UUID
  "reference": "SMS-…",     // Na'jiki's own SMS reference
  "status": "queued",       // 'queued' | 'pending' | 'delivered' | 'failed'
  "deduplicated": false,    // true when the idempotency key was already used
  "createdAt": "2026-01-01T00:00:00.000Z"
}
```

Errors: `400 {"error":"Recipient (to) and message content are required"}`,
`401 {"error":"Invalid or missing API key"}`,
`403 {"error":"Application code mismatch"}`,
`429` (rate limit, with `Retry-After`), `500 {"error":"Internal server error"}`.

Rate limits (Upstash, per minute): 120 per client IP (`sms-ip`), 60 per API key
(`sms-key`).

Idempotency: `SmsMessage @@unique([applicationId, idempotencyKey])`. A repeat of
the same key returns the original job with `deduplicated: true` and does **not**
enqueue a second send. Delivery is asynchronous — the 202 only means "queued".

### `POST /api/payments`

Request body (`CreatePaymentRequestSchema`, validated before any DB write):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `applicationCode` | string | **yes** | Must match the authenticated application, else `401`. |
| `paymentTypeCode` | string | **yes** | Resolved against `payment_types` for this application. Unknown ⇒ stored with `paymentTypeId: null` (not an error). |
| `externalEntityId` | string | **yes** | Opaque; churchOs sends the church id. Echoed back in the webhook. |
| `amount` | number | **yes** | Finite, `> 0`, `≤ 999999999999.99`. **Major units.** UGX is zero-decimal, so `5000` means UGX 5,000 — never multiply by 100. |
| `currency` | string | no (default `UGX`) | Exactly three letters, upper-cased by Na'jiki. |
| `phoneNumber` | string | **yes** | 9–15 chars. The LivePay adapter runs `normalizePhone()`, which strips a leading `+`; send digits-only E.164 (`2567…`). |
| `idempotencyKey` | string | **yes** | Min 8 chars. Generated by the caller, once per attempt. |
| `tenantCode` | string | no | Resolved as `(applicationId, code, isActive)`. Unknown ⇒ `404 {"error":"Invalid or inactive tenant"}`. |
| `providerCode` | string | no | Only `livepay` has a working adapter; anything else ⇒ `400` with `availableProviders`. |
| `metadata` | object | no (default `{}`) | Opaque passthrough, echoed back verbatim in the settlement webhook. |
| `description` | string | no | Read from the raw body (not in the schema) and used as the provider charge description. |

Response `200`:

```jsonc
{ "paymentId": "clx…", "reference": "CHURCH-TOP-…", "status": "processing" }
```

Na'jiki **generates its own reference** (`generateReference()`:
`<APP>-<TYPE>-<hex time>-<hex rand>`) and returns it as `reference`. There is no
`paymentIntentId` field in the response.

Errors: `400 {"error":"Validation failed","details":["amount: …", …]}` (Zod),
`401 {"error":"Missing or invalid authorization header"}` /
`{"error":"Invalid or inactive application, or invalid API key"}`,
`404 {"error":"Invalid or inactive tenant"}`,
`503` when no implemented provider is active or the tenant points at one.

Rate limits: 60/min per IP (`payments-ip`), 20/min per API key (`payments-key`).

Idempotency: the key is unique per `(applicationId, idempotencyKey)`. A repeat
returns the **original** intent (`paymentId`, `reference`, `status`) with no new
row — which is why the church app must not treat a repeat as a new payment.

Payment lifecycle: the intent is created and `processPayment()` is called
**synchronously**, so the response status is whatever LivePay said at that
moment (`processing` until the member approves). The terminal result arrives via
webhook. An ambiguous network failure during initiation is deliberately left as
`processing`, not `failed`.

### `GET /api/payments/:reference`

`Authorization: Bearer`. Scoped to the calling application — another
application's payment is `404`, not `403`. Returns `id`, `reference`, `status`,
`amount`, `currency`, `phoneNumber`, `externalEntityId`, `provider`,
`providerPaymentId`, `failureReason`, `createdAt`, `updatedAt`, `completedAt`.
If the intent is `processing` and was last touched more than 15 s ago, Na'jiki
polls the provider and, on a terminal change, fires the settlement webhook.
Sliding window: 60/min per API key.

---

## 2. What Na'jiki sends back to the church app

Both notifications are signed identically by `buildNotificationHeaders()`
(`src/lib/notification-signature.ts`):

```
X-Najiki-Timestamp: <unix ms>
X-Najiki-Signature: t=<unix ms>,v=<hex hmac>
X-Najiki-Notification: true
Content-Type: application/json

v = HMAC-SHA256(secret, "<timestamp>.<raw request body>")
```

- The secret is the application's `webhookSecret` — a **separate** credential
  from the API key. For applications provisioned before that column existed,
  Na'jiki signs with the API key.
- **Reject anything more than 5 minutes old.**
- Delivery is retried with exponential backoff (via QStash when configured),
  so the handler must be idempotent.

### Payment settlement

`InternalNotificationPayloadSchema` — terminal statuses only
(`success | failed | expired | cancelled`):

```jsonc
{
  "paymentIntentId": "clx…",
  "reference": "CHURCH-TOP-…",     // Na'jiki's reference, NOT ours
  "status": "success",
  "amount": 20000,
  "currency": "UGX",
  "providerPaymentId": "prov_…",
  "failureReason": null,
  "externalEntityId": "<church id>",
  "metadata": { … }                // verbatim echo of what we sent
}
```

There is **no** `tenantCode`, no `idempotencyKey` and no `eventType` at the top
level. Anything the church app needs for reconciliation must travel in
`metadata` — which is why the builders in `lib/najiki/client.ts` stamp
`metadata.churchReference`, `metadata.tenantCode`, `metadata.churchId` and (for
donations) `metadata.donorPhone`.

### SMS delivery

```jsonc
{
  "eventType": "SMS_DELIVERY_UPDATE",
  "smsId": "clx…",
  "reference": "SMS-…",
  "status": "delivered",            // or "failed"
  "providerId": "AT+…",             // Africa's Talking message id
  "recipient": "+256…",
  "applicationCode": "church"
}
```

This is the only thing that can move an SMS from `queued` to `delivered`/`failed`.

---

## 3. Sequencing rules the church app respects

1. **Payment confirmed before the receipt SMS.** Na'jiki only notifies on
   terminal statuses, and the wallet credit must land first.
   `planPaymentReceiptSms()` returns `null` for anything other than
   `status === 'success'`, and `app/api/najiki/webhook/route.ts` calls
   `sendPaymentReceipt()` only after `process_topup_webhook` has succeeded. A
   failed receipt is logged and never fails the payment.
2. **SMS receipt idempotency.** The receipt's idempotency key is
   `receipt_<paymentIntentId>`, so a webhook redelivery cannot bill the church
   twice.
3. **Send idempotency.** `lib/sms-actions.ts` forwards its own
   `idempotency_key` as Na'jiki's `Idempotency-Key`. When Na'jiki answers
   `deduplicated: true`, the wallet is **not** debited again.
4. **Payment idempotency.** One `idempotencyKey` per attempt
   (`ik_church_<uuid>` / `ik_don_<uuid>`), generated before the request and
   stored on the pending ledger row, so a retry returns the same intent.
5. **No silent fallback on a rejection.** A 4xx from Na'jiki (bad credentials,
   validation failure, app-code mismatch, rate limit) is surfaced to the caller
   and logged; only "not configured" or "unreachable / 5xx" falls back to the
   direct Africa's Talking path. See `shouldFallBackToAfricasTalking()`.

---

## 4. Configuration checklist

| Na'jiki side | Value |
| --- | --- |
| Application `code` | `church` (must equal `NAJIKI_APPLICATION_CODE`) |
| Application `baseUrl` | the church app's public origin |
| Application `webhookPath` | `/api/webhooks/najiki` (or `/api/najiki/webhook`) |
| Application `webhookSecret` | copy into `NAJIKI_WEBHOOK_SECRET` |
| Tenant `code` | the church's `public.tenants.code` (or its slug) |
| Payment types | create `topup` / `donation`, or point `NAJIKI_PAYMENT_TYPE_*` at existing codes |

`ALLOWED_ORIGINS` on the Na'jiki side only affects browser CORS preflight; the
church app calls the API from the server, so it is not required for this
integration.

---

## 5. Mismatches found and fixed

Full detail in the commit history of `fix/church-os-najiki-integration`.
Summary:

| # | Where | Was | Now |
| --- | --- | --- | --- |
| 1 | `app/api/najiki/webhook/route.ts` | Expected `x-najiki-signature: sha256=<hmac(rawBody)>` — a scheme Na'jiki has never sent. Every webhook was rejected 403, so no Na'jiki payment ever credited a wallet. | Verifies `X-Najiki-Timestamp` + `X-Najiki-Signature: t=,v=` over `<ts>.<rawBody>` with a 5-minute replay window, timing-safe compare, fail-closed. |
| 2 | `app/api/najiki/webhook/route.ts` | Reconciled on top-level `tenantCode` / `idempotencyKey`, which Na'jiki does not send — the tenant guard silently never ran. | Reads them from `metadata`; reconciles on `metadata.churchReference` first. |
| 3 | `lib/wallet-actions.ts` | Read `result.paymentIntentId` from the response; Na'jiki returns `paymentId`, so the provider response was never stored and the UI got `undefined`. | Reads `paymentId` / `reference`; persists Na'jiki's reference on the row. |
| 4 | `lib/wallet-actions.ts` (donation fallback) | Authenticated with `x-api-key`, which `POST /api/payments` rejects with 401. | `Authorization: Bearer` via the shared client. |
| 5 | `lib/wallet-actions.ts` | `.eq('reference', …)` on error paths — `wallet_transactions.reference` is never populated, so failed payments were never marked failed. | `.eq('reference_code', …)`. |
| 6 | `lib/sms-actions.ts` | Never sent an idempotency key to Na'jiki, so a retried broadcast was a second, separately billed SMS. | Sends `Idempotency-Key`; skips the wallet debit when `deduplicated: true`. |
| 7 | `lib/sms-actions.ts` | Swallowed every Na'jiki error and fell back to Africa's Talking — a 401/403/400 looked like a provider outage. | 4xx are surfaced and logged; only config/5xx/network fall back. |
| 8 | `lib/sms-actions.ts` | Required `NAJIKI_API_URL`, which was not in `.env.example` — so in practice Na'jiki was always "unconfigured" and every SMS went out via the direct AT path. | `NAJIKI_API_URL` is optional and defaults to the deployed origin; missing variables are named explicitly. |
| 9 | `.env.example` | `NAJIKI_APPLICATION_CODE="CHURCH"` — Na'jiki seeds the church application as lowercase `church`, so this value is rejected (403/401). | Defaults to `church`, with the reason documented. |
| 10 | `app/api/najiki/webhook/route.ts` | Only `status === 'failed'` was treated as a failure; `expired` / `cancelled` were logged as "still pending" and left the ledger row pending forever. | `failed`, `expired` and `cancelled` are terminal failures. |
| 11 | Giving portal | The confirmation SMS was never sent at all (the client-side comment said it should come from the webhook). | Sent from the webhook, after the payment is confirmed and the wallet credited. |

---

## Ambiguities and open questions

1. **No sandbox / test keys.** Na'jiki documents no test mode, and `LIVEPAY_*`
   credentials are required in production. There is no way to exercise the real
   provider from here without live keys — see
   [Verification](#verification) for what was actually run.
2. **`paymentTypeCode` values.** The seeded church application has only `tithe`
   and `offering`. `topup` / `donation` are not rejected, but they are not
   categorised either. Someone with Na'jiki admin access should create the two
   rows (or set `NAJIKI_PAYMENT_TYPE_TOPUP` / `NAJIKI_PAYMENT_TYPE_DONATION`).
3. **`tenantCode` for each church.** Na'jiki resolves tenants per application.
   churchOs sends `public.tenants.code` → church slug → `NAJIKI_TENANT_CODE`.
   Whichever is used must exist as a tenant row in Na'jiki, otherwise the
   payment is rejected 404. This is per-church configuration and cannot be
   verified from here.
4. **Webhook secret vs API key.** Na'jiki signs with the application's
   `webhookSecret` when present and falls back to the API key. churchOs accepts
   either, in that order. If a church app row has a distinct `webhookSecret`,
   `NAJIKI_WEBHOOK_SECRET` must be set to it.
5. **Donations still prefer direct LivePay.** `initiateDonationPayment()` calls
   LivePay directly when `LIVEPAY_API_KEY` + `LIVEPAY_ACCOUNT_NO` are set, and
   only falls back to Na'jiki. Routing every payment through Na'jiki (so the
   ledger, wallet and webhooks live in one place) is a product decision that
   needs a human.
6. **`/api/payments/collect`** still calls LivePay directly with its own
   reference. Same decision as above.
7. **Deployed Na'jiki unreachable from this environment.**
   `https://najiki.netlify.app` does not answer here (TLS handshake fails), so
   the live smoke test could not be run. Re-run it from a network that can reach
   the deployment.

---

## Verification

`npm test` (31 assertions, all passing) drives churchOs' real client over TCP
against a mock that enforces Na'jiki's **own** Zod schema
(`tests/fixtures/najiki/schemas.ts`, vendored verbatim):

- a church top-up and a donation payload are accepted unmodified, and the stored
  intent is asserted field by field;
- amount is major units (`toMinorUnits(5000,'UGX') === 5000n`, and the stored
  amount is `5000`);
- phone numbers are digits-only E.164 (`/^256\d{9}$/`);
- the same `Idempotency-Key` twice ⇒ one send, `deduplicated: true`;
- a dropped `idempotencyKey` ⇒ `400 Validation failed` with the field-level
  `details` surfaced through `NajikiApiError`;
- `NAJIKI_APPLICATION_CODE="CHURCH"` ⇒ 403 on SMS, 401 on payments;
- `x-api-key` auth ⇒ 401 on `/api/payments`;
- unknown tenant ⇒ 404; `GET /api/payments/:reference` round-trips;
- a notification signed by Na'jiki's own `buildNotificationHeaders()` verifies,
  and a tampered body, a stale timestamp, a wrong secret and the legacy
  `x-najiki-signature` scheme are all rejected;
- the receipt-SMS sequencing rule holds for every non-success status.

Live end-to-end against the deployed gateway was **not** possible from this
sandbox (see ambiguity 7) — the acceptance evidence above comes from Na'jiki's
own validator running on the exact bytes churchOs sends.

### Live smoke test of the webhook route

`next dev` was started with a webhook secret and no Supabase (so the route's
pre-database paths could be exercised), and real requests were posted to
`/api/najiki/webhook`, signed with Na'jiki's own `buildNotificationHeaders()`:

| Request | Result |
| --- | --- |
| signed, unrecognised shape | `200 {"received":true,"ignored":true}` |
| signed, payment notification with no `paymentIntentId` | `200 {"received":true}` |
| signed, full payment notification | `500` — reached the DB stage and failed on `supabaseUrl is required` (no Supabase in this sandbox), returned as a retryable 500 by the new guard |
| signed, SMS delivery update | `500` — same DB-stage failure |
| unsigned | `403 Missing x-najiki-timestamp / x-najiki-signature headers` |
| timestamp 6 minutes old | `403 Timestamp outside the 5-minute replay window` |
| signed body A, sent body B | `403 Signature mismatch` |
| legacy `x-najiki-signature` only | `403 Missing … headers` |

So signature verification, replay protection and the fail-closed guard are
confirmed working in the real Next.js runtime. What could not be exercised
without a database is the ledger write and the receipt SMS.
