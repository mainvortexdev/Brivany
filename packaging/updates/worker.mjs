// The feed is public metadata. Release packages are uploaded only on publication.
// Large packages are streamed from immutable <=20 MiB assets, without buffering.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, {status: 405, headers: {Allow: 'GET, HEAD'}});
    const headers = {'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'", 'Referrer-Policy': 'no-referrer'};
    const asset = path => env.ASSETS.fetch(new Request(new URL(path, url.origin)));
    if (url.pathname === '/windows/stable.json') {
      const response = await asset('/windows/stable.json');
      return new Response(request.method === 'HEAD' ? null : response.body, {status: response.status, headers: {...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store'}});
    }
    const catalogResponse = await asset('/catalog.json');
    if (!catalogResponse.ok) return new Response(null, {status: 503});
    const catalog = await catalogResponse.json(); // Generated bounded local metadata.
    const file = Object.hasOwn(catalog, url.pathname) ? catalog[url.pathname] : null;
    if (!file) return new Response(null, {status: 404, headers});
    const responseHeaders = {...headers, 'Content-Type': 'application/octet-stream', 'Content-Length': String(file.size), 'Content-Disposition': `attachment; filename="${file.name}"`, 'ETag': `"${file.sha256}"`, 'Cache-Control': 'public, max-age=86400, immutable'};
    if (request.method === 'HEAD') return new Response(null, {headers: responseHeaders});
    let index = 0, reader = null;
    const body = new ReadableStream({
      async pull(controller) {
        try {
          while (true) {
            if (!reader) {
              if (index === file.parts.length) { controller.close(); return; }
              const part = await asset(file.parts[index++]);
              if (!part.ok || !part.body) throw new Error('Release asset unavailable');
              reader = part.body.getReader();
            }
            const result = await reader.read();
            if (result.done) { reader.releaseLock(); reader = null; continue; }
            controller.enqueue(result.value); return;
          }
        } catch (error) { console.error(JSON.stringify({event: 'release_stream_failed', name: file.name})); controller.error(error); }
      },
      async cancel(reason) { if (reader) await reader.cancel(reason); }
    });
    return new Response(body, {headers: responseHeaders});
  }
};
