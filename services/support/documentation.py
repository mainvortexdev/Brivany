"""Official-source discovery and bounded HTML/PDF reading, never instruction execution."""
from html.parser import HTMLParser
from io import BytesIO
import ipaddress
import json
from pathlib import Path
import re
import socket
from urllib.error import HTTPError
from urllib.parse import urlencode,urljoin,urlsplit
from urllib.request import Request,build_opener
from packages.providers.live_voice import NoRedirect

DOMAINS={'microsoft.com','windows.com','apple.com','adobe.com','autodesk.com','blender.org','libreoffice.org','inkscape.org','gimp.org','ffmpeg.org','antigravity.google','dell.com','hp.com','epson.com','epson.com.mx','epson.net','epson.biz','canon.com','brother.com','lenovo.com','intel.com','nvidia.com','amd.com','asus.com','acer.com'}
SOURCES=[
 {'id':'ffmpeg','title':'FFmpeg · manual','url':'https://ffmpeg.org/ffmpeg.html'},
 {'id':'blender','title':'Blender · manual','url':'https://docs.blender.org/manual/en/latest/'},
 {'id':'antigravity','title':'Google Antigravity · documentación','url':'https://antigravity.google/docs/'},
 {'id':'epson-l3250','title':'Epson L3250/L3251 · manual en español','url':'https://files.support.epson.com/docid/cpd6/cpd60186.pdf'},
 {'id':'epson-l3250-drivers','title':'Epson L3250 · controladores oficiales','url':'https://epson.com.mx/Soporte/Impresoras/Impresoras-multifuncionales/Epson-L/Epson-L3250/s/SPT_C11CJ67301'},
 {'id':'dell-optiplex-7040','title':'Dell OptiPlex 7040 · controladores','url':'https://www.dell.com/support/home/en-us/product-support/product/optiplex-7040-desktop/drivers'},
]


def official_url(url):
    if not isinstance(url,str) or len(url)>2048:raise ValueError('URL de documentación inválida.')
    parsed=urlsplit(url);host=parsed.hostname or ''
    if parsed.scheme!='https' or parsed.username or parsed.password or parsed.port not in {None,443} or not any(host==domain or host.endswith('.'+domain) for domain in DOMAINS):raise ValueError('Usa una fuente oficial HTTPS admitida.')
    if re.search(r'(?i)(?:token|password|secret|signature|api_key)=',parsed.query):raise ValueError('No uses enlaces que contengan credenciales.')
    return parsed._replace(fragment='').geturl()


def fetch(url,maximum=32*1024*1024):
    opener=build_opener(NoRedirect())
    for redirect in range(4):
        url=official_url(url);host=urlsplit(url).hostname
        addresses=socket.getaddrinfo(host,443,type=socket.SOCK_STREAM)
        if not addresses or any(not ipaddress.ip_address(v[4][0]).is_global for v in addresses):raise ValueError('La documentación debe servirse desde Internet pública.')
        try:response=opener.open(Request(url,headers={'User-Agent':'Brivany/1.0 official documentation','Accept-Encoding':'identity'}),timeout=25)
        except HTTPError as error:
            if error.code in {301,302,303,307,308} and redirect<3:
                url=urljoin(url,error.headers.get('Location',''));error.close();continue
            error.close();raise ValueError('La fuente oficial no permitió leer el documento.') from None
        with response:
            raw=response.read(maximum+1)
            if len(raw)>maximum:raise ValueError('El documento supera el límite de lectura.')
            return raw,response.headers.get_content_type(),url
    raise ValueError('Demasiadas redirecciones en la documentación.')


