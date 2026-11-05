/** Inferred source viewpoints, never a calibrated photo alignment or metric proof. */
export function roomCameraPresets(scene){
  if(scene?.origin!=='room_reconstruction' || !Array.isArray(scene.reconstruction?.cameras))return [];
  return scene.reconstruction.cameras.flatMap((camera,index)=>{
    const matrix=camera.camera_to_viewer,bounds=camera.image_bounds,fy=camera.intrinsic?.[1]?.[1];
    if(!Array.isArray(matrix) || matrix.length!==4 || !matrix.every(row=>Array.isArray(row) && row.length===4 && row.every(Number.isFinite)) || !Array.isArray(bounds) || bounds.length!==4 || !bounds.every(Number.isFinite) || !Number.isFinite(fy) || fy<=0)return [];
    const position=matrix.slice(0,3).map(row=>row[3]),direction=matrix.slice(0,3).map(row=>row[2]);
    const length=Math.hypot(...direction);if(length<.99 || length>1.01 || position.some(value=>Math.abs(value)>100000))return [];
    const target=position.map((value,axis)=>value+direction[axis]);
    const fov=2*Math.atan((bounds[3]-bounds[1])/(2*fy))*180/Math.PI;
    if(!Number.isFinite(fov) || fov<=0)return [];
    // Orbit controls retain the viewer's Y-up convention. Source roll and
    // off-centre intrinsics are deliberately not claimed as photo registration.
    return [{id:`room-${camera.frame_id}`,label:`Cámara ${index+1} · ${camera.at_seconds.toFixed(1)} s · estimada`,position,target,fov:Math.max(15,Math.min(100,fov))}];
  });
}

export const capturedRoomColors=scene=>scene?.origin==='room_reconstruction' && scene.reconstruction?.colors_include_captured_lighting===true;
