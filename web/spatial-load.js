/** Bounded download accounting. Limits describe bytes received, not GPU memory. */
export const ASSET_BYTE_LIMIT=30*1024*1024,SCENE_BYTE_LIMIT=60*1024*1024;

function aborted(signal){if(signal?.aborted)throw signal.reason || new DOMException('Carga cancelada.','AbortError');}

export async function readBoundedAsset(response,{signal,maxBytes=ASSET_BYTE_LIMIT,onChunk=()=>{}}={}){
  if(!Number.isSafeInteger(maxBytes) || maxBytes<=0 || maxBytes>SCENE_BYTE_LIMIT)throw Error('Límite de descarga no válido.');
  aborted(signal);
  const header=response.headers.get('content-length'),declared=header===null?null:Number(header);
  if(declared!==null && (!Number.isSafeInteger(declared) || declared<0 || declared>maxBytes)){
    await response.body?.cancel().catch(()=>{});throw Error('El artefacto excede el límite de descarga.');
  }
  if(!response.body?.getReader)throw Error('Este navegador no admite la lectura acotada de artefactos.');
  const reader=response.body.getReader(),chunks=[];let received=0,finished=false;
  const cancel=()=>{reader.cancel(signal.reason).catch(()=>{});};signal?.addEventListener('abort',cancel,{once:true});
  try{
    while(true){
      aborted(signal);const {done,value}=await reader.read();aborted(signal);
      if(done){finished=true;break;}
      if(!(value instanceof Uint8Array) || received+value.byteLength>maxBytes)throw Error('El artefacto excede el límite de descarga.');
      onChunk(value.byteLength);received+=value.byteLength;chunks.push(value);
    }
    if(declared!==null && received!==declared)throw Error('El tamaño del artefacto cambió durante la descarga.');
    const bytes=new Uint8Array(received);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    return bytes.buffer;
  }finally{
    signal?.removeEventListener('abort',cancel);if(!finished)await reader.cancel().catch(()=>{});reader.releaseLock();
  }
}

export async function verifyAssetHash(bytes,expected){
  if(!/^[a-f0-9]{64}$/.test(expected || '') || !globalThis.crypto?.subtle)throw Error('No se pudo verificar la integridad del artefacto.');
  const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
  if(actual!==expected)throw Error('El artefacto cambió. Vuelve a abrir la versión guardada.');
}

export function orderedAssets(manifest){
  const used=new Set(manifest.objects.map(object=>object.asset_id)),environment=new Set(manifest.objects.filter(object=>object.role==='environment').map(object=>object.asset_id));
  return manifest.assets.filter(asset=>used.has(asset.id)).sort((a,b)=>Number(environment.has(b.id))-Number(environment.has(a.id)));
}
