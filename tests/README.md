# tests/

Contract tests for the church app → Na'jiki Finance integration.

```bash
npm test                    # runs everything in this directory
node --test tests/najiki-contract.test.ts   # just the Na'jiki suite
```

No test framework, no config: Node's built-in runner (`node --test`) plus type
stripping, the same approach `najiki-finance2` uses for its own unit tests.

## What is covered

| File | What it proves |
| --- | --- |
| `najiki-contract.test.ts` | Every payload churchOs sends is accepted by Na'jiki's **own** validator, unmodified; Na'jiki's error bodies are surfaced; idempotency works in both directions; inbound webhooks signed by Na'jiki's **own** signer verify (and tampered/replayed ones do not). |
| `helpers/mock-najiki-server.ts` | A faithful re-implementation of Na'jiki's partner endpoints (`POST /api/messaging/send`, `POST /api/payments`, `GET /api/payments/:reference`), including auth resolution order, idempotency semantics, and the exact response/error bodies. |
| `fixtures/najiki/` | Verbatim copies of Na'jiki's `money.ts`, `schemas.ts` and `notification-signature.ts`, so the tests validate against Na'jiki's real contract rather than a paraphrase. See `fixtures/najiki/README.md` for provenance and refresh instructions. |

## What is deliberately not simulated

The mock does not implement rate limiting, the LivePay provider call, wallet
crediting, or the outbound webhook fan-out. Those are Na'jiki-internal
behaviours; what matters for this app is the request/response boundary, and that
is enforced by Na'jiki's real Zod schema.

Supabase-dependent behaviour (the ledger writes inside the server actions and
the webhook route) is not covered here — it needs a live database. The pieces
that carry the contract (payload shape, headers, signature verification,
reconciliation keys, receipt-SMS sequencing) are pure functions in
`lib/najiki/` and are covered.
