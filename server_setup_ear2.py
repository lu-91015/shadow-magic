#!/usr/bin/env python3
import os, sys, paramiko, time
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(os.environ["RH"], 22, os.environ["RU"], os.environ["RP"], timeout=60)

def run(cmd, timeout=900):
    i, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", "replace")
    err = e.read().decode("utf-8", "replace")
    print(">>", cmd[:80])
    print(out.strip()[-1200:])
    print("ERR:", err.strip()[-400:])

# 1) pip + shazamio
run("python3 -m ensurepip 2>&1 | tail -2")
run("python3 -m pip install -q shazamio 2>&1 | tail -3")
run("python3 -c 'import shazamio; print(\"shazamio-ok\")'")
# 2) 静态 ffmpeg 放到 /usr/local/bin
run("curl -sL -m 120 -o /tmp/ff.txz https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz && echo downloaded || echo dl-fail")
run("cd /tmp && tar xf ff.txz && D=$(ls -d ffmpeg-*-amd64-static) && cp $D/ffmpeg /usr/local/bin/ffmpeg && cp $D/ffprobe /usr/local/bin/ffprobe && chmod +x /usr/local/bin/ffmpeg /usr/local/bin/ffprobe && echo copied")
run("ffmpeg -version 2>/dev/null | head -1")
c.close()
