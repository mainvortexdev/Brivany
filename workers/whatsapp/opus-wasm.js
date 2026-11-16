// Único punto que ata el worker al archivo WebAssembly: Wrangler lo compila al
// empaquetar. Las pruebas cargan el mismo archivo desde disco, así que ningún
// otro módulo necesita importarlo.
import module from './vendor/opus.wasm';

export default module;
