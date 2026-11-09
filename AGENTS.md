# Notara DSH 插件开发

- 本仓库仅维护 DSH 插件，不依赖独立桌面版目录。使用 Node.js 24+ 与锁文件中的 DSH 版本。
- 原生 DSH 会话是课堂历史事实源；Vault 文件是学习资料事实源，SQLite 和界面是投影。
- 提示词修改维护 `prompts/`，通过 `node plugins/presets/scripts/sync-resources.mjs` 同步生成资源。保留关键教学判断与学习事实的实际归属。
- 构建和测试：`npm ci`、`npm run build`、`npm test`。构建会修改本安装内的 DSH 宿主文件，不要共用正在运行的依赖目录。
- 新测试使用临时目录与合成资料，不提交密钥、学生资料、课堂轨迹、教材扫描件、运行数据或截图。
- 第一方内容采用 AGPL-3.0-only；保留第三方版权、字体许可和来源记录，修改依赖时更新随包声明。
