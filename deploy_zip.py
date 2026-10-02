#!/usr/bin/env python3
"""
替代 deploy.py 的工作区打包部署（避免 862MB 的 public.zip 被 git 全量 bundle 打包）。
流程：本地用 git ls-files 收集源码 -> 打成 zip（排除 .git/.env/node_modules/.next 及垃圾文件）
      -> SFTP 上传 -> 服务器解压覆盖 -> npm install -> npm run build -> pm2 restart。
前置环境变量：RH / RU / RP（服务器地址 / 用户 / 密码）。
"""
import os, sys, io, zipfile, subprocess, paramiko

LOCAL_REPO = os.getcwd()
REMOTE_DIR = "/opt/lidousha"
EXCLUDE = ("public.zip", "tmp-tok.js", "_ins_missing.js")
EXCLUDE_PREFIX = ("tmp-", "_ins", "deploy_zip.py", "tmp-dev", "tmp-deploy", "tmp-run",
                  "tmp-check", "tmp-cols", "tmp-jobs", "tmp-kv", "tmp-monitor", "tmp-home",
                  "tmp-lives", "tmp-cookie", "tmp-tok", "tmp-out", "tmp-err")

def git_ls():
    r = subprocess.run(["git", "ls-files"], cwd=LOCAL_REPO, capture_output=True, text=True)
    files = []
    for f in r.stdout.splitlines():
        base = os.path.basename(f)
        if f in EXCLUDE or base in EXCLUDE:
            continue
        if any(f.startswith(p) or f.startswith("tmp/") for p in EXCLUDE_PREFIX):
            continue
        files.append(f)
    return files

def build_zip(files, zippath):
    with zipfile.ZipFile(zippath, "w", zipfile.ZIP_DEFLATED) as z:
        for f in files:
            p = os.path.join(LOCAL_REPO, f)
            if os.path.isfile(p):
                z.write(p, f)
    return os.path.getsize(zippath)

def main():
    rh, ru, rp = os.environ["RH"], os.environ["RU"], os.environ["RP"]
    files = git_ls()
    print(f"源文件数: {len(files)}")
    zp = os.path.join(os.environ.get("TEMP", "/tmp"), "site-deploy.zip")
    size = build_zip(files, zp)
    print(f"zip 大小: {size/1024/1024:.1f} MB -> {zp}")

    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(rh, 22, ru, rp, timeout=60)
    def run(cmd, t=1200):
        i, o, e = c.exec_command(cmd, timeout=t)
        return o.read().decode("utf-8", "replace") + "\n[err]\n" + e.read().decode("utf-8", "replace")

    sftp = c.open_sftp()
    sftp.put(zp, "/tmp/site-deploy.zip")
    sftp.close()
    print("上传完成")

    print(run(
        f"cd {REMOTE_DIR} && "
        f"(command -v unzip >/dev/null && unzip -o -q /tmp/site-deploy.zip || "
        f"python3 -c \"import zipfile;zipfile.ZipFile('/tmp/site-deploy.zip').extractall('{REMOTE_DIR}')\") "
        f"&& rm -f /tmp/site-deploy.zip"
    ))

    print("=== npm install ===")
    print(run(f"cd {REMOTE_DIR} && npm install 2>&1 | tail -15", t=1800))

    print("=== npm run build ===")
    print(run(f"cd {REMOTE_DIR} && npm run build 2>&1 | tail -30", t=1800))

    print("=== pm2 restart ===")
    print(run(f"pm2 restart lidousha-web lidousha-monitor 2>&1"))

    c.close()
    print("DONE")

if __name__ == "__main__":
    main()
