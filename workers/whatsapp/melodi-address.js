// Only an address at the start of the owner's message selects a speaker.
// Keep this boundary shared by routing, command parsing and action receipts.
export function agentAddress(value, { includeStacy = false } = {}) {
  const raw = String(value || '').trimStart();
  const members = 'melodi' + (includeStacy ? '|melodi' : '');
  const match = raw.match(new RegExp('^(?:(?:hola|oye)[,!.:\\s]*)?(' + members
    + ')(?:\\s*(?:[,!:?¿¡—–-]+|\\.+(?=\\s|$))\\s*|\\s+|$)', 'i'));
  return match ? { agent: match[1].toLowerCase(), body: raw.slice(match[0].length).trimStart() } : null;
}

export function stripAgentAddress(value, options) {
  return agentAddress(value, options)?.body ?? String(value || '').trimStart();
}
