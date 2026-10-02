# 内容级比对：两边统一 GUC（时区/日期格式）后按整行哈希比对全部表
# 找出「行数相同但内容不同」的表
import os, subprocess
import paramiko

PSQL = r"C:\postgres\pg16\pgsql\bin\psql.exe"
RH = os.environ.get("RH")
RU = os.environ.get("RU", "root")
RP = os.environ.get("RP")
PGPW = "PGPASSWORD=" + (os.environ.get("RPGPW") or "")
if not (RH and RP and PGPW.strip("PGPASSWORD=")):
    sys.exit("请设置环境变量 RH / RP / RPGPW（服务器IP / SSH密码 / PG密码）")

# 统一会话环境，保证行文本渲染一致
PGOPTS = "-c timezone=UTC -c datestyle=ISO,MDY -c extra_float_digits=3 -c bytea_output=hex"


def local_sql(sql: str) -> str:
    env = dict(os.environ)
    env["PGPASSWORD"] = ""
    env["PGOPTIONS"] = PGOPTS
    env.setdefault("PGCLIENTENCODING", "UTF8")
    r = subprocess.run(
        [PSQL, "-h", "127.0.0.1", "-U", "postgres", "-d", "lidousha", "-At", "-c", sql],
        capture_output=True, env=env,
    )
    if r.returncode != 0:
        raise RuntimeError("local psql: " + r.stderr.decode("utf-8", "replace")[:300])
    return r.stdout.decode("utf-8", "replace").strip()


cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(RH, username=RU, password=RP, timeout=20)


def ssh(cmd, timeout=1800):
    _, o, e = cli.exec_command(cmd, timeout=timeout)
    return o.read().decode("utf-8", "replace"), e.read().decode("utf-8", "replace").strip()


tables = [t for t in local_sql(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1"
).splitlines() if t.strip()]

fp = "\n".join(
    f"SELECT '{t}|' || count(*) || '|' || COALESCE(sum(hashtext(x::text)::numeric),0)::text FROM public.\"{t}\" x;"
    for t in tables
)

local_fp = dict(
    (l.split("|", 2)[0], tuple(l.split("|", 2)[1:]))
    for l in local_sql(fp).splitlines() if l.count("|") >= 2
)

sftp = cli.open_sftp()
with sftp.open("/tmp/cv.sql", "w") as f:
    f.write("\\pset tuples_only on\n\\pset format unaligned\n" + fp + "\n")
sftp.close()
out, err = ssh(f"PGOPTIONS='{PGOPTS}' {PGPW} psql -h 127.0.0.1 -U postgres -d lidousha -f /tmp/cv.sql 2>&1")
ssh("rm -f /tmp/cv.sql")
remote_fp = dict(
    (l.split("|", 2)[0], tuple(l.split("|", 2)[1:]))
    for l in out.splitlines() if l.count("|") >= 2
)

diff = []
for t in tables:
    lv, rv = local_fp.get(t, ("?", "?")), remote_fp.get(t, ("?", "?"))
    if lv != rv:
        diff.append(t)
        print(f"DIFF {t}: local={lv} remote={rv}")
    else:
        print(f"same {t}: {lv[0]} rows")

print(f"\n=> {len(diff)} tables content-differ: {', '.join(diff) if diff else '(none)'}")
with open("tmp-content-diff.txt", "w", encoding="utf-8") as f:
    f.write(",".join(diff))
cli.close()
