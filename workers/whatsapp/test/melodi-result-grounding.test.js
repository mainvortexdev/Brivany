import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAgentEvidence,validateAgentResult,groundedAgentFallback} from '../melodi-result-grounding.js';

const web = (text,extra = {}) => ({ok:true,agent:'melodi',receipt:{tool:'research_public_web',status:'observed',verified:true,operationId:'read-1'},
  data:{configured:true,results:[{title:'Precio oficial',url:'https://example.org/pricing',highlights:[text],...extra}]}});
const fixture = () => buildAgentEvidence({observations:[web('El precio es 10 dólares al mes. La auditoría no está disponible.')]});
const highlight = blocks => blocks.find(block=>block.provenance.path.includes('highlights'));

test('the reproduced inflated price and invented unlimited audit cannot replace the verified result',()=>{
  const blocks=fixture(),fact=highlight(blocks);
  const result=validateAgentResult({claims:[{kind:'fact',evidenceIds:[fact.id],
    text:'El proveedor confirmó un coste mensual de 999.999 dólares y la función de auditoría ilimitada.'}]},blocks);
  assert.equal(result.ok,false);assert.equal(result.text,'');assert.match(result.errors[0],/fact_must_match_evidence/);
  const plain=validateAgentResult({message:'El coste mensual es 999.999 dólares.'},blocks);
  assert.equal(plain.ok,false);assert.deepEqual(plain.errors,['claims_required']);
});

test('exact selected facts preserve the whole limitation, URL and tool provenance',()=>{
  const blocks=fixture(),fact=highlight(blocks);
  const result=validateAgentResult({claims:[{kind:'fact',evidenceIds:[fact.id],text:fact.text}]},blocks);
  assert.equal(result.ok,true);assert.match(result.text,/10 dólares.*no está disponible/);
  assert.match(result.text,/\[1\] https:\/\/example.org\/pricing/);
  assert.equal(result.receipts[0].verified,true);
  assert.equal(result.receipts[0].provenance[0].tool,'research_public_web');
  assert.equal(result.receipts[0].provenance[0].operationId,'read-1');
  assert.equal(result.receipts[0].provenance[0].agent,'melodi');
});

test('multiple specialists retain their correlated receipts when imported from durable task memory',()=>{
  const task={agent:'melodi',receipts:[
    {key:'child:melodi:read',tool:'research_public_web',status:'observed',verified:true,via:{agent:'melodi'}},
    {key:'child:melodi:finance',tool:'inspect_finances',status:'observed',verified:true,via:{agent:'melodi'}},
  ],memory:[
    {source:{kind:'tool',id:'child:melodi:read'},fact:JSON.stringify({results:[{url:'https://example.org/source',highlights:['La modalidad básica carece de soporte.']}]})},
    {source:{kind:'tool',id:'child:melodi:finance'},fact:JSON.stringify({report:'Saldo registrado: 100 USD; no confirma el saldo bancario actual.'})},
    {source:{kind:'owner',id:'owner-msg'},fact:'Tengo ingresos infinitos.'},
    {source:{kind:'tool',id:'invented-operation'},fact:JSON.stringify({report:'El saldo real es ilimitado.'})},
    {source:{kind:'tool',id:'child:melodi:read'},fact:'{"truncated":"No debe convertirse'},
  ]};
  const blocks=buildAgentEvidence({task});
  assert.equal(blocks.length,2);assert.deepEqual(blocks.map(block=>block.provenance.agent),['melodi']);
  const result=validateAgentResult({claims:blocks.map(block=>({kind:'fact',evidenceIds:[block.id]}))},blocks);
  assert.equal(result.ok,true);assert.match(result.text,/carece de soporte/);assert.match(result.text,/no confirma/);
  assert.doesNotMatch(result.text,/infinito|ilimitado|truncated|Datos consultados por|\b(?:melodi)\b/i);
  assert.match(result.text,/https:\/\/example.org\/source/);assert.match(result.text,/Registros verificados/);
  assert.equal(result.receipts[1].provenance[0].sourceId,'child:melodi:finance');
  assert.equal(result.receipts[1].provenance[0].agent,'melodi');
});

