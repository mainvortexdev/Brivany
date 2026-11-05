"""Independent offline Spanish ASR of translated fixed synthetic fixtures.

This is a diagnostic, not a human intelligibility or semantic quality verdict.
Only WAVs referenced by this project's synthetic Palabra evaluation reports
are accepted. Recognition text stays in process memory; the report has only
concept booleans and aggregate confidence. No APIs or microphones are used.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess

from tools.check_palabra_quality_real import DIRECTORY, ROOT, concept_screen, read_wave


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--case-report', type=Path, required=True)
    args = parser.parse_args()
    path = args.case_report.resolve()
    if not path.is_relative_to(DIRECTORY.resolve()) or path.name != 'report.json':
        raise ValueError('Only a local synthetic Palabra evaluation report is accepted.')
    source = json.loads(path.read_text(encoding='utf-8'))
    if source.get('source_synthetic') is not True or source.get('source_user_media_used') is not False or source.get('target_language') != 'es':
        raise ValueError('A fixed synthetic Spanish translated WAV is required.')
    audio = (ROOT / source['translated_audio_path']).resolve()
    if audio.parent != path.parent or audio.name != 'translated-synthetic.wav':
        raise ValueError('The translated WAV must belong to the given synthetic evaluation.')
    pcm = read_wave(audio)
    script = path.parent / 'offline-asr.ps1'
    script.write_text("""param([string]$Audio)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Speech
$recognizer = [System.Speech.Recognition.SpeechRecognitionEngine]::new([System.Globalization.CultureInfo]::GetCultureInfo('es-ES'))
try {
  $recognizer.LoadGrammar([System.Speech.Recognition.DictationGrammar]::new())
  $recognizer.SetInputToWaveFile($Audio)
  $items = [System.Collections.Generic.List[object]]::new()
  while ($true) {
    try { $item = $recognizer.Recognize() }
    catch {
      if ($items.Count -gt 0 -and $recognizer.AudioState -eq [System.Speech.Recognition.AudioState]::Stopped) { break }
      throw
    }
    if ($null -eq $item) { break }
    $items.Add([pscustomobject]@{text=$item.Text;confidence=$item.Confidence})
    if ($items.Count -gt 50) { throw 'Too many results for a fixed synthetic phrase.' }
  }
  ConvertTo-Json -InputObject @($items.ToArray()) -Compress
} finally { $recognizer.Dispose() }
""", encoding='utf-8-sig')
    report = {'format': 'brivany-offline-asr-quality-1', 'started_at': datetime.now(timezone.utc).isoformat(),
              'scope': 'Independent Windows es-ES DictationGrammar ASR of synthetic translated PCM; not human listening.',
              'source_case': source['case'], 'source_language_setting': source['source_language'], 'translated_wav_sha256': hashlib.sha256(audio.read_bytes()).hexdigest(),
              'translated_seconds': len(pcm) / 48000, 'recognizer': 'Windows System.Speech es-ES DictationGrammar',
              'external_calls': 0, 'microphone_used': False, 'transcripts_persisted': False,
              'human_listening_verified': False, 'translation_quality_verified': False, 'status': 'failed'}
    try:
        result = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', str(script), str(audio)],
                                cwd=ROOT, capture_output=True, timeout=40, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        if result.returncode: raise ValueError('Offline recognition did not complete.')
        items = json.loads(result.stdout.decode('utf-8-sig'))
        if isinstance(items, dict): items = [items]
        if not isinstance(items, list): raise ValueError('Invalid aggregate recognition result.')
        report['recognized_segments'] = len(items)
        report['mean_confidence'] = round(sum(item['confidence'] for item in items) / len(items), 4) if items else None
        report['concept_screen'] = concept_screen(' '.join(item['text'] for item in items), 'es')
        report['status'] = 'offline_recognition_completed_pending_human_quality_review'
    except Exception as error:
        report['failure_type'] = type(error).__name__
    report['finished_at'] = datetime.now(timezone.utc).isoformat()
    output = path.parent / ('offline-asr-summary-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S') + '.json')
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report['status'].startswith('offline_recognition_completed') else 1


if __name__ == '__main__':
    raise SystemExit(main())
