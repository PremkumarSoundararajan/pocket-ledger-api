> Current scanning architecture: [background-email-jobs.md](background-email-jobs.md). The version-by-version foreground notes below are historical. New clients use durable background jobs; start is still user initiated and Sheets import still requires approval.

# Gmail expense capture: setup and operations

This feature is opt-in and disabled until the Worker has all configuration below. Normal sign-in does not request Gmail access. Each connected Gmail mailbox requires its own consent. Entering an email address alone does not grant access. Outlook and other providers are not implemented.

Scans create an encrypted review inbox. They never write to Google Sheets. The app lets the user correct merchant, amount, date and currency, then review categories and Expense Types using saved merchant choices. Only explicit approval writes expenses to the connected Sheet using the signed-in user's existing Google access token.

Parser version 4 separates Ready to import and Needs review. Every candidate searched is retained with an extraction outcome; review-only items have no guessed amount and require corrected details plus explicit confirmation before approval. Positive paid labels establish completion, totals are ranked, and supported timestamps/fallback dates use the device IANA timezone. No new database migration is needed for this version: the existing status column accepts needs_review. Deploy both the Worker and updated app/web frontend so users can see the additional list. Older apps continue to see ready items only. Scans remain manual and foreground-only.

Parser version 5 adds receipt relevance filtering after broad search, so unrelated investing/bulk newsletters no longer enter Needs review. A readable amount can be shown as an unconfirmed suggestion, while conflicts show candidate amounts and labels. Manual confirmation is still mandatory. A fresh lookback re-evaluates old unapproved false positives; merely refreshing the inbox does not re-scan Gmail. There is no new migration. Read-only status refreshes have bounded client retries; scan/approval writes do not. The Worker reuses its encryption key for draft decoding to reduce repeated import work.

## Deployment setup

The Flutter app uses `https://pocket-ledger-api.ledgerapi.workers.dev`. Deploy with `npm run deploy`, which explicitly targets the top-level `pocket-ledger-api` Worker. `--env production` targets a different Worker (`pocket-ledger-api-production`) with separate secrets; deploying only there does not update the app's backend. Keep the callback URL on the same canonical host. For D1 operations against this app's backend, use `--env=` explicitly.

When testing the Flutter web app at `http://localhost:8080`, include that exact origin in `EMAIL_ALLOWED_ORIGINS` alongside `https://pocket-ledger-cdn.pages.dev`. A disallowed browser origin gets a 403; do not add a spreadsheet header to email requests to work around a deployment mismatch.

1. Enable the Gmail API in a Google Cloud project. Configure a Web application OAuth client dedicated to email capture, and configure its consent screen. Add the exact authorized redirect URI:
   `https://pocket-ledger-api.ledgerapi.workers.dev/email/oauth/callback`
2. Request only `openid`, `email` and `https://www.googleapis.com/auth/gmail.readonly`. This is a restricted Gmail scope. Follow Google's verification and applicable security-assessment requirements before public rollout; add test users while testing. A testing consent screen can issue short-lived refresh tokens. Keep the existing mobile/iOS sign-in clients unchanged.
3. In this Worker checkout, create a D1 database:

   ```powershell
   npx wrangler d1 create pocket-ledger-email
   ```

   Use the existing D1 database if already configured. Otherwise add its returned ID in `wrangler.toml`, keeping binding `EMAIL_DB` and `migrations_dir = "migrations"`. Then apply the migration:

   ```powershell
   npx wrangler d1 migrations apply pocket-ledger-email --remote
   ```

4. Set Worker secrets interactively (do not put actual secrets in Git or terminal command arguments):

   ```powershell
   npx wrangler secret put EMAIL_OAUTH_CLIENT_ID
   npx wrangler secret put EMAIL_OAUTH_CLIENT_SECRET
   npx wrangler secret put EMAIL_CALLBACK_URL
   npx wrangler secret put EMAIL_TOKEN_KEY
   npx wrangler secret put EMAIL_ALLOWED_ORIGINS
   npx wrangler secret put EMAIL_CAPTURE_ENABLED
   ```

   Values: the Web OAuth client ID and secret; the exact callback URL above; a cryptographically random **32-byte base64** encryption key; `https://pocket-ledger-cdn.pages.dev`; and `true`, respectively. Generate the encryption key with a password manager or an OS cryptographic random generator. Keep a secure backup: replacing it makes existing encrypted authorizations and pending proposals unreadable. Add other web origins only when explicitly needed, comma-separated. Never use `*`. Native clients do not send a browser Origin.