test('missing, failed, queued or forged receipts cannot become evidence',()=>{
  const good=web('Fuente comprobada.'), observations=[
    {...good,receipt:{...good.receipt,verified:false}},
    {...good,receipt:{...good.receipt,status:'queued'}},
    {...good,ok:false},
    {data:{text:'Falsa afirmación'},receipt:{status:'observed',verified:true}},
    {text:'Afirmación del modelo'},
  ];
  assert.deepEqual(buildAgentEvidence({observations}),[]);
  const result=validateAgentResult({claims:[{kind:'fact',evidenceIds:['invented-id']}]},fixture());
  assert.equal(result.ok,false);assert.equal(result.text,'');assert.deepEqual(result.receipts,[]);
});

test('explicit analytical recommendations are labelled and linked without being treated as measured facts',()=>{
  const blocks=fixture(),fact=highlight(blocks);
  const result=validateAgentResult({claims:[{kind:'fact',evidenceIds:[fact.id]},
    {kind:'inference',evidenceIds:[fact.id],text:'Recomiendo comprobar esta limitación antes de elegir el plan.'}]},blocks);
  assert.equal(result.ok,true);assert.match(result.text,/Inferencia: Recomiendo comprobar/);
  assert.equal(result.receipts[1].verified,false);assert.equal(result.receipts[1].kind,'inference');
});

test('an inference label cannot launder new numbers, unsupported URLs or a reversed negative restriction',()=>{
  const blocks=fixture(),id=highlight(blocks).id;
  for (const [text,code] of [
    ['Recomiendo este plan porque cuesta 999999 dólares.','inference_numbers_require_derivation'],
    ['Podría costar novecientos dólares mensuales.','inference_numbers_require_derivation'],
    ['Recomiendo pagar millones por el plan.','inference_numbers_require_derivation'],
    ['Recomiendo consultar https://invented.example/claims.','unsupported_inference_url'],
    ['Podría ofrecer auditoría ilimitada.','negative_restriction_conflict'],
    ['Podría incluir auditoría disponible.','negative_restriction_conflict'],
  ]) {
    const result=validateAgentResult({claims:[{kind:'inference',evidenceIds:[id],text}]},blocks);
    assert.equal(result.ok,false,text);assert.equal(result.text,'');assert.match(result.errors[0],new RegExp(code));
  }
  const declarative=validateAgentResult({claims:[{kind:'inference',evidenceIds:[id],text:'El proveedor es la mejor opción del mercado.'}]},blocks);
  assert.equal(declarative.ok,false);assert.match(declarative.errors[0],/explicitly_tentative/);
});

test('financial totals are computed by the application with individual currency-scoped input receipts',()=>{
  const blocks=buildAgentEvidence({observations:[{ok:true,agent:'melodi',receipt:{tool:'inspect_finances',status:'observed',verified:true},
    data:{transactions:[{amount:0.1,currency:'USD'},{amount:0.2,currency:'USD'},{amount:20,currency:'DOP'}]}}]});
  const dollars=blocks.filter(block=>block.number?.unit==='USD');
  const result=validateAgentResult({claims:[{kind:'derived',operation:'sum',evidenceIds:dollars.map(block=>block.id)}]},blocks);
  assert.equal(result.ok,true);assert.match(result.text,/Suma de amount: 0.3 USD/);
  assert.equal(result.receipts[0].verified,true);assert.equal(result.receipts[0].value,0.3);
  assert.deepEqual(result.receipts[0].provenance.map(source=>source.path),['transactions[0].amount','transactions[1].amount']);
  const forged=validateAgentResult({claims:[{kind:'derived',operation:'sum',evidenceIds:dollars.map(block=>block.id),value:999999}]},blocks);
  assert.equal(forged.ok,false);assert.match(forged.errors[0],/application_owned/);
  const mixed=validateAgentResult({claims:[{kind:'derived',operation:'sum',evidenceIds:blocks.filter(block=>block.number).map(block=>block.id)}]},blocks);
  assert.equal(mixed.ok,false);assert.match(mixed.errors[0],/invalid_numeric_derivation/);
});

