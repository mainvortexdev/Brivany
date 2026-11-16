"""Separate immutable application resources from persistent per-user data.

Source checkouts retain their existing locations. The installed launcher sets
BRIVANY_DATA_DIR before importing any service; releases never contain user data.
"""
import os
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]
DATA_ROOT = Path(os.environ.get('BRIVANY_DATA_DIR') or APP_ROOT).absolute()
LOCAL_ROOT = DATA_ROOT / '.local'
CONFIG_PATH = DATA_ROOT / '.env'
