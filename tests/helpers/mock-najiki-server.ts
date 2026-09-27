/**
 * tests/helpers/mock-najiki-server.ts
 *
 * A faithful re-implementation of the Na'jiki Finance *partner* API, built from
 * najiki-finance2's route handlers so the church app's real HTTP client can be
 * pointed at it and driven end-to-end:
 *
 *   POST /api/messaging/send      → src/app/api/messaging/send/route.ts
 *   POST /api/payments            → src/app/api/payments/route.ts
 *   GET  /api/payments/:reference → src/app/api/payments/[reference]/route.ts
 *
 * Validation uses Na'jiki's own Zod schema, vendored in
 * tests/fixtures/najiki/schemas.ts — so a payload the church app builds either
 * passes Na'jiki's real validator or is rejected with Na'jiki's real error body.
 *
 * Deliberately NOT implemented (they are not part of the church app's contract):
 * rate limiting, the LivePay provider call, wallet crediting, and the outbound
 * webhook fan-out. The seeded data matches scripts/seed.ts in najiki-finance2
 * (application `church`, tenant `grace-church`, payment types tithe/offering).
 */

import { createServer, type Server } from 'node:http'
import { randomBytes } from 'node:crypto'
import {
  CreatePaymentRequestSchema,
  type CreatePaymentRequest,
} from '../fixtures/najiki/schemas.ts'

export interface MockApplication {
  id: string
  code: string
  name: string
  apiKey: string
  baseUrl: string
  webhookPath: string
  isActive: boolean
}

export interface MockPayment {
  id: string
  reference: string
  status: string
  amount: number
  currency: string
  phoneNumber: string
  externalEntityId: string | null
  applicationId: string
  idempotencyKey: string
  body: CreatePaymentRequest
}

export interface MockSms {
  id: string
  reference: string
  status: string
  recipient: string
  message: string
  senderId: string | null
  applicationId: string
  idempotencyKey: string | null
}

export interface RecordedRequest {
  method: string
  path: string
  headers: Record<string, string>
  body: unknown
}

const TEST_API_KEY = 'njk_test_church_api_key_0001'
const TEST_WEBHOOK_SECRET = 'njk_whsec_test_church_secret_0001'

/** Same shape as Na'jiki's generateReference(). */
function generateReference(appCode: string, typeCode?: string): string {
  const time = Date.now().toString(16).slice(-8).toUpperCase()
  const rand = randomBytes(5).toString('hex').toUpperCase()
  const type = (typeCode || 'PAY').slice(0, 3).toUpperCase()
  return `${appCode.slice(0, 6).toUpperCase()}-${type}-${time}-${rand}`
}

export class MockNajikiServer {
  private server: Server | null = null
  private port = 0

  readonly applications: MockApplication[] = [
    {
      id: 'app_church',
      code: 'church',
      name: 'Church App',
      apiKey: TEST_API_KEY,
      baseUrl: 'http://127.0.0.1:1',
      webhookPath: '/api/webhooks/najiki',
      isActive: true,
    },
  ]

  readonly tenants = [
    { id: 'tenant_grace', applicationId: 'app_church', code: 'grace-church', isActive: true },
  ]

  readonly paymentTypes = [
    { applicationId: 'app_church', code: 'tithe' },
    { applicationId: 'app_church', code: 'offering' },
  ]

  readonly payments: MockPayment[] = []
  readonly smsMessages: MockSms[] = []
  readonly requests: RecordedRequest[] = []
  /** Number of SMS actually handed to the provider (deduplicated ones excluded). */
  smsSends = 0

  get apiKey(): string {
    return TEST_API_KEY
  }

