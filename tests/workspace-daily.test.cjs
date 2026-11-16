'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),core=require('../desktop/experience/workspace-daily.js');
test('Calendar keeps local days and clamps month navigation at leap boundaries',()=>{
 assert.equal(core.monthDays('2024-02'),29);assert.equal(core.monthDays('2025-02'),28);
 assert.equal(core.monthShift('2024-01-31',1),'2024-02-29');assert.equal(core.monthShift('2025-03-31',-1),'2025-02-28');
 assert.equal(core.dayShift('2026-12-31',1),'2027-01-01');assert.equal(core.dateKey(core.date('2026-03-08')),'2026-03-08');
 for(const date of ['2026-02-29','2024-13-01','../date','1900-00-01'])assert.throws(()=>core.date(date));
});
test('Events validate hours and bounded one-line titles',()=>{
 const item={id:'a',title:'Preparar la demo',date:'2026-11-07',time:'09:05'};assert.deepEqual(core.event(item),item);
 assert.throws(()=>core.event({...item,time:'24:01'}));assert.throws(()=>core.event({...item,title:'bad\r\nBEGIN:VEVENT'}));
 assert.throws(()=>core.event({...item,title:'x'.repeat(101)}));assert.equal(core.event({...item,time:''}).time,'');
});
test('Bookmarks only accept HTTP URLs without credentials or hidden whitespace',()=>{
 assert.equal(core.site({id:'a',title:'Documentación',url:'https://example.test/docs'}).url,'https://example.test/docs');
 for(const url of ['javascript:alert(1)','file:///C:/secret','https://user:pass@example.test','data:text/html,hello','https://example.test/with space','https://example.test/\n'])assert.throws(()=>core.site({id:'a',title:'Web',url}));
});
test('Corrupt storage drops invalid entries, duplicates and overflow',()=>{
 const e={id:'a',title:'Evento',date:'2026-11-07',time:''},s={id:'s',title:'Web',url:'https://example.test/'};
 const state=core.state({events:[e,e,null,{...e,id:'b',time:'25:00'}],sites:[s,{...s,id:'bad',url:'file:///C:/secret'}],location:{latitude:NaN,longitude:0,label:'X'}});
 assert.equal(state.events.length,1);assert.equal(state.sites.length,1);assert.equal(state.location,null);
 assert.equal(core.state({events:Array.from({length:101},(_,i)=>({...e,id:String(i)}))}).events.length,100);
});
test('ICS export uses actual UTC stamp, floating local times and exclusive all-day end',()=>{
 const events=[{id:'own',title:'Revisar, mañana; café',date:'2024-02-29',time:''},{id:'timed',title:'Reunión',date:'2026-11-07',time:'13:45'}];
 const text=core.ics(events,new Date('2026-11-07T17:00:00Z'));assert(text.includes('DTSTAMP:20261107T170000Z'));
 assert(text.includes('DTEND;VALUE=DATE:20240301'));assert(text.includes('DTSTART:20261107T134500'));
 assert(text.includes('SUMMARY:Revisar\\, mañana\\; café'));assert(text.endsWith('END:VCALENDAR\r\n'));
 const folded=core.ics([{...events[0],title:'é'.repeat(100)}]);for(const line of folded.split('\r\n'))assert(Buffer.byteLength(line)<=75);
 assert(core.ics([{...events[0],date:'2199-12-31'}]).includes('DTEND;VALUE=DATE:22000101'));
});
test('Weather location rejects fake coordinates and names; labels follow provider codes',()=>{
 assert.equal(core.condition(95),'Tormenta');assert.equal(core.condition(1000),'Condición no disponible');
 for(const value of [{latitude:91,longitude:0,label:'x'},{latitude:0,longitude:NaN,label:'x'},{latitude:true,longitude:0,label:'x'}])assert.throws(()=>core.location(value));
});
