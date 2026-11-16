import test from 'node:test';import assert from 'node:assert/strict';import {financeFixture} from './finance-fixture.js';import {prepareReviewDraft,sendReviewedDraft} from '../review-draft.js';
const owner='18095550101',body='Enlace https://youtu.be/iVE8Vx5Wseg\nhttps://demo.brivany.vetsa.es/download?ticket=synthetic\nAcceso temporal; revocaremos las claves al finalizar.';
async function setup(){const f=await financeFixture(),created=[],sent=[],job={confirmed:true,ownerPhone:owner,requestId:'demo-jon-20261116-test',to:'hola@jonhernandez.education',subject:'Brivany: demostración',body};const useGmail=async(_env,phone,operation)=>{assert.equal(phone,owner);return operation({async createDraft(input){created.push(input);return {id:'synthetic-draft'};},async getDraft(){return {message:{id:'message',payload:{headers:[{name:'Subject',value:'=?UTF-8?B?'+Buffer.from(job.subject).toString('base64')+'?='},{name:'To',value:job.to}],mimeType:'text/plain',body:{data:Buffer.from(job.body).toString('base64url')}}}};}},{email:'felixdanielluna40@gmail.com'});};const send=async(_env,phone,text)=>{assert.equal(phone,owner);sent.push(text);return {messageId:'synthetic-receipt'};};return {f,created,sent,job,useGmail,send,env:{...f.env,OWNER_WHATSAPP_NUMBER:owner}};}
test('draft is read back, remains unsent and its exact text is sent only to the owner once',async()=>{const {f,created,sent,job,useGmail,send,env}=await setup();try{const result=await prepareReviewDraft(env,job,send,{useGmail});assert.equal(result.state,'delivered');assert.equal(created.length,1);assert.equal(sent.length,1);assert(sent[0].includes(job.body));assert(sent[0].includes('No lo he enviado'));await prepareReviewDraft(env,job,send,{useGmail});assert.equal(created.length,1);assert.equal(sent.length,1);}finally{f.db.sql.close();}});
test('wrong owner or recipient cannot create a draft or send the private download',async()=>{const {f,created,sent,job,useGmail,send,env}=await setup();try{for(const change of [{ownerPhone:'18095559999'},{to:'unapproved@example.com'},{confirmed:false}])await assert.rejects(()=>prepareReviewDraft(env,{...job,...change},send,{useGmail}));assert.equal(created.length,0);assert.equal(sent.length,0);}finally{f.db.sql.close();}});
test('an ambiguous notification is not sent again automatically',async()=>{const {f,created,job,useGmail,env}=await setup();let sends=0;try{const send=async()=>{sends++;throw Error('timeout');};await assert.rejects(()=>prepareReviewDraft(env,job,send,{useGmail}));const result=await prepareReviewDraft(env,job,send,{useGmail});assert.equal(result.state,'uncertain');assert.equal(created.length,1);assert.equal(sends,1);}finally{f.db.sql.close();}});

