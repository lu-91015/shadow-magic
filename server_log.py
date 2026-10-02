#!/usr/bin/env python3
import os, sys, paramiko
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(os.environ["RH"], 22, os.environ["RU"], os.environ["RP"], timeout=60)
i, o, e = c.exec_command("tail -25 /opt/lidousha/ear-verify.log 2>/dev/null", timeout=30)
print(o.read().decode("utf-8", "replace").strip())
c.close()
