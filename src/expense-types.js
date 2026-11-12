export const EXPENSE_TYPES = [
  'Regular', 'Planned Occasional', 'Unexpected Occasional', 'Unknown',
];

const TYPE_ALIASES = new Map([
  ['regular', 'Regular'],
  ['planned', 'Planned Occasional'],
  ['plannedoccasional', 'Planned Occasional'],
  ['planned occasional', 'Planned Occasional'],
  ['unexpected', 'Unexpected Occasional'],
  ['unexpectedoccasional', 'Unexpected Occasional'],
  ['unexpected occasional', 'Unexpected Occasional'],
]);

export function expenseType(value) {
  return TYPE_ALIASES.get(String(value ?? '').trim().toLowerCase()) || 'Unknown';
}

// Exact fingerprints after removing bank reference IDs; no fuzzy merchant rules.
export function merchantKey(text) {
  return String(text || '').toUpperCase()
    .replace(/\b(?:REF(?:ERENCE)?|TRACE|CONF(?:IRMATION)?|ID)\s*[:#-]?\s*[A-Z0-9_-]+/g, ' ')
    .replace(/\b[A-Z0-9_-]*\d[A-Z0-9_-]*\b/g, ' ')
    .replace(/[^A-Z]+/g, ' ').trim();
}

// Uses only the authenticated user's history already fetched for duplicate checks.
// Conservative monthly evidence; never infers planned/unexpected intent.
export function recurringMerchants(rows, {
  amountTolerance = .05,
  utilityTolerance = .35,
  intervalToleranceDays = 7,
} = {}) {
  const groups = new Map();
  for (const row of rows) {
    const date = new Date(String(row[0]).slice(0, 10));
    const amount = Number(String(row[1]).replace(/[$,]/g, ''));
    const key = merchantKey(row[3]);
    if (!key || !Number.isFinite(date.valueOf()) || !(amount > 0) || row[2] === 'Transfers') continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ date, amount, description: String(row[3]), type: expenseType(row[4]) });
  }
  const result = new Map();
  for (const [key, items] of groups) {
    items.sort((a, b) => a.date - b.date);
    const months = new Set(items.map(item => item.date.toISOString().slice(0, 7)));
    // Several purchases in one month do not establish a subscription.
    if (months.size < 3 || items.length !== months.size) continue;
    const recent = items.slice(-6);
    if (recent.some(item => ['Planned Occasional', 'Unexpected Occasional'].includes(item.type))) continue;
    const amounts = recent.map(item => item.amount).sort((a, b) => a - b);
    const median = amounts[Math.floor(amounts.length / 2)];
    const utility = /electric|water|utility|utilities|power bill|gas bill|atmos|rhythm ops|internet|broadband/i.test(recent[0].description);
    const tolerance = utility ? utilityTolerance : amountTolerance;
    if (!recent.every(item => Math.abs(item.amount - median) / median <= tolerance)) continue;
    if (!recent.slice(1).every((item, index) =>
      Math.abs((item.date - recent[index].date) / 86400000 - 30.4375) <= intervalToleranceDays)) continue;
    result.set(key, { median, tolerance, last: recent.at(-1).date, intervalToleranceDays });
  }
  return result;
}

export function suggestExpenseType(transaction, patterns) {
  const pattern = patterns.get(merchantKey(transaction.description));
  if (!pattern) return 'Unknown';
  const days = (new Date(transaction.date) - pattern.last) / 86400000;
  const expectedInterval = Math.abs(days - 30.4375) <= pattern.intervalToleranceDays;
  const expectedAmount = Math.abs(transaction.amount - pattern.median) / pattern.median <= pattern.tolerance;
  return expectedAmount && expectedInterval ? 'Regular' : 'Unknown';
}
