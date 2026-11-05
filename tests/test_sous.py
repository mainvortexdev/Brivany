"""Sous inventory and cooking invariants; all pixels/models/providers are absent."""
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path
import sqlite3
import tempfile
import unittest

from services.sous import SousError, SousService, RECIPE


class FakeMetaAdapter:
    simulation = True
    def __init__(self): self.verdict = 'ready'; self.calls = 0
    def verify(self, request):
        self.calls += 1
        return {'frame_sha256': request['frame_sha256'], 'observation': 'Resultado estructurado sintético.', 'verdict': self.verdict}


class SousTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name); self.service = SousService(self.root)

    def item(self, **changes):
        payload = {'label': 'Huevos', 'quantity': 6., 'unit': 'unit', 'confidence': .9, 'confirmed': True,
                   'expiry_date': None, 'expiry_provenance': 'unknown', 'source_reference': None}
        payload.update(changes)
        return self.service.save_item(payload)

    def session(self, service=None, mode='manual'):
        return (service or self.service).start_session({'recipe_id': RECIPE['id'], 'mode': mode})

    def evidence(self, session, *, source='human', sha=None, verdict='ready', confirmed=True, **extra):
        item = {'frame_sha256': sha, 'observation': 'Observación sintética explícita.', 'source': source, 'verdict': verdict}
        if source == 'human': item['human_confirmed'] = confirmed
        item.update(extra)
        return {'expected_revision': session['revision'], 'step_id': session['current_step_id'], 'evidence': item}

    def test_low_confidence_requires_separate_confirmation_and_never_creates_expiry(self):
        with self.assertRaises(SousError): self.item(confidence=.59, confirmed=True)
        item = self.item(confidence=.4, confirmed=False)
        self.assertIsNone(item['expiry_date']); self.assertEqual(item['expiry_provenance'], 'unknown')
        self.assertFalse(item['confirmed'])
        plan = self.service.plan_meals({})
        self.assertEqual(plan['eligibility']['excluded_items'][0]['reason'], 'unconfirmed')
        confirmed = self.service.confirm_item(item['id'], {'confirmed': True})
        self.assertTrue(confirmed['confirmed']); self.assertIsNone(confirmed['expiry_date'])
        self.assertEqual(SousService(self.root).inventory()['items'][0]['id'], item['id'])

    def test_dates_have_explicit_provenance_and_estimates_stay_estimates(self):
        tomorrow = (date.today() + timedelta(days=1)).isoformat()
        for changes in ({'expiry_date': tomorrow}, {'expiry_provenance': 'printed_label'},
                        {'expiry_date': tomorrow, 'expiry_provenance': 'printed_label'}, {'expiry_date': '2026-99-30'}):
            with self.assertRaises(SousError): self.item(**changes)
        item = self.item(expiry_date=tomorrow, expiry_provenance='category_estimate', source_reference='Estimación declarada de categoría')
        self.assertTrue(item['expiry_estimated'])
        updated = self.service.confirm_item(item['id'], {'confirmed': True})
        self.assertTrue(updated['expiry_estimated'])

    def test_plan_uses_urgent_confirmed_items_and_blocks_eggs_allergy_or_vegan(self):
        late = self.item(expiry_date=(date.today() + timedelta(days=3)).isoformat(), expiry_provenance='user_confirmed')
        urgent = self.item(expiry_date=(date.today() + timedelta(days=1)).isoformat(), expiry_provenance='user_confirmed')
        expired = self.item(expiry_date=(date.today() - timedelta(days=1)).isoformat(), expiry_provenance='user_confirmed')
        vegetables = self.item(label='Verduras', quantity=.3, unit='kg')
        plan = self.service.plan_meals({'vegetarian': True})
        self.assertEqual(plan['eligibility']['status'], 'ready')
        self.assertEqual(plan['eligibility']['selected_items'][0]['id'], urgent['id'])
        self.assertTrue(any(item['id'] == expired['id'] and item['reason'] == 'expired' for item in plan['eligibility']['excluded_items']))
        self.assertFalse(plan['eligibility']['freshness_verified']); self.assertFalse(plan['model_executed'])
        self.assertEqual(self.service.plan_meals({'vegan': True})['eligibility']['status'], 'blocked_constraint')
        self.assertEqual(self.service.plan_meals({'allergens': ['huevo']})['eligibility']['status'], 'blocked_constraint')
        self.assertEqual(self.service.plan_meals({'allergens': ['peanut']})['eligibility']['status'], 'blocked_constraint')
        self.assertTrue(plan['cart']['simulated']); self.assertFalse(plan['cart']['purchases_enabled'])
        self.assertTrue(all(item['price_provenance'] == 'unknown' and item['unit_price_usd'] is None for item in plan['cart']['items']))

    def test_events_are_atomic_explicit_and_consumption_does_not_imply_rescue(self):
        item = self.item(quantity=2)
        other = SousService(self.root)
        def consume(service):
            try: return service.log_event(item['id'], {'kind': 'consumed', 'amount': 2, 'unit': 'unit'})
            except SousError: return None
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(consume, [self.service, other]))
        self.assertEqual(sum(result is not None for result in results), 1)
        inventory = self.service.inventory()
        self.assertEqual(inventory['items'][0]['quantity'], 0)
        self.assertEqual(inventory['summary']['reported_saved_from_waste_events'], 0)
        self.assertEqual(inventory['summary']['estimated_saved_usd'], 0)
        item = self.item(quantity=2)
        event = self.service.log_event(item['id'], {'kind': 'consumed', 'amount': 1, 'unit': 'unit',
            'saved_from_waste': True, 'estimated_unit_price_usd': .3})['event']
        self.assertEqual(event['estimated_value_usd'], .3); self.assertTrue(event['value_is_estimate'])
        with self.assertRaises(SousError): self.service.log_event(item['id'], {'kind': 'discarded', 'amount': 1, 'unit': 'g'})

    def test_public_payload_cannot_claim_meta_or_store_raw_media(self):
        session = self.session()
        with self.assertRaises(SousError) as error:
            self.service.verify_step(session['id'], self.evidence(session, source='meta', sha='a' * 64))
        self.assertEqual(error.exception.code, 'meta_adapter_unavailable')
        bad = self.evidence(session); bad['evidence']['image_base64'] = 'private bytes'
        with self.assertRaises(SousError): self.service.verify_step(session['id'], bad)
        self.assertEqual(self.service.get_session(session['id'])['observations_count'], 0)
        self.assertFalse(self.service.capabilities()['live_meta_verification'])
        malformed = self.evidence(session); malformed['evidence']['source'] = []
        with self.assertRaises(SousError): self.service.verify_step(session['id'], malformed)

    def test_manual_confirmation_is_explicit_and_session_and_append_ledger_survive_reopen(self):
        session = self.session()
        first = self.service.verify_step(session['id'], self.evidence(session, confirmed=False))
        self.assertEqual(first['current_step_id'], 'prepare')
        second = self.service.verify_step(session['id'], self.evidence(first))
        self.assertEqual(second['current_step_id'], 'vegetables')
        self.assertEqual(second['steps'][0]['completed_by'], 'human_confirmation')
        self.assertFalse(second['live_verification']); self.assertFalse(second['model_executed'])
        persisted = SousService(self.root).get_session(session['id'])
        self.assertEqual(persisted, second); self.assertEqual(len(persisted['ledger']), 2)
        with self.assertRaises(SousError): self.service.verify_step(session['id'], self.evidence(session))
        self.assertEqual(self.service.get_session(session['id'])['observations_count'], 2)

    def test_meta_streak_requires_two_distinct_consecutive_trusted_readings(self):
        adapter = FakeMetaAdapter(); service = SousService(self.root, meta_adapter=adapter); session = self.session(service)
        first = service.verify_step(session['id'], self.evidence(session, source='meta', sha='a' * 64))
        self.assertEqual(first['steps'][0]['ready_streak'], 1)
        duplicate = service.verify_step(session['id'], self.evidence(first, source='meta', sha='a' * 64))
        self.assertEqual(duplicate['steps'][0]['ready_streak'], 0)
        third = service.verify_step(session['id'], self.evidence(duplicate, source='meta', sha='b' * 64))
        fourth = service.verify_step(session['id'], self.evidence(third, source='meta', sha='c' * 64))
        self.assertEqual(fourth['current_step_id'], 'vegetables')
        self.assertEqual(fourth['steps'][0]['completed_by'], 'test_meta_adapter')
        self.assertFalse(fourth['live_verification']); self.assertFalse(fourth['model_executed'])
        reused = service.verify_step(session['id'], self.evidence(fourth, source='meta', sha='a' * 64))
        self.assertEqual(reused['steps'][1]['ready_streak'], 0)

    def test_uncertain_breaks_ready_streak_and_client_verdict_does_not_override_adapter(self):
        adapter = FakeMetaAdapter(); service = SousService(self.root, meta_adapter=adapter); session = self.session(service)
        first = service.verify_step(session['id'], self.evidence(session, source='meta', sha='a' * 64))
        adapter.verdict = 'uncertain'
        uncertain = service.verify_step(session['id'], self.evidence(first, source='meta', sha='b' * 64, verdict='ready'))
        self.assertEqual(uncertain['status'], 'uncertain'); self.assertEqual(uncertain['steps'][0]['ready_streak'], 0)
        adapter.verdict = 'ready'
        ready = service.verify_step(session['id'], self.evidence(uncertain, source='meta', sha='c' * 64))
        self.assertEqual(ready['current_step_id'], 'prepare'); self.assertEqual(ready['steps'][0]['ready_streak'], 1)

    def test_replay_is_separate_and_declared_without_live_model_claim(self):
        session = self.session(mode='replay_mock')
        first = self.service.verify_step(session['id'], self.evidence(session, source='replay', sha='a' * 64, replay_origin='mock'))
        second = self.service.verify_step(session['id'], self.evidence(first, source='replay', sha='b' * 64, replay_origin='mock'))
        self.assertEqual(second['steps'][0]['completed_by'], 'replay_mock')
        self.assertFalse(second['model_executed']); self.assertFalse(second['live_verification'])
        with self.assertRaises(SousError): self.service.verify_step(second['id'], self.evidence(second))
        recorded = self.session(mode='replay_recorded')
        with self.assertRaises(SousError):
            self.service.verify_step(recorded['id'], self.evidence(recorded, source='replay', sha='c' * 64, replay_origin='recorded_meta'))
        adapter = FakeMetaAdapter(); service = SousService(self.root, meta_adapter=adapter)
        with self.assertRaises(SousError): service.verify_step(recorded['id'], self.evidence(recorded, source='meta', sha='d' * 64))
        self.assertEqual(adapter.calls, 0)

    def test_frame_cap_wrong_steps_and_nonfinite_inputs_do_not_advance(self):
        session = self.session()
        wrong = self.evidence(session); wrong['step_id'] = 'finish'
        with self.assertRaises(SousError): self.service.verify_step(session['id'], wrong)
        for _ in range(120):
            session = self.service.verify_step(session['id'], self.evidence(session, verdict='uncertain', confirmed=False))
        with self.assertRaises(SousError) as error: self.service.verify_step(session['id'], self.evidence(session))
        self.assertEqual(error.exception.code, 'session_frame_limit')
        self.assertEqual(self.service.get_session(session['id'])['observations_count'], 120)
        for value in (float('nan'), float('inf'), -1, True):
            with self.assertRaises(SousError): self.item(quantity=value)
        with self.assertRaises(SousError): self.service.start_session({'recipe_id': 'arbitrary-recipe'})


if __name__ == '__main__': unittest.main()
