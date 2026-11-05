"""Sous: a local pantry and explicit cooking-state ledger.

The small recipe catalog contains authored presets. No provider is connected by
default; a client-supplied `source=meta` cannot impersonate a model response.
Only hashes and short structured observations are retained, never media bytes.
"""
from contextlib import contextmanager
from copy import deepcopy
from datetime import date, datetime, timezone
import json
import math
from pathlib import Path
import re
import sqlite3
import threading
import unicodedata
from uuid import UUID, uuid4


MAX_FRAMES = 120
UNITS = {'unit', 'g', 'kg', 'ml', 'l'}
PROVENANCE = {'printed_label', 'user_confirmed', 'category_estimate', 'unknown'}
VERDICTS = {'not_started', 'in_progress', 'ready', 'uncertain'}
RECIPE = {
    'id': 'eggs-vegetables-v1', 'title': 'Huevos con verduras', 'kind': 'curated_preset',
    'vegetarian': True, 'vegan': False, 'allergens': ['egg'],
    'source': {'kind': 'authored_local', 'note': 'Receta fija de demostración; no generada por un modelo ni asesoramiento alimentario personalizado.'},
    'ingredients': [{'key': 'eggs', 'label': 'Huevos', 'quantity': 2., 'unit': 'unit', 'optional': False},
                    {'key': 'vegetables', 'label': 'Verduras', 'quantity': 200., 'unit': 'g', 'optional': False},
                    {'key': 'oil', 'label': 'Aceite', 'quantity': 10., 'unit': 'ml', 'optional': True}],
    'steps': [
        {'id': 'prepare', 'label': 'Preparar', 'instruction': 'Lava y corta las verduras; prepara los huevos en un recipiente aparte.', 'criterion': 'Verduras cortadas y utensilios preparados.'},
        {'id': 'vegetables', 'label': 'Cocinar verduras', 'instruction': 'Cocina las verduras con cuidado y remueve para que no se quemen.', 'criterion': 'Verduras ablandadas; la cebolla, si la hay, se ve translúcida.'},
        {'id': 'eggs', 'label': 'Añadir huevos', 'instruction': 'Añade los huevos y cocina removiendo hasta que estén completamente cuajados.', 'criterion': 'Huevos cuajados, sin partes líquidas visibles; la imagen sola no confirma temperatura ni inocuidad.'},
        {'id': 'finish', 'label': 'Terminar', 'instruction': 'Apaga el fuego y sirve con cuidado.', 'criterion': 'Fuego apagado y preparación servida.'},
    ],
    'safety_note': 'La cámara no certifica frescura, temperatura interna ni inocuidad. Revisa alergias, envases y cocción; una fecha desconocida no significa fresco.',
}


class SousError(ValueError):
    def __init__(self, code, message, status=422):
        self.code, self.message, self.status = code, message, status
        super().__init__(message)


def _error(code='invalid_sous_input', message='Revisa los datos de Sous.', status=422):
    raise SousError(code, message, status)


def _now(): return datetime.now(timezone.utc).isoformat()


def _id(value):
    try:
        if not isinstance(value, str) or str(UUID(value)) != value: raise ValueError()
    except (ValueError, TypeError, AttributeError): _error('sous_not_found', 'Registro no disponible.', 404)
    return value


def _text(value, maximum=160):
    if not isinstance(value, str) or not 1 <= len(value.strip()) <= maximum or any(ord(c) < 32 for c in value): _error()
    return value.strip()


def _number(value, *, positive=False, maximum=1_000_000):
    if type(value) not in {int, float} or not math.isfinite(value) or value < 0 or positive and value <= 0 or value > maximum: _error()
    return float(value)


def _payload(value, allowed, required=()):
    if not isinstance(value, dict) or not set(value).issubset(allowed) or not set(required).issubset(value): _error()


def _sha(value, *, optional=False):
    if optional and value is None: return None
    if not isinstance(value, str) or not re.fullmatch('[0-9a-f]{64}', value): _error('invalid_frame_hash', 'Se necesita un SHA-256 de fotograma válido.')
    return value


