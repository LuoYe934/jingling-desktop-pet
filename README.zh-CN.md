# 鲸灵桌宠

[English](./README.md) | [简体中文](./README.zh-CN.md)

鲸灵桌宠是一个面向 Windows 的本地桌面宠物与 AI 酒馆聊天管理器。它把透明悬浮桌宠、快捷聊天、角色卡、Persona、世界书、预设、好感度关系、记忆卡片、TTS 和多模型 Provider 整合到一个 Tauri 桌面应用里。

项目仍处于活跃开发阶段。当前代码更偏 QA 测试版：酒馆主流程已经基本可用，同时新增了实验性的自由模式和剧情模式窗口。安装包、正式 Live2D 资源、发布前稳定性、导入导出兼容和商业化配置仍在继续完善。

## 主要功能

- 桌宠窗口：透明、无边框、置顶、跳过任务栏，支持拖动、鼠标滚轮缩放和托盘控制。
- 快捷聊天：聊天小窗支持角色、会话、Persona、预设、Provider、token 显示、TTS 和语音转文字。
- 酒馆管理器：本地管理角色、Persona、聊天库、世界书、预设、内置内容库、关系、记忆卡片、Prompt 预览和 Provider 设置。
- 内置内容库：手动导入内置角色、世界书和预设，不自动覆盖用户已修改内容。当前内置 `27` 个角色、`15` 本世界书、`17` 个预设。
- 角色演出资源：角色卡可配置视觉小说演出资源，包括立绘、表情、场景、BGM 和默认舞台设置。
- 好感度关系系统：按角色保存好感、心情、关系阶段、事件日志、昵称、待机台词、节日反应、本地评分规则和温和恢复机制。
- 记忆卡片：用户可见、可修改的长期事实和偏好，支持全局、角色、聊天三种范围，以及生效、待确认、已归档状态。
- 长期摘要压缩：旧聊天可总结进 `chat.summary` 并标记为已压缩；历史仍可回看，但已压缩原文不再直接进入 prompt。
- Prompt 预览：显示稳定前缀 tokens、动态上下文 tokens、Prompt 布局版本、记忆卡片、世界书命中、长期摘要、收藏摘录和最终发送给模型的消息。
- 缓存友好 Prompt：稳定的角色/预设/Persona 内容与动态时间、关系、记忆、摘要、世界书内容分层组装。
- 多 Provider 聊天：内置 DeepSeek、OpenAI 兼容接口、OpenRouter、千问/阿里百炼、智谱 GLM、MiniMax、小米 MiMo、Ollama 和自定义 Provider。
- Provider 凭据：API Key 使用 Windows Credential Manager 或环境变量，不写入普通项目配置文件。
- TTS 语音：支持浏览器/系统 speechSynthesis，也支持本地 Piper 中文 medium 语音。
- 本地数据：角色、Persona、聊天、世界书、预设、关系、记忆卡片、节日和 Provider 元数据保存在本机应用数据目录。

## QA 专用模式

QA 构建会启用普通 release 构建中隐藏的实验窗口：

- 自由模式 QA：轻量置顶助手面板，可使用当前角色，保留自己的聊天 id，读取当前 Windows 前台窗口标题/进程，打开浏览器搜索，并可保存明显记忆提示。
- 剧情模式 QA：视觉小说式场景窗口。模型返回结构化 JSON 帧，包含说话人、文本、立绘、表情、场景、BGM、心情和可选选项。它使用 QA 预设 `视觉小说演出模板 QA`。
- DeepSeek 网页桥 Provider：QA 专用 Provider，可在启用时通过本地网页桥转发请求。

测试这些功能时使用 QA 目标：

```powershell
npm run tauri:build:qa
npm run start:pet:qa
```

确认 QA 版本没问题后，可同步到正式 release 输出目录：

```powershell
npm run tauri:promote
```

## 技术栈

- 桌面壳：Tauri v2
- 前端：React、TypeScript、Vite、Zustand
- 后端：Rust、reqwest、keyring
- 桌宠渲染：PixiJS，预留 Live2D Runtime 支持
- 本地语音：Piper + `zh_CN-huayan-medium`

## 目录结构

```text
jingling-desktop-pet
├─ src/                         React 前端
│  ├─ components/               桌宠、聊天、酒馆、自由模式、剧情模式窗口
│  ├─ components/tavern/        酒馆管理器子页面
│  ├─ lib/                      Tauri 调用、头像、语音、时间、token 估算和工具
│  ├─ stores/                   前端状态
│  └─ types/                    前后端共享类型
├─ src-tauri/                   Rust/Tauri 后端
│  ├─ src/                      聊天、酒馆数据、设置、托盘、Provider、Piper、关系逻辑
│  ├─ resources/piper/          Piper 运行文件和中文语音模型
│  ├─ tauri.conf.json           普通桌面窗口配置
│  └─ tauri.qa.conf.json        QA 自由/剧情模式窗口配置
├─ public/                      静态资源和 Live2D/模型占位目录
├─ scripts/                     构建、启动、QA、同步 release 的辅助脚本
└─ docs/                        补充文档目录
```

## 环境准备

需要先安装：

- Node.js 和 npm
- Rustup / Cargo
- Visual Studio Build Tools C++ 工具链
- Microsoft WebView2 Runtime

安装依赖：

```powershell
cd C:\Game\jingling-desktop-pet
npm install
```

## 开发运行

```powershell
cd C:\Game\jingling-desktop-pet
$env:PATH="$env:USERPROFILE\.cargo\bin;$env:PATH"
npm run tauri:dev
```

