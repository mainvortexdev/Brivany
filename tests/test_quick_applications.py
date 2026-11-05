import json
from pathlib import Path
import unittest
from services.computer.quick_actions import application_target,confirmation,process_count_query,public_lookup

class QuickApplicationTests(unittest.TestCase):
    def test_quick_public_lookups_match_shared_vectors(self):
        for text,expected in json.loads(Path('tests/quick-lookup-vectors.json').read_text(encoding='utf-8')):
            with self.subTest(text=text):self.assertEqual(public_lookup(text),expected)
    def test_explicit_requests_only(self):
        for text,expected in json.loads(Path('tests/quick-application-vectors.json').read_text(encoding='utf-8')):
            with self.subTest(text=text):self.assertEqual(application_target(text),expected)
    def test_acknowledgements_vary_without_claiming_completion(self):
        for app in (None,'word'):
            messages=[confirmation(i,app) for i in range(6)]
            self.assertGreaterEqual(len(set(messages)),3);self.assertTrue(all(a!=b for a,b in zip(messages,messages[1:])))
            self.assertFalse(any('he abierto' in message.casefold() or 'enviado' in message.casefold() for message in messages))
    def test_process_count_is_a_read_only_question_not_a_cited_example(self):
        self.assertTrue(process_count_query('Cuantos procesos tengo corriendo en mi pc ahora mismo?'))
        self.assertTrue(process_count_query('¿Cuántos procesos hay?'))
        self.assertFalse(process_count_query('Por ejemplo: cuantos procesos tengo corriendo en mi pc ahora mismo?'))
        self.assertFalse(process_count_query('Cuántos procesos hay y cierra todos'))
