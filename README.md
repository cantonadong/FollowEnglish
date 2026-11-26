# FollowEnglish
<img width="1131" height="655" alt="image" src="https://github.com/user-attachments/assets/0e17eeaf-fca8-4fa2-82fa-447b853a8da1" />

A Windows app for English listening practice (intensive listening / shadowing). Open a video, use existing subtitles or recognize English speech locally, and navigate/replay sentence-by-sentence from the keyboard.

The root `FollowEnglish.exe` opens the local browser player. The server uses a Rust command-line tool for subtitle processing. Audio-only playback reads directly from the video source.

## Features

- Open local videos (mp4, m4v, mov, avi, mkv, flv, webm, wmv) through the native file dialog. The browser plays compatible files directly and converts incompatible tracks as needed.
- Reuse same-directory, same-basename SRT, VTT, ASS or SSA subtitles with their original timestamps; open other subtitle files from **字幕设置** and remember the choice per video
- Rolling (YouTube-style) VTT captions with inline word timestamps are rebuilt into clean sentences
- When no sidecar exists, use embedded text subtitles (English preferred); videos without subtitles still play
- Explicit, cancellable English speech recognition (local and offline: ffmpeg's `whisper` filter, no cloud and no API key); the result is saved as a new SRT beside the video without overwriting existing files
- Edit subtitle sentences in the list (Enter or ✓ to save); edits are kept per subtitle file
- Keyboard: `←`/`→` previous/next sentence, `Space` play/pause, `Q` replay sentence, `R` single-sentence repeat, `X`/`C`/`Z` slower/faster/1.0x, `↑`/`↓` volume, `M` subtitles on/off, `-`/`=` subtitle size
- Single-sentence repeat with an optional 1–9 second gap, click-to-copy sentences, remember last sentence per video, resizable subtitle panel
- Single instance; per-video state stored next to the app in `data/`

## Requirements

- Windows 10/11 x64, Node.js for the local browser server
- [ffmpeg](https://ffmpeg.org/) full build (with `ffprobe` and the `whisper` filter, e.g. the gyan.dev full build) on `PATH`
- For speech recognition: `models/ggml-base.en.bin` (download from [huggingface.co/ggerganov/whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin))

Key files in the browser build:

```
FollowEnglish.exe
backend/dist/server.js
backend/node_modules/
frontend/dist/
target/release/FollowEnglish-subtitles.exe
models/ggml-base.en.bin
```

## Building

The project builds with the GNU toolchain and [llvm-mingw](https://github.com/mstorsjo/llvm-mingw), so the MSVC build tools are not needed:

- `rust-toolchain.toml` selects `stable-x86_64-pc-windows-gnu`
- `.cargo/config.toml` links with `x86_64-w64-mingw32-clang` (llvm-mingw on `PATH`)
- llvm-mingw has no `libgcc_eh.a` / `libgcc.a`. Copy `x86_64-w64-mingw32/lib/libunwind.a` to `libgcc_eh.a`, and `lib/clang/<ver>/lib/windows/libclang_rt.builtins-x86_64.a` to `x86_64-w64-mingw32/lib/libgcc.a`

```
npm --prefix frontend ci
npm --prefix backend ci
build.bat               # build browser app, launcher, and subtitle tool
cargo build --release   # build only the subtitle tool
```

## Documentation

Requirements and the development log (in Chinese) are in [`docs/`](docs/).
