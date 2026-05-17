# Jingling Desktop Pet 项目总结

本文是给后续开发者和代码代理看的项目交接文档。内容基于当前仓库状态整理，重点说明项目定位、工程结构、运行方式、核心模块、数据流、构建发布流程，以及在这个仓库里工作时必须遵守的边界。

## 1. 项目定位

`jingling-desktop-pet` 是一个本地 Windows 桌面宠物与 AI 酒馆聊天管理器。项目目标不是单纯的聊天窗口，而是把轻量桌宠、快捷聊天、角色卡、Persona、世界书、Prompt 预设、多 Provider AI 聊天、关系/好感度、长期记忆、TTS 和本地素材管理组合在一个桌面应用里。

当前项目大致处在 `70%+` 开发进度附近：

- 桌面宠物窗口、快捷聊天窗口、酒馆管理器已经成型。
- 角色/Persona/聊天/世界书/预设/Provider/关系/记忆卡都有前后端数据结构与 UI。
- DeepSeek 及 OpenAI-compatible 风格 Provider 流程已经接入。
- 长期摘要压缩、记忆卡注入、Prompt Preview、关系判定和好感度事件已经有实现。
- Piper 中文本地语音、系统 TTS、语音输入原型、托盘菜单、全局快捷键、开机自启等桌面能力已接入。
- Live2D 正式模型、安装包、商业化配置、导入导出兼容性、移动端体验和扩展功能仍可继续完善。

## 2. 技术栈

- 桌面壳：Tauri v2
- 前端：React 19、TypeScript、Vite、Zustand
- 图形渲染：PixiJS 8、`untitled-pixi-live2d-engine`
- 后端：Rust、Tauri command、reqwest、tokio、keyring
- 桌面能力：Tauri tray、dialog、autostart、global shortcut、asset protocol
- 本地语音：系统 SpeechSynthesis、Piper 中文 medium 语音
- 主要目标平台：Windows。仓库也保留了 Tauri mobile/Android 相关入口和移动预览代码。

## 3. 根目录结构

```text
C:\Game\jingling-desktop-pet
├─ src\                         React 前端主代码
│  ├─ components\                桌宠、快捷聊天、酒馆、自由模式、剧情模式等组件
│  ├─ components\tavern\         酒馆管理器的子页面编辑器
│  ├─ lib\                       Tauri 调用、语音、头像、时间、token 估算等工具
│  ├─ stores\                    Zustand 全局状态
│  ├─ types\                     前后端共享 TypeScript 类型
│  └─ mobile\                    移动端/移动预览 UI
├─ src-tauri\                    Rust/Tauri 后端
│  ├─ src\                       命令、数据、AI、设置、托盘、Piper、Web bridge
│  ├─ resources\piper\           Piper 运行时、DLL、中文模型
│  ├─ capabilities\              Tauri 权限
│  ├─ icons\                     应用图标
│  ├─ tauri.conf.json            release/默认窗口与打包配置
│  └─ tauri.qa.conf.json         QA 窗口与权限叠加配置
├─ public\                       静态资源、内置角色图、Live2D 模型目录
├─ docs\                         补充文档
├─ scripts\                      构建、启动、环境检查脚本
├─ design\                       原型、设计截图和移动端 HTML 预览
├─ release-packages\             已生成的 QA/release 分发材料
├─ README.md                     英文主 README，信息较完整
├─ README.zh-CN.md               中文 README 当前显示为编码错乱
└─ package.json                  npm 脚本和前端依赖
```

注意：仓库里有若干 `src-tauri\src\tavern.rs.*.bak`、`*.recovered-preview*`、`encoding-broken` 等历史恢复文件。这些看起来是修复编码或恢复代码时留下的备份，不要在没有用户确认的情况下删除或覆盖。

## 4. 前端入口和窗口模型

前端入口是 `src\App.tsx`。它根据 Tauri window label 或浏览器 URL 参数选择渲染哪个视图：