def _expiry(value):
    provenance, expiry, source = value.get('expiry_provenance', 'unknown'), value.get('expiry_date'), value.get('source_reference')
    if not isinstance(provenance, str) or provenance not in PROVENANCE: _error()
    if expiry is not None:
        try:
            if not isinstance(expiry, str) or date.fromisoformat(expiry).isoformat() != expiry: raise ValueError()
        except ValueError: _error('invalid_expiry', 'Indica una fecha válida; no se inferirá una fecha ausente.')
    if (provenance == 'unknown') != (expiry is None): _error('invalid_expiry', 'Una fecha ausente conserva procedencia desconocida.')
    if source is not None: source = _text(source)
    if provenance in {'printed_label', 'category_estimate'} and source is None: _error('expiry_source_required', 'La fecha necesita su etiqueta o la base de la estimación.')
    return {'expiry_date': expiry, 'expiry_provenance': provenance, 'source_reference': source,
            'expiry_estimated': provenance == 'category_estimate'}


def _canonical(value):
    return ''.join(c for c in unicodedata.normalize('NFKD', value.lower()) if not unicodedata.combining(c))


def _ingredient(label):
    # Exact reviewed aliases: a product merely containing the word "egg" or
    # "quinoa" is not interchangeable with that ingredient (e.g. flour/bread).
    label=' '.join(_canonical(label).split())
    aliases={
        'quinoa':{'quinua','quinoa','quinua seca','quinoa seca','quinua blanca','quinoa blanca'},
        'lentils_cooked':{'lentejas cocidas','lenteja cocida','cooked lentils'},
        'rice_cooked':{'arroz cocido','cooked rice'},
        'water':{'agua','agua potable','water','drinking water'},
        'eggs':{'huevo','huevos','egg','eggs'},
        'vegetables':{'verdura','verduras','vegetable','vegetables','cebolla','cebollas','pimiento','pimientos',
            'zanahoria','zanahorias','espinaca','espinacas','tomate','tomates','brocoli','calabacin','calabacines'},
        'oil':{'aceite','aceite de oliva','aceite vegetal','oil','olive oil','vegetable oil'},
    }
    for key,values in aliases.items():
        if label in values:return key
    return None


def _preferences_default():
    return {'revision':1,'locality':None,'locality_source':'not_supplied',
            'vegetarian':True,'vegan':False,'allergens':[],'recipe_id':RECIPE['id']}


