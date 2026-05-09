# 鲸灵桌宠

[English](./README.md) | [简体中文](./README.zh-CN.md)

鲸灵桌宠是一个面向 Windows 的本地桌面宠物与 AI 酒馆聊天管理器。项目基于 Tauri v2、React、TypeScript 和 Rust 构建，目标是把轻量桌宠、快捷聊天、角色卡、Persona、世界书、预设、多 Provider 聊天、好感度关系和长期记忆整理整合到一个本地桌面应用里。

当前项目仍处于开发阶段。本轮进度约为 `70%+`：桌宠、聊天、酒馆管理器、头像、TTS、好感度关系、长期摘要压缩、记忆卡片、内置内容库和聊天语音输入等核心功能已经具备雏形，但安装包、商业化配置、Live2D 正式模型和更多扩展能力仍可继续完善。

## 主要功能

- 桌宠窗口：透明、无边框、置顶、跳过任务栏，支持鼠标拖动和滚轮缩放。
- 快捷聊天：点击桌宠打开聊天小窗，支持角色、会话、Persona、预设和 Provider 切换。
- 聊天输入：支持文字输入、`Ctrl + 鼠标滚轮` 调整聊天消息字号，以及基于 WebView/浏览器语音识别的语音转文字输入；不支持内置识别时可使用系统输入法或第三方输入法语音输入。
- 酒馆管理器：管理角色库、Persona、聊天库、世界书、预设、内置内容库、关系面板、长期记忆、Prompt 预览和扩展设置。
- 内置内容库：提供多风格角色、公共世界书和预设，支持单项导入、一键导入推荐包和已安装跳过；当前内置 `12` 个角色、`8` 本世界书、`10` 个预设。
- 角色与 Persona 头像：支持上传头像，聊天气泡会同步显示角色和用户头像；未上传时使用名字默认头像。
- 好感度关系系统：为每个角色维护好感度、心情、关系阶段、关系事件、称呼设置、待机台词和节日反应。
- 长期记忆摘要：根据预设上下文条数动态压缩旧消息，AI 总结合并进 `chat.summary`，旧消息标记为已压缩但仍可回看，收藏消息永远保留原文。
- 记忆卡片：支持从聊天中提取或手动维护长期记忆，区分偏好、禁忌、用户事实、承诺和事项，并可确认、停用和删除。
- 聊天库：支持搜索、收藏消息、导入导出聊天、手动整理长期记忆和编辑长期摘要。
- Prompt 预览：可以查看最终发送给模型的系统提示、长期摘要、最近原文、收藏摘录和世界书触发情况。
- 多 Provider：默认 DeepSeek，同时保留 OpenAI-compatible、OpenRouter、Ollama 等兼容接口流程。
- 本地数据：角色、Persona、聊天、世界书、预设、关系和设置保存到系统应用数据目录。
- API Key：使用 Windows Credential Manager 保存，不明文写入项目配置。
- TTS 语音：支持系统语音和 Piper 中文 medium 本地语音。
- 桌面体验：托盘菜单、开机自启、窗口置顶、全局快捷键 `Ctrl+Alt+Space` 隐藏/显示桌宠。

## 最近桌面端更新

相比旧版桌面端 exe，最新 release 构建已经同步了预览端里的酒馆和记忆功能：

- 最新前端预览已经重新构建进桌面端 exe。
- 新增并扩展记忆卡片系统，支持全局、角色和聊天作用范围。
- 聊天消息旁边新增“记住这句”和“不要记这句”操作。
- Prompt 预览新增长期摘要状态、最近原文数量、收藏摘录数量、已压缩消息数量、记忆卡片数量、稳定前缀 tokens、动态上下文 tokens、Prompt 布局版本、触发的世界书和实际注入的记忆卡片。
- Prompt 组装改为更利于缓存的稳定前缀和独立动态上下文。
- 角色卡导入细节增强，PNG 角色卡缺少头像元数据时可使用 PNG 本身作为头像兜底。
- 新增 QA 构建脚本，可先构建 `target-qa` 测试版，再提升到 release exe。
- 聊天细节增强，包括已压缩消息标识、记忆操作按钮、语音输入入口和更完整的 token/上下文预算显示。

## 技术栈

- 桌面壳：Tauri v2
- 前端：React、TypeScript、Vite、Zustand
- 后端：Rust、reqwest、keyring
- 桌宠渲染：PixiJS，Live2D Web Runtime 预留
- 本地 TTS：Piper + `zh_CN-huayan-medium`

## 目录结构

```text
jingling-desktop-pet
├─ src/                         React 前端
│  ├─ components/               桌宠、聊天窗口、设置窗口、酒馆窗口组件
│  ├─ components/tavern/        酒馆管理器子页面
│  ├─ lib/                      Tauri 调用、时间、头像、token 估算等工具
│  ├─ stores/                   前端状态
│  └─ types/                    前后端共享类型
├─ src-tauri/                   Rust/Tauri 后端
│  ├─ src/                      聊天、酒馆数据、设置、托盘、Piper、关系逻辑
│  ├─ resources/piper/          Piper 运行文件和中文语音模型
│  └─ tauri.conf.json           Tauri 窗口与打包配置
├─ public/                      静态资源和 Live2D 模型占位目录
├─ docs/                        补充文档
└─ scripts/                     辅助脚本，包括 QA 构建和提升到 release
```

