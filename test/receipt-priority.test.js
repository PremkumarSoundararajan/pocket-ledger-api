import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectEmailReceipt,parseEmailReceipt} from '../src/email-receipts.js';

function message(body,subject='Receipt',received='2026-11-11T12:00:00Z'){
  return {internalDate:String(Date.parse(received)),payload:{mimeType:'text/plain',headers:[{name:'Subject',value:subject},{name:'From',value:'Test Shop <test@example.com>'}],body:{data:Buffer.from(body).toString('base64url')}}};
}
test('received/posted and thank-you payment phrases recognize completed payments',()=>{
  for(const phrase of ['Payment has been received','Payment was received','Thank you for your payment','We received your payment','Payment posted']){
    assert.equal(parseEmailReceipt(message(`${phrase}\nTransaction Amount: USD 32.10`)).amount,32.1,phrase);
  }
  for(const label of ['Amount paid','Current Amount Paid'])assert.equal(parseEmailReceipt(message(`${label}: USD 32.10`)).amount,32.1,label);
  const bare=parseEmailReceipt(message('Current Amount Paid: 32.10'),'CAD');assert.equal(bare.amount,32.1);assert.equal(bare.currency,'CAD');assert.equal(bare.currencyNeedsReview,true);
});
test('highest positive tier wins and only same-tier disagreement is a conflict',()=>{
  const paid=parseEmailReceipt(message('Payment posted\nSubtotal: USD 40\nTax: USD 5\nTotal: USD 45\nAmount charged: USD 30'));
  assert.equal(paid.amount,30);assert.match(paid.amountWarning,/lower-ranked/);
  assert.equal(parseEmailReceipt(message('Payment posted\nGrand Total: USD 45\nTotal: USD 40')).amount,45);
  assert.equal(parseEmailReceipt(message('Payment posted\nService Total: USD 45\nTotal: USD 40')).amount,45);
  const conflict=inspectEmailReceipt(message('Amount Paid: USD 30\nCurrent Amount Paid: USD 40\nTotal: USD 45'));
  assert.equal(conflict.reason,'amount_conflict');assert.equal(conflict.proposal,null);
  assert.equal(inspectEmailReceipt(message('Payment posted\nGrand Total: USD 45\nService Total: USD 40')).reason,'amount_conflict');
});
test('previous amounts, balances, tax, savings, zero and signed negatives are never totals',()=>{
  const value=parseEmailReceipt(message('Current Amount Paid: USD 20\nPrevious Amount Paid: USD 100\nRemaining Balance: USD 999\nBalance Due: USD 500\nTax Total: USD 3\nTotal: USD 0.00'));
  assert.equal(value.amount,20);
  assert.equal(parseEmailReceipt(message('Current Amount Paid: USD 0.00\nPrevious Amount Paid: USD 100')),null);
  assert.equal(parseEmailReceipt(message('Payment posted\nSubtotal: USD 40\nTax Total: USD 5\nRemaining balance: USD 100')),null);
  assert.equal(parseEmailReceipt(message('Payment posted\nAmount paid: -$20')),null);
  assert.equal(inspectEmailReceipt(message('Payment posted\nAmount paid: $0.00\nTotal: USD 45')).reason,'no_amount');
});
test('due balance alongside actual paid amount works, future and refund notices stay review-only',()=>{
  assert.equal(parseEmailReceipt(message('Current Amount Paid: USD 20\nRemaining balance due: USD 100','Payment due statement')).amount,20);
  for(const subject of ['Refund receipt','Upcoming payment','Payment failed'])assert.equal(inspectEmailReceipt(message('Amount paid: USD 20',subject)).proposal,null);
  assert.equal(inspectEmailReceipt(message('Total: USD 20','Payment due')).reason,'rejected_keyword:due');
});
test('review-only receipts retain clear unconfirmed amounts but never guess conflicting values',()=>{
  const cases=[['Your order is being prepared\nTotal: USD 20','no_completion_phrase'],['Amount paid: €19,99','unsupported_amount_format'],['Amount paid: USD 20\nAmount charged: USD 30','amount_conflict']];
  for(const [body,reason] of cases){const result=inspectEmailReceipt(message(body));assert.equal(result.reason,reason);assert.equal(result.review.needsReview,true);if(reason==='no_completion_phrase'){assert.equal(result.review.amount,20);assert.equal(result.review.amountIsSuggestion,true);}else assert.equal(result.review.amount,null);assert.equal(result.proposal,null);}
});
test('unrelated investing newsletters are ignored instead of asking for an expense amount',()=>{
  const value=message("Start your investing day. My top 10 things to watch. Anything less than a 10% decline today would be lucky. This was a tough stock to own even before we learned where the company spent its money.","Jim Cramer's top 10 things to watch in the stock market Monday");
  assert.equal(inspectEmailReceipt(value).reason,'not_receipt');assert.equal(inspectEmailReceipt(value).review,null);
  const bulk=message('Your weekly market analysis\nTotal: USD 40','Weekly update');bulk.payload.headers.push({name:'List-Unsubscribe',value:'<https://example.com/unsubscribe>'});
  assert.equal(inspectEmailReceipt(bulk).reason,'not_receipt');
});
test('a clear amount remains visible when completion is uncertain and conflicts list candidates',()=>{
  const one=inspectEmailReceipt(message('Total: USD 25.75','Your receipt'));
  assert.equal(one.review.amount,25.75);assert.equal(one.review.amountIsSuggestion,true);assert.equal(one.proposal,null);
  const conflict=inspectEmailReceipt(message('Amount paid: USD 20\nCurrent Amount Paid: USD 30'));
  assert.equal(conflict.review.amount,null);assert.deepEqual(conflict.review.amountCandidates.map(x=>x.amount),[20,30]);
  assert.equal(inspectEmailReceipt(message('¥12,000 — Amount paid')).proposal,null);
});
test('zoned M/D/YY timestamps convert to the user timezone with date rollover',()=>{
  const receipt=message('Payment was received\nTransaction Amount: USD 20\n11/2/26 11:45pm CST');
  const india=parseEmailReceipt(receipt,'USD',{timezone:'Asia/Kolkata'});
  assert.equal(india.date,'2026-11-03');assert.match(india.dateSource,/CST.*Asia\/Kolkata/);assert.equal(india.dateNeedsReview,true);
  assert.equal(parseEmailReceipt(receipt,'USD',{timezone:'America/Chicago'}).date,'2026-11-02');
  assert.equal(parseEmailReceipt(message('Amount paid: USD 20\n11/2/26 4:34am CST'),'USD',{timezone:'Asia/Kolkata'}).date,'2026-11-02');
});
test('Paid on month/day infers the received local year, including January rollover',()=>{
  assert.equal(parseEmailReceipt(message('Amount paid: USD 20\nPaid on Nov 10'),'USD',{timezone:'Asia/Kolkata'}).date,'2026-11-10');
  assert.equal(parseEmailReceipt(message('Amount paid: USD 20\nPaid on Dec 31','Receipt','2026-01-02T12:00:00Z'),'USD',{timezone:'America/Chicago'}).date,'2025-12-31');
});
test('fallback received date is local, while a printed date-only value is not shifted',()=>{
  const msg=message('Amount paid: USD 20','Receipt','2026-11-02T18:45:00Z');
  assert.equal(parseEmailReceipt(msg,'USD',{timezone:'Asia/Kolkata'}).date,'2026-11-03');
  assert.equal(parseEmailReceipt(message('Amount paid: USD 20\nPayment date: 2026-11-02'),'USD',{timezone:'Asia/Kolkata'}).date,'2026-11-02');
});

