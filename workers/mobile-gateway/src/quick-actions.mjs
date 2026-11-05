export function applicationTarget(raw){
 if(typeof raw!=='string'||raw.length>160||/["“”«»`\r\n:;/\\]/.test(raw))return null;
 let value=raw.trim().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 if(/\b(?:y|luego|despues|si|cuando|como|ejemplo|podria|puede|sabes|escribe|redacta|crea|modifica|edita|guarda|elimina|borra|instala|factura|inventario|dibuja|haz|completa|traduce|busca|no)\b/.test(value))return null;
 value=value.replace(/^[¿ ]+/,'').replace(/^(?:melodi[, ]+)?(?:por favor[, ]+)?(?:puedes |podrias |quiero que |necesito que )?/,'');
 const match=value.match(/^(?:abre|abrir|inicia|iniciar|ejecuta|lanza|open|start)\s+(?:(?:el programa|la app|la aplicacion)\s+)?([a-z0-9][a-z0-9 .+_-]{0,65}?)(?:\s+(?:por mi|por favor|ahora|please))?[.!?]*$/);
 const name=match?.[1].replace(/^[ .]+|[ .]+$/g,'');
 return name&&!/\b(?:en|para|con|sin|que|del|archivo|documento|script|comando|proyecto|servidor)\b/.test(name)?name:null;
}
export function acknowledgement(seed,app=null,recent=[]){
 const name=app?app[0].toUpperCase()+app.slice(1):null;
 const choices=name?[`Voy a abrir ${name}.`,`Abro ${name} ahora.`,`Enseguida abro ${name}.`]:['Me pongo con ello.','Voy con eso.','Ahora lo hago.','Dame un momento, voy con ello.'];
 const available=choices.filter(value=>!recent.includes(value));const rows=available.length?available:choices;
 const hash=[...String(seed)].reduce((value,c)=>(value*31+c.charCodeAt(0))>>>0,0);return rows[hash%rows.length];
}
export function processCountQuery(raw){
 if(typeof raw!=='string'||raw.length>160||/["“”«»`\r\n:;/\\]/.test(raw))return false;
 const value=raw.trim().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/^[¿ ]+/,'');
 return /^cuantos procesos (?:tengo(?: (?:corriendo|en ejecucion|abiertos))?|hay|estan (?:corriendo|en ejecucion|abiertos))(?: en (?:mi|el|este) (?:pc|ordenador|equipo|computador))?(?: (?:ahora(?: mismo)?|actualmente))?[?!.]*$/.test(value);
}
export function diagnosticQuestion(raw){
 if(typeof raw!=='string'||raw.length>500||/["“”«»`\r\n]/.test(raw))return false;
 const value=raw.trim().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/^[¿ ]+/,'');
 return /^(?:cuant|que |cual|como |por que |hay |dime |muestrame |puedes (?:decirme|comprobar|consultar))/.test(value)&&/proces|servici|cpu|memoria|ram\b|bateria|disco|volumen|red\b|conexio|puerto|impresora|procesador|hardware|equipo|ordenador|pc\b|dispositivo/.test(value)&&! /\b(?:si|ejemplo|supong\w*|hipotet\w*|cierra(?:lo|los|la|las)?|cerrar|mata(?:r|lo|los|la|las)?|apaga(?:r|lo|los|la|las)?|instala(?:r|lo|los|la|las)?|elimina(?:r|lo|los|la|las)?|borra(?:r|lo|los|la|las)?|modifica(?:r|lo|los|la|las)?|deten(?:er|lo|los|la|las)?|reinicia(?:r|lo|los|la|las)?|configura(?:r|lo|los|la|las)?|desactiva(?:r|lo|los|la|las)?|activa(?:r|lo|los|la|las)?|abre)\b/.test(value);
}
export function contextualAcknowledgement(seed,question,recent=[]){
 const value=String(question).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const subject=/proces/.test(value)?'los procesos':/servici/.test(value)?'los servicios':/ram|memoria/.test(value)?'la memoria':/disco|volumen/.test(value)?'el disco':/red|conexion|puerto/.test(value)?'la red':/impresora/.test(value)?'la impresora':'tu equipo';
 const phrases=[`Dame un segundo, reviso ${subject}.`,`Un momento, voy a comprobar ${subject}.`,`Ahora miro ${subject} y te cuento.`];
 const available=phrases.filter(p=>!recent.includes(p));const rows=available.length?available:phrases;
 const hash=[...String(seed)].reduce((v,c)=>(v*31+c.charCodeAt(0))>>>0,0);return rows[hash%rows.length];
}

export function publicLookup(raw){
 if(typeof raw!=='string'||raw.length>400||/["“”«»`\r\n:;/\\]/.test(raw))return false;
 let value=raw.trim().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/^[¿ ]+/,'');
 if(/\b(?:si|cuando|ejemplo|supong\w*|hipotet\w*|no|eso|anterior|encendido|abre|abrir|escribe|redacta|crea|guarda|elimina|borra|instala|envia(?:r|lo|la|los|las)?|publica|organiza|dibuja|traduce|despues|luego)\b/.test(value))return false;
 value=value.replace(/^(?:melodi[, ]+)?(?:por favor[, ]+)?(?:puedes |podrias |quiero que |necesito que )?/,'');
 if(/^(?:busca|buscar|consulta|consultar|comprueba|comprobar|revisa|verifica)\b/.test(value))return /\b(?:internet|web|google|noticias|clima|tiempo|pronostico)\b/.test(value);
 return /^(?:que |cual |como |dime )/.test(value)&&/\b(?:clima|tiempo|pronostico)\b/.test(value);
}
