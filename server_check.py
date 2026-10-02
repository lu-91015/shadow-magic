import os, sys, paramiko
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(os.environ["RH"], 22, os.environ["RU"], os.environ["RP"], timeout=60)
def run(cmd):
    i, o, e = c.exec_command(cmd, timeout=120)
    print(">>", cmd[:40])
    print(o.read().decode("utf-8", "replace").strip()[-600:])
run("ps aux | grep '[s]ong-by-ear' | wc -l")
run("tail -n 6 /opt/lidousha/ear-server.log")
c.close()
