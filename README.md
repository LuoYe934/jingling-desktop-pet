# 鲸灵 DeepSeek Live2D 桌宠

独立 Windows 桌宠应用，技术栈为 Tauri v2、React、TypeScript、Rust、PixiJS 和 Live2D Web Runtime。当前版本已经升级为“桌宠 + 快捷聊天 + 本地酒馆管理器”结构。

## 已实现

- `pet` 桌宠窗口：透明、无边框、默认置顶、跳过任务栏、可拖拽。
- `chat` 快捷聊天窗口：角色、聊天、预设选择；DeepSeek 流式输出；停止生成；清空当前聊天。
- `tavern` 酒馆管理窗口：角色库、Persona、聊天库、世界书、预设、Prompt 预览、Provider Key 管理。
- 本地酒馆数据目录：`tavern_data/characters`、`personas`、`chats`、`worldbooks`、`presets`。
- SillyTavern 角色卡导入：支持 JSON，也支持 PNG 中常见的 `chara` 文本元数据。
- SillyTavern v2 风格角色卡 JSON 导出。
- 世界书关键词触发、优先级排序和 Prompt 预览。
- DeepSeek Provider：继续使用 `https://api.deepseek.com/chat/completions`，默认模型 `deepseek-v4-flash`。
- API Key 使用 Windows Credential Manager 保存，开发期也支持 `DEEPSEEK_API_KEY` 环境变量。
- 托盘菜单：打开快捷聊天、打开酒馆管理器、隐藏聊天窗口、退出。
- 快捷键：`Ctrl+Alt+Space` 隐藏/显示桌宠。

## 运行

```powershell
cd C:\Game\jingling-desktop-pet
npm install
$env:PATH="C:\Users\LY\.cargo\bin;$env:PATH"
npm run tauri:dev
```

如果只运行已构建版本：

```powershell
C:\Game\jingling-desktop-pet\src-tauri\target\release\jingling_desktop_pet.exe
```

## 构建

```powershell
cd C:\Game\jingling-desktop-pet
$env:PATH="C:\Users\LY\.cargo\bin;$env:PATH"
npm run tauri:build
```

构建产物：

```text
C:\Game\jingling-desktop-pet\src-tauri\target\release\jingling_desktop_pet.exe
```

## 使用

- 左键点击桌宠：打开或隐藏快捷聊天。
- 按住桌宠拖动：移动桌宠。
- 右键点击桌宠：打开酒馆管理器。
- 快捷聊天顶部：切换角色、聊天和预设。
- 酒馆管理器：
  - 角色页编辑角色卡，导入/导出 SillyTavern 风格角色卡。
  - Persona 页设置用户身份。
  - 聊天库页搜索、查看、书签、导入/导出聊天。
  - 世界书页编辑关键词触发条目，并可测试触发结果。
  - 预设页设置 system prompt、作者注释、上下文预算、最大输出和温度。
  - Prompt 页预览最终发给模型的消息结构。
  - 扩展页保存 Provider Key，并预留正则、快捷回复、TTS、翻译、图片描述和向量记忆开关。

## Live2D 模型替换

将 Cubism 导出的文件放到：

```text
C:\Game\jingling-desktop-pet\public\models\jingling
```

需要包含：

```text
jingling.model3.json
live2dcubismcore.min.js
textures\
motions\
expressions\
```

然后把：

```text
C:\Game\jingling-desktop-pet\public\models\jingling\model-state.json
```

里的 `enabled` 改成 `true`。

## 验收命令

```powershell
npm run build
& C:\Users\LY\.cargo\bin\cargo.exe check
$env:PATH="C:\Users\LY\.cargo\bin;$env:PATH"; npm run tauri:build
```