- `pet` -> `PetWindow`
- `chat` -> `ChatWindow`
- `tavern` -> `TavernWindow`
- `free-mode` -> `FreeModeWindow`
- `story-mode` -> `StoryModeWindow`
- `mobile` -> `MobileApp`

浏览器预览时可通过 URL 切换：

```text
http://localhost:5173/?view=pet
http://localhost:5173/?view=chat
http://localhost:5173/?view=tavern
http://localhost:5173/?view=free-mode
http://localhost:5173/?view=story-mode
http://localhost:5173/?view=mobile
```

Tauri 默认配置中有三个正式窗口：

- `pet`：透明、无边框、置顶、跳过任务栏，300x360，用于桌宠本体。
- `chat`：透明快捷聊天小窗，默认隐藏，420x620。
- `tavern`：酒馆管理器窗口，默认隐藏，1180x760。

QA 配置额外加入：

- `free-mode`：自由模式 QA 窗口，透明置顶，430x640。
- `story-mode`：剧情模式 QA 窗口，1120x720。

## 5. 主要前端模块

### 5.1 桌宠

相关文件：

- `src\components\PetWindow.tsx`
- `src\components\PetCanvas.tsx`
- `src\stores\petStore.ts`
- `src\App.css`

关键行为：

- 左键点击桌宠：切换快捷聊天窗口。
- 右键点击桌宠：切换酒馆管理器。
- 拖动桌宠：调用 Tauri window dragging。
- 鼠标滚轮：调整桌宠缩放，并写入设置。
- 鼠标悬停、点击、右键、拖动会切换 motion 状态。

Live2D 加载流程在 `PetCanvas.tsx`：

- 检查 `/models/jingling/model-state.json` 是否启用。
- 加载 `/models/jingling/live2dcubismcore.min.js`。
- 加载 `/models/jingling/jingling.model3.json`。
- 若模型未启用或缺少运行时，回退到 `/assets/jingling-placeholder.png`。

### 5.2 快捷聊天

相关文件：

- `src\components\ChatWindow.tsx`
- `src\components\ChatPanel.tsx`
- `src\lib\tauri.ts`
- `src\lib\speech.ts`
- `src\lib\tokenEstimate.ts`

关键能力：

- 选择角色、会话、Persona、Prompt preset、Provider。
- 发送消息、停止生成、流式接收 `chat:chunk`。
- 收到 `chat:done` 后落盘聊天，更新 token 使用信息。
- 支持 `chat:compacted` 和 `chat:compact-error` 事件提示长期记忆压缩状态。
- 支持 TTS 播放，系统语音和 Piper 都有入口。
- 支持聊天字号、消息时间、token 统计、头像 fallback。

### 5.3 酒馆管理器

相关文件：

- `src\components\TavernWindow.tsx`
- `src\components\tavern\CharacterEditor.tsx`
- `src\components\tavern\PersonaEditor.tsx`
- `src\components\tavern\ChatLibrary.tsx`
- `src\components\tavern\WorldbookEditor.tsx`
- `src\components\tavern\PresetEditor.tsx`
- `src\components\tavern\BuiltinLibraryPanel.tsx`
- `src\components\tavern\RelationshipPanel.tsx`
- `src\components\tavern\MemoryPanel.tsx`
- `src\components\tavern\PromptPreview.tsx`

酒馆 Tab：

- 角色：角色卡、头像、舞台配置、默认 preset/provider。
- Persona：用户身份设定。
- 聊天库：会话列表、搜索、导入导出、收藏、清空、摘要编辑。
- 世界书：关键词条目和触发测试。
- 预设：system prompt、作者注释、上下文数量、回复长度、模板。
- 内容库：内置角色、世界书、预设，一键或单项导入。
- 关系：好感度、心情、关系阶段、昵称、待机台词、节日反应。
- 记忆：全局/角色/聊天作用域的长期记忆卡。
- Prompt：最终输入预览、世界书命中、记忆注入、token 分布。
- 扩展：Provider、API Key、连接测试、DeepSeek Web bridge QA。

## 6. 前后端类型与通信

共享类型在 `src\types\tauri.ts`，前端 Tauri wrapper 在 `src\lib\tauri.ts`。