5. Apply all migrations, including `0002_manual_email_scans.sql` and `0003_receipt_parser_versions.sql` for existing installations. Keep `[triggers] crons = []` to remove any prior live schedule. Run `npx wrangler types`, `npm test`, and `npx wrangler deploy --dry-run` before deploying. Deploy the Worker and the updated Flutter app/web build through the existing release process. This code change does not deploy resources or obtain Google verification.
6. Test with an authorized test mailbox and synthetic receipt. Connect Gmail from Settings → Email & scan reminders, return to the app, then open Expenses → Scan emails for missed expenses. Choose 1–90 days and press Scan emails now. Simply opening either screen must not read Gmail. Verify no Sheet write occurs until approval. Verify a second scan/retry and a later statement import do not silently duplicate the payment. Pause and disconnect the mailbox when finished testing.

For local development, use `.dev.vars.example` as a template for an ignored `.dev.vars`, a local D1 migration, and a Google-authorized callback appropriate to the local test environment. Never commit `.dev.vars`.

## Reminders and manual scans

- One Gmail mailbox can be connected from Settings. Disconnect before changing it; a new connection has no last-scan option. Existing installations with multiple mailboxes can still review/disconnect them. Reauthorization also resets the last-scan checkpoint.
- There is **no automatic scanning**. No cron, background task or notification tap reads Gmail. The scheduled handler is inert even if a stale cron fires while a deployment is propagating. Deploy this Worker and `crons = []` to remove previously configured live schedules; editing local code alone does not change the deployed Worker.
- Optional **Off / Once an hour / Once a day** native phone reminders are independent of the ordinary daily expense reminder. Daily reminders have a user-chosen time. Hourly reminders repeat from when enabled, subject to OS delivery delays. They contain no server totals and are not push notifications. Web users can scan manually but configure phone reminders in the mobile app.
- Notification taps open the Expenses tab. The user must press Scan emails for missed expenses, choose 1–90 days or **Since the last completed scan**, then press Scan emails now. Use bank statements for longer periods. Last scan is a per-mailbox completed watermark, not the date a partial batch ran.
- Stay on the scan screen. Each foreground request reads at most ten matching Gmail messages; the app requests subsequent pages only while active. Leaving or pausing stops further requests; an in-flight batch may finish. Already found proposals are saved in the encrypted inbox. Refresh and explicitly Resume paused scan to continue the same fixed range. No completion notification or automatic resume is promised. Paused ranges expire after seven days; start a new scan then.
- No initial scan runs after connecting Gmail. The server validates ranges and scan ownership; an old `/email/schedule` request returns 410. Existing paused mailbox flags no longer enable/disable scans, because all scans are explicit.
- The inbox shows up to 200 pending proposals, newest first; approving/excluding them reveals older proposals. Approve up to 50 items in one currency at a time. No currency conversion occurs. Confirm currency matches the ledger before approving.
- Parsing is deliberately conservative: text/HTML completed-payment confirmations with a clear labeled total. Matched scheduled notices, obvious transfers/card payments, refunds, ambiguous totals, PDF-only receipts and unsupported formats are review-only with reason codes. They are not auto-approved expenses. Received date or sender may be fallback values and must be verified. No AI API or external email-analysis vendor is used.
- Retail receipt layouts such as CVS's `amount — Total spent this trip` are supported, including HTML entities and printed transaction dates. Savings and reward totals are ignored. Parser versions allow a new manual scan to reconsider messages previously skipped by an older parser. Approved, excluded and existing queued items remain unchanged. Choose a lookback covering the receipt (for example seven days); Since last scan only covers newer mail.
- Same-message IDs are deduplicated. Same-date/amount/normalized-merchant matches against Sheets are flagged for manual review, including later statement imports matching approved email expenses. Different merchant descriptions or dates can evade matching; users must verify receipt/bank-alert duplicates.
- A lost Sheets response leaves an uncertain proposal. Refresh and check the Sheet. Stable transaction IDs allow confirming a successful write without appending again. If absent, wait at least ten minutes, then explicitly choose Import anyway. Do not do so while the prior write is still in flight. Ambiguous duplicates can be excluded from the email inbox once resolved.

## Data and operational limits

Refresh tokens and derived proposals use AES-GCM with owner-bound authenticated data. Raw mail bodies and attachments are not persisted. The encrypted proposal contains limited sender, subject and evidence text, plus the extracted expense. Added/excluded proposals have this payload cleared. Scan message markers and transaction ID markers remain for idempotency until mailbox disconnect; there is no scheduled cleanup task. Pending proposals have no automatic expiry in this version. Disconnect deletes the mailbox's queued proposals and markers and attempts Google token revocation; Sheets expenses remain. Users can also revoke access in their Google account.

