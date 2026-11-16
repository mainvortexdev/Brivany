// Explicit delegation must not be reinterpreted as cloud image generation.
export function desktopDrawingRequest(message) {
  const text=String(message||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const delegated=/^(?:por favor[, ]*)?(?:(?:dile|pidele|ordena) a melodi que |melodi[, ]+)(?:dibuj(?:a|e|es)|pint(?:a|e|es)|ilustr(?:a|e|es))\b/.test(text);
  const paint=/^(?:por favor[, ]*)?(?:dibuja|pinta|ilustra)\b/.test(text)&&/\bpaint\b/.test(text);
  if(!delegated&&!paint)return null;
  const returnArtifact=/\b(?:envia\w*|manda\w*|comparte\w*)\b/.test(text);
  return {intent:'stacy_command',agent:'melodi',desktopDrawing:true,returnArtifact,
    stacyInstruction:`Dibuja en Paint siguiendo esta petición del usuario: ${message}`};
}
