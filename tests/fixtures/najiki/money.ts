/**
 * Currency-aware money arithmetic.
 *
 * Money crosses this codebase in two different units, and they are not
 * interchangeable:
 *
 *   * `PaymentIntent.amount` is `Decimal(14, 2)` — **major** units (5,000 UGX,
 *     12.50 USD). This is what a human types, what zod validates, what the
 *     provider is asked to collect and what the amount gate compares.
 *   * `WalletAccount.balanceMinor` and `LedgerEntry.amountMinor` are `BigInt` —
 *     **minor** units, the smallest indivisible unit of the currency. This is
 *     the unit every real ledger is kept in, because it is exact.
 *
 * The conversion between the two depends on the currency, and not every
 * currency has two decimal places. UGX — the platform default, and the currency
 * of every Ugandan mobile-money payment here — has *none*.
 *
 * So `BigInt(Math.round(amount * 100))`, which is what this codebase did, is
 * wrong by a factor of 100 for UGX: a 5,000 UGX collection credited the tenant
 * wallet with 500,000 minor units, i.e. 500,000 UGX of withdrawable balance.
 * Every balance and every ledger entry on the platform's home currency was
 * 100x too large.
 *
 * This module is the only place that knows the exponent, and both directions go
 * through it, so the two halves of the money path cannot drift apart again.
 */

export type MoneyInput = number | string | { toString(): string }

/**
 * ISO 4217 currencies whose minor unit is the currency itself (exponent 0).
 * Sourced from the ISO 4217 "minor unit" column; the Ugandan shilling (UGX) is
 * the one that matters here, but the rest cost nothing to carry.
 */
export const ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF',
  'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
])

/** ISO 4217 currencies with a thousandth (exponent 3). */
export const THREE_DECIMAL_CURRENCIES = new Set([
  'BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND',
])

/** ISO 4217 default for anything not listed above. */
export const DEFAULT_CURRENCY_EXPONENT = 2

/**
 * Largest value the money columns can hold.
 *
 * `PaymentIntent.amount` is `Decimal(14, 2)`, whose maximum is 999,999,999,999.99.
 * Validating against this at the request boundary turns an out-of-range amount
 * into a clear 400 instead of a Postgres "numeric field overflow" surfaced as a
 * 500 — and it keeps `toMinorUnits` below the magnitude where floats lose
 * integer precision.
 */
export const MAX_MAJOR_AMOUNT = 999_999_999_999.99

/**
 * Normalise a currency code for storage and lookup.
 *
 * Currency is part of the wallet identity
 * (`@@unique([tenantId, appCode, currency])`), so it must not be
 * case-significant: `"ugx"` and `"UGX"` would otherwise open two wallets for the
 * same currency and split a tenant's balance across them, making both
 * understated and settlement wrong.
 */
export function normalizeCurrency(code: string | null | undefined): string {
  return String(code ?? '').trim().toUpperCase()
}

/**
 * Pick the currency a dashboard's money totals should be reported in.
 *
 * Summing `amount` across currencies produces a meaningless number, so a
 * multi-currency deployment has to report in one currency and disclose the rest.
 * The rule is the currency with the most payments in the window, ties broken
 * alphabetically so the same data always yields the same headline (an unstable
 * headline looks like the revenue itself moved).
 *
 * Returns `fallback` for an empty or unparseable set — never an empty string, so
 * callers always have something safe to label a figure with.
 */
export function pickPrimaryCurrency(
  rows: Array<{ currency?: string | null; count?: number | null }>,
  fallback = 'UGX'
): string {
  const normalised = rows
    .map((row) => ({
      currency: normalizeCurrency(row.currency),
      count: Number.isFinite(Number(row.count)) ? Number(row.count) : 0,
    }))
    .filter((row) => isValidCurrencyCode(row.currency) && row.count > 0)

  if (normalised.length === 0) {
    // The fallback itself is validated: returning '' would leave a caller with
    // nothing to label a figure with.
    const normalisedFallback = normalizeCurrency(fallback)
    return isValidCurrencyCode(normalisedFallback) ? normalisedFallback : 'UGX'
  }

  normalised.sort((a, b) => b.count - a.count || a.currency.localeCompare(b.currency))
  return normalised[0].currency
}

/** True when the code is exactly three ASCII letters. */
export function isValidCurrencyCode(code: string | null | undefined): boolean {
  return /^[A-Z]{3}$/.test(normalizeCurrency(code))
}

/**
 * Number of decimal places for a currency's minor unit.
 *
 * Unknown or malformed codes fall back to the ISO 4217 default of 2 rather than
 * throwing, so an unusual currency degrades to ordinary behaviour instead of
 * breaking a payment in flight. Use {@link isKnownCurrency} if you need to
 * distinguish the fallback from a real answer.
 */
export function currencyExponent(currency: string): number {
  const code = String(currency ?? '').trim().toUpperCase()
  if (ZERO_DECIMAL_CURRENCIES.has(code)) return 0
  if (THREE_DECIMAL_CURRENCIES.has(code)) return 3
  return DEFAULT_CURRENCY_EXPONENT
}

/** True when the currency has no minor unit at all (UGX, JPY, KRW, ...). */
export function isZeroDecimalCurrency(currency: string): boolean {
  return currencyExponent(currency) === 0
}

