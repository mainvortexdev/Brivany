import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {FinanceD1} from './finance-fixture.js';
import {ownerAutonomyServices} from '../owner-features.js';
import {ensureRequestedGoogleConnectionsInvite} from '../google-connections-invite.js';
const OWNER='18095550101';
test('one owner-requested invitation contains real, separate consent links and no account is connected by it',async()=>{
  const db=new FinanceD1();db.sql.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));const queued=[];
  const env={VETSA_CLOUD:db,OWNER_WHATSAPP_NUMBER:OWNER,GOOGLE_CLIENT_ID:'test-client',GOOGLE_CLIENT_SECRET:'test-secret',MEMORY_ENCRYPTION_KEY:Buffer.alloc(32,17).toString('base64'),
    REQUESTED_GOOGLE_CONNECTIONS_INVITE_REV:'test-ready',MELODI_JOBS:{send:async job=>queued.push(job)}};
  const services=ownerAutonomyServices(env),options={services,now:Date.parse('2026-10-26T16:00:00Z')};
  assert.equal((await ensureRequestedGoogleConnectionsInvite(env,options)).status,'invited');
  assert.equal((await ensureRequestedGoogleConnectionsInvite(env,options)).status,'already_invited');
  const notice=db.sql.prepare('SELECT payload_encrypted,payload_iv FROM wa_melodi_delivery_notices').get();
  const decoded=await services.decrypt(notice.payload_encrypted,notice.payload_iv),payload=typeof decoded==='string'?JSON.parse(decoded):decoded;
  assert.match(payload.body,/https:\/\/ia\.vetsa\.es\/oauth\/gmail\/start\?link=[a-f0-9]{64}/);
  assert.match(payload.body,/https:\/\/ia\.vetsa\.es\/oauth\/drive\/start\?link=[a-f0-9]{64}/);
  assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM wa_melodi_delivery_notices').get().n,1);assert.equal(queued.length,1);
  assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM gmail_connections').get().n,0);assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM drive_connections').get().n,0);
  assert.equal((await ensureRequestedGoogleConnectionsInvite({...env,REQUESTED_GOOGLE_CONNECTIONS_INVITE_REV:''},options)).status,'disabled');
});
