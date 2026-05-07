# 鲸灵 Live2D 模型目录

把 Cubism 导出的鲸灵模型放在这个目录。应用启动时会优先加载：

```text
/models/jingling/jingling.model3.json
```

推荐结构：

```text
jingling.model3.json
live2dcubismcore.min.js
textures/
motions/
expressions/
physics3.json
pose3.json
```

如果这里没有 `jingling.model3.json`，桌宠窗口会自动使用 `public/assets/jingling-placeholder.png` 作为占位形象。

模型放好后，把 `model-state.json` 改成：

```json
{
  "enabled": true
}
```
