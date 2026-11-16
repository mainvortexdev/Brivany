// Node tests exercise application logic; Wrangler validates the real platform import.
import { registerHooks } from 'node:module';
import {readFileSync} from 'node:fs';

registerHooks({
  load(url,context,nextLoad){
    if(/\.(?:png|jpg)$/.test(url))return {format:'module',source:'export default Uint8Array.from(Buffer.from('+JSON.stringify(readFileSync(new URL(url)).toString('base64'))+',"base64"));',shortCircuit:true};
    return nextLoad(url,context);
  },
  resolve(specifier, context, nextResolve) {
    if (specifier === 'cloudflare:workers') {
      return { url: 'data:text/javascript,export class WorkerEntrypoint {}', shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
