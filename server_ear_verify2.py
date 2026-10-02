#!/usr/bin/env python3
import os, sys, paramiko
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(os.environ["RH"], 22, os.environ["RU"], os.environ["RP"], timeout=60)
cmd = (
    "cd /opt/lidousha && BVID=BV1C4aW69EVd OFFSET_BASE=15 "
    "setsid bash -c 'nohup ./node_modules/.bin/tsx scripts/song-by-ear.ts "
    "> /opt/lidousha/ear-verify.log 2>&1 &' ; echo launched"
)
try:
    i, o, e = c.exec_command(cmd, timeout=20)
    print("OUT:", o.read().decode("utf-8", "replace").strip())
    print("ERR:", e.read().decode("utf-8", "replace").strip()[-200:])
except Exception as ex:
    print("launch note (detached ok):", str(ex)[:120])
c.close()
