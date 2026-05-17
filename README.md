# Jingling Desktop Pet

[English](./README.md) | [简体中文](./README.zh-CN.md)

Jingling Desktop Pet is a local Windows desktop companion and AI tavern chat manager. It combines a transparent floating pet, quick chat, character cards, personas, lorebooks, prompt presets, relationship/affection state, memory cards, TTS, and multiple model providers into one Tauri desktop app.

The project is still under active development. The current codebase is a QA-oriented desktop build with the main tavern workflow already usable, plus experimental Free Mode and Story Mode windows. Installer packaging, final Live2D assets, release hardening, and broader import/export compatibility are still ongoing work.

## Features

- Desktop pet: transparent, frameless, always-on-top, hidden from the taskbar, draggable, scalable with the mouse wheel, and controllable from the tray.
- Quick chat: compact chat window with character, chat session, persona, preset, provider, token display, TTS, and speech-to-text controls.
- Tavern manager: local management for characters, personas, chats, lorebooks, presets, built-in content, relationships, memory cards, prompt preview, and provider settings.
- Built-in content library: manual import for built-in characters, lorebooks, and presets without overwriting user edits. The current library contains `27` characters, `15` lorebooks, and `17` presets.
- Character staging resources: character cards can define visual-novel resources such as sprites, expressions, scenes, BGM, and default stage settings.
- Relationship system: per-character affection, mood, relationship stage, event log, nickname settings, idle lines, holiday reactions, local scoring rules, and warm recovery.
- Memory cards: user-visible long-term facts and preferences with global, character, and chat scopes. Cards can be active, pending, archived, confirmed, edited, or deleted.
- Long-term summary compaction: older chat messages can be summarized into `chat.summary` and marked as compacted while still remaining visible in history.
- Prompt preview: shows stable prefix tokens, dynamic context tokens, prompt layout version, memory cards, lorebook matches, summaries, bookmarks, and the final messages sent to the model.
- Cache-friendly prompt layout: stable role/preset/persona content is separated from dynamic time, relationship, memory, summary, and lorebook context.
- Multi-provider chat: built-in DeepSeek, OpenAI-compatible, OpenRouter, Qwen/DashScope, Zhipu GLM, MiniMax, Xiaomi MiMo, Ollama, and custom provider support.
- Provider credentials: API keys are stored through Windows Credential Manager or environment variables instead of plain-text project files.
- TTS: browser/system speech synthesis plus local Piper Chinese medium voice support.
- Local data: characters, personas, chats, lorebooks, presets, relationships, memory cards, holidays, and provider metadata are stored locally under the app data directory.

## QA-Only Modes

The QA build enables extra experimental windows that are hidden from the normal release build unless promoted:

- Free Mode QA: a lightweight always-on-top assistant panel that can use the selected character, remember its chat id locally, inspect the active Windows foreground title/process, open browser searches, and optionally save memory hints.
- Story Mode QA: a visual-novel style scene window. It asks the model to return structured JSON frames with speaker, text, sprite, expression, scene, BGM, mood, and optional choices. It uses the QA preset `视觉小说演出模板 QA`.
- DeepSeek Web Bridge Provider: a QA-only provider that can route requests through a local web bridge when enabled.

Use the QA target when testing these features:

```powershell
npm run tauri:build:qa
npm run start:pet:qa
```

Promote a verified QA executable to the normal release output with:

```powershell
npm run tauri:promote
```

## Tech Stack

- Desktop shell: Tauri v2
- Frontend: React, TypeScript, Vite, Zustand
- Backend: Rust, reqwest, keyring
- Pet rendering: PixiJS, with Live2D runtime support reserved
- Local voice: Piper + `zh_CN-huayan-medium`

## Project Structure

```text
jingling-desktop-pet
├─ src/                         React frontend
│  ├─ components/               Pet, chat, tavern, free mode, and story mode windows
│  ├─ components/tavern/        Tavern manager sub-pages
│  ├─ lib/                      Tauri calls, avatar, speech, time, token estimation, utilities
│  ├─ stores/                   Frontend state
│  └─ types/                    Shared frontend/backend types
├─ src-tauri/                   Rust/Tauri backend
│  ├─ src/                      Chat, tavern data, settings, tray, provider, Piper, relationship logic
│  ├─ resources/piper/          Piper runtime files and Chinese voice model
│  ├─ tauri.conf.json           Normal desktop window configuration
│  └─ tauri.qa.conf.json        QA-only free/story mode window configuration
├─ public/                      Static assets and Live2D/model placeholders
├─ scripts/                     Build, start, QA, and promote helper scripts
└─ docs/                        Additional documentation when present
```

## Requirements

Install these before development:

- Node.js and npm
- Rustup / Cargo
- Visual Studio Build Tools with the C++ toolchain
- Microsoft WebView2 Runtime

Install dependencies:

```powershell
cd C:\Game\jingling-desktop-pet
npm install
```

## Development

```powershell
cd C:\Game\jingling-desktop-pet
$env:PATH="$env:USERPROFILE\.cargo\bin;$env:PATH"
npm run tauri:dev
```

Frontend-only preview:

```powershell
npm run dev
```

