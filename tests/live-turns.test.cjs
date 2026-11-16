const test=require('node:test'),assert=require('node:assert/strict');
const {SpeechTurnAssembler,incompleteUtterance,ListeningCues,CUE_TEXT,stripCueEcho}=require('../web/live-turns.js');
function fixture(){let time=0,next=0;const tasks=new Map(),commits=[],partials=[];
 const timers={setTimeout(fn,delay){const id=++next;tasks.set(id,{fn,at:time+delay});return id;},clearTimeout(id){tasks.delete(id);}};
 const turn=new SpeechTurnAssembler({timers,onCommit:text=>commits.push(text),onPartial:text=>partials.push(text)});
 return{turn,commits,partials,advance(ms){const end=time+ms;for(;;){const row=[...tasks].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!row)break;time=row[1].at;tasks.delete(row[0]);row[1].fn();}time=end;}};
}
test('Vetsa timing: 1.6 s stable, 1.9 s partial, 0.8 s explicit stable question',()=>{
 for(const [final,text,delay] of [[true,'Hola Melodi.',1600],[false,'Una idea completa',1900],[true,'¿Qué puedes hacer?',800]]){
  const h=fixture();h.turn.push({id:'a',text,final});h.advance(delay-1);assert.deepEqual(h.commits,[]);h.advance(1);assert.deepEqual(h.commits,[text]);
 }
});
test('repeated transcripts and stable notifications never extend a pending deadline',()=>{
 const h=fixture();h.turn.push({id:'a',text:'Una idea completa',final:false});h.advance(1500);h.turn.push({id:'a',text:'Una idea completa',final:true});h.advance(400);assert.deepEqual(h.commits,['Una idea completa']);
 h.turn.push({id:'a',text:'Una idea completa',final:true});h.advance(3000);assert.equal(h.commits.length,1);
});
test('stable segments join across provider turns; incomplete connectors wait',()=>{
 const h=fixture();h.turn.push({id:'a',text:'Quiero organizar mi semana durante',final:true});h.advance(2500);assert.deepEqual(h.commits,[]);
 h.turn.speechStart();h.turn.push({id:'b',text:'las mañanas del lunes.',final:true});h.advance(1600);assert.deepEqual(h.commits,['Quiero organizar mi semana durante las mañanas del lunes.']);
 for(const value of ['Durante','Y','Cómo que yo','Tengo que','and'])assert.equal(incompleteUtterance(value),true);
 for(const value of ['Hola','Sí','Gracias','¿Y?','Estoy aquí.'])assert.equal(incompleteUtterance(value),false);
});
test('new speech cancels closing, while reset discards every late deadline',()=>{
 const h=fixture();h.turn.push({id:'a',text:'Primera parte.',final:true});h.advance(1000);h.turn.speechStart();h.advance(2000);assert.deepEqual(h.commits,[]);
 h.turn.push({id:'b',text:'Segunda parte.',final:true});h.advance(1599);h.turn.reset();h.advance(10000);assert.deepEqual(h.commits,[]);assert.equal(h.turn.pending,'');
});
test('a cumulative Muse ID may continue after local commit without repeating the prefix',()=>{
 const h=fixture();h.turn.push({id:'a',text:'Primera consulta.',final:false});h.advance(1900);
 h.turn.push({id:'a',text:'Primera consulta. Otra consulta.',final:false});h.advance(1900);
 h.turn.push({id:'a',text:'Primera consulta. Otra consulta.',final:true});h.advance(3000);assert.deepEqual(h.commits,['Primera consulta.','Otra consulta.']);
});
test('late punctuation and capitalization cannot lose a continuation or duplicate a turn',()=>{
 const h=fixture();h.turn.push({id:'a',text:'una consulta',final:false});h.advance(1900);h.turn.push({id:'a',text:'Una consulta. Otra cosa.',final:false});h.advance(1900);assert.deepEqual(h.commits,['una consulta','Otra cosa.']);
});
test('Vetsa listening cues: first at 8 s, then 14 s apart only while speech is recent',()=>{
 let now=0,next=0;const tasks=new Map(),spoken=[];
 const timers={setTimeout(fn,delay){const id=++next;tasks.set(id,{fn,at:now+delay});return id;},clearTimeout(id){tasks.delete(id);}};
 const cues=new ListeningCues({onCue:key=>spoken.push(key),timers,now:()=>now,random:()=>.5});
 const tick=at=>{now=at;for(const [id,task] of [...tasks])if(task.at<=now){tasks.delete(id);task.fn();}};
 cues.update('Una intervención suficientemente larga que todavía estoy explicando');tick(7000);cues.update('Una intervención suficientemente larga que todavía estoy explicando con otro detalle');tick(8000);assert.equal(spoken.length,1);
 tick(21000);cues.update('Todavía sigo explicando mi idea con varios detalles adicionales');tick(22000);assert.equal(spoken.length,2);
 tick(35000);cues.update('Sigo hablando y añado otra idea con suficientes palabras');tick(36000);assert.equal(new Set(spoken).size,3);
 tick(50000);assert.equal(spoken.length,3);cues.stop();tick(100000);assert.equal(spoken.length,3);assert.equal(tasks.size,0);
});
test('the listening bank varies all sixteen cues before reuse and stays neutral for distress',()=>{
 const cues=new ListeningCues({random:()=>.5});cues.text='Estoy hablando de una idea cotidiana';
 const cycle=Array.from({length:16},()=>cues.pick());assert.equal(new Set(cycle).size,16);assert.ok(cycle.every(key=>CUE_TEXT[key]));assert.notEqual(cues.pick(),cycle.at(-1));
 cues.text='Me siento triste por una pérdida y tengo miedo';for(let i=0;i<40;i++)assert.ok(!['bien','claro','si','de_acuerdo'].includes(cues.pick()));
 assert.equal(stripCueEcho('Necesito explicar otra cosa. Ya veo.','ya_veo'),'Necesito explicar otra cosa.');
 assert.equal(stripCueEcho('Entiendo que hay varias opciones.','entiendo'),'Entiendo que hay varias opciones.');
});
