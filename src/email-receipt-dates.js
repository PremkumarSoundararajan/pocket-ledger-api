const months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const monthPattern='Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?';
const dateFormatters=new Map();
function formatter(timezone){
  if(typeof timezone!=='string'||timezone.length>100)throw new RangeError('Invalid timezone');
  if(!dateFormatters.has(timezone)){
    if(dateFormatters.size>=64)dateFormatters.delete(dateFormatters.keys().next().value);
    dateFormatters.set(timezone,new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}));
  }
  return dateFormatters.get(timezone);
}
export function receiptTimezone(value='UTC') {
  formatter(value);return value;
}
function localDate(time,timezone){
  const p=Object.fromEntries(formatter(timezone).formatToParts(time).map(x=>[x.type,x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
function dateOnly(year,month,day){
  const text=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  return Number.isFinite(Date.parse(text))&&new Date(text).toISOString().startsWith(text)?text:null;
}
export function emailReceiptDate(body,received,timezone='UTC') {
  if(!Number.isFinite(received.getTime()))return {date:'',dateSource:'Verify payment date',dateNeedsReview:true,reason:'invalid_date'};
  timezone=receiptTimezone(timezone);
  const fallback={date:localDate(received,timezone),dateSource:`email received date (${timezone}); verify`,dateNeedsReview:true};
  // A supported date-only label is already a calendar date, not a UTC instant.
  const iso=body.match(/\b(?:payment date|transaction date|date paid)\s*[:=-]?\s*(\d{4}-\d{2}-\d{2})\b/i)?.[1];
  if(iso&&dateOnly(...iso.split('-').map(Number)))return {date:iso,dateSource:'email payment date',dateNeedsReview:false};
  // This explicit receipt format is M/D/YY, with an AM/PM time and zone.
  const stamp=body.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)\s*(UTC|GMT|Z|EST|EDT|CST|CDT|MST|MDT|PST|PDT|[+-]\d{2}:?\d{2})\b/i);
  if(stamp){
    const [,mo,da,yr,hr,mi,se,ap,zone]=stamp;
    const year=yr.length===2?2000+Number(yr):Number(yr),hour=Number(hr),minute=Number(mi),second=Number(se||0),z=zone.toUpperCase();
    const offsets={UTC:0,GMT:0,Z:0,EST:-300,EDT:-240,CST:-360,CDT:-300,MST:-420,MDT:-360,PST:-480,PDT:-420};
    let offset=offsets[z];
    if(offset==null){const digits=z.replace(':','');const h=Number(digits.slice(1,3)),m=Number(digits.slice(3));if(h>14||m>59||(h===14&&m!==0))return {...fallback,reason:'invalid_date'};offset=(z[0]==='-'?-1:1)*(h*60+m);}
    if(!dateOnly(year,Number(mo),Number(da))||hour<1||hour>12||minute>59||second>59)return {...fallback,reason:'invalid_date'};
    const instant=Date.UTC(year,Number(mo)-1,Number(da),(hour%12)+(ap.toLowerCase()==='pm'?12:0),minute,second)-offset*60000;
    return {date:localDate(instant,timezone),dateSource:`email payment timestamp (${z} → ${timezone})`,dateNeedsReview:z==='CST'};
  }
  const named=body.match(new RegExp(`\\b(?:your )?transaction on\\s+(${monthPattern})\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`,'i'));
  if(named){const date=dateOnly(Number(named[3]),months.indexOf(named[1].slice(0,3).toLowerCase())+1,Number(named[2]));return date?{date,dateSource:'email payment date',dateNeedsReview:false}:{...fallback,reason:'invalid_date'};}
  const paid=body.match(new RegExp(`\\bpaid on\\s+(${monthPattern})\\s+(\\d{1,2})(?:,?\\s+(\\d{4}))?\\b`,'i'));
  if(paid){
    const [receivedYear,receivedMonth]=fallback.date.split('-').map(Number),month=months.indexOf(paid[1].slice(0,3).toLowerCase())+1;
    const year=paid[3]?Number(paid[3]):receivedYear-(receivedMonth===1&&month===12?1:0);
    const date=dateOnly(year,month,Number(paid[2]));
    if(!date)return {...fallback,reason:'invalid_date'};
    if(Date.parse(date)>Date.parse(fallback.date)+2*86400000)return {...fallback,reason:'date_ambiguous'};
    return {date,dateSource:paid[3]?'email payment date':`email payment date; year inferred from received date (${timezone})`,dateNeedsReview:!paid[3]};
  }
  return fallback;
}
