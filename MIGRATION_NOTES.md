# MIGRATION NOTES: combined release (branch release/combined-2026-10-23)

**Do not push / deploy before the data migration has been applied (checklist below).**
This release renamed the stored currency names. The live site still reads and writes the OLD names, so deploying
without a migration would orphan every live balance and ledger entry (balances would read as 0 and the ledger would look empty).

## Rename map (old -> new)

| Kind | Old | New |
|---|---|---|
| Balance field | `users/{uid}.zabaTokens` | `users/{uid}.zabBalance` |
| Ledger subcollection | `users/{uid}/tokenTx/{txId}` | `users/{uid}/zabLedger/{txId}` |
| Public mirror | `tokenBoard/{uid}` | `zabBoard/{uid}` |
| Browser global | `window.ZabaTokens` | `window.ZabBalance` |
| Module file | `zaba-tokens.js` | `zab-balance.js` |
| Local storage queue key | `zdTokenPending` | `zdZabPending` |
| Section / anchor | `#tokens` | `#zab` |
| UI functions | `awardTokens`, `paintTokens`, `paintTokenSection`, `paintTokenTx`, `tokensOnUser`, `tokenNote`, `tokensFor` | `awardZab`, `paintZab`, `paintZabSection`, `paintZabLedger`, `zabOnUser`, `zabNote`, `zabFor` |
| Element id | `zabaTokensRow` | `zabBalanceRow` |
| Tests | `zaba-tokens.test.js`, `washers-win-token.test.js`, `zabba-tokens-section.test.js` | `zab-balance.test.js`, `washers-win-zab.test.js`, `zab-section.test.js` |

Rules (`firestore.rules`, draft) and wager/ledger code (`zaba-wager.js`, netlify functions) use the new names only.

## Migration (`tools/migrate-zab.js`, one-off and re-runnable, admin SDK)

Adds data only. It never changes or deletes an old field or document, so the OLD live page keeps working until the deploy.

```
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json   # the ONLY way credentials are supplied; never printed
npm install                                                           # firebase-admin is already a dependency
node tools/migrate-zab.js                # DRY RUN (default): prints the plan and counts, writes nothing
node tools/migrate-zab.js --apply        # performs the copy
node tools/migrate-zab.js --verify       # read-only per-user check (exit 1 if any user needs attention)
options: --uid=<uid> (one user), --verbose (print every user, not only problems)
```

What it copies:
1. `users/{uid}.zabaTokens` -> `users/{uid}.zabBalance`, plus `zabMigratedFrom` (the old value copied) and `zabMigratedAt`.
2. `users/{uid}/tokenTx/{id}` -> `users/{uid}/zabLedger/{id}` (same ids and data; ids make retries idempotent).
3. `tokenBoard/{uid}` -> `zabBoard/{uid}`.

Safety rules built in:
- Catch-up: if the old balance moved since the last copy (old pages kept earning during the switch-over), only the DIFFERENCE is added to `zabBalance`; ZAB spent or staked on the new site is kept; nothing is double counted.
- A user who already has `zabBalance` but no `zabMigratedFrom` (created by the new site) is left alone and reported.
- A ledger or board doc that already exists with different data is reported as a conflict and is NOT overwritten.
- Output is counts and uids only (no names, no emails, no key material).
- Unit tests: `test/migrate-zab.test.js` (mocked Firestore).

## Rules: two files

