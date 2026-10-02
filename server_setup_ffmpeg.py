#!/usr/bin/env python3
import os, sys, paramiko
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(os.environ["RH"], 22, os.environ["RU"], os.environ["RP"], timeout=120)
def run(cmd, timeout=600):
    i, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", "replace")
    err = e.read().decode("utf-8", "replace")
    print(">>", cmd[:70]); print(out.strip()[-800:]); print("ERR:", err.strip()[-300:])
run("dnf install -y ffmpeg 2>&1 | tail -6")
run("which ffmpeg && ffmpeg -version 2>/dev/null | head -1 || echo STILL_NO_FFMPEG")
c.close()
