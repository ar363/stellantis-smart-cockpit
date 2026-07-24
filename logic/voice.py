"""
Voice commands (stretch goal). Uses sounddevice for microphone capture
(avoids the PyAudio build dependency that trips up on Windows) and
SpeechRecognition's Google Web Speech API for transcription -- needs
internet and a working mic. Gated by eyes_on_road per the team contract:
a recognized command is dropped, not executed, whenever the driver's eyes
are off the road.

Optional: if sounddevice/SpeechRecognition aren't installed, VOICE_AVAILABLE
is False and engine.py just skips starting the listener.
"""

import threading
import time

try:
    import sounddevice as sd
    import speech_recognition as sr

    VOICE_AVAILABLE = True
except ImportError:
    VOICE_AVAILABLE = False

SAMPLE_RATE = 16000
CLIP_SECONDS = 3.0

# substring -> command. Checked in order, first match wins.
COMMANDS = [
    ("cancel alarm", "dismiss_alarm"),
    ("dismiss", "dismiss_alarm"),
    ("next song", "next_track"),
    ("skip", "next_track"),
    ("call", "phone_call"),
]


class VoiceListener:
    def __init__(self, on_command):
        self.on_command = on_command
        self._stop = threading.Event()
        self._thread = None
        self._get_state = lambda: {}

    def start(self, get_state):
        if not VOICE_AVAILABLE:
            print("[logic] voice commands unavailable (install sounddevice + SpeechRecognition)")
            return
        self._get_state = get_state
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        print("[logic] voice command listener started (say e.g. 'dismiss alarm')")

    def stop(self):
        self._stop.set()

    def _run(self):
        recognizer = sr.Recognizer()
        while not self._stop.is_set():
            try:
                clip = sd.rec(int(CLIP_SECONDS * SAMPLE_RATE), samplerate=SAMPLE_RATE, channels=1, dtype="int16")
                sd.wait()
            except Exception as exc:  # noqa: BLE001 -- no mic / device busy shouldn't crash logic
                print(f"[logic] voice capture error: {exc}")
                time.sleep(2)
                continue

            if not self._get_state().get("eyes_on_road", True):
                continue  # ignore input while eyes are off the road

            audio_data = sr.AudioData(clip.tobytes(), SAMPLE_RATE, 2)
            try:
                text = recognizer.recognize_google(audio_data).lower()
            except (sr.UnknownValueError, sr.RequestError):
                continue

            for phrase, command in COMMANDS:
                if phrase in text:
                    self.on_command(command, text)
                    break
