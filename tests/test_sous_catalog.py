"""Real local inventory/catalog/shopping persistence; no models or network."""
from copy import deepcopy
from pathlib import Path
import tempfile
import unittest

from services.sous import SousService, SousError, RECIPE
from services.sous_voice import SousVoiceService


class SousCatalogTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.service=SousService(self.root)

    def preferences(self,**changes):
        old=self.service.preferences();payload={key:deepcopy(old[key]) for key in ('locality','vegetarian','vegan','allergens','recipe_id')}
        payload.update(changes);payload['expected_revision']=old['revision'];return self.service.save_preferences(payload)

    def ingredient(self,label,quantity,unit):
        return self.service.save_item({'label':label,'quantity':quantity,'unit':unit,'confidence':1.,'confirmed':True})

    def test_catalog_does_not_infer_locality_and_bolivia_only_reorders_after_declaration(self):
        initial=self.service.catalog();self.assertEqual(len(initial['recipes']),3)
        self.assertIsNone(initial['preferences']['locality']);self.assertFalse(any(item['matches_declared_country'] for item in initial['recipes']))
        self.preferences(locality={'country':'Bolivia','city':'La Paz'})
        catalog=SousService(self.root).catalog();self.assertEqual(catalog['recipes'][0]['id'],'quinoa-vegetables-v1')
        self.assertEqual(catalog['preferences']['locality_source'],'user_declared');self.assertFalse(catalog['automatic_geolocation'])
        self.assertFalse(catalog['sources_verified']);self.assertIn('No se presenta como plato tradicional',catalog['recipes'][0]['locality_note'])

    def test_other_country_has_no_false_regional_match_and_preferences_conflict(self):
        self.preferences(locality={'country':'Canadá'})
        self.assertFalse(any(item['matches_declared_country'] for item in self.service.catalog()['recipes']))
        value=self.service.preferences()
        with self.assertRaises(SousError):self.service.save_preferences({**{key:value[key] for key in ('locality','vegetarian','vegan','allergens','recipe_id')},'expected_revision':1})

    def test_quinoa_uses_confirmed_inventory_and_respects_vegan_and_units(self):
        self.preferences(vegan=True,recipe_id='quinoa-vegetables-v1')
        self.ingredient('Quinua seca',.2,'kg');self.ingredient('Verduras',300,'g');self.ingredient('Agua potable',1,'l')
        plan=self.service.plan_meals({});self.assertEqual(plan['eligibility']['status'],'ready')
        self.assertEqual(plan['recipe']['id'],'quinoa-vegetables-v1');self.assertEqual(plan['cart']['items'][0]['key'],'oil')
        self.assertFalse(plan['cart']['prices_known']);self.assertIsNone(plan['cart']['items'][0]['estimated_total_usd'])
        self.assertEqual(self.service.plan_meals({'recipe_id':RECIPE['id']})['eligibility']['status'],'blocked_constraint')
        with self.assertRaises(SousError):self.service.start_session({'recipe_id':RECIPE['id']})
        self.preferences(allergens=['maní']);self.assertEqual(self.service.plan_meals({})['eligibility']['status'],'blocked_constraint')

    def test_cooked_and_uncooked_rice_are_not_interchangeable(self):
        self.ingredient('Arroz seco',150,'g');self.ingredient('Lentejas secas',200,'g');self.ingredient('Verduras',200,'g')
        plan=self.service.plan_meals({'recipe_id':'lentils-rice-v1'})
        self.assertEqual(plan['eligibility']['status'],'missing_ingredients')
        self.assertEqual({item['key'] for item in plan['cart']['items']},{'lentils_cooked','rice_cooked','oil'})

    def test_compound_products_or_negated_labels_are_not_raw_ingredient_substitutes(self):
        for label in ('Harina de quinua','Pan con huevo','Producto sin huevo','Agua con azúcar'):
            self.ingredient(label,1000,'g' if label!='Producto sin huevo' else 'unit')
        eggs=self.service.plan_meals({'recipe_id':RECIPE['id']})
        quinoa=self.service.plan_meals({'recipe_id':'quinoa-vegetables-v1'})
        self.assertEqual(eggs['eligibility']['selected_items'],[]);self.assertEqual(quinoa['eligibility']['selected_items'],[])
        self.assertEqual(eggs['eligibility']['status'],'missing_ingredients')

    def test_sessions_snapshot_the_selected_recipe_and_voice_reads_its_step(self):
        self.preferences(recipe_id='quinoa-vegetables-v1',locality={'country':'Bolivia'})
        session=self.service.start_session({'recipe_id':'quinoa-vegetables-v1'})
        self.preferences(recipe_id=RECIPE['id'])
        reopened=SousService(self.root).get_session(session['id']);self.assertEqual(reopened['steps'][0]['label'],'Preparar la quinua')
        context=SousVoiceService(self.service).context(session['id']);self.assertEqual(context['recipe']['id'],'quinoa-vegetables-v1')
        self.assertEqual(context['locality']['country'],'Bolivia');self.assertFalse(context['actions_enabled'])

    def test_shopping_missing_ingredients_persist_and_can_be_edited_checked_removed(self):
        first=self.service.add_plan_to_shopping({'expected_revision':1,'recipe_id':'quinoa-vegetables-v1'})
        self.assertEqual(len(first['items']),4);self.assertFalse(first['purchases_enabled']);self.assertFalse(first['prices_known'])
        same=self.service.add_plan_to_shopping({'expected_revision':first['revision'],'recipe_id':'quinoa-vegetables-v1'})
        self.assertEqual(len(same['items']),4)
        items=deepcopy(same['items']);items[0].update(quantity=300.,checked=True,note='Revisar tamaño del envase');items.pop()
        edited=self.service.save_shopping_list({'expected_revision':same['revision'],'items':items})
        reopened=SousService(self.root).shopping_list();self.assertEqual(reopened,edited);self.assertEqual(reopened['items'][0]['quantity'],300.)
        self.assertTrue(reopened['items'][0]['checked']);self.assertEqual(len(reopened['items']),3)
        with self.assertRaises(SousError):self.service.save_shopping_list({'expected_revision':1,'items':[]})

    def test_invalid_lists_and_unknown_recipes_are_rejected_without_mutation(self):
        for items in ([{'label':'A','quantity':-1,'unit':'g','checked':False}],
                      [{'label':'A','quantity':1,'unit':'g','checked':False,'price':4}],
                      [{'label':'A','quantity':1,'unit':'g','checked':False}]*101):
            with self.assertRaises(SousError):self.service.save_shopping_list({'expected_revision':1,'items':items})
        with self.assertRaises(SousError):self.service.start_session({'recipe_id':'untrusted-recipe'})
        self.assertEqual(self.service.shopping_list()['items'],[])


if __name__=='__main__':unittest.main()
