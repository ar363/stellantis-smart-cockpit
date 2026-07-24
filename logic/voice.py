"""
Voice commands (stretch goal). Uses SpeechRecognition with a PyAudio mic
for continuous listening and Google Web Speech API for transcription.
Gated by eyes_on_road: commands are dropped when eyes are off road.

Say "dismiss" / "cancel alarm" to dismiss an active alarm,
"next song" / "skip" to skip a track, "call" for a phone call,
"confirm" to confirm an action.

Optional: if SpeechRecognition or PyAudio aren't installed,
VOICE_AVAILABLE is False and engine.py skips starting the listener.
"""

import threading

try:
    import speech_recognition as sr

    VOICE_AVAILABLE = True
except ImportError:
    VOICE_AVAILABLE = False

# substring -> command. Checked in order, first match wins.
COMMANDS = [
    ("cancel alarm", "dismiss_alarm"),
    ("dismiss", "dismiss_alarm"),
    ("next song", "next_track"),
    ("skip", "next_track"),
    ("previous song", "prev_track"),
    ("go back", "prev_track"),
    ("pause", "toggle_playback"),
    ("play", "toggle_playback"),
    ("resume", "toggle_playback"),
    ("call", "phone_call"),
    ("confirm", "confirm"),
]


class VoiceListener:
    def __init__(self, on_command):
        self.on_command = on_command
        self._stop = threading.Event()
        self._thread = None
        self._get_state = lambda: {}

    def start(self, get_state):
        if not VOICE_AVAILABLE:
            print("[logic] voice commands unavailable (install SpeechRecognition + PyAudio)")
            return
        self._get_state = get_state
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        print("[logic] voice command listener started (say 'dismiss', 'next song', 'call', 'confirm')")

    def stop(self):
        self._stop.set()

    def _run(self):
        recognizer = sr.Recognizer()
        recognizer.energy_threshold = 300
        recognizer.pause_threshold = 0.8
        try:
            mic = sr.Microphone()
        except OSError:
            print("[logic] voice: no microphone found")
            return

        with mic as source:
            recognizer.adjust_for_ambient_noise(source, duration=0.5)
            print("[logic] voice: mic calibrated, listening...")

        while not self._stop.is_set():
            try:
                with mic as source:
                    audio = recognizer.listen(source, timeout=2, phrase_time_limit=4)
            except sr.WaitTimeoutError:
                continue
            except Exception as exc:  # noqa: BLE001
                print(f"[logic] voice listen error: {exc}")
                continue

            if not self._get_state().get("eyes_on_road", True):
                continue

            try:
                text = recognizer.recognize_google(audio).lower()
                print(f"[logic] voice heard: '{text}'")
            except sr.UnknownValueError:
                continue
            except sr.RequestError as exc:
                print(f"[logic] voice API error: {exc}")
                continue

            for phrase, command in COMMANDS:
                if phrase in text:
                    self.on_command(command, text)
                    break
