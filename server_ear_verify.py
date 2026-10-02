#!/usr/bin/env python3
import os, sys, paramiko
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(os.environ["RH"], 22, os.environ["RU"], os.environ["RP"], timeout=60)
def run(cmd, timeout=120):
    i, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", "replace")
    err = e.read().decode("utf-8", "replace")
    print(">>", cmd[:70]); print(out.strip()[-900:]); print("ERR:", err.strip()[-300:])
# 重置 done（让新代码重新处理这一场）
run("psql -U postgres -d lidousha -c \"DELETE FROM song_ear_done WHERE bvid='BV1C4aW69EVd';\" 2>&1 || psql -U postgres -d lidousha -c \"UPDATE song_ear_done SET bvid=bvid WHERE bvid='BV1C4aW69EVd'\" 2>&1")
run("pkill -f 'song-by-ear' 2>/dev/null; sleep 1; echo killed-old")
# 用新代码单独重跑这一场（OFFSET_BASE=15 与本地错开），后台日志
cmd = (
    "cd /opt/lidousha && BVID=BV1C4aW69EVd OFFSET_BASE=15 "
    "nohup ./node_modules/.bin/tsx scripts/song-by-ear.ts "
    "> /opt/lidousha/ear-verify.log 2>&1 & echo launched pid=$!"
)
i, o, e = c.exec_command(cmd, timeout=20)
print(o.read().decode("utf-8","replace").strip())
c.close()
