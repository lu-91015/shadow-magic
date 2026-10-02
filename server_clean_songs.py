#!/usr/bin/env python3
import os, sys, paramiko
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(os.environ["RH"], 22, os.environ["RU"], os.environ["RP"], timeout=60)
i, o, e = c.exec_command(
    "cd /opt/lidousha && git log -1 --oneline"
    " && ls data/known-songs.json"
    " && ./node_modules/.bin/tsx scripts/clean-songs.ts 2>&1 | head -4"
    " && (.venv/bin/pip install -q shazamio 2>/dev/null && echo shazamio-ok || echo no-venv-skip)",
    timeout=1200,
)
print(o.read().decode("utf-8", "replace"))
print(e.read().decode("utf-8", "replace"))
c.close()
