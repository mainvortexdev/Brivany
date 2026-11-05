"""Small deterministic joke turns. Context belongs to the current session only."""
from dataclasses import dataclass
import re
import unicodedata


def normalized(text):
    plain=''.join(c for c in unicodedata.normalize('NFD',text.lower()) if not unicodedata.combining(c))
    return ' '.join(re.sub(r'[^a-z0-9 ]',' ',plain).split())


@dataclass(frozen=True)
class Joke:
    question: str
    answer: str
    guesses: tuple[str, ...]


JOKES = {
    'es': (
        Joke('¿Qué hace una abeja en un gimnasio?', '¡Zumba!', ('zumba','zumbando')),
        Joke('¿Qué le dice una pera a otra pera?', '¡Espera!', ('espera',)),
        Joke('¿Qué le dice un techo a otro techo?', '¡Techo de menos!', ('techo de menos',)),
    ),
    'en': (
        Joke('Why did the scarecrow win an award?', 'Because he was outstanding in his field!', ('outstanding in his field',)),
        Joke('What do you call a bear with no teeth?', 'A gummy bear!', ('gummy bear',)),
    ),
}


def dialogue_reply(value):
    """Known guesses are checked before revealing; silence never triggers a turn."""
    lang=value.language
    text=normalized(value.text)
    bank=JOKES[lang]
    if text in ('eh','em','mmm','mm','bueno','a ver','espera','un momento','espera un momento','dejame pensar','dame un segundo','estoy pensando','hmm','um','let me think','one moment','wait a moment'):
        return {'text':'','await_user':True,'silent':True}
    wants_joke=bool(re.search(r'\b(chiste|hazme reir|algo gracioso|joke|make me laugh)\b',text))
    if text in ('otro','otro mas','otro por favor','another one') and any(normalized(joke.question) in normalized(item.content) for item in value.history if item.role=='assistant' for joke in bank):wants_joke=True
    previous=next((normalized(item.content) for item in reversed(value.history) if item.role=='assistant'), '')
    pending=next((joke for joke in bank if normalized(joke.question) in previous and normalized(joke.answer) not in previous), None)
    topic_change=re.search(r'\b(cambiemos|cambia de tema|hablemos|basta|para|no quiero|estoy triste|me siento|necesito|ayudame|stop|change the subject|i need|help me|i feel)\b',text)
    if pending and not topic_change and not wants_joke:
        negated=bool(re.search(r'\b(no es|no hace|no creo|not|isnt|isn t|doesnt|doesn t)\b',text))
        guessed=not negated and any(re.search(r'\b'+re.escape(guess)+r'\b',text) for guess in pending.guesses)
        knew=bool(re.search(r'\b(ya me lo se|ya lo sabia|me lo sabia|ya me lo sabia|i know that one|heard that one)\b',text))
        if guessed or knew:
            return {'text':'¡Eh, ya te lo sabías!' if lang=='es' else 'Hey, you already knew that one!', 'laugh':True, 'await_user':False}
        if text in ('que','como','repite','repite la pregunta','what','repeat that','say that again'):
            return {'text':pending.question,'await_user':True}
        reveal=bool(re.search(r'\b(no se|ni idea|dimelo|dime|cual es|me rindo|no tengo idea|tell me|dont know|don t know|give up)\b',text))
        short_guess=len(text.split())<=8 and bool(re.match(r'^(hace|esta|sale|va|come|duerme|nada|trabaja|entrena|levanta|vuela|pesas|baila|no creo|he|she|it|because|a |to )\b',text)) and not re.search(r'\b(hola|gracias|adios|trabajo|familia|presentacion|reunion|triste|mal|enfermo|miedo|hello|thanks|sad|work)\b',text)
        if reveal or short_guess:
            prefix=('Bueno, ' if reveal else 'Casi… ') if lang=='es' else ('' if reveal else 'Close… ')
            return {'text':prefix+pending.answer,'laugh':True,'await_user':False}
    declined=bool(re.search(r'\b(no|ningun|sin|not|dont|don t|ofendio|ofensivo|molesta|incomodo|serio|offensive|upset|serious)\b',text))
    if wants_joke and not declined:
        previous_questions=[normalized(item.content) for item in value.history if item.role=='assistant']
        joke=next((joke for joke in bank if not any(normalized(joke.question) in item for item in previous_questions)),None)
        if lang=='es' and 'abeja' in text:joke=bank[0]
        if joke is None:return None
        return {'text':joke.question,'await_user':True}
    return None