重要类型：

- `TavernCharacter`
- `Persona`
- `TavernChatSession`
- `TavernChatMessage`
- `Worldbook`
- `PromptPreset`
- `ProviderConfig`
- `CharacterRelationship`
- `MemoryCard`
- `PromptBuildResult`
- `ChatMemoryCompactResult`
- `WebBridgeStateSnapshot`

前端通过 `invoke(...)` 调用后端命令，通过 Tauri event 监听变更：

- `chat:chunk`
- `chat:done`
- `chat:error`
- `chat:compacted`
- `chat:compact-error`
- `settings:changed`
- `tavern:chats-changed`
- `tavern:characters-changed`
- `tavern:personas-changed`
- `tavern:presets-changed`
- `tavern:relationships-changed`
- `tavern:memory-changed`

浏览器预览时，`src\lib\tauri.ts` 内部有 mock 数据和 mock 行为，便于不启动桌面壳也能预览 UI。但浏览器预览没有真实窗口管理、凭据管理、托盘、全局快捷键、系统 TTS/Piper 后端等桌面能力。

## 7. Rust 后端模块

### 7.1 `src-tauri\src\lib.rs`

Tauri 应用入口，负责：

- 注册全局状态：`AppState`、`WebBridgeState`、`TtsPreviewState`。
- 注册插件：dialog、autostart、开发日志、global shortcut。
- 桌面启动设置：窗口置顶、隐藏/显示、托盘初始化。
- 注册所有 Tauri command。
- 绑定全局快捷键 `Ctrl+Alt+Space`，用于隐藏/显示桌宠。

### 7.2 `src-tauri\src\settings.rs`

负责：

- API Key 的旧入口保存/检测。
- `AppSettings` 读取和更新。
- 桌宠缩放持久化和应用。
- 三个主窗口与 QA 窗口的 show/hide/toggle。
- always-on-top、autostart。
- Windows 当前前台窗口信息读取。
- 打开浏览器搜索。
- 系统 TTS 试听。
- 清理旧 `memory` 模块里的对话记忆。

### 7.3 `src-tauri\src\tavern.rs`

这是项目最大、最核心的业务模块。负责：

- 本地 tavern 数据路径和 JSON 文件读写。
- 角色、Persona、聊天、世界书、预设、Provider 的 CRUD。
- 内置内容库定义和安装。
- 角色卡、Persona、世界书、预设、聊天的导入导出。
- 头像和舞台素材导入。
- 世界书关键词匹配。
- Prompt 构建与预览。
- Provider URL、认证和模型请求格式。
- 聊天消息追加与摘要压缩。
- 好感度/关系事件判定。
- 记忆卡列表、保存、删除、归档、确认、抽取和注入。

如果要改 AI 上下文、长期记忆、角色卡兼容、世界书触发、Provider 适配，通常都要先读这个文件。

### 7.4 `src-tauri\src\deepseek.rs`

负责实际发送聊天请求：

- `send_message`：构建 prompt，选择 Provider，发起流式请求。
- `cancel_message`：取消当前请求。
- 处理 DeepSeek/Web bridge QA 模式。
- 发出 `chat:chunk`、`chat:done`、`chat:error`。
- 消息完成后追加会话、触发记忆卡抽取、关系判定、长期摘要压缩。
- `compact_chat_memory_command` 和 `extract_memory_cards_for_chat` 暴露手动维护入口。

### 7.5 `src-tauri\src\piper.rs`

负责 Piper 本地 TTS：

- 检测 Piper 可用性和模型路径。
- 调用 `piper.exe` 合成 wav。
- 当前模型位于 `src-tauri\resources\piper\voices\zh_CN-huayan-medium.onnx`。

### 7.6 `src-tauri\src\web_bridge.rs`

DeepSeek Web bridge QA 支持：

- 通过环境变量 `JINGLING_QA_FEATURES=1` 开启。
- 本地 TCP 服务和任务队列。
- 维护 bridge 页面连接状态、job、event。
- 用于把请求交给浏览器中的 DeepSeek 页面处理。

