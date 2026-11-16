import {recallClient,MeetingError} from './recall.js';
import {meetingStore} from './store.js';
export function boardRequest(text){return /\b(?:pizarra|esquema visual|diagrama)\b/i.test(text);}
export async function showMeetingBoard(env,row,board,{client=recallClient(env)}={}){
 if(typeof board?.title!=='string'||board.title.length>160||!Array.isArray(board.items)||!board.items.length||board.items.length>8||board.items.some(item=>typeof item!=='string'||item.length>300))throw new MeetingError('meeting_board_invalid');
 if(!row.bot_id||!['recording','joined'].includes(row.status))throw new MeetingError('meeting_not_active',409);
 const store=meetingStore(env);await store.ensure();const data=await store.unseal(row.owner+':intent:'+row.id,row);if(!data.voiceToken)throw new MeetingError('meeting_voice_not_enabled',409);
 const sealed=await store.seal(row.owner+':board:'+row.id,{title:board.title,items:board.items});await store.q('INSERT INTO brivany_meeting_boards VALUES(?,?,?,?) ON CONFLICT(meeting_id) DO UPDATE SET state_encrypted=excluded.state_encrypted,state_iv=excluded.state_iv,updated_at=excluded.updated_at',row.id,sealed.state_encrypted,sealed.state_iv,Date.now()).run();
 await client.call('/bot/'+row.bot_id+'/output_media/',{method:'POST',body:{screenshare:{kind:'webpage',config:{url:env.PUBLIC_API_BASE_URL+'/meeting-media/'+row.id+'?token='+data.voiceToken+'&mode=board'}}}});
 return {shared:true,kind:'brivany-screenshare-board'};
}
export async function readMeetingBoard(store,row){const board=await store.q('SELECT * FROM brivany_meeting_boards WHERE meeting_id=?',row.id).first();return board?{...await store.unseal(row.owner+':board:'+row.id,board),updatedAt:board.updated_at}:null;}
