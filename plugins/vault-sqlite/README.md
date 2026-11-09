# @oh-my-student/plugin-vault-sqlite

源资料、CAS 写入、复习证据和可重建 SQLite 索引。

建议通过 `@oh-my-student/dsh-bundle@0.1.1` 安装完整插件组。要求 Node 24+、DSH 0.2.1-rc.4。保留版权，见 COPYRIGHT；第三方署名见 THIRD_PARTY_NOTICES.md。

配置与宿主适配说明：https://github.com/TongZi2003/Notara-DSH/tree/main/plugins/bundle

## 知识标签与图谱投影

`query().documents` 和 `graph().nodes` 保留原始 `tags: string[]`，另外返回：

- `knowledgeTags: [{raw, target, label}]`：已解析到真实 `concept` / `method` 文件的标签；`target` 是带扩展名的完整相对路径，`label` 保留双链显示别名。
- `unresolvedKnowledgeTags: [{raw, reason}]`：未解析的双链标签；原因是 `invalid-reference`、`missing`、`ambiguous` 或 `not-entity`。不生成空卡，不改写原文。

带目录的路径和带扩展名的完整文件名只精确解析；无目录、无扩展名的短名必须在整个学习集唯一。普通正文引用和旧无限定学生联系继续保留原有的本目录优先解析。

实体标签筛选使用 `[[完整相对路径.md]]`。`query({tags, tagMatch})`、`graph({tagFilter, tagMatch})`、Base 的 `file.hasTag(...)` 及标签列表 `.contains(...)` 按目标身份匹配，别名不同也命中同一集合。普通字符串标签、全文检索和 Base 返回的原属性值继续保留。

`query({facet:'tags', search, limit, offset})` 继续返回 `{facet:'tags', values, total, offset, limit}`。`values` 中：

- 已解析的实体标签为 `{value:'[[完整相对路径.md]]', count, label, target}`，同一目标的全部别名聚合为一项；`count` 按文档去重，同一文档多个别名只计一次。`label` 取实体标题（空标题回退目标路径），`target` 是完整相对路径。
- 普通标签及未解析的双链保留 `{value:原始字符串, count}`，不附加 `label/target`，不与同名实体标签混合。

搜索按实体标题、任一原始引用/别名、规范 value 或普通原值匹配。匹配一个别名后仍返回该实体的完整去重计数；`total` 是匹配后的聚合项数，分页在聚合与搜索之后进行。以上查询只读取 SQLite 索引和可重建的实体标签投影，不扫描或读取学习集文件，也不改写原始 tags。

`graph()` 返回 `relationsVersion: 2`，并保留完整节点和全部关系供调用方按范围展示。每条边保留 `source/target/style/knowledge/sectionKind`，新增：

- `kind: prerequisite | example | association | reference | source`；前序为前驱→后继，例子为实体→例子，横向关系为无向。
- `context: string`：路线名或主题名，默认空字符串；同一路线内联合、不同路线间替代，不摊成全部必修。
- `id: string`：由种类、规范端点和 context 生成；描述或列表顺序变化不改变身份。前序方向、不同种类和不同 context 分别保留。
- `description: string` 和 `declarations: [{path, sectionKind, description, style}]`：仅合并该关系自己的说明和声明出处。待探索优先也只作用于该关系。

新版默认主干由调用方选择 `prerequisite/example/source`；其他联系仍可访问。只有正文根级前序/横向小节的直接列表声明相应关系，例子挂接从其实体标签派生。限定学生声明只修改已有对应关系；旧无限定学生联系保持一般横向关系。来源和普通引用不改变个人关系状态。循环和显式直接边原样保留。

SQLite 缓存版本升级后在启动扫描中重建 Markdown 投影；查询和图谱只用索引。目标改名、删除或变为非知识实体会使挂接失效，原始标签和正文不随索引改写。保存器 CAS、工具权限和正式复习事实不变。
