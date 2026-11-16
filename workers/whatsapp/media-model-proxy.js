import { WorkerEntrypoint } from 'cloudflare:workers';
import { forwardPublicMediaModel } from './media-model-forwarder.js';

// Named entrypoints can be reached by service bindings, never the assistant's public fetch routes.
export class MediaModels extends WorkerEntrypoint {
  fetch(request) { return forwardPublicMediaModel(request, this.env); }
}
