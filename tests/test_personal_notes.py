"""Real persistence/claims and synthetic clocks/outbound transport; no messages."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime,timezone
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import Mock

from services.personal_notes import PersonalNotesService,PersonalNotesError
from services.integrations import IntegrationResult


class Outbound:
    simulation=True
    def __init__(self):self.calls=[];self.action=None
    def execute(self,operation,parameters,identifier):
        self.calls.append((operation,deepcopy(parameters),identifier))
        if self.action:return self.action()
        return IntegrationResult('succeeded','wamid.synthetic-reminder==',{'accepted':True,'delivered':False})


class PersonalNotesTests(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory();self.addCleanup(self.temporary.cleanup);self.root=Path(self.temporary.name)
        self.clock=[datetime(2026,11,1,14,0,tzinfo=timezone.utc).timestamp()]
        self.config={'execution_enabled':True,'self_recipient':'59170000001','opted_in_recipients':['59170000001'],'allowed_senders':['59170000001']}
        self.config_calls=[];self.outbound=Outbound()
        def config():self.config_calls.append('read');return deepcopy(self.config)
        self.config_provider=config;self.service=self.instance()

    def instance(self,**changes):
        value=PersonalNotesService(self.root,config_provider=self.config_provider,outbound=self.outbound,
            now=lambda:self.clock[0],**changes);self.addCleanup(value.close);return value

    def reminder(self,service=None,**changes):
        return (service or self.service).create_reminder({'text':'Recordatorio sintético','at':'2026-11-01T10:00:00-04:00','channel':'local',**changes})

    def whatsapp(self,service=None,**changes):return self.reminder(service,channel='whatsapp',delivery_authorized=True,**changes)

    def enabled(self,**changes):
        return self.instance(allow_whatsapp_delivery=True,window_provider=lambda own:self.clock[0]+60,**changes)

    def test_constructor_never_requests_configuration_delivery_or_starts_worker(self):
        self.assertEqual(self.config_calls,[]);self.assertEqual(self.outbound.calls,[]);self.assertIsNone(self.service.thread)
        result=self.service.status();self.assertFalse(result['scheduler_running']);self.assertFalse(result['os_background_alarm_implemented'])
        self.assertEqual(self.config_calls,[])

    def test_timezone_normalization_and_persistence_are_explicit_not_locality_inferred(self):
        value=self.reminder();self.assertEqual(value['at'],'2026-11-01T14:00:00+00:00')
        self.assertEqual(value['declared_at'],'2026-11-01T10:00:00-04:00')
        self.assertEqual(self.instance().get_reminder(value['id']),value)
        for change in ({'at':'2026-11-01T10:00:00'},{'at':'not a date'},{'channel':['local']},{'text':'bad\x00value'},{'delivery_authorized':1}):
            with self.subTest(change=change),self.assertRaises(PersonalNotesError):self.reminder(**change)
        self.assertEqual(len(self.service.list_reminders()['items']),1)

    def test_local_due_is_persistent_once_and_has_no_provider_or_os_alarm_claim(self):
        value=self.reminder();first=self.service.run_due();self.assertEqual(first['processed'],1)
        self.assertEqual(first['items'][0]['state'],'local_due');self.assertEqual(self.service.run_due()['processed'],0)
        self.assertEqual(self.instance().get_reminder(value['id'])['state'],'local_due');self.assertEqual(self.outbound.calls,[])
        self.assertTrue(self.service.list_reminders()['local_alarm_requires_open_app'])

    def test_revision_edit_snooze_complete_and_cancel_are_safe(self):
        value=self.reminder()
        edited=self.service.update_reminder(value['id'],{'expected_revision':1,'text':'Otro texto'})
        with self.assertRaises(PersonalNotesError) as error:self.service.cancel_reminder(value['id'],1)
        self.assertEqual(error.exception.status,409)
        snoozed=self.service.snooze_reminder(value['id'],{'expected_revision':edited['revision'],'at':'2026-11-01T15:00:00Z'})
        self.assertEqual(snoozed['generation'],2);self.assertEqual(self.service.run_due()['processed'],0)
        completed=self.service.complete_reminder(value['id'],snoozed['revision']);self.assertEqual(completed['state'],'completed')
        self.assertEqual(self.service.list_reminders()['items'],[])
        cancelled=self.service.cancel_reminder(value['id'],completed['revision']);self.assertEqual(cancelled['state'],'cancelled')
        self.assertFalse(cancelled['delivery_verified'])

    def test_whatsapp_requires_item_consent_and_current_own_chat_at_creation(self):
        with self.assertRaises(PersonalNotesError):self.reminder(channel='whatsapp')
        self.config['opted_in_recipients']=[]
        with self.assertRaises(PersonalNotesError):self.whatsapp()
        self.assertEqual(self.service.list_reminders()['items'],[]);self.assertEqual(self.outbound.calls,[])

    def test_whatsapp_is_disabled_by_default_and_missing_service_window_blocks(self):
        value=self.whatsapp();self.assertEqual(self.service.run_due()['processed'],0);self.assertEqual(self.outbound.calls,[])
        enabled=self.instance(allow_whatsapp_delivery=True)
        result=enabled.run_due()['items'][0];self.assertEqual(result['state'],'delivery_blocked');self.assertEqual(result['error_code'],'reminder_window_unverified')
        self.assertEqual(enabled.run_due()['processed'],0);self.assertEqual(self.outbound.calls,[])

    def test_two_instances_claim_one_attempt_and_acceptance_never_means_delivery(self):
        service=self.enabled();other=self.enabled();value=self.whatsapp(service);barrier=threading.Barrier(2)
        def due(instance):barrier.wait();return instance.run_due()
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(due,[service,other]))
        self.assertEqual(sum(result['processed'] for result in results),1);self.assertEqual(len(self.outbound.calls),1)
        saved=service.get_reminder(value['id']);self.assertEqual(saved['state'],'accepted_test_stub');self.assertTrue(saved['accepted_by_provider']);self.assertFalse(saved['delivery_verified'])
        self.assertEqual(service.status()['attempts_today_utc'],1)
        raw=self.service.database.read_bytes();self.assertNotIn(self.config['self_recipient'].encode(),raw);self.assertNotIn(b'wamid.synthetic-reminder',raw)

    def test_uncertain_send_is_not_replayed_after_restart_and_error_does_not_leak(self):
        def fail():raise OSError('PRIVATE token=synthetic-provider-key')
        self.outbound.action=fail;service=self.enabled();value=self.whatsapp(service)
        result=service.run_due()['items'][0];self.assertEqual(result['state'],'uncertain');self.assertEqual(result['error_code'],'reminder_delivery_outcome_unknown')
        restarted=self.enabled();self.assertEqual(restarted.run_due()['processed'],0);self.assertEqual(len(self.outbound.calls),1)
        with self.assertRaises(PersonalNotesError):restarted.snooze_reminder(value['id'],{'expected_revision':result['revision'],'at':'2026-11-02T00:00:00Z'})
        self.assertNotIn(b'synthetic-provider-key',self.service.database.read_bytes())

    def test_withdrawn_consent_or_changed_recipient_prevents_delivery(self):
        service=self.enabled();value=self.whatsapp(service);self.config['execution_enabled']=False
        result=service.run_due()['items'][0];self.assertEqual(result['state'],'delivery_blocked');self.assertEqual(self.outbound.calls,[])
        self.config['execution_enabled']=True;self.config['self_recipient']='59170000002';self.config['opted_in_recipients']=['59170000002'];self.config['allowed_senders']=['59170000002']
        self.service.snooze_reminder(value['id'],{'expected_revision':result['revision'],'at':'2026-11-01T14:00:00Z'})
        result=service.run_due()['items'][0];self.assertEqual(result['error_code'],'reminder_chat_changed');self.assertEqual(self.outbound.calls,[])

    def test_withdrawal_during_window_lookup_is_rechecked_before_send(self):
        def window(_):self.config['opted_in_recipients']=[];return self.clock[0]+60
        service=self.instance(allow_whatsapp_delivery=True,window_provider=window);self.whatsapp(service)
        result=service.run_due()['items'][0];self.assertEqual(result['state'],'delivery_blocked');self.assertEqual(self.outbound.calls,[])

    def test_cancellation_during_lookup_preserves_user_state_and_skips_send(self):
        def window(_):
            current=service.get_reminder(value['id']);service.cancel_reminder(value['id'],current['revision']);return self.clock[0]+60
        service=self.instance(allow_whatsapp_delivery=True,window_provider=window);value=self.whatsapp(service)
        service.run_due();self.assertEqual(service.get_reminder(value['id'])['state'],'cancelled');self.assertEqual(self.outbound.calls,[])

    def test_closing_scheduler_during_lookup_blocks_send_without_claiming_cancellation_of_a_provider(self):
        def window(_):service.close();return self.clock[0]+60
        service=self.instance(allow_whatsapp_delivery=True,window_provider=window);value=self.whatsapp(service)
        result=service.run_due()['items'][0];self.assertEqual(result['state'],'delivery_blocked');self.assertEqual(result['error_code'],'reminder_scheduler_stopped')
        self.assertEqual(self.outbound.calls,[]);self.assertEqual(service.run_due()['processed'],0)

    def test_daily_cap_persists_without_retries_and_new_day_allows_next_due(self):
        service=self.enabled(daily_cap=1);self.whatsapp(service);self.whatsapp(service,text='Otro aviso')
        self.assertEqual(service.run_due()['processed'],1);self.assertEqual(self.enabled(daily_cap=1).run_due()['processed'],0)
        self.clock[0]+=86400;self.assertEqual(self.enabled(daily_cap=1).run_due()['processed'],1);self.assertEqual(len(self.outbound.calls),2)

    def test_notes_revision_archive_and_kitchen_shopping_are_private_not_automatic_send(self):
        value=self.service.save_note({'expected_revision':0,'title':'Nota sintética','body':'Primera\nSegunda'})
        updated=self.service.save_note({'id':value['id'],'expected_revision':1,'title':'Revisada','body':'Contenido revisado'})
        with self.assertRaises(PersonalNotesError):self.service.archive_note(value['id'],1)
        self.service.archive_note(value['id'],updated['revision']);self.assertEqual(self.service.list_notes()['items'],[])
        shopping={'revision':3,'items':[{'label':'Quinua','quantity':100.,'unit':'g','checked':False},{'label':'Aceite','quantity':10.,'unit':'ml','checked':True}],'image':'PRIVATE ORIGINAL NOT COPIED'}
        with self.assertRaises(PersonalNotesError):self.service.capture_sous_note(shopping)
        note=self.service.capture_sous_note(shopping,explicit=True);self.assertEqual(note['kind'],'sous_shopping');self.assertIn('100 g de Quinua',note['body']);self.assertNotIn('Aceite',note['body'])
        self.assertNotIn(b'PRIVATE ORIGINAL',self.service.database.read_bytes());self.assertFalse(note['automatic_whatsapp_send']);self.assertEqual(self.outbound.calls,[])
        self.assertEqual(self.instance().list_notes()['items'][0]['source_revision'],3)

    def test_activity_note_uses_only_short_reviewed_step_labels_and_oversize_has_no_partial_write(self):
        snapshot={'revision':4,'recipe_title':'Receta sintética','steps':[{'label':'Preparar','state':'ready','observation':'PRIVATE CHAT NOT COPIED'},{'label':'Servir','state':'not_started'}]}
        note=self.service.capture_sous_note(snapshot,kind='activity',explicit=True);self.assertIn('Preparar',note['body']);self.assertNotIn('Servir',note['body']);self.assertNotIn('PRIVATE CHAT',note['body'])
        huge={'revision':1,'items':[{'label':'x'*120,'quantity':1.,'unit':'g','checked':False} for _ in range(40)]}
        with self.assertRaises(PersonalNotesError):self.service.capture_sous_note(huge,explicit=True)
        self.assertEqual(len(self.service.list_notes()['items']),1)

    def test_scheduler_needs_explicit_start_and_can_close_without_network(self):
        value=self.reminder();self.assertIsNone(self.service.thread)
        self.service.start_scheduler(interval_seconds=1)
        self.service.close();self.assertFalse(self.service.status()['scheduler_running']);self.assertEqual(self.outbound.calls,[])
        with self.assertRaises(PersonalNotesError):self.service.start_scheduler()
        self.assertIn(self.service.get_reminder(value['id'])['state'],{'scheduled','local_due'})


if __name__=='__main__':unittest.main()
