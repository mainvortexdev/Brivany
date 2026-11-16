import test from 'node:test';
import assert from 'node:assert/strict';
import {desktopDrawingRequest} from '../desktop-drawing.js';
import {stacy_screenshot} from '../executors/desktop.js';
test('the reported request delegates to Melodi and asks for the resulting file',()=>{
 const task=desktopDrawingRequest('Dile a Melodi que dibuje esto y me lo envías cuando termine');
 assert.equal(task.intent,'stacy_command');assert.equal(task.agent,'melodi');assert.equal(task.returnArtifact,true);
 assert.match(task.stacyInstruction,/Dibuja en Paint/);
 assert.ok(desktopDrawingRequest('Melodi, dibuja esta foto'));
 for(const text of ['Recuérdame pedirle a Melodi que dibuje','No le digas a Melodi que dibuje','Genera una imagen de Melodi','Dibuja un retrato'])assert.equal(desktopDrawingRequest(text),null);
});
test('the desktop executor carries the actual attachment rather than personal portrait references',async()=>{
 let command;
 const interpretation=desktopDrawingRequest('Dile a Melodi que dibuje esto y me lo envías cuando termine');
 await stacy_screenshot({interpretation,env:{},phone:'owner',normalized:'Dile a Melodi que dibuje esto',descriptor:{kind:'image'},message:{image:{id:'incoming'}},reply:async()=>{}},{
  findOwnerDevice:async()=>({device_id:'pc'}),isStacyOnline:()=>true,
  storeIncomingMedia:async(_env,_phone,message)=>{assert.equal(message.image.id,'incoming');return {objectKey:'melodi-private/owner/patio',mimeType:'image/jpeg'};},
  createStacyCommand:async(...args)=>{command=args;return 'command-1';},
 });
 assert.equal(command[3],'instruction_reference');assert.equal(command[5].referenceImage.objectKey,'melodi-private/owner/patio');assert.equal(command[5].returnArtifact,true);
});
test('missing reference cannot silently generate a different subject',async()=>{
 const replies=[];
 await stacy_screenshot({interpretation:desktopDrawingRequest('Dile a Melodi que dibuje esto'),env:{},phone:'owner',normalized:'Dile a Melodi que dibuje esto',reply:async text=>replies.push(text)},{findOwnerDevice:async()=>({device_id:'pc'}),isStacyOnline:()=>true,createStacyCommand:async()=>assert.fail('Missing image')});
 assert.match(replies[0],/Necesito la imagen/);
});