Limit production access to Cloudflare secrets and D1, keep credentials out of logs, and include these purposes/retention rules in the app's privacy policy and Gmail consent disclosures before rollout. Encryption does not replace Google's restricted-scope obligations. Disabling `EMAIL_CAPTURE_ENABLED` stops email endpoints and scans without affecting other app features. A reconnect is required after revocation/refresh-token expiry. Monitor capacity and costs as manual scan usage grows.

References: [Gmail message API](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get), [Google offline OAuth](https://developers.google.com/identity/protocols/oauth2/web-server#offline), [restricted scopes](https://developers.google.com/identity/protocols/oauth2/scopes#gmail), [Cloudflare Cron](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [D1](https://developers.cloudflare.com/d1/worker-api/).

Parser version 6 ignores messages with no eligible amount or only zero amounts, including old unapproved drafts when explicitly rescanned. Conflicting and unsupported monetary evidence remains reviewable. Completed narratives such as "Your payment of $234.40 has been received", "We received your payment of $234.40", and "You made a $320.00 transaction with GIDEON" are recognized. Bank-alert merchants are taken from the transaction wording rather than the bank sender. Split HTML amount-label words are joined. Gmail-generated summary cards are not part of the Gmail message payload and are not parsed. No new migration or automatic scan is needed.

Parser version 7 extracts paid amounts by HTML table column, rather than mistaking a fee date below an Amount Paid header for money. Conflicting table rows remain review-only. Status refresh filters legacy review drafts with missing/zero-only monetary evidence and returns corrected counts immediately; it does not access Gmail or alter imported expenses. The app now shows a two-line collapsed summary per email, with classifications, verification warnings, evidence and editing available on expansion. A bill showing only Amount Due is not a completed expense.

Parser version 8 searches for "you sent" and extracts generic sent-money amounts and named recipients. These are always review-only transfer candidates, with the amount shown as an unconfirmed suggestion; manual confirmation is required before importing as an expense. No bank or recipient names are matched. Same-tier conflicts remain unresolved. Currency-code forms CAD, MYR and INR are covered in tests alongside dollar-symbol alerts. New lookback scans re-evaluate earlier unapproved/ignored messages; added/excluded items remain protected.

Parser version 9 tags generic bank-alert formats and tolerates HTML line breaks in "You sent". Status filters a bank alert only when exactly one vendor receipt matches normalized merchant, positive amount, currency and calendar date, with distinct known sender domains. Multiple matches, different dates/amounts/currencies, review-only vendor drafts and uncertain imports remain visible. Filtering is reversible: excluding the vendor draft reveals the bank alert again. Approval now retains only an owner-encrypted minimal matching key (merchant, amount, currency, date, source kind/domain), clearing subject/body evidence, so later alerts can match newly imported receipts. Older imported receipts whose evidence was already cleared cannot participate; existing Sheets duplicate checks still apply at approval. Disconnect deletes these keys with the mailbox. No migration is needed.

Parser version 10 applies the Baseline merchant fingerprint rules to email display and duplicate matching, removing store/reference numbers and recurring codes. Generic payment prose accidentally captured after merchant names is trimmed. Status applies the same cleanup to older drafts without a Gmail scan. Bank/vendor duplicate matching now allows up to three calendar days for settlement but still requires equal amount/currency, normalized merchant equality, different known sender domains and mutually unique matches; ambiguous repeats remain visible. The app shows the saved paused-scan range and explains that older messages may not have been reached, plus the count of hidden bank duplicates.

New scan session reset (2026-11-11): updated clients send reset:true once. Under the scan lease, delete pending/needs_review/ignored drafts and their seen markers, preserve added/excluded/importing records, and save the selected range. Return reset acknowledgement plus scanId immediately, before any Gmail access; subsequent pages must resume that ID. MaxResults is now 1 to bound Free-tier CPU work. Scan leases use scan: tokens and expire after 60 seconds; a reset can replace a scan lease but cannot steal an approval lease. Every draft/seen/cursor write is fenced against the lease, so abandoned requests cannot restore old results or ranges. Completed scan_from remains stored for range display. A replay after a lost completion response returns completed without reading Gmail. No migration or automatic/background scan is involved. Live investigation confirmed busy responses under an old 10-minute lease; CPU termination of that original request was not established.
