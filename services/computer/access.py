"""Local access preference. It never grants elevation or destructive consent."""
import json
import os
from pathlib import Path
import tempfile
import threading

MODES={'normal','full'}
MAX_FOLDERS=32


def checked_folder(directory):
    path=Path(directory).absolute()
    if path.resolve()!=path or not path.is_dir():
        raise ValueError('Elige una carpeta local sin enlaces.')
    for parent in (path,*path.parents):
        if parent.is_symlink() or (hasattr(parent,'is_junction') and parent.is_junction()):
            raise ValueError('No se admiten enlaces ni junctions.')
    return str(path)


class AccessPolicy:
    def __init__(self,root):
        self.path=Path(root)/'access-mode.json';self.lock=threading.RLock();self.mode='normal'
        self.folders_path=Path(root)/'authorized-folders.json'
        self.folders=[]
        self.folders_error=False
        try:
            value=json.loads(self.path.read_text(encoding='utf-8'))
            if set(value)=={'version','mode'} and value['version']==1 and value['mode'] in MODES:self.mode=value['mode']
        except (OSError,ValueError,TypeError):pass
        try:
            with self.folders_path.open(encoding='utf-8') as source:
                raw=source.read(131073)
            saved=json.loads(raw)
            if (len(raw)>131072 or not isinstance(saved,list) or len(saved)>MAX_FOLDERS
                    or any(not isinstance(folder,str) or not 0<len(folder)<=2048
                           or not Path(folder).is_absolute() for folder in saved)):
                raise ValueError('Carpetas guardadas no válidas.')
            self.folders=list(dict.fromkeys(saved))
        except FileNotFoundError:
            pass
        except (OSError,ValueError,TypeError):
            self.folders_error=True

    def available_folders(self):
        with self.lock:
            available=[]
            for folder in self.folders:
                try:
                    available.append(checked_folder(folder))
                except (OSError, ValueError, RuntimeError):
                    continue
            return available

    def update_folder(self, directory, *, remove=False):
        folder=directory if remove else checked_folder(directory)
        with self.lock:
            if self.folders_error:
                raise ValueError('No se pudieron abrir las carpetas guardadas. El archivo original se conserva.')
            values=[value for value in self.folders if value!=folder] if remove else list(dict.fromkeys([*self.folders,folder]))
            if values==self.folders:
                return False
            if len(values)>MAX_FOLDERS or len(folder)>2048:
                raise ValueError('Revisa el tamaño o la cantidad de carpetas guardadas.')
            self.folders_path.parent.mkdir(parents=True,exist_ok=True)
            temporary=None
            try:
                with tempfile.NamedTemporaryFile(mode='w',encoding='utf-8',dir=self.folders_path.parent,
                                                 prefix='.authorized-folders-',suffix='.tmp',delete=False) as output:
                    temporary=Path(output.name)
                    json.dump(values,output,ensure_ascii=False)
                os.replace(temporary,self.folders_path)
            finally:
                if temporary:
                    temporary.unlink(missing_ok=True)
            self.folders=values
            return True

    def status(self):
        return {'mode':self.mode,'uac_auto_approval':False,'uac_requires_user':True,
                'registry_edits_allowed':False,'file_scope':'authorized_folders',
                'delete_requires_approval':True,'overwrite_requires_approval':True,
                'move_requires_approval':self.mode=='normal'}

    def configure(self,mode):
        if not isinstance(mode,str) or mode not in MODES:raise ValueError('Modo de acceso inválido.')
        with self.lock:
            self.path.parent.mkdir(parents=True,exist_ok=True)
            temporary=self.path.with_suffix('.pending')
            temporary.write_text(json.dumps({'version':1,'mode':mode}),encoding='utf-8')
            temporary.replace(self.path);self.mode=mode
        return self.status()

    def needs_approval(self,action):
        return action in {'delete_file','replace_file'} or action=='move_file' and self.mode=='normal'