只启动前端预览：

```powershell
npm run dev
```

浏览器预览和桌面端使用同一套 React 代码，但浏览器预览不能使用置顶窗口、托盘、系统凭据、原生窗口管理和全局快捷键等桌面能力。

## 构建

前端构建：

```powershell
npm run build
```

桌面端构建：

```powershell
# 普通桌面 exe，输出到 src-tauri\target\release
npm run tauri:build:release

# QA exe，输出到 src-tauri\target-qa\release
npm run tauri:build:qa

# 将测试通过的 QA exe 复制到普通 release 目录
npm run tauri:promote

# 需要安装包/完整包时使用
npm run tauri:bundle
```

常用 exe 路径：

```text
src-tauri\target\release\jingling_desktop_pet.exe
src-tauri\target-qa\release\jingling_desktop_pet.exe
```

注意：`npm run build` 只更新前端 `dist`，不会更新已经编译好的桌面端 exe。源码改动后需要重新运行 Tauri 构建命令。

## 数据位置

酒馆数据保存在应用数据目录：

```text
%APPDATA%\com.ly.jingling.pet\tavern_data
```

常见文件和文件夹：

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

API Key 保存到 Windows Credential Manager，或从支持的环境变量读取，例如 `DEEPSEEK_API_KEY`、`OPENROUTER_API_KEY`、`DASHSCOPE_API_KEY`、`ZHIPU_API_KEY`、`MIMO_API_KEY`。

## Prompt 与记忆

聊天 prompt 由几层组成：

- 稳定前缀：预设 system prompt、角色卡、示例对话、Persona、作者注释、输出规则和回复长度规则。
- 聊天历史：按当前预设选择的最近未压缩消息。
- 动态上下文：当前本地时间、关系状态、记忆卡片、长期摘要、收藏摘录和命中的世界书。
- 本轮输入：最新用户消息。

长期摘要压缩用于控制聊天上下文：

- 当前预设控制上下文条数和输入预算。
- 未压缩消息达到上下文条数时，会整理较早的前半部分。
- token 估算超过预设输入预算一半时，也可以整理较早的前半部分。
- 已压缩消息不再原文发送给模型，但仍保留在聊天历史里。
- 收藏消息会保留，并可作为收藏摘录注入 prompt。

记忆卡片是独立的、用户可控的长期记忆层：

- 范围：全局、角色、聊天。
- 类型：偏好、禁忌、用户事实、承诺、备注。
- 状态：生效、待确认、已归档。
- 注入 prompt 时按范围、状态和重要度筛选。

## 好感度关系系统

每个角色在不同聊天中共享一份关系状态：

- 好感和心情范围为 `-100` 到 `100`。
- 阶段包括戒备、疏离、普通、亲近、信赖。
- 本地规则处理明显夸奖、关心、道歉、辱骂、威胁、边界和角色偏好。
- 模糊的关系变化可交给模型 JSON 评分兜底。
- 最近事件会保留在关系页中。
- 昵称、待机台词、节日反应按角色管理。

## Provider 说明

内置 Provider 包括：

- DeepSeek
- OpenAI 兼容接口
- OpenRouter
- 千问 / 阿里百炼
- 智谱 GLM
- MiniMax
- 小米 MiMo
- Ollama 本地模型
- QA 构建中的 DeepSeek 网页桥

Provider 设置支持修改模型名、接口地址、鉴权方式和输出 token 字段。非 DeepSeek Provider 不会发送 DeepSeek 专属参数。

## Piper 语音

Piper 运行文件位于：

```text
src-tauri\resources\piper
```

当前中文语音文件：

```text
src-tauri\resources\piper\voices\zh_CN-huayan-medium.onnx
src-tauri\resources\piper\voices\zh_CN-huayan-medium.onnx.json
```

在设置里选择 `Piper 中文 medium` 后，可以用检测/试听验证播放。

## 常用操作

- 左键点击桌宠：显示或隐藏快捷聊天。
- 右键点击桌宠：显示或隐藏酒馆管理器。
- 在桌宠上滚轮：缩放桌宠。
- 聊天消息区域 `Ctrl + 鼠标滚轮`：调整聊天字号。
- `Ctrl+Alt+Space`：隐藏或显示桌宠。
- 酒馆 > 扩展 > Provider：配置 Provider 和 API Key。
- 酒馆 > 内容库：导入内置角色、世界书和预设。
- 酒馆 > 关系：查看好感、心情、事件、角色偏好、昵称、待机台词和节日反应。
- 酒馆 > 记忆：查看、确认、编辑、归档、删除记忆卡片。
- 酒馆 > Prompt 预览：确认实际发送给模型的内容。

## 验收命令

```powershell
npm run build
npm run lint
cargo test --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml tavern::tests
npm run tauri:build:qa
```

## Git 说明

仓库应只提交源码和必要资源。不要提交本地聊天数据、API Key、构建产物、临时备份、发布压缩包或个人 AppData 文件。

常见忽略或不应提交的路径：

```text
node_modules
dist
src-tauri/target
src-tauri/target-qa
release-packages
*.log
*.bak
```

## 当前状态

当前代码是 QA 阶段桌面端：桌宠、聊天、酒馆、Provider、关系、记忆、Prompt 预览、Piper 语音和内置内容库主流程已经具备。最新 QA 线还加入了自由模式和剧情模式实验。后续重点是安装包、发布稳定性、正式 Live2D 资源、更完整的导入导出兼容、UI 细节和更安全的分发默认值。
