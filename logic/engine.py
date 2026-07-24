"""
Logic main loop: reads DriverState from perception, emits decision events for
the dashboard to render. This is the only file that needs to run in
production for Shahaan's part; everything else in /logic is a helper this
file uses.

Usage:
    python engine.py              # notifications + escalation + occupant-left-behind + gestures
    python engine.py --voice      # also start the voice-command listener (stretch goal)
"""

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from shared.io_utils import (  # noqa: E402
    CONTROL_PATH,
    EVENTS_PATH,
    GESTURE_PATH,
    STATE_PATH,
    append_jsonl,
    next_seq,
    read_json,
)

sys.path.insert(0, str(Path(__file__).parent))
from escalation import EscalationEngine  # noqa: E402
from gesture_policy import GesturePolicy  # noqa: E402
from notifications import NotificationEngine  # noqa: E402
from occupant_watch import OccupantWatch  # noqa: E402
from voice import VoiceListener  # noqa: E402

PROFILES_PATH = Path(__file__).parent / "profiles.json"
POLL_INTERVAL_S = 0.2

PLAYLISTS = {
    "Focus Flow": [
        {"title": "Midnight Focus", "artist": "Lo-Fi Collective", "duration": 234},
        {"title": "Deep Work", "artist": "Chill Beats", "duration": 198},
        {"title": "Flow State", "artist": "Ambient Waves", "duration": 267},
        {"title": "Concentration", "artist": "Study Sessions", "duration": 212},
        {"title": "Brain Waves", "artist": "Synth Dreams", "duration": 245},
    ],
    "Ambient Calm": [
        {"title": "Gentle Rain", "artist": "Nature Sounds", "duration": 312},
        {"title": "Ocean Drift", "artist": "Ambient Waves", "duration": 287},
        {"title": "Soft Light", "artist": "Calm Collective", "duration": 195},
        {"title": "Floating", "artist": "Chill Beats", "duration": 241},
        {"title": "Stillness", "artist": "Meditation FM", "duration": 328},
    ],
    "Upbeat Energy": [
        {"title": "Neon Rush", "artist": "Synthwave FM", "duration": 203},
        {"title": "Electric Feel", "artist": "Retro Drive", "duration": 189},
        {"title": "Turbo Boost", "artist": "High Octane", "duration": 221},
        {"title": "Solar Flare", "artist": "Cosmic Beats", "duration": 176},
        {"title": "Adrenaline", "artist": "Pulse Radio", "duration": 198},
    ],
    "Late Night Drive": [
        {"title": "Midnight City", "artist": "Night Owl", "duration": 256},
        {"title": "Street Lights", "artist": "Urban Chill", "duration": 232},
        {"title": "After Hours", "artist": "Lo-Fi Collective", "duration": 278},
        {"title": "Cruisin'", "artist": "Retro Drive", "duration": 211},
        {"title": "Moonlit Road", "artist": "Synth Dreams", "duration": 245},
    ],
}


