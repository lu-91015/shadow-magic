import paramiko, os

RH = os.environ.get('RH', '***REDACTED-IP***')
RU = os.environ.get('RU', 'root')
RP = os.environ.get('RP', '***REDACTED***')

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(RH, username=RU, password=RP, timeout=15)

cmd = "cd /opt/lidousha && npm run build 2>&1 | tail -5 && pm2 restart lidousha-web 2>&1 | tail -2 && sleep 3 && curl -s -o /dev/null -w 'cover -> %{http_code} %{size_download}\\n' http://127.0.0.1:3000/replays/BV1CjaQ6NEpT.jpg"
_, out, err = cli.exec_command(cmd, timeout=600)
print(out.read().decode('utf-8', 'replace'))
e = err.read().decode('utf-8', 'replace').strip()
if e:
    print('STDERR:', e[:400])
cli.close()
