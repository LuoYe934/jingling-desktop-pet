# 鲸灵桌宠

[简体中文](./README.md) | [English](./README.en.md)

鲸灵桌宠是一个 Windows 桌面宠物与本地酒馆聊天管理器项目。项目基于 Tauri v2、React、TypeScript 和 Rust 构建，目标是把轻量桌宠、快捷聊天、角色卡管理、世界书、预设和多 Provider 聊天整合到一个本地桌面应用里。

当前项目仍处于开发阶段，提交名里的 `50%` 代表这是中途可运行版本，不是最终商业发行版。

## 主要功能

- 桌宠窗口：透明、无边框、置顶、跳过任务栏，支持鼠标拖动、滚轮缩放。
- 快捷聊天：点击桌宠打开聊天小窗，支持角色、聊天、Persona、预设和 Provider 切换。
- 酒馆管理器：角色库、Persona、聊天库、世界书、预设、Prompt 预览和扩展设置。
- 多 Provider：默认 DeepSeek，预留并接入 OpenAI 兼容接口、OpenRouter、Ollama 等 OpenAI-compatible 请求流程。
- 本地数据：角色、Persona、聊天、世界书、预设等保存到应用数据目录。
- API Key：使用 Windows Credential Manager 保存，不明文写入项目配置。
- TTS 语音：支持系统语音和 Piper 中文 medium 本地语音。
- 桌面体验：托盘菜单、开机自启、窗口置顶、全局快捷键 `Ctrl+Alt+Space` 隐藏/显示桌宠。

## 技术栈

- 桌面壳：Tauri v2
- 前端：React、TypeScript、Vite、Zustand
- 后端：Rust、reqwest、keyring
- 桌宠渲染：PixiJS、Live2D Web Runtime 预留
- 本地 TTS：Piper + `zh_CN-huayan-medium`

## 目录结构

```text
jingling-desktop-pet
├─ src/                         React 前端
│  ├─ components/               桌宠、聊天窗、酒馆窗口组件
│  ├─ components/tavern/        酒馆管理器子页面
│  ├─ lib/                      Tauri 调用、语音、头像、token 工具
│  ├─ stores/                   前端状态
│  └─ types/                    前后端共享类型
├─ src-tauri/                   Rust/Tauri 后端
│  ├─ src/                      DeepSeek、酒馆数据、设置、托盘、Piper
│  ├─ resources/piper/          Piper 运行文件和中文模型
│  └─ tauri.conf.json           Tauri 窗口与打包配置
├─ public/                      静态资源和 Live2D 模型占位目录
├─ docs/                        补充文档
└─ scripts/                     辅助脚本
```

## 环境准备

需要安装：

- Node.js 和 npm
- Rustup / Cargo
- Visual Studio Build Tools C++ 工具链
- Microsoft WebView2 Runtime

项目依赖安装：

```powershell
cd jingling-desktop-pet
npm install
```

## 开发运行

```powershell
cd jingling-desktop-pet
$env:PATH="$env:USERPROFILE\.cargo\bin;$env:PATH"
npm run tauri:dev
```

只预览前端界面：

```powershell
npm run dev
```

浏览器预览和桌面端使用同一套 React 代码，但浏览器预览不会拥有置顶、托盘、系统凭据、全局快捷键等桌面能力。

## 构建

```powershell
cd jingling-desktop-pet
$env:PATH="$env:USERPROFILE\.cargo\bin;$env:PATH"
npm run build
npm run tauri:build
```

构建后的 exe 默认位于项目目录内：

```text
src-tauri\target\release\jingling_desktop_pet.exe
```

## 数据位置

酒馆数据保存在系统应用数据目录，例如：

```text
%APPDATA%\com.ly.jingling.pet\tavern_data
```

常见子目录：

```text
characters/
personas/
chats/
worldbooks/
presets/
settings.json
```

API Key 保存在 Windows Credential Manager，不保存在 Git 仓库里。

## Piper 语音

Piper 中文语音文件位于：

```text
src-tauri\resources\piper
```

当前只保留中文 medium 模型和必要运行依赖：

```text
src-tauri\resources\piper\voices\zh_CN-huayan-medium.onnx
src-tauri\resources\piper\voices\zh_CN-huayan-medium.onnx.json
```

设置里选择 `Piper 中文 medium` 后，可以用 `检测` 和 `试听` 验证是否可用。

## 常用操作

- 左键点击桌宠：显示或隐藏快捷聊天。
- 右键点击桌宠：显示或隐藏酒馆管理器。
- 鼠标滚轮：缩放桌宠。
- `Ctrl+Alt+Space`：隐藏或显示桌宠。
- 酒馆扩展页：保存 Provider API Key。
- 聊天设置区：切换角色、会话、Persona、预设和 Provider。

## Git 说明

本仓库只提交源码和必要资源，不提交依赖和构建产物。

已忽略的常见目录包括：

```text
node_modules
dist
src-tauri/target
src-tauri/target-qa
output
*.log
```

如果重新拉取项目，需要运行：

```powershell
npm install
npm run tauri:build
```

## 验收命令

```powershell
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

## 当前状态

这是“鲸灵第一次提交-50%”附近的开发版本。基础桌宠、快捷聊天、酒馆管理器、DeepSeek/Provider 接入、本地数据、Piper 中文语音已经具备雏形；后续还可以继续完善 Live2D 正式模型、长期记忆、TTS 体验、导入导出细节、安装包和商业化设置。
