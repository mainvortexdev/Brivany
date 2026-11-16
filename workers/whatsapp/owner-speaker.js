const AGENTS = ['melodi'];
const SCHEMA = `CREATE TABLE IF NOT EXISTS wa_melodi_conversation_speaker (
  owner_phone TEXT PRIMARY KEY,agent TEXT NOT NULL,source_message_id TEXT NOT NULL,expires_at TEXT NOT NULL)`;

export function leaderConversationEnabled(env) { return env.TEAM_CONVERSATION_LEADER === 'melodi'; }

export async function currentOwnerSpeaker(env,phone,now = new Date()) {
  if (!leaderConversationEnabled(env)) return null;
  await env.VETSA_CLOUD.prepare(SCHEMA).run();
  const row = await env.VETSA_CLOUD.prepare('SELECT agent,expires_at FROM wa_melodi_conversation_speaker WHERE owner_phone=?').bind(phone).first();
  return AGENTS.includes(row?.agent) && row.expires_at > now.toISOString() ? row.agent : 'melodi';
}

/** Only a direct human address or an explicitly quoted agent message selects a speaker. */
export async function selectOwnerSpeaker(env,phone,agent,messageId,now = new Date()) {
  if (!leaderConversationEnabled(env)) return;
  if (!AGENTS.includes(agent) || typeof messageId !== 'string' || !messageId || messageId.length > 500) throw Error('invalid_speaker_selection');
  await env.VETSA_CLOUD.prepare(SCHEMA).run();
  await env.VETSA_CLOUD.prepare(`INSERT INTO wa_melodi_conversation_speaker(owner_phone,agent,source_message_id,expires_at)
    VALUES(?,?,?,?) ON CONFLICT(owner_phone) DO UPDATE SET agent=excluded.agent,source_message_id=excluded.source_message_id,expires_at=excluded.expires_at`)
    .bind(phone,agent,messageId,new Date(now.getTime()+90*60000).toISOString()).run();
}
