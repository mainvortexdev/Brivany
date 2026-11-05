"""Documented knowledge is distinct from permission and execution evidence."""
import base64
import hashlib
import json
from pathlib import Path
from urllib.request import Request,urlopen
from .policy import TerminalError

DATA=Path(__file__).resolve().parent/'data'


class CommandCatalog:
    def __init__(self):
        self.items={}
        for name in ('windows','shortcuts','macos'):
            for row in json.loads((DATA/(name+'.json')).read_text(encoding='utf-8')):self.items[row['id']]=row
    def search(self,query,limit=12):
        words=query.casefold().split()
        rows=[row for row in self.items.values() if all(word in ' '.join(str(v) for v in row.values()).casefold() for word in words)]
        return rows[:min(50,max(1,limit))]
    def documentation(self,identifier,cache):
        row=self.items.get(identifier)
        if not row:raise TerminalError('Comando no encontrado.')
        if not row.get('git_blob'):return {'entry':row,'source':row['source'],'content':None,'verified_execution':False}
        cache=Path(cache);cache.mkdir(parents=True,exist_ok=True);path=cache/(row['git_blob']+'.md')
        if not path.exists():
            url='https://api.github.com/repos/MicrosoftDocs/windows-powershell-docs/git/blobs/'+row['git_blob']
            with urlopen(Request(url,headers={'User-Agent':'Brivany-command-documentation'}),timeout=15) as response:value=json.load(response)
            raw=base64.b64decode(value['content']);digest=hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
            if digest!=row['git_blob']:raise TerminalError('La documentación no coincide con su referencia.')
            path.write_bytes(raw)
        return {'entry':row,'content':path.read_text(encoding='utf-8')[:60000],'source':row['source'],'verified_execution':False,'content_is_untrusted_data':True}
