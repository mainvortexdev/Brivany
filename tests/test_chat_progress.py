import unittest
from services.computer.progress import media_progress

class ChatProgressTests(unittest.TestCase):
    def test_estimates_follow_observed_milestones_and_never_complete_early(self):
        values=[]
        for phase in ['Midiendo la referencia','Preparando mi voz','Ajustando el audio','Renderizando video','Revisando fotogramas','Comprobando formato']:
            value=media_progress({'kind':'motion','state':'running','phase':phase});values.append(value['percent']);self.assertTrue(value['estimated']);self.assertLess(value['percent'],100)
        self.assertEqual(values,sorted(values))
    def test_only_verified_delivered_media_can_reach_one_hundred(self):
        for kind in ['image','motion']:
            self.assertIsNone(media_progress({'kind':kind,'state':'failed','result':{'path':'wrong','verified':True}}))
            self.assertIsNone(media_progress({'kind':kind,'state':'succeeded','result':{'path':'unverified'}}))
            self.assertEqual(media_progress({'kind':kind,'state':'succeeded','result':{'path':'ready','verified':True}})['percent'],100)
        self.assertIsNone(media_progress({'kind':'desktop','state':'running'}))
    def test_queued_media_begins_at_one_and_unknown_running_phase_stays_an_estimate(self):
        self.assertEqual(media_progress({'kind':'image','state':'queued'})['percent'],1)
        self.assertTrue(media_progress({'kind':'motion','state':'running','phase':'Sin contador de fotogramas'})['estimated'])

    def test_generation_start_does_not_claim_seventy_percent(self):
        for kind,phase in [('image','Estoy creando la imagen.'),('image','Generando imagen'),('motion','Preparando el video')]:
            self.assertLessEqual(media_progress({'kind':kind,'state':'running','phase':phase})['percent'],8)
