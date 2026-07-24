"""
Integration entrypoint: launches perception (webcam -> DriverState), logic
(DriverState -> events), and the bridge server (dashboard + API) together.
Edited only during integration checkpoints -- coordinate with the team
before touching, per TEAM_PROMPT.md.

Usage:
    python main.py                     # perception + logic + dashboard on this laptop
    python main.py --gestures --voice  # also enable the gesture/voice stretch goals
    python main.py --no-perception     # just logic + bridge (e.g. no webcam here);
                                        # dashboard still runs, showing whatever
                                        # shared/state.json last had (or falls back
                                        # to its own mock data if that's empty)
"""

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from logic.server import run as run_bridge  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--camera", type=int, default=0)
    parser.add_argument("--fps", type=float, default=12.0)
    parser.add_argument("--gestures", action="store_true", help="enable hand-gesture detection/control")
    parser.add_argument("--voice", action="store_true", help="enable the voice-command listener")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--no-perception", action="store_true", help="skip launching perception")
    parser.add_argument("--no-logic", action="store_true", help="skip launching logic")
    args = parser.parse_args()

    procs = []

    if not args.no_perception:
        cmd = [
            sys.executable, str(ROOT / "perception" / "capture.py"),
            "--camera", str(args.camera), "--fps", str(args.fps),
        ]
        if args.gestures:
            cmd.append("--gestures")
        procs.append(("perception", subprocess.Popen(cmd, cwd=str(ROOT / "perception"))))

    if not args.no_logic:
        cmd = [sys.executable, str(ROOT / "logic" / "engine.py")]
        if args.voice:
            cmd.append("--voice")
        procs.append(("logic", subprocess.Popen(cmd, cwd=str(ROOT / "logic"))))

    print(f"[main] launched: {[name for name, _ in procs]}")
    print(f"[main] open http://localhost:{args.port} -- Ctrl+C here stops everything")

    try:
        run_bridge(port=args.port)
    except KeyboardInterrupt:
        pass
    finally:
        print("[main] shutting down...")
        for _name, proc in procs:
            proc.terminate()
        for name, proc in procs:
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                print(f"[main] {name} didn't stop in time, killing it")
                proc.kill()
        print("[main] stopped.")


if __name__ == "__main__":
    main()
