"""Microsoft-signed Office deployment, with activation and UAC kept separate."""
import ctypes
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess
import uuid
from urllib.request import Request,urlopen
import xml.etree.ElementTree as ET
from .policy import TerminalError,scoped
from .recipes import literal

ODT_URL='https://download.microsoft.com/download/6c1eeb25-cf8b-41d9-8d0d-cc1dbc032140/officedeploymenttool_20430-20146.exe'
ODT_PAGE='https://www.microsoft.com/en-us/download/details.aspx?id=49117'
PRODUCTS={'microsoft365':'O365HomePremRetail','office2024':'Professional2024Retail','word2024':'Word2024Retail','excel2024':'Excel2024Retail','powerpoint2024':'PowerPoint2024Retail'}
APPS={'word':'Word','excel':'Excel','powerpoint':'PowerPoint','outlook':'Outlook','onenote':'OneNote','access':'Access'}


def configuration(product,apps,source):
    if product not in PRODUCTS or not isinstance(apps,list) or not apps or len(set(apps))!=len(apps) or any(app not in APPS for app in apps):raise TerminalError('Producto o aplicaciones de Office inválidos.')
    if product in {'word2024','excel2024','powerpoint2024'} and apps!=[product[:-4]]:raise TerminalError('La aplicación no corresponde a ese producto Office.')
    root=ET.Element('Configuration');add=ET.SubElement(root,'Add',{'OfficeClientEdition':'64','Channel':'Current','SourcePath':str(source),'AllowCdnFallback':'TRUE'})
    item=ET.SubElement(add,'Product',{'ID':PRODUCTS[product]});ET.SubElement(item,'Language',{'ID':'es-es'})
    for name,identifier in APPS.items():
        if name not in apps:ET.SubElement(item,'ExcludeApp',{'ID':identifier})
    for identifier in ('Groove','Lync','Teams','OneDrive','Publisher'):ET.SubElement(item,'ExcludeApp',{'ID':identifier})
    ET.SubElement(root,'Property',{'Name':'AUTOACTIVATE','Value':'0'})
    ET.SubElement(root,'Property',{'Name':'FORCEAPPSHUTDOWN','Value':'FALSE'})
    ET.SubElement(root,'Property',{'Name':'PinIconsToTaskbar','Value':'FALSE'})
    ET.SubElement(root,'Display',{'Level':'Full','AcceptEULA':'FALSE'})
    # No Remove, RemoveMSI, PIDKEY, activation server or registry User settings.
    ET.indent(root);return ET.tostring(root,encoding='unicode')+'\n'


def installed_apps():
    values=[]
    for base in (Path(os.environ.get('ProgramFiles','C:/Program Files')),Path(os.environ.get('ProgramFiles(x86)','C:/Program Files (x86)'))):
        for app,binary in [('word','WINWORD.EXE'),('excel','EXCEL.EXE'),('powerpoint','POWERPNT.EXE'),('outlook','OUTLOOK.EXE'),('onenote','ONENOTE.EXE'),('access','MSACCESS.EXE')]:
            for folder in ('Microsoft Office/root/Office16','Microsoft Office/Office16'):
                path=base/folder/binary
                if path.is_file() and not any(v['path'].casefold()==str(path).casefold() for v in values):values.append({'app':app,'path':str(path)})
    return values


