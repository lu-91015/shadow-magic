#!/usr/bin/env python3
"""
部署脚本（本地运行）：绕开服务器对 GitHub 的直连限制，用 git bundle 同步。
流程：本地生成相对服务器 HEAD 的【增量】bundle -> sftp 上传 -> 服务器 fetch/checkout -> build -> pm2 restart。

前置环境变量（与日常运维一致）：
  RH  服务器IP
  RU  服务器用户（root）
  RP  服务器密码

用法：
  python deploy.py            # 完整部署（含服务器 npm run build + pm2 restart）
  python deploy.py --no-build # 只同步代码，不重新 build/重启（紧急更新代码用）
"""
import paramiko, os, sys, subprocess

# Windows 控制台默认 GBK，构建日志含特殊字符（如 webpack 的 ƒ）会抛
# UnicodeEncodeError。统一按 utf-8 输出，缺字用 replace 兜底。
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

LOCAL_REPO = os.getcwd()
BUNDLE = os.path.join(os.environ.get("TEMP", "C:\\Windows\\Temp"), "deploy.bundle")
REMOTE_DIR = "/opt/lidousha"


def run_local(cmd):
    r = subprocess.run(cmd, cwd=LOCAL_REPO, capture_output=True, text=True, shell=True)
    return r.returncode, r.stdout.strip(), r.stderr.strip()


def main():
    no_build = "--no-build" in sys.argv

    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(os.environ["RH"], 22, os.environ["RU"], os.environ["RP"], timeout=60)

    def run(cmd, t=600):
        i, o, e = c.exec_command(cmd, timeout=t)
        return o.read().decode("utf-8", "replace") + e.read().decode("utf-8", "replace")

    base = run(f"cd {REMOTE_DIR} && git rev-parse HEAD 2>/dev/null").strip()
    _, local_out, _ = run_local("git rev-parse HEAD")
    local = local_out.strip()
    print(f"server HEAD: {base}")
    print(f"local  HEAD: {local}")

    if base == local:
        print("已是最新，无需部署。")
        c.close()
        return

    # 优先增量 bundle；若基准 commit 不在本地历史（分叉/首次），退回全量
    rc, _, err = run_local(f'git bundle create "{BUNDLE}" {base}..{local}')
    if rc != 0:
        print("增量 bundle 失败，改用全量：", err)
        rc, _, err = run_local(f'git bundle create "{BUNDLE}" main')
        if rc != 0:
            print("bundle 生成失败：", err)
            sys.exit(1)
    print("bundle size bytes:", os.path.getsize(BUNDLE))

    sftp = c.open_sftp()
    sftp.put(BUNDLE, "/tmp/deploy.bundle")
    sftp.close()
    print("uploaded -> /tmp/deploy.bundle")

    print(run(f"cd {REMOTE_DIR} && git fetch /tmp/deploy.bundle main 2>&1 | tail -3"))
    print(run(f"cd {REMOTE_DIR} && git checkout -f -B main FETCH_HEAD 2>&1 | tail -6"))

    if not no_build:
        print(run(f"cd {REMOTE_DIR} && rm -f /tmp/deploy.bundle; npm run build 2>&1 | tail -20"))
        print(run(f"cd {REMOTE_DIR} && pm2 restart lidousha-web lidousha-monitor 2>&1"))
    else:
        print(run(f"cd {REMOTE_DIR} && rm -f /tmp/deploy.bundle; git rev-parse HEAD"))
        print("（--no-build：未重新构建/重启，请按需手动 build/restart）")

    c.close()
    print("DONE")


if __name__ == "__main__":
    main()
