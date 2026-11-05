/** The native bridge is supplied only by the desktop window. No fallback shell. */
export const desktopAvailable=()=>Boolean(window.pywebview?.api);
export async function desktopCall(method,...args){
  const allowed=new Set(['status','pick_project_folder','save_current_project','save_open_project','export_open_project','get_floorplan','save_floorplan','get_presentation','save_presentation']);
  if(!allowed.has(method) || !desktopAvailable())throw Error('Abre Brivany Desktop para usar el selector de proyectos.');
  if(typeof window.pywebview.api[method]!=='function')throw Error('Esta ventana de Brivany Desktop necesita reiniciarse para usar esta función.');
  const result=await window.pywebview.api[method](...args);
  if(!result?.ok){
    const exception=Error(result?.error?.message || 'No se pudo completar la operación de escritorio.');
    if(typeof result?.error?.code==='string')exception.code=result.error.code;
    if(Number.isInteger(result?.error?.status))exception.status=result.error.status;
    throw exception;
  }
  return result;
}
