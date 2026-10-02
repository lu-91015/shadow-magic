#!/usr/bin/env python3
import os, sys, paramiko
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(os.environ["RH"], 22, os.environ["RU"], os.environ["RP"], timeout=60)
i, o, e = c.exec_command(
    "ps aux | grep -i 'song-by-ear' | grep -v grep | head; echo '--- log ---'; tail -8 /opt/lidousha/ear-server.log 2>/dev/null",
    timeout=60,
)
print(o.read().decode("utf-8", "replace").strip())
print(e.read().decode("utf-8", "replace").strip())
c.close()