test('missing and zero-only amounts are ignored, not queued for review',()=>{
  for(const body of ['Payment posted','Thank you for your payment','Service Total: USD 0.00','Amount paid: $0.00\nTotal: USD 45']){
    const result=inspectEmailReceipt(message(body));assert.equal(result.proposal,null);assert.equal(result.review,null);assert.equal(result.reason,'no_amount');
  }
});
test('completed narrative payments and Gideon transaction alerts capture their amounts',()=>{
  for(const body of ['Your payment of $234.40 has been received.','Your payment of USD $234.40 was processed.','We received your payment of $234.40.','Thank you for your payment of $234.40','You paid $234.40']){
    assert.equal(parseEmailReceipt(message(body)).amount,234.4,body);
  }
  const gideon=parseEmailReceipt(message('Thank you!','You made a $320.00 transaction with GIDEON MATH & READING'));
  assert.equal(gideon.amount,320);assert.equal(gideon.merchant,'GIDEON MATH READING');
  const html=message('');html.payload.mimeType='text/html';html.payload.body.data=Buffer.from('<p>We received your payment.</p><table><tr><td>Amount</td><td>paid</td></tr><tr><td>$234.40</td></tr></table>').toString('base64url');
  assert.equal(parseEmailReceipt(html).amount,234.4);
  assert.equal(parseEmailReceipt(message('Amount paid: USD 320','Thank you for your payment to Gideon Keller!')).merchant,'Gideon Keller');
});
test('narrative payments preserve conflicts, failures, transfers and promotion safeguards',()=>{
  assert.equal(inspectEmailReceipt(message('Your payment of $20 has been received. Amount paid: USD 30')).reason,'amount_conflict');
  for(const subject of ['Refund receipt','Scheduled payment','Payment failed'])assert.equal(parseEmailReceipt(message('Your payment of $20 has been received.',subject)),null);
  assert.equal(parseEmailReceipt(message('We received your payment of $20. Credit card payment')),null);
  assert.equal(parseEmailReceipt(message('Enter to win a $25 discount toward your next payment','Keller Gideon Raffle')),null);
  assert.equal(parseEmailReceipt(message('Your payment of $20 will be processed tomorrow','Upcoming payment')),null);
});

