#!/usr/bin/env python3
import os, paramiko, re
RH, RU, RP = os.environ["RH"], os.environ["RU"], os.environ["RP"]
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(RH, 22, RU, RP, timeout=60)
i, o, e = c.exec_command("grep -E '^DATABASE_URL=' /opt/lidousha/.env")
line = o.read().decode("utf-8", "replace").strip()
m = re.match(r"DATABASE_URL=(postgres://[^:]+):([^@]+)@([^:/]+):?(\d*)/(\w+)", line)
if m:
    user, pw, host, port, db = m.groups()
    print(f"user={user} host={host} port={port or '5432'} db={db} pw_len={len(pw)}")
else:
    print("PARSE_FAIL:", line[:80])
# 测试服务器上数据库端口是否可达
i, o, e = c.exec_command(f"(command -v pg_isready >/dev/null && pg_isready -h {host} -p {port or 5432}) || echo no_pg_isready")
print("reachable:", o.read().decode('utf-8','replace').strip())
c.close()
