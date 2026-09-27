/**
 * lib/najiki/client.ts
 *
 * The single, contract-conformant HTTP client for the Na'jiki Finance gateway
 * (https://github.com/jikiservant-cmyk/najiki-finance2).
 *
 * Everything the church app sends to Na'jiki goes through this file, so the
 * request shapes, headers and error handling only have to be correct once.
 * See NAJIKI_INTEGRATION.md for the full contract this implements.
 *
 * ⚠️ This module deliberately imports NOTHING from `next/*` or
 * `@supabase/*`. It is plain `fetch` + `process.env` so it can be exercised by
 * the contract tests in `tests/` with Node's built-in runner.
 *
 * ── Contract summary (source: najiki-finance2) ────────────────────────────────
 * POST {base}/api/messaging/send   → 202 { success, message, smsId, reference,
 *                                       status, deduplicated, createdAt }
 * POST {base}/api/payments         → 200 { paymentId, reference, status }
 * GET  {base}/api/payments/:ref    → 200 { id, reference, status, amount, ... }
 *
 * Auth: `Authorization: Bearer <application api key>`. `/api/payments` accepts
 *       ONLY this header (a bare `x-api-key` is a 401 there); `/api/messaging/send`
 *       additionally accepts `x-api-key` or a body `apiKey`, but the Bearer
 *       header is what both endpoints document.
 * Idempotency: `Idempotency-Key` request header (≤255 chars), or the
 *       `idempotencyKey` body field. Na'jiki dedupes payments per
 *       (application, idempotencyKey) and SMS per (application, idempotencyKey).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Na'jiki is deployed at this origin. Overridable with NAJIKI_API_URL so a
 * self-hosted or preview deployment can be pointed at without a code change.
 */
export const NAJIKI_DEFAULT_BASE_URL = 'https://najiki.netlify.app'

/**
 * The `code` of the church application row in Na'jiki's `applications` table.
 * `scripts/seed.ts` in najiki-finance2 seeds it as lowercase `church`
 * (`code: 'church', name: 'Church App'`).
 *
 * This matters: `/api/messaging/send` answers 403 "Application code mismatch"
 * when the body's `applicationCode` differs from the authenticated
 * application's `code`, and `/api/payments` filters its API-key lookup on
 * `{ code: body.applicationCode }`, so a mismatch surfaces as 401. Sending
 * "CHURCH" (as .env.example used to say) is rejected.
 */
export const NAJIKI_DEFAULT_APPLICATION_CODE = 'church'

/** Money is always UGX in churchOs; Na'jiki defaults to UGX as well. */
export const NAJIKI_DEFAULT_CURRENCY = 'UGX'

/** Na'jiki truncates idempotency keys to 255 chars — do the same, explicitly. */
export const NAJIKI_MAX_IDEMPOTENCY_KEY_LENGTH = 255

export interface NajikiConfig {
  /** Origin without a trailing slash, e.g. https://najiki.netlify.app */
  baseUrl: string
  /** Partner API key — sent as `Authorization: Bearer <apiKey>`. */
  apiKey: string
  /** Application code, must equal the authenticated application's `code`. */
  applicationCode: string
  /** Outbound-webhook signing secret (falls back to the API key). */
  webhookSecret: string
  /** Per-request timeout in ms. */
  timeoutMs: number
}

/** Thrown when Na'jiki is not configured — never fall back to a bogus URL. */
export class NajikiConfigError extends Error {
  readonly missing: string[]

  constructor(missing: string[]) {
    super(
      `Na'jiki Finance is not configured: missing ${missing.join(', ')}. ` +
        'Set them in your environment (see .env.example).'
    )
    this.name = 'NajikiConfigError'
    this.missing = missing
  }
}

function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, '')
}

/**
 * Read and validate the Na'jiki connection settings.
 *
 * Throws {@link NajikiConfigError} naming every missing variable rather than
 * failing later with an opaque "fetch failed" — the previous code threw
 * 'Najiki configuration missing from environment variables' from deep inside
 * the SMS send path, which made a misconfiguration look like a provider outage.
 */
