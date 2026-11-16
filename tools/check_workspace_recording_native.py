"""Record only an owned, synthetic Tk window with the production GDI recorder."""
import json
from fractions import Fraction
from pathlib import Path
import shutil
import subprocess
import threading
import time
import tkinter as tk

import cv2
import numpy as np
from desktop.experience.workspace_recording import ScreenRecorder

ROOT = Path(__file__).resolve().parents[1]


def main():
    directory = ROOT / 'tmp' / 'workspace-recording-native'
    directory.mkdir(parents=True, exist_ok=True)
    report = {'passed': False, 'mode': 'real_windows_gdigrab_owned_synthetic_window',
              'external_calls': 0, 'microphone_used': False, 'desktop_captured': False,
              'limitations': 'Own synthetic window only; not protected/minimized applications, audio or an entire Desktop session.'}
    root = tk.Tk(); title = 'Brivany recording verification - owned fixture'
    root.title(title); root.geometry('640x360+100+100'); root.configure(background='#111218')
    canvas = tk.Canvas(root, width=640, height=360, background='#111218', highlightthickness=0)
    canvas.pack(fill='both', expand=True)
    canvas.create_text(32, 36, text='BRIVANY / CAPTURA LOCAL', anchor='w', fill='#f2f2f5', font=('Segoe UI', 18))
    canvas.create_text(32, 76, text='Ventana de prueba propia. Sin audio ni datos personales.', anchor='w', fill='#a9b7c8', font=('Segoe UI', 11))
    moving = canvas.create_rectangle(30, 150, 170, 260, fill='#84b6ff', outline='')
    caption = canvas.create_text(32, 320, text='0', anchor='w', fill='#f2f2f5', font=('Segoe UI', 18))
    recorder = ScreenRecorder(directory / 'captures')
    counter = 0; done = threading.Event()

    def animate():
        nonlocal counter
        counter += 1
        left = 30 + (counter * 5) % 440
        canvas.coords(moving, left, 150, left + 140, 260)
        canvas.itemconfigure(caption, text=f'Fotograma de prueba · {counter}')
        if not done.is_set():
            root.after(40, animate)

    def trial():
        try:
            report['phase'] = 'enumerate_owned_window'
            assert recorder.worker is None and recorder.process is None
            result = recorder.choices()
            assert result['available'], 'FFmpeg is missing from PATH.'
            source = next(item for item in result['sources'] if item['kind'] == 'window' and item['label'] == title)
            recorder.start(source['id'], 15, False)
            report['phase'] = 'capture_owned_window'
            child = recorder.process
            deadline = time.monotonic() + 12
            while recorder.snapshot()['state'] == 'starting' and time.monotonic() < deadline:
                time.sleep(.05)
            assert recorder.snapshot()['state'] == 'recording', recorder.snapshot()
            time.sleep(2.5)
            final = recorder.stop()
            recorder.worker.join(timeout=2)
            assert final['state'] == 'saved' and final['has_file'], final
            assert child.poll() == 0 and not recorder.worker.is_alive()
            report['phase'] = 'probe_encoded_file'
            video = recorder.output
            probe = json.loads(subprocess.check_output([shutil.which('ffprobe'), '-v', 'error', '-count_frames',
                '-show_streams', '-show_format', '-of', 'json', str(video)], timeout=30))
            streams = probe['streams']; v = next(item for item in streams if item['codec_type'] == 'video')
            assert not any(item['codec_type'] == 'audio' for item in streams)
            duration = float(probe['format']['duration'])
            assert 1 <= duration <= 15, duration
            assert v['codec_name'] == 'h264' and v['pix_fmt'] == 'yuv420p'
            # Matroska millisecond timestamps can make the remux average differ
            # slightly from nominal CFR without a dropped frame.
            assert v['width'] <= 1920 and v['height'] <= 1080
            assert v['r_frame_rate'] == '15/1' and abs(float(Fraction(v['avg_frame_rate'])) - 15) < .02, v['avg_frame_rate']
            report['phase'] = 'full_decode_and_picture_change'
            decoded = subprocess.run([shutil.which('ffmpeg'), '-v', 'error', '-i', str(video), '-f', 'null', '-'],
                                     capture_output=True, timeout=30)
            assert decoded.returncode == 0 and not decoded.stderr, decoded.stderr[-500:]
            capture = cv2.VideoCapture(str(video))
            ok, first = capture.read(); assert ok
            capture.set(cv2.CAP_PROP_POS_MSEC, max(.1, duration - .3) * 1000)
            ok, last = capture.read(); capture.release(); assert ok
            # Difference within the synthetic content; not a video hash claim.
            difference = float(np.mean(np.abs(first.astype(np.float32) - last.astype(np.float32))))
            assert difference > 1, difference
            report.update(passed=True, idle_process_absent=True, owned_child_closed=True,
                          width=v['width'], height=v['height'], fps=v['avg_frame_rate'],
                          frames=int(v['nb_read_frames']), duration=duration,
                          full_decode_passed=True, synthetic_picture_difference=round(difference, 3),
                          bytes=video.stat().st_size, audio_tracks=0)
            report['phase'] = 'complete'
        except Exception as error:
            report['error'] = f'{type(error).__name__}: {error}'
        finally:
            recorder.close(); done.set()
    root.after(100, animate)
    root.after(300, lambda: threading.Thread(target=trial, daemon=True).start())

    def finish():
        if done.is_set():
            root.destroy()
        else:
            root.after(100, finish)
    root.after(100, finish)
    root.mainloop()
    (directory / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False))
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
