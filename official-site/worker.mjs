import {handleSpotifyOAuth} from './spotify-oauth.mjs';
import {sitePage,sitemap} from './pages.mjs';
import {handleWhatsApp} from './whatsapp.mjs';
export {SpotifyOAuthSession} from './spotify-oauth.mjs';

export default {
  async fetch(request,env) {
    const whatsapp=await handleWhatsApp(request,env);if(whatsapp)return whatsapp;
    const oauth=await handleSpotifyOAuth(request,env);
    if(oauth)return oauth;
    const headers = {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    };
    if (!['GET', 'HEAD'].includes(request.method)) {
      return new Response(null, {status: 405, headers: {...headers, Allow: 'GET, HEAD'}});
    }
    const pathname = new URL(request.url).pathname;
    if(env.ASSETS&&(pathname==='/'||pathname.startsWith('/assets/')||pathname==='/favicon.svg')){
      const assetRequest=pathname==='/'?new Request(new URL('/index.html',request.url),request):request;
      const asset=await env.ASSETS.fetch(assetRequest);
      const resultHeaders=new Headers(asset.headers);
      resultHeaders.set('X-Content-Type-Options','nosniff');
      resultHeaders.set('Referrer-Policy','no-referrer');
      resultHeaders.set('Cache-Control','public, max-age=60');
      resultHeaders.set('Permissions-Policy','camera=(), microphone=(), geolocation=(), display-capture=()');
      resultHeaders.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
      return new Response(request.method==='HEAD'?null:asset.body,{status:asset.status,headers:resultHeaders});
    }
    if (pathname === '/robots.txt') {
      return new Response(request.method === 'HEAD' ? null : 'User-agent: *\nAllow: /\nDisallow: /spotify/\nSitemap: https://brivany.vetsa.es/sitemap.xml\n', {
        headers: {...headers, 'Content-Type': 'text/plain; charset=utf-8'},
      });
    }
    if(pathname==='/sitemap.xml')return new Response(request.method==='HEAD'?null:sitemap,{headers:{...headers,'Content-Type':'application/xml; charset=utf-8'}});
    const aliases={'/privacy':'/privacidad','/privacy-policy':'/privacidad','/terms':'/condiciones','/terms-of-service':'/condiciones','/privacidad/':'/privacidad','/condiciones/':'/condiciones'};
    if(aliases[pathname])return new Response(null,{status:308,headers:{...headers,Location:aliases[pathname]}});
    const html=sitePage(pathname);
    if(html===null)return new Response(request.method==='HEAD'?null:'Página no encontrada',{status:404,headers:{...headers,'Content-Type':'text/plain; charset=utf-8','X-Robots-Tag':'noindex'}});
    return new Response(request.method === 'HEAD' ? null : html, {headers});
  },
};