class SousService:
    def __init__(self, root, *, meta_adapter=None):
        self.root = Path(root).absolute()
        if self.root.resolve() != self.root: _error('sous_storage', 'Carpeta local no válida.', 409)
        self.root.mkdir(parents=True, exist_ok=True)
        self.database = self.root / 'sous.sqlite3'
        if self.database.resolve() != self.database: _error('sous_storage', 'Base local no válida.', 409)
        if meta_adapter is not None and (not callable(getattr(meta_adapter, 'verify', None)) or type(getattr(meta_adapter, 'simulation', None)) is not bool): _error('invalid_meta_adapter', 'El adaptador debe declarar si es simulado.')
        self.meta_adapter, self.lock = meta_adapter, threading.RLock()
        with self._db(write=True) as db:
            db.execute('CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY,document TEXT NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,item_id TEXT NOT NULL,document TEXT NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,document TEXT NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS observations(session_id TEXT NOT NULL,sequence INTEGER NOT NULL,document TEXT NOT NULL,PRIMARY KEY(session_id,sequence))')
            db.execute('CREATE TABLE IF NOT EXISTS ledger(sequence INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,record_id TEXT NOT NULL,document TEXT NOT NULL,created_at TEXT NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS settings(name TEXT PRIMARY KEY,document TEXT NOT NULL)')

    def _setting(self, db, name, default):
        row=db.execute('SELECT document FROM settings WHERE name=?',(name,)).fetchone()
        return json.loads(row[0]) if row else deepcopy(default)

    def preferences(self):
        with self._db() as db:
            return self._setting(db,'preferences',_preferences_default())

    def recipe(self, identifier):
        from services.sous_catalog import recipes
        if not isinstance(identifier,str):_error('unsupported_recipe','Elige una receta del catálogo.')
        value=next((item for item in recipes(RECIPE) if item['id']==identifier),None)
        if value is None:_error('unsupported_recipe','Elige una receta del catálogo.')
        return value

    def catalog(self):
        from services.sous_catalog import recipes
        preferences=self.preferences();country=_canonical((preferences['locality'] or {}).get('country',''))
        values=recipes(RECIPE)
        for recipe in values:
            recipe['matches_declared_country']=bool(country and country in [_canonical(item) for item in recipe['countries']])
            recipe['constraints_require_review']=bool(preferences['allergens']) or preferences['vegan'] and not recipe['vegan'] or preferences['vegetarian'] and not recipe['vegetarian']
        values.sort(key=lambda item:not item['matches_declared_country'])
        return {'recipes':values,'preferences':preferences,'automatic_geolocation':False,'sources_verified':False,'model_executed':False}

    def save_preferences(self,payload):
        fields={'expected_revision','locality','vegetarian','vegan','allergens','recipe_id'}
        _payload(payload,fields,fields)
        if type(payload['vegetarian']) is not bool or type(payload['vegan']) is not bool or not isinstance(payload['allergens'],list) or len(payload['allergens'])>20:_error()
        allergens=[_text(value,40) for value in payload['allergens']]
        locality=payload['locality']
        if locality is not None:
            _payload(locality,{'country','city'},{'country'})
            locality={'country':_text(locality['country'],80),'city':_text(locality['city'],80) if locality.get('city') else None}
        self.recipe(payload['recipe_id'])
        with self._db(write=True) as db:
            old=self._setting(db,'preferences',_preferences_default())
            if type(payload['expected_revision']) is not int or payload['expected_revision']!=old['revision']:_error('preferences_conflict','Las preferencias cambiaron; actualiza antes de guardar.',409)
            value={'revision':old['revision']+1,'locality':locality,'locality_source':'user_declared' if locality else 'not_supplied',
                'vegetarian':payload['vegetarian'],'vegan':payload['vegan'],'allergens':allergens,'recipe_id':payload['recipe_id']}
            db.execute('INSERT OR REPLACE INTO settings VALUES(?,?)',('preferences',json.dumps(value,ensure_ascii=False)))
            self._ledger(db,'preferences_updated','local',{'revision':value['revision'],'locality_source':value['locality_source'],'recipe_id':value['recipe_id']})
        return value

    def shopping_list(self):
        with self._db() as db:
            return self._setting(db,'shopping',{'revision':1,'items':[],'purchases_enabled':False,'prices_known':False})

    def save_shopping_list(self,payload):
        _payload(payload,{'expected_revision','items'},{'expected_revision','items'})
        if not isinstance(payload['items'],list) or len(payload['items'])>100:_error('shopping_limit','La lista admite hasta cien ingredientes.')
        values=[];seen=set()
        for item in payload['items']:
            _payload(item,{'id','label','quantity','unit','checked','note','recipe_id'},{'label','quantity','unit','checked'})
            identifier=_id(item['id']) if 'id' in item else str(uuid4())
            if identifier in seen or item['unit'] not in UNITS or type(item['checked']) is not bool:_error()
            seen.add(identifier)
            recipe_id=item.get('recipe_id')
            if recipe_id is not None:self.recipe(recipe_id)
            values.append({'id':identifier,'label':_text(item['label'],120),'quantity':_number(item['quantity'],positive=True),
                'unit':item['unit'],'checked':item['checked'],'note':_text(item['note'],160) if item.get('note') else None,'recipe_id':recipe_id})
        with self._db(write=True) as db:
            old=self._setting(db,'shopping',{'revision':1,'items':[]})
            if type(payload['expected_revision']) is not int or payload['expected_revision']!=old['revision']:_error('shopping_conflict','La lista cambió; actualiza antes de guardar.',409)
            value={'revision':old['revision']+1,'items':values,'purchases_enabled':False,'prices_known':False}
            db.execute('INSERT OR REPLACE INTO settings VALUES(?,?)',('shopping',json.dumps(value,ensure_ascii=False)))
            self._ledger(db,'shopping_saved','local',{'revision':value['revision'],'items_count':len(values),'purchases_enabled':False})
        return value

    def add_plan_to_shopping(self,payload):
        _payload(payload,{'expected_revision','recipe_id'},{'expected_revision','recipe_id'})
        self.recipe(payload['recipe_id']);current=self.shopping_list()
        if type(payload['expected_revision']) is not int or current['revision']!=payload['expected_revision']:_error('shopping_conflict','La lista cambió; actualiza antes de guardar.',409)
        plan=self.plan_meals({'recipe_id':payload['recipe_id']})
        if plan['eligibility']['status']=='blocked_constraint':_error('recipe_constraints','Revisa las restricciones antes de crear una lista de esta receta.')
        values=current['items'];existing={(_canonical(item['label']),item['unit']) for item in values}
        for item in plan['cart']['items']:
            if (_canonical(item['label']),item['unit']) in existing:continue
            values.append({'label':item['label'],'quantity':item['quantity'],'unit':item['unit'],'checked':False,'recipe_id':payload['recipe_id']})
        return self.save_shopping_list({'expected_revision':current['revision'],'items':values})

    @contextmanager
    def _db(self, *, write=False):
        with self.lock:
            db = sqlite3.connect(self.database, timeout=10)
            try:
                if write: db.execute('BEGIN IMMEDIATE')
                yield db
                if write: db.commit()
            except Exception:
                if write: db.rollback()
                raise
            finally: db.close()

    @staticmethod
    def _read(db, table, identifier):
        _id(identifier)
        row = db.execute(f'SELECT document FROM {table} WHERE id=?', (identifier,)).fetchone()
        if row is None: _error('sous_not_found', 'Registro no disponible.', 404)
        return json.loads(row[0])

    @staticmethod
    def _ledger(db, kind, identifier, document):
        db.execute('INSERT INTO ledger(kind,record_id,document,created_at) VALUES(?,?,?,?)',
                   (kind, identifier, json.dumps(document, ensure_ascii=False, allow_nan=False), _now()))

    def capabilities(self):
        return {'recipe_kind': 'curated_preset', 'live_meta_verification': self.meta_adapter is not None and not self.meta_adapter.simulation,
                'simulated_meta_adapter': self.meta_adapter is not None and self.meta_adapter.simulation,
                'max_frames_per_session': MAX_FRAMES, 'automatic_retries': 0, 'purchases_enabled': False,
                'raw_media_stored': False, 'billing_limit_enforced': False, 'configured_monetary_budget_usd': None}

    def inventory(self):
        with self._db() as db:
            items = [json.loads(row[0]) for row in db.execute('SELECT document FROM items ORDER BY id')]
            events = [json.loads(row[0]) for row in db.execute('SELECT document FROM events ORDER BY rowid')]
        today = date.today()
        summary = {'item_count': len(items), 'needs_confirmation': sum(not item['confirmed'] for item in items),
                   'expiring_soon_count': sum(item['expiry_date'] is not None and 0 <= (date.fromisoformat(item['expiry_date']) - today).days <= 3 for item in items),
                   'unknown_expiry_count': sum(item['expiry_date'] is None for item in items),
                   'consumed_events': sum(event['kind'] == 'consumed' for event in events),
                   'discarded_events': sum(event['kind'] == 'discarded' for event in events),
                   'reported_saved_from_waste_events': sum(event['saved_from_waste'] for event in events),
                   'estimated_saved_usd': round(sum(event['estimated_value_usd'] or 0 for event in events if event['saved_from_waste']), 6)}
        return {'items': items, 'events': events, 'summary': summary, 'capabilities': self.capabilities()}

    def save_item(self, payload):
        fields = {'id', 'label', 'quantity', 'unit', 'confidence', 'confirmed', 'expiry_date', 'expiry_provenance', 'source_reference'}
        _payload(payload, fields, {'label', 'quantity', 'unit', 'confidence'})
        confidence = _number(payload['confidence'], maximum=1)
        confirmed = payload.get('confirmed', False)
        if type(confirmed) is not bool or confidence < .6 and confirmed: _error('confirmation_required', 'Confirma por separado la lectura de baja confianza.')
        if not isinstance(payload['unit'], str) or payload['unit'] not in UNITS: _error()
        identifier = _id(payload['id']) if payload.get('id') is not None else str(uuid4())
        with self._db(write=True) as db:
            previous = self._read(db, 'items', identifier) if 'id' in payload else None
            if previous is None and db.execute('SELECT count(*) FROM items').fetchone()[0] >= 1000: _error('inventory_limit', 'Inventario local completo.', 429)
            item = {'id': identifier, 'label': _text(payload['label'], 120), 'quantity': _number(payload['quantity'], positive=True),
                    'unit': payload['unit'], 'confidence': confidence, 'confirmed': confirmed, **_expiry(payload),
                    'created_at': previous['created_at'] if previous else _now(), 'updated_at': _now()}
            db.execute('INSERT INTO items VALUES(?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document', (identifier, json.dumps(item, ensure_ascii=False)))
            self._ledger(db, 'item_updated' if previous else 'item_added', identifier, item)
        return item

    def confirm_item(self, identifier, payload):
        _payload(payload, {'confirmed', 'expiry_date', 'expiry_provenance', 'source_reference'}, {'confirmed'})
        if payload['confirmed'] is not True: _error('confirmation_required', 'La confirmación debe ser explícita.')
        with self._db(write=True) as db:
            item = self._read(db, 'items', identifier)
            if any(key in payload for key in ('expiry_date', 'expiry_provenance', 'source_reference')):
                item.update(_expiry({**item, **payload}))
            item.update(confirmed=True, updated_at=_now())
            db.execute('UPDATE items SET document=? WHERE id=?', (json.dumps(item, ensure_ascii=False), identifier))
            self._ledger(db, 'item_confirmed', identifier, {'confirmed': True, **_expiry(item)})
        return item

    def log_event(self, identifier, payload):
        _payload(payload, {'kind', 'amount', 'unit', 'saved_from_waste', 'estimated_unit_price_usd'}, {'kind', 'amount', 'unit'})
        amount = _number(payload['amount'], positive=True)
        saved = payload.get('saved_from_waste', False)
        if not isinstance(payload['kind'], str) or payload['kind'] not in {'consumed', 'discarded'} or type(saved) is not bool or saved and payload['kind'] != 'consumed': _error()
        price = payload.get('estimated_unit_price_usd')
        if price is not None: price = _number(price)
        with self._db(write=True) as db:
            item = self._read(db, 'items', identifier)
            if payload['unit'] != item['unit'] or amount > item['quantity']: _error('invalid_event_amount', 'La cantidad debe estar disponible y usar la misma unidad.')
            event = {'id': str(uuid4()), 'item_id': identifier, 'kind': payload['kind'], 'amount': amount, 'unit': item['unit'],
                     'saved_from_waste': saved, 'outcome_provenance': 'user_declared',
                     'estimated_unit_price_usd': price, 'estimated_value_usd': round(amount * price, 6) if price is not None else None,
                     'value_is_estimate': True, 'created_at': _now()}
            item.update(quantity=round(item['quantity'] - amount, 9), updated_at=_now())
            db.execute('UPDATE items SET document=? WHERE id=?', (json.dumps(item, ensure_ascii=False), identifier))
            db.execute('INSERT INTO events VALUES(?,?,?)', (event['id'], identifier, json.dumps(event, ensure_ascii=False)))
            self._ledger(db, 'inventory_event', event['id'], event)
        return {'item': item, 'event': event}

    def plan_meals(self, payload):
        _payload(payload, {'vegetarian', 'vegan', 'allergens','recipe_id'})
        preferences=self.preferences();recipe=self.recipe(payload.get('recipe_id',preferences['recipe_id']))
        vegetarian, vegan, allergens = payload.get('vegetarian', preferences['vegetarian']), payload.get('vegan', preferences['vegan']), payload.get('allergens', preferences['allergens'])
        if type(vegetarian) is not bool or type(vegan) is not bool or not isinstance(allergens, list) or len(allergens) > 20: _error()
        allergens = [_canonical(_text(value, 40)) for value in allergens]
        # The tiny preset has no validated allergen/product-label database.
        # Unknown allergies require review rather than silently being ignored.
        blocked = (vegan and not recipe['vegan']) or (vegetarian and not recipe['vegetarian']) or bool(allergens)
        inventory = self.inventory()['items']; eligible, excluded = [], []
        for item in inventory:
            reason = ('unconfirmed' if not item['confirmed'] else 'empty' if item['quantity'] <= 0 else
                      'expired' if item['expiry_date'] is not None and item['expiry_date'] < date.today().isoformat() else None)
            if reason: excluded.append({'id': item['id'], 'label': item['label'], 'reason': reason})
            else: eligible.append(item)
        eligible.sort(key=lambda item: (item['expiry_date'] is None, item['expiry_date'] or '', item['created_at'], item['id']))
        selected, cart, missing_required = [], [], False
        for ingredient in recipe['ingredients']:
            remaining = ingredient['quantity']
            for item in eligible:
                if _ingredient(item['label']) != ingredient['key']: continue
                factor = 1000 if (item['unit'], ingredient['unit']) in {('kg', 'g'), ('l', 'ml')} else 1 if item['unit'] == ingredient['unit'] else None
                if factor is None: continue
                amount = min(remaining, item['quantity'] * factor)
                if amount <= 0: continue
                selected.append({**item, 'planned_amount': amount / factor, 'planned_unit': item['unit']})
                remaining = round(remaining - amount, 9)
            if remaining > 0:
                if not ingredient['optional']: missing_required = True
                cart.append({'key': ingredient['key'], 'label': ingredient['label'], 'quantity': remaining, 'unit': ingredient['unit'],
                             'unit_price_usd': None, 'estimated_total_usd': None,
                             'price_provenance': 'unknown'})
        status = 'blocked_constraint' if blocked else 'missing_ingredients' if missing_required else 'ready'
        return {'recipe': deepcopy(recipe), 'eligibility': {'status': status, 'selected_items': [] if blocked else selected,
                'excluded_items': excluded, 'constraints': {'vegetarian': vegetarian, 'vegan': vegan, 'allergens': allergens},
                'freshness_verified': False,
                'constraint_notes': ['Las alergias declaradas requieren revisión de ingredientes y etiquetas.'] if allergens else []}, 'cart': {'simulated': True, 'items': [] if blocked else cart,
                'prices_assumed': False, 'prices_known': False, 'currency': None, 'purchases_enabled': False}, 'model_executed': False}

    def start_session(self, payload):
        _payload(payload, {'recipe_id', 'mode'}, {'recipe_id'})
        mode = payload.get('mode', 'manual')
        recipe=self.recipe(payload['recipe_id'])
        if self.plan_meals({'recipe_id':recipe['id']})['eligibility']['status']=='blocked_constraint':
            _error('recipe_constraints','Revisa las restricciones de esta receta antes de iniciar la práctica.')
        if not isinstance(mode, str) or mode not in {'manual', 'replay_mock', 'replay_recorded'}: _error('unsupported_recipe', 'Elige una receta y un modo de práctica válido.')
        identifier = str(uuid4())
        session = {'id': identifier, 'recipe_id': recipe['id'], 'recipe_title':recipe['title'],'mode': mode, 'revision': 1, 'status': 'not_started',
                   'current_step_id': recipe['steps'][0]['id'], 'steps': [{**step, 'state': 'not_started', 'ready_streak': 0, 'completed_by': None} for step in recipe['steps']],
                   'observations_count': 0, 'max_frames': MAX_FRAMES, 'verification_mode': 'not_verified',
                   'live_verification': False, 'model_executed': False, 'created_at': _now(), 'updated_at': _now()}
        with self._db(write=True) as db:
            db.execute('INSERT INTO sessions VALUES(?,?)', (identifier, json.dumps(session, ensure_ascii=False)))
            self._ledger(db, 'session_started', identifier, {'recipe_id': recipe['id'], 'mode': mode})
        return {**session, 'ledger': []}

    def get_session(self, identifier):
        with self._db() as db:
            session = self._read(db, 'sessions', identifier)
            ledger = [json.loads(row[0]) for row in db.execute('SELECT document FROM observations WHERE session_id=? ORDER BY sequence', (identifier,))]
        return {**session, 'ledger': ledger}

    def verify_step(self, identifier, payload):
        _payload(payload, {'expected_revision', 'step_id', 'evidence'}, {'expected_revision', 'step_id', 'evidence'})
        evidence = deepcopy(payload['evidence'])
        _payload(evidence, {'frame_sha256', 'observation', 'verdict', 'source', 'human_confirmed', 'replay_origin', 'response_sha256'}, {'observation', 'verdict', 'source'})
        evidence['observation'] = _text(evidence['observation'], 600)
        source, verdict = evidence['source'], evidence['verdict']
        if not isinstance(source, str) or source not in {'human', 'meta', 'replay'} or not isinstance(verdict, str) or verdict not in VERDICTS: _error()
        frame_hash = _sha(evidence.get('frame_sha256'), optional=source == 'human')
        evidence['frame_sha256'] = frame_hash
        confirmed = evidence.get('human_confirmed', False)
        if type(confirmed) is not bool: _error()
        if source != 'human' and confirmed: _error()
        if source != 'replay' and any(key in evidence for key in ('replay_origin', 'response_sha256')): _error()
        with self._db(write=True) as db:
            session = self._read(db, 'sessions', identifier)
            if type(payload['expected_revision']) is not int or payload['expected_revision'] != session['revision']: _error('session_conflict', 'La sesión cambió; actualiza antes de continuar.', 409)
            if session['current_step_id'] is None or payload['step_id'] != session['current_step_id']: _error('wrong_cooking_step', 'Sólo puede verificarse el paso actual.', 409)
            if session['observations_count'] >= MAX_FRAMES: _error('session_frame_limit', 'Se alcanzó el límite de lecturas de esta sesión.', 429)
            mode, model_executed, live = 'human_confirmation', False, False
            if source == 'meta':
                if session['mode'] != 'manual': _error('invalid_replay', 'Una sesión replay nunca ejecuta el adaptador Meta.')
                if self.meta_adapter is None: _error('meta_adapter_unavailable', 'Meta aún no está conectado a la verificación de Sous.', 503)
                result = self.meta_adapter.verify({'frame_sha256': frame_hash, 'step_id': payload['step_id']})
                _payload(result, {'frame_sha256', 'observation', 'verdict'}, {'frame_sha256', 'observation', 'verdict'})
                if result['frame_sha256'] != frame_hash or result['verdict'] not in VERDICTS: _error('invalid_meta_evidence', 'La respuesta no corresponde al fotograma.')
                evidence.update(observation=_text(result['observation'], 600), verdict=result['verdict'])
                verdict = result['verdict']
                model_executed = not self.meta_adapter.simulation
                live = model_executed
                mode = 'meta_live' if live else 'test_meta_adapter'
            elif source == 'replay':
                origin = evidence.get('replay_origin')
                if not isinstance(origin, str) or origin not in {'mock', 'recorded_meta'} or session['mode'] != ('replay_mock' if origin == 'mock' else 'replay_recorded'): _error('invalid_replay', 'El replay debe conservar su procedencia y usar una sesión separada.')
                if origin == 'recorded_meta': _sha(evidence.get('response_sha256'))
                elif 'response_sha256' in evidence: _error('invalid_replay', 'Un mock no es una respuesta real grabada.')
                mode = 'replay_mock' if origin == 'mock' else 'replay_recorded_meta_declared'
            elif session['mode'] != 'manual': _error('invalid_replay', 'Las confirmaciones manuales usan una sesión separada del replay.')
            previous = [json.loads(row[0]) for row in db.execute('SELECT document FROM observations WHERE session_id=? ORDER BY sequence', (identifier,))]
            duplicate = frame_hash is not None and any(row['evidence'].get('frame_sha256') == frame_hash for row in previous)
            step = next(step for step in session['steps'] if step['id'] == session['current_step_id'])
            consecutive = previous and previous[-1]['step_id'] == step['id'] and previous[-1]['verification_mode'] == mode and previous[-1]['evidence']['verdict'] == 'ready' and not previous[-1]['duplicate_frame']
            streak = (step['ready_streak'] + 1 if consecutive else 1) if verdict == 'ready' and not duplicate else 0
            completed = verdict == 'ready' and ((source == 'human' and confirmed) or (source != 'human' and streak >= 2))
            step.update(state='ready' if completed else 'in_progress' if verdict == 'ready' else verdict,
                        ready_streak=streak if source != 'human' else 0)
            if completed:
                step['completed_by'] = mode
                index = session['steps'].index(step) + 1
                session['current_step_id'] = session['steps'][index]['id'] if index < len(session['steps']) else None
            session.update(status='ready' if session['current_step_id'] is None else 'uncertain' if verdict == 'uncertain' else 'in_progress',
                           observations_count=session['observations_count'] + 1, revision=session['revision'] + 1,
                           verification_mode=mode, live_verification=session['live_verification'] or live,
                           model_executed=session['model_executed'] or model_executed, updated_at=_now())
            observation = {'sequence': session['observations_count'], 'step_id': step['id'], 'evidence': evidence,
                           'duplicate_frame': duplicate, 'verification_mode': mode, 'model_executed': model_executed,
                           'cost_known': not model_executed, 'actual_cost_usd': None if model_executed else 0,
                           'step_advanced': completed, 'created_at': _now()}
            db.execute('INSERT INTO observations VALUES(?,?,?)', (identifier, observation['sequence'], json.dumps(observation, ensure_ascii=False)))
            db.execute('UPDATE sessions SET document=? WHERE id=?', (json.dumps(session, ensure_ascii=False), identifier))
            self._ledger(db, 'step_observation', identifier, observation)
        return {**session, 'ledger': previous + [observation]}
