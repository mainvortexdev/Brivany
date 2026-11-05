'use strict';
function protectFileUI(action,processName,params,controlName='',trustedNewDocument=false){
 const name=String(processName||'').replace(/\.exe$/i,'');
 if(/^explorer$/i.test(name)&&['click_control','type_text'].includes(action))throw Error('Usa las herramientas de archivos para conservar el alcance y su aprobación; el Explorador sólo se abre o consulta.');
 if(action==='click_control'&&/\b(?:delete|borrar|eliminar|replace|overwrite|sobrescribir|reemplazar|guardar|save)\b/i.test(controlName))throw Error('Usa una operación de archivo con revisión concreta, no el diálogo genérico.');
 if(!trustedNewDocument&&/^(notepad|wordpad|winword|excel|powerpnt)$/i.test(name)){
  if(action==='click_control'||action==='type_text'||action==='press_key'&&!['escape','tab','left','right','up','down','home','end'].includes(String(params.key).toLowerCase()))throw Error('La edición genérica de documentos existentes puede autoguardar. Crea una copia y solicita aprobar su sustitución.');
 }
}
module.exports={protectFileUI};
