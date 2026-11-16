import { cf, BACKUP } from './cloudflare-release.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {melodiSchemaPlan,copySql,PRIMARY_ONLY,RETIRED_WORK} from './melodi-schema.mjs';
export const DATABASE = 'f104d1d0-aae3-4e50-a0a6-723f7f5e7f0e';
export async function query(sql, params = []) {
  const response = await cf(`/d1/database/${DATABASE}/query`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql, params }) });
  const envelope = await response.json();
  if (!envelope.success || envelope.result.some(item=>item.success===false)) throw Error('d1_query_failed');
  return envelope.result;
}
async function inspect() {
  const [{ results: schema }] = await query("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type,name");
  await mkdir(join(BACKUP, 'database'), { recursive: true });
  await writeFile(join(BACKUP, 'database/schema.json'), JSON.stringify(schema));
  const [{results:levels}] = await query('SELECT agent,level,permission_revision FROM wa_agent_levels ORDER BY agent');
  const mapped=new Set(melodiSchemaPlan(schema).tables.map(row=>row.from));
  const tables = schema.filter(row=>row.type==='table' && (mapped.has(row.name)||/(?:agent|autonomy|team|calendar_events)/.test(row.name)||/\bagent\b/.test(row.sql)));
  for (const table of tables) {
    if (!/^[a-zA-Z0-9_]+$/.test(table.name)) throw Error('invalid_snapshot_table');
    const [{results:rows}] = await query(`SELECT * FROM "${table.name}" LIMIT 5000`);
    if (rows.length===5000) throw Error('snapshot_table_requires_paging');
    await writeFile(join(BACKUP, `database/${table.name}.json`), JSON.stringify(rows));
  }
  console.log(JSON.stringify({ tables: tables.map(row=>row.name), levels, snapshot:'local protected directory; no data removed' }));
}
export async function buildMigration(){
  const [{results:schema}]=await query("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type,name");
  const plan=melodiSchemaPlan(schema),copies=[];
  for(const table of plan.tables){
    const [{results:columns}]=await query(`PRAGMA table_info("${table.from}")`);
    const sql=copySql(table,columns.map(row=>row.name));
    if(sql)copies.push({...table,sql,where:PRIMARY_ONLY.has(table.from)?" WHERE agent='dona'":''});
  }
  return {...plan,copies,retired:plan.tables.filter(row=>RETIRED_WORK.has(row.from)).map(row=>row.from)};
}
async function migrate(action){
  const plan=await buildMigration();
  await writeFile(join(BACKUP,'database/migration-plan.json'),JSON.stringify(plan,null,2));
  if(action==='plan'){console.log(JSON.stringify({creates:plan.create.length,copies:plan.copies.length,retiredQueuesAndGoals:plan.retired}));return;}
  if(action==='apply'){
    for(const sql of plan.create)await query(sql);
    for(const copy of plan.copies)await query(copy.sql);
  }
  const counts=[];
  for(const copy of plan.copies){
    const [{results:[source]}]=await query(`SELECT COUNT(*) AS n FROM "${copy.from}"${copy.where}`);
    const [{results:[target]}]=await query(`SELECT COUNT(*) AS n FROM "${copy.to}"`);
    counts.push({table:copy.to,source:source.n,target:target.n,ok:target.n>=source.n});
  }
  const report={mode:action,copies:counts,oldTablesRetained:true,ok:counts.every(item=>item.ok)};
  await writeFile(join(BACKUP,`database/${action}-report.json`),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
  if(!report.ok)process.exitCode=1;
}
if (process.argv[1]?.replaceAll('\\','/').endsWith('/melodi-db.mjs')) {
  const action=process.argv[2]||'inspect';
  (action==='inspect'?inspect():['plan','apply','verify'].includes(action)?migrate(action):Promise.reject(Error('unsupported_database_action')))
    .catch(error=>{console.error(error.message);process.exitCode=1;});
}
