#!/usr/bin/env python3
import os, sys, socket, threading, select, paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
RH, RU, RP = os.environ["RH"], os.environ["RU"], os.environ["RP"]
LPORT = int(os.environ.get("LPORT", 5433))
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(RH, 22, RU, RP, timeout=60)
transport = client.get_transport()


def pipe(local, ch):
    while True:
        r, _, _ = select.select([local, ch], [], [], 10)
        if local in r:
            d = local.recv(65536)
            if not d:
                break
            ch.send(d)
        if ch in r:
            d = ch.recv(65536)
            if not d:
                break
            local.send(d)
    try: local.close()
    except Exception: pass
    try: ch.close()
    except Exception: pass


def serve():
    ls = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    ls.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    ls.bind(("127.0.0.1", LPORT))
    ls.listen(64)
    print(f"tunnel 127.0.0.1:{LPORT} -> server:5432 ready")
    while True:
        conn, _ = ls.accept()
        try:
            ch = transport.open_channel(
                "direct-tcpip", ("127.0.0.1", 5432), ("127.0.0.1", LPORT)
            )
        except Exception:
            conn.close()
            continue
        threading.Thread(target=pipe, args=(conn, ch), daemon=True).start()


serve()
