# 鲸灵 Live2D 制作流程

1. 以 `C:\Game\14d7ceae9aa029322f68b1b4c39ec0bd.png` 和 `C:\Game\189f26e0062e2bd5965ad6c03a76ed28.png` 为形象参考。
2. 在绘图软件中拆 PSD 图层：头发、脸、眼睛、嘴、身体、手、裙摆、鲸尾、发饰分层。
3. 补齐被遮挡区域，避免转头、呼吸时露白。
4. 导入 Live2D Cubism Editor，建立 ArtMesh、Deformer、参数和物理。
5. 至少导出这些动作组：idle、tap、drag、thinking、happy、error。
6. 导出 Web 用模型，主文件命名为 `jingling.model3.json`。
7. 将贴图压到 1024，复杂模型最多 2048。
8. 将 `jingling.model3.json`、textures、motions、expressions、physics 文件放到 `public/models/jingling`。
9. 从官方 Cubism Web SDK 放入 `live2dcubismcore.min.js`。
10. 运行 `npm run tauri:dev` 验证透明窗口、动作、点击、拖拽和内存。

当前项目已经接好加载器。模型不存在时会显示占位图，模型放好后会自动切换为 Live2D。
