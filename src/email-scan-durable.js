import {DurableObject} from 'cloudflare:workers';
import {clearRetiredScanStorage} from './email-retirement.js';

// Keep the class binding so existing objects can erase their alarms and tokens.
// It cannot start/resume scans, refresh tokens, or read Gmail.
export class EmailScanJob extends DurableObject {
  async fetch() {
    await clearRetiredScanStorage(this.ctx.storage);
    return Response.json({retired:true,deleted:true});
  }
  async alarm() { await clearRetiredScanStorage(this.ctx.storage); }
}
