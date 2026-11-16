import {query} from './melodi-db.mjs';
import {BACKUP} from './cloudflare-release.mjs';
import {DESKTOP_SCHEMA} from '../melodi-desktop.js';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const owner='18495205246',location=join(BACKUP,'desktop-enrollment.json');
const mode=process.argv[2];
if(mode==='prepare'){
 for(const sql of DESKTOP_SCHEMA)await query(sql);
 const [{results:links}]=await query('SELECT user_id FROM vetsa_app_agent_links WHERE phone=? AND linked_at IS NOT NULL',[owner]);
 const [{results:identities}]=await query('SELECT user_id FROM brivany_whatsapp_identities WHERE phone=?',[owner]);
 if(!links.length&&identities.length)throw Error('owner_link_revoked');
 const userId=links[0]?.user_id||'legacy-owner:'+owner;
 await writeFile(location,JSON.stringify({phone:owner,userId}),{flag:'wx'});
 console.log(JSON.stringify({prepared:true,operatorOnly:true,linkedAccount:links.length>0}));
}else if(mode==='apply'){
 const value=JSON.parse(await readFile(location,'utf8'));
 if(value.phone!==owner||!value.userId||!/^\w[\w .()-]{0,79}$/.test(value.name)||!/^\w{8}-\w{4}-4\w{3}-[89ab]\w{3}-\w{12}$/.test(value.deviceId)||!/^[a-f0-9]{64}$/.test(value.keyHash))throw Error('invalid_enrollment');
 const [{results:links}]=await query('SELECT user_id FROM vetsa_app_agent_links WHERE phone=? AND linked_at IS NOT NULL',[owner]);
 const [{results:identities}]=await query('SELECT user_id FROM brivany_whatsapp_identities WHERE phone=?',[owner]);
 if((links[0]?.user_id||(!identities.length?'legacy-owner:'+owner:null))!==value.userId)throw Error('owner_link_changed');
 const result=await query(`INSERT INTO brivany_desktop_devices(device_id,user_id,phone,device_name,key_hash,enabled,last_seen,created_at) VALUES(?,?,?,?,?,1,0,?) ON CONFLICT(device_id) DO NOTHING`,[value.deviceId,value.userId,owner,value.name,value.keyHash,Date.now()]);
 if(value.previousDeviceId&&value.previousDeviceId!==value.deviceId){
  if(!/^[a-f0-9-]{36}$/.test(value.previousDeviceId))throw Error('invalid_previous_device');
  await query('UPDATE brivany_desktop_devices SET enabled=0 WHERE device_id=? AND phone=? AND user_id=?',[value.previousDeviceId,owner,value.userId]);
 }
 console.log(JSON.stringify({enrolled:result[0].meta.changes===1,operatorOnly:true}));
}else throw Error('choose_prepare_or_apply');
