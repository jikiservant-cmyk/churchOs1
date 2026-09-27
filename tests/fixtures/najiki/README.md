# Na'jiki Finance — vendored contract fixtures

These three files are copied **verbatim** from the Na'jiki Finance repository so
the church app's contract tests validate against Na'jiki's real code rather than
a hand-written paraphrase of it.

| File | Upstream path | Upstream blob (git hash-object) |
| --- | --- | --- |
| `money.ts` | `src/lib/money.ts` | `7d6cebe8d1084459fd795a77bde24c82e2553a04` |
| `schemas.ts` | `src/lib/schemas.ts` | `34614895883b80e5664341ed8e87662c9c085e7e` |
| `notification-signature.ts` | `src/lib/notification-signature.ts` | `b9381b3e82a134e0ee159fe113a439392ce14b47` |

- Repository: <https://github.com/jikiservant-cmyk/najiki-finance2>
- Pinned commit: `1155fc375047dd2e2f3b937441c1de93b13cd7f9`

**One intentional difference:** `schemas.ts` imports `./money.ts` with an
explicit extension. Upstream uses the extensionless `./money`, which Node's
type-stripping loader cannot resolve. No logic was changed.

## Keeping it in sync

These files are a *snapshot of Na'jiki's contract*, not a copy of Na'jiki's
implementation. When Na'jiki's schema changes:

```bash
git clone https://github.com/jikiservant-cmyk/najiki-finance2 /tmp/najiki
cd /tmp/najiki && git rev-parse HEAD
cp /tmp/najiki/src/lib/{money,schemas,notification-signature}.ts \
   /home/user/churchOs1/tests/fixtures/najiki/
sed -i 's|from "./money"|from "./money.ts"|' /home/user/churchOs1/tests/fixtures/najiki/schemas.ts
```

Then update the pinned commit and blob hashes in the table above and run
`npm test`. A failing test after an upstream change means the church app's
payload has drifted from the contract — that is the point of this directory.
