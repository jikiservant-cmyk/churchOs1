/**
 * lib/najiki/webhook.ts
 *
 * Verification and parsing for the webhooks Na'jiki Finance POSTs back to the
 * church app when a payment reaches a terminal state, and when an SMS is
 * delivered or fails.
 *
 * ⚠️ Plain `crypto` + `process.env` only — no `next/*`, no `@supabase/*` — so
 * the contract tests in `tests/` can exercise it directly.
 *
 * ── Na'jiki's signing scheme (source: najiki-finance2) ───────────────────────
 * `src/lib/notification-signature.ts`:
 *
 *   X-Najiki-Timestamp: <unix ms>
 *   X-Najiki-Signature: t=<unix ms>,v=<hex hmac>
 *   X-Najiki-Notification: true
 *   Content-Type: application/json
 *
 *   v = HMAC-SHA256(secret, "<timestamp>.<raw request body>")
 *
 * Both the payment path (`src/lib/payments.ts`) and the SMS path
 * (`src/lib/sms-queue.ts`) sign through that one helper, so one verifier covers
 * both. The secret is the application's `webhookSecret` (a separate credential
 * from the API key); for applications provisioned before that column existed
 * Na'jiki signs with the API key, which is why the church app accepts either.
 *
 * The church app used to expect `x-najiki-signature: sha256=<hmac(rawBody)>`
 * with no timestamp. Na'jiki has never sent that, so every payment webhook was
 * rejected with 403 and no wallet was ever credited by Na'jiki.
 */

import { createHmac, timingSafeEqual } from 'crypto'

/** Header names exactly as Na'jiki spells them. */
export const NAJIKI_TIMESTAMP_HEADER = 'x-najiki-timestamp'
export const NAJIKI_SIGNATURE_HEADER = 'x-najiki-signature'
export const NAJIKI_MARKER_HEADER = 'x-najiki-notification'

/**
 * Replay window. Na'jiki's README: "Reject requests whose timestamp is more
 * than 5 minutes old."
 */
export const NAJIKI_WEBHOOK_MAX_SKEW_MS = 5 * 60 * 1000

export type HeaderSource = Headers | Record<string, string> | Map<string, string>

function readHeader(source: HeaderSource, name: string): string | null {
  if (!source) return null
  if (typeof (source as Headers).get === 'function') {
    return (source as Headers).get(name)
  }
  if (source instanceof Map) return source.get(name) ?? source.get(name.toLowerCase()) ?? null
  const record = source as Record<string, string>
  const direct = record[name] ?? record[name.toLowerCase()]
  if (direct !== undefined) return direct
  // Node lowercases inbound header names, but be tolerant of either case.
  const key = Object.keys(record).find((k) => k.toLowerCase() === name)
  return key ? record[key] : null
}

export interface WebhookVerificationResult {
  ok: boolean
  reason?: string
  /** The signed timestamp, when verification succeeded. */
  timestamp?: number
}

/**
 * Verify a Na'jiki-signed webhook.
 *
 * Fails closed: a missing secret, missing header, malformed signature,
 * timestamp skew beyond the window, or any HMAC mismatch is a rejection.
 */