export function getNajikiConfig(): NajikiConfig {
  const apiKey = (process.env.NAJIKI_API_KEY ?? '').trim()
  const missing: string[] = []
  if (!apiKey) missing.push('NAJIKI_API_KEY')

  if (missing.length > 0) throw new NajikiConfigError(missing)

  const baseUrl = stripTrailingSlashes(
    (process.env.NAJIKI_API_URL ?? '').trim() || NAJIKI_DEFAULT_BASE_URL
  )

  // The webhook secret is a *separate* credential in Na'jiki
  // (Application.webhookSecretEncrypted, AES-256-GCM at rest). Na'jiki falls
  // back to the plaintext API key for rows provisioned before that column
  // existed, so we mirror that fallback instead of hard-failing.
  const webhookSecret =
    (process.env.NAJIKI_WEBHOOK_SECRET ?? '').trim() || apiKey

  return {
    baseUrl,
    apiKey,
    applicationCode:
      (process.env.NAJIKI_APPLICATION_CODE ?? '').trim() ||
      NAJIKI_DEFAULT_APPLICATION_CODE,
    webhookSecret,
    timeoutMs: Number.parseInt(process.env.NAJIKI_TIMEOUT_MS ?? '', 10) > 0
      ? Number.parseInt(process.env.NAJIKI_TIMEOUT_MS ?? '', 10)
      : 15_000,
  }
}

/** True when the minimum credentials are present (no throw). */
export function isNajikiConfigured(): boolean {
  try {
    getNajikiConfig()
    return true
  } catch {
    return false
  }
}

/**
 * The application code to put in a request body. Does not throw, so callers can
 * decide what to do when Na'jiki is not configured at all.
 */
export function najikiApplicationCode(): string {
  return (
    (process.env.NAJIKI_APPLICATION_CODE ?? '').trim() ||
    NAJIKI_DEFAULT_APPLICATION_CODE
  )
}

/**
 * The `paymentTypeCode` to send for a given product.
 *
 * Na'jiki resolves this against `payment_types` scoped to the application. The
 * seeded church application only has `tithe` and `offering`, so an operator who
 * wants `topup`/`donation` recorded must create those rows in Na'jiki's Setup
 * screen — or point these env vars at codes that already exist. An unknown code
 * is NOT rejected (Na'jiki stores `paymentTypeId: null`), it just means the
 * payment is not categorised on their side.
 */
export function najikiPaymentTypeCode(kind: 'topup' | 'donation'): string {
  const envName =
    kind === 'topup' ? 'NAJIKI_PAYMENT_TYPE_TOPUP' : 'NAJIKI_PAYMENT_TYPE_DONATION'
  return (process.env[envName] ?? '').trim() || kind
}

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

export interface NajikiApiErrorBody {
  error?: string
  message?: string
  details?: unknown
  [key: string]: unknown
}

/**
 * A Na'jiki response that was not 2xx.
 *
 * Carries the status, the `error` string and the `details` array Na'jiki
 * returns for validation failures
 * (`{ error: 'Validation failed', details: ['amount: ...', ...] }`) so callers
 * can surface something a human can act on instead of swallowing it.
 */
export class NajikiApiError extends Error {
  readonly status: number
  readonly error: string
  readonly details: string[]
  readonly body: NajikiApiErrorBody

  constructor(status: number, body: NajikiApiErrorBody, context: string) {
    const error = String(body?.error ?? body?.message ?? `HTTP ${status}`)
    const details = Array.isArray(body?.details)
      ? body.details.map((d) => String(d))
      : []
    super(
      `Na'jiki ${context} failed (${status}): ${error}` +
        (details.length > 0 ? ` — ${details.join('; ')}` : '')
    )
    this.name = 'NajikiApiError'
    this.status = status
    this.error = error
    this.details = details
    this.body = body ?? {}
  }

