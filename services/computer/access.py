"""Local access preference. It never grants elevation or destructive consent."""
import json
from pathlib import Path
import threading

MODES={'normal','full'}


class AccessPolicy:
    def __init__(self,root):
        self.path=Path(root)/'access-mode.json';self.lock=threading.RLock();self.mode='normal'
        try:
            value=json.loads(self.path.read_text(encoding='utf-8'))
            if set(value)=={'version','mode'} and value['version']==1 and value['mode'] in MODES:self.mode=value['mode']
        except (OSError,ValueError,TypeError):pass

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
