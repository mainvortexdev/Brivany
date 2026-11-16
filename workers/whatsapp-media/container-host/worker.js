import { Container, getContainer } from '@cloudflare/containers';
import { WorkerEntrypoint } from 'cloudflare:workers';
import { forwardProcessorRequest } from './private-forwarder.js';

export class PublicMediaProcessor extends Container {
  defaultPort = 8080;
  sleepAfter = '5m';
  enableInternet = true;
  envVars = { MEDIA_PROCESSOR_TOKEN: this.env.MEDIA_PROCESSOR_TOKEN };
}

export class ProcessorBackend extends WorkerEntrypoint {
  fetch(request) {
    // One processor slot per owner deployment; durable jobs and R2 artifacts live outside its ephemeral disk.
    const container = { fetch: forwarded => getContainer(this.env.PUBLIC_MEDIA_PROCESSOR, 'vetsa-media-slot-1').fetch(forwarded) };
    return forwardProcessorRequest(request, this.env, container);
  }
}

export default {
  fetch(request) {
    return request.method === 'GET' && new URL(request.url).pathname === '/health'
      ? Response.json({ status: 'ok', processorVerified: false, access: 'private_service_binding' })
      : Response.json({ error: 'not_found' }, { status: 404 });
  },
};
