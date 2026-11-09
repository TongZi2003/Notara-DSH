# Notara DSH 插件组

本工作区独立安装、构建和测试，不依赖独立桌面应用的运行代码。由 `@oh-my-student/dsh-bundle` 统一装配七个功能包，保留原生整组／逐项管理。职责、依赖与安装见 [bundle/README.md](bundle/README.md)，移植来源见 [来源说明](../docs/PROVENANCE.md)。独立的 rc.4 Chat 展示补丁属于 SDK 适配层，不是普通插件；关闭组不会撤销补丁。

| npm 包 | 职责 |
| --- | --- |
| `@oh-my-student/plugin-presets` | 12 个原生预设（含盲测变体）、五篇文件系统 Skill、核心提示词及工具边界 |
| `@oh-my-student/plugin-vault-sqlite` | Markdown/PDF/Canvas 的可重建 SQLite 索引、八个 RPC，以及唯一客户端 Remote 注册 |
| `@oh-my-student/plugin-home-recommend` | 到期复习、续读导读、四项学习诉求；仅预填原生输入 |
| `@oh-my-student/plugin-vault-views` | 表格、卡片、导读、复习、文档/PDF 阅读与选区引用 |
| `@oh-my-student/plugin-graph-and-blocks` | 虚实线知识图谱、七类互动块及 Canvas 阅读 |
| `@oh-my-student/plugin-pomodoro` | 45分钟课堂、每10分钟提醒；Host 窄接口复用原生 schedule |
| `@oh-my-student/plugin-calendar` | 月历、日期日记、路线排期、当天待办；复用 Vault 文件与索引 |

## 开发与检查

要求 Node 24+，锁定 DSH `0.2.1-rc.4`、Cordis `4.0.5` 和 React `18.3.1`。安装和构建会校验并应用 `scripts/patch-dsh-chat.mjs`，仅调整 Chat 的内部通信展示；升级 SDK 时必须重新核对补丁锚点与哈希。在 `notara-core` 内运行：

```sh
npm ci
npm run build
npm test
npm run test:integration
npm run test:native
npm run pack:plugins
```

工作区附带开发用 Node 24.13.0，安装后也可用 `node_modules/.bin/node` 执行脚本。原生集成使用独占 DSH_HOME、临时学习集副本、随机端口和后台 Chromium；结束时仅停止自身进程。不会访问真实模型服务；对话渲染测试使用明确的确定性 LlmAdapter 夹具。构建产物位于各包 `dist/`，打包默认输出 `work/packages/`。

`npm test` 包含插件单测与部分隔离组件浏览器检查；`test:native` 是五包在真实 DSH 中的跨插件检查。两者不能替代真实模型、跨平台或真人教学验收。各包 `DEVELOPMENT.md` 记录各自的实际证据与限制。

## 宿主装配

五个包可以分别管理；三个界面包依赖 Vault 服务包，Canvas 互动渲染由图谱与题卡包提供。安装本地打包产物可使用原生 CLI `dsh plugin --profile <profile> add <tgz...>`。选择独立 profile；不要覆盖已有 profile 的配置。将下列条目合入该 profile 的 `cordis.patch.yml`（把示例目录换成用户明确选择的绝对路径）：

```yaml
- id: agent-preset-registry
  config:
    default: notara-coordinator
- insert:
    - id: notara-presets
      name: '@oh-my-student/plugin-presets'
    - id: notara-vault-sqlite
      name: '@oh-my-student/plugin-vault-sqlite'
      config:
        root: /absolute/path/to/learning-vault
        cachePath: /absolute/path/to/cache/vault-index.sqlite
    - id: notara-home-recommend
      name: '@oh-my-student/plugin-home-recommend'
    - id: notara-vault-views
      name: '@oh-my-student/plugin-vault-views'
    - id: notara-graph-and-blocks
      name: '@oh-my-student/plugin-graph-and-blocks'
```

`root` 是省略 workspaceId 时的初始 Vault；显式 workspaceId 通过原生工作区登记解析真实目录，并使用独立 store/cache。会话文件工具与资料引用应指向同一工作区。SQLite 只是索引缓存，删除缓存后从学习文件重建；不要把缓存当学习事实备份。

发布版 SDK 已移除计划中的三个旧槽名。当前使用原生 `conversation.input.dock` 的空白会话区域、`sidebar.panellist` 和独立 `main` 面板；保留原生对话入口、输入、模型和会话生命周期。资料面板声明 `notara.vault.canvas` 子槽供题卡插件渲染。具体合同见 `CONTRACT.md`。

复习次数、图谱实线和节点光晕描述记录及联系，不证明掌握。盲测运行时不继承父会话、工具或环境上下文，提交者仍须提供不含解析的原始材料。首页创建普通专题；老师与伙伴使用原生可继续子会话，工作员按限定任务返回结果，不新增课堂生命周期或教学进度账本。