### 7.7 `src-tauri\src\tray.rs`

负责系统托盘：

- 打开快捷聊天。
- 打开酒馆管理器。
- QA 模式下打开自由模式/剧情模式。
- 隐藏窗口。
- 退出应用。
- 托盘点击行为。

### 7.8 `src-tauri\src\memory.rs`

早期简单对话记忆模块，当前主线长期记忆已经迁到 tavern 的聊天摘要和记忆卡体系。除非维护旧功能，否则优先看 `tavern.rs`。

## 8. 本地数据和凭据

主数据目录：

```text
%APPDATA%\com.ly.jingling.pet\tavern_data
```

常见内容：

```text
characters\
personas\
chats\
worldbooks\
presets\
relationships\
avatars\
stage_assets\
memory_cards.json
settings.json
holidays.json
providers.json
```

API Key 不应写入仓库，也不应写入 `.env` 提交。Provider API Key 通过 Windows Credential Manager / keyring 保存。项目 `.gitignore` 已忽略 `.env`、`.env.*`，但保留 `.env.example`。

Tauri asset protocol 当前允许读取：

```text
$APPDATA/**
$APPLOCALDATA/**
```

这是头像、导入素材、本地资源显示的重要基础。改动 capability 时要确认头像和素材路径不会失效。

## 9. AI、Prompt 和长期记忆

核心链路：

1. 前端调用 `sendMessage(...)`。
2. Rust `deepseek::send_message` 判断当前 scope：普通聊天、自由模式或剧情模式。
3. `tavern::build_prompt_for_chat` 或 `tavern::build_prompt_for_story_mode` 构建最终 Prompt。
4. Prompt 组合角色、Persona、preset、聊天摘要、最近原文、收藏摘录、世界书命中、记忆卡、关系阶段提示。
5. Provider 配置决定 endpoint、model、headers、max tokens。
6. 流式响应通过 Tauri event 发回前端。
7. 完成后追加用户和助手消息。
8. 后台触发关系判定、记忆抽取和长期摘要压缩。

长期摘要压缩逻辑：

- 当前 preset 的 `contextMessages` 视为保留原文条数 N。
- 新近 N 条未压缩消息默认保留。
- 超出阈值后，较旧的非收藏消息按批次总结。
- 总结合并进 `chat.summary`。
- 已压缩消息仍留在历史中，但不再作为原文发送给模型。
- 收藏消息不会被自动压缩；收藏已压缩消息会恢复为原文。

记忆卡逻辑：

- 作用域：global、character、chat。
- 类型：preference、boundary、profile、promise、note。
- 状态：active、pending、archived。
- 注入时会按作用域、状态、重要度过滤。
- archived 不应注入模型上下文。

## 10. 关系/好感度系统

关系模型在 `tavern.rs` 和 `src\types\tauri.ts` 中。阶段：

- `guarded`
- `distant`
- `neutral`
- `close`
- `trusted`

每个角色维护：

- affection
- mood
- stage
- stageLabel
- moodLabel
- events
- nicknameSettings
- idleLines
- rulePreferences
- unlocks

交互后会根据 LLM 判定或本地规则更新关系事件。Prompt 构建时会把关系阶段、昵称、待机/节日规则等作为角色行为提示的一部分。

## 11. Provider 和 DeepSeek Web Bridge

Provider 数据通过 `listProviders`、`saveProvider`、`deleteProvider`、`resetProvider`、`saveProviderKey` 管理。默认 Provider 是 DeepSeek，同时项目为 OpenAI-compatible、OpenRouter、Ollama 等兼容流保留了结构。

连接测试走 `testProviderConnection`。发消息时通过 `provider_chat_completions_url` 和 `with_provider_auth` 组装请求。

DeepSeek Web Bridge 是 QA 功能：

- 需要 `JINGLING_QA_FEATURES=1`。
- QA 构建脚本会自动设置。
- 酒馆扩展页可以启动和查看 bridge 状态。
- 正式 release 不应依赖这个能力作为默认聊天通路。

## 12. TTS 和语音输入

