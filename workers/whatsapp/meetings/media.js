import avatar from './assets/melodi-profile.png';
import {mediaHTML,boardHTML,MEDIA_CSS,EXTRA_CSS,MEDIA_ENGINE,CAPTURE_WORKLET,BOARD_ENGINE} from './media-page.js';
import {readMeetingBoard} from './board.js';
import {authorizeVoice,openVoiceSocket} from './voice.js';
export async function meetingMedia(request,env,ctx){
 const path=new URL(request.url).pathname;
 const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
 try{
  if(request.method!=='GET')return new Response('Method not allowed',{status:405,headers});
  const engine=MEDIA_ENGINE.replace("if(message.type==='ready')","if(message.type==='hand'){document.querySelector('#hand').hidden=!message.raised}if(message.type==='ready')").replace('ready=true;retries=0;','ready=true;retries=0;report();');
  const assets={'/meeting-media/avatar.png':[avatar,'image/png'],'/meeting-media/style.css':[MEDIA_CSS+EXTRA_CSS,'text/css; charset=utf-8'],'/meeting-media/engine.js':[engine,'text/javascript; charset=utf-8'],'/meeting-media/board.js':[BOARD_ENGINE,'text/javascript; charset=utf-8'],'/meeting-media/capture.js':[CAPTURE_WORKLET,'text/javascript; charset=utf-8']};
  if(assets[path]){const [body,type]=assets[path];return new Response(body,{headers:{...headers,'Content-Type':type}});}
  const match=/^\/meeting-media\/([0-9a-f-]{36})(\/(?:listen|board))?$/.exec(path);if(!match)return new Response('Not found',{status:404,headers});
  if(match[2]==='/listen')return openVoiceSocket(request,env,ctx,match[1]);
  const {store,row}=await authorizeVoice(request,env,match[1]);if(match[2]==='/board'){await store.q('UPDATE brivany_meeting_media_state SET board_seen_at=? WHERE meeting_id=?',Date.now(),row.id).run();return Response.json(await readMeetingBoard(store,row),{headers});}
  const primary=String(env.MELODI_PRIMARY_OWNER||env.OWNER_WHATSAPP_NUMBER||'').replace(/\D/g,'')===row.phone;
  return new Response(new URL(request.url).searchParams.get('mode')==='board'?boardHTML():mediaHTML(primary?'Daniel Luna':'tu titular'),{headers:{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self' https://brivany.vetsa.es; connect-src 'self' wss://ia.vetsa.es; img-src 'self'; media-src 'self' blob:; object-src 'none'; frame-ancestors 'none'",'Permissions-Policy':'microphone=(self), camera=()'}});
 }catch(error){return new Response('Meeting media unavailable',{status:error.status||503,headers});}
}