class Page(HTMLParser):
    def __init__(self):super().__init__(convert_charrefs=True);self.text=[];self.links=[];self.skip=0;self.anchor=None
    def handle_starttag(self,tag,attrs):
        if tag in {'script','style','noscript'}:self.skip+=1
        if tag=='a':self.anchor={'href':dict(attrs).get('href',''),'title':''}
    def handle_endtag(self,tag):
        if tag in {'script','style','noscript'}:self.skip=max(0,self.skip-1)
        if tag=='a' and self.anchor:self.links.append(self.anchor);self.anchor=None
    def handle_data(self,data):
        if not self.skip and data.strip():
            self.text.append(data.strip())
            if self.anchor:self.anchor['title']+=data.strip()+' '


class Documentation:
    def __init__(self,root,reader=fetch):self.root=Path(root);self.root.mkdir(parents=True,exist_ok=True);self.reader=reader
    def search(self,query):
        if not isinstance(query,str) or not 2<=len(query)<=250:raise ValueError('Indica la aplicación o el tema del manual.')
        generic={'manual','manuales','documentación','documentacion','documentation','guía','guia','controladores','controlador','drivers','driver'}
        words=[w for w in re.findall(r'[\w-]+',query.casefold()) if w not in generic];results=[]
        for source in SOURCES:
            label=(source['id']+' '+source['title']).casefold()
            if any(len(w)>2 and w in label for w in words):results.append(dict(source))
        if any(w in query.casefold() for w in ('windows','word','excel','office','microsoft','driver','controlador','powershell','pnputil')) or not results:
            raw,_,_=self.reader('https://learn.microsoft.com/api/search?'+urlencode({'search':query,'locale':'es-es','$top':6}))
            data=json.loads(raw)
            for item in data.get('results',[]):
                try:url=official_url(item['url'])
                except (ValueError,KeyError):continue
                results.append({'id':'search-'+str(len(results)),'title':str(item.get('title','Documentación'))[:240],'url':url})
        return results[:10]

    def read(self,url,query):
        raw,kind,final=self.reader(official_url(url));pages=[];links=[]
        if raw.startswith(b'%PDF-'):
            from pypdf import PdfReader
            document=PdfReader(BytesIO(raw))
            if document.is_encrypted or len(document.pages)>600:raise ValueError('El PDF está cifrado o supera el límite de páginas.')
            terms=[w for w in re.findall(r'\w+',query.casefold()) if len(w)>3 and w not in {'como','para','desde','manual','documentación','documentacion','sobre','quiero'}]
            candidates=[]
            for number,page in enumerate(document.pages,1):
                text=page.extract_text() or '';score=sum(text.casefold().count(w) for w in terms)
                candidates.append((score,number,text))
            for _,number,text in sorted(candidates,key=lambda v:(-v[0],v[1]))[:6]:
                if text.strip():pages.append({'page':number,'text':text[:6000]})
            if not pages:raise ValueError('El manual no tiene texto extraíble; se necesita OCR para leer sus páginas.')
            total=len(document.pages)
        else:
            if kind not in {'text/html','text/plain','application/xhtml+xml'}:raise ValueError('La fuente no es un manual HTML o PDF.')
            parser=Page();parser.feed(raw.decode('utf-8',errors='replace'));text='\n'.join(parser.text)
            terms=[w for w in re.findall(r'\w+',query.casefold()) if len(w)>3]
            paragraphs=text.splitlines();ranked=sorted(enumerate(paragraphs),key=lambda v:-sum(v[1].casefold().count(w) for w in terms))
            chosen=set()
            for i,_ in ranked[:16]:chosen.update(range(max(0,i-1),min(len(paragraphs),i+3)))
            pages=[{'page':1,'text':'\n'.join(paragraphs[i] for i in sorted(chosen))[:20000]}];total=None
            for link in parser.links:
                try:target=official_url(urljoin(final,link['href']))
                except ValueError:continue
                title=link['title'].strip()
                if title and any(w in (title+' '+target).casefold() for w in terms):links.append({'title':title[:180],'url':target})
        return {'url':final,'pages':pages,'total_pages':total,'related_links':links[:12],'read':True,'content_is_untrusted_data':True,'images_read':False}
