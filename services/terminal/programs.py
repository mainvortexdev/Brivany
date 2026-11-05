"""Known installed programs and legitimate OS elevation, without shell input."""
import os
from pathlib import Path
import subprocess
import sys
from .policy import TerminalError,validate_program,child_environment


def installed_programs(projects):
    programs={}
    for editor in projects.detect_editors()['installed']:
        programs[editor['name'].casefold()]={'name':editor['name'],'path':editor['path']}
    if os.name=='nt':
        system=Path(os.environ.get('SystemRoot','C:/Windows'))/'System32'
        for key,binary in [('bloc de notas','notepad.exe'),('paint','mspaint.exe')]:
            path=system/binary
            if path.is_file():programs[key]={'name':key,'path':str(path)}
    return programs


def launch_program(projects,environment,application,*,elevated=False):
    if type(elevated) is not bool or not isinstance(application,str):raise TerminalError('Programa solicitado inválido.')
    programs=installed_programs(projects);chosen=programs.get(application.casefold())
    if not chosen:raise TerminalError('No se encontró ese programa en el catálogo de programas instalados.','terminal_missing_program')
    validate_program(chosen['path'],[])
    if elevated:
        if os.name!='nt':return {'requires_user':True,'message':'La elevación macOS requiere una operación concreta y su autorización del sistema; no se enviarán contraseñas ni sudo sin interacción.'}
        try:os.startfile(chosen['path'],operation='runas')
        except OSError as error:
            if getattr(error,'winerror',None)==1223:return {'requires_user':True,'message':'La elevación fue cancelada o no se autorizó en UAC. No se repetirá.'}
            raise TerminalError('Windows no confirmó la solicitud de elevación.','terminal_elevation_failed') from error
        return {'title':chosen['name'],'requires_user':True,'elevation_requested':True,'elevation_verified':False,'message':'Solicitud enviada al mecanismo runas de Windows. La apertura elevada debe comprobarse; Melodi no acepta ni elude UAC.'}
    if sys.platform=='darwin':argv=['/usr/bin/open','-a',chosen['path']]
    else:argv=[chosen['path']]
    process=subprocess.Popen(argv,env=child_environment(environment),stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    return {'title':chosen['name'],'pid':process.pid,'launch_requested':True,'window_verified':False,'message':'Apertura solicitada; comprueba la ventana del programa.'}
