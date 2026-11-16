import camera from './assets/melodi-camera.jpg';
// Recall static camera images require a 16:9 JPEG. The original avatar remains
// unchanged for interactive Output Media. Encode once per isolate, in chunks.
let image;
export function meetingCamera(){
 if(!image){let raw='';for(let at=0;at<camera.length;at+=8192)raw+=String.fromCharCode(...camera.subarray(at,at+8192));image={kind:'jpeg',b64_data:btoa(raw)};}
 return {automatic_video_output:{in_call_not_recording:image,in_call_recording:image}};
}
