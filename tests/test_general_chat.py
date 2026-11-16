import io
import json
import unittest
from unittest.mock import Mock,patch
from packages.providers import general_chat
from packages.providers.conversation import ConversationRequest,stream_reply

class GeneralChatTests(unittest.TestCase):
    def test_live_voice_keeps_meta_when_general_chat_has_another_provider(self):
        wire=b'data: {"choices":[{"delta":{"content":"Podemos conversar."},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
        with patch.dict('os.environ',{'BRIVANY_META_API_KEY':'synthetic-meta','BRIVANY_META_MODEL':'synthetic-live-model'}),patch.object(general_chat,'configuration') as alternate,patch('packages.providers.conversation.build_opener') as opener:
            opener.return_value.open.return_value=io.BytesIO(wire)
            result=list(stream_reply(ConversationRequest(text='Podemos conversar',consent=True,source='voice'),instructions='Identidad de voz de prueba.'))
        alternate.assert_not_called();request=opener.return_value.open.call_args.args[0];self.assertEqual(request.full_url,'https://api.meta.ai/v1/chat/completions');self.assertEqual(json.loads(request.data)['model'],'synthetic-live-model');self.assertEqual(result[-1]['text'],'Podemos conversar.')
    def test_relay_uses_client_secret_and_status_never_exposes_either_secret(self):
        value={'enabled':True,'api_key':'fixture-provider-key','client_token':'a'*64,'relay_url':'https://brivany-melodi-chat.fixture.workers.dev','model':'deepseek-ai/DeepSeek-V4-Flash'}
        with patch.object(general_chat,'store',return_value=Mock(read=lambda:value)):
            config=general_chat.configuration();status=general_chat.status()
        self.assertEqual(config['key'],'a'*64);self.assertNotIn('fixture-provider-key',json.dumps(status));self.assertNotIn('a'*64,json.dumps(status))
        self.assertTrue(status['enabled']);self.assertTrue(status['via_cloudflare'])
    def test_private_configuration_cannot_redirect_client_credentials_to_another_host(self):
        value={'enabled':True,'client_token':'a'*64,'relay_url':'https://attacker.invalid','model':'deepseek-ai/DeepSeek-V4-Flash'}
        with patch.object(general_chat,'store',return_value=Mock(read=lambda:value)),self.assertRaises(ValueError):general_chat.configuration()
    def test_deepseek_stream_keeps_only_public_answer_and_uses_compatible_parameters(self):
        frames=[{'choices':[{'delta':{'reasoning_content':'Private reasoning fixture'}}]},
                {'choices':[{'delta':{'content':'Listo.'},'finish_reason':'stop'}]}]
        wire=b''.join(b'data: '+json.dumps(frame).encode()+b'\n\n' for frame in frames)+b'data: [DONE]\n\n'
        config={'key':'fixture-client-key','model':'deepseek-ai/DeepSeek-V4-Flash','endpoint':'https://brivany-melodi-chat.fixture.workers.dev/v1/chat/completions'}
        with patch.object(general_chat,'configuration',return_value=config),patch('packages.providers.conversation.build_opener') as opener:
            opener.return_value.open.return_value=io.BytesIO(wire)
            result=list(stream_reply(ConversationRequest(text='Comprueba la conexión',consent=True)))
        request=opener.return_value.open.call_args.args[0];body=json.loads(request.data)
        self.assertEqual(request.full_url,config['endpoint']);self.assertEqual(body['messages'][0]['role'],'system')
        self.assertEqual(body['enable_thinking'],False);self.assertIn('max_tokens',body);self.assertNotIn('max_completion_tokens',body)
        self.assertEqual(result[-1]['text'],'Listo.');self.assertNotIn('Private reasoning',json.dumps(result))

if __name__=='__main__':unittest.main()
