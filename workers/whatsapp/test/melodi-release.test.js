import test from 'node:test';
import assert from 'node:assert/strict';
import {codeDigest,uploadMetadata} from '../tools/cloudflare-release.mjs';
import {melodiSchemaPlan,copySql} from '../tools/melodi-schema.mjs';
import {DatabaseSync} from 'node:sqlite';
test('code comparison ignores a multipart transport boundary but detects content changes',async()=>{
 async function state(source){const data=new FormData();data.set('main.js',new Blob([source],{type:'application/javascript+module'}),'main.js');const response=new Response(data);return{bytes:Buffer.from(await response.arrayBuffer()),contentType:response.headers.get('content-type')};}
 assert.equal(await codeDigest(await state('export default {}')),await codeDigest(await state('export default {}')));
 assert.notEqual(await codeDigest(await state('one')),await codeDigest(await state('two')));
});
test('a code-only release inherits existing bindings, replaces only named changes and preserves runtime options',()=>{
 const old={bindings:[{name:'TOKEN',type:'secret_text'},{name:'ASSETS',type:'assets'},{name:'QUEUE',type:'queue'}],compatibility_date:'2026-09-16',compatibility_flags:['nodejs_compat'],limits:{cpu_ms:30000},observability:{enabled:true,redact_query_string:false}};
 const meta=uploadMetadata(old,'main.js',[{name:'NEW_SECRET',type:'secret_text',text:'synthetic-value'}]);
 assert.deepEqual(meta.bindings.slice(0,3),old.bindings.map(b=>({name:b.name,type:'inherit'})));assert.equal(meta.keep_assets,true);
 assert.equal(meta.observability.redact_query_string,true);assert.deepEqual(meta.limits,old.limits);assert.deepEqual(meta.compatibility_flags,old.compatibility_flags);assert.equal(old.observability.redact_query_string,false);
});
test('dependent calendar tables migrate after their parent with exact identifier replacement and preserved foreign keys',()=>{
 const db=new DatabaseSync(':memory:');db.exec(`PRAGMA foreign_keys=ON;CREATE TABLE calendar_events(id TEXT PRIMARY KEY);CREATE TABLE screenshot_calendar_events(event_id TEXT REFERENCES calendar_events(id));INSERT INTO calendar_events VALUES('same-event');INSERT INTO screenshot_calendar_events VALUES('same-event')`);
 const plan=melodiSchemaPlan(db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL').all());for(const sql of plan.create)db.exec(sql);
 for(const table of plan.tables)db.exec(copySql(table,db.prepare(`PRAGMA table_info(${table.from})`).all().map(row=>row.name)));
 assert.equal(db.prepare('SELECT event_id FROM melodi_screenshot_calendar_events').get().event_id,'same-event');assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
});
