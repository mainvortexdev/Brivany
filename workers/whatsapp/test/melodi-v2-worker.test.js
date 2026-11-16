import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {FinanceD1} from './finance-fixture.js';
import worker from '../worker.js';
import {ownerAutonomyServices} from '../owner-features.js';
import {createGmailStore} from '../gmail-store.js';
import {GMAIL_REQUIRED_SCOPES} from '../gmail-client.js';
const OWNER='18095550101',NOW=Date.parse('2026-10-26T12:22:00Z');
const reply=answer=>({version:1,route:'reply',agent:'melodi',contextRelation:'continuation',answer,actions:[]});
function setup(t,infer){
  const jobs=[];
  const db=new FinanceD1();for(const file of ['schema.sql','melodi-team-coordination.sql','melodi-autonomy.sql','melodi-permissions.sql','story-campaign.sql','story-approval.sql'])db.sql.exec(readFileSync(new URL('../'+file,import.meta.url),'utf8'));
  const runSql=db.execute.bind(db);db.execute=(sql,values)=>{try{return runSql(sql,values);}catch(error){t.diagnostic(error.message);throw error;}};
  const env={VETSA_CLOUD:db,OWNER_WHATSAPP_NUMBER:OWNER,WHATSAPP_PHONE_NUMBER_ID:'business',WHATSAPP_TOKEN:'synthetic',TEAM_CONVERSATION_LEADER:'melodi',
    OWNER_TURN_RUNTIME_ENABLED:'true',OWNER_INLINE_TURNS_ENABLED:'true',TEAM_AUTONOMY_ENABLED:'true',ASSISTANT_NATIVE_AI_ENABLED:'true',ASSISTANT_FLASH_MODEL:'@cf/deepseek-ai/deepseek-v4.1-flash-1017',
    TIME_ZONE:'America/Santo_Domingo',MEMORY_ENCRYPTION_KEY:Buffer.alloc(32,17).toString('base64'),WHATSAPP_FAST_RECEIPTS_ENABLED:'false',OWNER_TURN_PRO_FALLBACK:'false',
    MELODI_JOBS:{send:async body=>{jobs.push(body);}},AI:{run:async(model,input)=>{const result=await infer(model,input);return{response:typeof result==='string'?result:JSON.stringify(result),model};}}};
  const texts=[],reads=[],background=[],external={fetch:null};let ack=0,retry=0;
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    if(external.fetch && !String(url).startsWith('https://graph.facebook.com/'))return external.fetch(url,options);
    if(!String(url).startsWith('https://graph.facebook.com/'))throw Error('unexpected external call');
    const body=JSON.parse(options.body);if(body.type==='text')texts.push(body.text.body);else reads.push(body);
    return Response.json(body.type==='text'?{messages:[{id:'sent-'+texts.length}]}:{success:true});
  });
  const flush=async()=>{while(background.length)await Promise.all(background.splice(0));};
  const consume=async body=>{
    await worker.queue({messages:[{body,ack:()=>ack++,retry:()=>retry++}]},env,{waitUntil:work=>background.push(work)});
    await flush();
  };
  const envelope=(text,id)=>{
    const message={id,type:'text',from:OWNER,timestamp:String(NOW/1000),text:{body:text}};
    return{entry:[{changes:[{value:{metadata:{phone_number_id:'business'},messages:[message]}}]}]};
  };
  const send=async(text,id='turn1')=>consume({type:'incoming_whatsapp',payload:envelope(text,id)});
  const webhook=async(text,id='turn1')=>{
    env.META_APP_SECRET='synthetic-signature-secret';const body=JSON.stringify(envelope(text,id));
    const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.META_APP_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    const signature=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(body))).toString('hex');
    return worker.fetch(new Request('https://ia.vetsa.es/webhook',{method:'POST',body,headers:{'x-hub-signature-256':'sha256='+signature}}),env,{waitUntil:work=>background.push(work)});
  };
  return{db,env,texts,reads,send,webhook,consume,flush,jobs,external,get ack(){return ack;},get retry(){return retry;}};
}

