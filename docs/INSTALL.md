# 安装指南：从空目录安装、配置到启动

本指南带你从零开始，把 Notara 插件组装进一个独立的 DSH 运行环境，并配好本地学习资料目录。当前源码版本为 **0.1.2**，适配锁定的 **DSH 0.2.1-rc.4**（**npm 上的 0.1.2 尚未发布**，请按本文从源码打包安装）。

以下命令默认在 macOS 终端或 Linux shell 中执行。开始前请准备：
- **Node.js 24+（含 npm）**：可先运行 `node --version` 确认主版本号 ≥ 24。
- **Git** 与正常网络连接（用于拉取源码及安装锁定的 DSH 依赖）。
- Windows 系统的安装方式请参考文末说明。

---

## 1. 下载源码并打包插件

在终端中克隆仓库、安装构建依赖，并生成本地发行目录 `release/0.1.2`：

```sh
git clone https://github.com/TongZi2003/Notara-DSH.git
cd Notara-DSH
npm ci
npm run pack:plugins -- release/0.1.2
```

如果在阅读 README 时已经执行过这四条命令，直接跳到第 2 步即可。后续命令继续在 `Notara-DSH` 源码根目录下执行。

打包完成后，`release/0.1.2/` 目录下会生成八个 `.tgz` 插件包、锁定的宿主依赖清单（`host-package-lock.json`）以及安装脚本 `install-release.mjs`。

---

## 2. 安装到独立运行目录

我们先在终端里定义两个路径变量：

```sh
notara_home="$HOME/.notara-dsh"
notara_vault="$HOME/Notara-Learning"
```

- **`notara_home`**：存放 DSH 运行环境、模型账号配置与课堂会话记录。
- **`notara_vault`**：存放你的本地学习资料（Markdown 卡片、画像、路线计划、日记、PDF 与白板文件）。

> **提示**：首次安装请确保这两个路径是全新的空目录。如果同名目录已存在，请换一个新目录名，安装脚本也会自动拦截非空的目标 profile 目录以防覆盖旧数据。

运行安装脚本，将 DSH 0.2.1-rc.4 与八个 Notara 插件安装到独立环境中：

```sh
node release/0.1.2/install-release.mjs "$notara_home/profiles/web"
```

该脚本会严格按照随包锁文件完成安装，并自动应用并校验前端宿主适配补丁。

---

## 3. 配置插件和资料目录

将下面整段命令复制到终端执行。它会在刚刚安装好的环境中启用 `@oh-my-student/dsh-bundle`，创建你的学习资料目录，并写入本地索引配置 `cordis.patch.yml`：

```sh
NOTARA_HOME="$notara_home" NOTARA_VAULT="$notara_vault" node --input-type=module <<'NODE'
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const home = resolve(process.env.NOTARA_HOME);
const vault = resolve(process.env.NOTARA_VAULT);
const profile = join(home, 'profiles', 'web');
const manifest = join(profile, 'package.json');
const pkg = JSON.parse(await readFile(manifest, 'utf8'));
pkg.dsh = { profile: { bundles: [
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  '@oh-my-student/dsh-bundle'
] } };
await mkdir(vault, { recursive: true });
await writeFile(manifest, JSON.stringify(pkg, null, 2) + '\n');
await writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify([
  { id: 'notara-vault-sqlite', config: {
    root: vault,
    cachePath: join(home, 'vault-index.sqlite')
  } }
], null, 2) + '\n');
console.log('配置完成。资料目录：' + vault);
NODE
```

如果你想先用现成的材料跑通第一堂课，可以把仓库自带的原创导数起始学习集复制到资料目录中（如果想直接用自己的材料开始，跳过这条命令即可）：

```sh
cp -R templates/starter-sets/01-derivative-methods/. "$notara_vault/"
```

这套起始材料包含导数概念、典型母题、常见反例、折叠参考理解以及配套白板，「学生理解」区域保持留白，方便你直接体验完整的课堂与记录流程。

---

## 4. 启动服务并打开网页

运行以下命令启动本地 Web 服务：

```sh
DSH_HOME="$notara_home" node "$notara_home/profiles/web/node_modules/@deepseek-ai/dsh/lib/bin.js" web --host 127.0.0.1 --port 0
```

- `--port 0` 会自动分配一个本机空闲端口。
- 启动后浏览器通常会直接打开页面；如果没有自动弹出，请复制终端输出的**完整网页地址**（包含末尾的访问授权参数）到浏览器打开。
- 首次进入若看到确认页面，点击 **「继续 / Continue」** 即可。
- 使用期间请保持该终端窗口运行；结束学习时在终端按 `Ctrl+C` 停止服务。

