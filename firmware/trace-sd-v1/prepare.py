#!/usr/bin/env python3
"""Recreate ignored firmware build source from the pinned local Omi checkout."""
from pathlib import Path
import argparse, subprocess
parser=argparse.ArgumentParser();parser.add_argument('--omi-repo',required=True);args=parser.parse_args()
root=Path(__file__).resolve().parent;out=root/'upstream';out.mkdir(exist_ok=True)
rev='bc5d7a34a33f34112eba95902ba26294e60f8d2a';prefix='omi/firmware/devkit/'
paths=subprocess.check_output(['git','-C',args.omi_repo,'ls-tree','-r','--name-only',rev,prefix],text=True).splitlines()
for name in paths:
 path=out/name[len(prefix):];path.parent.mkdir(parents=True,exist_ok=True)
 path.write_bytes(subprocess.check_output(['git','-C',args.omi_repo,'show',rev+':'+name]))
for name in ['stats8-base.patch','sd-integration.patch']:
 subprocess.run(['patch','-p1','--forward','-i',str(root/name)],cwd=out,check=True)
(out/'src/trace_stats.h').write_bytes((root/'src/trace_stats.h').read_bytes())
with (out/'CMakeLists.txt').open('a') as config:
 config.write('\ninclude(${CMAKE_CURRENT_SOURCE_DIR}/../sd-sync-fix.cmake)\n')
print('Prepared pinned stats8 + TRACE SD source at',out)
