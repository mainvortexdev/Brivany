"""Language switching invariants. No provider or paid audio inference."""
from copy import deepcopy
import unittest
from unittest.mock import patch
from packages.providers.palabra import LanguageSwitch,start_options,task_settings,effective_settings,quality_profile
from packages.providers.live_voice import VoiceError

class PalabraLiveTests(unittest.TestCase):
    def ack(self,command,event):return {'message_type':'task_status','data':{'command':command,'event':event,'task_status':'running'}}
    def audio(self,language,identifier='new'):
        return {'message_type':'output_audio_data','data':{'language':language,'transcription_id':identifier}}

    def test_three_languages_and_contextual_profile_are_explicit(self):
        with patch('packages.providers.palabra.palabra_key',return_value='synthetic'):
            for source,target in [('en','fr'),('fr','es'),('es','en')]:
                self.assertEqual(start_options({'type':'start','consent':True,'source_language':source,'target_language':target,'max_seconds':5,'quality_mode':'contextual_live'}),(source,target,5))
            with self.assertRaises(VoiceError):start_options({'type':'start','consent':True,'quality_mode':'invented'})
        settings=effective_settings(task_settings('en','es')['data'],'en','es')
        self.assertEqual(quality_profile(settings,'contextual_live')['quality_mode_effective'],'contextual_live')
        settings['only_confirm_by_silence']=None
        self.assertIsNone(quality_profile(settings,'contextual_live')['quality_mode_effective'])

    def test_switch_requires_both_acknowledgements_and_filters_old_language_and_ids(self):
        switch=LanguageSwitch('en','es',now=0);self.assertTrue(switch.accept(self.audio('es','old')))
        self.assertTrue(switch.begin({'type':'switch_language','target_language':'fr'},now=1));self.assertFalse(switch.accept(self.audio('fr')))
        self.assertIsNone(switch.acknowledge(self.ack('set_task','updated'),now=1.1))
        self.assertEqual(switch.acknowledge(self.ack('interrupt_task','interrupted'),now=1.2),'set_task')
        self.assertEqual(switch.acknowledge(self.ack('set_task','updated'),now=1.3),'changed')
        self.assertEqual(switch.target,'fr');self.assertEqual(switch.epoch,1)
        self.assertFalse(switch.accept(self.audio('es')));self.assertFalse(switch.accept(self.audio('fr','old')))
        self.assertFalse(switch.accept({'message_type':'output_audio_data','data':{'transcription_id':'new'}}))
        self.assertTrue(switch.accept(self.audio('fr')))

    def test_ambiguous_or_abusive_controls_never_invent_success(self):
        switch=LanguageSwitch('en','es',now=0)
        for control in ({'type':'switch_language','target_language':'en'},{'type':'switch_language','target_language':'zz'},
                {'type':'switch_language','target_language':'fr','url':'external'}):
            with self.assertRaises(VoiceError):switch.begin(control,now=1)
        switch.begin({'type':'switch_language','target_language':'fr'},now=1)
        with self.assertRaises(VoiceError):switch.begin({'type':'switch_language','target_language':'es'},now=2)
        with self.assertRaises(VoiceError):switch.check_deadline(now=10)

    def test_same_language_unseen_stale_output_is_not_claimed_detectable(self):
        switch=LanguageSwitch('en','es',now=0);switch.begin({'type':'switch_language','target_language':'fr'},now=1)
        switch.acknowledge(self.ack('interrupt_task','interrupted'),now=1.1);switch.acknowledge(self.ack('set_task','updated'),now=1.2)
        switch.begin({'type':'switch_language','target_language':'es'},now=2)
        switch.acknowledge(self.ack('interrupt_task','interrupted'),now=2.1);switch.acknowledge(self.ack('set_task','updated'),now=2.2)
        # Provider has no generation marker: an unseen same-language ID is
        # structurally accepted, not evidence of a complete upstream queue fence.
        self.assertTrue(switch.accept(self.audio('es','unseen')))

    def test_automatic_source_is_explicit_and_does_not_force_english_on_a_spanish_video(self):
        with patch('packages.providers.palabra.palabra_key',return_value='synthetic'):
            options={'type':'start','consent':True,'source_language':'auto','target_language':'fr','max_seconds':5}
            self.assertEqual(start_options(options),('auto','fr',5))
        settings=task_settings('auto','fr')['data']
        self.assertEqual(settings['pipeline']['transcription']['detectable_languages'],['en','es','fr'])
        observed=effective_settings(settings,'auto','fr');self.assertEqual(observed['source_language'],'auto')
        altered=deepcopy(settings);altered['pipeline']['transcription']['source_language']='es'
        self.assertEqual(effective_settings(altered,'auto','fr')['source_language'],'es')
        switch=LanguageSwitch('auto','fr',now=0)
        self.assertTrue(switch.accept({'message_type':'validated_transcription','data':{'transcription':{'language':'es','transcription_id':'spanish'}}}))

if __name__=='__main__':unittest.main()