- `firestore.rules` (this repo) uses the NEW names only (clean, what the code is tested against).
- The file that gets PUBLISHED for the release is the compat build (`/workspace/release-rules/firestore.rules`, generated at release time by `/workspace/release-rules/build_compat.py` = the repo rules + COMPAT blocks; lint: `lint_rules.py` in the same folder). It additionally keeps the OLD shapes so the old live page keeps working between "publish rules" and "deploy": `users/{uid}` accepts either the `zabaTokens` or the `zabBalance` shape (each validated exactly as before), `users/{uid}/tokenTx`, and `tokenBoard`. Remove the COMPAT parts in a later cleanup, after the old fields are deleted.
- Baseline caveat: the last rules copy on the box (`/workspace/fbdeploy/firestore.rules` = `/workspace/firestore.rules.txt`, 178 lines) has NO `users`, `tokenTx`, `battles`, `tutBattles`, `washersBattles`, `tokenBoard`, `wagers` blocks. If that really is what is published, the old page could never write balances, so the migration will find 0 balances (harmless) and the COMPAT blocks only matter from the moment they are published. Check the Firebase console Rules tab before publishing.

## Go-live checklist (ordered)

1. Firestore backup: `gcloud firestore export gs://<bucket>/pre-zab-2026-10-23` (or console export). Save a copy of the currently published rules (console, Rules tab).
2. Netlify > Site settings > Environment variables: set `FIREBASE_SERVICE_ACCOUNT` (the service-account JSON as a raw JSON string, or that JSON base64 encoded; `netlify/lib/common.js` trims it, and if it does not start with `{` it base64-decodes it). Without it every function answers 503 "not configured" (no crash).
3. Publish `/workspace/release-rules/firestore.rules` (Firebase console > Firestore > Rules > Publish).
4. `node tools/migrate-zab.js` (dry run), read the counts, then `--apply`, then `--verify`.
5. ONE push of `release/combined-2026-10-23` to origin main (a single deploy). Functions deployed: `rep-settle`, `wager-settle`, `wager-stake`, `wager-sweep` (scheduled every 5 min, `exports.config.schedule`).
6. When the deploy is live: `node tools/migrate-zab.js --apply` again (catch-up for anything the old page earned in the window), then `--verify` (expected: only new-site users are listed for review).
7. Smoke test on the live site: header shows "Sign in" signed out and "<n> ZAB" + ring signed in; /#zab page; earn a set and see the ledger row; open the Top Zabba Bag line; two-phone battle (heartbeat, countdown); a 1 ZAB wager (stake, payout/refund); Washer Battle; reputation board.
8. Later cleanup (not part of the release): after a few days of confirmed good behaviour delete the old fields / `tokenTx` / `tokenBoard` and publish the clean repo `firestore.rules`.

## Names that could NOT be changed (third-party APIs)

These contain the old noun because the Firebase SDKs name them that way. They are used exactly as-is, not obfuscated:
- `index.html:2501` and `index.html:2979`: Firebase Auth `user.getIdToken()` (sends the caller's sign-in credential in the `Authorization: Bearer` header).
- `members.js:47`: same Firebase `getIdToken()` call (the local variable is now `credential`).
- `netlify/lib/common.js:24`: Firebase Admin `auth().verifyIdToken(...)`.
The `Authorization: Bearer` header itself has no such word and is unchanged. `test/no-old-currency-word.test.js` guards the repo: it allows only these four lines, plus three files that must name the OLD stored fields on purpose: this document, `tools/migrate-zab.js` (it reads the old fields/collections and writes the new ones) and `test/migrate-zab.test.js` (its mocked-Firestore test). Nothing else may contain the word.

## Plank / TUT ZAB bets (added on feat/washer-match)

No data migration is needed for this part, it only adds fields:

- `battles/{code}` and `tutBattles/{code}`: optional `stake` (int, set at create), seat fields `seenAt` (heartbeat, server time) and `claimGone` (write-once, set on your own seat when the opponent was silent for 30 s). Old rooms without them keep working (no stake = no gating, no heartbeat needed).
- `wagers/{plank|tut}_{code}_{createdMs}`: same escrow docs as the washers bet, server-only.
- `repLog/{plank|tut}_{code}_{createdMs}`: new ledger ids; washers ids (`washers_...`) are unchanged.
- Rules to publish: the release rules (see above) now have the `presOk` / `otherStale` heartbeat rules in the `battles` and `tutBattles` blocks.