test('Brivana scheduling then boxing naming preserves separate subjects, night clock and genuine continuations',async t=>{
  const night=Date.parse('2026-10-27T00:37:00.000Z');t.mock.timers.enable({apis:['Date'],now:night});let calls=0;
  const brivana='Melodi, inicie la creación de Brivana junto a ChatGPT, es el proyecto con el que quiero ganar el hackaton de meta, debo terminarlo el sábado 31 de este mes. Agéndalo';
  const naming='Piensa en un nombre para la app de boxeo que debo construir';
  const f=setup(t,async(_model,input)=>{
    calls++;const data=JSON.parse(input.messages.at(-1).content);
    assert.equal(data.clock.now_local,'2026-10-26T20:37');
    if(!data.tools){
      assert.deepEqual(Object.keys(data).sort(),['clock','message']);
      if(data.message.text===naming)return'«Guardia» es mi favorita: corta y fácil de recordar. «RingPath» también funciona si quieres destacar el aprendizaje.';
      if(data.message.text==='Quiero usar Brivana como nombre de mi app de boxeo, ¿cómo lo ves?')return'Brivana puede funcionar como marca para una app de boxeo.';
      assert.equal(data.message.text,'Hola Melodi, buenas noches');return'Buenas noches.';
    }
    if(data.message.text===brivana)return{...reply(''),route:'execute',contextRelation:'new_topic',actions:[{id:'deadline',tool:'calendar.create_events',input:{events:[{title:'Terminar Brivana (proyecto para el hackatón de Meta)',when:{onDate:'2026-10-31'}}]},dependsOn:[],requestSource:brivana}]};
    assert.ok(data.recent.some(turn=>turn.role==='user'&&turn.content.includes('creación de Brivana')));
    assert.ok(data.recent.some(turn=>turn.role==='assistant'&&turn.content.includes('Te recordaré terminar Brivana')));
    if(data.message.text===naming)return{...reply('Buenos días. Para Brivana, «RingPath» sería un nombre para ganar el hackatón.'),contextRelation:'new_topic'};
    if(data.message.text==='¿Qué otro nombre le pondrías a ese proyecto del hackatón?')return reply('Para el proyecto del hackatón, Brivana ya tiene una identidad; otra opción sería «Nexora».');
    if(data.message.text==='Quiero usar Brivana como nombre de mi app de boxeo, ¿cómo lo ves?')return{...reply('Brivana puede funcionar.'),contextRelation:'new_topic'};
    assert.equal(data.message.text,'Hola Melodi, buenas noches');return{...reply('Buenas noches.'),contextRelation:'new_topic'};
  });
  const send=(text,id)=>f.consume({type:'incoming_whatsapp',payload:{entry:[{changes:[{value:{metadata:{phone_number_id:'business'},messages:[{id,type:'text',from:OWNER,timestamp:String(night/1000),text:{body:text}}]}}]}]}});
  await send(brivana,'brivana');
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM melodi_calendar_events').get().n,1);
  const execute=f.db.execute.bind(f.db);f.db.execute=(sql,values)=>{
    assert.doesNotMatch(sql,/SELECT[^;]+FROM\s+(?:wa_projects|melodi_calendar_events|gmail_connections|drive_connections)\b/i);
    return execute(sql,values);
  };
  await send(naming,'boxing-name');await send(naming,'boxing-name');
  assert.equal(f.texts.length,2);assert.doesNotMatch(f.texts[1],/Brivana|hackatón|Buenos días|Buenas tardes|Buenas noches/i);assert.match(f.texts[1],/Guardia|RingPath/);
  await send('¿Qué otro nombre le pondrías a ese proyecto del hackatón?','pronoun');assert.match(f.texts[2],/Brivana/);
  await send('Quiero usar Brivana como nombre de mi app de boxeo, ¿cómo lo ves?','explicit-link');assert.match(f.texts[3],/Brivana/);
  await send('Hola Melodi, buenas noches','greeting');assert.equal(f.texts[4],'Buenas noches.');
  assert.equal(calls,8);assert.equal(f.retry,0);assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM melodi_calendar_events').get().n,1);
});

