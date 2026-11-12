import { emailReceiptDate } from './email-receipt-dates.js';
import { merchantFingerprint } from './merchant-classifications.js';
const completed = /\b(?:payment (?:was |has been )?(?:successful|completed|processed|confirmed|received|posted)|thank you for your payment|we (?:have )?received your payment|you (?:have )?paid|(?:successfully |was |been )charged|purchase (?:receipt|confirmation)|receipt for (?:your )?payment|autopay (?:was )?(?:processed|completed))\b/i;
const upcoming = /\b(?:scheduled|upcoming|reminder|due|failed|declined|cancelled|canceled|refund|reversed|statement available)\b/i;
const transfer = /\b(?:credit card payment|payment to (?:your )?(?:credit )?card|payment thank you|transfer between|transferred to|payment received on your card)\b/i;
const codes = 'USD|CAD|AUD|EUR|GBP|INR|SGD|MYR';
const supportedCurrencies=new Set(codes.split('|'));
const symbols = { '€':'EUR','£':'GBP','₹':'INR' };
export const receiptParserVersion = 11;
export function emailMerchantName(value){
  const raw=String(value||'').trim();if(raw.includes('@'))return raw;
  const clean=raw.replace(/&amp;/gi,'&').split(/\s*[.!?]\s+(?=(?:your|we|thank|payment|this|please)\b)|\s+(?=(?:your payment|we (?:have )?received|thank you for your payment)\b)/i)[0].trim();
  const fingerprint=merchantFingerprint(clean),original=clean.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if(!fingerprint||fingerprint.startsWith('RAW:'))return clean;
  return fingerprint.split(' ').map(token=>original.find(word=>word.toUpperCase()===token)||token).join(' ');
}
const spentLabel = 'total spent(?: this trip| today)?|transaction total|purchase total';
const dollarPrefixes = {US:'USD',C:'CAD',CA:'CAD',A:'AUD',AU:'AUD',S:'SGD',SG:'SGD',NZ:'NZD',HK:'HKD',MX:'MXN'};
const moneyPrefix = `${codes}|US|CA|C|AU|A|SG|S|NZ|HK|MX`;
const rawNumber = "[0-9](?:[0-9.,'’ \\t\\u00a0\\u202f]{0,48}[0-9])?";

function money(match,defaultCurrency) {
  const raw=match[3];
  // Validate the entire captured token before stripping separators. Never
  // truncate decimal-comma, three-decimal, Indian or apostrophe formats.
  if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(raw))return null;
  const prefix=match[1]?.trim().toUpperCase(),suffix=match[4]?.toUpperCase(),symbol=match[2];
  if(prefix in dollarPrefixes && symbol!=='$')return null;
  const explicit=dollarPrefixes[prefix]||prefix||suffix||symbols[symbol];
  if(suffix&&explicit&&suffix!==explicit)return null;
  if(symbols[symbol]&&explicit!==symbols[symbol])return null;
  if(symbol==='$'&&explicit&&!['USD','CAD','AUD','SGD','NZD','HKD','MXN'].includes(explicit))return null;
  const currency=(explicit||defaultCurrency).toUpperCase();
  if(!supportedCurrencies.has(currency))return null;
  const cents=Math.round(Number(raw.replaceAll(',',''))*100);
  if(!Number.isSafeInteger(cents)||cents<0||cents>10000000000)return null;
  return {cents,currency,currencyNeedsReview:!explicit,raw};
}

const entities={nbsp:' ',amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",mdash:'—',ndash:'–'};
function htmlText(text) {
  return text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>|<[^>]+>|&(#x[0-9a-f]+|#\d+|nbsp|amp|lt|gt|quot|apos|mdash|ndash);/gi,(token,ignored,entity)=>{
    if(entity){
      if(entity[0]!=='#')return entities[entity.toLowerCase()]||token;
      const value=entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):Number(entity.slice(1));
      return value>0&&value<=0x10ffff?String.fromCodePoint(value):token;
    }
    return /^<(?:br\b|\/(?:p|div|tr|td|table|li|h[1-6])\b)/i.test(token)?'\n':' ';
  });
}

