# Jingling Desktop Pet

[English](./README.md) | [简体中文](./README.zh-CN.md)

Jingling Desktop Pet is a local Windows desktop companion and AI tavern chat manager. It is built with Tauri v2, React, TypeScript, and Rust, aiming to combine a lightweight floating pet, quick chat, character cards, personas, lorebooks, prompt presets, multi-provider AI chat, relationship/affection tracking, and long-term memory management into one local desktop application.

The project is still in active development. The current progress is around `70%+`: the desktop pet, quick chat, tavern manager, avatars, TTS, relationship system, long-term summary compaction, memory cards, built-in content library, and voice input prototype are already in place. Installer packaging, commercial settings, the final Live2D model, and more extension features can still be improved.

## Features

- Desktop pet window: transparent, frameless, always-on-top, hidden from the taskbar, with mouse dragging and mouse-wheel scaling.
- Quick chat: click the pet to open a compact chat window with character, chat session, persona, preset, and provider switching.
- Chat input: supports text input, `Ctrl + mouse wheel` chat font-size adjustment, and WebView/browser-based speech-to-text input. If built-in recognition is unavailable, users can use the system IME or a third-party voice input method.
- Tavern manager: manages characters, personas, chats, lorebooks, presets, built-in content, relationship state, long-term memory, prompt preview, and extension settings.
- Built-in content library: provides multi-style characters, public lorebooks, and presets, with single-item import, recommended-pack import, and installed-item skipping. The current built-in set includes `12` characters, `8` lorebooks, and `10` presets.
- Character and persona avatars: supports avatar uploads, and chat bubbles sync character/user avatars. Name-based fallback avatars are used when no avatar is configured.
- Relationship system: stores per-character affection, mood, relationship stage, relationship events, nickname settings, idle lines, and holiday reactions.
- Long-term summary compaction: dynamically compresses older messages according to the active preset context count. AI-generated summaries are merged into `chat.summary`; compacted messages are still visible in history, while bookmarked messages are always kept as original text.
- Memory cards: supports extracted or manually maintained long-term memories, including preferences, boundaries, user facts, promises, and notes. Cards can be confirmed, archived, and deleted.
- Chat library: supports search, message bookmarks, chat import/export, manual long-term-memory cleanup, and summary editing.
- Prompt preview: shows the final model input, including system prompt, long-term summary, recent original messages, bookmarked excerpts, lorebook matches, and memory-card injection.
- Multi-provider support: DeepSeek is the default provider, with OpenAI-compatible, OpenRouter, Ollama, and similar compatible flows reserved.
- Local data: characters, personas, chats, lorebooks, presets, relationships, and settings are stored in the system application data directory.
- API keys: stored through Windows Credential Manager instead of plain-text project configuration.
- TTS: supports system voices and the local Piper Chinese medium voice.
- Desktop experience: tray menu, autostart, always-on-top controls, and the global `Ctrl+Alt+Space` shortcut for hiding or showing the pet.

## Recent Desktop Build Updates

Compared with the older desktop executable, the latest release build includes the preview-side tavern and memory work:

- The latest frontend preview has been rebuilt into the desktop executable.
- Added and expanded the memory-card system for global, character-scoped, and chat-scoped long-term memories.
- Added message-level actions to remember a message or mark it as "do not remember".
- Expanded prompt preview with long-term summary status, recent original message count, bookmarked excerpt count, compacted message count, memory-card count, stable-prefix tokens, dynamic-context tokens, prompt layout version, matched lorebook entries, and injected memory cards.
- Improved prompt assembly with a more cache-friendly stable prefix and a separate dynamic context section.
- Enhanced character-card import details, including PNG card avatar fallback when avatar metadata is missing.
- Added QA build scripts so a test build can be created under `target-qa` before being promoted to the release executable.
- Improved chat details such as compacted-message labels, memory action buttons, speech-input affordances, and richer token/context budget display.

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
│  ├─ components/               Pet, chat window, settings drawer, and tavern window components
│  ├─ components/tavern/        Tavern manager sub-pages
│  ├─ lib/                      Tauri calls, time, avatar, token estimation, and utilities
│  ├─ stores/                   Frontend state
│  └─ types/                    Shared frontend/backend types
├─ src-tauri/                   Rust/Tauri backend
│  ├─ src/                      Chat, tavern data, settings, tray, Piper, and relationship logic
│  ├─ resources/piper/          Piper runtime files and Chinese voice model
│  └─ tauri.conf.json           Tauri window and packaging configuration
├─ public/                      Static assets and Live2D model placeholder directory
├─ docs/                        Additional documentation
└─ scripts/                     Helper scripts, including QA build and promote-to-release flow
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

