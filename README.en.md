# Jingling Desktop Pet

[Simplified Chinese](./README.md) | [English](./README.en.md)

Jingling Desktop Pet is a Windows desktop companion and local AI tavern chat manager. It is built with Tauri v2, React, TypeScript, and Rust, aiming to combine a lightweight floating pet, quick chat, character cards, personas, lorebooks, prompt presets, multi-provider AI chat, and local data management into one desktop application.

This project is still in active development. The `50%` label in the early commit name means this is a runnable mid-development version, not a final commercial release.

## Features

- Desktop pet window: transparent, frameless, always-on-top, hidden from the taskbar, with mouse drag and wheel scaling.
- Quick chat: click the pet to open a lightweight chat panel, with character, chat, persona, preset, and provider switching.
- Tavern manager: character library, personas, chat library, lorebooks, presets, prompt preview, and extension settings.
- Multi-provider support: DeepSeek is the default provider, with OpenAI-compatible request support reserved for OpenAI, OpenRouter, Ollama, and similar services.
- Local data: characters, personas, chats, lorebooks, presets, and settings are stored in the application data directory.
- API keys: stored through Windows Credential Manager instead of plain-text project configuration.
- TTS: supports system voices and the local Piper Chinese medium voice.
- Desktop experience: tray menu, autostart, always-on-top controls, and the global `Ctrl+Alt+Space` shortcut for hiding or showing the pet.

## Tech Stack

- Desktop shell: Tauri v2
- Frontend: React, TypeScript, Vite, Zustand
- Backend: Rust, reqwest, keyring
- Pet rendering: PixiJS, with Live2D Web Runtime reserved
- Local TTS: Piper + `zh_CN-huayan-medium`

## Project Structure

```text
jingling-desktop-pet
├─ src/                         React frontend
│  ├─ components/               Pet, chat window, and tavern window components
│  ├─ components/tavern/        Tavern manager sub-pages
│  ├─ lib/                      Tauri calls, speech, avatar, and token utilities
│  ├─ stores/                   Frontend state
│  └─ types/                    Shared frontend/backend types
├─ src-tauri/                   Rust/Tauri backend
│  ├─ src/                      DeepSeek, tavern data, settings, tray, and Piper modules
│  ├─ resources/piper/          Piper runtime files and Chinese voice model
│  └─ tauri.conf.json           Tauri window and packaging configuration
├─ public/                      Static assets and Live2D model placeholder directory
├─ docs/                        Additional documentation
└─ scripts/                     Helper scripts
```

## Requirements

Install the following tools before development:

- Node.js and npm
- Rustup / Cargo
- Visual Studio Build Tools with the C++ toolchain
- Microsoft WebView2 Runtime

Install project dependencies:

```powershell
cd jingling-desktop-pet
npm install
```

## Development

```powershell
cd jingling-desktop-pet
$env:PATH="$env:USERPROFILE\.cargo\bin;$env:PATH"
npm run tauri:dev
```

Frontend-only preview:

```powershell
npm run dev
```

The browser preview and desktop app share the same React codebase, but the browser preview does not have desktop features such as always-on-top windows, tray menus, system credentials, or global shortcuts.

## Build

```powershell
cd jingling-desktop-pet
$env:PATH="$env:USERPROFILE\.cargo\bin;$env:PATH"
npm run build
npm run tauri:build
```

The default executable path after a release build is inside the project directory:

```text
src-tauri\target\release\jingling_desktop_pet.exe
```

## Data Location

Tavern data is stored in the system application data directory, for example:

```text
%APPDATA%\com.ly.jingling.pet\tavern_data
```

Common subdirectories:

```text
characters/
personas/
chats/
worldbooks/
presets/
settings.json
```

API keys are stored in Windows Credential Manager and are not saved in the Git repository.

## Piper Voice

Piper Chinese voice files are located at:

```text
src-tauri\resources\piper
```

The current repository keeps only the Chinese medium model and the required runtime dependencies:

```text
src-tauri\resources\piper\voices\zh_CN-huayan-medium.onnx
src-tauri\resources\piper\voices\zh_CN-huayan-medium.onnx.json
```

After selecting `Piper Chinese medium` in settings, use `check` and `test voice` to verify that it works.

## Common Operations

- Left-click the pet: show or hide quick chat.
- Right-click the pet: show or hide the tavern manager.
- Mouse wheel: scale the pet.
- `Ctrl+Alt+Space`: hide or show the pet.
- Tavern extension page: save provider API keys.
- Chat settings area: switch character, chat, persona, preset, and provider.

## Git Notes

This repository commits source code and required assets only. Dependencies and build outputs are ignored.

Common ignored directories include:

```text
node_modules
dist
src-tauri/target
src-tauri/target-qa
output
*.log
```

After cloning the project again, run:

```powershell
npm install
npm run tauri:build
```

## Verification

```powershell
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

## Current Status

This is a development version around the "Jingling first commit - 50%" milestone. The basic desktop pet, quick chat, tavern manager, DeepSeek/provider integration, local data storage, and Piper Chinese voice support are already in place. Future work can continue with the final Live2D model, long-term memory, improved TTS, import/export polish, installer packaging, and commercial-ready settings.