async function readyToSend(){
 const s=await setup();await prepareReviewDraft(s.env,s.job,s.send,{useGmail:s.useGmail});s.sent.length=0;
 const emails=[],requests=[],env={...s.env,BREVO_API_KEY:'synthetic-only'},job={type:'melodi_send_review_draft',confirmed:true,ownerPhone:owner,from:'daniel@vetsa.es',to:s.job.to,reviewRequestId:s.job.requestId,requestId:'demo-jon-send-20261116-test'};
 const fetcher=async(url,init)=>{requests.push(url);assert.equal(init.headers['api-key'],'synthetic-only');assert(!init.method||init.method==='GET');return Response.json(url.includes('domains/')?{verified:true,authenticated:true}:{senders:[{email:'daniel@vetsa.es',active:true}]});};
 const sendEmail=async(_env,phone,id,input)=>{assert.equal(phone,owner);assert.equal(id,job.requestId);emails.push(input);return {status:'sent',messageId:'synthetic-email',sender:input.from,recipient:input.to};};
 return {...s,env,reviewJob:s.job,job,emails,requests,fetcher,sendEmail};
}
test('explicit approval sends exact reviewed draft from Daniel then notifies only the owner once',async()=>{
 const s=await readyToSend();try{
  const options={useGmail:s.useGmail,fetcher:s.fetcher},result=await sendReviewedDraft(s.env,s.job,s.sendEmail,s.send,options);
  assert.equal(result.state,'notified');assert.equal(s.emails.length,1);assert.deepEqual(s.emails[0],{to:s.job.to,from:'daniel@vetsa.es',subject:s.reviewJob.subject,body,senderName:'Daniel Luna',agent:'melodi'});
  assert.equal(s.requests.length,2);assert.equal(s.sent.length,1);assert(s.sent[0].includes('daniel@vetsa.es'));assert(s.sent[0].includes('aceptación del envío'));
  await sendReviewedDraft(s.env,s.job,s.sendEmail,s.send,options);assert.equal(s.emails.length,1);assert.equal(s.sent.length,1);assert.equal(s.requests.length,2);
 }finally{s.f.db.sql.close();}
});
test('send requires explicit approval, original owner and exact approved addresses',async()=>{
 const s=await readyToSend();try{
  for(const change of [{confirmed:false},{ownerPhone:'18095559999'},{from:'felixdanielluna40@gmail.com'},{to:'unapproved@example.com'}])await assert.rejects(()=>sendReviewedDraft(s.env,{...s.job,...change},s.sendEmail,s.send,{useGmail:s.useGmail,fetcher:s.fetcher}),/not_authorized/);
  assert.equal(s.emails.length,0);assert.equal(s.sent.length,0);assert.equal(s.requests.length,0);
 }finally{s.f.db.sql.close();}
});
test('changing a Gmail draft after review prevents send and notification',async()=>{
 const s=await readyToSend();try{
  s.reviewJob.body+=' Changed since review';await assert.rejects(()=>sendReviewedDraft(s.env,s.job,s.sendEmail,s.send,{useGmail:s.useGmail,fetcher:s.fetcher}),/content_changed/);
  assert.equal(s.emails.length,0);assert.equal(s.sent.length,0);assert.equal(s.requests.length,0);
 }finally{s.f.db.sql.close();}
});
test('inactive corporate sender blocks email before mutation',async()=>{
 const s=await readyToSend();try{
  await assert.rejects(()=>sendReviewedDraft(s.env,s.job,s.sendEmail,s.send,{useGmail:s.useGmail,fetcher:async url=>Response.json(url.includes('domains/')?{verified:true,authenticated:true}:{senders:[{email:'daniel@vetsa.es',active:false}]})}),/not_verified/);
  assert.equal(s.emails.length,0);assert.equal(s.sent.length,0);
 }finally{s.f.db.sql.close();}
});
test('ambiguous email acceptance is retained without notification or automatic resend',async()=>{
 const s=await readyToSend();let attempts=0;try{
  const sendEmail=async()=>{attempts++;throw Error('network timeout');},options={useGmail:s.useGmail,fetcher:s.fetcher};
  await assert.rejects(()=>sendReviewedDraft(s.env,s.job,sendEmail,s.send,options));const prior=await sendReviewedDraft(s.env,s.job,sendEmail,s.send,options);
  assert.equal(prior.state,'email_uncertain');assert.equal(attempts,1);assert.equal(s.sent.length,0);
 }finally{s.f.db.sql.close();}
});
test('a WhatsApp timeout never repeats an already accepted email',async()=>{
 const s=await readyToSend();let attempts=0;try{
  const sendText=async()=>{attempts++;throw Error('network timeout');},options={useGmail:s.useGmail,fetcher:s.fetcher};
  await assert.rejects(()=>sendReviewedDraft(s.env,s.job,s.sendEmail,sendText,options));const prior=await sendReviewedDraft(s.env,s.job,s.sendEmail,sendText,options);
  assert.equal(prior.state,'notification_uncertain');assert.equal(prior.email_id,'synthetic-email');assert.equal(s.emails.length,1);assert.equal(attempts,1);
 }finally{s.f.db.sql.close();}
});
