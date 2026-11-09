# Notara DSH 0.1.2 候选发行

npm 当前已发布版本为 0.1.1；本轮 0.1.2 尚未发布到 npm。GitHub 已公开当前源码，本仓库从干净源码开始，不包含私有开发历史。

首次使用请从 [安装与启动](https://github.com/TongZi2003/Notara-DSH/blob/main/docs/INSTALL.md) 开始，再按 [第一次学习与日常用法](https://github.com/TongZi2003/Notara-DSH/blob/main/docs/USAGE.md) 跑通一次学习。本文主要面向发行维护与已有环境升级。

七个功能包与一个 DSH 原生 bundle。第一方代码、提示词与原创素材采用 AGPL-3.0-only；第三方代码和字体按随包原许可分发。已移除三款 Anthropic 字体，改用系统字体。

## 本地生成的发行目录 / GitHub Release 安装包

此发行是插件包，不是桌面安装器。需要 Node 24+、npm 和联网下载 DSH 依赖。当前可先从源码运行 `npm run pack:plugins -- release/0.1.2` 生成发行目录；以下同样适用于以后上传的 Release 安装包，不表示 GitHub 已提供可下载资产。

解压后先用 `shasum -a 256 -c SHA256SUMS` 校验，再运行：

```sh
node install-release.mjs /absolute/path/to/new-notara-home/profiles/web
```

安装器仅接受空目录，使用随包锁文件执行 npm ci，安装八个本地 tgz 与 DSH 0.2.1-rc.4，并显式应用宿主适配；不读取已有账号、会话或 Vault。完整依赖树由 host-package-lock.json 固定。

将 `new-notara-home` 作为独立 DSH_HOME。编辑它的 `profiles/web/package.json`，保留已有 dependencies/overrides，增加：

```json
"dsh": {"profile": {"bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@oh-my-student/dsh-bundle"]}}
```

需要语音输入时，在同一个 `bundles` 数组中追加 `@deepseek-ai/dsh-experimental-voice-input-bundle`。该可选组件已包含在锁定的 DSH 依赖中；本地 SenseVoice 运行时会在首次使用时由上游下载，还需授权浏览器麦克风。

在 `profiles/web/cordis.patch.yml` 写入（必须替换路径）：

```yaml
- id: notara-vault-sqlite
  config:
    root: /absolute/path/to/your-vault
    cachePath: /absolute/path/to/new-notara-home/vault-index.sqlite
```

启动：

```sh
notara_home=/absolute/path/to/new-notara-home
DSH_HOME="$notara_home" "$notara_home/profiles/web/node_modules/.bin/dsh" web
```

资料根目录由使用者自行指定；配置不会上传资料。模型账号通过 DSH 正常登录或配置。OAuth provider 不包含在本插件组中。

## npm 安装

待八包正式发布后，可在独立 DSH profile 内安装 `@oh-my-student/dsh-bundle@0.1.2`。包不会通过 postinstall 偷改宿主；需要显式运行：

```sh
npm install --save-exact @oh-my-student/dsh-bundle@0.1.2
node node_modules/@oh-my-student/dsh-bundle/host-adapter.mjs --host /absolute/path/to/dsh-client-ui-chat
node node_modules/@oh-my-student/dsh-bundle/host-adapter.mjs --host /absolute/path/to/dsh-client-ui-chat --check
```

宿主必须为已验证的 0.2.1-rc.4 原文件。升级或未知修改会拒绝应用；`--restore` 在完整性校验后恢复原文件。整组停用不撤销宿主适配。没有适配时，内部回合可能在聊天正文、复制和历史导航中出现；不要把未适配安装当作完整学生界面。

## 从 0.1.0 / 0.1.1 升级

停止目标 DSH profile，在该 profile 目录同时更新八包。旧版发行将八包都固定为直接依赖，不能只更新 bundle。以下命令须在 0.1.2 已发布到 npm 后使用：

```sh
npm install --save-exact @oh-my-student/dsh-bundle@0.1.2 @oh-my-student/plugin-presets@0.1.2 @oh-my-student/plugin-vault-sqlite@0.1.2 @oh-my-student/plugin-home-recommend@0.1.2 @oh-my-student/plugin-vault-views@0.1.2 @oh-my-student/plugin-graph-and-blocks@0.1.2 @oh-my-student/plugin-pomodoro@0.1.2 @oh-my-student/plugin-calendar@0.1.2
node node_modules/@oh-my-student/dsh-bundle/host-adapter.mjs --host ./node_modules/@deepseek-ai/dsh-client-ui-chat
node node_modules/@oh-my-student/dsh-bundle/host-adapter.mjs --host ./node_modules/@deepseek-ai/dsh-client-ui-chat --check
```

检查结果应包含 `chat.patched: true`、`math.patched: true`、`math.current: true`、`web.patched: true`、`web.current: true`。`web` 检查浏览器实际加载的预编译入口；仅修改源码库不足以更新网页公式渲染。保留原 profile 的 bundles、Vault 路径与账号配置；不要将新安装器指向已有目录。未发布时使用压缩包在空目录安装，原有环境保持不变。

## Windows 边界

插件及安装脚本按跨平台设计，Windows 需要 Node 24+（含 npm）和上述固定 DSH 版本。安装脚本通过 Node 调用 npm-cli.js，避免直接执行 .cmd。可在 PowerShell 中执行 `node .\install-release.mjs "C:\Notara\profiles\web"`，目标目录必须为空。Windows 路径写入 JSON/YAML 时使用正确的引号或正斜杠。

macOS 有本地安装与浏览器验收记录，不代表 Windows 已验收；Windows 的安装、中文路径、PDF 与关闭重开尚未经过实机验证。每次准备上传的发行包仍需按冻结候选重新检查。

## 发布操作者

先完成单测、原生集成和干净安装测试，再冻结源码提交。运行 `npm run pack:plugins -- release/0.1.2` 会重新构建全部包、补齐许可文本、校验导出目标并生成清单和 SHA256SUMS。

GitHub：以冻结提交创建 `notara-dsh-v0.1.2` 标签及预发行 Release，上传候选目录压缩包和 SHA256SUMS。不要上传整个开发目录、outputs、work、真实学习资料、OAuth 配置或原字体文件。

npm：先登录并确认拥有 `@oh-my-student` 范围发布权限。按 vault-sqlite → presets → home-recommend → vault-views → graph-and-blocks → pomodoro → calendar → bundle 的顺序发布清单中的 tgz：`npm publish <package.tgz> --access public --tag next`。验证八包均可安装后再决定切换 latest。不得覆盖已发布版本；已占用版本需统一升版及更新内部依赖后重建。