export function verifyNajikiWebhook(input: {
  rawBody: string
  headers: HeaderSource
  secret: string | null | undefined
  now?: number
  maxSkewMs?: number
}): WebhookVerificationResult {
  const { rawBody, headers, secret } = input
  const now = input.now ?? Date.now()
  const maxSkewMs = input.maxSkewMs ?? NAJIKI_WEBHOOK_MAX_SKEW_MS

  if (!secret || !secret.trim()) {
    return { ok: false, reason: 'Webhook secret is not configured' }
  }

  const timestampHeader = readHeader(headers, NAJIKI_TIMESTAMP_HEADER)
  const signatureHeader = readHeader(headers, NAJIKI_SIGNATURE_HEADER)

  if (!timestampHeader || !signatureHeader) {
    return {
      ok: false,
      reason: `Missing ${NAJIKI_TIMESTAMP_HEADER} / ${NAJIKI_SIGNATURE_HEADER} headers`,
    }
  }

  const timestamp = Number(timestampHeader)
  if (!Number.isFinite(timestamp)) {
    return { ok: false, reason: 'Malformed X-Najiki-Timestamp' }
  }

  if (Math.abs(now - timestamp) > maxSkewMs) {
    return { ok: false, reason: 'Timestamp outside the 5-minute replay window' }
  }

  // `t=<timestamp>,v=<hmac>`
  const parts = String(signatureHeader)
    .split(',')
    .map((p) => p.trim())
  const t = parts.find((p) => p.startsWith('t='))?.slice(2)
  const v = parts.find((p) => p.startsWith('v='))?.slice(2)

  if (!v || !/^[0-9a-f]+$/i.test(v)) {
    return { ok: false, reason: 'Malformed X-Najiki-Signature' }
  }
  // The timestamp in the header must be the one that was signed.
  if (t !== undefined && Number(t) !== timestamp) {
    return { ok: false, reason: 'Signature timestamp does not match the header' }
  }

  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex')

  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(v, 'utf8')
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'Signature mismatch' }
  }

  return { ok: true, timestamp }
}

// ─────────────────────────────────────────────────────────────────────────────
// Payload shapes
// ─────────────────────────────────────────────────────────────────────────────

/** Terminal statuses Na'jiki notifies about (InternalNotificationPayloadSchema). */
export const NAJIKI_PAYMENT_STATUSES = ['success', 'failed', 'expired', 'cancelled'] as const
export type NajikiPaymentStatus = (typeof NAJIKI_PAYMENT_STATUSES)[number]

/** `SMS_DELIVERY_UPDATE` bodies from src/lib/sms-queue.ts. */
export const NAJIKI_SMS_DELIVERY_EVENT = 'SMS_DELIVERY_UPDATE'

export interface NajikiPaymentNotification {
  paymentIntentId: string
  reference: string
  status: string
  amount: number | null
  currency: string | null
  providerPaymentId: string | null
  failureReason: string | null
  /** churchOs' church id, echoed back opaquely. */
  externalEntityId: string | null
  /** Opaque passthrough of whatever metadata we sent with the payment. */
  metadata: Record<string, unknown>
}

export interface NajikiSmsDeliveryNotification {
  smsId: string
  reference: string | null
  /** 'delivered' | 'failed' */
  status: string
  providerId: string | null
  recipient: string | null
  applicationCode: string | null
}

export type NajikiWebhookKind = 'sms_delivery' | 'payment' | 'unknown'

