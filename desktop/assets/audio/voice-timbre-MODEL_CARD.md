---
language:
  - en
  - de
  - fr
  - es
  - it
license: mit
tags:
  - audio
  - speech
  - gender-classification
  - voice
  - onnx
  - lstm
datasets:
  - librispeech_asr
  - google/fleurs
metrics:
  - accuracy
  - f1
pipeline_tag: audio-classification
library_name: onnxruntime
model-index:
  - name: gender-voice-classifier-200k
    results:
      - task:
          type: audio-classification
        dataset:
          name: LibriSpeech test-clean
          type: librispeech_asr
        metrics:
          - type: accuracy
            value: 0.9439
      - task:
          type: audio-classification
        dataset:
          name: FLEURS test (EN/DE/FR/ES/IT)
          type: google/fleurs
        metrics:
          - type: accuracy
            value: 0.9434
---

# Gender Voice Classifier — Sub-1MB Bi-LSTM

A lightweight voice gender classifier designed as a preprocessing component
for real-time voice AI pipelines. Runs on CPU in under 5 ms, exported to ONNX,
no PyTorch required at inference time.

**Model size:** 0.64 MB  |  **Parameters:** 166K  |  **Inference:** ~4 ms (CPU, single-threaded)

## Motivation

We build voice AI assistants for clients across European markets. In languages with
grammatical gender (Polish, German, French, Spanish, Italian), addressing someone
requires correct inflection of adjectives, verb forms, and honorifics. Human agents
recognise the caller's gender from their voice in the first seconds of a call and
adjust naturally. This model gives voice pipelines the same capability.

## Usage

```python
import numpy as np
import librosa
import onnxruntime as ort

# Load model
session = ort.InferenceSession("gender_classifier_200k.onnx")

# Load and preprocess audio (16kHz mono, 3s clip)
audio, _ = librosa.load("your_audio.wav", sr=16000, mono=True)
audio = audio[:48000]  # truncate to 3s

# Extract MFCCs
mfcc = librosa.feature.mfcc(
    y=audio, sr=16000, n_mfcc=40, n_fft=512, hop_length=160, n_mels=80
)
mfcc = (mfcc - mfcc.mean(axis=1, keepdims=True)) / (mfcc.std(axis=1, keepdims=True) + 1e-8)
mfcc = mfcc[np.newaxis, :, :].astype(np.float32)  # (1, 40, T)

# Predict
logit = session.run(["logits"], {"mfcc": mfcc})[0][0, 0]
prob_female = 1 / (1 + np.exp(-logit))
gender = "female" if prob_female > 0.5 else "male"
print(gender, f"{prob_female:.2%}")
```

## Benchmark Results

Evaluated on four held-out test sets (none seen during training):

| Dataset | Accuracy | Male Acc | Female Acc | F1 | Avg Inference |
|---------|----------|----------|------------|-----|---------------|
| LibriSpeech test-clean | 94.4% | 95.0% | 93.8% | 0.947 | 4.2 ms |
| LibriSpeech test-other | 90.9% | 83.6% | 99.3% | 0.911 | 3.8 ms |
| FLEURS test (EN/DE/FR/ES/IT) | 94.3% | 90.4% | 99.5% | 0.938 | 6.6 ms |
| Edinburgh International Accents (EdAcc) | 75.6% | 86.1% | 50.7% | 0.551 | 3.7 ms |

Inference measured on CPU, single-threaded ONNX Runtime.

**Scope:** The target distribution is standard-accent speech in the five training
languages (EN, DE, FR, ES, IT). EdAcc is included as an out-of-scope stress test on
strongly accented international English; it is not representative of the production
deployment target. For speaker populations beyond the target distribution, retrain
with accented corpora such as VCTK.

## Architecture

- 2-layer Bidirectional LSTM, hidden size 64 per direction
- Soft attention pooling over time steps
- Classifier head: Linear(128→32) → ReLU → Dropout → Linear(32→1)
- Input: 40 MFCC coefficients, 3-second clips at 16 kHz
- Output: single logit, sigmoid > 0.5 → female

## Training

- **Data:** LibriSpeech train-clean-100 (EN) + FLEURS train split (EN/DE/FR/ES/IT)
- **Balanced:** 50/50 male/female by undersampling
- **Optimizer:** AdamW, lr=1e-3, cosine annealing, 20 epochs
- **Infrastructure:** Single T4 GPU via Modal.com

## Limitations

- **Accented speech:** The model targets standard-accent speech in the five training
  languages. On strongly accented international English (see EdAcc above), accuracy
  degrades — retrain with accented corpora such as VCTK for broader speaker populations.
- **Binary classification only:** Does not accommodate non-binary, transgender, or
  intersex individuals. Suitable for cases where a binary routing signal is sufficient.
- **5 Western European languages:** Not tested on tonal languages or non-European speech.
- **Clean audio only:** Not benchmarked under heavy noise or telephony compression.

## Citation

```bibtex
@misc{bidus2026gender,
  title        = {A Sub-1MB Bi-LSTM Gender Classifier for Real-Time Voice Pipelines},
  author       = {Bidu\'s, Kamil},
  year         = {2026},
  howpublished = {arXiv preprint},
    # arxiv: add once published
}
```

Paper: _link will be added once the arXiv submission is public._
