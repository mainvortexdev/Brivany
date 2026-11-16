/* One menu action; the drawing surface exists only after an explicit click. */
(() => {
 'use strict';let opening=false;
 window.BrivanyWorkspaceWidgets?.addAction('canvas','Lienzo',async()=>{
  if(opening)return;opening=true;
  try{const api=window.pywebview?.api;if(!api?.workspace_canvas_open)throw Error('Abre el lienzo desde Brivany Desktop.');await api.workspace_canvas_open();window.BrivanyWorkspaceWidgets.message('')}
  catch(error){window.BrivanyWorkspaceWidgets.message(error.message||'No se pudo abrir el lienzo.')}
  finally{opening=false}
 });
})();