class OfficeInstaller:
    def __init__(self,executor):
        self.executor=executor;self.root=executor.root/'office-install';self.root.mkdir(exist_ok=True)

    def signature(self,path,cancelled=None):
        path=scoped(path,[self.root],existing=True)
        host=Path(os.environ.get('SystemRoot','C:/Windows'))/'System32/WindowsPowerShell/v1.0/powershell.exe'
        command='Get-AuthenticodeSignature -LiteralPath '+literal(path)+" | Select-Object @{n='Status';e={$_.Status.ToString()}},@{n='Signer';e={$_.SignerCertificate.Subject}} | ConvertTo-Json -Compress"
        receipt=self.executor.run('office.verify_microsoft_signature',str(host),['-NoProfile','-NonInteractive','-Command',command],cwd=self.root,cancelled=cancelled,timeout=30)
        self.executor.require_success(receipt);value=json.loads(receipt['output'])
        if value.get('Status')!='Valid' or 'O=Microsoft Corporation' not in value.get('Signer',''):raise TerminalError('La firma de Microsoft del instalador no es válida.')
        return receipt['id']

    def prepare(self,product,apps,cancelled=None):
        if os.name!='nt':raise TerminalError('Este instalador usa Office Deployment Tool para Windows.','terminal_platform_unavailable')
        # Validate the request before any download.
        configuration(product,apps,self.root/'cache')
        package=self.root/ODT_URL.rsplit('/',1)[-1]
        if not package.exists():
            with urlopen(Request(ODT_URL,headers={'User-Agent':'Brivany-office-setup'}),timeout=30) as response:raw=response.read(16*1024*1024)
            if not 1000<len(raw)<16*1024*1024:raise TerminalError('Tamaño inesperado de la herramienta oficial.')
            package.write_bytes(raw)
        package_signature=self.signature(package,cancelled)
        raw=package.read_bytes();offset=raw.find(b'MSCF')
        if offset<0 or offset+12>len(raw):raise TerminalError('No se encontró el archivo CAB de despliegue.')
        size=struct.unpack_from('<I',raw,offset+8)[0]
        if size<1000 or offset+size>len(raw):raise TerminalError('El CAB de Microsoft está incompleto.')
        cabinet=self.root/'odt-payload.cab';cabinet.write_bytes(raw[offset:offset+size]);tool=self.root/'odt';tool.mkdir(exist_ok=True)
        setup=tool/'setup.exe'
        if not setup.exists():
            receipt=self.executor.run('office.extract_setup_from_cab',str(Path(os.environ['SystemRoot'])/'System32/expand.exe'),['-F:setup.exe',str(cabinet),str(tool)],cwd=self.root,cancelled=cancelled,timeout=30)
            self.executor.require_success(receipt)
        setup_signature=self.signature(setup,cancelled)
        identifier=str(uuid.uuid4());cache=self.root/'cache';cache.mkdir(exist_ok=True);config=self.root/(identifier+'.xml')
        config.write_text(configuration(product,apps,cache),encoding='utf-8')
        result={'id':identifier,'product':product,'product_id':PRODUCTS[product],'apps':apps,'setup':str(setup),'configuration':str(config),'official_source':ODT_PAGE,'download_url':ODT_URL,'tool_sha256':hashlib.sha256(raw).hexdigest(),'signature_receipts':[package_signature,setup_signature],'activation_requested':False,'license_supplied':False,'force_apps_closed':False,'eula_automatically_accepted':False,'installed_before':installed_apps(),'state':'prepared'}
        self.save(result);return result

    def save(self,result):(self.root/(result['id']+'.json')).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')

    def status(self,cancelled=None):
        apps=installed_apps()
        if not apps:return {'title':'Office','installed_apps':[],'verified':True,'activation_verified':False,'message':'No se detectan aplicaciones de Office instaladas.'}
        host=Path(os.environ.get('SystemRoot','C:/Windows'))/'System32/WindowsPowerShell/v1.0/powershell.exe'
        commands=[]
        for app in apps:
            path=literal(app['path']);name=literal(app['app'])
            commands.append(f"$path={path};$signature=Get-AuthenticodeSignature -LiteralPath $path;$version=[Diagnostics.FileVersionInfo]::GetVersionInfo($path);[pscustomobject]@{{app={name};path=$path;version=$version.ProductVersion;signature=$signature.Status.ToString();publisher=$signature.SignerCertificate.Subject}}")
        command="$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); @(& { "+';'.join(commands)+" }) | ConvertTo-Json -Compress -Depth 4"
        receipt=self.executor.run('office.verify_installed_binaries',str(host),['-NoProfile','-NonInteractive','-Command',command],cwd=self.root,cancelled=cancelled,timeout=45)
        self.executor.require_success(receipt);details=json.loads(receipt['output']);details=details if isinstance(details,list) else [details]
        verified=all(r.get('signature')=='Valid' and 'O=Microsoft Corporation' in r.get('publisher','') and r.get('version') for r in details)
        return {'title':'Office','installed_apps':details,'verified':bool(verified),'binary_receipt':receipt['id'],'activation_verified':False,'installer_completion_verified':False,'message':('Aplicaciones de Microsoft detectadas y firmas comprobadas: '+', '.join(r['app'] for r in details)+'. La activación y el cierre del instalador se comprueban aparte.') if verified else 'Se detectan archivos de Office, pero su verificación no está completa.'}

    def download(self,prepared,cancelled=None):
        receipt=self.executor.run('office.download_installation_files',prepared['setup'],['/download',prepared['configuration']],cwd=self.root,cancelled=cancelled,timeout=3600)
        prepared['download_receipt']=receipt['id'];prepared['state']='downloaded' if receipt['exit_code']==0 and not receipt['interrupted'] else 'download_failed';self.save(prepared)
        self.executor.require_success(receipt);return prepared

    def install(self,prepared,cancelled=None):
        self.signature(Path(prepared['setup']),cancelled)
        if not ctypes.windll.shell32.IsUserAnAdmin():
            prepared['state']='requires_elevation';self.save(prepared)
            return self.request_elevation(prepared['id'],cancelled)
        try:
            receipt=self.executor.run('office.configure_installation',prepared['setup'],['/configure',prepared['configuration']],cwd=self.root,cancelled=cancelled,timeout=900)
        except OSError as error:
            if getattr(error,'winerror',None)!=740:raise
            prepared['state']='requires_elevation';self.save(prepared)
            return {'requires_user':True,'prepared_id':prepared['id'],'message':'El instalador oficial requiere la elevación de Windows. Los archivos y la configuración ya están preparados; Melodi no acepta ni elude UAC.'}
        prepared['install_receipt']=receipt['id'];found=installed_apps();prepared['installed_after']=found
        expected=set(prepared['apps']);actual={v['app'] for v in found}
        prepared['state']='installed_activation_not_verified' if expected<=actual and receipt['exit_code']==0 and not receipt['interrupted'] else 'installation_incomplete'
        self.save(prepared)
        return {'title':'Instalación de Office','prepared_id':prepared['id'],'installed':prepared['state']=='installed_activation_not_verified','binaries_present':expected<=actual,'verified':prepared['state']=='installed_activation_not_verified','apps':found,'activation_requested':False,'activation_verified':False,'requires_user':prepared['state']=='installation_incomplete','message':'Office instalado; la activación queda pendiente de una licencia válida.' if prepared['state']=='installed_activation_not_verified' else 'La instalación no está confirmada. Revisa el instalador o la autorización de Windows; no se repetirá automáticamente.'}

    def request_elevation(self,identifier,cancelled=None):
        if not isinstance(identifier,str) or str(uuid.UUID(identifier))!=identifier:raise TerminalError('Instalación preparada inválida.')
        prepared=json.loads((self.root/(identifier+'.json')).read_text(encoding='utf-8'))
        setup=scoped(prepared['setup'],[self.root],existing=True);config=scoped(prepared['configuration'],[self.root],existing=True)
        if config.read_text(encoding='utf-8')!=configuration(prepared['product'],prepared['apps'],self.root/'cache'):raise TerminalError('La configuración cambió después de prepararla.')
        if prepared['state'] not in {'downloaded','requires_elevation','installation_incomplete'}:raise TerminalError('La instalación no está preparada para continuar.')
        self.signature(setup,cancelled)
        try:os.startfile(str(setup),operation='runas',arguments=subprocess.list2cmdline(['/configure',str(config)]))
        except OSError as error:
            if getattr(error,'winerror',None)==1223:return {'requires_user':True,'elevation_requested':True,'elevation_accepted':False,'message':'Windows no recibió la autorización de elevación. La instalación sigue preparada, sin repetirla.'}
            raise
        prepared['state']='elevation_requested';self.save(prepared)
        return {'requires_user':True,'elevation_requested':True,'installation_verified':False,'prepared_id':identifier,'message':'El instalador oficial recibió la solicitud de apertura con UAC. Revisa el diálogo de Windows y las condiciones de Microsoft; la activación no se realiza automáticamente.'}
