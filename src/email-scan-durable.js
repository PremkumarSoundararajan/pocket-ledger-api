import {DurableObject} from 'cloudflare:workers';
import {EmailScanJob as Runner} from './email-scan-job.js';

export class EmailScanJob extends DurableObject {
  constructor(ctx,env){super(ctx,env);this.runner=new Runner(ctx,env);}
  fetch(request){return this.runner.fetch(request);}
  alarm(){return this.runner.alarm();}
}
