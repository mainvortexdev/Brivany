'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {attachPageActions,scrollScript,linkScript,observedDestination}=require('../desktop/computer/browserPageActions.cjs');
const {pageForPlanner,pageScript}=require('../desktop/computer/webPage.cjs');
const {validateStep}=require('../desktop/computer/native.cjs');
function fixture({percent=0,href='https://example.com/next',effect='scroll',frozen=false}={}){
 const state={windowHandle:'1',url:'https://example.com/start?q=private-fixture',documentId:'3.4',tab_id:'2.3',items:[{id:'4.5',name:'Informe observado',role:'ControlType.Hyperlink',href,x:1,y:2,width:100,height:30}],scrollables:[{id:'3.4',vertical_percent:percent}]};
 let tabs=[{id:'1.1',name:'Original',selected:false},{id:'2.3',name:'Fixture',selected:true}],inputs=0,reads=0,tabsOnly=0,afterUrl=state.url;
 const session={windowHandle:'1',tabId:'2.3',observe:async()=>({windowHandle:'1',tabs:structuredClone(tabs)}),requireSelectedTab:s=>{if(!s.tabs.some(t=>t.id===session.tabId&&t.selected))throw Error('changed tab');}};
 const options={readPage:async()=>{reads++;return structuredClone(state);},readUrl:async()=>({windowHandle:'1',url:afterUrl}),readTabs:async()=>{tabsOnly++;return {windowHandle:'1',tabs:structuredClone(tabs)};},run:async()=>{
  inputs++;if(effect==='scroll'&&!frozen)state.scrollables[0].vertical_percent+=20;
  if(effect==='link')afterUrl=href;
  if(effect==='new-tab'){tabs.forEach(t=>t.selected=false);tabs.push({id:'8.9',name:'New',selected:true});afterUrl=href;}
  return 'INPUT_SENT';
 },assertActive:()=>{},wait:async()=>{}};
 attachPageActions(session,options);return {session,state,options,get inputs(){return inputs;},get reads(){return reads;},get tabsOnly(){return tabsOnly;},setTabs:value=>tabs=value,setUrl:value=>afterUrl=value};
}
const params={tab_id:'2.3',document_id:'3.4',scroll_id:'3.4',direction:'down'},linkParams={tab_id:'2.3',document_id:'3.4',control_id:'4.5'};
test('Observed scroll is sent once and requires a changed percent on the same page',async()=>{
 const f=fixture();await f.session.readObservedPage();const result=await f.session.scrollObservedPage(params);assert(result.verified&&result.scrolled);assert.equal(result.before_percent,0);assert.equal(result.after_percent,20);assert.equal(f.inputs,1);
});
test('At a boundary no scroll input is sent',async()=>{
 const f=fixture();await f.session.readObservedPage();const result=await f.session.scrollObservedPage({...params,direction:'up'});assert(result.at_boundary&&result.verified&&!result.scrolled);assert.equal(f.inputs,0);
});
test('No scroll progress returns pending and never repeats uncertain input',async()=>{
 const f=fixture({frozen:true});await f.session.readObservedPage();const result=await f.session.scrollObservedPage(params);assert.equal(result.verified,false);assert(result.verificationPending);assert.equal(f.inputs,1);await assert.rejects(f.session.scrollObservedPage(params),/Lee de nuevo/);
});
test('Changed document, selected tab or scroll position stops before input',async()=>{
 for(const mutate of [f=>f.state.documentId='7.7',f=>f.state.scrollables[0].vertical_percent=30,f=>f.setTabs([{id:'9.9',selected:true}])]){
  const f=fixture();await f.session.readObservedPage();mutate(f);await assert.rejects(f.session.scrollObservedPage(params));assert.equal(f.inputs,0);
 }
});
test('A link must retain its observed ID, name, URL and document before invocation',async()=>{
 for(const mutate of [f=>f.state.items[0].href='https://other.example/',f=>f.state.items[0].name='Otro enlace',f=>f.state.url='https://example.com/replaced']){
  const f=fixture({effect:'link'});await f.session.readObservedPage();mutate(f);await assert.rejects(f.session.openObservedLink(linkParams));assert.equal(f.inputs,0);
 }
});
test('Observed links verify their destination in the same tab or exactly one new tab',async()=>{
 for(const effect of ['link','new-tab']){
  const f=fixture({effect});await f.session.readObservedPage();const result=await f.session.openObservedLink(linkParams);assert(result.verified&&result.tabs_preserved);assert.equal(result.new_tab,effect==='new-tab');assert.equal(f.inputs,1);assert(!JSON.stringify(result).includes('private-fixture'));
 }
});
test('Unexpected navigation never repeats a link invocation',async()=>{
 const f=fixture({effect:'none'});await f.session.readObservedPage();f.setUrl('https://other.example/');const result=await f.session.openObservedLink(linkParams);assert(!result.verified&&result.verificationPending);assert.equal(f.inputs,1);
});
test('Login handoff observes native tabs only after opening, never page fields',async()=>{
 const f=fixture({effect:'link',href:'https://example.com/login'});await f.session.readObservedPage();const result=await f.session.openObservedLink(linkParams);assert(result.requires_user&&result.verified);assert.equal(f.reads,2);assert.equal(f.tabsOnly,1);
});
test('An unexpected login redirect is handed back without reading its fields',async()=>{
 const f=fixture({effect:'none'});await f.session.readObservedPage();f.setUrl('https://accounts.example/login');const result=await f.session.openObservedLink(linkParams);assert(result.requires_user&&!result.verified);assert.equal(f.reads,2);
});
test('Page summaries omit complete queries, fragments and link destinations',()=>{
 const raw={url:'https://example.com/path?token=private-query#private-fragment',items:[{id:'1.2',name:'Informe',href:'https://example.com/file?key=private-destination'}]};
 const safe=pageForPlanner(raw);assert.equal(safe.url,'https://example.com/path');assert(safe.url_components_omitted);assert.equal(safe.items[0].destination_origin,'https://example.com');assert(!JSON.stringify(safe).includes('private-'));
 const many=pageForPlanner({url:'https://example.com/',items:Array.from({length:700},(_,i)=>({id:'4.'+i,name:'A'.repeat(1800),role:'ControlType.Text'}))});assert(many.truncated&&many.items.length<=120);assert(JSON.stringify(many).length<18000);
});
test('Browser actions have exact typed parameters and reject unsafe schemes',()=>{
 const identity={handle:'1',process_id:2};validateStep({action:'browser_scroll',params:{...identity,...params}});validateStep({action:'browser_open_link',params:{...identity,...linkParams}});
 for(const extra of [{direction:'down;bad'},{scroll_id:'1.2;bad'},{document_id:'win32:1'}])assert.throws(()=>validateStep({action:'browser_scroll',params:{...identity,...params,...extra}}));
 for(const href of ['javascript:alert(1)','file:///secret','https://user:secret@example.com'])assert.throws(()=>observedDestination(href,'https://example.com/'));
});
test('Native scripts revalidate identity and encode page text as literal data',()=>{
 const value='https://example.com/?q=$(do-not-execute)';const link=linkScript({windowHandle:'1',documentId:'1.2',url:value,controlId:'2.3',name:'$() {ENTER}',href:value});assert(!link.includes(value));assert(!link.includes('$() {ENTER}'));assert(link.includes('LINK_DESTINATION_CHANGED')&&link.includes('GetForegroundWindow'));assert.equal((link.match(/\$invoke\.Invoke\(\)/g)||[]).length,1);
 const scroll=scrollScript({windowHandle:'1',documentId:'1.2',url:value,scrollId:'1.2',direction:'down',percent:0});assert(scroll.includes('SCROLL_POSITION_CHANGED'));assert.equal((scroll.match(/\$scroll\.Scroll\(/g)||[]).length,1);
 assert.throws(()=>pageScript('changed source'));
});
