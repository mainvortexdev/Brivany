(() => {
 'use strict';
 window.BrivanyCitations = (container, sources, api) => {
  if (!Array.isArray(sources) || !api?.open_research_source) return;
  const group = document.createElement('div');
  group.className = 'research-citations';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Fuentes de la búsqueda');
  for (const source of sources.slice(0, 4)) {
   if (typeof source?.url !== 'string' || source.url.length > 450) continue;
   let url;
   try {url = new URL(source.url);} catch {continue;}
   if (url.protocol !== 'https:' || url.username || url.password) continue;
   const link = document.createElement('button');
   link.type = 'button';
   link.textContent = (typeof source.title === 'string' && source.title.trim() ? source.title.trim().slice(0, 100) : url.hostname) + ' ↗';
   link.title = url.hostname;
   link.onclick = () => api.open_research_source(source.url).catch(() => {});
   group.append(link);
  }
  if (group.childElementCount) container.append(group);
 };
})();
