/** Meta can deliver several entries, changes and messages in one webhook. */
export function whatsappMessageEnvelopes(payload, expectedPhoneId) {
  const envelopes = [];
  const seen = new Set();
  for (const entry of Array.isArray(payload?.entry) ? payload.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const value = change?.value;
      if (value?.metadata?.phone_number_id !== expectedPhoneId) continue;
      for (const message of Array.isArray(value.messages) ? value.messages : []) {
        if (!message || typeof message.id !== 'string' || !message.id || message.id.length > 500
          || !/^\d{8,15}$/.test(String(message.from || '')) || seen.has(message.id)) continue;
        seen.add(message.id);
        // Queue just this message, not unrelated contacts, statuses or entries.
        envelopes.push({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: {
          metadata: { phone_number_id: expectedPhoneId }, messages: [message],
        } }] }] });
      }
    }
  }
  return envelopes;
}
