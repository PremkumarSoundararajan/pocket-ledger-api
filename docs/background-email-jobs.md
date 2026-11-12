# Background email scan jobs

A user starts or resumes a scan explicitly in Expenses. The API authenticates the app and routes the request to one SQLite-backed Durable Object per owner/mailbox. The object persists its job before returning, then alarms process batches of 25 emails. Closing the app stops progress polling, not the job. Only the Pause button pauses server work. No scheduled polling of mailboxes, automatic scan on login, or automatic Sheets import is enabled.

The job lists up to 100 IDs per Gmail page, checks seen markers once per batch, fetches metadata/full bodies with at most five concurrent reads, and writes result records/seen markers in two batched SQL statements. Obvious investment newsletters can be rejected from metadata. Unknown formats still receive full-body parsing. Tokens are cached encrypted in object storage until near expiry. Job progress contains counts/range/status only; it does not return email evidence.

A new scan clears unimported results. Added/excluded/uncertain-import records stay protected. The job's ID and revision fence every write so paused or replaced work cannot restore stale data. Scan jobs never append to Sheets. Approval waits for a running scan to finish or be paused. Disconnect removes the mailbox, job storage, alarms and cached access token.

API: POST /email/scan/start (accountId, days or sinceLast, requestId; resume:true resumes the saved job); POST /email/scan/progress (accountId); POST /email/scan/pause (accountId). Start request IDs are idempotent. The legacy /email/scan foreground endpoint remains for older clients, but cannot overlap an active background job.

429/quota/transient failures retry with exponential backoff and jitter, respecting Retry-After, up to five retries before Needs attention. Resume retries a failed job without losing its cursor. An alarm watchdog and at-least-once-safe seen markers support recovery from eviction. Progress updates are durable; the UI polls while open and reloads results at completion.

Deploy migration 0004_background_email_jobs.sql before the Worker. The EMAIL_SCAN_JOBS binding uses EmailScanJob with new_sqlite_classes migration email-jobs-v1. src/worker.js is the production entry. No cron is required. Both the canonical and optional production environment bindings are declared. The deployment does not upgrade the account to a paid plan.

Parsing prefers a non-empty text/plain MIME alternative, bounds input before decoding, strips HTML in one replacement pass, reuses generated regexes and timezone formatters, and shares the imported encryption-key promise across concurrent encryption calls. HTML table-column paid amounts remain supported.

The standalone parser receives no network/AI access. Email currency and locale limitations remain documented in email-detection-rules.md. A parser-version update can re-evaluate seen messages within a selected historical range; incremental scans cannot discover an old receipt outside their date range.

Batch logs contain counts and cumulative stage wall times only, without tokens, addresses, recipients or email contents. Cumulative stage times overlap for concurrent fetches and should not be summed as elapsed time. Actual invocation CPU must be read from Cloudflare metrics/tail; JavaScript wall timers do not provide a trustworthy per-stage CPU measurement.

New scan ranges are limited to 1–30 days (7 days recommended in the app). Since-last ranges and resumed checkpoints must also fit within 30 days. Older receipts should use statement import. New jobs persist the app Settings currency as their parsing fallback; explicit receipt currencies are not converted.
