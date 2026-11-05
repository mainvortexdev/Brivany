import json
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
from services.terminal.diagnostics import SOURCES
from services.terminal.service import TerminalService
from services.computer.quick_actions import diagnostic_question

class DiagnosticsTests(unittest.TestCase):
    def test_python_and_native_capability_catalogs_match(self):
        raw=subprocess.check_output(['node','-e',"process.stdout.write(JSON.stringify(require('./desktop/computer/systemQuery.cjs').SOURCES))"],text=True,encoding='utf-8')
        self.assertEqual({k:v['fields'] for k,v in json.loads(raw).items()},SOURCES)
    def test_a_previously_unseen_question_uses_real_facts_instead_of_documentation(self):
        query={'source':'processes','fields':['ProcessName','WorkingSet64'],'where':[],'sort':{'property':'WorkingSet64','descending':True},'limit':3,'aggregate':None};decisions=[];calls=[]
        class Runtime:
            def call(self,method,**kw):
                calls.append(method);return {'verified':True,'rows':[{'ProcessName':'OwnFixture','WorkingSet64':104857600}],'source_command':'Get-Process','observed_at':'fixture'}
        def decide(prompt,data):
            decisions.append(data)
            return {'operation':'system_query','query':query} if 'diagnostic_tools' in data else {'message':'OwnFixture utiliza 100 MiB de RAM.'}
        with tempfile.TemporaryDirectory() as folder:
            service=TerminalService(folder)
            try:
                result=service.run('¿Qué tres procesos usan más memoria RAM?',decide=decide,identifier='fixture',cancelled=threading.Event(),progress=lambda _:None,runtime=Runtime())
                self.assertTrue(result['verified']);self.assertIn('100 MiB',result['message']);self.assertEqual(calls,['system_query']);self.assertEqual(len(decisions),2);self.assertEqual(decisions[1]['facts']['rows'][0]['WorkingSet64'],104857600)
            finally:service.close()
    def test_diagnostic_intent_never_turns_examples_or_changes_into_reads(self):
        self.assertTrue(diagnostic_question('¿Qué servicios automáticos están detenidos ahora?'))
        self.assertTrue(diagnostic_question('Dime qué volúmenes tienen menos espacio libre.'))
        self.assertFalse(diagnostic_question('Qué procesos hay y cierra los tres primeros'))
        self.assertFalse(diagnostic_question('Por ejemplo, qué procesos hay'))
