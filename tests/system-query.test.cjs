const test=require('node:test'),assert=require('node:assert/strict');
const {validate,queryScript}=require('../desktop/computer/systemQuery.cjs');
const query={source:'processes',fields:['ProcessName','WorkingSet64'],where:[],sort:{property:'WorkingSet64',descending:true},limit:3,aggregate:null};
test('new diagnostic combinations compile only fixed read-only commands',()=>{
 assert.equal(validate(query).limit,3);const script=queryScript(query);assert(script.includes('ConvertFrom-Json'));assert(!script.includes('Invoke-Expression'));
 const literal={...query,where:[{property:'ProcessName',op:'eq',value:"x'; Stop-Process -Id 1; '"}]};assert(!queryScript(literal).includes('Stop-Process'));
});
test('no command text, registry, methods, arbitrary sources or unbounded data',()=>{
 for(const bad of [{...query,source:'Stop-Process'},{...query,source:'registry'},{...query,command:'Get-Process'},{...query,fields:['MainModule']},{...query,limit:10000},{...query,where:[{property:'ProcessName',op:'script',value:'x'}]},{...query,sort:{property:'GetType()',descending:true}},{...query,aggregate:{op:'invoke',property:'CPU'}}])assert.throws(()=>validate(bad));
});
