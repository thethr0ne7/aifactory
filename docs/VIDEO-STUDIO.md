# Video Studio | AI Factory 2.4.1 candidate

**Status (2026-11-22): registered in an isolated feature branch. Not merged or deployed.** Existing Factory router remains authoritative.

## Layers
- **MVP operational adapter:** `tools/video-studio.mjs` invokes locally installed FFmpeg without shell, creates vertical/horizontal MP4 by trimming and concatenating clips or still images, scales/pads source, optionally replaces audio, and validates exported duration and dimensions with ffprobe.
- **Planned editor:** OpenFilm for agent-authored timeline and manual review.
- **Planned coded animation:** Remotion or HyperFrames; Motion Canvas/GSAP/PixiJS when project requires them.
- **Planned transcription/audio:** faster-whisper for SRT, then Chatterbox/ACE-Step when rights and compute gates pass.
- **Planned 3D:** Three.js/img2threejs; Blender only for full offline scenes.

## Quickstart
Prerequisites: Node 22+, FFmpeg and ffprobe installed on the execution host. Do not run installers implicitly.

Create an editable project with source files next to `film.json`:

```json
{
  "version": 1,
  "format": { "width": 1080, "height": 1920, "fps": 30 },
  "clips": [
    { "path": "shot1.mp4", "start": 0, "duration": 7 },
    { "path": "shot2.mp4", "start": 2, "duration": 8 }
  ],
  "audio": { "path": "music.mp3", "volume": 0.25, "loop": true },
  "output": "film.mp4"
}
```

From repository root:
```sh
node tools/video-studio.mjs doctor
node tools/video-studio.mjs plan workspace/film.json
node tools/video-studio.mjs render workspace/film.json
node tools/video-studio.mjs verify workspace/film.json
node --test evals/video-studio.test.mjs
```

Source paths must be relative to the JSON's containing directory. The script rejects traversal and escaping symlinks. It **overwrites the output MP4**; keep a backup or select a fresh output path.

## Non-features and limitations
Original audio in clips is discarded; optional audio replaces it. No crossfades, text layers, subtitles or generative inference in the initial CLI. More capable tools are a **routing plan**, not installed integrations. H.264 encoding requires an FFmpeg build with `libx264`; confirm its redistribution/licensing obligations separately.

## Acceptance criteria
- Deterministic plan and no arbitrary shell commands.
- Valid MP4/H.264 with expected video dimensions/duration.
- Security tests for path traversal and workspace symlinks.
- Human review of crop, typography, captions, montage pacing, audio levels and copyright.
- Version and provenance recorded for every enabled external library/model.

## Hardware policy
On low-memory or integrated-GPU machines prefer FFmpeg and 720p previews. Heavy local TTS, music synthesis, 3D and 4K batch rendering require a separate measured capacity check.

See `skills/video-studio/SKILL.md` and `registry/upstreams/video-studio-tools.json`.
