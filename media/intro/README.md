# AgentVPS introduction video

A 45-second, 1920×1080, 24 fps Mandarin introduction with burned-in Chinese
captions, locally synthesized narration, and original, quiet transition tones.
The H.264/AAC MP4 uses fast-start metadata for web playback.

## Content and provenance

- `storyboard.json` is the narration, caption and timing source of truth.
- `assets/desktop.png` is the Debian 12 VPS desktop captured through the registered
  Codex MCP connection during 0.0.3 verification.
- `assets/console.jpg` is the real authenticated desktop viewer from the same VPS.
- `assets/dashboard.png` is the actual browser screenshot from the controlled
  CSV → Python → dashboard acceptance workflow on Debian 12. It uses fixture data.
- These are animated still-image compositions, not continuous screen recordings.
  The video labels actual screenshots and the installation illustration explicitly.
- The video distinguishes real VPS verification from container checks and states
  that the built-in autonomous agent loop remains planned.
- Agent marks come from `website/public/agents`, with their existing attribution
  and licenses. They identify compatible clients and do not imply endorsement.
- Manrope and IBM Plex Mono retain the SIL Open Font License notices under
  `website/public/fonts`. Conversion from WOFF2 to TTF is only for local rendering.
- Chinese text uses the installed macOS Heiti SC font; the system font file is not
  copied or distributed. Narration uses the generic `zf_001` voice from
  [Kokoro-82M-v1.1-zh](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh),
  whose model card identifies an Apache-2.0 license. Model revision and SHA-256
  are pinned in `narrate.py`. No system speech voice is used in the public video.
- No third-party music, login credentials or access tokens appear in the video.

## Render on macOS

Requires FFmpeg, macOS for the installed Chinese font, and Python 3. Install the pinned Python
dependencies in a virtual environment, then run from the repository root:

```sh
python3 -m venv /tmp/agentvps-video-env
/tmp/agentvps-video-env/bin/pip install -r media/intro/requirements.txt
/tmp/agentvps-video-env/bin/python media/intro/prepare.py
/tmp/agentvps-video-env/bin/python media/intro/render.py --stills
/tmp/agentvps-video-env/bin/python media/intro/narrate.py
/tmp/agentvps-video-env/bin/python media/intro/render.py
/tmp/agentvps-video-env/bin/python media/intro/publish.py
npm run site:build
```

Inspect every scene, listen to the narration and check the exported MP4 before
publishing. The render rejects narration that exceeds its scene duration. Generated
voice files, converted fonts and render intermediates are ignored by Git.
The public MP4, poster and subtitle files live under `website/public/media/`.
English and Chinese watch pages use the same Mandarin video and localized text.
