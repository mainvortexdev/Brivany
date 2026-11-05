"""Literal, local Regedit navigation only. No registry API access or value edits."""
import re
from .policy import TerminalError

HIVES={
    'HKLM':'HKEY_LOCAL_MACHINE','HKCU':'HKEY_CURRENT_USER','HKCR':'HKEY_CLASSES_ROOT',
    'HKU':'HKEY_USERS','HKCC':'HKEY_CURRENT_CONFIG',
}
HIVES.update({value:value for value in tuple(HIVES.values())})
ROOT_PATTERN='(?:'+ '|'.join(sorted(map(re.escape,HIVES),key=len,reverse=True))+')'
PATH_PATTERN=re.compile(r'(?<![A-Za-z0-9_\\])(?:(?:Computer|Equipo)\\)?'+ROOT_PATTERN+r'(?:\\[^\r\n\"\'«»“”]*)?',re.I|re.ASCII)
QUOTED=re.compile(r'"([^"\r\n]+)"|\'([^\'\r\n]+)\'|«([^»\r\n]+)»|“([^”\r\n]+)”')
EDIT=re.compile(r'\b(?:cambia|cambies|modifica|modifiques|edita|edites|crea|crees|borra|borres|elimina|elimines|importa|importes|restaura|restaures)\b|\breg\s+(?:add|delete|import|restore|load|unload)\b',re.I)
TRAILER=re.compile(r'\s+(?:en|con)\s+(?:el\s+)?(?:regedit|editor\s+del\s+registro)(?:\s*[,.;]\s*(?:solo\s+(?:lectura|para\s+observar)|sin\s+cambiar\s+nada))?[. ]*$',re.I)


def canonical_route(value):
    if not isinstance(value,str) or not 1<=len(value)<=1024 or any(ord(c)<32 or ord(c)==127 for c in value):raise TerminalError('Indica una ruta local literal del registro.')
    value=value.strip()
    for left,right in [('"','"'),("'","'"),('«','»'),('“','”')]:
        if value.startswith(left) and value.endswith(right):value=value[1:-1];break
    if value.lower().startswith(('computer\\','equipo\\')):value=value.split('\\',1)[1]
    parts=value.split('\\');root=HIVES.get(parts[0].upper())
    if not root or len(parts)>128 or any(not part or len(part)>255 for part in parts[1:]):raise TerminalError('La ruta debe empezar por una raíz local de Regedit, sin segmentos vacíos.')
    return '\\'.join([root,*parts[1:]])


def source_routes(request):
    if not isinstance(request,str):return []
    values=[];quoted_spans=[]
    for match in QUOTED.finditer(request):
        quoted_spans.append(match.span())
        try:values.append(canonical_route(next(group for group in match.groups() if group is not None)))
        except TerminalError:pass
    for match in PATH_PATTERN.finditer(request):
        if any(start<=match.start()<end for start,end in quoted_spans):continue
        candidate=TRAILER.sub('',match.group()).rstrip(' .')
        try:values.append(canonical_route(candidate))
        except TerminalError:pass
    return list(dict.fromkeys(values))


def authorize_route(request,proposed):
    if not isinstance(request,str) or '?' in request or re.search(r'\b(?:ejemplo|hipot[eé]tic\w*|si\s+(?:te\s+)?(?:digo|pido|dijera|pidiera)|no\s+(?:lo\s+)?abr\w*|no\s+muestres)\b',request,re.I):raise TerminalError('Abrir Regedit necesita una petición directa del usuario.')
    if not re.search(r'\b(?:abre|abrir|muestra|ubica|navega|ve)\b',request,re.I) or EDIT.search(request):raise TerminalError('Melodi sólo puede abrir una ruta; los cambios se explican sin ejecutarlos.','registry_forbidden')
    if request.strip()[:1] in {'"',"'",'«','“'}:raise TerminalError('Una instrucción citada no autoriza abrir Regedit.')
    route=canonical_route(proposed)
    if route not in source_routes(request):raise TerminalError('La ruta no coincide literalmente con la petición original.')
    return route
