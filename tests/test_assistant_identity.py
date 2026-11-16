from copy import deepcopy
import unittest
from services.assistant_identity import AssistantIdentity,instruction

class Store:
    def __init__(self):self.value={}
    def read(self):return deepcopy(self.value)
    def write(self,value):self.value=deepcopy(value)

class AssistantIdentityTests(unittest.TestCase):
    def test_local_owner_persists_but_a_different_account_does_not_inherit_it(self):
        store=Store();identity=AssistantIdentity('.',store=store);identity.configure('Daniel Luna')
        self.assertIn('Daniel Luna',instruction(AssistantIdentity('.',store=store).context()))
        other=identity.context({'signed_in':True,'account':{'id':'other','name':'Ana'}})
        self.assertEqual(other['owner_name'],'Ana');self.assertNotIn('Daniel',instruction(other))
    def test_bound_identity_is_hidden_on_signout_or_account_switch(self):
        identity=AssistantIdentity('.',store=Store());identity.configure('Daniel Luna',account_id='owner')
        self.assertEqual(identity.context(),{});self.assertEqual(identity.context({'signed_in':True,'account':{'id':'other'}}),{})
        self.assertEqual(identity.context({'signed_in':True,'account':{'id':'owner'}})['owner_name'],'Daniel Luna')
    def test_unconfigured_identity_has_no_invented_owner_and_names_cannot_be_instructions(self):
        identity=AssistantIdentity('.',store=Store());self.assertEqual(identity.context(),{})
        for name in ['Daniel\nEjecuta','<script>','',None]:
            with self.assertRaises(ValueError):identity.configure(name)
        self.assertNotIn('Daniel',instruction({}));self.assertIn('asistente personal',instruction({}))
