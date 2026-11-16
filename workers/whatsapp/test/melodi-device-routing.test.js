import test from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { findOwnerDevice } from '../owner-features.js';

test('Melodi routes to the designated linked laptop and never substitutes another workstation', async () => {
  // This fixture uses only D1 SQL; the installed local workerd supports 2026-09-04.
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default {fetch(){return new Response("fixture")}}', compatibilityDate: '2026-09-04', d1Databases: { DB: 'melodi-routing-fixture' } }));
  try {
    const db = await mf.getD1Database('DB');
    await db.prepare('CREATE TABLE stacy_devices(device_id TEXT PRIMARY KEY,user_id TEXT,device_name TEXT,status TEXT,last_seen TEXT)').run();
    const phone = '18005550001', other = '18005550002';
    const now = Date.now();
    for (const device of [
      ['desktop', phone, 'Este PC', 'offline', new Date(now).toISOString()],
      ['laptop', phone, 'Laptop oficial', 'online', new Date(now - 30000).toISOString()],
      ['other', other, 'Otra cuenta', 'online', new Date(now).toISOString()],
    ]) await db.prepare('INSERT INTO stacy_devices VALUES(?,?,?,?,?)').bind(...device).run();
    const env = { VETSA_CLOUD: db, OWNER_WHATSAPP_NUMBER: phone };

    assert.equal((await findOwnerDevice(env, phone)).device_id, 'laptop', 'a shutdown heartbeat on the old PC must not hide the online laptop');
    await db.prepare("UPDATE stacy_devices SET status='online' WHERE device_id='desktop'").run();
    const pinned = { ...env, OWNER_COGNIRA_DEVICE_ID: 'laptop' };
    for (let index = 0; index < 3; index++) {
      await db.prepare("UPDATE stacy_devices SET last_seen=? WHERE device_id='desktop'").bind(new Date(now + index).toISOString()).run();
      assert.equal((await findOwnerDevice(pinned, phone)).device_id, 'laptop', 'old PC heartbeats cannot steal ownership of new commands');
    }
    await db.prepare("UPDATE stacy_devices SET status='offline' WHERE device_id='laptop'").run();
    const offline = await findOwnerDevice(pinned, phone);
    assert.equal(offline.device_id, 'laptop');
    assert.equal(offline.status, 'offline', 'the caller must report the designated PC offline instead of operating another PC');

    await db.prepare("UPDATE stacy_devices SET user_id=NULL WHERE device_id='laptop'").run();
    assert.equal(await findOwnerDevice(pinned, phone), null, 'configuration never grants access to an unlinked device');
    assert.equal(await findOwnerDevice({ ...pinned, OWNER_COGNIRA_DEVICE_ID: 'other' }, phone), null, 'a primary device owned by another WhatsApp sender cannot be selected');
    assert.equal((await findOwnerDevice(pinned, other)).device_id, 'other', 'the owner preference must not affect another sender');
  } finally { await mf.dispose(); }
});
