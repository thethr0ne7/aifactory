#!/usr/bin/env python3
"""Offline Russian speech synthesis, no cloud TTS or API token required."""
import subprocess
import tempfile
import time
import wave
from pathlib import Path
from urllib.request import urlretrieve

from piper import PiperVoice

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "lecture_audio" / "metodist_360_lecture.txt"
OUT = ROOT / "generated" / "metodist_360_neural_ru.mp3"
MODEL_DIR = ROOT / "generated" / "models"
BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/ru/ru_RU/dmitri/medium/"
MODEL = MODEL_DIR / "ru_RU-dmitri-medium.onnx"
CONFIG = MODEL_DIR / "ru_RU-dmitri-medium.onnx.json"

def ensure_model():
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    for fn in (MODEL, CONFIG):
        if not fn.exists() or fn.stat().st_size < 4000:
            print(f"Downloading neural model: {fn.name}", flush=True)
            urlretrieve(BASE + fn.name + "?download=true", str(fn))
            print(f"Model file size: {fn.stat().st_size:,} bytes", flush=True)

def main():
    ensure_model()
    voice = PiperVoice.load(str(MODEL), config_path=str(CONFIG))
    OUT.parent.mkdir(exist_ok=True, parents=True)
    text = SRC.read_text(encoding="utf8")
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    print(f"Voice loaded, paragraphs={len(paragraphs)}, chars={len(text)}", flush=True)
    audio_dir = OUT.parent / "segments"
    audio_dir.mkdir(exist_ok=True)
    list_path = OUT.parent / "wav_playlist.txt"
    paths = []
    for idx, paragraph in enumerate(paragraphs):
        fname = audio_dir / f"part_{idx:03d}.wav"
        print(f"Synthesizing {idx + 1}/{len(paragraphs)} ({len(paragraph)} chars)",flush=True)
        with wave.open(str(fname), "wb") as wav:
            voice.synthesize_wav(paragraph, wav)
        if fname.stat().st_size < 1000:
            raise RuntimeError(f"Audio empty for paragraph {idx + 1}")
        paths.append(fname)
    list_path.write_text("".join(f"file 'segments/{p.name}'\n" for p in paths),encoding="utf8")
    subprocess.run([__import__("imageio_ffmpeg").get_ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-y",
      "-f", "concat", "-safe", "0", "-i", str(list_path),
      "-ar", "22050", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "128k",
      "-metadata", "title=Методист 360° — Урок 1",
      str(OUT)], check=True)
    print(f"SUCCESS {OUT} {OUT.stat().st_size:,} bytes", flush=True)

if __name__ == "__main__":
    main()