The project also provides two common desktop build targets:

```powershell
# Build a QA executable under src-tauri\target-qa
npm run tauri:build:qa

# Copy the QA build into the release directory
npm run tauri:promote

# Build the release executable directly
npm run tauri:build:release
```

Common executable paths:

```text
src-tauri\target\release\jingling_desktop_pet.exe
src-tauri\target-qa\release\jingling_desktop_pet.exe
```

Note: `npm run build` only builds the frontend `dist` directory. It does not update an already compiled desktop executable. After source changes, run a Tauri build command again so the desktop app includes the latest frontend and backend code.

## Data Location

Tavern data is stored in the system application data directory, for example:

```text
%APPDATA%\com.ly.jingling.pet\tavern_data
```

Common data includes:

```text
characters/
personas/
chats/
worldbooks/
presets/
relationships/
avatars/
memory_cards.json
settings.json
holidays.json
```

API keys are stored in Windows Credential Manager and are not saved in the Git repository.

## Long-Term Summary Compaction

Long-term chat memory is controlled dynamically by the active preset context count:

- Let the context message count be `N`.
- The latest `N` uncompacted original messages are kept by default.
- When uncompacted messages exceed the limit, the older `N / 2` non-bookmarked messages are summarized.
- The AI merges the old summary and the current batch into a new structured `chat.summary`.
- Compacted old messages are marked as compacted and no longer sent to the model, but remain visible in chat history.
- Bookmarked messages are never automatically compacted; bookmarking a compacted message restores it as original text.

The long-term summary focuses on:

- User identity and preferences
- Important relationship details with characters
- Important events that already happened
- Unfinished topics or promises
- User emotional tendencies
- Nicknames, boundaries, and habits that characters should remember

## Memory Cards

Memory cards store stable facts and preferences beyond the rolling chat summary:

- Supports global, character, and chat scopes.
- Supports preference, boundary, user fact, promise, and note types.
- Chat messages can be manually marked as "remember this" or "do not remember this".
- Cards can be viewed, searched, edited, confirmed, archived, and deleted in the tavern memory panel.
- When building prompts, cards are filtered by scope, status, and importance. Archived cards are not injected.

## Piper Voice

Piper Chinese voice files are located at:

```text
src-tauri\resources\piper
```

The current repository keeps the Chinese medium model and required runtime dependencies:

```text
src-tauri\resources\piper\voices\zh_CN-huayan-medium.onnx
src-tauri\resources\piper\voices\zh_CN-huayan-medium.onnx.json
```

After selecting `Piper Chinese medium` in settings, use check and test voice to verify that it works.

## Common Operations

- Left-click the pet: show or hide quick chat.
- Right-click the pet: show or hide the tavern manager.
- Mouse wheel: scale the pet; the value syncs with the settings drawer.
- `Ctrl + mouse wheel` in the chat message area: adjust chat font size.
- `Ctrl+Alt+Space`: hide or show the pet.
- Tavern extension page: save provider API keys.
- Chat settings area: switch character, chat session, persona, preset, and provider.
- Chat input area: the paper-plane button sends a message; during AI generation it becomes a stop button. The microphone button starts speech-to-text, and recognized text is placed into the input box without auto-sending.
- Tavern chat library: view history, bookmark messages, edit summaries, and manually organize long-term memory.
- Tavern relationship page: view and reset character affection, mood, and relationship settings.
- Tavern built-in library: filter built-in characters, lorebooks, and presets, with search, single-item import, and recommended-pack import.

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
npm run lint
cargo test --manifest-path src-tauri/Cargo.toml
```

## Current Status

This is a development version around the "Tavern affection update - 70%+" milestone. The current build includes the basic desktop pet experience, quick chat, tavern manager, character/persona avatars, DeepSeek/provider integration, local data, Piper Chinese voice, relationship and affection events, long-term summary compaction, memory cards, expanded built-in content, speech input, and enhanced prompt preview. Future work can continue with the final Live2D model, installer packaging, plugin extensions, movement/click interaction polish, import/export compatibility, and more complete commercial settings.
