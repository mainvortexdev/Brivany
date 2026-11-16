"""Fixed, prebuilt Melodi listening cues. GET never synthesizes or records audio."""
from pathlib import Path
from packages.runtime_paths import DATA_ROOT
from packages.providers.cartesia_melodi import MODEL, VOICES

CUES={'es':{'aja':'Ajá.','entiendo':'Entiendo.','bien':'Bien.','claro':'Claro.','ya_veo':'Ya veo.',
            'te_escucho':'Te escucho.','continua':'Continúa.','te_sigo':'Te sigo.',
            'ya_entiendo':'Ya entiendo.','mmm':'Mmm.','si':'Sí.','cuentame':'Cuéntame.',
            'adelante':'Adelante.','aqui_estoy':'Aquí estoy.','sigo_aqui':'Sigo aquí.','de_acuerdo':'De acuerdo.'},
      'en':{'aja':'Uh-huh.','entiendo':'I see.','bien':'Okay.'}}
ROOT=DATA_ROOT/'.local/voice-cues'


def cue_path(language,key,root=None):
    if language not in CUES or key not in CUES[language]:raise ValueError('Señal de escucha no admitida.')
    return Path(root or ROOT)/f'{MODEL}-{VOICES[language]}-{language}-{key}.pcm'


def read_cue(language,key,root=None):
    path=cue_path(language,key,root)
    if not 0<path.stat().st_size<=240000 or path.stat().st_size%2:raise ValueError('Señal de escucha no válida.')
    return path.read_bytes()