test('the complete WhatsApp route looks up, moves and rereads the same event without repeating its old date',async t=>{
  t.mock.timers.enable({apis:['Date'],now:NOW});
  const original='2026-11-14T13:00:00.000Z',moved='2026-11-10T13:00:00.000Z';
  const title='Iniciar la creación de una app para aprender boxeo';
  const f=setup(t,async(_model,input)=>{
    const data=JSON.parse(input.messages.at(-1).content);
    if(data.candidates)return{eventIds:['app']};
    const source=data.message.text;
    if(!data.observations.length)return{...reply(''),route:'execute',actions:[{id:'find',tool:'calendar.search',input:{query:'creación de la app de boxeo'},dependsOn:[],requestSource:source}],
      followUpTools:source.startsWith('Bien,')?['calendar.update_event']:[]};
    assert.match(_model,/deepseek-v4-pro/);
    assert.equal(data.recent.at(-1).content.includes('14 de noviembre'),true);
    assert.equal(data.observations[0].data.matches[0].id,'app');
    return{...reply(''),route:'execute',actions:[{id:'move',tool:'calendar.update_event',input:{eventId:'app',expectedEventAt:original,when:{onDate:'2026-11-10'}},dependsOn:[],requestSource:source}]};
  });
  f.db.sql.prepare('INSERT INTO melodi_calendar_events(id,phone,title,event_at,event_type,assigned_agent,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run('app',OWNER,title,original,'REMINDER','melodi',new Date(NOW).toISOString(),new Date(NOW).toISOString());
  await f.send('Revisa mi agenda si tengo ya programada la creación de la app de boxeo','lookup');
  await f.send('Bien, es posible que inicie antes su creación, muévelo al día 10 de noviembre','move');
  await f.send('¿Y cuándo queda ahora la creación de la app de boxeo?','verify');
  assert.equal(f.retry,0);assert.equal(f.texts.length,3);assert.match(f.texts[0],/14 de noviembre/);
  for(const answer of f.texts.slice(1)){assert.match(answer,/10 de noviembre a las 9:00/);assert.doesNotMatch(answer,/14 de noviembre|resumen verificable|No pude|\.\./);}
  assert.equal(f.db.sql.prepare('SELECT event_at FROM melodi_calendar_events WHERE id=?').get('app').event_at,moved);
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM melodi_calendar_events').get().n,1);
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM owner_calendar_mutation_receipts').get().n,1);
});

test('a lookup without matches stops the requested update before any follow-up can invent its ID',async t=>{
  t.mock.timers.enable({apis:['Date'],now:NOW});let decisions=0;
  const f=setup(t,async()=>{decisions++;assert.equal(decisions,1);return{...reply(''),route:'execute',actions:[{id:'find',tool:'calendar.search',input:{query:'Inicio de la app de boxeo'},dependsOn:[],requestSource:'Mueve la app de boxeo al 10 de noviembre'}],followUpTools:['calendar.update_event']};});
  await f.send('Mueve la app de boxeo al 10 de noviembre','missing');
  assert.equal(f.retry,0);assert.equal(decisions,1);assert.equal(f.texts.length,1);assert.match(f.texts[0],/No encontré ese compromiso/);
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM melodi_calendar_events').get().n,0);
});

test('the actual worker compiles new relative reminders from typed meaning, not inferred UTC arithmetic',async t=>{
  t.mock.timers.enable({apis:['Date'],now:NOW});
  const text='Recuérdame el martes que viene a las nueve imprimir el documento y revisar el proyecto dentro de tres días a las nueve.';
  const f=setup(t,async()=>({...reply(''),route:'execute',contextRelation:'new_topic',actions:[{id:'events',tool:'calendar.create_events',input:{events:[{title:'Imprimir el documento',when:{weekday:'martes',localTime:'09:00'}},{title:'Revisar el proyecto',when:{offsetDays:3,localTime:'09:00'}}]},dependsOn:[],requestSource:text}]}));
  await f.send(text,'relative-create');await f.send(text,'relative-create');
  assert.equal(f.retry,0);assert.equal(f.texts.length,1);
  assert.deepEqual(f.db.sql.prepare('SELECT event_at FROM melodi_calendar_events ORDER BY event_at').all().map(row=>row.event_at),['2026-10-27T13:00:00.000Z','2026-10-29T13:00:00.000Z']);
});

test('an invalid Flash action is corrected by Pro before a financial effect and never confirms the rejected plan',async t=>{
  t.mock.timers.enable({apis:['Date'],now:NOW});let calls=0;
  const text='Apunta que el almuerzo de hoy me costó 500 pesos dominicanos.';
  const entry={kind:'transaction',data:{name:'Almuerzo',currency:'DOP',amount:50000,date:'2026-10-26',direction:'expense',category:'Comida'}};
  const f=setup(t,async(model)=>{
    calls++;if(calls===2)assert.match(model,/deepseek-v4-pro/);
    return{...reply(''),route:'execute',contextRelation:'new_topic',actions:[{id:'expense',tool:'finance.record',input:{action:'create',entries:[entry],...(calls===1?{explicitCurrency:true}:{})},dependsOn:[],requestSource:text}]};
  });f.env.OWNER_TURN_PRO_FALLBACK='true';
  await f.send(text,'financial-recovery');await f.send(text,'financial-recovery');
  assert.equal(calls,2);assert.equal(f.retry,0);assert.equal(f.texts.length,1);assert.match(f.texts[0],/500/);assert.doesNotMatch(f.texts[0],/No pude|Lo reviso|ya tengo tu mensaje/);
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM wa_finance_records').get().n,1);
});
test('the actual deployed worker route answers the boxing follow-up in one inference without private project reads',async t=>{
  t.mock.timers.enable({apis:['Date'],now:NOW});let count=0;
  const f=setup(t,async(model,input)=>{count++;assert.match(model,/v4\.1-flash/);const payload=JSON.parse(input.messages.at(-1).content);
    assert.equal(payload.message.text,'¿Cómo basarías esa frase en el boxeo?');assert.ok(payload.recent.some(turn=>turn.content.includes('Hoy suma una acción')));
    return reply('Un buen asalto empieza con lo pequeño: guarda arriba, mueve los pies y repite la técnica incluso cuando estés cansado.');});
  const services=ownerAutonomyServices(f.env),sealed=await services.encrypt({recent:[{role:'user',message:'Pondré la app de boxeo en mi calendario.'},
    {role:'assistant',message:'Hoy suma una acción concreta, aunque sea mínima; la constancia construye el camino.'}]});
  f.db.sql.prepare('INSERT INTO wa_melodi_private_context(owner_phone,agent,encrypted_context,context_iv,updated_at) VALUES(?,?,?,?,?)')
    .run(OWNER,'melodi',sealed.encrypted,sealed.iv,new Date(NOW).toISOString());
  const execute=f.db.execute.bind(f.db);f.db.execute=(sql,values)=>{assert.doesNotMatch(sql,/SELECT[^;]+FROM\s+(?:wa_projects|gmail_connections|melodi_calendar_events)\b/i);return execute(sql,values);};
  await f.send('¿Cómo basarías esa frase en el boxeo?');await f.send('¿Cómo basarías esa frase en el boxeo?');
  assert.equal(count,1);assert.equal(f.texts.length,1);assert.match(f.texts[0],/asalto/);assert.doesNotMatch(f.texts[0],/app|ya tengo tu mensaje/);
  assert.equal(f.retry,0);assert.equal(f.ack,2);assert.ok(f.reads.length>0);
});
test('the actual worker creates the complete four-event request through its real permission callback and confirms once',async t=>{
  t.mock.timers.enable({apis:['Date'],now:NOW});const text='Recuérdame los cuatro compromisos de hoy y del domingo.';let count=0;
  const events=[{title:'Boxeo',eventAt:'2026-10-26T13:10:00.000Z'},{title:'Decirle el guion a Alfredo',eventAt:'2026-10-26T15:30:00.000Z'},
    {title:'Live del Hackaton de Meta',eventAt:'2026-10-26T16:00:00.000Z'},{title:'Grabación',eventAt:'2026-11-01T09:00:00.000Z'}];
  const f=setup(t,async()=>{count++;return{...reply(''),route:'execute',contextRelation:'new_topic',actions:[{id:'a1',tool:'calendar.create_events',input:{events},dependsOn:[],requestSource:text}]};});
  await f.send(text);await f.send(text);
  if(f.texts[0]?.startsWith('No pude'))for(const row of f.db.sql.prepare('SELECT payload_encrypted,payload_iv FROM wa_owner_turn_results').all())t.diagnostic(JSON.stringify(await ownerAutonomyServices(f.env).decrypt(row.payload_encrypted,row.payload_iv)));
  assert.equal(f.retry,0);assert.equal(count,1);assert.equal(f.texts.length,1);assert.match(f.texts[0],/cuatro avisos/);
  assert.deepEqual(f.db.sql.prepare('SELECT event_at FROM melodi_calendar_events ORDER BY event_at').all().map(row=>row.event_at),events.map(event=>event.eventAt));
});

test('a natural capture instruction imports its actual interval and advance notice without a keyword route',async t=>{
  t.mock.timers.enable({apis:['Date'],now:NOW});const text='Que figure en mi planificación lo de la captura y que me llegue un aviso con dos horas de margen.';let calls=0;
  const ocr='Meta Global AI Developer Hackathon\nLunes 26 de octubre, 12:00 PM - Miércoles 4 de noviembre, 9:00 PM (GMT-5)';
  const f=setup(t,async(_model,input)=>{
    calls++;const payload=JSON.parse(input.messages.at(-1).content);
    if(payload.screenshotText){assert.equal(payload.screenshotText,ocr);return{title:'Meta Global AI Developer Hackathon',startLocal:'2026-10-26T12:00',endLocal:'2026-11-04T21:00',sourceTimeZone:'GMT-5',
      sources:{title:'Meta Global AI Developer Hackathon',start:'Lunes 26 de octubre, 12:00 PM',end:'Miércoles 4 de noviembre, 9:00 PM',timeZone:'GMT-5'}};}
    assert.ok(payload.tools.some(tool=>tool.name==='calendar.import_image' && tool.status==='available'));
    return{...reply(''),route:'execute',contextRelation:'new_topic',actions:[{id:'a1',tool:'calendar.import_image',input:{remindBeforeMinutes:120,clearStartSlot:false},dependsOn:[],requestSource:text}]};
  });
  f.env.VETSA_MEDIA={get:async key=>{assert.equal(key,'private-owner-reference');return{size:1,httpMetadata:{contentType:'image/png'},arrayBuffer:async()=>new Uint8Array([1]).buffer};}};
  f.env.VETSA_INTELLIGENCE={fetch:async request=>{const body=await request.json();assert.equal(body.model,'spaik-sight');assert.ok(body.options.image);return Response.json({text:ocr});}};
  const sealed=await ownerAutonomyServices(f.env).encrypt({refs:[{kind:'image',objectKey:'private-owner-reference',mimeType:'image/png'}]});
  f.db.sql.prepare('INSERT INTO wa_owner_session(owner_phone,session_type,encrypted_state,state_iv,updated_at) VALUES(?,?,?,?,?)')
    .run(OWNER,'staging',sealed.encrypted,sealed.iv,new Date(NOW).toISOString());
  await f.send(text);await f.send(text);
  assert.equal(f.retry,0);assert.equal(calls,2);assert.equal(f.texts.length,1);assert.match(f.texts[0],/dos horas antes/);
  const metadata=f.db.sql.prepare('SELECT end_at,deliver_at FROM melodi_screenshot_calendar_events').get();
  assert.equal(metadata.end_at,'2026-11-05T02:00:00.000Z');assert.equal(metadata.deliver_at,'2026-10-26T15:00:00.000Z');
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM melodi_calendar_events').get().n,1);
});

test('the worker reads Gmail before scheduling its event with a two-hour notice and one final reply',async t=>{
  t.mock.timers.enable({apis:['Date'],now:NOW});const text='Busca el correo del hackatón, agenda sus fechas y avísame dos horas antes.';let phases=0,reads=0;
  const f=setup(t,async(_model,input)=>{
    const data=JSON.parse(input.messages.at(-1).content);
    if(data.observations && !data.message?.text)return'El correo indica que el hackatón empieza el 26 de octubre.';
    phases++;
    if(phases===1)return{...reply(''),route:'execute',contextRelation:'new_topic',actions:[{id:'mail',tool:'gmail.search',input:{q:'hackatón',limit:1},dependsOn:[],requestSource:text}],followUpTools:['calendar.create_event_with_notice']};
    assert.ok(JSON.stringify(data.observations).includes('GMT-5'));
    return{...reply(''),route:'execute',contextRelation:'continuation',actions:[{id:'event',tool:'calendar.create_event_with_notice',input:{title:'Hackathon de Meta',startAt:'2026-10-26T17:00:00.000Z',endAt:'2026-11-05T02:00:00.000Z',sourceTimeZone:'GMT-05:00',remindBeforeMinutes:120},dependsOn:[],requestSource:text}]};
  });
  Object.assign(f.env,{GOOGLE_CLIENT_ID:'synthetic-client',GOOGLE_CLIENT_SECRET:'synthetic-secret',GMAIL_OWNER_EMAIL:'owner@example.com'});
  const store=createGmailStore(f.env);await store.ensureSchema();await store.putConnection(OWNER,{status:'connected',email:'owner@example.com',subject:'owner-sub',scopes:[...GMAIL_REQUIRED_SCOPES],accessToken:'private-test-access',accessTokenExpiresAt:NOW+3600000,refreshToken:'private-test-refresh'});
  f.external.fetch=async(url,options)=>{
    assert.ok(String(url).startsWith('https://gmail.googleapis.com/gmail/v1/users/me/messages'));assert.equal(options.headers.authorization,'Bearer private-test-access');reads++;
    if(new URL(url).pathname.endsWith('/messages'))return Response.json({messages:[{id:'actual-mail'}]});
    return Response.json({id:'actual-mail',payload:{mimeType:'text/plain',headers:[{name:'Subject',value:'Hackathon de Meta'}],body:{data:btoa('26 de octubre 2026 12PM a 4 de noviembre 2026 9PM GMT-5')}}});
  };
  await f.send(text);await f.send(text);
  assert.equal(f.retry,0);assert.equal(phases,2);assert.equal(reads,2);assert.equal(f.texts.length,1);assert.match(f.texts[0],/Agendé Hackathon de Meta y te avisaré dos horas antes/);
  assert.equal(f.db.sql.prepare('SELECT end_at FROM melodi_screenshot_calendar_events').get().end_at,'2026-11-05T02:00:00.000Z');
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM melodi_calendar_events').get().n,1);
});

test('financial requests reach the real encrypted ledger through semantic tools and reply once',async t=>{
  t.mock.timers.enable({apis:['Date'],now:NOW});const text='Apunta que el almuerzo de hoy me costó 500 pesos dominicanos.';let calls=0;
  const f=setup(t,async()=>{calls++;return{...reply(''),route:'execute',contextRelation:'new_topic',actions:[{id:'expense',tool:'finance.record',
    input:{action:'create',entries:[{kind:'transaction',data:{name:'Almuerzo',amount:50000,currency:'DOP',date:'2026-10-26',direction:'expense'}}]},dependsOn:[],requestSource:text}]};});
  await f.send(text);await f.send(text);
  assert.equal(f.retry,0);assert.equal(calls,1);assert.equal(f.texts.length,1);assert.doesNotMatch(f.texts[0],/No pude|Melodi:/);
  const rows=f.db.sql.prepare('SELECT * FROM wa_finance_records').all();assert.equal(rows.length,1);assert.doesNotMatch(JSON.stringify(rows),/Almuerzo|DOP/);
});

test('a semantic contact preference reaches the actual team policy and preserves unrelated work',async t=>{
  t.mock.timers.enable({apis:['Date'],now:NOW});const text='Prefiero que dejes el tema del boxeo fuera de tus sugerencias espontáneas.';let calls=0;
  const f=setup(t,async()=>{calls++;return{...reply(''),route:'execute',contextRelation:'new_topic',actions:[{id:'preference',tool:'contact.preferences',input:{topic:'boxeo',blocked:true},dependsOn:[],requestSource:text}]};});
  await f.send(text);await f.send(text);
  assert.equal(f.retry,0);assert.equal(calls,1);assert.equal(f.texts.length,1);assert.match(f.texts[0],/Guardé tu preferencia/);
  const row=f.db.sql.prepare('SELECT payload_encrypted,payload_iv FROM wa_owner_contact_preferences WHERE owner=?').get(OWNER);
  const value=await ownerAutonomyServices(f.env).decrypt(row.payload_encrypted,row.payload_iv);assert.deepEqual(value.blockedTopics,['boxeo']);
});

test('a recipient clarification resumes the saved document with its original content and one queued job',async t=>{
  t.mock.timers.enable({apis:['Date'],now:NOW});const text='Mándalo a alfredo@example.com.';let calls=0;
  const f=setup(t,async(_model,input)=>{calls++;const data=JSON.parse(input.messages.at(-1).content);assert.equal(data.pending.tool,'document.continue');
    assert.ok(data.tools.some(tool=>tool.name==='document.continue'&&tool.status==='available'));
    return{...reply(''),route:'execute',actions:[{id:'recipient',tool:'document.continue',input:{recipientEmail:'alfredo@example.com'},dependsOn:[],requestSource:text}]};});
  f.env.BREVO_API_KEY='synthetic';
  const services=ownerAutonomyServices(f.env),sealed=await services.encrypt({payload:{prompt:'Siete tomas de ojos y espalda para Alfredo.',format:'pdf',kind:'document',agent:'melodi'},agent:'melodi'});
  f.db.sql.prepare('INSERT INTO wa_owner_session(owner_phone,session_type,encrypted_state,state_iv,updated_at) VALUES(?,?,?,?,?)').run(OWNER,'await_document_recipient',sealed.encrypted,sealed.iv,new Date(NOW).toISOString());
  await f.send(text);await f.send(text);
  assert.equal(f.retry,0);assert.equal(calls,1);assert.equal(f.texts.length,1);assert.doesNotMatch(f.texts[0],/No pude|ya tengo tu mensaje|Melodi:/);
  const rows=f.db.sql.prepare('SELECT * FROM wa_owner_jobs WHERE owner_phone=?').all(OWNER);assert.equal(rows.length,1);
  const payload=await services.decrypt(rows[0].encrypted_payload,rows[0].payload_iv);assert.equal(payload.prompt,'Siete tomas de ojos y espalda para Alfredo.');assert.equal(payload.emailDelivery.to,'alfredo@example.com');
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM wa_owner_session').get().n,0);
});

test('a semantic email body clarification queues the saved email without losing its subject or sending twice',async t=>{
  t.mock.timers.enable({apis:['Date'],now:NOW});const text='Dile: nos vemos el domingo a las cinco.';let calls=0;
  const f=setup(t,async()=>{calls++;return{...reply(''),route:'execute',actions:[{id:'body',tool:'email.continue',input:{body:'Nos vemos el domingo a las cinco.'},dependsOn:[],requestSource:text}]};});
  f.env.BREVO_API_KEY='synthetic';const services=ownerAutonomyServices(f.env),sealed=await services.encrypt({to:'alfredo@example.com',subject:'Grabación',body:'',agent:'melodi'});
  f.db.sql.prepare('INSERT INTO wa_owner_session(owner_phone,session_type,encrypted_state,state_iv,updated_at) VALUES(?,?,?,?,?)').run(OWNER,'await_email_delivery',sealed.encrypted,sealed.iv,new Date(NOW).toISOString());
  await f.send(text);await f.send(text);
  assert.equal(f.retry,0);assert.equal(calls,1);assert.equal(f.texts.length,1);assert.match(f.texts[0],/preparación/);
  const rows=f.db.sql.prepare('SELECT * FROM wa_owner_jobs WHERE owner_phone=?').all(OWNER);assert.equal(rows.length,1);
  const payload=await services.decrypt(rows[0].encrypted_payload,rows[0].payload_iv);assert.equal(payload.subject,'Grabación');assert.equal(payload.body,'Nos vemos el domingo a las cinco.');
});

test('a semantic memory completion persists and verifies the saved capture rather than the finish instruction',async t=>{
  t.mock.timers.enable({apis:['Date'],now:NOW});const text='Ya puedes conservar todo lo que te dicté.';
  const f=setup(t,async()=>({...reply(''),route:'execute',actions:[{id:'finish',tool:'memory.continue',input:{action:'finish'},dependsOn:[],requestSource:text}]}));
  const services=ownerAutonomyServices(f.env),sealed=await services.encrypt({prompt:'Primer plano de los ojos y el número en la espalda.',refs:[],autoFinish:false,itemType:'prompt'});
  f.db.sql.prepare('INSERT INTO wa_owner_session(owner_phone,session_type,encrypted_state,state_iv,updated_at) VALUES(?,?,?,?,?)').run(OWNER,'capture',sealed.encrypted,sealed.iv,new Date(NOW).toISOString());
  await f.send(text);await f.send(text);
  assert.equal(f.retry,0);assert.equal(f.texts.length,1);assert.match(f.texts[0],/memoria privada/);
  const row=f.db.sql.prepare('SELECT encrypted_payload,payload_iv FROM wa_owner_memory_items').get();
  const payload=await services.decrypt(row.encrypted_payload,row.payload_iv);assert.equal(payload.text,'Primer plano de los ojos y el número en la espalda.');
});

test('a reminder recipient continuation keeps its event and schedules the real email action once',async t=>{
  t.mock.timers.enable({apis:['Date'],now:NOW});const text='Envíalo a mi correo.';
  const f=setup(t,async()=>({...reply(''),route:'execute',actions:[{id:'recipient',tool:'calendar.continue',input:{recipientSelf:true},dependsOn:[],requestSource:text}]}));
  f.env.BREVO_API_KEY='synthetic';f.env.OWNER_EMAIL_FORWARD_TO='owner@example.com';
  const services=ownerAutonomyServices(f.env),sealed=await services.encrypt({title:'Revisar las tomas',eventAt:'2026-10-26T17:30:00.000Z',subject:'Grabación',body:'Revisar los siete planos',agent:'melodi'});
  f.db.sql.prepare('INSERT INTO wa_owner_session(owner_phone,session_type,encrypted_state,state_iv,updated_at) VALUES(?,?,?,?,?)').run(OWNER,'await_reminder_recipient',sealed.encrypted,sealed.iv,new Date(NOW).toISOString());
  await f.send(text);await f.send(text);
  assert.equal(f.retry,0);assert.equal(f.texts.length,1);assert.doesNotMatch(f.texts[0],/No pude/);
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM melodi_calendar_events').get().n,1);
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM wa_melodi_scheduled_email_actions').get().n,1);
});

test('a semantic answer resolves a named conflict and commits the complete saved agenda in one inference',async t=>{
  t.mock.timers.enable({apis:['Date'],now:NOW});const text='La consulta déjala mañana a las dos de la tarde y mantén lo demás que te pedí.';let calls=0;
  const f=setup(t,async(_model,input)=>{calls++;const payload=JSON.parse(input.messages.at(-1).content);assert.equal(payload.pending.agenda.reason,'time_conflict');
    assert.deepEqual(payload.pending.agenda.distribute,['Terminar Vetsa Intelligence','Terminar Cognira Edits','Mejorar la integración de Vetsa']);
    return{...reply(''),route:'execute',actions:[{id:'resolve',tool:'calendar.plan_agenda',input:{request:text,resolution:{decision:'apply',eventMoves:[{id:'consultation',eventAt:'2026-10-27T18:00:00.000Z'}]}},dependsOn:[],requestSource:text}]};});
  const add=(id,title,at)=>f.db.sql.prepare("INSERT INTO melodi_calendar_events(id,phone,title,event_at,event_type,assigned_agent,created_at,updated_at) VALUES(?,?,?,?,'REMINDER','melodi',?,?)").run(id,OWNER,title,at,new Date(NOW).toISOString(),new Date(NOW).toISOString());
  add('consultation','Consulta','2026-10-26T17:00:00.000Z');add('meeting','Reunión','2026-10-27T17:00:00.000Z');
  const directive={kind:'compound_agenda',referenceAt:new Date(NOW).toISOString(),timeZone:'America/Santo_Domingo',relaxToday:true,
    actions:{distribute:['Terminar Vetsa Intelligence','Terminar Cognira Edits','Mejorar la integración de Vetsa'],moveDay:{from:'today',to:'tomorrow'},
      fixed:[{title:'Boxeo',day:'today',localTime:'09:00',assumedPeriod:false},{title:'Trabajar en casa de Alfredo',day:'today',localTime:'11:00',assumedPeriod:false},
        {title:'Buscar a mi hermana',day:'today',localTime:'14:40',assumedPeriod:false},{title:'Volver al trabajo',day:'today',localTime:'15:40',assumedPeriod:false}]}};
  const sealed=await ownerAutonomyServices(f.env).encrypt({directive,reason:'time_conflict',conflict:{reason:'time_conflict',events:[{id:'consultation',title:'Consulta',kind:'melodi_calendar_events',previousEventAt:'2026-10-26T17:00:00.000Z',eventAt:'2026-10-27T17:00:00.000Z'},{id:'meeting',title:'Reunión',kind:'melodi_calendar_events',eventAt:'2026-10-27T17:00:00.000Z'}]}});
  f.db.sql.prepare('INSERT INTO wa_owner_session(owner_phone,session_type,encrypted_state,state_iv,updated_at) VALUES(?,?,?,?,?)').run(OWNER,'await_agenda_plan',sealed.encrypted,sealed.iv,new Date(NOW).toISOString());
  await f.send(text);await f.send(text);assert.equal(f.retry,0);assert.equal(calls,1);assert.equal(f.texts.length,1);assert.doesNotMatch(f.texts[0],/No pude|¿|ya tengo tu mensaje/);
  const events=f.db.sql.prepare('SELECT id,event_at FROM melodi_calendar_events').all();assert.equal(events.length,9);assert.equal(events.find(item=>item.id==='consultation').event_at,'2026-10-27T18:00:00.000Z');
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM wa_owner_session').get().n,0);
});

test('the authenticated webhook delivers useful conversation without waiting for its durable queue copy',async t=>{
  t.mock.timers.enable({apis:['Date'],now:NOW});let calls=0;
  const f=setup(t,async()=>{calls++;return reply('Un asalto a la vez: cuida la guardia y repite los básicos.');});
  assert.equal((await f.webhook('¿Cómo aplico la constancia al boxeo?')).status,200);await f.flush();
  assert.equal(calls,1);assert.equal(f.texts.length,1);assert.match(f.texts[0],/asalto/);assert.equal(f.jobs.filter(job=>job.type==='incoming_whatsapp').length,1);
  await f.consume(f.jobs.find(job=>job.type==='incoming_whatsapp'));assert.equal(calls,1);assert.equal(f.texts.length,1);
});

test('an inline action plan transfers to the consumer without running tools or producing an acknowledgement',async t=>{
  t.mock.timers.enable({apis:['Date'],now:NOW});let calls=0;const text='Recuérdame el boxeo hoy a las 9:10.';
  const f=setup(t,async()=>{calls++;return{...reply(''),route:'execute',actions:[{id:'box',tool:'calendar.create_events',input:{events:[{title:'Ir al boxeo',eventAt:'2026-10-26T13:10:00.000Z'}]},dependsOn:[],requestSource:text}]};});
  assert.equal((await f.webhook(text)).status,200);await f.flush();
  assert.equal(calls,1);assert.equal(f.texts.length,0);assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM melodi_calendar_events').get().n,0);
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM wa_owner_turn_plans').get().n,1);
  assert.equal(f.db.sql.prepare('SELECT attempts FROM wa_message_processing').get().attempts,0);
  const copies=f.jobs.filter(job=>job.type==='incoming_whatsapp');assert.equal(copies.length,2);
  await f.consume(copies[0]);await f.consume(copies[1]);assert.equal(calls,1);assert.equal(f.texts.length,1);assert.match(f.texts[0],/Te recordaré ir al boxeo/);
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM melodi_calendar_events').get().n,1);
});

test('an invalid inline model plan falls back in the durable consumer without losing or acknowledging the request',async t=>{
  t.mock.timers.enable({apis:['Date'],now:NOW});let calls=0;
  const f=setup(t,async model=>{calls++;return model.includes('v4-pro')?reply('La constancia en el boxeo se entrena repitiendo la técnica en cada asalto.'):'invalid-json';});
  f.env.OWNER_TURN_PRO_FALLBACK='true';await f.webhook('Dime cómo mantener la constancia al entrenar.');await f.flush();
  assert.equal(calls,1);assert.equal(f.texts.length,0);
  const jobs=f.jobs.filter(job=>job.type==='incoming_whatsapp');assert.equal(jobs.length,2);
  await f.consume(jobs[1]);assert.equal(calls,3);assert.equal(f.texts.length,1);assert.match(f.texts[0],/constancia/);assert.doesNotMatch(f.texts[0],/ya tengo tu mensaje/);
});

test('a later owner turn is durably rescheduled while its predecessor runs without spending failure retries',async t=>{
  t.mock.timers.enable({apis:['Date'],now:NOW});let entered,release;let calls=0;
  const began=new Promise(resolve=>entered=resolve),blocked=new Promise(resolve=>release=resolve);
  const f=setup(t,async()=>{calls++;if(calls===1){entered();await blocked;}return reply(calls===1?'Vamos con un asalto a la vez.':'La guardia alta ayuda a mantener el control.');});
  const first=f.send('¿Cómo entreno la constancia?','first-owner-turn');await began;
  await f.consume({type:'incoming_whatsapp',payload:{entry:[{changes:[{value:{metadata:{phone_number_id:'business'},messages:[{id:'next-owner-turn',type:'text',from:OWNER,timestamp:String(NOW/1000),text:{body:'¿Y cómo lo aplico a la guardia?'}}]}}]}]},receivedAt:NOW});
  assert.equal(f.retry,0);assert.equal(calls,1);assert.equal(f.texts.length,0);
  const replacement=f.jobs.find(job=>job.ownerWaits===1);assert.ok(replacement);assert.equal(f.db.sql.prepare("SELECT attempts FROM wa_message_processing WHERE message_id='next-owner-turn'").get().attempts,0);
  release();await first;await f.consume(replacement);assert.equal(calls,2);assert.equal(f.texts.length,2);assert.equal(f.retry,0);
});

test('the reported boxing-app question finds November 14 in the actual agenda and returns its time without a writer',async t=>{
  t.mock.timers.enable({apis:['Date'],now:NOW});const text='Revisa mi agenda si tengo ya programada la creación de la app de boxeo';let calls=0;
  const f=setup(t,async(_model,input)=>{
    calls++;const data=JSON.parse(input.messages.at(-1).content);
    if(data.candidates){assert.ok(data.candidates.some(event=>event.id==='boxing-app-real'));return{eventIds:['boxing-app-real']};}
    assert.equal(data.message.text,text);assert.ok(data.tools.some(tool=>tool.name==='calendar.search'&&tool.status==='available'));
    return{...reply(''),route:'execute',actions:[{id:'search',tool:'calendar.search',input:{query:'Iniciar la creación de una aplicación para aprender boxeo'},dependsOn:[],requestSource:text}]};
  });
  f.db.sql.prepare("INSERT INTO melodi_calendar_events(id,phone,title,event_at,event_type,assigned_agent,created_at,updated_at) VALUES(?,?,?,?,'REMINDER','melodi',?,?)")
    .run('boxing-app-real',OWNER,'Iniciar la creación de una app para aprender boxeo','2026-11-14T13:00:00.000Z',new Date(NOW).toISOString(),new Date(NOW).toISOString());
  await f.send(text);await f.send(text);
  assert.equal(f.retry,0);assert.equal(calls,2);assert.equal(f.texts.length,1);assert.match(f.texts[0],/^Sí, tienes/);assert.match(f.texts[0],/14 de noviembre a las 9:00/);
  assert.doesNotMatch(f.texts[0],/resumen verificable|consulta se completó/);assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM melodi_calendar_events').get().n,1);
});
