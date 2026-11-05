"""Narrow direct requests, not examples, capability questions or compound work."""
import re
import unicodedata

def application_target(text):
    raw=str(text or '').strip()
    if len(raw)>160 or re.search(r'["“”«»`\r\n:;/\\]',raw):return None
    value=''.join(c for c in unicodedata.normalize('NFKD',raw) if not unicodedata.combining(c)).casefold()
    if re.search(r'\b(?:y|luego|despues|si|cuando|como|ejemplo|podria|puede|sabes|escribe|redacta|crea|modifica|edita|guarda|elimina|borra|instala|factura|inventario|dibuja|haz|completa|traduce|busca|no)\b',value):return None
    value=re.sub(r'^(?:melodi[, ]+)?(?:por favor[, ]+)?(?:puedes |podrias |quiero que |necesito que )?','',value.strip('¿ '))
    found=re.fullmatch(r'(?:abre|abrir|inicia|iniciar|ejecuta|lanza|open|start)\s+(?:(?:el programa|la app|la aplicacion)\s+)?([a-z0-9][a-z0-9 .+_-]{0,65}?)(?:\s+(?:por mi|por favor|ahora|please))?[.!?]*',value)
    if not found:return None
    app=found[1].strip(' .')
    if re.search(r'\b(?:en|para|con|sin|que|del|archivo|documento|script|comando|proyecto|servidor)\b',app):return None
    return app or None

def confirmation(index,app=None):
    name=app[:1].upper()+app[1:] if app else None
    choices=(f'Voy a abrir {name}.',f'Abro {name} ahora.',f'Enseguida abro {name}.') if name else ('Me pongo con ello.','Voy con eso.','Ahora lo hago.','Dame un momento, voy con ello.')
    return choices[index%len(choices)]

def process_count_query(text):
    raw=str(text or '').strip()
    if len(raw)>160 or re.search(r'["“”«»`\r\n:;/\\]',raw):return False
    value=''.join(c for c in unicodedata.normalize('NFKD',raw) if not unicodedata.combining(c)).casefold().strip('¿ ')
    return bool(re.fullmatch(r'cuantos procesos (?:tengo(?: (?:corriendo|en ejecucion|abiertos))?|hay|estan (?:corriendo|en ejecucion|abiertos))(?: en (?:mi|el|este) (?:pc|ordenador|equipo|computador))?(?: (?:ahora(?: mismo)?|actualmente))?[?!.]*',value))

def diagnostic_question(text):
    raw=str(text or '').strip()
    if len(raw)>500 or re.search(r'["“”«»`\r\n]',raw):return False
    value=''.join(c for c in unicodedata.normalize('NFKD',raw) if not unicodedata.combining(c)).casefold().strip('¿ ')
    return bool(re.match(r'^(?:cuant|que |cual|como |por que |hay |dime |muestrame |puedes (?:decirme|comprobar|consultar))',value) and re.search(r'proces|servici|cpu|memoria|ram\b|bateria|disco|volumen|red\b|conexio|puerto|impresora|procesador|hardware|equipo|ordenador|pc\b|dispositivo',value) and not re.search(r'\b(?:si|ejemplo|supong\w*|hipotet\w*|cierra(?:lo|los|la|las)?|cerrar|mata(?:r|lo|los|la|las)?|apaga(?:r|lo|los|la|las)?|instala(?:r|lo|los|la|las)?|elimina(?:r|lo|los|la|las)?|borra(?:r|lo|los|la|las)?|modifica(?:r|lo|los|la|las)?|deten(?:er|lo|los|la|las)?|reinicia(?:r|lo|los|la|las)?|configura(?:r|lo|los|la|las)?|desactiva(?:r|lo|los|la|las)?|activa(?:r|lo|los|la|las)?|abre)\b',value))


def public_lookup(text):
    if not isinstance(text,str) or len(text)>400 or re.search(r'["“”«»`\r\n:;/\\]',text):
        return False
    value=''.join(c for c in unicodedata.normalize('NFKD',text) if not unicodedata.combining(c)).casefold().strip('¿ ')
    if re.search(r'\b(?:si|cuando|ejemplo|supong\w*|hipotet\w*|no|eso|anterior|encendido|abre|abrir|escribe|redacta|crea|guarda|elimina|borra|instala|envia(?:r|lo|la|los|las)?|publica|organiza|dibuja|traduce|despues|luego)\b',value):
        return False
    value=re.sub(r'^(?:melodi[, ]+)?(?:por favor[, ]+)?(?:puedes |podrias |quiero que |necesito que )?','',value)
    if re.match(r'^(?:busca|buscar|consulta|consultar|comprueba|comprobar|revisa|verifica)\b',value):
        return bool(re.search(r'\b(?:internet|web|google|noticias|clima|tiempo|pronostico)\b',value))
    return bool(re.match(r'^(?:que |cual |como |dime )',value) and re.search(r'\b(?:clima|tiempo|pronostico)\b',value))
