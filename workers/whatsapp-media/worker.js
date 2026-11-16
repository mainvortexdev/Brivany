import { WorkerEntrypoint } from 'cloudflare:workers';
import { handleMediaRequest, mediaHealth, processMediaQueue } from './operations.js';

// This entrypoint has no public route. Callers must use a service binding to MediaBackend.
export class MediaBackend extends WorkerEntrypoint {
  fetch(request) { return handleMediaRequest(request, this.env); }
}

export default {
  fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') return mediaHealth(env);
    return Response.json({ error: 'not_found' }, { status: 404 });
  },
  queue(batch, env) { return processMediaQueue(batch, env); },
};