The browser preview and desktop app share the same React code, but the browser preview cannot use desktop-only features such as always-on-top windows, tray menus, secure credentials, native window management, and global shortcuts.

## Build

Frontend build:

```powershell
npm run build
```

Desktop builds:

```powershell
# Normal desktop executable under src-tauri\target\release
npm run tauri:build:release

# QA executable under src-tauri\target-qa\release
npm run tauri:build:qa

# Copy the tested QA executable into the normal release directory
npm run tauri:promote

# Full Tauri bundle, when installer/package output is needed
npm run tauri:bundle
```

Common executable paths:

```text
src-tauri\target\release\jingling_desktop_pet.exe
src-tauri\target-qa\release\jingling_desktop_pet.exe
```

Note: `npm run build` only updates the frontend `dist` directory. It does not update an already compiled desktop executable. Run a Tauri build command after source changes.

## Data Location

Tavern data is stored in the application data directory:

```text
%APPDATA%\com.ly.jingling.pet\tavern_data
```

Common files and folders:

```text
avatars/
characters/
chats/
personas/
presets/
relationships/
worldbooks/
holidays.json
memory_cards.json
providers.json
settings.json
```

API keys are stored in Windows Credential Manager or read from supported environment variables, such as `DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY`, `DASHSCOPE_API_KEY`, `ZHIPU_API_KEY`, and `MIMO_API_KEY`.

## Prompt And Memory

Chat prompts are built from several layers:

- Stable prefix: preset system prompt, character card, example dialogue, persona, author notes, output rules, and reply length rules.
- Chat history: recent uncompacted messages selected by the active preset.
- Dynamic context: current local time, relationship state, memory cards, long-term summary, bookmarked excerpts, and matched lorebook entries.
- Current input: the latest user message.

Long-term summary compaction keeps the active chat window manageable:

- The active preset controls context message count and input budget.
- When active uncompacted messages reach the context limit, the older front half is summarized.
- When the estimated input tokens exceed half of the preset input budget, the older front half can also be summarized.
- Compacted messages are not sent raw to the model, but remain visible in history.
- Bookmarked messages are preserved and can be injected as excerpts.

Memory cards are a separate, user-controllable memory layer:

- Scopes: global, character, and chat.
- Types: preference, boundary, profile, promise, and note.
- Statuses: active, pending, and archived.
- Prompt injection selects matching active cards by scope, status, and importance.

## Relationship System

Each character has a shared relationship state across chats:

- Affection and mood range from `-100` to `100`.
- Stages include guarded, distant, neutral, close, and trusted.
- Local rules handle obvious praise, care, apology, insults, threats, boundaries, and role-specific preferences.
- Ambiguous relationship changes can fall back to model JSON scoring.
- Events are kept as a short recent log and shown in the relationship panel.
- Nicknames, idle lines, and holiday reactions are managed per character.

## Provider Notes

Built-in providers include:

- DeepSeek
- OpenAI-compatible endpoint
- OpenRouter
- Qwen / Alibaba DashScope
- Zhipu GLM
- MiniMax
- Xiaomi MiMo
- Ollama local models
- DeepSeek Web Bridge in QA builds

Provider settings support editable model names, base URLs, auth type, and token limit field selection. Non-DeepSeek providers do not receive DeepSeek-specific request options.

## Piper Voice

Piper runtime files are stored under:

```text
src-tauri\resources\piper
```

The current Chinese voice files are:

```text
src-tauri\resources\piper\voices\zh_CN-huayan-medium.onnx
src-tauri\resources\piper\voices\zh_CN-huayan-medium.onnx.json
```

After selecting `Piper Chinese medium` in settings, use the voice check/test action to verify playback.

## Common Operations

- Left-click the pet: show or hide quick chat.
- Right-click the pet: show or hide the tavern manager.
- Mouse wheel over the pet: scale the pet.
- `Ctrl + mouse wheel` in the chat message area: adjust chat font size.
- `Ctrl+Alt+Space`: hide or show the pet.
- Tavern > Extensions > Provider: configure providers and API keys.
- Tavern > Content Library: import built-in characters, lorebooks, and presets.
- Tavern > Relationship: inspect affection, mood, event logs, role preferences, nicknames, idle lines, and holiday reactions.
- Tavern > Memory: inspect, confirm, edit, archive, and delete memory cards.
- Tavern > Prompt Preview: verify exactly what is being sent to the model.

## Verification

```powershell
npm run build
npm run lint
cargo test --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml tavern::tests
npm run tauri:build:qa
```

## Git Notes

This repository should commit source code and required assets only. Do not commit local chat data, API keys, build outputs, temporary backups, generated release packages, or personal AppData files.

Common ignored or uncommitted paths include:

```text
node_modules
dist
src-tauri/target
src-tauri/target-qa
release-packages
*.log
*.bak
```

## Current Status

The current code is a QA-stage desktop build with the core pet, chat, tavern, provider, relationship, memory, prompt preview, Piper voice, and built-in content workflows in place. The latest QA track also includes Free Mode and Story Mode experiments. Future work should focus on installer packaging, release polish, final Live2D assets, stronger import/export compatibility, UI refinement, and safer distribution defaults.
