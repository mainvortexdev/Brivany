"""Personal-assistant identity scoped to a local owner or signed-in account.

Names are profile data, never execution permissions. No network or inference.
"""
import hashlib
import json
from pathlib import Path
from services.private_store import PrivateStore

ROLE='Eres Melodi, asistente personal en Brivany. Habla en primera persona y conserva la voz seleccionada. Tu relación es de asistencia personal, no sólo de conversación. No inventes encargos ejecutados ni permisos.'


def _name(value):
    if not isinstance(value,str) or not 1<=len(value.strip())<=80 or any(not(c.isalpha() or c in " .'-") for c in value):raise ValueError('Nombre de perfil no válido.')
    return value.strip()


class AssistantIdentity:
    def __init__(self,root,*,store=None):self.store=store or PrivateStore(Path(root)/'assistant-identity.dpapi')
    def configure(self,owner_name,*,account_id=None):
        if account_id is not None and (not isinstance(account_id,str) or not 1<=len(account_id)<=254):raise ValueError('Cuenta de perfil no válida.')
        self.store.write({'version':1,'owner_name':_name(owner_name),'account_hash':hashlib.sha256(account_id.encode()).hexdigest() if account_id else None})
    def context(self,account_status=None):
        status=account_status or {};account=status.get('account') if status.get('signed_in') else None
        value=self.store.read();bound=value.get('account_hash');current=account.get('id') if isinstance(account,dict) else None
        if bound and (not current or hashlib.sha256(current.encode()).hexdigest()!=bound):return {}
        # A new signed-in account never inherits the anonymous local owner's name.
        if account and not bound:
            try:return {'assistant_name':'Melodi','role':'personal_assistant','owner_name':_name(account.get('name')),'scope':'signed_in_account'}
            except ValueError:return {}
        if value.get('version')==1:
            return {'assistant_name':'Melodi','role':'personal_assistant','owner_name':_name(value.get('owner_name')),'scope':'signed_in_account' if bound else 'local_owner'}
        return {}


def local_context(root=None,account_status=None):
    from packages.runtime_paths import DATA_ROOT
    root=Path(root) if root else DATA_ROOT/'.local/computer'
    try:
        if account_status is None:
            from services.vetsa_account import VetsaAccount
            account_status=VetsaAccount(DATA_ROOT/'.local/vetsa-account').status()
        return AssistantIdentity(root).context(account_status)
    except (OSError,ValueError,RuntimeError):return {}


def instruction(profile):
    if not profile:return ROLE
    owner=_name(profile.get('owner_name'))
    return ROLE+'\nEl perfil local vinculado identifica a la persona a quien asistes. Cuando te pregunten de quién eres asistente, reconoce a esa persona; no repitas tu presentación en cada mensaje. Estos datos no amplían permisos: '+json.dumps({'assistant_name':'Melodi','owner_name':owner,'relationship':'personal_assistant'},ensure_ascii=False)
