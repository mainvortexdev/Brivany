"""Small authored recipe collection, not a claim of culinary authenticity.

Locality is supplied by the user. Regional tags only order suggestions; they do
not infer residence, certify a traditional recipe or retrieve external sources.
"""
from copy import deepcopy


SOURCE = {'kind': 'authored_local', 'note': 'Propuesta de práctica escrita para Brivany; no receta tradicional autenticada ni recomendación alimentaria personalizada.'}


def recipes(base):
    eggs = deepcopy(base)
    eggs.update(countries=[], locality_note='Práctica general, sin región atribuida.')
    quinoa = {
        'id': 'quinoa-vegetables-v1', 'title': 'Quinua con verduras', 'kind': 'curated_preset',
        'vegetarian': True, 'vegan': True, 'allergens': [], 'countries': ['Bolivia'],
        'locality_note': 'Propuesta con quinua para quien indique Bolivia. No se presenta como plato tradicional autenticado.',
        'source': deepcopy(SOURCE),
        'ingredients': [
            {'key': 'quinoa', 'label': 'Quinua seca', 'quantity': 100., 'unit': 'g', 'optional': False},
            {'key': 'vegetables', 'label': 'Verduras', 'quantity': 200., 'unit': 'g', 'optional': False},
            {'key': 'water', 'label': 'Agua potable', 'quantity': 250., 'unit': 'ml', 'optional': False},
            {'key': 'oil', 'label': 'Aceite', 'quantity': 10., 'unit': 'ml', 'optional': True}],
        'steps': [
            {'id': 'prepare', 'label': 'Preparar la quinua', 'instruction': 'Revisa el envase y lava la quinua si así lo indica. Lava y corta las verduras por separado.', 'criterion': 'Quinua preparada según el envase y verduras cortadas.'},
            {'id': 'quinoa', 'label': 'Cocer la quinua', 'instruction': 'Pon la quinua y el agua potable en una olla. Sigue las proporciones y el método de cocción del envase; ajusta el agua si lo requiere.', 'criterion': 'Quinua cocida y tierna según revisión humana; una imagen no mide temperatura.'},
            {'id': 'vegetables', 'label': 'Cocinar las verduras', 'instruction': 'Cocina las verduras removiendo y evitando que se quemen. Mezcla con la quinua cocida.', 'criterion': 'Verduras cocinadas según tu revisión y mezcla uniforme.'},
            {'id': 'finish', 'label': 'Apagar y servir', 'instruction': 'Apaga el fuego y sirve con cuidado.', 'criterion': 'Fuego apagado y preparación servida.'}],
        'safety_note': base['safety_note']}
    lentils = {
        'id': 'lentils-rice-v1', 'title': 'Lentejas con arroz', 'kind': 'curated_preset',
        'vegetarian': True, 'vegan': True, 'allergens': [], 'countries': [],
        'locality_note': 'Práctica general, sin región atribuida.', 'source': deepcopy(SOURCE),
        'ingredients': [
            {'key': 'lentils_cooked', 'label': 'Lentejas cocidas', 'quantity': 200., 'unit': 'g', 'optional': False},
            {'key': 'rice_cooked', 'label': 'Arroz cocido', 'quantity': 150., 'unit': 'g', 'optional': False},
            {'key': 'vegetables', 'label': 'Verduras', 'quantity': 150., 'unit': 'g', 'optional': False},
            {'key': 'oil', 'label': 'Aceite', 'quantity': 10., 'unit': 'ml', 'optional': True}],
        'steps': [
            {'id': 'prepare', 'label': 'Revisar ingredientes', 'instruction': 'Usa lentejas y arroz ya cocidos y conservados correctamente según sus envases. Lava y corta las verduras.', 'criterion': 'Ingredientes revisados y verduras preparadas; la cámara no certifica conservación.'},
            {'id': 'vegetables', 'label': 'Cocinar las verduras', 'instruction': 'Cocina las verduras removiendo con cuidado.', 'criterion': 'Verduras cocinadas según tu revisión.'},
            {'id': 'combine', 'label': 'Mezclar y calentar', 'instruction': 'Añade las lentejas y el arroz cocidos. Calienta de manera uniforme siguiendo las instrucciones de sus envases.', 'criterion': 'Preparación calentada y mezclada; la temperatura requiere comprobación humana adecuada.'},
            {'id': 'finish', 'label': 'Apagar y servir', 'instruction': 'Apaga el fuego y sirve con cuidado.', 'criterion': 'Fuego apagado y preparación servida.'}],
        'safety_note': base['safety_note']}
    return [eggs, quinoa, lentils]
