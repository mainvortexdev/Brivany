"""Deterministic interaction contracts; no external model calls or user data."""
import unittest
from unittest.mock import patch
from packages.providers.conversation import ConversationRequest, stream_reply
from packages.providers.melodi_dialogue import JOKES, dialogue_reply


class DialogueTests(unittest.TestCase):
    def request(self,text,language='es',question=None):
        return ConversationRequest(text=text,language=language,consent=True,history=[] if question is None else [{'role':'assistant','content':question}])

    def test_question_waits_without_leaking_punchline_or_using_meta(self):
        with patch('packages.providers.conversation.build_opener',side_effect=AssertionError('No provider call expected')):
            events=list(stream_reply(self.request('Cuéntame un chiste.')))
        self.assertEqual([e['type'] for e in events],['delta','sentence','done'])
        self.assertEqual(events[1]['text'],JOKES['es'][0].question)
        self.assertNotIn('zumba',str(events).lower());self.assertTrue(events[-1]['await_user'])

    def test_guessed_bee_joke_laughs_once_without_repeating_answer(self):
        for text in ('Zumba.','Hace zumba, ya lo conocía.','Zumbando.','Ya me lo sé.'):
            events=list(stream_reply(self.request(text,question=JOKES['es'][0].question)))
            self.assertIn('ya te lo sabías',events[1]['text'])
            self.assertNotIn('zumba',str(events).lower())
            self.assertTrue(events[1]['speech_text'].startswith('[laughter] '));self.assertFalse(events[-1]['await_user'])

    def test_explicit_dont_know_or_wrong_guess_can_reveal(self):
        for text in ('No sé.','Ni idea.','Sale volando.'):
            plan=dialogue_reply(self.request(text,question=JOKES['es'][0].question))
            self.assertIn('Zumba',plan['text']);self.assertNotIn('ya te lo sabías',plan['text']);self.assertFalse(plan['await_user'])
        plan=dialogue_reply(self.request('No hace zumba.',question=JOKES['es'][0].question))
        self.assertTrue(plan is None or 'ya te lo sabías' not in plan['text'])

    def test_repeat_keeps_waiting_and_topic_change_is_not_a_wrong_guess(self):
        plan=dialogue_reply(self.request('Repite la pregunta.',question=JOKES['es'][0].question))
        self.assertEqual(plan['text'],JOKES['es'][0].question);self.assertTrue(plan['await_user'])
        for text in ('Necesito ayuda con mi presentación.','Estoy triste.','Cambiemos de tema.','No quiero chistes.','Gracias.'):
            self.assertIsNone(dialogue_reply(self.request(text,question=JOKES['es'][0].question)))

    def test_another_joke_uses_session_context_without_repeating(self):
        request=self.request('Otro.',question=JOKES['es'][0].question)
        self.assertEqual(dialogue_reply(request)['text'],JOKES['es'][1].question)
        self.assertIsNone(dialogue_reply(self.request('No me cuentes un chiste.')))

    def test_english_guess_acknowledges_without_revealing_again(self):
        plan=dialogue_reply(self.request('He was outstanding in his field.',language='en',question=JOKES['en'][0].question))
        self.assertTrue(plan['laugh']);self.assertNotIn('field',plan['text']);self.assertIn('already knew',plan['text'])

    def test_explicit_thinking_pause_has_no_speech_or_model_request(self):
        with patch('packages.providers.conversation.build_opener',side_effect=AssertionError('Do not spend on silence')):
            for text in ('Déjame pensar.','Un momento.','Bueno…','Mmm…'):
                events=list(stream_reply(self.request(text,question=JOKES['es'][0].question)))
                self.assertEqual([event['type'] for event in events],['done']);self.assertTrue(events[0]['await_user'])


if __name__=='__main__':unittest.main()