  /** True for 4xx — retrying the identical request cannot succeed. */
  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500
  }
}

/**
 * Whether a Na'jiki failure may be retried through another route.
 *
 * A 4xx means Na'jiki understood the request and refused it — bad credentials,
 * a payload that fails validation, an application-code mismatch, a rate limit.
 * Silently re-sending that through a different provider would hide a contract
 * bug and bill the church twice, so those errors are surfaced to the caller.
 *
 * Only "Na'jiki is not configured" and "Na'jiki is unreachable / 5xx" fall back.
 */
export function shouldFallBackToAfricasTalking(error: unknown): boolean {
  if (error instanceof NajikiConfigError) return true
  if (error instanceof NajikiApiError) return !error.isClientError
  // Network-level failure thrown by najikiRequest (DNS, TLS, timeout).
  return true
}

// ─────────────────────────────────────────────────────────────────────────────
// Transport
// ─────────────────────────────────────────────────────────────────────────────

export interface NajikiRequestOptions {
  /**
   * Idempotency key, sent as the `Idempotency-Key` header. Na'jiki also reads
   * an `idempotencyKey` body field; the header is the documented standard and
   * is what we send.
   */
  idempotencyKey?: string | null
  /** Overrides the configured timeout. */
  timeoutMs?: number
  /** Extra headers (never used to carry credentials). */
  headers?: Record<string, string>
}

function normaliseIdempotencyKey(key: string | null | undefined): string | null {
  if (!key) return null
  const trimmed = String(key).trim()
  if (!trimmed) return null
  return trimmed.slice(0, NAJIKI_MAX_IDEMPOTENCY_KEY_LENGTH)
}

/**
 * Perform one request against the Na'jiki partner API.
 *
 * Auth is `Authorization: Bearer <api key>` for every endpoint — this is the
 * only scheme `/api/payments` accepts. `Content-Type` is always JSON because
 * Na'jiki calls `request.json()` on both partner endpoints.
 */
export async function najikiRequest<T = unknown>(
  path: string,
  body?: unknown,
  options: NajikiRequestOptions = {}
): Promise<T> {
  const config = getNajikiConfig()
  const url = `${config.baseUrl}${path}`

  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${config.apiKey}`,
    ...options.headers,
  }

  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const idempotencyKey = normaliseIdempotencyKey(options.idempotencyKey)
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey

  const timeoutMs = options.timeoutMs ?? config.timeoutMs

  let response: Response
  try {
    response = await fetch(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    })
  } catch (networkError: any) {
    // Network/TLS/timeout: the request may or may not have been accepted.
    // Na'jiki treats an ambiguous initiate the same way (status stays
    // 'processing'), so surface it as retryable rather than as a rejection.
    const reason = networkError?.message ?? String(networkError)
    console.error(
      `[Najiki] Network error calling ${path} (${reason}). ` +
        'The request may not have reached Na\'jiki — safe to retry with the same idempotency key.'
    )
    throw new Error(`Na'jiki ${path} unreachable: ${reason}`)
  }

  const raw = await response.text()
  let parsed: NajikiApiErrorBody = {}
  if (raw) {
    try {
      parsed = JSON.parse(raw) as NajikiApiErrorBody
    } catch {
      parsed = { error: `Non-JSON response from Na'jiki: ${raw.slice(0, 300)}` }
    }
  }

  if (!response.ok) {
    // Logged, never silent: a rejected payload must be visible in the server
    // log with the reason Na'jiki gave.
    console.error(
      `[Najiki] ${path} rejected with ${response.status}:`,
      JSON.stringify(parsed).slice(0, 1000)
    )
    throw new NajikiApiError(response.status, parsed, path)
  }

  return parsed as T
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/messaging/send
// ─────────────────────────────────────────────────────────────────────────────

