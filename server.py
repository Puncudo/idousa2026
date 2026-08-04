#!/usr/bin/env python3
"""
USA Trip — local dev server
Serves static files + handles JSON save API
"""
import http.server, json, os, sys, re, cgi

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
        ct = self.headers.get('Content-Type', '')
        if self.path == '/api/upload-photo' and ct.startswith('multipart/form-data'):
            self._upload_photo()
            return

        length = int(self.headers.get('Content-Length', 0))
        try:
            data = json.loads(self.rfile.read(length))
        except Exception:
            return self.send_error(400, 'Invalid JSON')

        if self.path == '/api/save-coords':
            self._save_coords(data)
        elif self.path == '/api/save-hotel':
            self._save_hotel(data)
        elif self.path == '/api/save-json':
            self._save_json_file(data)
        elif self.path == '/api/delete-photo':
            self._delete_photo(data)
        elif self.path == '/api/resolve-url':
            self._resolve_url(data)
        else:
            self.send_error(404)

    def _save_hotel(self, data):
        """Update hotel fields in city JSON."""
        city = os.path.basename(data.get('city', ''))
        filepath = os.path.join(ROOT, 'data', f'{city}.json')
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                trip = json.load(f)
            for key, val in data.get('hotel', {}).items():
                trip['hotel'][key] = val
            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump(trip, f, ensure_ascii=False, indent=2)
            self._ok({'status': 'saved'})
        except Exception as e:
            self.send_error(500, str(e))

    def _save_coords(self, data):
        """Update coords (and optionally place) for one activity by name."""
        city = os.path.basename(data.get('city', ''))
        filepath = os.path.join(ROOT, 'data', f'{city}.json')
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                trip = json.load(f)

            updated = False
            for day in trip.get('days', []):
                for act in day.get('activities', []):
                    if act.get('name') == data['name']:
                        act['coords'] = data['coords']
                        if data.get('place'):
                            act['place'] = data['place']
                        if data.get('mapsUrl'):
                            act['mapsUrl'] = data['mapsUrl']
                        updated = True

            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump(trip, f, ensure_ascii=False, indent=2)

            self._ok({'status': 'saved', 'updated': updated})
        except Exception as e:
            self.send_error(500, str(e))

    def _resolve_url(self, data):
        """Follow redirects and return final URL."""
        import urllib.request
        url = data.get('url', '')
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=8) as resp:
                self._ok({'url': resp.url})
        except Exception as e:
            self.send_error(500, str(e))

    def _sanitize(self, name):
        name = re.sub(r'[^\w\s-]', '', name).strip().lower()
        name = re.sub(r'\s+', '-', name)
        return name[:60] or 'activity'

    def _upload_photo(self):
        """Handle multipart photo upload, save file, update JSON."""
        try:
            form = cgi.FieldStorage(
                fp=self.rfile,
                headers=self.headers,
                environ={
                    'REQUEST_METHOD': 'POST',
                    'CONTENT_TYPE': self.headers['Content-Type'],
                    'CONTENT_LENGTH': self.headers.get('Content-Length', '0'),
                }
            )
            city = os.path.basename(form.getvalue('city', ''))
            name = form.getvalue('name', '')
            if not city or not name or 'photo' not in form:
                return self.send_error(400, 'Missing fields')

            photo_item = form['photo']
            photo_data = photo_item.file.read()

            orig = photo_item.filename or 'photo.jpg'
            ext = os.path.splitext(orig)[1].lower()
            if ext not in ('.jpg', '.jpeg', '.png', '.gif', '.webp'):
                ext = '.jpg'
            safe_name = self._sanitize(name) + ext

            photo_dir = os.path.join(ROOT, 'photos', city)
            os.makedirs(photo_dir, exist_ok=True)
            with open(os.path.join(photo_dir, safe_name), 'wb') as f:
                f.write(photo_data)

            rel_path = f'photos/{city}/{safe_name}'

            # Update JSON
            json_path = os.path.join(ROOT, 'data', f'{city}.json')
            with open(json_path, 'r', encoding='utf-8') as f:
                trip = json.load(f)
            for day in trip.get('days', []):
                for act in day.get('activities', []):
                    if act.get('name') == name:
                        act['photo'] = rel_path
            with open(json_path, 'w', encoding='utf-8') as f:
                json.dump(trip, f, ensure_ascii=False, indent=2)

            self._ok({'photo': rel_path})
        except Exception as e:
            self.send_error(500, str(e))

    def _delete_photo(self, data):
        """Delete photo file and remove from JSON."""
        city = os.path.basename(data.get('city', ''))
        name = data.get('name', '')
        json_path = os.path.join(ROOT, 'data', f'{city}.json')
        try:
            with open(json_path, 'r', encoding='utf-8') as f:
                trip = json.load(f)
            for day in trip.get('days', []):
                for act in day.get('activities', []):
                    if act.get('name') == name and 'photo' in act:
                        try:
                            os.remove(os.path.join(ROOT, act['photo']))
                        except Exception:
                            pass
                        del act['photo']
            with open(json_path, 'w', encoding='utf-8') as f:
                json.dump(trip, f, ensure_ascii=False, indent=2)
            self._ok({'status': 'deleted'})
        except Exception as e:
            self.send_error(500, str(e))

    def _save_json_file(self, data):
        """Overwrite an entire city JSON file (for future direct-edit flow)."""
        city = os.path.basename(data.get('city', ''))
        filepath = os.path.join(ROOT, 'data', f'{city}.json')
        try:
            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump(data['content'], f, ensure_ascii=False, indent=2)
            self._ok({'status': 'saved'})
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