## 环境准备

需要安装：

- Node.js 和 npm
- Rustup / Cargo
- Visual Studio Build Tools C++ 工具链
- Microsoft WebView2 Runtime

安装项目依赖：

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

浏览器预览和桌面端使用同一套 React 代码，但浏览器预览不具备置顶、托盘、系统凭据、全局快捷键等桌面能力。

## 构建

```powershell
cd jingling-desktop-pet
$env:PATH="$env:USERPROFILE\.cargo\bin;$env:PATH"
npm run build
npm run tauri:build
```

当前项目提供两个常用桌面构建目标：

```powershell
# 构建 QA exe 到 src-tauri\target-qa
npm run tauri:build:qa

# 将 QA 构建复制到 release 目录
npm run tauri:promote

# 直接构建 release exe
npm run tauri:build:release
```

常用 exe 路径：

```text
src-tauri\target\release\jingling_desktop_pet.exe
src-tauri\target-qa\release\jingling_desktop_pet.exe
```

注意：`npm run build` 只会构建前端 `dist`，不会自动更新已经编译好的桌面端 exe。修改源码后要重新运行 Tauri 构建命令，桌面端才会包含最新功能。

## 数据位置

酒馆数据保存到系统应用数据目录，例如：

```text
%APPDATA%\com.ly.jingling.pet\tavern_data
```

常见数据包括：

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

API Key 保存在 Windows Credential Manager，不保存到 Git 仓库里。

## 长期记忆压缩

聊天长期记忆以当前预设的上下文条数为核心动态控制：

- 设上下文条数为 `N`。
- 默认保留最近 `N` 条未压缩原文。
- 当未压缩消息超过上限后，自动整理更旧的 `N / 2` 条非收藏消息。
- AI 会把旧摘要和本批旧消息合并成新的结构化 `chat.summary`。
- 被整理过的旧消息会标记为已压缩，不再发送给模型，但仍可在聊天记录里回看。
- 收藏消息不参与自动压缩；如果收藏已压缩消息，会恢复为未压缩原文。

长期摘要默认关注：

- 用户身份/偏好
- 和角色的重要关系
- 已发生的重要事件
- 未完成的话题/承诺
- 用户情绪倾向
- 角色需要记住的称呼、禁忌、习惯

## 长期记忆卡片

长期记忆卡片用于保存比聊天摘要更稳定的事实和偏好：

- 支持全局、角色、聊天三种作用范围。
- 支持偏好、禁忌、用户事实、承诺和事项等类型。
- 可从聊天消息手动“记住这句”或“不要记这句”。
- 可在酒馆记忆面板中查看、搜索、编辑、确认、停用和删除。
- 发送给模型时会按作用范围、状态和重要度筛选，不会把已停用记忆注入上下文。

## Piper 语音

Piper 中文语音文件位于：

```text
src-tauri\resources\piper
```

当前保留中文 medium 模型和必要运行依赖：

```text
src-tauri\resources\piper\voices\zh_CN-huayan-medium.onnx
src-tauri\resources\piper\voices\zh_CN-huayan-medium.onnx.json
```

在设置里选择 `Piper 中文 medium` 后，可以用检测和试听验证是否可用。

## 常用操作

- 左键点击桌宠：显示或隐藏快捷聊天。
- 右键点击桌宠：显示或隐藏酒馆管理器。
- 鼠标滚轮：缩放桌宠，缩放值会和设置抽屉同步。
- 聊天消息区域 `Ctrl + 鼠标滚轮`：调整聊天字号，便于在小窗中查看更多内容。
- `Ctrl+Alt+Space`：隐藏或显示桌宠。
- 酒馆扩展页：保存 Provider API Key。
- 聊天设置区：切换角色、会话、Persona、预设和 Provider。
- 聊天输入区：纸飞机按钮用于发送；AI 回复中纸飞机会变为停止按钮；麦克风按钮用于语音转文字，识别结果只填入输入框，不会自动发送。
- 酒馆聊天库：查看历史、收藏消息、编辑长期摘要、手动整理长期记忆。
- 酒馆关系页：查看和重置角色好感度、心情和关系设置。
- 酒馆内容库：按角色、世界书、预设筛选内置内容，支持搜索、单项导入和一键导入推荐包。

## Git 说明

本仓库只提交源码和必要资源，不提交依赖和构建产物。

常见忽略目录包括：

```text
node_modules
dist
src-tauri/target
src-tauri/target-qa
output
*.log
```

重新拉取项目后运行：

```powershell
npm install
npm run tauri:build
```

## 验收命令

```powershell
npm run build
npm run lint
cargo test --manifest-path src-tauri/Cargo.toml
```

## 当前状态

这是“酒馆好感度更新 - 70%+”附近的开发版本。当前已经完成桌宠基础体验、快捷聊天、酒馆管理器、角色/Persona 头像、DeepSeek/Provider 接入、本地数据、Piper 中文语音、好感度关系、关系事件、长期摘要压缩、记忆卡片、内置内容库扩展、聊天语音输入和 Prompt 预览增强。后续可以继续完善正式 Live2D 模型、安装包、更多插件扩展、移动/点击判定细节、导入导出兼容性和更完整的商业化设置。