系统语音：

- 前端 `speech.ts` 使用浏览器/WebView SpeechSynthesis。
- `settings.rs` 有 Windows 原生试听命令。

Piper：

- 资源目录：`src-tauri\resources\piper`
- 可执行：`piper.exe`
- 中文模型：`voices\zh_CN-huayan-medium.onnx`
- 配置：`voices\zh_CN-huayan-medium.onnx.json`
- 合成命令由 `piper.rs` 调用，前端拿到 wav 路径后播放。

语音输入：

- 快捷聊天中有 WebView/browser-based speech-to-text 原型入口。
- 内置识别不可用时，用户可使用系统输入法或第三方语音输入。

## 13. Live2D 和素材

Live2D 目标目录：

```text
public\models\jingling
```

期望结构：

```text
jingling.model3.json
live2dcubismcore.min.js
textures\
motions\
expressions\
physics3.json
pose3.json
model-state.json
```

启用模型：

```json
{
  "enabled": true
}
```

如果没有正式模型，桌宠会回退到：

```text
public\assets\jingling-placeholder.png
```

`docs\live2d-production.md` 和 `public\models\jingling\README.md` 当前显示为编码错乱，但仍能看出它们描述的是 Cubism 导出流程、模型目录结构和 fallback 行为。重写这些文档前要先确认原始编码或从 README 英文内容复原，避免把有用信息二次破坏。

## 14. 开发命令

安装依赖：

```powershell
npm install
```

