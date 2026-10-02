#!/usr/bin/env python3
import os, sys, paramiko
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(os.environ["RH"], 22, os.environ["RU"], os.environ["RP"], timeout=60)
for cmd in [
    "cat /etc/os-release | head -3",
    "which yum dnf 2>/dev/null || echo NO_YUM_DNF",
    "python3 -m ensurepip --version 2>&1 | tail -2 || echo NO_ENSUREPIP",
    "uname -m",
]:
    i, o, e = c.exec_command(cmd, timeout=60)
    print(">>", cmd)
    print((o.read().decode("utf-8","replace") + e.read().decode("utf-8","replace")).strip())
c.close()
