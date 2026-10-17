#!/usr/bin/env python3
"""Prepare button-only controls v2 from the reproducible TRACE SD v3 source."""
from pathlib import Path
import subprocess, shutil, argparse
p=argparse.ArgumentParser();p.add_argument('--omi-repo',required=True);a=p.parse_args()
r=Path(__file__).resolve().parent;base=r.parent/'trace-sd-v1'
subprocess.run(['python3',str(base/'prepare.py'),'--omi-repo',a.omi_repo],check=True)
shutil.copytree(base/'upstream',r/'upstream',dirs_exist_ok=True)
subprocess.run(['python3',str(r/'integrate.py')],check=True)
