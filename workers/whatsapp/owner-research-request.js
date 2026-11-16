import { documentArtifactRequest } from './document-workflow.js';
import { explicitlyChosenAgent } from './melodi-team-commands.js';
import { stripAgentAddress } from './melodi-address.js';

const AGENTS = ['melodi'];
const clean = (value, limit = 6000) => String(value ?? '').replace(/\u0000/g, '').trim().slice(0, limit);
const fold = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function suppliedContentDirective(raw) {
  const unaddressed = stripAgentAddress(clean(raw, 14000)
    .replace(/^(?:(?:no|perd[oó]n|corrijo)[, :]+)?(?:esto|eso|esta tarea|este trabajo|este documento|este encargo)\s+(?:es|era)\s+para\s+(?:la agente\s+)?(?:melodi)\s*[.:,]\s*/i, ''));
  if (documentArtifactRequest(unaddressed)) return true;
  const first = fold(unaddressed.split(/\r?\n/, 1)[0]).replace(/^(?:por favor[, :]*)?(?:quiero|necesito)\s+(?:que\s+)?(?:me\s+)?/, '');
  if (/^(?:crea\w*|crees|genera\w*|generes|prepara\w*|prepares|haz\w*|convierte\w*|exporta\w*)\b/.test(first)
    && /\b(?:pdf|docx|txt|documento)\b/.test(first)) return true;
  return /^(?:por favor[, :]*)?(?:guarda\w*|conserva\w*|archiva\w*|copia\w*|transcribe\w*)\b/.test(first)
    && /\b(?:esto|texto|contenido|prompt|siguiente|documento)\b/.test(first);
}

/** Only the owner's top-level words can authorize work. Quoted content is data. */
export function ownerResearchActionText(raw) {
  if (suppliedContentDirective(raw)) return '';
  return clean(raw, 14000)
    .replace(/```[\s\S]*?(?:```|$)/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/^\s*>.*$/gm, ' ')
    .replace(/"[^"\n]*"|'[^'\n]*'|“[^”]*”|«[^»]*»/g, ' ')
    .replace(/\b(?:cuerpo(?:\s+del\s+correo)?|contenido\s+(?:del\s+correo|a\s+enviar)|texto\s+a\s+enviar)\s*:[\s\S]*$/i, ' ');
}

export function publicInstagramResearchUrl(value) {
  try {
    const text = clean(value, 2048).replace(/[),.;!?]+$/, '');
    const url = new URL(text);
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || !['instagram.com', 'www.instagram.com', 'm.instagram.com'].includes(url.hostname.toLowerCase())) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    const post = ['p', 'reel', 'reels', 'tv'].includes(parts[0]) && /^[A-Za-z0-9_-]+$/.test(parts[1] || '') && parts.length === 2;
    const profile = parts.length === 1 && /^[A-Za-z0-9_.]+$/.test(parts[0])
      && !['accounts', 'direct', 'explore', 'stories', 'about', 'legal', 'developer'].includes(parts[0]);
    if (!post && !profile) return null;
    url.hash = '';
    return { sourceUrl: url.href, scope: post ? 'single_post' : 'profile', postId: post ? parts[1] : null };
  } catch { return null; }
}

/** A research deliverable remains research even when its requested transport is email. */
export function parseOwnerResearchRequest(raw, context = {}) {
  const brief = clean(raw, 12000);
  if (suppliedContentDirective(brief)) return null;
  const actionText = ownerResearchActionText(brief);
  const text = fold(actionText);
  if (!text || /\b(?:cada\s+(?:semana|lunes|martes|miercoles|jueves|viernes|sabado|domingo)|semanalmente)\b/.test(text)) return null;
  const research = /\b(?:investig\w*|analiz\w*|estudi\w*|revis\w*|averigu\w*)\b/.test(text);
  const deliver = /\b(?:envi\w*|manda\w*|entrega\w*|recibir|reciba|quiero|necesito|explica\w*|dime)\b/.test(text);
  const subject = /\b(?:formatos?|tipos?\s+de\s+(?:contenido|publicaci\w*)|como\s+(?:hacer|crear|realizar|replicar)|paso\s+a\s+paso|tutorial\w*)\b/.test(text);
  if ((!research && !(deliver && subject))
    || /\b(?:no|nunca)\s+(?:quiero\s+que\s+)?(?:investig\w*|analiz\w*|revis\w*|estudi\w*)\b/.test(text)) return null;
  const extracted = (brief.match(/https:\/\/[^\s<>"'“”«»`]+/gi) || []).map(publicInstagramResearchUrl).filter(Boolean);
  const referenced = /\b(?:esta|esa|este|ese|la)\s+(?:publicacion|post|reel|perfil|cuenta|enlace)\b/.test(text);
  const contextLinks = referenced ? (Array.isArray(context.links) ? context.links : []).map(item =>
    publicInstagramResearchUrl(typeof item === 'string' ? item : item?.url)).filter(Boolean) : [];
  const candidates = extracted.length ? extracted : contextLinks;
  const distinct = [...new Map(candidates.map(item => [`${item.scope}:${item.postId || new URL(item.sourceUrl).pathname}`, item])).values()];
  if (distinct.length !== 1) return null;
  const source = distinct[0];
  const agent = explicitlyChosenAgent(actionText) || (AGENTS.includes(context.agent) ? context.agent : null);
  if (!agent) return null;
  // A new email recipient is a separate explicit action. This workflow sends
  // only to the owner; it never turns a quoted or model-invented address into a grant.
  const explicitEmails = actionText.match(/[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
  if (explicitEmails.some(address => address.toLowerCase() !== String(context.ownerEmail || '').toLowerCase())) return null;
  const email = /\b(?:correo|email|e-mail|mail)\b/.test(text) && !/\b(?:no|nunca)\s+(?:lo\s+)?(?:envi\w*\s+)?(?:por\s+)?(?:correo|email|e-mail|mail)\b/.test(text);
  return {
    agent, ...source, brief, recipient: 'owner', channel: email ? 'email' : 'auto', format: 'pdf',
    includeTutorial: /\b(?:como|paso\s+a\s+paso|tutorial\w*|instrucciones|explica\w*)\b/.test(text),
    includeAllFormats: /\b(?:todos?\s+(?:los\s+)?formatos|cada\s+formato)\b/.test(text),
    origin: 'owner_request',
  };
}

export function applyResearchDeliveryIntent(interpreted, raw, agent, context = {}) {
  const request = parseOwnerResearchRequest(raw, { ...context, agent });
  if (!request) return interpreted;
  const result = { ...interpreted, intent: 'owner_research_report', agent: request.agent, researchRequest: request,
    format: 'pdf', deliverByEmail: request.channel === 'email', requiresAttachment: true,
    title: request.scope === 'single_post' ? 'Formatos e instrucciones de la publicación' : 'Informe de formatos del perfil público' };
  // The selected specialist owns both research and its delivery. A generic
  // email classification must not bring its invented body/recipient along.
  for (const key of ['emailBody', 'emailSubject', 'emailTo', 'emailFrom', 'contactName', 'email_body', 'email_subject', 'email_to', 'email_from']) delete result[key];
  return result;
}