def make_emitter():
    counter = {"seq": next_seq(EVENTS_PATH)}

    def emit(record):
        record = dict(record)
        record["seq"] = counter["seq"]
        record["timestamp"] = time.time()
        counter["seq"] += 1
        append_jsonl(EVENTS_PATH, record)
        print(f"[logic] event: {record}")

    return emit


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--voice", action="store_true", help="start the voice-command listener")
    parser.add_argument("--interval", type=float, default=POLL_INTERVAL_S)
    args = parser.parse_args()

    profiles = json.loads(PROFILES_PATH.read_text())
    emit = make_emitter()

    notifications = NotificationEngine()
    escalation = EscalationEngine()
    occupant_watch = OccupantWatch()
    gestures = GesturePolicy()

    last_face_id = "__unset__"
    current_state = {"eyes_on_road": True}
    last_dismiss_at = None
    last_song_action_at = None
    last_gesture_val = None
    last_emotion = "__unset__"

    EMOTION_PLAYLISTS = {
        "calm": "Focus Flow",
        "stressed": "Ambient Calm",
        "tired": "Upbeat Energy",
    }

    # --- Song player state ---
    song_player = {
        "playlist_name": "Focus Flow",
        "track_index": 0,
        "playing": True,
        "elapsed": 0,
        "last_tick": time.monotonic(),
    }

    def current_track():
        tracks = PLAYLISTS.get(song_player["playlist_name"], PLAYLISTS["Focus Flow"])
        return tracks[song_player["track_index"] % len(tracks)]

    def emit_song_state():
        track = current_track()
        emit({
            "type": "song_state",
            "title": track["title"],
            "artist": track["artist"],
            "duration": track["duration"],
            "elapsed": int(song_player["elapsed"]),
            "playing": song_player["playing"],
            "playlist": song_player["playlist_name"],
        })

    def skip_track():
        tracks = PLAYLISTS.get(song_player["playlist_name"], PLAYLISTS["Focus Flow"])
        song_player["track_index"] = (song_player["track_index"] + 1) % len(tracks)
        song_player["elapsed"] = 0
        song_player["last_tick"] = time.monotonic()
        emit_song_state()

    def prev_track():
        tracks = PLAYLISTS.get(song_player["playlist_name"], PLAYLISTS["Focus Flow"])
        song_player["track_index"] = (song_player["track_index"] - 1) % len(tracks)
        song_player["elapsed"] = 0
        song_player["last_tick"] = time.monotonic()
        emit_song_state()

    def toggle_playback():
        song_player["playing"] = not song_player["playing"]
        song_player["last_tick"] = time.monotonic()
        emit_song_state()

    def switch_playlist(name):
        song_player["playlist_name"] = name
        song_player["track_index"] = 0
        song_player["elapsed"] = 0
        song_player["last_tick"] = time.monotonic()
        emit_song_state()

    def on_command(command, source_text):
        print(f"[logic] command '{command}' from {source_text!r}")
        if command == "dismiss_alarm":
            escalation.acknowledge(emit)
        elif command == "next_track":
            skip_track()
        elif command == "prev_track":
            prev_track()
        elif command == "toggle_playback":
            toggle_playback()
        elif command == "phone_call":
            emit({"type": "phone_call_initiated", "source": source_text})
        elif command == "confirm":
            emit({"type": "command_confirmed", "source": source_text})

    voice_listener = VoiceListener(on_command)
    if args.voice:
        voice_listener.start(lambda: current_state)

    print(f"[logic] decision engine running, polling {STATE_PATH} every {args.interval}s. Ctrl+C to stop.")
    try:
        while True:
            now = time.monotonic()

            if song_player["playing"]:
                song_player["elapsed"] += now - song_player["last_tick"]
                track = current_track()
                if song_player["elapsed"] >= track["duration"]:
                    skip_track()
            song_player["last_tick"] = now

            state = read_json(STATE_PATH, default=None)
            if state is not None:
                current_state = state

                face_id = state.get("face_id")
                if state.get("present") and face_id and face_id != last_face_id:
                    profile = profiles.get(face_id)
                    if profile:
                        emit({"type": "profile_settings", "face_id": face_id, **profile})
                    last_face_id = face_id
                elif not state.get("present"):
                    last_face_id = "__unset__"

                emotion = state.get("emotion", "calm")
                if state.get("present") and emotion != last_emotion:
                    playlist = EMOTION_PLAYLISTS.get(emotion, "Focus Flow")
                    switch_playlist(playlist)
                    last_emotion = emotion
                elif not state.get("present"):
                    last_emotion = "__unset__"

                notifications.tick(state, emit)
                escalation.tick(state, emit)

                gesture_doc = read_json(GESTURE_PATH, default=None)
                gesture_val = (gesture_doc or {}).get("gesture")
                gestures.tick(state, gesture_doc, on_command)
                # Perception holds a detected gesture steady for a few hundred ms so this
                # poll doesn't miss it -- only toast once per gesture, not once per poll
                # while it's held.
                if gesture_val and gesture_val != last_gesture_val:
                    emit({"type": "gesture_detected", "gesture": gesture_val})
                last_gesture_val = gesture_val

            control = read_json(CONTROL_PATH, default={})
            occupant_watch.tick(current_state, control, emit)

            # Dashboard's "Resume Driving" button (pull-over popup) posts a
            # fresh dismiss_alarm_at timestamp via /api/control -- treat it
            # like a voice/gesture dismiss so it actually clears the
            # escalation engine's pulled_over latch server-side, not just the
            # popup on screen.
            dismiss_at = control.get("dismiss_alarm_at")
            if dismiss_at is not None and dismiss_at != last_dismiss_at:
                last_dismiss_at = dismiss_at
                escalation.acknowledge(emit)

            # Dashboard's Now Playing card posts {song_action, song_action_at}
            # via /api/control -- song_action_at is a per-click nonce so a
            # repeated click of the same button (e.g. "next" twice) isn't
            # deduped away like dismiss_alarm_at above.
            song_action_at = control.get("song_action_at")
            if song_action_at is not None and song_action_at != last_song_action_at:
                last_song_action_at = song_action_at
                on_command(control.get("song_action"), "dashboard:player")

            time.sleep(args.interval)
    except KeyboardInterrupt:
        pass
    finally:
        voice_listener.stop()


if __name__ == "__main__":
    main()
