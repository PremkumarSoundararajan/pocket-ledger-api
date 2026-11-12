# Email scan performance verification

Synthetic run: 20 concurrent mailbox jobs, 100 emails each, one shared mocked D1 database and a fixed corpus of utility confirmations, transfer alerts, tuition tables, retail receipts, conflicting totals, unsupported amounts, newsletters and large HTML messages. Network reads use a 5 ms simulated delay; no real Gmail account is accessed.

Measured on the development laptop:

| Metric | Result |
|---|---:|
| Users / messages | 20 / 2,000 |
| Total mock wall time | 2,020 ms |
| Token refreshes | 20 |
| Gmail list calls | 20 |
| Full-body reads | 1,800 |
| Maximum concurrent fetches | 100 total, 5 per mailbox |
| Local synchronous parser p95 | 3.761 ms |

Reproduce with node bench/email-scan.mjs. These figures are not production Gmail latency, Cloudflare CPU measurements, or a user-capacity guarantee. Native Miniflare integration also verifies real SQLite Durable Object alarms process 30 mocked messages after the initial HTTP response returns, without further scan-start/resume calls.

Cloudflare documents different budgets for ordinary Free Worker HTTP requests and Durable Object invocations. SQLite Durable Objects are available on Free. A local parser result below 10 ms does not by itself establish that an ordinary Worker invocation fits Free, and a result above 10 ms would not by itself rule out the Durable Object architecture. Production measurements are still required.

References: https://developers.cloudflare.com/durable-objects/platform/limits/ and https://developers.cloudflare.com/durable-objects/platform/pricing/ .

Live verification (2026-11-11): after the user hot-restarted, started a 2-day scan, left the app and returned, they confirmed completion without Resume. Sanitized Cloudflare traces showed 53 messages checked in three successful alarm batches (25, 25, 3). Invocation CPU times were 152 ms, 109 ms and 19 ms for the respective batches; invocation wall times totaled about 5.4 seconds. These are batch-level measurements, not per-email p95 CPU or a full UI end-to-end stopwatch. Listing and token-refresh stages occurred only in the first batch. No email contents or addresses were logged.

Validation: 101 backend tests including native Miniflare alarms; 310 Flutter tests; focused background UI tests passed after the final status-message changes. Release web compilation remains unverified because the local dart2js process crashed with Windows exit code -1073741816. The app tests and native/background runtime tests passed.
