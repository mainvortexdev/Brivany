/* Injected only by action.onClicked into the explicitly granted tab. */
import(chrome.runtime.getURL('video-selection.js')).then(module=>module.activateVideoSelection()).catch(()=>{});
