#!/usr/bin/env python3
"""Create Russian neural narration with Microsoft Edge neural voices.

Designed to run on GitHub Actions (no paid TTS key), separate from the
educational project's main branch. Requires: edge-tts and ffmpeg.
"""
from __future__ import annotations
import asyncio
import re
import subprocess
from pathlib import Path
import edge_tts

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "lecture_audio" / "metodist_360_lecture.txt"
OUT = ROOT / "generated" / "metodist_360_neural_ru.mp3"
VOICE = "ru-RU-DmitryNeural"
RATE = "-10%"

def chunks(text: str, limit: int = 1150) -> list[str]:
    result, current = [], ""
    for paragraph in re.split(r"\n\s*\n", text.strip()):
        for sentence in re.split(r"(?<=[.!?…])\s+", paragraph.strip()):
            if not sentence:
                continue
            if current and len(current) + len(sentence) + 1 > limit:
                result.append(current)
                current = ""
            if len(sentence) > limit:
                words = sentence.split()
                for w in words:
                    if current and len(current) + len(w) + 1 > limit:
                        result.append(current)
                        current = ""
                    current = f"{current} {w}".strip()
            else:
                current = f"{current} {sentence}".strip()
        if current:
            result.append(current)
            current = ""
    return result

async def save_segment(index: int, content: str, folder: Path):
    dest = folder / f"segment_{index:03d}.mp3"
    for attempt in range(4):
        try:
            await edge_tts.Communicate(content, VOICE, rate=RATE).save(str(dest))
            if dest.stat().st_size < 1000:
                raise RuntimeError("Empty audio response")
            print(f"Completed segment {index + 1}: {dest.stat().st_size} bytes", flush=True)
            return dest
        except Exception as exc:
            print(f"Attempt {attempt + 1} failed for segment {index + 1}: {exc}", flush=True)
            if attempt == 3:
                raise
            await asyncio.sleep(2 + attempt * 3)

async def main():
    text = SRC.read_text(encoding="utf-8")
    parts = chunks(text)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    temp = OUT.parent / "segments"
    temp.mkdir(exist_ok=True)
    print(f"Lecture: {len(text)} characters; {len(parts)} segments; voice={VOICE}", flush=True)
    paths = []
    for i, part in enumerate(parts):
        paths.append(await save_segment(i, part, temp))
        await asyncio.sleep(0.35)
    playlist = OUT.parent / "concat.txt"
    playlist.write_text("".join(f"file 'segments/{p.name}'\n" for p in paths), encoding="utf-8")
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                    "-f", "concat", "-safe", "0", "-i", str(playlist),
                    "-c", "copy", "-metadata", "title=Методист 360 — Лекция 1",
                    "-metadata", "artist=AI-преподаватель",
                    str(OUT)], check=True)
    print(f"SUCCESS: {OUT} {OUT.stat().st_size} bytes", flush=True)

if __name__ == "__main__":
    asyncio.run(main())
