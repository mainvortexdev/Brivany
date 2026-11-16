// Transport labels are metadata, not part of a conversational message. Only
// remove a label at the start; names in documents, quotations and replies stay.
const LEADING_AGENT_LABEL = /^(?:\*{1,2})?(?:Melodi|Melodi|Melodi|Melodi|Melodi)(?:\*{1,2})?\s*:(?:\*{1,2})?\s*/i;

export function naturalAgentMessage(value) {
  let message = String(value ?? '').trim();
  for (let i = 0; i < 12 && LEADING_AGENT_LABEL.test(message); i++) message = message.replace(LEADING_AGENT_LABEL, '').trim();
  return message;
}