  get webhookSecret(): string {
    return TEST_WEBHOOK_SECRET
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}`
  }

  async start(): Promise<string> {
    this.server = createServer((req, res) => {
      this.handle(req, res).catch((err) => {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Internal server error' }))
        console.error('[mock-najiki] handler error', err)
      })
    })

    await new Promise<void>((resolve) => {
      this.server!.listen(0, '127.0.0.1', () => resolve())
    })
    const address = this.server.address()
    this.port = typeof address === 'object' && address ? address.port : 0
    return this.url
  }

  async stop(): Promise<void> {
    if (!this.server) return
    await new Promise<void>((resolve) => this.server!.close(() => resolve()))
    this.server = null
  }

  reset(): void {
    this.payments.length = 0
    this.smsMessages.length = 0
    this.requests.length = 0
    this.smsSends = 0
  }

  private json(res: import('node:http').ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  private async handle(
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse
  ): Promise<void> {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const raw = Buffer.concat(chunks).toString('utf8')
    const url = new URL(req.url ?? '/', 'http://localhost')

    const headers: Record<string, string> = {}
    for (const [key, value] of Object.entries(req.headers)) {
      headers[key] = Array.isArray(value) ? value.join(',') : String(value)
    }

    let parsedBody: unknown = undefined
    if (raw) {
      try {
        parsedBody = JSON.parse(raw)
      } catch {
        return this.json(res, 400, { error: 'Invalid JSON' })
      }
    }

    this.requests.push({
      method: req.method ?? 'GET',
      path: url.pathname,
      headers,
      body: parsedBody,
    })

    if (req.method === 'POST' && url.pathname === '/api/messaging/send') {
      return this.handleMessagingSend(res, headers, parsedBody as Record<string, unknown>)
    }

    if (req.method === 'POST' && url.pathname === '/api/payments') {
      return this.handleCreatePayment(res, headers, parsedBody)
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/payments/')) {
      return this.handleGetPayment(res, headers, decodeURIComponent(url.pathname.slice('/api/payments/'.length)))
    }

    return this.json(res, 404, { error: 'Not found' })
  }

  // ── POST /api/messaging/send ───────────────────────────────────────────────
  private handleMessagingSend(
    res: import('node:http').ServerResponse,
    headers: Record<string, string>,
    rawBody: Record<string, unknown>
  ) {
    const { to, message, applicationCode, from, senderId, apiKey: bodyApiKey } = rawBody ?? {}

    const idempotencyKey = (
      headers['idempotency-key'] ??
      (rawBody as Record<string, unknown>).idempotencyKey ??
      ''
    )
      .toString()
      .trim()
      .slice(0, 255) || null

    if (!to || !message) {
      return this.json(res, 400, { error: 'Recipient (to) and message content are required' })
    }

    const authHeader = headers['authorization']
    let apiKey = ''
    if (authHeader && authHeader.startsWith('Bearer ')) {
      apiKey = authHeader.slice(7).trim()
    } else if (authHeader) {
      apiKey = authHeader.trim()
    } else if (headers['x-api-key']) {
      apiKey = headers['x-api-key'].trim()
    } else if (bodyApiKey) {
      apiKey = String(bodyApiKey).trim()
    }

    const application = this.applications.find((a) => a.apiKey === apiKey && a.isActive) ?? null
    if (!application) {
      return this.json(res, 401, { error: 'Invalid or missing API key' })
    }

    if (applicationCode && application.code !== applicationCode) {
      return this.json(res, 403, { error: 'Application code mismatch' })
    }

    const customSender = (from as string) || (senderId as string) || undefined

    const existing =
      idempotencyKey && application
        ? this.smsMessages.find(
            (m) => m.applicationId === application.id && m.idempotencyKey === idempotencyKey
          ) ?? null
        : null

    if (existing) {
      return this.json(res, 202, {
        success: true,
        message: 'Duplicate request — the original SMS job was returned',
        smsId: existing.id,
        reference: existing.reference,
        status: existing.status,
        deduplicated: true,
        createdAt: new Date().toISOString(),
      })
    }

    const sms: MockSms = {
      id: `sms_${randomBytes(8).toString('hex')}`,
      reference: `SMS-${randomBytes(5).toString('hex').toUpperCase()}`,
      status: 'queued',
      recipient: String(to),
      message: String(message),
      senderId: customSender ?? null,
      applicationId: application.id,
      idempotencyKey,
    }
    this.smsMessages.push(sms)
    this.smsSends += 1

    return this.json(res, 202, {
      success: true,
      message: 'SMS send job queued successfully',
      smsId: sms.id,
      reference: sms.reference,
      status: sms.status,
      deduplicated: false,
      createdAt: new Date().toISOString(),
    })
  }

  // ── POST /api/payments ─────────────────────────────────────────────────────
  private handleCreatePayment(
    res: import('node:http').ServerResponse,
    headers: Record<string, string>,
    rawBody: unknown
  ) {
    const authHeader = headers['authorization']
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return this.json(res, 401, { error: 'Missing or invalid authorization header' })
    }
    const apiKey = authHeader.slice(7).trim()
    if (!apiKey) {
      return this.json(res, 401, { error: 'Missing or invalid authorization header' })
    }

    // Na'jiki's real validator, on the real payload.
    const parsed = CreatePaymentRequestSchema.safeParse(rawBody)
    if (!parsed.success) {
      const details = parsed.error.issues.map(
        (issue) => `${issue.path?.join('.') || 'body'}: ${issue.message}`
      )
      return this.json(res, 400, { error: 'Validation failed', details })
    }
    const body = parsed.data

    const application =
      this.applications.find((a) => a.apiKey === apiKey && a.isActive && a.code === body.applicationCode) ??
      null
    if (!application) {
      return this.json(res, 401, { error: 'Invalid or inactive application, or invalid API key' })
    }

    const existing = this.payments.find(
      (p) => p.applicationId === application.id && p.idempotencyKey === body.idempotencyKey
    )
    if (existing) {
      return this.json(res, 200, {
        paymentId: existing.id,
        reference: existing.reference,
        status: existing.status,
      })
    }

    if (body.tenantCode) {
      const tenant = this.tenants.find(
        (t) => t.applicationId === application.id && t.code === body.tenantCode && t.isActive
      )
      if (!tenant) {
        return this.json(res, 404, { error: 'Invalid or inactive tenant' })
      }
    }

    const payment: MockPayment = {
      id: `pay_${randomBytes(8).toString('hex')}`,
      reference: generateReference(body.applicationCode, body.paymentTypeCode),
      // Na'jiki creates the intent, then calls the provider; LivePay returns
      // 'processing' until the member approves on their handset.
      status: 'processing',
      amount: body.amount,
      currency: body.currency,
      phoneNumber: body.phoneNumber,
      externalEntityId: body.externalEntityId,
      applicationId: application.id,
      idempotencyKey: body.idempotencyKey,
      body,
    }
    this.payments.push(payment)

    return this.json(res, 200, {
      paymentId: payment.id,
      reference: payment.reference,
      status: payment.status,
    })
  }

  // ── GET /api/payments/:reference ───────────────────────────────────────────
  private handleGetPayment(
    res: import('node:http').ServerResponse,
    headers: Record<string, string>,
    reference: string
  ) {
    const authHeader = headers['authorization']
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return this.json(res, 401, { error: 'Missing or invalid authorization header' })
    }
    const application =
      this.applications.find((a) => a.apiKey === authHeader.slice(7).trim() && a.isActive) ?? null
    if (!application) {
      return this.json(res, 401, { error: 'Invalid API key' })
    }

    const payment = this.payments.find((p) => p.reference === reference)
    if (!payment || payment.applicationId !== application.id) {
      return this.json(res, 404, { error: 'Payment not found' })
    }

    return this.json(res, 200, {
      id: payment.id,
      reference: payment.reference,
      status: payment.status,
      amount: payment.amount,
      currency: payment.currency,
      phoneNumber: payment.phoneNumber,
      externalEntityId: payment.externalEntityId,
      providerPaymentId: null,
      failureReason: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
    })
  }
}
