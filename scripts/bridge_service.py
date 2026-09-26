import os
import sys
import time
import socket
import threading
import subprocess
import signal

def forward(src, dst):
    try:
        while True:
            data = src.recv(65536)
            if not data:
                break
            dst.sendall(data)
    except Exception:
        pass
    finally:
        for s in (src, dst):
            try:
                s.shutdown(socket.SHUT_RDWR)
            except Exception:
                pass
            try:
                s.close()
            except Exception:
                pass

class PortBridge:
    def __init__(self, local_port: int, tunnel_port: int, target_port: int, wsl_host_ip: str = "192.168.128.1"):
        self.local_port = local_port
        self.tunnel_port = tunnel_port
        self.target_port = target_port
        self.wsl_host_ip = wsl_host_ip
        self.standby_tunnels = []
        self.lock = threading.Lock()
        self.running = True

    def start(self):
        t_listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        t_listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        t_listener.bind((self.wsl_host_ip, self.tunnel_port))
        t_listener.listen(128)

        def accept_tunnels():
            while self.running:
                try:
                    conn, _ = t_listener.accept()
                    with self.lock:
                        self.standby_tunnels.append(conn)
                except Exception:
                    break

        threading.Thread(target=accept_tunnels, daemon=True).start()

        l_listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        l_listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        l_listener.bind(('127.0.0.1', self.local_port))
        l_listener.listen(128)

        def accept_clients():
            while self.running:
                try:
                    client_sock, _ = l_listener.accept()
                    tunnel_sock = None
                    for _ in range(60):
                        with self.lock:
                            if self.standby_tunnels:
                                tunnel_sock = self.standby_tunnels.pop(0)
                                break
                        time.sleep(0.05)

                    if not tunnel_sock:
                        client_sock.close()
                        continue

                    tunnel_sock.sendall(b'G')
                    threading.Thread(target=forward, args=(client_sock, tunnel_sock), daemon=True).start()
                    threading.Thread(target=forward, args=(tunnel_sock, client_sock), daemon=True).start()
                except Exception:
                    break

        threading.Thread(target=accept_clients, daemon=True).start()
        print(f"[Bridge] 127.0.0.1:{self.local_port} <--> {self.wsl_host_ip}:{self.tunnel_port}", flush=True)

def main():
    print("[Bridge Service] Initializing FlowPilot WSL-Windows Network Bridge...", flush=True)

    # 1. Start Windows listeners
    pg_bridge = PortBridge(5432, 45432, 5432)
    pg_bridge.start()
    redis_bridge = PortBridge(6379, 46379, 6379)
    redis_bridge.start()

    # 2. Launch WSL worker
    wsl_script = (
        "import socket, threading, time\n"
        "def fwd(s, d):\n"
        "    try:\n"
        "        while True:\n"
        "            b = s.recv(65536)\n"
        "            if not b: break\n"
        "            d.sendall(b)\n"
        "    except Exception: pass\n"
        "    finally:\n"
        "        for x in (s, d):\n"
        "            try: x.shutdown(socket.SHUT_RDWR)\n"
        "            except Exception: pass\n"
        "            try: x.close()\n"
        "            except Exception: pass\n"
        "class W:\n"
        "    def __init__(self, tp, lp, pool=15):\n"
        "        self.tp, self.lp, self.pool = tp, lp, pool\n"
        "        self.cur = 0\n"
        "        self.lock = threading.Lock()\n"
        "    def run_one(self):\n"
        "        try:\n"
        "            t = socket.socket(socket.AF_INET, socket.SOCK_STREAM)\n"
        "            t.connect(('192.168.128.1', self.tp))\n"
        "            trig = t.recv(1)\n"
        "            if trig != b'G':\n"
        "                t.close()\n"
        "                return\n"
        "            with self.lock: self.cur -= 1\n"
        "            dst = socket.socket(socket.AF_INET, socket.SOCK_STREAM)\n"
        "            dst.connect(('127.0.0.1', self.lp))\n"
        "            t1 = threading.Thread(target=fwd, args=(t, dst), daemon=True)\n"
        "            t2 = threading.Thread(target=fwd, args=(dst, t), daemon=True)\n"
        "            t1.start(); t2.start()\n"
        "            t1.join(); t2.join()\n"
        "        except Exception:\n"
        "            with self.lock: self.cur -= 1\n"
        "    def loop(self):\n"
        "        while True:\n"
        "            with self.lock:\n"
        "                need = self.pool - self.cur\n"
        "            for _ in range(need):\n"
        "                threading.Thread(target=self.run_one, daemon=True).start()\n"
        "                with self.lock: self.cur += 1\n"
        "            time.sleep(0.05)\n"
        "threading.Thread(target=W(45432, 5432).loop, daemon=True).start()\n"
        "threading.Thread(target=W(46379, 6379).loop, daemon=True).start()\n"
        "while True: time.sleep(1)\n"
    )

    wsl_cmd = ["wsl", "-d", "Ubuntu-22.04", "--", "python3", "-c", wsl_script]
    wsl_proc = subprocess.Popen(wsl_cmd)
    print(f"[Bridge Service] WSL Agent spawned (PID {wsl_proc.pid}). Services connected!", flush=True)

    def shutdown(sig, frame):
        print("[Bridge Service] Shutting down...", flush=True)
        wsl_proc.terminate()
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    while True:
        if wsl_proc.poll() is not None:
            print("[Bridge Service] WSL agent exited, restarting...", flush=True)
            wsl_proc = subprocess.Popen(wcmd)
        time.sleep(1)

if __name__ == "__main__":
    main()
