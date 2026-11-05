export function encodeWav(channels,sampleRate){
 if(!Array.isArray(channels)||channels.length<1||channels.length>8||!Number.isInteger(sampleRate)||sampleRate<8000||sampleRate>192000)throw Error('Formato de audio no admitido.');
 const length=channels[0]?.length;if(!Number.isInteger(length)||length<1||length>sampleRate*300||channels.some(c=>!(c instanceof Float32Array)||c.length!==length))throw Error('El audio debe durar hasta cinco minutos.');
 const size=length*channels.length*2;if(size>256*1024*1024)throw Error('El audio decodificado es demasiado grande.');
 const result=new ArrayBuffer(44+size),view=new DataView(result),write=(at,text)=>{for(let i=0;i<text.length;i++)view.setUint8(at+i,text.charCodeAt(i));};
 write(0,'RIFF');view.setUint32(4,36+size,true);write(8,'WAVE');write(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,channels.length,true);view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*channels.length*2,true);view.setUint16(32,channels.length*2,true);view.setUint16(34,16,true);write(36,'data');view.setUint32(40,size,true);
 let offset=44;for(let frame=0;frame<length;frame++)for(const channel of channels){const value=Math.max(-1,Math.min(1,Number.isFinite(channel[frame])?channel[frame]:0));view.setInt16(offset,Math.round(value*(value<0?32768:32767)),true);offset+=2;}
 return result;
}
