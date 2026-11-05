/* Shared, local SVG controls. No font glyphs or external icon requests. */
(() => {
 const paths={
  workspace:'<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01"/>',
  panelLeft:'<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16m5-11-3 3 3 3"/>',
  panelRight:'<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16m3-11 3 3-3 3"/>',
  compose:'<path d="M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6M15 5l4 4M10 14l1-4 7-7a2.1 2.1 0 0 1 3 3l-7 7-4 1Z"/>',
  video:'<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3Z"/>',
  image:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  stop:'<rect x="6" y="6" width="12" height="12" rx="2"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  minimize:'<path d="M5 12h14"/>',
  maximize:'<rect x="5" y="5" width="14" height="14" rx="1.5"/>',
  restore:'<path d="M8 5V3h13v13h-2"/><rect x="3" y="8" width="13" height="13" rx="1.5"/>'
 };
 const svg=name=>'<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'+(paths[name]||'')+'</svg>';
 window.BrivanyIcons={svg,set:(element,name)=>{if(element)element.innerHTML=svg(name);}};
 document.querySelectorAll('[data-icon]').forEach(element=>window.BrivanyIcons.set(element,element.dataset.icon));
})();
