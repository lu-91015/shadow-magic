#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
保活脚本：周期性访问本地开发服务器，避免其因空闲被回收/休眠，并记录心跳。

用法：
    python scripts/keepalive.py [url] [interval_seconds]
例：
    python scripts/keepalive.py http://localhost:3000 60

说明：本脚本只能保持“服务器”在线，无法向 AI 会话发送消息来恢复会话。
要让 Agent 持续工作，请在 IDE 内保持本会话开启并继续下达指令；
把它放到系统“任务计划程序 / cron”里即可实现夜间无人值守保活。
"""
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000"
INTERVAL = int(sys.argv[2]) if len(sys.argv) > 2 else 60
LOG = "scripts/keepalive.log"


def ping() -> str:
    try:
        req = urllib.request.Request(
            URL, method="GET", headers={"User-Agent": "keepalive/1.0"}
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            return str(r.status)
    except Exception as e:  # noqa: BLE001
        return f"ERR:{e}"


def main() -> None:
    print(f"[keepalive] 目标 {URL}，间隔 {INTERVAL}s，日志 {LOG}")
    while True:
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        status = ping()
        line = f"{ts} {status}\n"
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(line)
        print(line.strip())
        time.sleep(INTERVAL)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[keepalive] 已停止")
