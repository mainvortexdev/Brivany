import {DatabaseSync} from 'node:sqlite';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {BACKUP} from './cloudflare-release.mjs';
import {melodiSchemaPlan,copySql} from './melodi-schema.mjs';

// Retrospective local replay of protected snapshots. Never print stored rows.
const schema=JSON.parse(await readFile(join(BACKUP,'database/schema.json'),'utf8'));
const plan=melodiSchemaPlan(schema),db=new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys=OFF');
for(const table of plan.tables){
 db.exec(schema.find(row=>row.name===table.from&&row.type==='table').sql);
 const rows=JSON.parse(await readFile(join(BACKUP,`database/${table.from}.json`),'utf8'));
 for(const row of rows){const columns=Object.keys(row),stmt=db.prepare(`INSERT INTO "${table.from}" (${columns.map(c=>'"'+c+'"').join(',')}) VALUES(${columns.map(()=>'?').join(',')})`);stmt.run(...columns.map(c=>row[c]));}
}
for(const sql of plan.create)db.exec(sql);
db.exec('PRAGMA foreign_keys=ON');
const counts=[];
for(const table of plan.tables){
 const columns=db.prepare(`PRAGMA table_info("${table.from}")`).all().map(row=>row.name),sql=copySql(table,columns);
 if(!sql)continue;
 db.exec(sql);const first=db.prepare(`SELECT COUNT(*) AS n FROM "${table.to}"`).get().n;
 db.exec(sql);assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM "${table.to}"`).get().n,first);
 counts.push({table:table.to,rows:first});
}
const problems=db.prepare('PRAGMA foreign_key_check').all();assert.equal(problems.length,0,'migrated foreign keys must resolve');
const report={mode:'local-retrospective',creates:plan.create.length,copies:counts,idempotent:true,foreignKeys:true,providerCalls:0};
await writeFile(new URL('../../../.local/whatsapp-migration/reports/migration-replay.json',import.meta.url),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
