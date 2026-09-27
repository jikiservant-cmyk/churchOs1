/**
 * Signing outbound webhook notifications.
 *
 * Two callers send notifications to partner applications — the payment
 * completion path (`payments.ts`) and the SMS delivery path (`sms-queue.ts`) —
 * and they must sign identically, because a partner implements one verifier.
 * They previously did not: `sms-queue.ts` built its own bare HMAC with no
 * timestamp and additionally sent `Authorization: Bearer <secret>`, while the
 * payment path sent a timestamped `t=...,v=...` signature and no Authorization
 * header. A partner could therefore only satisfy one of them.
 *
 * This module exists so both callers use one implementation, and so that
 * implementation is testable: `payments.ts` pulls in `db` (which constructs a
 * PrismaClient at import time) and therefore cannot be reached from the test
 * runner.
 *
 * Two properties are worth stating because they are the point:
 *
 *   1. The timestamp is *inside* the signed string, so a captured body cannot be
 *      replayed later with a fresh header — the receiver checks the timestamp is
 *      recent and that it matches what was signed.
 *   2. The secret is never placed in a header. It is a key, not a credential to
 *      present; sending it would copy it into every partner's proxy and log
 *      aggregator.
 *
 * Only Node's `crypto` is imported, so the type-stripped test runner can reach
 * it.
 */

import { createHmac } from 'crypto'

/** Header carrying the signed timestamp. */
export const NOTIFICATION_TIMESTAMP_HEADER = 'X-Najiki-Timestamp'
/** Header carrying `t=<timestamp>,v=<hex hmac>`. */
export const NOTIFICATION_SIGNATURE_HEADER = 'X-Najiki-Signature'
/** Marks the request as one of ours, so a partner can route it. */
export const NOTIFICATION_MARKER_HEADER = 'X-Najiki-Notification'

/**
 * Build the outbound webhook headers, including the timestamped HMAC used for
 * replay protection on the receiving application.
 *
 * `now` is injectable so the signature can be tested deterministically; callers
 * omit it.
 */
export function buildNotificationHeaders(
  secret: string | null | undefined,
  payloadString: string,
  now: number = Date.now()
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    [NOTIFICATION_MARKER_HEADER]: 'true',
  }

  if (secret) {
    const timestamp = now
    const signature = createHmac('sha256', secret)
      .update(`${timestamp}.${payloadString}`)
      .digest('hex')
    headers[NOTIFICATION_TIMESTAMP_HEADER] = String(timestamp)
    headers[NOTIFICATION_SIGNATURE_HEADER] = `t=${timestamp},v=${signature}`
  }

  return headers
}

/**
 * Verify a signature this module produced. Provided so a partner implementation
 * can be cross-checked against ours, and used by the tests.
 *
 * `maxSkewMs` bounds replay: a signature older than this is rejected even though
 * the HMAC itself is valid.
 */
export function verifyNotificationSignature(input: {
  secret: string
  payloadString: string
  timestamp: string | number | null | undefined
  signature: string | null | undefined
  now?: number
  maxSkewMs?: number
}): boolean {
  const { secret, payloadString, timestamp, signature } = input
  const now = input.now ?? Date.now()
  const maxSkewMs = input.maxSkewMs ?? 5 * 60 * 1000

  if (!secret || !signature || timestamp === null || timestamp === undefined) return false

  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) return false
  if (Math.abs(now - ts) > maxSkewMs) return false

  const expected = `t=${ts},v=${createHmac('sha256', secret)
    .update(`${ts}.${payloadString}`)
    .digest('hex')}`

  return expected === signature
}