function tableAmounts(html) {
  const result=[];
  for(const table of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)){
    let labels=[];
    for(const row of table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
      const cells=[...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m=>htmlText(m[1]).replace(/\s+/g,' ').trim());
      if(cells.some(c=>/^(?:current amount paid|amount paid|amount charged|transaction amount|total paid|payment amount|grand total|service total)$/i.test(c))){labels=cells;continue;}
      if(cells.length!==labels.length)continue;
      for(let i=0;i<labels.length;i++)if(/^(?:current amount paid|amount paid|amount charged|transaction amount|total paid|payment amount)$/i.test(labels[i])&&/^(?:(?:USD|CAD|AUD|EUR|GBP|INR|SGD|MYR)\s*)?[$€£₹]?\s*\d[\d,.]*$/.test(cells[i]))result.push(`${labels[i]}: ${cells[i]}`);
    }
  }
  return result.join('\n');
}

export function gmailText(payload) {
  const chunks=[];let length=0;
  function visit(part,depth=0) {
    if(depth>8||length>=64000||part.filename)return;
    if(['text/plain','text/html'].includes(part.mimeType)&&part.body?.data){
      const remaining=64000-length,maxBytes=part.mimeType==='text/html'?256000:remaining;
      const encoded=part.body.data.slice(0,4*Math.ceil(maxBytes/3)).replace(/-/g,'+').replace(/_/g,'/');
      const raw=atob(encoded);
      let text=new TextDecoder().decode(Uint8Array.from(raw,c=>c.charCodeAt(0)).subarray(0,maxBytes));
      if(part.mimeType==='text/html')text=htmlText(text)+'\n'+(/paid|charged/i.test(text)?tableAmounts(text):'');
      text=text.slice(0,remaining);if(text.trim()){chunks.push(text);length+=text.length;}
    }
    const children=(part.parts||[]).slice(0,20);
    if(part.mimeType==='multipart/alternative'){
      const plain=children.find(p=>p.mimeType==='text/plain'&&p.body?.data&&!p.filename);
      const before=length;if(plain)visit(plain,depth+1);if(length>before)return;
      const html=children.find(p=>p.mimeType==='text/html'&&p.body?.data&&!p.filename);
      if(html){visit(html,depth+1);return;}
    }
    for(const child of children){if(length>=64000)break;visit(child,depth+1);}
  }
  visit(payload);return chunks.join('\n').slice(0,64000);
}

const paidLabels='current amount paid|amount paid|amount charged|transaction amount|total paid|payment amount|you (?:have )?paid|charged';
const totalLabels=`${paidLabels}|grand total|service total|${spentLabel}|total`;
const reversedAmountPattern=new RegExp(`((?:${moneyPrefix})\\s*)?([$€£₹])?\\s*(${rawNumber})(?:\\s*(${codes}))?\\s*[—–:-]\\s*\\b(${totalLabels})\\b`,'gi');
const forwardAmountPattern=new RegExp(`\\b(${totalLabels})\\b\\s*(?:[:=—–]|-\\s+)?\\s*((?:${moneyPrefix})\\s*)?([$€£₹])?\\s*(${rawNumber})(?:\\s*(${codes}))?(?![\\d/]|-\\d)`,'gi');
const narrativeMoney=`((?:${moneyPrefix})\\s*)?([$€£₹])\\s*(${rawNumber})(?:\\s*(${codes}))?`;
const narrativePatterns=[
    `\\b(?:your payment|a payment)\\s+of\\s+${narrativeMoney}\\s+(?:has been|was|is)\\s+(?:received|processed|completed|successful|posted)\\b`,
    `\\b(?:we (?:have )?received your payment|thank you for your payment|you (?:have )?paid)\\s+(?:of\\s+)?${narrativeMoney}(?!\\d|[.,]\\d)`,
    `\\byou made (?:a |an )?${narrativeMoney}\\s+(?:transaction|purchase)\\s+(?:with|at)\\b`,
  ].map(pattern=>new RegExp(pattern,'gi'));

