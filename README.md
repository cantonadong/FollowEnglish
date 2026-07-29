# FollowEnglish

A local web app for English listening practice (intensive listening / shadowing). Upload a video, it's automatically transcribed into sentence-level English subtitles with accurate timestamps, and you can navigate/replay sentence-by-sentence entirely from the keyboard.

## Features

- Upload common video formats (mp4, mov, avi, mkv, flv, webm, wmv) — automatically transcoded for browser playback
- Automatic English transcription and sentence segmentation (local, offline — no cloud API, no API key)
- Keyboard-driven playback: `←`/`→` previous/next sentence, `Space` play/pause, `Q` replay current sentence, `M` toggle subtitles, `-`/`=` subtitle size
- Single-sentence repeat mode for shadowing practice
- Click a sentence in the list to jump to it; click the video to play/pause
- Runs as a lightweight Windows tray app: no console window, single instance, clean process teardown

## How it works

- **Frontend**: React + Vite + TypeScript
- **Backend**: Node.js + Express
- **Transcoding**: ffmpeg (must be installed and on `PATH`)
- **Speech recognition**: ffmpeg's built-in `whisper` audio filter (whisper.cpp) — fully local/offline, no Python or cloud dependency
- **Desktop launcher**: a small Go program (`launcher/`) that runs the backend as a hidden child process, shows a system tray icon, enforces a single running instance (Windows named mutex), and guarantees the backend is torn down even if the tray app is killed (Windows Job Object)

## Requirements to run

- Windows
- [Node.js](https://nodejs.org/) and [ffmpeg](https://ffmpeg.org/) installed and available on `PATH`
- A whisper.cpp ggml model file at `backend/models/ggml-base.en.bin` (not included in this repo due to size — download from [huggingface.co/ggerganov/whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin))

## Running

**Prebuilt release**: download the zip from the [Releases](../../releases) page, extract, place the model file at `backend/models/ggml-base.en.bin`, and run `FollowEnglish.exe`.

**From source**:

```
cd frontend && npm install && npm run build && cd ..
cd backend && npm install && npm run build && cd ..
build.bat   # compiles the Go launcher into FollowEnglish.exe
```

Then run `FollowEnglish.exe`, or use `start.bat` for a console-visible dev run.

## Documentation

Detailed requirements/architecture notes and a running development log (in Chinese) are in [`docs/`](docs/).
