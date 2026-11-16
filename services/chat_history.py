"""Durable conversations with encrypted payloads, independent of WebView ports."""
import json
import base64
from pathlib import Path
import sqlite3
import threading
import time
from uuid import UUID,uuid4
import zlib
from contextlib import contextmanager
from services.google_oauth import WindowsDPAPIProtector
from services.chat_titles import title_fields,TITLE_VERSION

class ChatHistory:
    def __init__(self,root,protector=None):
        self.root=Path(root).absolute();self.lock=threading.RLock()
        for p in (self.root,*self.root.parents):
            if p.is_symlink() or getattr(p,'is_junction',lambda:False)():raise ValueError('Historial no válido.')
        self.root.mkdir(parents=True,exist_ok=True);self.path=self.root/'history.sqlite3'
        if self.path.is_symlink():raise ValueError('Historial no válido.')
        self.protector=protector or WindowsDPAPIProtector()
        with self.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS chats (id TEXT PRIMARY KEY, updated REAL NOT NULL, payload BLOB NOT NULL)')
            if 'summary' not in {row[1] for row in db.execute('PRAGMA table_info(chats)')}:db.execute('ALTER TABLE chats ADD COLUMN summary BLOB')
            db.execute('CREATE TABLE IF NOT EXISTS state (name TEXT PRIMARY KEY,value TEXT NOT NULL)')
    @contextmanager
    def connect(self):
        db=sqlite3.connect(self.path,timeout=10)
        try:
            with db:yield db
        finally:db.close()
    @staticmethod
    def identifier(value):
        if not isinstance(value,str) or str(UUID(value))!=value:raise ValueError('Conversación no válida.')
        return value
    def decode(self,raw):
        if raw.startswith(b'CHAT2\n'):
            parts=json.loads(raw[6:])
            if not isinstance(parts,list) or len(parts)>150:raise ValueError('Historial demasiado grande.')
            compressed=b''.join(self.protector.unprotect(base64.b64decode(part,validate=True)) for part in parts)
        else:compressed=self.protector.unprotect(raw)
        decoder=zlib.decompressobj();data=decoder.decompress(compressed,8000000)
        if not decoder.eof or decoder.unconsumed_tail:raise ValueError('Historial demasiado grande.')
        return json.loads(data)
    def save(self,value,*,active=True):
        with self.lock:return self._save(value,active=active)
    def _save(self,value,*,active=True):
        if not isinstance(value,dict) or set(value)-{'id','messages','history','tasks','draft','title','title_mode'}:raise ValueError('Conversación no válida.')
        identifier=self.identifier(value.get('id'))
        if not isinstance(value.get('messages',[]),list) or len(value.get('messages',[]))>5000:raise ValueError('Demasiados mensajes.')
        for message in value.get('messages',[]):
            if not isinstance(message,dict) or message.get('role') not in {'user','assistant'} or not isinstance(message.get('text'),str) or len(message['text'])>12000:raise ValueError('Mensaje no válido.')
        if len(value.get('tasks',[]))>2000 or len(value.get('history',[]))>12 or len(value.get('draft',''))>1200:raise ValueError('Historial demasiado grande.')
        value={**value,**title_fields(value)}
        with self.connect() as db:previous=db.execute('SELECT updated,summary,payload FROM chats WHERE id=?',(identifier,)).fetchone()
        previous_summary=json.loads(self.protector.unprotect(previous[1])) if previous and previous[1] else {}
        if value['title_mode']=='auto':
            if previous_summary.get('title_mode')=='manual':value.update(title=previous_summary['title'],title_mode='manual')
        user_messages=sum(message['role']=='user' for message in value.get('messages',[]))
        previous_users=previous_summary.get('user_messages')
        if previous and previous_users is None:previous_users=sum(message.get('role')=='user' for message in self.decode(previous[2]).get('messages',[]))
        promoted=previous is None or user_messages>previous_users
        updated=time.time() if promoted else previous[0]
        raw=json.dumps(value,ensure_ascii=False,allow_nan=False).encode()
        if len(raw)>7900000:raise ValueError('Historial demasiado grande.')
        compressed=zlib.compress(raw)
        protected=b'CHAT2\n'+json.dumps([base64.b64encode(self.protector.protect(compressed[i:i+60000])).decode() for i in range(0,len(compressed),60000)]).encode()
        summary=self.protector.protect(json.dumps({'title':value['title'],'title_mode':value['title_mode'],'title_version':TITLE_VERSION,'messages':len(value.get('messages',[])),'user_messages':user_messages},ensure_ascii=False).encode())
        with self.lock,self.connect() as db:
            db.execute('INSERT OR REPLACE INTO chats (id,updated,payload,summary) VALUES (?,?,?,?)',(identifier,updated,protected,summary))
            if active:db.execute('INSERT OR REPLACE INTO state VALUES (?,?)',('active',identifier))
        return {'ok':True,'id':identifier,'title':value['title'],'title_mode':value['title_mode'],'updated':updated,'promoted':promoted}
    def get(self,identifier):
        self.identifier(identifier)
        with self.lock,self.connect() as db:row=db.execute('SELECT payload FROM chats WHERE id=?',(identifier,)).fetchone()
        if not row:raise ValueError('La conversación no existe.')
        value=self.decode(row[0]);return {**value,**title_fields(value)}
    def rename(self,identifier,title):
        if not isinstance(title,str) or not title.strip() or len(title)>80 or any(ord(c)<32 for c in title):raise ValueError('Nombre de conversación no válido.')
        value=self.get(identifier);value.update(title=title.strip(),title_mode='manual')
        return self.save(value,active=False)
    def catalog(self):
        with self.lock,self.connect() as db:
            rows=db.execute('SELECT id,updated,summary FROM chats ORDER BY updated DESC LIMIT 1000').fetchall()
            active=db.execute("SELECT value FROM state WHERE name='active'").fetchone()
        items=[]
        for identifier,updated,raw in rows:
            summary=json.loads(self.protector.unprotect(raw)) if raw else {}
            if summary.get('title_version')!=TITLE_VERSION:
                value=self.get(identifier)
                summary={'title':value['title'],'title_mode':value['title_mode'],'title_version':TITLE_VERSION,'messages':len(value.get('messages',[])),'user_messages':sum(message['role']=='user' for message in value.get('messages',[]))}
                with self.connect() as db:db.execute('UPDATE chats SET summary=? WHERE id=?',(self.protector.protect(json.dumps(summary,ensure_ascii=False).encode()),identifier))
            items.append({'id':identifier,'title':summary['title'],'title_mode':summary.get('title_mode','auto'),'updated':updated,'messages':summary['messages']})
        return {'active':active[0] if active else None,'conversations':items,'encrypted':True}
