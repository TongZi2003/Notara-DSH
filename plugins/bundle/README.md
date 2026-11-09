# Notara 插件组

原生 DSH bundle：`@oh-my-student/dsh-bundle`。一个组、七个功能包，使用 DSH 已有的整组与逐项启停，不自建插件管理器。

| 包 | 边界 |
|---|---|
| presets | 教学角色、提示词、Skill、课堂与伙伴委派的工具边界 |
| vault-sqlite | 源文件读取／CAS 写入、复习证据、可重建索引、唯一资料 RPC |
| home-recommend | 首页推荐与输入预填，不创建第二套会话 |
| vault-views | 资料工作台、Markdown/PDF 阅读编辑、引用、主题、活动入口、原生标签接线 |
| graph-and-blocks | 图谱选择、互动卡、公式与 Canvas 表达；暂不因组件数量继续拆包 |
| pomodoro | 课堂计时操作与界面，后台调度及持久投递复用 DSH schedule |
| calendar | 月历、日记与日期任务投影；读取 Vault 索引，写入仍用 Vault CAS |

calendar 显示日记，待办仅包含学习计划的日期条目与卡片的到期问题；支持未处理事项保留和原文件改期，不另存日历事实库。主题、活动栏、头像保持界面内部模块，不各自发布插件。

## 安装与配置

安装七个功能包及本组 tgz 后，在独立 profile 的 `package.json` 中将本组追加到已有 bundles，保留原生 base/app；下面是 web profile 示例（原生插件管理器也能选择整组）：

```json
{"dsh":{"profile":{"bundles":["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app","@oh-my-student/dsh-bundle"]}}}
```

profile 的 `cordis.patch.yml` 配置唯一 Vault 入口。必须替换成自己的绝对路径，不把开发机路径放进发布包：

```yaml
- id: notara-vault-sqlite
  config:
    root: /absolute/path/to/vault
    cachePath: /absolute/path/to/cache/vault-index.sqlite
```

`config` 整体替换，因此 root/cachePath 一起填写。组不强行改全局默认模型或默认预设；从原生角色选择器选“首页学习助手”或“专题课堂老师”。这样停用组不会留下指向未注册 Notara 预设的全局默认值。

## 所有权与启停

DSH 拥有 Session、消息、输入草稿、Workspace、模型认证、权限、子会话、标签、schedule；Notara 提供教学语义与资料体验。Markdown/PDF/Canvas 为事实源，SQLite 和图谱为投影。

原生组开关影响七个 Loader entry；单项开关仍存在。资料 UI 依赖 Vault 服务；日历页面依赖 vault-views 的原生页签导航与编辑器；只停界面不会卸载共享 RPC。关闭 presets 前，把仍需使用的会话切到可用预设。番茄钟的操作入口依赖 vault-views 的活动面板；停用 vault-views 后入口隐藏。番茄钟已创建的任务由原生 schedule 持久保存，关闭插件 UI 不撤销它们；先点击“停止计时”取消未送达提醒。退出 DSH 后不运行，重启后原生调度会处理到期任务；不保证系统休眠期间准点投递。

## SDK 适配边界

当前 rc.4 没有完整 Chat 展示投影扩展口，`notara-host-adapter` 随本 bundle 发布，是独立的版本／哈希锁定适配命令，不属于可启停功能包。它同时适配 Chat 展示、相邻 `dsh-client-ui-primitives` 的已完成消息数学语法，以及 `dsh-web-frontend` 实际加载的预编译入口；关组不会撤回补丁。仅安装 tgz 到未打补丁的官方 DSH，不等同于当前完整的学生聊天投影和公式处理。安装后显式运行 `node node_modules/@oh-my-student/dsh-bundle/host-adapter.mjs --host /absolute/path/to/dsh-client-ui-chat`。`--check` 分别报告 chat/math/web 状态，math 和 web 的 `current` 应均为 true；`--restore` 恢复原入口。所有目标先校验版本和原文件哈希；网页补丁生成带内容哈希的新资源并切换 HTML 地址，以更新浏览器缓存，原资源保留。恢复时保留旧补丁资源，避免已取得旧 HTML 的客户端加载失败。写入采用临时文件与原子替换。GitHub 候选包中的 install-release.mjs 会在新安装目录执行该步骤。

模型订阅代理属于可选外部 provider，桌面宿主属于发行层，都不并入教学插件依赖。

技能显示也由该适配命令维护：原生技能菜单、所选技能和消息引用使用 `prompts/manifest.json` 的中文 `title` 与短用途 `summary`；模型加载条件仍使用原 `description`。`skills` 检查项覆盖相邻 `dsh-client-ui-skill` 与 `dsh-client-ui-input-trigger`。名称、角色范围、加载正文、复制文本和发送值保持原技能 ID，第三方技能沿用原生显示。选择菜单中的 Notara 技能只插入原生引用，不自动发送；白板仍从原白板命令启用。