检查环境：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/check-env.ps1
```

前端浏览器预览：

```powershell
npm run dev
```

桌面开发：

```powershell
$env:PATH="$env:USERPROFILE\.cargo\bin;$env:PATH"
npm run tauri:dev
```

前端构建：

```powershell
npm run build
```

桌面 release 构建，不打 bundle：

```powershell
npm run tauri:build:release
```

QA 构建：

```powershell
npm run tauri:build:qa
```

运行已构建 release：

```powershell
npm run start:pet
```

运行已构建 QA：

```powershell
npm run start:pet:qa
```

自动选择 release 或 QA：

```powershell
npm run start:pet:auto
```

把 QA 构建提升为 release：

```powershell
npm run tauri:promote
```

完整打包：

```powershell
npm run tauri:bundle
```

注意：`npm run build` 只更新 `dist`，不会更新已经编译好的桌面 exe。改了前端或后端源码后，需要重新运行 Tauri build，桌面 exe 才会包含最新代码。

## 15. 验证命令

常用验证：

```powershell
npm run build
npm run lint
cargo test --manifest-path src-tauri/Cargo.toml
```

建议按改动范围选择：

- 只改 UI/CSS：至少运行 `npm run build`，必要时打开浏览器预览和 Tauri 窗口看布局。
- 改 `src\lib\tauri.ts` 或类型：运行 `npm run build`。
- 改 Rust command 或数据模型：运行 `cargo test --manifest-path src-tauri/Cargo.toml` 和一次 Tauri build。
- 改 Prompt、记忆、Provider、关系：手动验证普通聊天、Prompt Preview、聊天库、记忆面板和关系面板。
- 改 QA window 或 bridge：使用 `npm run tauri:build:qa` 和 `npm run start:pet:qa`。

## 16. 编码和文案注意事项

当前仓库中大量中文字符串出现 mojibake，例如 `椴哥伒`、`閰掗`、`绠€浣撲腑鏂` 等。这可能来自 UTF-8/GBK 误解码后的文件内容，而不仅仅是终端显示问题。

工作建议：

- 不要在不了解上下文时大规模替换这些字符串。
- 新增文档可以正常使用 UTF-8 中文。
- 修复 UI 文案时，优先小范围改动并实际运行预览确认。
- 涉及 `tavern.rs` 这种大文件时，先备份当前状态或确认 git diff，避免再次引入编码破坏。
- README.zh-CN.md 当前不适合作为可靠中文信息源；英文 README 更完整、可读性更好。

## 17. Git 和产物注意事项

`.gitignore` 已忽略：

- `node_modules`
- `dist`
- `src-tauri/target`
- `src-tauri/target-qa`
- `output`
- `.env`
- `.env.*`
- 日志文件
- Piper 临时 wav

仓库当前能看到一些未跟踪目录/文件，例如 `design\`、`release-packages\`、若干内置角色图片、移动端代码、历史恢复备份。处理这些文件前必须先判断它们是否是用户正在保留的工作成果。

不要擅自：

- 删除历史备份文件。
- 删除 release 包。
- 清空本地数据目录。
- 重置或覆盖用户未提交修改。
- 用格式化工具大范围重写混有编码问题的大文件。

## 18. 必须遵守的删除规则

本项目的用户指令明确禁止批量删除文件或目录。不要使用：

```powershell
del /s
rd /s
rmdir /s
Remove-Item -Recurse
rm -rf
```

需要删除文件时，只能一次删除一个明确路径的文件，例如：

```powershell
Remove-Item "C:\path\to\file.txt"
```

如果确实需要批量删除，应停止操作并询问用户。只有用户明确同意后，才可以按用户批准的范围处理。

## 19. Windows/WSL 工作提示

主要工作环境是 Windows + PowerShell。历史上这个项目也配合 WSL/opencode 做过环境准备：

- Windows 路径：`C:\Game\jingling-desktop-pet`
- WSL 映射路径：`/mnt/c/Game/jingling-desktop-pet`
- 如果使用 WSL 运行工具，仍要注意 Tauri Windows 构建、WebView2、Visual Studio Build Tools 等能力主要在 Windows 侧。
- 如果只是安装或运行 opencode，优先使用 WSL Ubuntu 环境会更稳。

## 20. 后续开发优先级建议

较高价值方向：

- 修复中文文案和文档编码，先从 UI 可见文案和 README.zh-CN.md 开始。
- 完善正式 Live2D 模型和动作映射。
- 增强角色卡导入导出兼容性，尤其是 PNG card、SillyTavern/CharacterHub 兼容。
- 梳理 `tavern.rs`，逐步拆分数据读写、Prompt、Provider、记忆、关系等模块。
- 给 Prompt 构建、世界书匹配、记忆卡过滤、摘要压缩增加 Rust 单元测试。
- 完善 installer/bundle 流程和 release 包说明。
- 明确 QA 功能与正式功能边界，避免 Web bridge 泄漏进普通 release 体验。
- 增强移动端代码和桌面端代码之间的能力边界说明。

风险较高方向：

- 大规模替换中文字符串。
- 大规模重构 `tavern.rs`。
- 修改本地数据 JSON schema。
- 修改 Provider 请求格式。
- 修改 Tauri capabilities 或 asset protocol scope。
- 修改聊天摘要和记忆卡注入策略。

这些方向可以做，但需要先写小计划、备份或增加验证用例。

## 21. 快速上手路线

第一次接手建议按这个顺序：

1. 运行 `npm install`。
2. 运行 `scripts/check-env.ps1` 确认 Node、npm、Rust、Cargo。
3. 运行 `npm run dev`，用浏览器看 `?view=chat` 和 `?view=tavern`。
4. 运行 `npm run tauri:dev`，确认真实桌面窗口、托盘、快捷键。
5. 阅读 `src\App.tsx` 和 `src\lib\tauri.ts`，理解前端视图切换和 mock/real invoke。
6. 阅读 `src-tauri\src\lib.rs`，理解命令注册和窗口初始化。
7. 阅读 `src-tauri\src\tavern.rs`，理解数据模型和主业务。
8. 改动前先看 `git status --short`，避免覆盖用户未提交文件。
9. 改完至少跑与改动范围匹配的 build/lint/test。

## 22. 一句话总览

这是一个本地优先的 AI 桌宠/酒馆应用：前端负责多窗口桌面体验和复杂编辑 UI，Rust 后端负责本地数据、系统能力、Provider 请求、Prompt 拼装、长期记忆和关系系统。维护时要特别小心中文编码、本地用户数据、历史备份文件和禁止批量删除的项目规则。
