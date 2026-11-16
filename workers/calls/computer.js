const definitions=[
 ['computer_execute','Ejecuta en el ordenador vinculado la instrucción que el usuario acaba de pronunciar. Úsala para abrir aplicaciones, escribir, buscar o realizar una tarea en el PC. La instrucción enviada será exactamente la transcripción actual. No la uses para ejemplos, citas ni acciones no solicitadas.'],
 ['computer_status','Consulta el estado y resultado confirmado de la última tarea del ordenador solicitada en esta llamada.'],
 ['computer_cancel','Cancela la última tarea del ordenador solicitada en esta llamada, únicamente si el usuario lo pide.']
];
export const COMPUTER_TOOLS=definitions.map(([name,description])=>({type:'function',function:{name,description,parameters:{type:'object',properties:{},required:[],additionalProperties:false}}}));
export function phoneComputer(env,phone,callId){
 if(!env.MELODI_DESKTOP)return null;let task=null;
 return async(name,text,requestId)=>{
  const scope={phone,callId,requestId};
  try{
   if(name==='computer_execute'){
    const result=await env.MELODI_DESKTOP.execute({...scope,instruction:text});
    task={...scope,id:result.id};return result.summary;
   }
   if(!task)return 'Todavía no hay una tarea del ordenador en esta llamada. Pídeme qué quieres hacer en el PC.';
   if(name==='computer_status')return (await env.MELODI_DESKTOP.status(task)).summary;
   if(name==='computer_cancel')return (await env.MELODI_DESKTOP.cancel(task)).summary;
   throw Error('phone_tool_invalid');
  }catch{return 'No pude confirmar esa acción en el ordenador. Comprueba que Brivany siga abierta y el control remoto activado. No he repetido la instrucción.';}
 };
}