/** True when the code is one we have an explicit exponent for. */
export function isKnownCurrency(currency: string): boolean {
  const code = String(currency ?? '').trim().toUpperCase()
  return ZERO_DECIMAL_CURRENCIES.has(code) || THREE_DECIMAL_CURRENCIES.has(code)
}

/**
 * Largest magnitude accepted, in major units. `Decimal(14, 2)` tops out below
 * this, and staying under it keeps `Number.prototype.toFixed` away from
 * exponential notation.
 */
const MAX_ABS_AMOUNT = 1e15

/**
 * Normalise any accepted money input to a plain decimal string.
 *
 * Floats are expanded to 20 places rather than trusted: `0.1 + 0.2` arrives as
 * `0.30000000000000004`, and expanding it lets the rounding step below discard
 * the noise instead of silently truncating a real digit.
 */
function toDecimalString(value: MoneyInput): string {
  let text: string

  if (typeof value === 'string') {
    text = value.trim()
  } else if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`[money] amount is not a finite number: ${value}`)
    }
    if (Math.abs(value) >= MAX_ABS_AMOUNT) {
      throw new Error(`[money] amount is out of range: ${value}`)
    }
    // `Number.prototype.toString` yields the *shortest* representation that
    // round-trips, which is what a human meant: 1.005 prints as "1.005", not as
    // its true binary value 1.00499999999999989. Expanding the exact binary
    // value would round a literal 1.005 down to 1.00. Only the extremes, where
    // toString switches to exponent notation, need fixed-point instead — and
    // the range check above already rules out the large end.
    text = value.toString()
    if (text.includes('e') || text.includes('E')) text = value.toFixed(20)
  } else if (value && typeof value.toString === 'function') {
    // Prisma.Decimal and friends.
    text = value.toString().trim()
  } else {
    throw new Error(`[money] unsupported amount: ${String(value)}`)
  }

  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(text)) {
    throw new Error(`[money] amount is not a decimal number: "${text}"`)
  }

  return text
}

/**
 * Convert a major-unit amount to exact minor units, rounding half-up at the
 * currency's exponent.
 *
 *   toMinorUnits(5000, 'UGX')    → 5000n     (UGX has no minor unit)
 *   toMinorUnits(12.5, 'USD')    → 1250n
 *   toMinorUnits('0.5', 'UGX')   → 1n        (half-up)
 *   toMinorUnits(1.005, 'USD')   → 101n      (float noise rounded away, not truncated)
 *
 * The result is a `bigint` because minor units are exact; converting through
 * `number` is what reintroduces the error this exists to prevent.
 */
export function toMinorUnits(amount: MoneyInput, currency: string): bigint {
  const exponent = currencyExponent(currency)
  const text = toDecimalString(amount)

  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(text)
  if (!match) {
    throw new Error(`[money] amount is not a decimal number: "${text}"`)
  }

  const negative = match[1] === '-'
  const integerPart = match[2] || '0'
  const fractionRaw = match[3] ?? ''

  const fraction = fractionRaw.slice(0, exponent).padEnd(exponent, '0')
  const roundingRemainder = fractionRaw.slice(exponent)

  let minor = BigInt(`${integerPart}${fraction}`)
  if (roundingRemainder && roundingRemainder[0] >= '5') minor += 1n

  return negative ? -minor : minor
}

/** Convert exact minor units back to a major-unit `number`. Display only. */
export function fromMinorUnits(minor: bigint | number, currency: string): number {
  const exponent = currencyExponent(currency)
  const value = typeof minor === 'bigint' ? minor : BigInt(Math.trunc(minor))
  if (exponent === 0) return Number(value)
  return Number(value) / 10 ** exponent
}

/**
 * Exact decimal string form of minor units, without a float in the path.
 * This is the right shape for writing into a `Decimal` column or an API body.
 *
 *   minorUnitsToDecimalString(5000n, 'UGX')  → '5000'
 *   minorUnitsToDecimalString(1250n, 'USD')  → '12.50'
 */
export function minorUnitsToDecimalString(minor: bigint | number, currency: string): string {
  const exponent = currencyExponent(currency)
  const value = typeof minor === 'bigint' ? minor : BigInt(Math.trunc(minor))

  const negative = value < 0n
  const digits = (negative ? -value : value).toString().padStart(exponent + 1, '0')
  const sign = negative ? '-' : ''

  if (exponent === 0) return `${sign}${digits}`

  const cut = digits.length - exponent
  return `${sign}${digits.slice(0, cut)}.${digits.slice(cut)}`
}

/**
 * Compare two major-unit amounts for equality at the currency's precision,
 * tolerating float representation noise.
 *
 * NOTE: the inbound webhook gate does not currently use this. It rejects when
 * `Math.abs(expected - reported) > 0.001`, which is *stricter* for a
 * zero-decimal currency such as UGX (it rejects a 5,000.4 report for a 5,000
 * intent, where this function — correctly for UGX — would call them equal).
 * Keeping the stricter check is deliberate; this helper is available for callers
 * that want currency-aware equality rather than a float epsilon.
 */
export function amountsMatch(a: MoneyInput, b: MoneyInput, currency: string): boolean {
  return toMinorUnits(a, currency) === toMinorUnits(b, currency)
}
