#!/usr/bin/env python3
import os, sys, paramiko
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(os.environ["RH"], 22, os.environ["RU"], os.environ["RP"], timeout=60)
f = sys.argv[1] if len(sys.argv) > 1 else "/opt/lidousha/ear-server.log"
i, o, e = c.exec_command(f"tail -20 {f} 2>/dev/null", timeout=30)
print(o.read().decode("utf-8", "replace").strip())
c.close()