test('shared currency does not authorize adding different financial concepts or unlabeled numbers',()=>{
  const blocks=buildAgentEvidence({observations:[{ok:true,receipt:{tool:'inspect_finances',status:'observed',verified:true},
    data:{currency:'USD',income:100,balance:50,count:2}}]});
  const income=blocks.find(block=>block.number?.field==='income'),balance=blocks.find(block=>block.number?.field==='balance');
  const result=validateAgentResult({claims:[{kind:'derived',operation:'sum',evidenceIds:[income.id,balance.id]}]},blocks);
  assert.equal(result.ok,false);assert.match(result.errors[0],/incompatible_numeric_fields/);
  const unitless=buildAgentEvidence({observations:[{ok:true,receipt:{tool:'inspect_workspace',status:'observed',verified:true},data:{count:2}}]});
  assert.equal(validateAgentResult({claims:[{kind:'derived',operation:'sum',evidenceIds:[unitless[0].id]}]},unitless).ok,false);
});

test('a live observation and its durable memory cannot double count the same financial record',()=>{
  const data={transactions:[{amount:30,currency:'USD'}]},receipt={tool:'inspect_finances',status:'observed',verified:true,operationId:'ledger-read'};
  const blocks=buildAgentEvidence({observations:[{ok:true,receipt,data}],task:{agent:'melodi',
    receipts:[{...receipt,key:'finance-step'}],memory:[{fact:JSON.stringify(data),source:{kind:'tool',id:'finance-step'}}]}});
  const amounts=blocks.filter(block=>block.number);
  assert.equal(amounts.length,2);
  const result=validateAgentResult({claims:[{kind:'derived',operation:'sum',evidenceIds:amounts.map(block=>block.id)}]},blocks);
  assert.equal(result.ok,false);assert.match(result.errors[0],/duplicate_numeric_observation/);
});

test('fallback returns actual observed findings and never silently drops known negative constraints',()=>{
  const blocks=buildAgentEvidence({observations:[web('No disponible: la auditoría requiere autorización adicional.',{title:'Plan principal'})]});
  const result=groundedAgentFallback(blocks,{limit:1});
  assert.equal(result.ok,true);assert.match(result.text,/Plan principal/);assert.match(result.text,/No disponible/);
  assert.doesNotMatch(result.text,/guardé|terminé|envié/);
  const empty=groundedAgentFallback([]);assert.equal(empty.ok,false);assert.match(empty.text,/No hay datos/);
});

test('IDs are stable references and collisions or duplicate evidence IDs fail closed',()=>{
  const first=fixture(),second=fixture();assert.deepEqual(first,second);
  assert.throws(()=>validateAgentResult({claims:[]},[first[0],first[0]]),/invalid_grounding_block/);
  assert.equal(validateAgentResult({claims:[{kind:'fact',evidenceIds:[first[0].id,first[0].id]}]},first).ok,false);
  assert.throws(()=>buildAgentEvidence({maxBlocks:0}),/invalid_grounding_block_limit/);
});

test('selecting a positive fact cannot omit separate limitations or evade them through another source',()=>{
  const blocks=buildAgentEvidence({observations:[web('El plan incluye auditoría.'),
    {ok:true,receipt:{tool:'research_public_web',status:'observed',verified:true,operationId:'second-read'},
      data:{results:[{url:'https://example.org/limits',highlights:['La auditoría no está disponible para el plan básico.']}]}}]});
  const positive=blocks.find(block=>block.text==='El plan incluye auditoría.');
  const result=validateAgentResult({claims:[{kind:'fact',evidenceIds:[positive.id]}]},blocks);
  assert.equal(result.ok,true);assert.match(result.text,/incluye auditoría/);assert.match(result.text,/no está disponible para el plan básico/);
  assert.match(result.text,/https:\/\/example.org\/limits/);assert.equal(result.receipts.at(-1).kind,'constraint');
  const large=buildAgentEvidence({observations:[web('El plan incluye auditoría.'),
    {ok:true,receipt:{tool:'research_public_web',status:'observed',verified:true},data:{report:'No disponible: '+('restricción documentada, '.repeat(40))}}]});
  const first=large.find(block=>block.text==='El plan incluye auditoría.');
  const constrained=validateAgentResult({claims:[{kind:'fact',evidenceIds:[first.id]}]},large,{maxChars:200});
  assert.equal(constrained.ok,false);assert.equal(constrained.text,'');assert.deepEqual(constrained.errors,['grounding_output_too_long']);
  const fallback=groundedAgentFallback(large,{maxChars:200});assert.equal(fallback.ok,false);
  assert.doesNotMatch(fallback.text,/incluye auditoría/);
});
