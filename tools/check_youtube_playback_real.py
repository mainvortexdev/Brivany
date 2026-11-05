"""Public YouTube playback observation. No capture, Palabra, recording or download."""
import os
from pathlib import Path
import subprocess
ROOT=Path(__file__).resolve().parents[1]

def main():
    result=subprocess.run(['node','tools/check_youtube_playback_real.cjs'],cwd=ROOT,env=os.environ.copy(),capture_output=True,
        timeout=75,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    print((result.stdout+result.stderr).decode('utf-8',errors='replace'));return result.returncode

if __name__=='__main__':raise SystemExit(main())
