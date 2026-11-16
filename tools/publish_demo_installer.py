"""Upload the audited private installer to first-party R2 in bounded parts.

Uses a protected operator profile; neither provider keys nor admin credentials
are printed. The resulting temporary download link is for the invited team.
"""
import argparse
import hashlib
import json
from pathlib import Path
import secrets
import time
from urllib.request import Request,build_opener
from services.google_oauth import WindowsDPAPIProtector
from services.brivany_account import NoRedirect
from tools.setup_demo_account import operations,call,FOLDER,ORIGIN

def digest(file):
    h=hashlib.sha256()
    with file.open('rb') as source:
        while raw:=source.read(1024*1024):h.update(raw)
    return h.hexdigest()

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('installer',type=Path);args=parser.parse_args();file=args.installer.resolve();ops=operations();proof=file.parent/'private-audit.json'
    audit=json.loads(proof.read_text(encoding='utf-8'));sha=digest(file)
    if audit.get('installer_sha256')!=sha or audit.get('provider_secrets_found')!=0 or audit.get('forbidden_paths_found')!=0 or audit.get('edition')!='private-jon-demo':raise ValueError('A matching private package audit is required.')
    started=call(ops,'/admin/release/start',{'name':file.name,'size':file.stat().st_size,'sha256':sha});size=started['part_bytes'];already=set(started['uploaded_parts'])
    with file.open('rb') as source:
        part=0
        while data:=source.read(size):
            part+=1
            if part in already:continue
            req=Request(ORIGIN+'/admin/release/part?part='+str(part),data=data,headers={'Authorization':'Bearer '+ops['admin'],'Content-Type':'application/octet-stream','Content-Length':str(len(data)),'User-Agent':'Brivany-Desktop/0.2.1'},method='POST')
            with build_opener(NoRedirect()).open(req,timeout=90) as response:
                value=json.loads(response.read(4096))
                if value.get('accepted') is not True:raise ValueError('The upload part was not accepted.')
            print(json.dumps({'part':part,'uploaded_bytes':min(part*size,file.stat().st_size),'total_bytes':file.stat().st_size}),flush=True)
    protector=WindowsDPAPIProtector();private=FOLDER/'download.dpapi'
    link={'ticket':secrets.token_urlsafe(32),'expiresAt':min(ops['expires_at'],int((time.time()+13*86400)*1000))}
    private.write_bytes(protector.protect(json.dumps(link).encode()))
    published=call(ops,'/admin/release/complete',link);url=ORIGIN+'/download?ticket='+link['ticket']
    request=Request(url,method='HEAD',headers={'User-Agent':'Brivany-Desktop/0.2.1'})
    with build_opener(NoRedirect()).open(request,timeout=30) as response:
        if int(response.headers.get('Content-Length',0))!=file.stat().st_size or response.headers.get('X-Brivany-SHA256')!=sha:raise ValueError('Download metadata mismatch.')
    (FOLDER/'download-link.txt').write_text(url,encoding='utf-8')
    print(json.dumps({'published':published['published'],'download_metadata_verified':True,'bytes':published['size'],'sha256':sha,'expires_at':published['expires_at'],'private_download_link_saved':True}),flush=True)

if __name__=='__main__':main()
