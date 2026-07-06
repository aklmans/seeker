#!/usr/bin/env python3
"""No-cache static server for Seeker web/ dev preview.
Sends Cache-Control: no-store so the webview never serves stale JS —
fixes the recurring 抽壳-刀 缓存缺口 (stale intake-action.js / ai-render.js etc.)
that made zero-regression smokes read as false regressions. Serves ./web on :8756."""
import http.server
import socketserver

PORT = 8756
DIRECTORY = "web"


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


class Server(socketserver.TCPServer):
    allow_reuse_address = True


with Server(("", PORT), NoCacheHandler) as httpd:
    print(f"no-cache server on :{PORT} serving ./{DIRECTORY}")
    httpd.serve_forever()
