import { calendarHash } from './google-calendar-store.js';
import { createGoogleCalendarLink, googleCalendarConfigured } from './google-calendar-auth.js';

export function googleCalendarInviteKey(env) {
  return `google-calendar-invite:${env.GOOGLE_CALENDAR_INVITE_REV}:${env.GOOGLE_CLIENT_ID}`;
}
export async function googleCalendarInviteAuthority(env, outbox) {
  return googleCalendarConfigured(env) && !!env.GOOGLE_CALENDAR_INVITE_REV
    && outbox?.owner === String(env.OWNER_WHATSAPP_NUMBER || '').replace(/\D/g,'')
    && outbox?.agent === 'melodi' && !outbox.payload?.artifactJobId && !outbox.payload?.approvalId
    && outbox.message_key === await calendarHash(googleCalendarInviteKey(env));
}
export async function freshGoogleCalendarInviteBody(env) {
  const link = await createGoogleCalendarLink(env,'melodi');
  if (!link.configured) throw new Error('google_calendar_not_configured');
  return `Melodi: Preparé Google Calendar para el equipo. Vincula tu cuenta ${env.GOOGLE_CALENDAR_OWNER_EMAIL || ''} aquí: ${link.url}\nVerás las actividades en «Vetsa · Equipo» y podrás cambiar sus fechas o cancelarlas. El enlace es personal, se usa una vez y vence en 24 horas. Google te mostrará los permisos antes de aceptar.`;
}