test('tabular paid columns are associated with their values, never the next row date',()=>{
  const msg=message('');msg.payload.mimeType='text/html';
  msg.payload.body.data=Buffer.from('<h2>Payment Summary</h2><table><tr><th>Fee Date</th><th>Type</th><th>Student</th><th>Activity</th><th>Amount</th><th>Tax</th><th>Amount Paid</th></tr><tr><td>11/01/2026</td><td>Tuition Fee</td><td>Student</td><td></td><td>320.00</td><td>0.00</td><td>320.00</td></tr></table>').toString('base64url');
  assert.equal(parseEmailReceipt(msg).amount,320);
  assert.equal(inspectEmailReceipt(message('Amount Paid\n11/01/2026\nTuition Fee')).review,null);
  msg.payload.body.data=Buffer.from('<table><tr><th>Fee Date</th><th>Amount Paid</th></tr><tr><td>11/01/2026</td><td>320.00</td></tr><tr><td>11/02/2026</td><td>40.00</td></tr></table>').toString('base64url');
  assert.equal(inspectEmailReceipt(msg).reason,'amount_conflict');
});
test('bill-available messages with only amount due are not completed expenses',()=>{
  const result=inspectEmailReceipt(message('Your bill is ready. Amount Due\n$234.40\nPay bill','Your $234.40 bill due October 30, 2026 is now available'));
  assert.equal(result.proposal,null);assert.equal(result.review,null);
});

test('generic sent-money alerts retain recipient and amount but require expense confirmation',()=>{
 const msg=message('Transfer alert\nYou sent $308.12 to\nRHYTHM OPS LLC\nAccount ending in (...1234)\nSent on Oct 2, 2026 at 9:23 AM ET','You sent $308.12 from account ending in (...1234)','2026-10-02T13:27:00Z');
 const value=inspectEmailReceipt(msg,'USD',{timezone:'America/Chicago'});
 assert.equal(value.proposal,null);assert.equal(value.review.amount,308.12);assert.equal(value.review.merchant,'RHYTHM OPS LLC');assert.equal(value.review.amountIsSuggestion,true);assert.equal(value.reason,'rejected_transfer');assert.equal(value.review.date,'2026-10-02');
 for(const [money,currency,amount] of [['CAD 42.50','CAD',42.5],['MYR 120.00','MYR',120],['INR 2500.00','INR',2500]]){
   const generic=inspectEmailReceipt(message(`You sent ${money} to\nExample Services`,'Transfer notification'),currency);
   assert.equal(generic.proposal,null);assert.equal(generic.review.amount,amount);assert.equal(generic.review.currency,currency);assert.equal(generic.review.merchant,'Example Services');
 }
 const html=message('','Transfer notification');html.payload.mimeType='text/html';html.payload.body.data=Buffer.from('<div>You sent $308.12 to</div><div>Example Services</div><div>Account ending in 1234</div>').toString('base64url');
 assert.equal(inspectEmailReceipt(html).review.merchant,'Example Services');
});
test('sent-money rules do not accept future, incoming, ambiguous or zero transfers as expenses',()=>{
 for(const body of ['You will send $20 to Example','You received $20 from Example','You sent $0.00 to Example','You sent 1234 to Example'])assert.equal(inspectEmailReceipt(message(body,'Transfer alert')).review,null);
 const conflict=inspectEmailReceipt(message('You sent $20 to Example\nYou sent $30 to Example','Transfer alert'));assert.equal(conflict.reason,'amount_conflict');assert.equal(conflict.review.amount,null);
 const own=inspectEmailReceipt(message('You sent $20 to\nMy other account','Transfer completed'));assert.equal(own.reason,'rejected_transfer');assert.equal(own.proposal,null);
 const failed=inspectEmailReceipt(message('You sent $20 to Example','Payment failed'));assert.equal(failed.reason,'rejected_keyword:failed');assert.equal(failed.proposal,null);
});

test('sent alerts tolerate HTML line breaks between the completion words',()=>{
 const msg=message('','You sent $308.12 from account ending in 1234');msg.payload.mimeType='text/html';msg.payload.body.data=Buffer.from('<div>You</div><div>sent</div><span>$308.12</span><div>to</div><div>Example Services</div>').toString('base64url');
 const result=inspectEmailReceipt(msg);assert.equal(result.review.amount,308.12);assert.equal(result.review.merchant,'Example Services');assert.equal(result.review.sourceKind,'bank_alert');
});

test('email merchant display uses baseline noise removal and stops before payment prose',async()=>{
 const {emailMerchantName}=await import('../src/email-receipts.js');
 assert.equal(emailMerchantName('COSTCO WHSE #1173'),'COSTCO WHSE');
 assert.equal(emailMerchantName('CVS/PHARMACY #10879'),'CVS PHARMACY');
 assert.equal(emailMerchantName('Atmos Energy. Your payment has been received'),'Atmos Energy');
 assert.equal(emailMerchantName('ATMOS ENERGY RCR'),'ATMOS ENERGY');
 assert.equal(emailMerchantName('Test Shop'),'Test Shop');
 assert.equal(emailMerchantName('do-not-reply@example.com'),'do-not-reply@example.com');
});
