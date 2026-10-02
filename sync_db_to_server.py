# 本地 -> 服务器 全表镜像同步（以本地为准）
# 逐表：导出(gzip) -> 上传 -> 服务端 DELETE + 从 COPY 中转表 INSERT
import gzip, os, shutil, subprocess, sys
import paramiko

PSQL = r"C:\postgres\pg16\pgsql\bin\psql.exe"
RH = os.environ.get("RH") or input("服务器IP: ")
RU = os.environ.get("RU", "root")
RP = os.environ.get("RP") or input("服务器密码: ")
PGPW = "PGPASSWORD=" + (os.environ.get("RPGPW") or input("服务器PG密码: "))
STOP_APPS = os.environ.get("STOP_APPS", "1") == "1"
ONLY = [t.strip() for t in os.environ.get("TABLES", "").split(",") if t.strip()]


def q(s: str) -> str:
    return '"' + s.replace('"', '""') + '"'


def local_sql(sql: str) -> str:
    env = dict(os.environ)
    env["PGPASSWORD"] = ""
    env.setdefault("PGCLIENTENCODING", "UTF8")
    r = subprocess.run(
        [PSQL, "-h", "127.0.0.1", "-U", "postgres", "-d", "lidousha", "-At", "-c", sql],
        capture_output=True,
        env=env,
    )
    if r.returncode != 0:
        raise RuntimeError("local psql: " + r.stderr.decode("utf-8", "replace")[:300])
    return r.stdout.decode("utf-8", "replace").strip()


cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(RH, username=RU, password=RP, timeout=20)


def ssh(cmd: str, timeout=3600):
    _, out, err = cli.exec_command(cmd, timeout=timeout)
    return out.read().decode("utf-8", "replace"), err.read().decode("utf-8", "replace").strip()


def remote_file(path: str, content: str):
    sftp = cli.open_sftp()
    with sftp.open(path, "w") as f:
        f.write(content)
    sftp.close()


# ---------- 表与列 ----------
col_sql = (
    "SELECT table_name || '|' || ordinal_position || '|' || column_name || '|' || data_type "
    "FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name, ordinal_position"
)
local_cols: dict[str, list[str]] = {}
local_types: dict[str, list[str]] = {}
for line in local_sql(col_sql).splitlines():
    if line.count("|") >= 3:
        t, _, c, dt = line.split("|", 3)
        local_cols.setdefault(t, []).append(c)
        local_types.setdefault(t, []).append(dt)

tables = sorted(local_cols.keys())
if ONLY:
    tables = [t for t in tables if t in ONLY]
print(f"tables to sync: {len(tables)}: {', '.join(tables)}")

out, err = ssh(f"{PGPW} psql -h 127.0.0.1 -U postgres -d lidousha -At -c \"{col_sql}\"")
remote_cols: dict[str, list[str]] = {}
for line in out.splitlines():
    if line.count("|") >= 3:
        t, _, c, dt = line.split("|", 3)
        remote_cols.setdefault(t, []).append(c)

missing_tables = [t for t in tables if t not in remote_cols]
if missing_tables:
    print("!! 服务器缺少的表（将跳过）:", ", ".join(missing_tables))
    tables = [t for t in tables if t in remote_cols]

# 补齐服务器缺失的列
for t in tables:
    extra = [c for c in local_cols[t] if c not in remote_cols[t]]
    if extra:
        alts = []
        for c in extra:
            dt = local_types[t][local_cols[t].index(c)]
            alts.append(f'ALTER TABLE {q("public")}.{q(t)} ADD COLUMN IF NOT EXISTS {q(c)} TEXT;')
        print(f"add cols {t}: {','.join(extra)}")
        _, e = ssh(f"{PGPW} psql -h 127.0.0.1 -U postgres -d lidousha -c \"{' '.join(alts)}\"")
        if e:
            print("  add col warn:", e[:200])

if STOP_APPS:
    print("stopping pm2 apps...")
    ssh("pm2 stop lidousha-web lidousha-monitor 2>&1 | tail -2")

