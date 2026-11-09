# 安装与启动

先把 Notara 装进一个独立的 DSH 环境，再指定存放学习资料的文件夹。本指南使用当前源码 **0.1.2** 和锁定的 **DSH 0.2.1-rc.4**；npm 的 0.1.2 尚未发布。

以下命令适用于 macOS 的终端或 Linux shell。需要 **Node.js 24+（含 npm）**、Git，以及下载依赖所需的网络。先用 `node --version` 确认主版本至少为 24。Windows 参考本文末尾的边界说明。

## 1. 下载源码并生成安装包

```sh
git clone https://github.com/TongZi2003/Notara-DSH.git
cd Notara-DSH
npm ci
npm run pack:plugins -- release/0.1.2
```

已经按 README 做过这一步，就不必重复。后续命令仍在 `Notara-DSH` 源码目录执行。

`release/0.1.2/` 中会生成八个插件包、锁定的依赖清单和安装脚本。这是本地构建，不会向 npm 发布任何东西。源码构建会适配本目录内的 DSH 依赖，不要与正在运行的 DSH 共用 `node_modules`。

## 2. 安装到新目录

先约定两个路径：

```sh
notara_home="$HOME/.notara-dsh"
notara_vault="$HOME/Notara-Learning"
```

- `notara_home` 保存 DSH 安装、账号配置和会话。
- `notara_vault` 保存你的学习资料、画像、卡片、日记与白板。

**首次安装请选两个新目录。** 如果这些路径已经有内容，换一个名称；不要拿已有课堂或笔记目录试装。安装器也会拒绝非空的目标 profile。

```sh
node release/0.1.2/install-release.mjs "$notara_home/profiles/web"
```

安装器使用随包锁文件安装 DSH 和八个本地插件包，并检查宿主适配。它只接受上面这个位置参数，不需要 `--target`，也不会生成 `start-notara.sh`。

## 3. 配置插件和资料目录

把下面整段复制到终端执行。它只用于**上一步新装的环境**：保留安装依赖，启用 Notara，并写入资料路径。

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

这里写出的 JSON 也是合法的 YAML，DSH 可以直接读取。不需要自行编辑依赖清单或配置数据库服务。

想先用现成材料试一遍，可以把仓库里的原创导数起始章节复制进去；若准备使用自己的材料，跳过此命令即可。

```sh
cp -R templates/starter-sets/01-derivative-methods/. "$notara_vault/"
```

这套样例有题面、折叠参考、函数图和白板，学生理解留白；不是商业教材拆书包。请复制后再学，不要把源码仓库本身选成学习工作区。

## 4. 启动并打开授权入口

```sh
DSH_HOME="$notara_home" node "$notara_home/profiles/web/node_modules/@deepseek-ai/dsh/lib/bin.js" web --host 127.0.0.1 --port 0
```

`--port 0` 会选一个空闲端口。启动后，浏览器通常自动打开；若没有，复制终端打印的 **完整网页地址**，包括授权参数。只输入 `127.0.0.1:端口` 可能还没有获得访问授权。这个地址相当于本机访问凭证，不要发到公开 issue 或截图里。

首次打开若出现确认页，点击「继续 / Continue」。接下来的「Get started」窗口用于登录模型账号或添加 API Key；也可以先关闭它查看资料，再配置模型。

保持终端运行。结束使用时按 `Ctrl+C`，下次仍用同一个 `DSH_HOME` 启动，会话和文件才会接续。

## 5. 配置模型，选择实际工作区

1. 首次可在「Get started」中点 **「Add API Key」**添加密钥，或点 **「Sign in」**登录 DSH 支持的账号；以后也可从账号菜单打开**「设置」**管理模型服务，再选择可用模型。模型费用与 Notara 插件分开；本插件不提供额度或内置密钥，也不打包额外的 OAuth provider。
2. 新建会话，点击当前模式名称（初始可能是 **「标准模式 / Standard mode」**），在菜单中选择**「首页学习助手」**。这是可长期续接的一段对话，不是另一个静态首页。以后回到这段会话继续聊即可。
3. 点击左上角工作区名称，选择**「添加工作区…」**，打开第 2 步的资料目录，例如 `Notara-Learning`。系统目录选择器直接选文件夹；若显示浏览器式选择器，可用**「编辑路径」**输入绝对路径。已添加的目录直接在菜单中选择即可。
4. 确认左上角已选中这个目录，输入区没有「选择工作区 / Choose workspace」提示。按下一篇指南发送第一条学习请求后，再到「资料」确认文件属于这个目录。配置文件里的资料路径和界面当前工作区应指向同一处。

若看不到 Notara 角色，先检查当前是否开启了可用工作区工具的模式，以及 profile 是否启用了 Notara bundle。不要用一个无工具的普通模型聊天代替完整学习流程。

接着打开 **[第一次学习与日常用法](USAGE.md)**，从一个具体问题开始。

## 关闭、重开与备份

重新打开终端后，先重新设置路径，再启动：

```sh
notara_home="$HOME/.notara-dsh"
DSH_HOME="$notara_home" node "$notara_home/profiles/web/node_modules/@deepseek-ai/dsh/lib/bin.js" web --host 127.0.0.1 --port 0
```

如果安装时换了目录名，这里也换成同一目录。保存终端命令即可，不要把带授权参数的旧网页地址当作永久书签。

学习文件与会话不在同一处。备份时，在停止运行后同时保存 `notara_vault` 和 `notara_home`；后者可能包含账号凭据，只放在自己信任的位置，不要上传到公开仓库。升级前同样先备份，参见 [发行与升级](RELEASE.md)。

## 几个常见卡点

| 看到的情况 | 先检查什么 |
| --- | --- |
| 安装器提示目录不为空 | 换一个新目录，不要删除原有会话来凑空目录。 |
| 网页要求授权 | 从当前启动终端重新打开完整授权地址。 |
| 左侧没有预期资料 | 检查当前工作区和配置的资料路径是否一致；样例是否完整复制。 |
| 有文件但没有新知识卡 | 上传、复制和整理是三件事；把资料交给老师并提出整理请求。 |
| 不能开始对话 | 检查模型服务、账号权限与余额；这些不是插件自带能力。 |
| 没有「本课清单」 | 先生成一份备课本，再在老师会话的「活动」中关联。 |

### 可选：语音输入

停止实例后，在 `profiles/web/package.json` 的 `dsh.profile.bundles` 数组中追加 `@deepseek-ai/dsh-experimental-voice-input-bundle`，再重启。它已在锁定的 DSH 依赖中，无需安装器开关。首次使用会由上游下载本地 SenseVoice 运行时，并需授权麦克风；这不是语音输出或实时语音课堂。

### Windows 与 Linux 的验证边界

安装器按跨平台方式调用 npm。Windows 的安装入口是 `node .\install-release.mjs "C:\Notara\profiles\web"`（在生成的发行目录中执行）；配置中的路径可使用正斜杠。PowerShell 启动前用 `$env:DSH_HOME = 'C:\Notara'`，再运行该 profile 中的 DSH Node 入口。

本文的 shell 命令不能逐字粘贴进 PowerShell。Windows 的安装、中文路径、PDF 和关闭重开尚未经过实机验证；Linux 也没有本轮完整课堂验收。当前不能把“跨平台设计”当作这些平台已经验收。
