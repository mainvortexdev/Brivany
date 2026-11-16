"""Local canonical notes/timer behavior. All text is synthetic owned test data."""
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest

from desktop.experience.widget_state import WidgetState, MAX_DURATION


class Alarm:
    def __init__(self, delay, callback):
        self.delay, self.callback = delay, callback
        self.cancelled = self.started = False
    def start(self):self.started = True
    def cancel(self):self.cancelled = True


class StateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'private' / 'widgets.json'
        self.now = [1000000]; self.alarms = []; self.events = []
        def schedule(delay, callback):
            alarm = Alarm(delay, callback); self.alarms.append(alarm); return alarm
        self.state = WidgetState(self.path, clock=lambda: self.now[0],
                                 alarm_factory=schedule, publish=self.events.append)
        self.addCleanup(self.state.close)

    def seed(self):
        return self.state.connect({'note': 'Nota propia inicial.', 'timer': None})

    def test_unused_state_never_creates_a_worker_alarm_or_file(self):
        self.assertIsNone(self.state.writer); self.assertIsNone(self.state.alarm)
        self.assertFalse(self.path.exists()); self.state.close()
        self.assertFalse(self.path.exists())

    def test_migrate_once_and_reopen_preserves_newer_canonical_note(self):
        first = self.seed()
        value = self.state.update_note('Edición propia nueva.', first['note_revision'], 'workspace-panel')
        self.assertFalse(value['conflict'])
        self.state.connect({'note': 'Una copia antigua.', 'timer': None})
        self.assertEqual(self.state.snapshot()['note'], 'Edición propia nueva.')
        self.state.close()
        other = WidgetState(self.path); self.addCleanup(other.close)
        self.assertEqual(other.snapshot()['note'], 'Edición propia nueva.')
        self.assertTrue(other.snapshot()['initialized'])

    def test_timer_actions_use_deadline_and_note_edits_do_not_reset_it(self):
        value = self.seed(); running = self.state.timer_action('start', 5000)
        self.assertEqual(running['timer']['deadline'], self.now[0] + 5000)
        self.state.update_note('Texto propio.', value['note_revision'], 'native-notes')
        self.assertEqual(self.state.snapshot()['timer'], running['timer'])
        self.now[0] += 1250
        paused = self.state.timer_action('toggle')['timer']
        self.assertEqual(paused['state'], 'paused'); self.assertEqual(paused['remaining'], 3750)
        self.assertTrue(self.alarms[-1].cancelled)
        self.now[0] += 500
        resumed = self.state.timer_action('toggle')['timer']
        self.assertEqual(resumed['deadline'], self.now[0] + 3750)
        reset = self.state.timer_action('reset')['timer']
        self.assertEqual(reset['state'], 'idle'); self.assertEqual(reset['remaining'], 5000)

    def test_old_alarm_cannot_finish_a_new_timer_and_finish_is_idempotent(self):
        self.seed(); self.state.timer_action('start', 1000); old = self.alarms[-1]
        self.state.timer_action('start', 3000)
        self.now[0] += 1100; old.callback()
        self.assertEqual(self.state.snapshot()['timer']['state'], 'running')
        self.now[0] += 2000; self.alarms[-1].callback()
        value = self.state.snapshot()
        self.assertEqual(value['timer']['state'], 'finished')
        self.state.timer_action('finish')
        self.assertEqual(self.state.snapshot()['revision'], value['revision'])

    def test_conflict_preserves_both_edits_until_explicit_resolution(self):
        initial = self.seed()
        first = self.state.update_note('Primera edición propia.', initial['note_revision'], 'native-notes')
        conflict = self.state.update_note('Segunda edición propia.', initial['note_revision'], 'workspace-panel')
        self.assertTrue(conflict['conflict'])
        self.assertEqual(self.state.snapshot()['note'], 'Primera edición propia.')
        self.assertEqual(self.state.snapshot()['drafts']['workspace-panel']['text'], 'Segunda edición propia.')
        again = self.state.update_note('Borrador propio ajustado.', first['state']['note_revision'], 'workspace-panel')
        self.assertTrue(again['conflict'])
        self.state.close()
        loaded = WidgetState(self.path); self.addCleanup(loaded.close)
        self.assertEqual(loaded.snapshot()['drafts']['workspace-panel']['text'], 'Borrador propio ajustado.')
        replaced = loaded.update_note('Borrador propio ajustado.', loaded.note_revision, 'workspace-panel', True)
        self.assertFalse(replaced['conflict']); self.assertNotIn('workspace-panel', loaded.snapshot()['drafts'])
        self.assertEqual(loaded.snapshot()['note'], 'Borrador propio ajustado.')

    def test_discard_conflict_keeps_current_note_and_does_not_change_note_revision(self):
        initial = self.seed(); current = self.state.update_note('Valor propio.', initial['note_revision'], 'native-notes')['state']
        self.state.update_note('Borrador propio.', initial['note_revision'], 'workspace-panel')
        value = self.state.discard_draft('workspace-panel')
        self.assertEqual(value['note'], 'Valor propio.')
        self.assertEqual(value['note_revision'], current['note_revision'])
        self.assertEqual(value['drafts'], {})

    def test_concurrent_editors_do_not_silently_overwrite_one_another(self):
        initial = self.seed(); barrier = threading.Barrier(3); results = []
        def edit(source):
            barrier.wait(); results.append(self.state.update_note(source, initial['note_revision'], source))
        workers = [threading.Thread(target=edit, args=(name,)) for name in ('workspace-panel', 'native-notes')]
        for worker in workers:worker.start()
        barrier.wait()
        for worker in workers:worker.join(2)
        self.assertEqual(sorted(result['conflict'] for result in results), [False, True])
        self.assertEqual(len(self.state.snapshot()['drafts']), 1)

    def test_setting_and_position_updates_never_change_note_or_timer(self):
        self.seed(); self.state.timer_action('start', 1000); before = self.state.snapshot()
        self.state.settings(True); self.state.position('notes', {'x': -900, 'y': 80})
        after = self.state.snapshot()
        self.assertEqual(after['note'], before['note']); self.assertEqual(after['timer'], before['timer'])
        self.assertTrue(after['topmost']); self.assertEqual(after['positions']['notes']['x'], -900)

    def test_strict_bounds_and_source_allowlist(self):
        self.seed()
        for duration in (True, 0, 999, MAX_DURATION + 1, float('nan'), '1000'):
            with self.subTest(duration=duration), self.assertRaises(ValueError):
                self.state.timer_action('start', duration)
        for note in ('x' * 4001, '🙂' * 2001, None):
            with self.assertRaises(ValueError):
                self.state.update_note(note, self.state.note_revision, 'native-notes')
        self.state.update_note('🙂' * 2000, self.state.note_revision, 'native-notes')
        with self.assertRaises(ValueError):self.state.update_note('own', 0, 'unknown')
        with self.assertRaises(ValueError):self.state.position('notes', {'x': True, 'y': 0})
        with self.assertRaises(ValueError):self.state.settings('true')

    def test_corrupt_file_is_preserved_and_never_overwritten_by_legacy_seed(self):
        path = Path(self.temp.name) / 'corrupt.json'; raw = b'not-valid-json'
        path.write_bytes(raw); state = WidgetState(path)
        with self.assertRaises(ValueError):state.connect({'note': 'Own seed.'})
        state.close(); self.assertTrue(path.read_bytes() == raw)

    def test_close_flushes_last_edit_and_rejects_late_changes(self):
        value = self.seed(); self.state.update_note('Último texto propio.', value['note_revision'], 'workspace-panel')
        self.state.close()
        self.assertEqual(json.loads(self.path.read_text())['note'], 'Último texto propio.')
        self.assertIsNone(self.state.alarm)
        self.assertFalse(self.state.writer and self.state.writer.is_alive())
        with self.assertRaises(ValueError):self.state.timer_action('start', 1000)

    def test_save_worker_quiesces_after_short_edits(self):
        first = self.seed()
        for i in range(4):
            current = self.state.snapshot()
            self.state.update_note('Texto propio ' + str(i), current['note_revision'], 'workspace-panel')
        deadline = time.monotonic() + 2
        while self.state.writer and time.monotonic() < deadline:
            time.sleep(.02)
        self.assertIsNone(self.state.writer)
        self.assertEqual(json.loads(self.path.read_text())['note'], 'Texto propio 3')

    def test_second_view_connect_does_not_restart_deadline_alarm(self):
        self.seed();self.state.timer_action('start',1000);alarm=self.state.alarm
        self.state.connect({'note':'Old own copy.'});self.assertIs(self.state.alarm,alarm)
        self.assertFalse(alarm.cancelled)

    def test_identical_stale_retry_is_acknowledged_without_false_conflict(self):
        first=self.seed();current=self.state.update_note('Own saved text.',first['note_revision'],'workspace-panel')['state']
        retry=self.state.update_note('Own saved text.',first['note_revision'],'workspace-panel')
        self.assertFalse(retry['conflict']);self.assertEqual(retry['state']['note_revision'],current['note_revision'])

    def test_invalid_legacy_timer_does_not_prevent_note_recovery(self):
        value=self.state.connect({'note':'Own recoverable note.','timer':{'duration':-5}})
        self.assertEqual(value['note'],'Own recoverable note.');self.assertEqual(value['timer']['state'],'idle');self.assertTrue(value['notice'])

    def test_expired_running_timer_is_normalized_and_persisted_on_connect(self):
        self.seed();self.state.timer_action('start',1000);self.state.close();self.now[0]+=2000
        loaded=WidgetState(self.path,clock=lambda:self.now[0]);self.addCleanup(loaded.close)
        self.assertEqual(loaded.snapshot()['timer']['state'],'finished');loaded.connect();loaded.close()
        self.assertEqual(json.loads(self.path.read_text())['timer']['state'],'finished')

    def test_shutdown_between_alarm_epoch_check_and_finish_is_quiet(self):
        self.seed();self.state.timer_action('start',1000);alarm=self.state.alarm;self.now[0]+=1200
        original=self.state.timer_action
        def closing(*args,**kwargs):
            self.state.close();return original(*args,**kwargs)
        self.state.timer_action=closing
        alarm.callback()
        self.assertTrue(self.state.closed);self.assertIsNone(self.state.alarm)


if __name__ == '__main__':
    unittest.main()
