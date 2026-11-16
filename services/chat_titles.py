"""Private, local chat titles. No model call, network or stored plaintext."""
import re

TITLE_VERSION=2

def clean_title(text):
    text=re.sub(r'\s+',' ',text or '').strip(' \n\r\t#>*«»"“”')
    words=text.split()
    while words and words[-1].casefold() in {'de','del','el','la','los','las','un','una','y','para','con'}:words.pop()
    text=' '.join(words[:9]).strip(' .,:;!?¿¡')
    if len(text)>62:text=text[:62].rsplit(' ',1)[0]
    return text[:1].upper()+text[1:] if text else 'Nueva conversación'

def automatic_title(value):
    messages=[m.get('text','') for m in value.get('messages',[]) if m.get('role')=='user']
    for raw in messages:
        text=re.sub(r'\s+',' ',raw).strip()
        # Introductions can be much longer than the actual subject. Start at
        # the first requested action rather than truncating the introduction.
        action=re.search(r'\b(?:crea(?:me)?|genera|diseña|haz(?:me)?|redacta|escribe|resume|abre|cierra|busca|explica|ayúdame|necesito|quiero)\b',text,re.I)
        if action:text=text[action.start():]
        else:text=re.sub(r'^(?:hola|oye|hey)[,! ]*(?:melodi[,: ]*)?|^melodi[,: ]*','',text,flags=re.I)
        if not text or re.fullmatch(r'(?:hola|gracias|s[ií]|no|uy)[.!? ]*',text,re.I):continue
        lower=text.casefold()
        if re.search(r'\bvideo|tr[aá]iler|animaci[oó]n',lower) and re.search(r'dentista|dental|limpieza (?:bucal|vocal)|dr\.? esteban',lower):return 'Video de llamada al dentista'
        text=re.split(r'[\n.!?]|\s+(?:conserva|usa|sustituye|entrega|añade|agrega)\b',text,maxsplit=1,flags=re.I)[0]
        text=re.sub(r'^(?:por favor[, ]*|(?:puedes|podrías)\s+)?(?:crea(?:me)?|genera|haz(?:me)?|diseña|redacta|escribe|necesito|quiero)\s+(?:(?:que\s+)?(?:crees|hagas)\s+)?(?:un|una|el|la)\s+','',text,flags=re.I)
        return clean_title(text)
    return 'Nueva conversación'

def title_fields(value):
    title=value.get('title');mode=value.get('title_mode')
    if title is not None and (not isinstance(title,str) or len(title)>80 or any(ord(c)<32 for c in title)):raise ValueError('Nombre de conversación no válido.')
    if mode not in {None,'auto','manual'}:raise ValueError('Modo de título no válido.')
    first=next((m.get('text','') for m in value.get('messages',[]) if m.get('role')=='user'),'')
    manual=bool(title and title.strip() and (mode=='manual' or mode is None and title!=first[:80]))
    return {'title':title.strip() if manual else automatic_title(value),'title_mode':'manual' if manual else 'auto'}
