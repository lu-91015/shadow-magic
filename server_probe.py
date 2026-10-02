#!/usr/bin/env python3
import os, sys, paramiko
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(os.environ["RH"], 22, os.environ["RU"], os.environ["RP"], timeout=60)
for cmd in [
    "python3 --version",
    "which ffmpeg || echo NO_FFMPEG",
    "python3 -m pip --version 2>/dev/null || echo NO_PIP",
    "python3 -c 'import shazamio; print(\"shazamio-ok\")' 2>/dev/null || echo NO_SHAZAM",
    "ls /opt/lidousha/tools/ffmpeg/bin/ffmpeg 2>/dev/null || echo NO_TOOLS_FFMPEG",
]:
    i, o, e = c.exec_command(cmd, timeout=60)
    print(">>", cmd)
    print(o.read().decode("utf-8", "replace").strip())
    print(e.read().decode("utf-8", "replace").strip())
c.close()
