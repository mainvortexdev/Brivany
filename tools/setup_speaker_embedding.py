"""Install fixed Apache-2.0 declared speaker model assets; no audio upload."""
from hashlib import sha256
import json
from pathlib import Path
from urllib.request import Request, urlopen

from packages.providers.acoustic_speakers import MODEL_BYTES, MODEL_ID, MODEL_SHA256


ROOT = Path(__file__).resolve().parents[1]
URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx'
CARD_URL = 'https://modelscope.cn/api/v1/models/iic/speech_campplus_sv_zh_en_16k-common_advanced/repo?Revision=v1.0.0&FilePath=README.md'
CARD_SHA256 = '5cc4c68f2f5afc255564493686f2a22370ac86f86ba02117989fc5a39a6aff0a'
LICENSE_URL = 'https://raw.githubusercontent.com/modelscope/3D-Speaker/main/LICENSE'
LICENSE_SHA256 = 'c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4'


def _asset(folder, name, url, expected, maximum):
    path = folder / name
    if path.is_file() and sha256(path.read_bytes()).hexdigest() == expected:
        return path.stat().st_size
    with urlopen(Request(url, headers={'User-Agent':'Brivany-Local-Model-Setup/1.0'}), timeout=60) as response:
        raw = response.read(maximum + 1)
    if len(raw) > maximum or sha256(raw).hexdigest() != expected:
        raise ValueError('El modelo de hablantes no coincide con la versión verificada.')
    temporary = path.with_suffix(path.suffix + '.download')
    temporary.write_bytes(raw)
    temporary.replace(path)
    return len(raw)


def main():
    folder = ROOT / 'desktop/assets/audio'
    folder.mkdir(parents=True, exist_ok=True)
    size = _asset(folder, 'speaker-embedding.onnx', URL, MODEL_SHA256, MODEL_BYTES)
    _asset(folder, 'speaker-embedding-MODEL_CARD.md', CARD_URL, CARD_SHA256, 50000)
    _asset(folder, 'LICENSE-speaker-embedding.txt', LICENSE_URL, LICENSE_SHA256, 20000)
    manifest = {'model':MODEL_ID, 'source':URL, 'sha256':MODEL_SHA256, 'size_bytes':size,
                'license_declared':'Apache-2.0', 'model_card_source':CARD_URL,
                'model_card_sha256':CARD_SHA256, 'dimensions':192, 'sample_rate':16000,
                'execution_provider':'cpu', 'threads':1, 'cache_scope':'translation_session',
                'audio_persisted':False, 'real_identity_inferred':False}
    (folder / 'speaker-embedding-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(manifest))


if __name__ == '__main__':
    main()
