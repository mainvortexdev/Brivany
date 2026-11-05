"""Fixed CMD/native Windows probes. No user-generated command strings."""
import ctypes
import os
from pathlib import Path
import re
from .policy import TerminalError

NATIVE={'arp','attrib','call','cd','chdir','chcp','chkdsk','choice'}


def success_exit(name,code):
    # CHOICE returns the selected one-based index. Zero means interruption.
    return code==(1 if name=='choice' else 0)


def invocation(name):
    base=Path(os.environ.get('SystemRoot','C:/Windows'))/'System32'
    if name not in NATIVE:raise TerminalError('No hay receta nativa para ese comando.')
    if name=='choice':return str(base/'choice.exe'),['/c','Y','/n','/t','0','/d','Y','/m','Melodi'], 'cp'+str(ctypes.windll.kernel32.GetOEMCP())
    if name=='chkdsk':return str(base/'chkdsk.exe'),[os.environ.get('SystemDrive','C:')],'cp'+str(ctypes.windll.kernel32.GetOEMCP())
    if name=='chcp':return str(base/'cmd.exe'),['/d','/c','chcp'],'cp'+str(ctypes.windll.kernel32.GetOEMCP())
    if name in {'call','cd','chdir'}:
        command={'call':'call echo melodi','cd':'cd','chdir':'chdir','chcp':'chcp'}[name]
        return str(base/'cmd.exe'),['/d','/u','/c',command],'utf-16-le'
    return str(base/(name+'.exe')),['-a','127.0.0.1'] if name=='arp' else ['seed.txt'],'cp'+str(ctypes.windll.kernel32.GetOEMCP())


def verify(name,receipt):
    output=receipt['output'].strip();root=Path(receipt['cwd'])
    if name=='choice':return receipt['argv'][1:]==['/c','Y','/n','/t','0','/d','Y','/m','Melodi'] and receipt['exit_code']==1 and output=='Melodi Y'
    if name=='arp':return bool(output) and receipt['argv'][-2:]==['-a','127.0.0.1']
    if name=='attrib':return output.casefold().endswith(str(root/'seed.txt').casefold()) and (root/'seed.txt').read_bytes()==b'melodi\nterminal\n'
    if name=='call':return output=='melodi'
    if name in {'cd','chdir'}:return Path(output)==root
    if name=='chcp':return bool(re.search(r'\b(?:[1-9][0-9]{1,4})\b',output))
    if name=='chkdsk':return receipt['exit_code']==0 and bool(output) and receipt['argv'][1:]==[os.environ.get('SystemDrive','C:')]
    return False
