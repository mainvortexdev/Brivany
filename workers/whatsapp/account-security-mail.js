import {promotionMailMessage} from './promotion-mail-template.js';
import {WorkerEntrypoint} from 'cloudflare:workers';

const clean=value=>String(value??'').replace(/[\x00-\x1f\x7f]/g,' ').slice(0,300);
const escape=value=>clean(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function accountSecurityMessage(data){
  if(!data||!/^\S+@\S+\.\S+$/.test(data.email)||data.email.length>254)throw Error('invalid_recipient');
  const kinds={verify:'Verifica tu correo de Vetsa',password:'Verifica el cambio de contraseña',loginCode:'Verifica tu inicio de sesión',login:'Nuevo inicio de sesión en Vetsa',passwordChanged:'Tu contraseña de Vetsa ha cambiado'};
  if(!Object.hasOwn(kinds,data.kind))throw Error('invalid_template');
  const needsCode=['verify','password','loginCode'].includes(data.kind);
  if(needsCode&&!/^\d{8}$/.test(data.code))throw Error('invalid_code');
  const when=new Date(data.at);if(!Number.isFinite(when.getTime()))throw Error('invalid_time');
  const lines=[kinds[data.kind]+'.',needsCode?'Tu código es: '+data.code+'. Caduca en 10 minutos. No lo compartas.':'Fecha y hora (UTC): '+when.toISOString(),
    'Dispositivo/navegador: '+clean(data.device||'No identificado')+'.',
    needsCode?'Si no solicitaste esta acción, ignora este correo.':'Si no reconoces esta actividad, abre https://cognira.vetsa.es/account#security y contacta con security@vetsa.es.',
    'Vetsa Intelligence · https://vetsa.es'];
  return {sender:{email:'noreply@vetsa.es',name:'Vetsa · Seguridad'},replyTo:{email:'security@vetsa.es',name:'Cipher · Vetsa'},to:[{email:data.email}],subject:kinds[data.kind],textContent:lines.join('\n\n'),htmlContent:'<div style="font:16px/1.6 Arial,sans-serif;max-width:600px">'+lines.map(t=>'<p>'+escape(t)+'</p>').join('')+'</div>',tags:['vetsa-account-security']};
}
// Service-binding RPC only: this entrypoint has no public HTTP handler and
// accepts fixed account-security templates, never arbitrary email content.
export class AccountSecurityMail extends WorkerEntrypoint {
  async status(){
    if(!this.env.BREVO_API_KEY)return {available:false};
    const r=await fetch('https://api.brevo.com/v3/senders/domains/vetsa.es',{headers:{'api-key':this.env.BREVO_API_KEY,accept:'application/json'},signal:AbortSignal.timeout(10000)});
    const d=await r.json().catch(()=>({}));
    const ready=r.ok&&d.verified===true&&d.authenticated===true;
    if(!ready)return {available:false};
    const listing=await fetch('https://api.brevo.com/v3/senders?domain=vetsa.es',{headers:{'api-key':this.env.BREVO_API_KEY,accept:'application/json'},signal:AbortSignal.timeout(10000)}),senders=await listing.json().catch(()=>({}));
    return {available:true,senderReady:senders.senders?.some(s=>s.email==='noreply@vetsa.es'&&s.active===true)===true};
  }
  async configure(){
    const status=await this.status();if(!status.available)throw Error('security_domain_not_authenticated');
    if(status.senderReady)return status;
    const r=await fetch('https://api.brevo.com/v3/senders',{method:'POST',headers:{'api-key':this.env.BREVO_API_KEY,'content-type':'application/json',accept:'application/json'},body:JSON.stringify({email:'noreply@vetsa.es',name:'Vetsa · Seguridad'}),signal:AbortSignal.timeout(10000)});
    if(!r.ok)throw Error('security_sender_configuration_failed');return this.status();
  }
  async sendNewsletter(data){
    const payload=promotionMailMessage(data);
    if(!this.env.BREVO_API_KEY)throw Error('newsletter_unavailable');
    const listing=await fetch('https://api.brevo.com/v3/senders?domain=vetsa.es',{headers:{'api-key':this.env.BREVO_API_KEY,accept:'application/json'},signal:AbortSignal.timeout(10000)});
    const senders=await listing.json();
    if(!listing.ok)throw Error('newsletter_sender_unavailable');
    if(!senders.senders?.some(s=>s.email==='notificaciones@vetsa.es'&&s.active===true)){
      const status=await this.status();if(!status.available)throw Error('newsletter_domain_not_authenticated');
      const created=await fetch('https://api.brevo.com/v3/senders',{method:'POST',headers:{'api-key':this.env.BREVO_API_KEY,'content-type':'application/json'},body:JSON.stringify(payload.sender),signal:AbortSignal.timeout(10000)});
      if(!created.ok)throw Error('newsletter_sender_unavailable');
    }
    const response=await fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'api-key':this.env.BREVO_API_KEY,'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});
    const result=await response.json();if(!response.ok||typeof result.messageId!=='string')throw Error('newsletter_delivery_unconfirmed');
    return {accepted:true};
  }
  async send(data){
    const payload=accountSecurityMessage(data);
    if(!this.env.BREVO_API_KEY)throw Error('security_mail_unavailable');
    const r=await fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'api-key':this.env.BREVO_API_KEY,'content-type':'application/json',accept:'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});
    const result=await r.json().catch(()=>({}));
    if(!r.ok||typeof result.messageId!=='string')throw Error('security_mail_delivery_failed');
    return {accepted:true};
  }
}
