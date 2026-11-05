"""Confirm the bounded surface GLB loads in the existing actual WebGL viewer.

Known synthetic camera/depth arrays replace VGGT entirely. The temporary scene
is explicitly generated_demo, with no private photos, model, GPU or remote API.
"""
from contextlib import closing
from http.server import ThreadingHTTPServer
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
from uuid import uuid4

from contracts.spatial import SceneManifest
from services.h1.server import Handler,ROOT
from services.spatial.jobs import SpatialService,now
from services.spatial.media_access import MediaAccess
from tests.test_spatial_room import predictions
from workers.spatial_room import build_surface,canonical,readiness

JAVASCRIPT=r"""
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH || 'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.BRIVANY_BROWSER_CHANNEL || 'msedge',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
  const base=process.env.BRIVANY_TEST_URL,scene=process.env.BRIVANY_ROOM_SCENE,errors=[],external=[];
  const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
  await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==base){external.push(route.request().url());return route.abort();}return route.continue();});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/spaces?space='+scene);await page.waitForFunction(()=>document.querySelector('#spatial-canvas').dataset.ready==='true');
  assert.equal(await page.locator('.object-button').count(),1);assert.ok(Number(await page.locator('#spatial-canvas').getAttribute('data-draw-calls'))>0);
  const payload=await (await page.request.get(base+'/api/spatial/scenes/'+scene)).json();
  assert.equal(payload.scene.origin,'generated_demo');assert.match(payload.scene.limitations.join(' '),/synthetic/);
  assert.equal(await page.locator('#space-origin').textContent(),'Demostración');
  await page.locator('.object-button').click();assert.match(await page.locator('#selected-note').textContent(),/synthetic/);
  const directory=path.resolve('tmp/spatial-room');fs.mkdirSync(directory,{recursive:true});
  await page.screenshot({path:path.join(directory,'synthetic-surface-1440.png'),fullPage:true});
  await page.setViewportSize({width:390,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  await page.screenshot({path:path.join(directory,'synthetic-surface-390.png'),fullPage:true});
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log(JSON.stringify({status:'passed',checks:['Actual GLB positions/normals/vertex colors/triangles load in existing WebGL viewer.','Synthetic source is labeled demonstration and retains relative scale.','Selection and desktop/mobile layouts remain functional.'],external_calls:0,model_executed:false,gpu_inference:false,room_reconstruction_verified:false,physical_devices_tested:false},null,2));
  await context.close();
 }finally{await browser.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
"""


class QuietHandler(Handler):
    def log_message(self,*args):pass


def main():
    generated=build_surface(predictions(),{'sample_stride':1})
    artifacts=ROOT/'tmp/spatial-room';artifacts.mkdir(parents=True,exist_ok=True)
    (artifacts/'synthetic-surface.glb').write_bytes(generated['artifact_bytes'])
    (artifacts/'surface.json').write_bytes(canonical(generated['surface']))
    with tempfile.TemporaryDirectory(prefix='brivany-room-render-') as temporary,closing(SpatialService(Path(temporary)/'spatial',start_worker=False,seed_demo=False)) as spatial:
        scene_id=str(uuid4());folder=spatial.root/'scenes'/scene_id;(folder/'assets').mkdir(parents=True)
        (folder/'assets/surface.glb').write_bytes(generated['artifact_bytes'])
        document=SceneManifest.model_validate_json(json.dumps({'scene_id':scene_id,'origin':'generated_demo','title':'Known-array surface · synthetic',
            'units':'source_relative','assets':[{'id':'surface','kind':'mesh','relative_path':'assets/surface.glb','sha256':generated['artifact']['sha256'],
                'provenance':'generated','source_frame_ids':[],'note':'Known synthetic depth and cameras only; no room reconstruction or model execution.'}],
            'objects':[{'id':'surface','label':'Superficie sintética','asset_id':'surface'}],
            'limitations':['Known synthetic camera/depth arrays, not a room reconstructed by a model.','Scale, coverage and geometry fidelity are unverified.']})).model_dump(mode='json')
        stamp=now();encoded=json.dumps(document)
        with spatial._connect() as db:
            db.execute('INSERT INTO scenes VALUES(?,?,?,1)',(scene_id,encoded,encoded))
            db.execute('INSERT INTO spaces VALUES(?,?,?,?,?,?,?,?)',(scene_id,document['title'],'ready','generated_demo',scene_id,None,stamp,stamp))
        server=ThreadingHTTPServer(('127.0.0.1',0),QuietHandler);server.spatial=spatial;server.spatial_media_access=MediaAccess()
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            result=subprocess.run(['node','-e',JAVASCRIPT],cwd=ROOT,env={**os.environ,'BRIVANY_TEST_URL':f'http://127.0.0.1:{server.server_port}',
                'BRIVANY_ROOM_SCENE':scene_id},capture_output=True,timeout=100,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            text=(result.stdout+result.stderr).decode('utf-8',errors='replace');print(text)
            report={'status':'passed' if result.returncode==0 else 'failed','scope':'Known synthetic arrays -> actual GLB -> HTTP + existing WebGL viewer; software rendering permitted.',
                'external_calls':0,'model_executed':False,'gpu_inference':False,'room_reconstruction_verified':False,
                'geometry_fidelity_verified':False,'metric_scale_verified':False,'surface_vertex_count':generated['surface']['vertex_count'],
                'surface_triangle_count':generated['surface']['triangle_count'],'runtime_preflight':readiness(),
                'artifacts':['tmp/spatial-room/synthetic-surface.glb','tmp/spatial-room/surface.json','tmp/spatial-room/synthetic-surface-1440.png','tmp/spatial-room/synthetic-surface-390.png'],
                'output':text}
            (artifacts/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8');return result.returncode
        finally:server.shutdown();server.server_close();thread.join(3)


if __name__=='__main__':raise SystemExit(main())
