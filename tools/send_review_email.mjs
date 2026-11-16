// One explicitly authorized corporate email. Read its reviewed Gmail draft in
// the existing service, send with Brevo and notify the owner through Melodi.
// No provider credentials or private download links leave the service.
import {readFile,writeFile} from 'node:fs/promises';
import {cf} from '../workers/whatsapp/tools/cloudflare-release.mjs';
const action=process.argv[2],local=new URL('../.local/demo-jon/',import.meta.url);
const review=JSON.parse(await readFile(new URL('gmail-draft-job.json',local),'utf8'));
if(review.ownerPhone!=='18495205246'||review.to!=='hola@jonhernandez.education'||review.requestId!=='demo-jon-20261116-final')throw Error('unexpected_review');
const job={type:'melodi_send_review_draft',confirmed:true,ownerPhone:review.ownerPhone,from:'daniel@vetsa.es',to:review.to,reviewRequestId:review.requestId,requestId:'demo-jon-send-20261116-final'};
async function query(sql,params=[]){const response=await(await cf('/d1/database/f104d1d0-aae3-4e50-a0a6-723f7f5e7f0e/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sql,params})})).json();if(!response.success)throw Error('send_status_unavailable');return response.result?.[0]?.results||[];}
const exists=await query("SELECT name FROM sqlite_master WHERE type='table' AND name='brivany_review_sends'");
const prior=exists.length?(await query('SELECT request_id,state,email_id,whatsapp_id,error_code,updated_at FROM brivany_review_sends WHERE request_id=?',[job.requestId]))[0]:null;
if(action==='enqueue'){
 if(prior){console.log(JSON.stringify({queued:false,...prior}));process.exit(0);}
 const queues=await(await cf('/queues')).json(),queue=queues.result?.find(q=>q.queue_name==='vetsa-dona-jobs');if(!queue?.queue_id)throw Error('melodi_queue_not_found');
 const result=await(await cf('/queues/'+queue.queue_id+'/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({body:job,content_type:'json'})})).json();if(!result.success)throw Error('send_queue_not_accepted');
 await writeFile(new URL('email-enqueued.json',local),JSON.stringify({requestId:job.requestId,acceptedAt:new Date().toISOString()}));console.log(JSON.stringify({queued:true,requestId:job.requestId}));
}else if(action==='status'){
 const result=prior||{state:'not_processed'};await writeFile(new URL('email-result.json',local),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}else throw Error('choose_enqueue_or_status');
