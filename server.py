#!/usr/bin/env python3
"""
USA Trip — local dev server
Serves the static files. All trip data lives in Firestore; the only API left is
/api/resolve-url, which expands shortened Google Maps links for the map picker.
"""
import http.server, json, os, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get('PORT', 3333))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    # ── CORS preflight ──────────────────────────────
    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    # ── POST endpoints ──────────────────────────────
    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        try:
            data = json.loads(self.rfile.read(length))
        except Exception:
            return self.send_error(400, 'Invalid JSON')

        if self.path == '/api/resolve-url':
            self._resolve_url(data)
        else:
            self.send_error(404)

    def _resolve_url(self, data):
        """Follow redirects and return final URL."""
        import urllib.request
        url = data.get('url', '')
        if not url.startswith(('http://', 'https://')):
            return self.send_error(400, 'Invalid URL')
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=8) as resp:
                self._ok({'url': resp.url})
        except Exception as e:
            self.send_error(500, str(e))

    def _ok(self, body):
        resp = json.dumps(body).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', len(resp))
        self._cors()
        self.end_headers()
        self.wfile.write(resp)

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def log_message(self, fmt, *args):
        pass  # silent

if __name__ == '__main__':
    os.chdir(ROOT)
    server = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    print(f'USA Trip running at http://127.0.0.1:{PORT}')
    sys.stdout.flush()
    server.serve_forever()
