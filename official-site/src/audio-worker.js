import {encodeWav} from './wav.js';
self.onmessage=event=>{try{const {channels,rate}=event.data;const result=encodeWav(channels.map(c=>new Float32Array(c)),rate);self.postMessage({result},[result]);}catch(error){self.postMessage({error:error.message});}};
