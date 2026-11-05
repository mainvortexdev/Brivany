"""Install pinned Apache-2.0-declared ONNX voice-catalog style advice."""
import argparse
from hashlib import sha256
import json
from pathlib import Path
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
MODEL = 'prithivMLmods/Common-Voice-Gender-Detection-ONNX'
REVISION = '8d7fc28d26889a8763098f9e49fed002b15d2d3f'
BASE = f'https://huggingface.co/{MODEL}/resolve/{REVISION}'
MODEL_SHA256 = 'a0934c2f8934878f264dd5072d07b1bbd176f051d285b2a7910dfaa173747695'
MODEL_BYTES = 95387498
CARD_SHA256 = '74dafc65bd3c99d21cf69950ed0b56b9a59122601c674e729f1b101efa5ae49f'
LICENSE_URL = 'https://www.apache.org/licenses/LICENSE-2.0.txt'
LICENSE_SHA256 = 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30'


def _verified(data, expected, maximum):
    if len(data) > maximum or sha256(data).hexdigest() != expected:
        raise ValueError('El archivo de timbre no coincide con la versión verificada.')
    return data


def _asset(folder, name, remote, expected, maximum, local=None):
    destination = folder / name
    if destination.is_file() and sha256(destination.read_bytes()).hexdigest() == expected:
        return destination.stat().st_size
    if local is None:
        url = remote if remote.startswith('https://') else BASE + '/' + remote
        request = Request(url, headers={'User-Agent':'Brivany-Local-Model-Setup/1.0'})
        with urlopen(request, timeout=45) as response:
            data = response.read(maximum + 1)
    else:
        with Path(local).open('rb') as source:
            data = source.read(maximum + 1)
    _verified(data, expected, maximum)
    temporary = destination.with_suffix(destination.suffix + '.download')
    temporary.write_bytes(data)
    temporary.replace(destination)
    return len(data)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--local-directory', type=Path, help='Reuse already downloaded pinned model/card without network')
    args = parser.parse_args()
    folder = ROOT / 'desktop/assets/audio'
    folder.mkdir(parents=True, exist_ok=True)
    local = args.local_directory
    size = _asset(folder, 'robust-voice-timbre.onnx', 'onnx/model_quantized.onnx', MODEL_SHA256, MODEL_BYTES,
                  local / 'model_quantized.onnx' if local else None)
    _asset(folder, 'robust-voice-timbre-MODEL_CARD.md', 'README.md', CARD_SHA256, 50000,
           local / 'README.md' if local else None)
    _asset(folder, 'robust-voice-timbre-LICENSE.txt', LICENSE_URL, LICENSE_SHA256, 20000,
           local / 'LICENSE-2.0.txt' if local else None)
    manifest = {'model':MODEL, 'revision':REVISION, 'source':BASE + '/onnx/model_quantized.onnx',
                'sha256':MODEL_SHA256, 'size_bytes':size, 'license_declared':'Apache-2.0',
                'author':'prithivMLmods', 'model_card_sha256':CARD_SHA256,
                'sample_rate':16000, 'source_sample_rate':24000, 'maximum_window_seconds':3,
                'window_selection':'central_single_window', 'confidence_threshold':.85,
                'labels':{'0':'feminine_catalog_style', '1':'masculine_catalog_style'},
                'execution_provider':'CPUExecutionProvider', 'threads':1,
                'model_card_source':BASE + '/README.md'}
    manifest.update(license_text_source=LICENSE_URL, license_text_sha256=LICENSE_SHA256,
                    base_model='prithivMLmods/Common-Voice-Gender-Detection',
                    architecture_base='facebook/wav2vec2-base-960h')
    (folder / 'robust-voice-timbre-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(manifest, ensure_ascii=False))


if __name__ == '__main__':
    main()
