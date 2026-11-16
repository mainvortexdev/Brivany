"""Wait for the original process to finish normally before reopening the app."""
import argparse
import json
import os
from pathlib import Path
import subprocess
from desktop.management import wait_stopped

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--pid',type=int,required=True);parser.add_argument('--started',required=True);parser.add_argument('--command',required=True);parser.add_argument('--mode',choices=['workspace','chat'],required=True);args=parser.parse_args()
    command=json.loads(args.command)
    if not isinstance(command,list) or not command or not all(isinstance(v,str) for v in command) or not Path(command[0]).is_absolute() or not Path(command[0]).is_file():return 2
    if not wait_stopped(args.pid,args.started,45):return 3
    if args.mode=='workspace':command.append('--island')
    subprocess.Popen(command,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0));return 0

if __name__=='__main__':raise SystemExit(main())
