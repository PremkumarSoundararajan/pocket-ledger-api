// Kept in parity with Flutter's MerchantNormalizer. Exact aliases only.
export function merchantFingerprint(text) {
  const noise = new Set(['ACH','AUTOMATIC','BILLPAY','BILL','CHECK','CHK','DEBIT','ID','ONLINE','PAYMENT','PURCHASE','PYMT','RECURRING','RCR','RECUR','TRANSFER','UTIL','UTILITIES','WEB','ATM','BR','BRANCH','LOC','LOCATION','POS','STORE','US']);
  const raw = String(text || '').toUpperCase().trim().replace(/\s+/g, ' ');
  const normalized = String(text || '').toUpperCase()
    .replace(/\b(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\b/gi, ' ')
    .replace(/\b(?:CHECK|CHK|CHEQUE)\s*#?\s*\d+\b/gi, ' ')
    .replace(/\b(?:WEB|PPD|ACH|TRACE|REF(?:ERENCE)?|CONF(?:IRMATION)?|TRAN(?:SACTION)?|TXN|CHECK|CHK|CHEQUE|AUTH(?:ORIZATION)?|CONFIRMATION)\s*(?:ID|NO|NUM|NUMBER|#)?\s*[:#-]?\s*[A-Z0-9][A-Z0-9_-]*/gi, ' ')
    .replace(/\b(?=[A-Z0-9_-]*\d)[A-Z0-9][A-Z0-9_-]*\b/gi, ' ')
    .replace(/\b\d+\b/g, ' ').replace(/[^A-Z0-9]+/g, ' ').trim().split(/\s+/)
    .filter(token => token && !noise.has(token)).join(' ');
  return normalized || (raw ? 'RAW:' + raw : '');
}
export class MerchantClassificationIndex {
  constructor(records) {
    this.merchants = new Map(); this.exceptions = new Map(); this.ambiguous = new Set();
    for (const record of records) {
      if (record.deleted) continue;
      if (record.group != null && !['Essential','Potentially Flexible','Unclassified'].includes(record.group)) throw Error('Invalid merchant essentiality.');
      if (record.kind === 'transaction' && (typeof record.transactionId !== 'string' || !record.transactionId)) throw Error('Transaction exception is missing its stable ID.');
      if (record.kind === 'merchant' && !Array.isArray(record.aliases)) throw Error('Invalid merchant aliases.');
      if (record.kind === 'transaction') this.exceptions.set(record.transactionId, record);
      if (record.kind !== 'merchant') continue;
      for (const alias of record.aliases || []) {
        const key = merchantFingerprint(alias); if (!key) continue;
        if (this.merchants.has(key) && this.merchants.get(key).id !== record.id) this.ambiguous.add(key);
        else this.merchants.set(key, record);
      }
    }
  }
  merchantFor(description) {
    const key = merchantFingerprint(description);
    return this.ambiguous.has(key) ? null : this.merchants.get(key);
  }
  categoryFor(description, transactionId) {
    const rule = this.merchantFor(description);
    const exception = this.exceptions.get(transactionId);
    return {category: exception?.category ?? rule?.category, categoryId: exception?.categoryId ?? rule?.categoryId};
  }
}
const title = 'Merchant Classifications';
export async function readMerchantClassifications(spreadsheetId, token, exists) {
  const headers = {Authorization: `Bearer ${token}`};
  const root = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`;
  if (!exists) return {records: new Map(), positions: new Map(), nextRow: 2, exists: false};
  const response = await fetch(`${root}/values/${encodeURIComponent("'Merchant Classifications'!A1:B")}`, {headers});
  if (!response.ok) throw Error('Could not read merchant classifications.');
  const rows = (await response.json()).values || [];
  if (rows[0]?.[0] !== 'Record ID' || rows[0]?.[1] !== 'Classification') throw Error('Invalid merchant classification headers.');
  const records = new Map(), positions = new Map();
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i]?.[0] || !rows[i]?.[1]) continue;
    const record = JSON.parse(rows[i][1]);
    if (record.id !== rows[i][0]) throw Error('Invalid merchant classification record ID.');
    records.set(record.id, record); positions.set(record.id, i + 1);
  }
  return {records, positions, nextRow: rows.length + 1, exists: true};
}
export async function saveImportCategoryExceptions(spreadsheetId, token, state, changes) {
  if (!changes.length) return;
  const root = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`;
  const headers = {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'};
  if (!state.exists) {
    const response = await fetch(`${root}:batchUpdate`, {method: 'POST', headers, body: JSON.stringify({requests: [{addSheet: {properties: {title}}}]})});
    if (!response.ok) throw Error('Could not create merchant classifications sheet.');
  }
  const data = state.exists ? [] : [{range: "'Merchant Classifications'!A1:B1", values: [['Record ID','Classification']]}];
  for (const record of changes) {
    const row = state.positions.get(record.id) ?? state.nextRow++;
    state.positions.set(record.id, row);
    data.push({range: `'Merchant Classifications'!A${row}:B${row}`, values: [[record.id, JSON.stringify(record)]]});
  }
  const response = await fetch(`${root}/values:batchUpdate`, {method: 'POST', headers, body: JSON.stringify({valueInputOption: 'RAW', data})});
  if (!response.ok) throw Error('Could not save import category exceptions. No new expenses were appended; retry the import.');
}