const sentMoney=`((?:${moneyPrefix})\\s*)?([$€£₹])?\\s*(${rawNumber})(?:\\s*(${codes}))?`;
const sentAmountPattern=new RegExp(`\\byou\\s+sent\\s+${sentMoney}\\s+(?:to\\b|from\\s+(?:your\\s+)?account\\b)`,'gi');
function rank(label){return /^(?:current amount paid|amount paid|amount charged|transaction amount|total paid|payment amount|you (?:have )?paid|charged)$/i.test(label)?1:/^(?:grand total|service total)$/i.test(label)?2:3;}
function paymentAmounts(text,defaultCurrency){
  // Join split label words without joining an amount to a following date.
  text=text.replace(/\b(current\s+amount\s+paid|amount\s+(?:paid|charged)|transaction\s+amount|total\s+paid|payment\s+amount|grand\s+total|service\s+total)\b/gi,label=>label.replace(/\s+/g,' '));
  const paidLabel=/\b(?:current amount paid|amount paid|total paid)\b/i.test(text);
  const reversed=[...text.matchAll(reversedAmountPattern)];
  const forward=[...text.matchAll(forwardAmountPattern)];
  const candidates=[];
  function add(match,label,numberMatch,labelIndex){
    const before=text.slice(Math.max(0,labelIndex-55),labelIndex);
    if(/\b(?:previous|prior|last|remaining balance|outstanding balance|remaining|outstanding|unpaid|balance due|tax|taxes)\s*(?:[—–:-]\s*)?$/i.test(before))return;
    if(/^\s*(?:saved|savings|ExtraCare|rewards|discount|tax|taxes|balance|due|remaining)\b/i.test(text.slice(labelIndex+label.length,labelIndex+label.length+55)))return;
    if(/[-−(]\s*$/.test(text.slice(Math.max(0,match.index-3),match.index)))return;
    if(!(numberMatch[1]||numberMatch[2]||numberMatch[4])&&!/^(?:current amount paid|amount paid|amount charged|transaction amount|total paid|payment amount)$/i.test(label))return;
    const unknownCurrency=!(numberMatch[1]||numberMatch[2]||numberMatch[4])&&/(?:\b[A-Z]{3}|\p{Sc})\s*$/u.test(text.slice(Math.max(0,match.index-10),match.index));
    const value=unknownCurrency?null:money(numberMatch,defaultCurrency);
    candidates.push({value,label,rank:rank(label),evidence:{label,amount:value?value.cents/100:null,currency:value?.currency||null,
      amountText:[numberMatch[1],numberMatch[2],numberMatch[3],numberMatch[4]].filter(Boolean).join(' ').trim().slice(0,80)}});
  }
  for(const m of reversed)add(m,m[5],m,m.index+m[0].toLowerCase().lastIndexOf(m[5].toLowerCase()));
  for(const m of forward){
    if(reversed.some(r=>m.index>=r.index&&m.index<r.index+r[0].length))continue;
    add(m,m[1],[m[0],m[2],m[3],m[4],m[5]],m.index);
  }
  // Only capture narrative amounts attached to a completed payment.
  for(const pattern of narrativePatterns)for(const m of text.matchAll(pattern)){
    const before=candidates.length;
    add(m,'payment amount',m,m.index);
    if(candidates.length>before)candidates.at(-1).completedPayment=true;
  }
  for(const m of text.matchAll(sentAmountPattern)){
    if(!(m[1]||m[2]||m[4]))continue;
    const before=candidates.length;
    add(m,'payment amount',m,m.index);
    if(candidates.length>before)candidates.at(-1).outgoingTransfer=true;
  }
  const amountCandidates=[...new Map(candidates.map(c=>[`${c.label}|${c.evidence.amountText}`,c.evidence])).values()].slice(0,6);
  const result=value=>({...value,amountCandidates,outgoingTransfer:candidates.some(c=>c.outgoingTransfer)});
  if(!candidates.length)return result({reason:'no_amount',paidLabel});
  const highest=Math.min(...candidates.map(c=>c.rank));
  const top=candidates.filter(c=>c.rank===highest&&c.value?.cents!==0);
  if(!top.length)return result({reason:'no_amount',paidLabel});
  if(top.some(c=>!c.value))return result({reason:'unsupported_amount_format',paidLabel});
  const unique=new Map(top.map(c=>[`${c.value.currency}:${c.value.cents}`,c]));
  if(unique.size!==1)return result({reason:'amount_conflict',paidLabel});
  const selected=[...unique.values()][0];
  const lowerConflict=candidates.some(c=>c.rank>highest&&c.value&&(c.value.cents!==selected.value.cents||c.value.currency!==selected.value.currency));
  return result({...selected,completedPayment:top.some(c=>c.completedPayment),explicitPaid:top.some(c=>/^(?:current amount paid|amount paid|total paid)$/i.test(c.label)),
    amountWarning:lowerConflict?'Paid/charged amount differs from a lower-ranked receipt total. Confirm which amount belongs in your ledger.':'',
    currencyNeedsReview:top.some(c=>c.value.currencyNeedsReview)});
}

/** Broad Gmail search hits still need receipt evidence; newsletters are ignored. */
export function inspectEmailReceipt(message, defaultCurrency='USD', options={}) {
  const headers=Object.fromEntries((message.payload?.headers||[]).map(h=>[h.name.toLowerCase(),h.value]));
  const subject=String(headers.subject||'').slice(0,200),sender=String(headers.from||'').slice(0,200);
  let body='',readError=false;
  try{body=gmailText(message.payload||{});}catch{readError=true;}
  const dateInfo=emailReceiptDate(body,new Date(Number(message.internalDate)),options.timezone||'UTC');
  const merchantMatch=body.match(/\b(?:merchant|paid to|payment to|purchase at)\s*[:=-]?\s*([^\r\n]{2,100})/i);
  const alertMerchant=`${subject}\n${body}`.match(/\byou made (?:a |an )?(?:(?:USD|CAD|AUD|SGD)\s*)?\$[\d,.]+\s+(?:transaction|purchase)\s+(?:with|at)\s+([^\r\n]{2,100})/i);
  const sentMerchant=body.match(new RegExp(`\\byou\\s+sent\\s+(?:(?:${moneyPrefix})\\s*)?[$€£₹]?\\s*${rawNumber}(?:\\s*(?:${codes}))?\\s+to\\s+([^\\r\\n]{2,100})`,'i'));
  const subjectMerchant=subject.match(/\bthank you for your payment to\s+(.+?)[!.]?$/i);
  const displaySender=sender.replace(/<[^>]+>/g,'').replaceAll('"','').trim();
  const merchant=emailMerchantName(merchantMatch?.[1]?.trim()||sentMerchant?.[1]?.trim()||alertMerchant?.[1]?.trim()||subjectMerchant?.[1]?.trim()||displaySender||sender||'Unknown merchant').slice(0,120);
  const base={merchant,amount:null,currency:defaultCurrency,...dateInfo,subject,sender,excerpt:body.replace(/\s+/g,' ').slice(0,400),
    merchantNeedsReview:!(merchantMatch||sentMerchant||alertMerchant||subjectMerchant),sourceKind:alertMerchant||sentMerchant?'bank_alert':'receipt',category:'Uncategorized',categoryId:null,expenseType:'Unknown'};
  const text=`${subject}\n${body}`,amount=paymentAmounts(text,defaultCurrency);
  const subjectHint=/\b(?:receipt|invoice|payment|billing|bill|order confirmation|your (?:trip|ride)|subscription renewed|e-?ticket|transaction (?:alert|receipt|notification)|purchase confirmation)\b/i.test(subject);
  const bodyHint=/\b(?:your payment|you (?:have )?paid|your (?:card|transaction|purchase|order)|we (?:have )?received your payment|thank you for your payment|payment (?:was |has been )?(?:successful|completed|processed|confirmed|received|posted))\b/i.test(body);
  const attachmentHint=(message.payload?.parts||[]).some(p=>/\b(?:invoice|receipt|payment)[^/]*\.pdf$/i.test(p.filename||''));
  const newsletter=/\b(?:newsletter|things to watch|stock market|market outlook|daily digest|investment ideas|top \d+)\b/i.test(subject);
  const bulkMail=!!headers['list-unsubscribe']||/\b(?:bulk|list)\b/i.test(headers.precedence||'');
  const relevant=subjectHint||bodyHint||attachmentHint||amount.explicitPaid||(!newsletter&&!bulkMail&&(amount.amountCandidates?.length||0)>0);
  if(!relevant&&!amount.completedPayment&&!amount.outgoingTransfer)return {proposal:null,review:null,reason:'not_receipt'};
  // Missing/zero totals cannot produce an actionable expense. Preserve
  // conflicting and unsupported monetary evidence for manual review.
  if(amount.reason==='no_amount')return {proposal:null,review:null,reason:'no_amount'};
  function review(reason){
    const suggestion=amount.value&&amount.value.cents>0?{
      amount:amount.value.cents/100,currency:amount.value.currency,amountText:amount.value.raw,amountLabel:amount.label,
      amountIsSuggestion:true,currencyNeedsReview:amount.currencyNeedsReview,
    }:{};
    return {proposal:null,review:{...base,...suggestion,amountCandidates:amount.amountCandidates||[],needsReview:true,reviewReason:reason},reason};
  }
  if(readError||!body.trim())return review('unreadable_content');
  const negative=subject.match(upcoming)?.[0]?.toLowerCase();
  // A current positive paid amount can coexist with a remaining balance due.
  // It never overrides failures, refunds, scheduled notices or transfers.
  if(negative&&!(negative==='due'&&amount.explicitPaid))return review(`rejected_keyword:${negative}`);
  if(transfer.test(text.slice(0,4000)))return review('rejected_transfer');
  const future=body.slice(0,1500).match(/\b(?:will be (?:charged|debited)|scheduled for|payment (?:is )?due)\b/i)?.[0];
  if(future&&!( /^payment (?:is )?due$/i.test(future)&&amount.explicitPaid))return review('rejected_keyword:scheduled');
  // Sent money may be a bill payment, P2P transfer, or movement between the
  // user's own accounts. Preserve evidence but require explicit confirmation.
  if(amount.outgoingTransfer)return review(amount.reason||'rejected_transfer');
  const retailReceipt=/\breceipt\b/i.test(subject)&&/\b(?:your )?transaction on\b/i.test(body)&&new RegExp(`\\b(?:${spentLabel})\\b`,'i').test(body);
  if(amount.reason&&amount.paidLabel)return review(amount.reason);
  if(!(completed.test(text)||retailReceipt||amount.explicitPaid||amount.completedPayment))return review('no_completion_phrase');
  if(amount.reason)return review(amount.reason);
  if(dateInfo.reason)return review(dateInfo.reason);
  const value=amount.value;
  return {proposal:{...base,amount:value.cents/100,currency:value.currency,currencyNeedsReview:amount.currencyNeedsReview,
    amountText:value.raw,amountLabel:amount.label,amountWarning:amount.amountWarning},review:null,reason:null};
}
export function parseEmailReceipt(message, defaultCurrency='USD', options={}) {
  return inspectEmailReceipt(message,defaultCurrency,options).proposal;
}
