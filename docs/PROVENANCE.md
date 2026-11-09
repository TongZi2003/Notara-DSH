# 来源与分发范围

本仓库从 Notara DSH 插件的当前源码独立导出，不继承私有开发仓库的 Git 历史、运行配置、课堂数据和教材学习集。

## 第一方实现

- `plugins/graph-and-blocks/src/domain/` 的解析、作答校验与 fingerprint 合同源自 Notara 自有 Vault 实现。
- `plugins/graph-and-blocks/src/geometry-engine.jsx` 的二维渲染参考 DSH 的 `examples/native-vault/board-visual-client.js`，观察版本为 `7b6b831d9947a3e08879e3ad2dcbf853e65df172`；空间投影参考 Notara 自有桌面实现。移植后依赖均在本仓库内声明，没有带入旧版编译产物。
- `plugins/bundle/*-adapter.mjs` 针对锁定 DSH 版本提供可检查、可恢复的宿主补丁。DSH 自身采用 MIT，原许可位于 `scripts/licenses/dsh-MIT.txt`，并随各包的第三方声明分发。
- 教学提示词、模板和项目所有者确认自行生成的同学头像作为本仓库第一方内容按 AGPL-3.0-only 发布；头像原图和显示方式保留，确认记录见其 `SOURCES.md`。

## 第三方代码与字体

各插件的 `THIRD_PARTY_NOTICES.md` 随构建按实际打包输入生成；运行依赖还保留安装包自带许可。

- Excalidraw 代码：MIT；其字体分别按字体原许可分发，版权和全文汇总在 `scripts/licenses/excalidraw-fonts.txt`，随 vault-views 构建写入声明。
- ExcaliMath：MIT；固定来源与完整许可位于 `plugins/vault-sqlite/vendor/excalimath/`。
- JSXGraph：使用其双许可中的 MIT 选项。KaTeX：MIT。其余组件见各包声明。
- Noto Sans SC / Noto Serif SC：SIL OFL 1.1，原许可和来源随 `plugins/vault-views/assets/claude-fonts/` 分发；没有分发 Anthropic 字体。
- PDF.js 的字体及 WASM 来自锁定的 `pdfjs-dist` 依赖，保留该包相应目录中的原许可。

## 示例资料

`templates/starter-sets/` 与 `showcase-examples/` 用于演示和测试；学情为合成设定，出处按各材料内的说明保留。物理备课样例为原创题与示意图。

商业书籍、教材题面与原解、由教材拆出的官方学习集均未作为本次开源内容导出。取得适当分发授权后才能另行加入，不能仅因没有附 PDF 就视为可公开分发。
