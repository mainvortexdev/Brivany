export const OWNER_TURN_SCHEMA=Object.freeze([
  `CREATE TABLE IF NOT EXISTS wa_owner_turn_plans(owner TEXT NOT NULL,message_id TEXT NOT NULL,source_hash TEXT NOT NULL,
    payload_encrypted TEXT NOT NULL,payload_iv TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
    PRIMARY KEY(owner,message_id))`,
  `CREATE TABLE IF NOT EXISTS wa_owner_turn_results(owner TEXT NOT NULL,message_id TEXT NOT NULL,action_id TEXT NOT NULL,
    payload_encrypted TEXT NOT NULL,payload_iv TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(owner,message_id,action_id))`,
]);
const digest=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');
const decode=value=>typeof value==='string'?JSON.parse(value):value;
const safeId=value=>typeof value==='string' && value.length>0 && value.length<=500 && !/[\u0000-\u001f]/.test(value);

/** The original plan is immutable across retries. External effects retain their
 * own ledgers; these encrypted checkpoints resume the remaining graph rather
 * than interpreting a partially executed request as a new instruction. */
export function createOwnerTurnStore(db,{encrypt,decrypt,now=()=>Date.now()}={}){
  if(!db?.prepare || !db?.batch || typeof encrypt!=='function' || typeof decrypt!=='function')throw Error('owner_turn_storage_unavailable');
  const stmt=(sql,...values)=>db.prepare(sql).bind(...values);
  let ready;
  const ensure=()=>ready ||= db.batch(OWNER_TURN_SCHEMA.map(sql=>db.prepare(sql)));
  const seal=async value=>{
    if(JSON.stringify(value).length>180000)throw Error('owner_turn_checkpoint_too_large');
    const result=await encrypt(JSON.stringify(value));if(!result?.encrypted || !result.iv)throw Error('owner_turn_encryption_failed');return result;
  };
  const scope=(owner,messageId)=>{if(!/^\d{8,15}$/.test(owner || '') || !safeId(messageId))throw Error('owner_turn_scope_invalid');};
  async function load(owner,messageId,text){
    scope(owner,messageId);await ensure();
    const row=await stmt('SELECT source_hash,payload_encrypted,payload_iv FROM wa_owner_turn_plans WHERE owner=? AND message_id=?',owner,messageId).first();
    if(!row)return null;
    if(row.source_hash!==await digest(text))throw Error('owner_turn_source_changed');
    const value=decode(await decrypt(row.payload_encrypted,row.payload_iv));
    if(value.owner!==owner || value.messageId!==messageId || value.plan?.source?.messageId!==messageId || value.plan.source.text!==text)throw Error('owner_turn_checkpoint_mismatch');
    Object.defineProperty(value,'_cipher',{value:row.payload_encrypted});return value;
  }
  async function savePlan(owner,messageId,text,plan){
    scope(owner,messageId);await ensure();
    if(plan?.source?.messageId!==messageId || plan.source.text!==text)throw Error('owner_turn_plan_source_mismatch');
    const sealed=await seal({version:1,owner,messageId,plan}),at=now();
    await stmt('INSERT OR IGNORE INTO wa_owner_turn_plans(owner,message_id,source_hash,payload_encrypted,payload_iv,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
      owner,messageId,await digest(text),sealed.encrypted,sealed.iv,at,at).run();
    return load(owner,messageId,text);
  }
  async function saveAnswer(owner,messageId,text,answer){
    if(typeof answer!=='string' || !answer.trim() || answer.length>4096)throw Error('owner_turn_answer_invalid');
    const prior=await load(owner,messageId,text);if(!prior)throw Error('owner_turn_plan_missing');
    if(prior.answer!==undefined){if(prior.answer!==answer)throw Error('owner_turn_answer_changed');return prior;}
    const sealed=await seal({...prior,answer});
    const updated=await stmt('UPDATE wa_owner_turn_plans SET payload_encrypted=?,payload_iv=?,updated_at=? WHERE owner=? AND message_id=? AND payload_encrypted=? RETURNING message_id',
      sealed.encrypted,sealed.iv,now(),owner,messageId,prior._cipher).first();
    if(!updated)throw Error('owner_turn_answer_conflict');return{...prior,answer};
  }
  function actions(owner,messageId){
    scope(owner,messageId);
    return{
      async loadActionResult(id){
        if(!safeId(id))throw Error('owner_turn_action_invalid');await ensure();
        const row=await stmt('SELECT payload_encrypted,payload_iv FROM wa_owner_turn_results WHERE owner=? AND message_id=? AND action_id=?',owner,messageId,id).first();
        if(!row)return null;const value=decode(await decrypt(row.payload_encrypted,row.payload_iv));
        if(value.owner!==owner || value.messageId!==messageId || value.result?.id!==id)throw Error('owner_turn_result_scope_mismatch');return value.result;
      },
      async onActionStarted(action){
        await ensure();const sealed=await seal({owner,messageId,result:{id:action.id,tool:action.tool,state:'started'}});
        await stmt('INSERT OR IGNORE INTO wa_owner_turn_results(owner,message_id,action_id,payload_encrypted,payload_iv,updated_at) VALUES(?,?,?,?,?,?)',
          owner,messageId,action.id,sealed.encrypted,sealed.iv,now()).run();
      },
      async onActionResult(action,result){
        if(result.id!==action.id || result.tool!==action.tool)throw Error('owner_turn_action_result_mismatch');await ensure();
        const sealed=await seal({owner,messageId,result});
        await stmt(`INSERT INTO wa_owner_turn_results(owner,message_id,action_id,payload_encrypted,payload_iv,updated_at) VALUES(?,?,?,?,?,?)
          ON CONFLICT(owner,message_id,action_id) DO UPDATE SET payload_encrypted=excluded.payload_encrypted,payload_iv=excluded.payload_iv,updated_at=excluded.updated_at`,
          owner,messageId,action.id,sealed.encrypted,sealed.iv,now()).run();
      },
    };
  }
  return{ensure,load,savePlan,saveAnswer,actions};
}
