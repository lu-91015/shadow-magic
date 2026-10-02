#!/usr/bin/env python3
import os, sys, paramiko
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(os.environ["RH"], 22, os.environ["RU"], os.environ["RP"], timeout=60)
# 后台启动：OFFSET_BASE=15 与本地错开采样；全部未处理场次；日志落盘
cmd = (
    "cd /opt/lidousha && "
    "OFFSET_BASE=15 LIMIT=400 SEGS=18 "
    "nohup ./node_modules/.bin/tsx scripts/song-by-ear.ts "
    "> /opt/lidousha/ear-server.log 2>&1 & "
    "echo launched pid=$!"
)
i, o, e = c.exec_command(cmd, timeout=60)
print(o.read().decode("utf-8", "replace").strip())
print(e.read().decode("utf-8", "replace").strip())
c.close()
