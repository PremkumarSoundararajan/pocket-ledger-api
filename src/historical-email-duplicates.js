import {merchantFingerprint} from './merchant-classifications.js';

// Keep deduplication for expenses already imported before retirement.
export function possibleEmailDuplicate(item,row) {
  const normal = value => String(value || '').toUpperCase().replace(/[^A-Z]/g, '');
  const a=normal(merchantFingerprint(row[3])), b=normal(merchantFingerprint(item.merchant));
  return String(row[2]).toLowerCase()!=='transfers' && Math.abs(Number(row[1])-item.amount)<.005 && String(row[0]).slice(0,10)===item.date && a && b && (a===b||(a.length>=4&&b.length>=4&&(a.startsWith(b)||b.startsWith(a))));
}
