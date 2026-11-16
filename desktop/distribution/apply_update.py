from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from desktop.distribution.updater import apply
if __name__=='__main__':apply(sys.argv[1],sys.argv[2],int(sys.argv[3]))