---

## 5. 配置模型与选择工作区

进入网页界面后，只需完成最后三步即可开始学习：

1. **配置大模型服务**：
   在首次弹出的「Get started」窗口（或左下角账号菜单 → **「设置」**）中，点击 **「Add API Key」** 填入你的模型密钥，或点击 **「Sign in」** 登录受支持的模型服务，随后在对话框下方选择一个可用模型。
2. **切换到「首页学习助手」**：
   新建一段会话，点击输入框下方的模式名称（初始通常显示为 **「标准模式 / Standard mode」**），在列表中选择 **「首页学习助手」**。这段会话将作为你长期的学习总控入口，平时回来继续聊即可。
3. **绑定本地工作区目录**：
   点击界面左上角的工作区名称，选择 **「添加工作区…」**，选中第 2 步创建的资料目录（如 `Notara-Learning`；若弹出网页端路径框，可点「编辑路径」填入绝对路径）。确认左上角已显示该目录名称，且输入框上方不再提示「选择工作区 / Choose workspace」。

一切就绪！接下来请打开 **[使用指南（docs/USAGE.md）](USAGE.md)**，用刚刚放进资料库的导数材料走完第一次学习闭环。

---

## 日常重开与数据备份

### 日常重新启动

每次重新打开终端时，指定同一个 `DSH_HOME` 路径启动，之前的课堂会话与本地资料就会无缝接续：

```sh
notara_home="$HOME/.notara-dsh"
DSH_HOME="$notara_home" node "$notara_home/profiles/web/node_modules/@deepseek-ai/dsh/lib/bin.js" web --host 127.0.0.1 --port 0
```

每次启动都会生成新的本地授权链接，请从终端输出或自动弹出的标签页进入，不必把旧链接存为固定书签。

### 备份与迁移

你的数据分布在两个文件夹中：
- **`notara_vault`（学习资料库）**：纯文本 Markdown 卡片、画像、计划、日记、PDF 与白板文件。
- **`notara_home`（运行环境与会话）**：历史课堂聊天记录与本地配置（包含模型 API 密钥，备份时请注意妥善保管，切勿上传到公开仓库）。

在停止服务后，将这两个目录一并备份即可完整保留所有记录。版本升级方式请参见 **[发行与升级说明（docs/RELEASE.md）](RELEASE.md)**。

---

## 常见问题排查

| 遇到的情况 | 排查与解决方式 |
| --- | --- |
| 安装脚本提示目标目录非空 | 换一个新的 `notara_home` 路径重新执行第 2 步，保护原有目录数据。 |
| 打开网页提示未授权 | 复制当前运行终端里打印的**完整网页地址**（带授权参数）重新打开。 |
| 左侧「资料」面板看不到文件 | 检查左上角选中的工作区是否与第 3 步配置的 `notara_vault` 路径一致。 |
| 复制或上传了文件，但图谱里还没有卡片 | 放入文件只是保存了原始资料；在对话中把文件交给老师或「资料整理助手」，请它整理成知识卡片即可。 |
| 老师会话右上角没有「本课清单」 | 先请老师生成一份备课本（`type: lesson`），再从右上角 **「活动」→「关联备课本」** 绑定该文件。 |

---

## 可选功能与跨平台说明

### 启用本地语音输入

如需使用语音转文字输入，可在停止服务后编辑 `$notara_home/profiles/web/package.json`，在 `dsh.profile.bundles` 数组中追加一项：

```json
"@deepseek-ai/dsh-experimental-voice-input-bundle"
```

保存后重新启动服务。首次点击麦克风输入时，上游组件会自动下载本地 SenseVoice 语音识别运行时，并请求浏览器麦克风权限。

### Windows 与 Linux 环境说明

安装脚本与插件均采用跨平台 Node.js 接口编写。在 Windows PowerShell 中，完成第 1 步打包后，可通过以下命令安装到空目录：

```powershell
node .\release\0.1.2\install-release.mjs "C:\Notara\profiles\web"
```

写入 `cordis.patch.yml` 时建议使用正斜杠路径（如 `C:/Notara-Learning`），启动前在 PowerShell 中设置 `$env:DSH_HOME = "C:\Notara"`，再调用 `node C:\Notara\profiles\web\node_modules\@deepseek-ai\dsh\lib\bin.js web --host 127.0.0.1 --port 0`。目前 macOS 已完成完整安装与浏览器端验收，Windows 与 Linux 的完整课堂流程欢迎在使用中反馈。
