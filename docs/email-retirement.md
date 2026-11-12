# Gmail retirement

Branch `experimentEmailScan` preserves the implementation. Production main contains no connect, refresh, Gmail-read or email-approval code. All legacy email actions return 410 except disabled config, protected cleanup and caller-scoped disconnect. Health reports disabled even if an old enable secret exists. Cron configuration is empty; stale callbacks are no-ops.

The durable object binding stays as an eraser. Its fetch/alarm handlers delete all alarms and storage, including cached encrypted access tokens. Objects cannot resume or refresh. Historical duplicate matching remains for previously imported expenses; Sheets data is untouched.

## Operational cleanup

Deploy the retirement code to canonical pocket-ledger-api first. Create a random temporary EMAIL_RETIREMENT_KEY using Wrangler stdin, never source/logs. POST /email/retirement/cleanup with that Bearer credential. This globally fences scan generations/leases and clears pending OAuth, receipt evidence and seen data, then processes up to five accounts. Each account's durable storage is erased, its encrypted refresh token is decrypted only to call Google's revocation endpoint, and the account is deleted after success or an already-invalid-token result. Responses contain counts only.

Repeat until remaining=0; verify D1 account/item/seen/OAuth-state counts zero. Failures retain disabled encrypted tokens only for explicit retry, with no code capable of reading Gmail. Do not discard unsuccessful revocations or claim success. Legacy disconnect authenticates the app caller and removes only their own accounts. Remove the temporary key and obsolete email OAuth/callback/enable/encryption secrets after successful cleanup. Retain the empty schema and eraser binding for historical objects.

The app cancels old scan notifications and removes saved reminder preferences on upgrade. A privacy notice links to myaccount.google.com/connections for review/manual revocation. No notice emails are sent. Google revocation may affect other grants in the same project, requiring another sign-in for Sheets. App sign-in requests Drive/Sheets scopes only. Normal expenses, daily expense reminders and merchant classification remain available.

## Live verification (2026-11-12)
Canonical and alternate production Workers deployed with retirement code. One stored authorization successfully revoked; zero failures. Repeated cleanup returned zero remaining. D1 accounts, items, seen records and OAuth states all verified zero. Obsolete enable/client ID/client secret/callback/token-encryption secrets and the temporary cleanup credential were removed from the canonical Worker. Alternate production Worker had no secrets configured. No recurring cron configured.
