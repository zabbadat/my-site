# MIGRATION NOTES: read before this branch (feat/washer-match) is ever deployed

**Do not deploy or publish rules from this branch until the live Firestore data has been migrated.**
This bundle renamed the stored currency names. The live site still reads and writes the OLD names, so deploying
without a migration would orphan every live balance and ledger entry (balances would read as 0 and the ledger would look empty).

## Rename map (old -> new)

| Kind | Old | New |
|---|---|---|
| Balance field | `users/{uid}.zabaTokens` | `users/{uid}.zabBalance` |
| Ledger subcollection | `users/{uid}/tokenTx/{txId}` | `users/{uid}/zabLedger/{txId}` |
| Public mirror (on the live branch only, not on this one) | `tokenBoard/{uid}` | `zabBoard/{uid}` |
| Browser global | `window.ZabaTokens` | `window.ZabBalance` |
| Module file | `zaba-tokens.js` | `zab-balance.js` |
| Local storage queue key | `zdTokenPending` | `zdZabPending` |
| Section / anchor | `#tokens` | `#zab` |
| UI functions | `awardTokens`, `paintTokens`, `paintTokenSection`, `paintTokenTx`, `tokensOnUser`, `tokenNote`, `tokensFor` | `awardZab`, `paintZab`, `paintZabSection`, `paintZabLedger`, `zabOnUser`, `zabNote`, `zabFor` |
| Element id | `zabaTokensRow` | `zabBalanceRow` |
| Tests | `zaba-tokens.test.js`, `washers-win-token.test.js`, `zabba-tokens-section.test.js` | `zab-balance.test.js`, `washers-win-zab.test.js`, `zab-section.test.js` |

Rules (`firestore.rules`, draft) and wager/ledger code (`zaba-wager.js`, netlify functions) use the new names only.

## Migration plan (one-off, run with the admin SDK before deploy)

1. Back up Firestore (export).
2. For every `users/{uid}`: copy `zabaTokens` -> `zabBalance` (keep `lastTxId`, `createdAt`, `updatedAt`).
3. For every `users/{uid}/tokenTx/{txId}`: copy the doc unchanged to `users/{uid}/zabLedger/{txId}` (same ids; ids are
   deterministic per set and make retries idempotent, so they must be preserved).
4. If the live branch has `tokenBoard/{uid}`: copy to `zabBoard/{uid}` and point the live-branch code at it when that work is merged.
5. Verify per user: `zabBalance == old zabaTokens` and ledger count matches.
6. Publish the new rules and deploy the code together. Keep the OLD fields and collection until the new build is confirmed good, then delete them.
   (Safer alternative: ship a short dual-read release first: read `zabBalance ?? zabaTokens`, write both, then cut over.)
7. Anyone with queued offline awards under the old local-storage key (`zdTokenPending`) loses that small queue; acceptable.

The owner accepted breakage of local test data. Live data must not be broken.

## Names that could NOT be changed (third-party APIs)

These contain the old noun because the Firebase SDKs name them that way. They are used exactly as-is, not obfuscated:
- `index.html:2699` and `index.html:2850`: Firebase Auth `user.getIdToken()` (sends the caller's sign-in credential in the `Authorization: Bearer` header).
- `members.js:47`: same Firebase `getIdToken()` call (the local variable is now `credential`).
- `netlify/lib/common.js:24`: Firebase Admin `auth().verifyIdToken(...)`.
The `Authorization: Bearer` header itself has no such word and is unchanged. `test/no-old-currency-word.test.js` guards the repo and allows only these four lines.
