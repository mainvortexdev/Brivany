"""Install a pinned MIT-declared model for local synthetic voice-style matching."""
from hashlib import sha256
import json
from pathlib import Path
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
REVISION = '248c10727b11388f40df95c0f27ef6a2a7f50436'
BASE = f'https://huggingface.co/syntropicsignal-ai/gender-voice-classifier/resolve/{REVISION}'
MODEL_SHA256 = 'e98f8bc6d7960a8a2169368fe4533636903e712790e96dbff81b679ede5de252'
CARD_SHA256 = '5867eb11a2a3336a824235ed89ac397fbf72d0e593600a553b15dcb5ed9f05f8'


def _asset(folder, name, remote, expected, maximum):
    destination = folder / name
    if destination.is_file() and sha256(destination.read_bytes()).hexdigest() == expected:
        return destination.stat().st_size
    request = Request(BASE + '/' + remote, headers={'User-Agent':'Brivany-Local-Model-Setup/1.0'})
    with urlopen(request, timeout=30) as response:
        data = response.read(maximum + 1)
    if len(data) > maximum or sha256(data).hexdigest() != expected:
        raise ValueError('El archivo de timbre no coincide con la versión verificada.')
    temporary = destination.with_suffix(destination.suffix + '.download')
    temporary.write_bytes(data)
    temporary.replace(destination)
    return len(data)


def main():
    folder = ROOT / 'desktop/assets/audio'
    folder.mkdir(parents=True, exist_ok=True)
    size = _asset(folder, 'voice-timbre.onnx', 'gender_classifier_200k.onnx', MODEL_SHA256, 1000000)
    _asset(folder, 'voice-timbre-MODEL_CARD.md', 'README.md', CARD_SHA256, 50000)
    manifest = {'model':'syntropicsignal-ai/gender-voice-classifier', 'revision':REVISION,
                'source':BASE + '/gender_classifier_200k.onnx', 'sha256':MODEL_SHA256,
                'size_bytes':size, 'license_declared':'MIT', 'author':'Kamil Biduś / Syntropic Signal',
                'model_card_sha256':CARD_SHA256, 'sample_rate':16000, 'mfcc_coefficients':40,
                'maximum_window_seconds':3, 'execution_provider':'CPUExecutionProvider', 'threads':1}
    (folder / 'voice-timbre-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(manifest, ensure_ascii=False))


if __name__ == '__main__':
    main()
