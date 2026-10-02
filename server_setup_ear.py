#!/usr/bin/env python3
import os, sys, paramiko, time
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(os.environ["RH"], 22, os.environ["RU"], os.environ["RP"], timeout=60)

def run(cmd, timeout=600):
    i, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", "replace")
    err = e.read().decode("utf-8", "replace")
    print(">>", cmd)
    print(out.strip()[-1500:])
    print("ERR:", err.strip()[-500:])
    return out

run("apt-get update -qq 2>&1 | tail -2")
run("apt-get install -y -qq ffmpeg python3-pip 2>&1 | tail -5")
run("which ffmpeg && ffmpeg -version 2>/dev/null | head -1")
run("python3 -m pip install -q --break-system-packages shazamio 2>&1 | tail -3")
run("python3 -c 'import shazamio; print(\"shazamio-ok\")'")
# 测试 shazam 端点可达性
run("curl -s -m 12 -o /dev/null -w 'shazam amp HTTP=%{http_code}\\n' 'https://amp.shazam.com/discovery/v5/zh/CN/iphone/-/search?term=test'")
c.close()
