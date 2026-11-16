// Explicit owner-requested Gmail draft + WhatsApp delivery. Credentials stay
// in the existing service; the queued body lives only in .local, never in Git.
import {readFile,writeFile} from 'node:fs/promises';import {cf} from '../workers/whatsapp/tools/cloudflare-release.mjs';
const action=process.argv[2],path=new URL('../.local/demo-jon/gmail-draft-job.json',import.meta.url),job=JSON.parse(await readFile(path,'utf8'));
if(job.type!=='melodi_review_draft'||job.confirmed!==true||job.ownerPhone!=='18495205246'||job.to!=='hola@jonhernandez.education'||job.body.length>3000)throw Error('unexpected_review_request');
if(action==='enqueue'){
 const queues=await(await cf('/queues')).json(),queue=queues.result?.find(q=>q.queue_name==='vetsa-dona-jobs');if(!queue?.queue_id)throw Error('melodi_queue_not_found');
 const result=await(await cf('/queues/'+queue.queue_id+'/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({body:job,content_type:'json'})})).json();if(!result.success)throw Error('review_queue_not_accepted');
 await writeFile(new URL('../.local/demo-jon/review-enqueued.json',import.meta.url),JSON.stringify({requestId:job.requestId,acceptedAt:new Date().toISOString()}));console.log(JSON.stringify({queued:true,requestId:job.requestId,email_sent:false}));
}else if(action==='status'){
 const response=await(await cf('/d1/database/f104d1d0-aae3-4e50-a0a6-723f7f5e7f0e/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sql:'SELECT request_id,state,draft_id,message_id,updated_at FROM brivany_review_drafts WHERE request_id=?',params:[job.requestId]})})).json();if(!response.success)throw Error('review_status_unavailable');const result=response.result?.[0]?.results?.[0]||{state:'not_processed'};
 await writeFile(new URL('../.local/demo-jon/review-result.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}else throw Error('choose_enqueue_or_status');