/** Distinguish the two webhook families Na'jiki sends. */
export function classifyNajikiWebhook(payload: unknown): NajikiWebhookKind {
  if (!payload || typeof payload !== 'object') return 'unknown'
  const record = payload as Record<string, unknown>
  if (record.eventType === NAJIKI_SMS_DELIVERY_EVENT) return 'sms_delivery'
  if (typeof record.paymentIntentId === 'string' || typeof record.reference === 'string') {
    return 'payment'
  }
  return 'unknown'
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

export function parsePaymentNotification(
  payload: unknown
): NajikiPaymentNotification | null {
  if (!payload || typeof payload !== 'object') return null
  const p = payload as Record<string, unknown>
  const metadata =
    p.metadata && typeof p.metadata === 'object' && !Array.isArray(p.metadata)
      ? (p.metadata as Record<string, unknown>)
      : {}

  return {
    paymentIntentId: str(p.paymentIntentId) ?? '',
    reference: str(p.reference) ?? '',
    status: str(p.status) ?? '',
    amount: typeof p.amount === 'number' && Number.isFinite(p.amount) ? p.amount : null,
    currency: str(p.currency),
    providerPaymentId: str(p.providerPaymentId),
    failureReason: str(p.failureReason),
    externalEntityId: str(p.externalEntityId),
    metadata,
  }
}

export function parseSmsDeliveryNotification(
  payload: unknown
): NajikiSmsDeliveryNotification | null {
  if (!payload || typeof payload !== 'object') return null
  const p = payload as Record<string, unknown>
  return {
    smsId: str(p.smsId) ?? '',
    reference: str(p.reference),
    status: str(p.status) ?? '',
    providerId: str(p.providerId),
    recipient: str(p.recipient),
    applicationCode: str(p.applicationCode),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconciliation: matching a Na'jiki notification to a churchOs ledger row
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Na'jiki generates its own `reference` (`CHURCH-TOP-<hex>-<hex>`) and never
 * echoes the church app's reference back, so the church app cannot reconcile on
 * `reference` alone. We therefore stamp our own reference into the payment
 * `metadata` (`churchReference`) and look that up first.
 *
 * The candidates are returned in priority order; each is an exact-match lookup
 * on `public.wallet_transactions`.
 */
export function transactionLookupCandidates(
  notification: NajikiPaymentNotification
): Array<{ column: 'reference_code' | 'reference' | 'idempotency_key'; value: string }> {
  const candidates: Array<{
    column: 'reference_code' | 'reference' | 'idempotency_key'
    value: string
  }> = []

  const churchReference = str(notification.metadata.churchReference)
  if (churchReference) {
    candidates.push({ column: 'reference_code', value: churchReference })
  }

  // Na'jiki's own reference — we persist it into `wallet_transactions.reference`
  // when the payment is created, so this is a real cross-check, not a guess.
  if (notification.reference) {
    candidates.push({ column: 'reference', value: notification.reference })
  }

  const idempotencyKey = str(notification.metadata.idempotencyKey)
  if (idempotencyKey) {
    candidates.push({ column: 'idempotency_key', value: idempotencyKey })
  }

  return candidates
}

/**
 * The tenant code we sent in `metadata`. Na'jiki does not put `tenantCode` at
 * the top level of the notification, so reading it from the top level (as the
 * church app used to) always yielded undefined and silently disabled the
 * tenant-mismatch guard.
 */
export function notificationTenantCode(
  notification: NajikiPaymentNotification
): string | null {
  return str(notification.metadata.tenantCode)
}

/** The church id we sent as `externalEntityId`, when present. */
export function notificationChurchId(
  notification: NajikiPaymentNotification
): string | null {
  return str(notification.metadata.churchId) ?? notification.externalEntityId
}

// ─────────────────────────────────────────────────────────────────────────────
// Sequencing: the payment receipt SMS
// ─────────────────────────────────────────────────────────────────────────────

export interface ReceiptSmsPlan {
  /** Deterministic idempotency key — a webhook retry must not re-bill. */
  idempotencyKey: string
  to: string
  message: string
}

/**
 * Decide whether a confirmed payment should trigger an SMS receipt.
 *
 * The ordering rule this enforces: **the payment must already be confirmed
 * (status === 'success') before any receipt SMS is queued**. Na'jiki only
 * notifies on terminal statuses, and the wallet credit has to land first —
 * sending a receipt for a payment that then fails would be a lie to the member
 * and an unrecoverable SMS charge.
 *
 * Receipts are limited to public donations, where we know the payer's number
 * from `metadata.donorPhone`. Admin wallet top-ups have no member-facing
 * recipient, so no SMS is sent for them.
 */
export function planPaymentReceiptSms(input: {
  notification: NajikiPaymentNotification
  transactionType: string | null
  churchName?: string | null
}): ReceiptSmsPlan | null {
  const { notification, transactionType } = input

  if (notification.status !== 'success') return null
  if ((transactionType ?? '').toUpperCase() !== 'DONATION') return null

  const to = str(notification.metadata.donorPhone)
  if (!to) return null

  const churchName = (input.churchName ?? 'your church').trim() || 'your church'
  const amount =
    notification.amount !== null
      ? `${notification.currency ?? 'UGX'} ${notification.amount.toLocaleString('en-US')}`
      : 'your gift'

  return {
    // Keyed on Na'jiki's payment id so a redelivery of the same notification is
    // deduplicated by Na'jiki's (application, idempotencyKey) unique index.
    idempotencyKey: `receipt_${notification.paymentIntentId || notification.reference}`,
    to,
    message:
      `Thank you for your gift to ${churchName}! We have received ${amount}. ` +
      `Reference: ${notification.reference}. God bless you.`,
  }
}