failed = []
sftp = cli.open_sftp()
for t in tables:
    cols = local_cols[t]
    collist = ", ".join(q(c) for c in cols)
    local_gz = f"tmp-db-{t}.tsv.gz"
    # 导出并压缩
    env = dict(os.environ)
    env["PGPASSWORD"] = ""
    env.setdefault("PGCLIENTENCODING", "UTF8")
    p = subprocess.Popen(
        [PSQL, "-h", "127.0.0.1", "-U", "postgres", "-d", "lidousha", "-At",
         "-c", f"COPY (SELECT {collist} FROM {q('public')}.{q(t)}) TO STDOUT"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env,
    )
    with gzip.open(local_gz, "wb", compresslevel=6) as gz:
        shutil.copyfileobj(p.stdout, gz, length=1024 * 1024)
    p.stdout.close()
    perr = p.stderr.read().decode("utf-8", "replace")
    if perr:
        print(f"  export warn {t}: {perr[:200]}")
    size_mb = os.path.getsize(local_gz) / 1024 / 1024
    sftp.put(local_gz, f"/tmp/db-{t}.tsv.gz")
    script = "\n".join([
        "BEGIN;",
        f"SET LOCAL session_replication_role = replica;",
        f"DROP TABLE IF EXISTS __sync_{t};",
        f"CREATE TABLE __sync_{t} (LIKE {q('public')}.{q(t)});",
        f"\\copy __sync_{t} ({collist}) FROM PROGRAM 'gunzip -c /tmp/db-{t}.tsv.gz'",
        f"DELETE FROM {q('public')}.{q(t)};",
        f"INSERT INTO {q('public')}.{q(t)} ({collist}) SELECT {collist} FROM __sync_{t};",
        f"DROP TABLE __sync_{t};",
        "COMMIT;",
    ]) + "\n"
    remote_file(f"/tmp/db-{t}.sql", script)
    o2, e2 = ssh(f"{PGPW} psql -h 127.0.0.1 -U postgres -d lidousha -v ON_ERROR_STOP=1 -f /tmp/db-{t}.sql 2>&1")
    ssh(f"rm -f /tmp/db-{t}.sql /tmp/db-{t}.tsv.gz")
    os.remove(local_gz)
    if "ERROR" in o2:
        failed.append(t)
        print(f"FAIL {t}: {o2.strip()[-300:]}")
    else:
        print(f"ok   {t} ({size_mb:.1f} MB)")
sftp.close()

# 序列归位
sets = []
for line in local_sql(
    "SELECT table_name || '|' || column_name FROM information_schema.columns "
    "WHERE table_schema='public' AND column_default LIKE 'nextval(%' ORDER BY 1"
).splitlines():
    if "|" in line:
        tt, c = line.split("|", 1)
        if tt in tables:
            sets.append(
                f"SELECT setval(pg_get_serial_sequence('{q(tt)}','{c}'), "
                f"COALESCE((SELECT MAX({q(c)}) FROM {q('public')}.{q(tt)}),0)+1, false);"
            )
if sets:
    remote_file("/tmp/db-seq.sql", "\n".join(sets) + "\n")
    o3, e3 = ssh(f"{PGPW} psql -h 127.0.0.1 -U postgres -d lidousha -f /tmp/db-seq.sql 2>&1 | tail -3")
    ssh("rm -f /tmp/db-seq.sql")
    print("sequences reset")

if STOP_APPS:
    ssh("pm2 start lidousha-web lidousha-monitor 2>&1 | tail -2")
    # 应用可能刚拉起尚未写入：无需额外处理

# 复核行数
cnt_sql = "\n".join(
    f"SELECT '{t}|' || count(*) FROM {q('public')}.{q(t)};" for t in tables
)
remote_file("/tmp/db-cnt.sql", "\\pset tuples_only on\n\\pset format unaligned\n" + cnt_sql + "\n")
out4, _ = ssh(f"{PGPW} psql -h 127.0.0.1 -U postgres -d lidousha -f /tmp/db-cnt.sql 2>&1")
ssh("rm -f /tmp/db-cnt.sql")
remote_counts = {}
for line in out4.splitlines():
    if "|" in line:
        k, v = line.split("|", 1)
        remote_counts[k] = v.strip()
bad = []
for t in tables:
    lc = local_sql(f"SELECT count(*) FROM {q('public')}.{q(t)}")
    rc = remote_counts.get(t, "?")
    if lc != rc:
        bad.append((t, lc, rc))
print("\n=== 行数复核 ===")
for t, a, b in bad:
    print(f"MISMATCH {t}: local={a} remote={b}")
print("ALL TABLES MATCH" if not bad else f"{len(bad)} tables mismatch")
if failed:
    print("FAILED TABLES:", ", ".join(failed))
cli.close()
