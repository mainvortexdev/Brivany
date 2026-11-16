"""Build-time only download of Google's Apache-2.0 YAMNet classifier, hash-pinned."""
import hashlib
import os
import ssl
import urllib.request
from pathlib import Path

MODEL_URL = "https://storage.googleapis.com/download.tensorflow.org/models/tflite/task_library/audio_classification/android/lite-model_yamnet_classification_tflite_1.tflite"
MODEL_SHA256 = "10c95ea3eb9a7bb4cb8bddf6feb023250381008177ac162ce169694d05c317de"
MODEL_BYTES = 4_126_810


def verify(data: bytes) -> bytes:
    if len(data) != MODEL_BYTES or hashlib.sha256(data).hexdigest() != MODEL_SHA256:
        raise ValueError("yamnet_model_hash_mismatch")
    return data


if __name__ == "__main__":
    destination = Path(os.environ.get("YAMNET_MODEL_PATH", "/app/models/yamnet-classification.tflite"))
    destination.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(MODEL_URL, headers={"Accept-Encoding": "identity"})
    with urllib.request.urlopen(request, context=ssl.create_default_context(), timeout=30) as source:
        if source.geturl() != MODEL_URL:
            raise ValueError("yamnet_model_redirect_rejected")
        data = source.read(MODEL_BYTES + 1)
    destination.write_bytes(verify(data))
