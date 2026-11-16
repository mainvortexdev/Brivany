// Request-scoped provider access. Revoked demo membership never falls back to
// the founder's provider accounts. Personal Google identity stays per tenant.
export function demoChannelEnvironment(env,userId){
 if(!env.BRIVANY_DEMO)return env;
 const demo=env.BRIVANY_DEMO,original=env.VETSA_INTELLIGENCE,ai=env.AI;
 const calls=Object.fromEntries(['info','schedule','list','cancel','reserveNotices','recordNotice'].map(action=>[action,async(...args)=>{
  if(await demo.member(userId)){
   const value=action==='schedule'?args[0]:{phone:args[0],id:args[1],accepted:args[2]};
   return demo.callService(userId,action,value);
  }
  if(!env.MELODI_CALLS?.[action])throw Error('telephone_service_unavailable');return env.MELODI_CALLS[action](...args);
 }]));
 return {...env,MELODI_CALLS:calls,
  VETSA_INTELLIGENCE:{async fetch(input,init){
   const request=input instanceof Request?input:new Request(input,init);
   if(await demo.member(userId)){
    if(request.method!=='POST'||new URL(request.url).pathname!=='/v1/generate')return Response.json({error:'Esta función requiere Brivany Desktop.'},{status:403});
    const size=Number(request.headers.get('Content-Length')||0);if(size>2_000_000)return new Response('Request too large',{status:413});
    const reader=request.body?.getReader();if(!reader)return new Response('Body required',{status:400});let length=0,raw='';const decoder=new TextDecoder();
    try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>2_000_000){await reader.cancel();return new Response('Request too large',{status:413});}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();}finally{reader.releaseLock();}
    try{return Response.json(await demo.generate(userId,JSON.parse(raw)));}catch{return Response.json({error:'La cuenta de demostración no pudo completar la operación.'},{status:403});}
   }
   if(!original)throw Error('intelligence_binding_unavailable');return original.fetch(request);
  }},
  AI:ai?{async run(model,input,options){if(await demo.member(userId))throw Error('demo_audio_requires_desktop');return ai.run(model,input,options);}}:undefined
 };
}
