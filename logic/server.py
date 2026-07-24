"""
Bridge server: serves the dashboard's static files plus a small JSON/JPEG API
over shared/*.json|jsonl, so the browser (which can't read local files
directly) can consume perception's and logic's output. This is what turns
"three folders full of Python" into "one URL the dashboard talks to" --
main.py starts this alongside perception and logic.

Part of logic's integration ownership per TEAM_PROMPT.md ("own the final
main.py integration wiring"). Runnable standalone for testing the API
without a webcam -- see logic/README.md.
"""

import json
import mimetypes
import sys
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from shared.io_utils import (  # noqa: E402
    CONTROL_PATH,
    ENROLL_CONTROL_PATH,
    ENROLL_STATUS_PATH,
    EVENTS_PATH,
    PREVIEW_PATH,
    STATE_PATH,
    atomic_write_json,
    read_json,
    read_jsonl_since,
)
from shared.schema import make_default_driver_state  # noqa: E402

DASHBOARD_DIR = ROOT / "dashboard"

DEFAULT_ENROLL_STATUS = {
    "face_id": None,
    "saved": 0,
    "target": 0,
    "training": False,
    "done": False,
    "error": None,
}


class BridgeHandler(BaseHTTPRequestHandler):
    server_version = "SmartCockpitBridge/1.0"

    def log_message(self, fmt, *args):
        pass  # quiet -- the dashboard polls every ~200ms, default logging would drown the console

    # ---- response helpers ----

    def _send_bytes(self, data, content_type, status=200):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _send_json(self, payload, status=200):
        self._send_bytes(json.dumps(payload).encode("utf-8"), "application/json", status)

    def _send_file(self, path, content_type):
        try:
            data = path.read_bytes()
        except OSError:
            self.send_error(404)
            return
        self._send_bytes(data, content_type)

    def _read_json_body(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        if length == 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {}

    # ---- routing ----

    def do_GET(self):
        parsed = urllib.parse.urlsplit(self.path)
        path = parsed.path

        if path == "/api/health":
            self._send_json({"ok": True})
        elif path == "/api/state":
            self._send_json(read_json(STATE_PATH, default=make_default_driver_state()))
        elif path == "/api/events":
            qs = urllib.parse.parse_qs(parsed.query)
            try:
                since = int(qs.get("since", ["0"])[0])
            except ValueError:
                since = 0
            events = read_jsonl_since(EVENTS_PATH, since)
            latest_seq = events[-1]["seq"] if events else since
            self._send_json({"events": events, "latest_seq": latest_seq})
        elif path == "/api/preview.jpg":
            if PREVIEW_PATH.exists():
                self._send_file(PREVIEW_PATH, "image/jpeg")
            else:
                self.send_error(404)
        elif path == "/api/enroll/status":
            self._send_json(read_json(ENROLL_STATUS_PATH, default=DEFAULT_ENROLL_STATUS))
        else:
            self._serve_static(path)

    def do_POST(self):
        path = self.path
        body = self._read_json_body()

        if path == "/api/enroll/start":
            face_id = body.get("face_id")
            if face_id not in ("profile_1", "profile_2"):
                self._send_json({"error": "face_id must be profile_1 or profile_2"}, status=400)
                return
            atomic_write_json(ENROLL_CONTROL_PATH, {"mode": "enrolling", "face_id": face_id})
            self._send_json({"ok": True})
        elif path == "/api/enroll/stop":
            atomic_write_json(ENROLL_CONTROL_PATH, {"mode": "idle", "face_id": None})
            self._send_json({"ok": True})
        elif path == "/api/control":
            current = read_json(CONTROL_PATH, default={})
            current.update(body)
            current["timestamp"] = time.time()
            atomic_write_json(CONTROL_PATH, current)
            self._send_json({"ok": True, "control": current})
        else:
            self.send_error(404)

    def _serve_static(self, path):
        if path == "/":
            path = "/index.html"
        dashboard_root = DASHBOARD_DIR.resolve()
        file_path = (dashboard_root / path.lstrip("/")).resolve()
        if dashboard_root not in file_path.parents:
            self.send_error(403)
            return
        if not file_path.is_file():
            self.send_error(404)
            return
        content_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
        self._send_file(file_path, content_type)


def run(host="localhost", port=8000):
    server = ThreadingHTTPServer((host, port), BridgeHandler)
    print(f"[bridge] serving dashboard + API on http://{host}:{port}")
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Run the bridge server standalone (for testing without perception/logic).")
    parser.add_argument("--host", default="localhost")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    run(host=args.host, port=args.port)