export interface NajikiSmsRequest {
  /** Recipient in E.164 (Na'jiki re-normalises, but send canonical form). */
  to: string
  message: string
  /** Optional sender ID → Na'jiki's `from` field (precedence: `from || senderId`). */
  from?: string | null
  idempotencyKey?: string | null
}

/** The 202 body Na'jiki returns from POST /api/messaging/send. */
export interface NajikiSmsResponse {
  success: boolean
  message: string
  smsId: string
  reference: string
  status: string
  /** True when this key was already used and no new SMS was queued. */
  deduplicated: boolean
  createdAt: string
}

/**
 * Queue one SMS through Na'jiki.
 *
 * Request body: `{ to, message, applicationCode, from? }` plus the
 * `Idempotency-Key` header. `applicationCode` must match the authenticated
 * application's `code` or Na'jiki answers 403.
 */
export async function sendNajikiSms(
  request: NajikiSmsRequest,
  options: NajikiRequestOptions = {}
): Promise<NajikiSmsResponse> {
  const config = getNajikiConfig()

  const payload: Record<string, unknown> = {
    to: request.to,
    message: request.message,
    applicationCode: config.applicationCode,
  }
  const sender = (request.from ?? '').trim()
  if (sender) payload.from = sender

  return najikiRequest<NajikiSmsResponse>('/api/messaging/send', payload, {
    ...options,
    idempotencyKey: request.idempotencyKey ?? options.idempotencyKey,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments  ·  GET /api/payments/:reference
// ─────────────────────────────────────────────────────────────────────────────

export interface NajikiCreatePaymentRequest {
  applicationCode: string
  tenantCode?: string | null
  paymentTypeCode: string
  /** The church id in churchOs' own database — stored opaquely by Na'jiki. */
  externalEntityId: string
  /** Major units. UGX has no minor unit, so 5000 means UGX 5,000. */
  amount: number
  currency?: string
  /** E.164 *without* the leading '+' (LivePay's adapter strips it anyway). */
  phoneNumber: string
  /** Min 8 chars, generated by the caller, one per attempt. */
  idempotencyKey: string
  description?: string
  metadata?: Record<string, unknown>
  providerCode?: string
}

/** The 200 body Na'jiki returns from POST /api/payments. */
export interface NajikiCreatePaymentResponse {
  paymentId: string
  reference: string
  status: string
}

/** GET /api/payments/:reference — scoped to the calling application. */
export interface NajikiPaymentStatus {
  id: string
  reference: string
  status: string
  amount: number
  currency: string
  phoneNumber: string
  externalEntityId: string | null
  providerPaymentId: string | null
  failureReason: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

/**
 * Create a payment intent.
 *
 * `applicationCode` is REQUIRED by Na'jiki (`z.string().min(1)`) and must match
 * the authenticated application, otherwise the API-key lookup is filtered to
 * nothing and Na'jiki answers 401.
 */
export async function createNajikiPayment(
  request: NajikiCreatePaymentRequest,
  options: NajikiRequestOptions = {}
): Promise<NajikiCreatePaymentResponse> {
  const payload: Record<string, unknown> = {
    applicationCode: request.applicationCode,
    paymentTypeCode: request.paymentTypeCode,
    externalEntityId: request.externalEntityId,
    amount: request.amount,
    currency: request.currency ?? NAJIKI_DEFAULT_CURRENCY,
    phoneNumber: request.phoneNumber,
    idempotencyKey: request.idempotencyKey,
    metadata: request.metadata ?? {},
  }

  if (request.tenantCode) payload.tenantCode = request.tenantCode
  if (request.description) payload.description = request.description
  if (request.providerCode) payload.providerCode = request.providerCode

  return najikiRequest<NajikiCreatePaymentResponse>('/api/payments', payload, {
    ...options,
    idempotencyKey: request.idempotencyKey ?? options.idempotencyKey,
  })
}

/**
 * Read a payment's current status. Na'jiki scopes the lookup to the calling
 * application and answers 404 (not 403) for another application's payment.
 */
export async function getNajikiPayment(
  reference: string,
  options: NajikiRequestOptions = {}
): Promise<NajikiPaymentStatus> {
  return najikiRequest<NajikiPaymentStatus>(
    `/api/payments/${encodeURIComponent(reference)}`,
    undefined,
    options
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Request builders — the payload shapes churchOs actually sends
//
// These live here (rather than inline in the server actions) so there is one
// definition of each payload and it can be exercised against Na'jiki's real
// validation schema in tests/.
// ─────────────────────────────────────────────────────────────────────────────

export interface ChurchTopupPaymentInput {
  churchId: string
  /** Na'jiki tenant code — `tenants.code` in churchOs, else the church slug. */
  tenantCode: string
  churchSlug?: string | null
  /** churchOs' own ledger reference (`wallet_transactions.reference_code`). */
  reference: string
  idempotencyKey: string
  /** UGX, major units. UGX has no minor unit: 5000 means UGX 5,000. */
  amount: number
  /** Digits-only E.164, e.g. 256772123456. */
  phoneNumber: string
}

/**
 * Admin "buy SMS credits" top-up.
 *
 * `paymentTypeCode` is NOT one of Na'jiki's PLATFORM_FEE_TYPES, so the intent is
 * treated as a normal tenant payment rather than a platform fee.
 */
export function buildChurchTopupPayment(
  input: ChurchTopupPaymentInput
): NajikiCreatePaymentRequest {
  return {
    applicationCode: najikiApplicationCode(),
    tenantCode: input.tenantCode,
    paymentTypeCode: najikiPaymentTypeCode('topup'),
    externalEntityId: input.churchId,
    amount: input.amount,
    currency: NAJIKI_DEFAULT_CURRENCY,
    phoneNumber: input.phoneNumber,
    idempotencyKey: input.idempotencyKey,
    description: `SMS wallet top-up for ${input.churchSlug || input.churchId}`,
    metadata: {
      churchId: input.churchId,
      tenantCode: input.tenantCode,
      product: 'sms_topup',
      source: 'admin-dashboard',
      // Our ledger reference — Na'jiki echoes metadata back verbatim in the
      // settlement webhook, and it generates its own `reference`, so this is
      // the only reliable way to reconcile the notification to this row.
      churchReference: input.reference,
      idempotencyKey: input.idempotencyKey,
    },
  }
}

export interface ChurchDonationPaymentInput {
  churchId: string
  tenantCode: string
  churchName?: string | null
  /** churchOs' own ledger reference (`wallet_transactions.reference_code`). */
  reference: string
  idempotencyKey: string
  amount: number
  /** Digits-only E.164, e.g. 256772123456. */
  phoneNumber: string
  category?: string | null
}

/**
 * Public giving-portal donation.
 *
 * `metadata.donorPhone` is what lets the settlement webhook send the donor an
 * SMS receipt once — and only once — the payment is confirmed.
 */
export function buildChurchDonationPayment(
  input: ChurchDonationPaymentInput
): NajikiCreatePaymentRequest {
  return {
    applicationCode: najikiApplicationCode(),
    tenantCode: input.tenantCode,
    paymentTypeCode: najikiPaymentTypeCode('donation'),
    externalEntityId: input.churchId,
    amount: input.amount,
    currency: NAJIKI_DEFAULT_CURRENCY,
    phoneNumber: input.phoneNumber,
    idempotencyKey: input.idempotencyKey,
    description: `${input.churchName || 'Church'} ${input.category || 'giving'}`,
    metadata: {
      churchId: input.churchId,
      tenantCode: input.tenantCode,
      category: input.category || 'general',
      product: 'donation',
      source: 'public_giving',
      churchReference: input.reference,
      idempotencyKey: input.idempotencyKey,
      donorPhone: input.phoneNumber,
    },
  }
}
