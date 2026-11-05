"""Read a small number of cited public pages as untrusted evidence."""
import ipaddress
import re
import socket
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit
from urllib.request import Request, build_opener

from packages.providers.live_voice import NoRedirect
from services.support.documentation import Page
from .research_delivery import clean_sources


def read_cited_page(source, question, cancelled, charge):
    original=source['url']
    url=original
    opener=build_opener(NoRedirect())
    for hop in range(4):
        if cancelled.is_set():
            raise ValueError('Tarea cancelada.')
        valid=clean_sources([{'url':url}])
        if not valid:
            return None
        host=urlsplit(url).hostname
        try:
            addresses=socket.getaddrinfo(host,443,type=socket.SOCK_STREAM)
            if not addresses or any(not ipaddress.ip_address(row[4][0]).is_global for row in addresses):
                return None
            charge()
            reply=opener.open(Request(url,headers={
                'User-Agent':'Brivany/0.1 (+https://brivany.example)',
                'Accept':'text/html,text/plain','Accept-Encoding':'identity'
            }),timeout=10)
        except HTTPError as error:
            redirect=urljoin(url,error.headers.get('Location',''))
            status=error.code
            error.close()
            if status in {301,302,303,307,308} and hop<3:
                url=redirect
                continue
            return None
        except (OSError,URLError,ValueError):
            return None
        try:
            with reply:
                if reply.headers.get_content_type() not in {'text/html','text/plain','application/xhtml+xml'}:
                    return None
                raw=reply.read(350001)
                if cancelled.is_set():
                    raise ValueError('Tarea cancelada.')
                if len(raw)>350000:
                    return None
                parser=Page()
                parser.feed(raw.decode(reply.headers.get_content_charset() or 'utf-8',errors='replace'))
        except (OSError,ValueError,LookupError):
            return None
        terms={word.casefold() for word in re.findall(r'\w+',question) if len(word)>3}
        lines=parser.text
        ranked=sorted(range(len(lines)),key=lambda index:-sum(word in lines[index].casefold() for word in terms))
        chosen=set()
        for index in ranked[:12]:
            chosen.update(range(max(0,index-2),min(len(lines),index+5)))
        excerpt='\n'.join(lines[index] for index in sorted(chosen))[:4500].strip()
        return {'url':original,'final_url':url,'snippet':excerpt} if excerpt else None
    return None
