"""Observe the actual local YouTube embed only; never start dubbing/capture.

This is an external public-web availability check, not an offline suite. Normal
browser embed traffic is allowed. No downloader, media extraction, recording,
API credential access, Palabra connection, or automatic video playback.
"""
import argparse
import os
from pathlib import Path
import subprocess

ROOT=Path(__file__).resolve().parents[1]


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url',default='http://127.0.0.1:8765/dubbing')
    parser.add_argument('--video-url',default='https://www.youtube.com/watch?v=qGEPPNTTYmk')
    args=parser.parse_args()
    result=subprocess.run(['node','tools/check_youtube_embed_real.cjs'],cwd=ROOT,
        env={**os.environ,'BRIVANY_YOUTUBE_TEST_URL':args.url,'BRIVANY_YOUTUBE_PUBLIC_VIDEO':args.video_url},
        capture_output=True,timeout=75,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    print((result.stdout+result.stderr).decode('utf-8',errors='replace'))
    return result.returncode


if __name__=='__main__':raise SystemExit(main())
