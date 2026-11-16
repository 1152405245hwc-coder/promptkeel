# 多平台 Adapter / Registry 设计

本文基于当前仓库代码（`dsh-forge`，截至 2026-11-16）与各平台公开配置文档，给出可分阶段实现的跨平台升级方案。目标是让同一份提示词与策略可以在多个宿主上安全地探测、编译、预览、应用和回滚，同时保留现有 `forge.profile/v1`、CLI 和 DSH 原生补丁流程。

## 1. 当前实现的事实与边界

当前代码已经有一条可复用的主链：

- `hosts/registry.mjs` 导出固定 `HOSTS` map，提供 `detectHost(id)` 和 `detectAll()`；各 `hosts/*.mjs` 只实现 `detect()`、`configTargets()`，探测结果主要是路径是否存在。
- `core/contract.mjs` 只接受 `forge.profile/v1`，Profile 的宿主是 `host` 字符串，写入目标由 `targets[]` 的 `kind/path/scope/value` 描述；已支持 `markdown-block`、`json-merge`、`toml-merge`、`file`、`dsh-patches`、`prompt-only`。
- `core/compile.mjs` 直接按 `target.kind` 生成动作，绝对路径只进入运行计划，不进入 `planId`；`core/prompt.mjs` 固定按 `core → model → host → mode` 合成提示词。
- `core/executor.mjs` 负责单个计划的预览、SHA 冲突检查、备份、原子写入和补偿回滚；DSH 目标委托 `lib/engine.mjs`，备份在 `~/.dsh-forge/plans/<id>/`。
- `bin/dsh-forge.js` 的 `compile`/`apply --profile` 一次只处理一个 Profile；没有批量计划、跨计划锁或同一目标的重叠冲突判定。
- `verifyPlan()` 能验证文件 `afterSha` 和 DSH patch marker；没有统一的“宿主已安装 / 已配置 / 当前会话已加载”探测状态。

因此第一阶段应采取增量方式：先加 Adapter 规范化层和批量执行 API，保留现有 target-kind 分支与单计划行为；不要同时重写 Profile Schema、DSH engine 和所有 CLI 命令。

## 2. 公开平台约定（作为 Adapter 的外部事实）

以下只记录平台公开约定，不把仓库当前 Profile 中的键名自动视为有效平台能力。平台文档变化时，Adapter 的 `version`、探测证据和能力级别必须一起更新。

| 宿主 | 指令/配置入口 | 对 Adapter 的约束 | 当前仓库的边界 |
|---|---|---|---|
| Claude Code | `CLAUDE.md` 可提供持久指令；设置文件按 User `~/.claude/settings.json`、Shared project `.claude/settings.json`、Project local `.claude/settings.local.json`、Managed 分层。设置文件是严格 JSON；`permissions` 有 `allow/ask/deny`。 | 必须区分 user/project/local/managed；只写声明的层级；探测要报告更高优先级或 managed 覆盖。不能把项目文件中的键当作一定生效。 | 现有 `claude-code` 写 project `CLAUDE.md` 与 `.claude/settings.json` 的 `permissions.defaultMode`，应继续标为高风险并加“可能不在 project 层生效”的告警。 |
| Codex CLI | `AGENTS.md` 按 `~/.codex` 和 repo root→CWD 逐层注入；`~/.codex/config.toml` 有 `approval_policy`、`sandbox_mode` 等配置。 | `AGENTS.md` 是指令层，不等价于 approval/sandbox 配置；user 与 project 目标必须分开，TOML 合并不能跨到子表。 | 现有 `codex` 只写项目 `AGENTS.md`，因此只能宣称 prompt 能力；不要由 adapter 推断已经修改 approval/sandbox。 |
| Gemini CLI | 用户 `~/.gemini/settings.json`、项目 `.gemini/settings.json` 有优先级；`GEMINI.md` 是可层级发现的 context 文件；`general.defaultApprovalMode` 可设置审批模式，`--yolo` 是会话级开关。 | 要识别 user/project settings 和 context 文件；版本化 setting key；`--yolo` 不能由文件写入替代。 | 现有 `gemini` 写 `GEMINI.md` 和 `autoAccept`，该键未在当前官方配置说明中作为默认审批键，继续标 `experimental`，阶段 1 不扩大声明。 |
| OpenCode | `AGENTS.md` 具有全局→项目→子目录层级；`opencode.json` 使用 `$schema`，Agent 可用 `permission`；公开权限文档还定义 action/resource/effect 规则与 `ask/allow/deny`。 | 必须记录配置 schema URL 和 OpenCode 版本；`permission`（agent 配置）与 permissions 规则数组不能混为一层；要保留未管理键。 | 现有 `opencode` 合并顶层 `permission.edit/bash`，应由 adapter 做版本和 schema 预检，不能只看文件存在即判定激活。 |
| DSH | 当前仓库自己的 `lib/table.mjs` 8 个版本锚点、`app.asar` 解包和 `~/.dsh/prompt-inject.md` 流程。 | 继续只由 DSH adapter 调用 `lib/engine.mjs`；其他宿主不复用 JS patch。 | 当前 DSH 流程可保持原样，批量层只把它作为一个可补偿动作。 |

来源（检索于 2026-11-16）：[Claude Code settings](https://code.claude.com/docs/en/settings)、[Codex AGENTS.md prompting guide](https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide)、[OpenAI Codex config schema](https://github.com/openai/codex/blob/main/codex-rs/config/src/config_toml.rs)、[Gemini CLI configuration](https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/configuration.md)、[OpenCode instructions](https://opencode.ai/docs/instructions/)、[OpenCode permissions](https://opencode.ai/docs/permissions/)、[OpenCode agents](https://opencode.ai/docs/agents/)。这些是平台规则的证据，不代表每个键在所有版本均可用；Adapter 必须保存实际版本与未覆盖状态。

## 3. Adapter 与 Registry 接口

### 3.1 最小可落地接口

新增 `hosts/adapter.mjs`（仅定义类型约定和结果规范，不引入第三方依赖），并把现有 host module 通过一个规范化函数注册：

```js
// 逻辑接口；第一阶段不要求所有方法都实现
{
  id: "codex",
  label: "Codex CLI",
  support: "verified",
  adapterVersion: "1.0.0",
  detect(context) -> DetectionResult,
  configTargets(context) -> TargetDescriptor[],
  preflight(profile, detection, context) -> { ok, problems, warnings },
  compileTarget(target, compileContext) -> Action[] | undefined,
  verifyTarget(record, context) -> VerifyRow | undefined,
  rollbackTarget(record, context) -> Result | undefined,
}
```

`compileTarget`、`verifyTarget`、`rollbackTarget` 是可选的。缺省时仍走 `core/compile.mjs` 的现有 target-kind 分支以及 `core/executor.mjs` 的现有文件回滚。这样 DSH 可以只实现 `preflight/verify/rollback` 的桥接，generic 可以只实现 `detect/configTargets`。

`DetectionResult` 不能只返回 `ok`：

```js
{
  id: "codex",
  status: "installed|configured|active|missing|unknown",
  ok: true,                         // v1 兼容字段，status !== "missing"
  confidence: "high|medium|low",
  root: "/...",                    // 可选，输出时脱敏
  version: "...",                  // 可选，未探测到时为 null
  evidence: [
    { kind: "executable|manifest|config|instruction|session", path: "...", detail: "..." }
  ],
  targets: [/* 实际可写层级和路径 */],
  warnings: [/* stale/unsupported/managed/permission */],
}
```

`active` 只表示有宿主会话或可核验的运行时证据；“文件存在”最多是 `configured`。拿不到版本、权限或会话探针时必须返回 `unknown`/`NOT_COVERED`，不能降级成成功。

### 3.2 Registry 的兼容实现

保留当前导出：

```js
export const HOSTS = { dsh, "claude-code": claude, ... };
export const HOST_IDS = Object.keys(HOSTS);
```

在其旁边增量增加：

```js
export function registerAdapter(adapter);   // 重复 id 直接报错
export function getAdapter(id);             // 未知 id 为结构化错误
export function listAdapters();             // 按 id 排序
export function normalizeAdapter(module);   // 老 module -> 新接口
```

`detectHost()`/`detectAll()` 继续保留旧返回字段，并把 `DetectionResult` 展开；新增 `status/confidence/evidence/warnings` 不破坏已有调用。Registry 不执行写入，不执行命令安装，不主动启动宿主。

### 3.3 编译边界

`core/compile.mjs` 的新流程应是：

1. `getAdapter(profile.adapter || profile.host)`。
2. 调用 adapter `preflight`；adapter 不可用时返回结构化 `adapter-unavailable`，不静默 fallback。
3. 对每个 target，先调用 `adapter.compileTarget`；返回 `undefined` 才使用现有 target-kind 分支。
4. 将 `adapter.id`、`adapter.adapterVersion`、目标规范化摘要写入计划和 `planId` 的 canonical input。
5. 计划仍不读写文件；宿主现场冲突只在 `preview/apply` 阶段检查。

这样不会把平台知识塞进 `core/compile.mjs` 的巨大 `switch`，也不改变已有 Profile 的动作字节。

## 4. Profile Schema 设计

### 4.1 阶段 1：`forge.profile/v1` 增量字段

现有 v1 Profile 全部继续有效。加载后先转换为内部 `NormalizedProfile`，不回写源 JSON。增加以下可选字段，旧 Profile 缺失时按下列默认值：

```json
{
  "schema": "forge.profile/v1",
  "id": "codex",
  "name": "Codex CLI",
  "version": "0.1.0",
  "host": "codex",
  "adapter": "codex",
  "platform": {
    "os": ["darwin", "linux", "win32"],
    "version": { "min": null, "max": null },
    "configSchema": null
  },
  "activation": {
    "evidence": ["config", "session"],
    "restart": "required|optional|none"
  },
  "targets": [
    {
      "id": "instructions",
      "kind": "markdown-block",
      "path": "AGENTS.md",
      "scope": "project",
      "blockId": "system",
      "required": true,
      "owner": "dsh-forge",
      "conflict": "merge"
    }
  ]
}
```

默认值是 `adapter = host`、`target.id = <index>`、`required = true`、`owner = dsh-forge`；`conflict = merge` 仅为保留 v1 现有行为。`platform` 和 `activation` 只增加描述与预检，不改变动作。第一阶段只校验已知值，未知扩展字段保留在原 Profile 供未来版本使用。

目标字段定义：

- `id`：同一 Profile 内唯一；批量计划以它定位冲突。
- `required`：false 的目标缺失或宿主不支持时可生成 `NOT_COVERED`，不把整个计划标为成功。
- `owner`：受管区块或 JSON/TOML 键的所有者标签，用于回滚与冲突报告；不能用来绕过 SHA 检查。
- `conflict`：`merge`（保留当前合并语义）、`abort`（目标/受管标记不一致即拒绝）、`replace-managed`（仅允许替换同 owner 区块）。默认不覆盖用户未管理内容。

### 4.2 阶段 2：`forge.profile/v2`（实现前再定稿）

当至少两个非 DSH Adapter 实际需要不同配置层级、版本 schema 或验证逻辑时，再引入 v2：

- `adapter` 成为必填，`host` 仅作展示别名。
- `layers` 明确 `user/project/local/managed` 的候选与优先级；每个 target 绑定一个层。
- `targets[].render` 明确 `markdown-block/json-merge/toml-merge/file/prompt-only` 的序列化契约；平台专属动作通过 adapter capability 声明。
- `capabilities` 改为 `{ level, evidence, notes }`，保留 v1 字符串读取兼容。
- `activation` 记录 `configured` 与 `active` 的证据类型，允许 `requiresRestart` 由 adapter 计算。

v2 不能通过“把旧 `host` 字符串换成对象”隐式升级；必须有明确 loader 和迁移测试。

## 5. 平台探测与能力判定

探测分三层，任何一层失败都保留具体状态：

1. **安装（installed）**：可找到可执行文件或平台 manifest/package；版本可解析时记录版本。路径存在而版本未知时是 `installed + version:null`。
2. **配置（configured）**：实际层级文件存在且 JSON/TOML/Markdown 可解析；只检查文件存在不代表键生效。
3. **激活（active）**：运行时 probe 能证明当前会话加载了受管区块（例如 DSH session marker、宿主的 status/diagnostic 输出）。无法探测时为 `unknown`，不自动升级为 active。

每个 adapter 的 `detect()` 应至少返回 `candidates[]`、`selected[]`、`warnings[]`。选中路径须写明选择理由（scope precedence、nearest ancestor、configured filename），避免把多个层级合并成一个模糊 `root`。探测输出默认脱敏；计划 manifest 内保存 canonical path 和设备/文件身份摘要（若平台允许），供冲突检查使用。

平台特定注意：

- Claude Code 要分别检查 `settings.json`、`settings.local.json` 与 managed source；官方文档指出 managed 设置优先，且部分键不能从项目文件生效。Adapter 应把 `permissions.defaultMode` 的 scope 约束作为 warning/error，而不是宣称“已关闭审批”。
- Codex 的 `AGENTS.md` 发现是目录层级，`config.toml` 是用户级配置。Adapter 不应把 `AGENTS.md` 里的提示词写入 TOML，也不应把项目级指令当作 sandbox/approval 验收证据。
- Gemini 的 context 文件发现与 JSON settings 是两条链；`--yolo` 是会话参数，不能由 settings merge 假定替代。旧 `autoAccept` 目标必须保留实验性告警。
- OpenCode 要检查 `$schema`、配置层级和 permission 语义；`AGENTS.md` 的加载顺序与 `opencode.json` 的 Agent 权限不是同一个通道。

## 6. 批量 Compile / Apply

### 6.1 纯批量编译

新增 `core/batch.mjs`：

```js
compileMany(
  [{ profile, model, mode, context }, ...],
  { promptRoot, budget }
) -> {
  schema: "forge.batch/v1",
  batchId,
  plans: [/* forge.plan/v1 */],
  targets: [/* 去绝对路径后的规范化目标摘要 */],
  conflicts: [],
  ok: true
}
```

实现规则：

- 输入按 `profile.id + model.id + mode` 排序，逐项调用现有 `compile()`；任一 required Profile 编译失败，整个 batch 为 `ok:false`。
- `batchId = sha256(adapter id/version + sorted planId + canonical target summary).slice(0,16)`；不包含本机绝对路径、时间、主机名。
- 同一规范目标若产生相同字节/同一 managed block，去重；同一目标的不同 bytes、不同 `owner` 或不同 blockId 直接报 `batch-target-conflict`。
- `prompt-only` 计划只出现在 `plans`，不进入文件冲突集合。
- preview 为 `forge.preview/v1` 的扩展：增加 `batchId`、每个 `planId`、每个目标的 `beforeSha/afterSha` 和 detection snapshot。

### 6.2 事务式批量应用

新增 `applyBatch(batch, options)`，第一阶段只允许一个进程、一个 state root：

1. 校验所有计划 `verifyCompiled`、预算和 adapter preflight。
2. 解析并 canonicalize 所有目标；拒绝符号链接、重复冲突和 scope 越界。
3. 在任何写入前读取全部目标并检查 preview SHA；任一冲突则 0 写入。
4. 建立 `stateRoot/batches/<batchId>.lock`（使用原子 `wx` 创建）；已有活动锁返回 `batch-locked`，不重试覆盖。
5. 创建 `~/.dsh-forge/plans/<plan-id>/` 的文件备份，并创建一个 `~/.dsh-forge/batches/<batch-id>/manifest.json`，记录执行顺序和补偿动作。
6. 按稳定顺序执行文件动作；DSH patch 作为一个可补偿动作，失败时调用原有 `revertPatches` 和 `restorePackedAsar`。
7. 全部成功才将 batch 标为 `applied`；任一失败反向恢复全部已写入目标，状态标为 `reverted` 或 `rollback-failed`，并显式返回 `rollbackErrors`。

第一阶段不支持跨机器并发、不支持后台重试、不支持把两个不同 state root 合并；需要这些能力时另立版本。

建议 CLI 形状（实现顺序可晚于 API）：

```text
dsh-forge compile --profiles codex,claude-code --out batch.json
dsh-forge apply --batch batch.json --dry-run --preview batch-preview.json
dsh-forge apply --batch batch.json --yes --preview batch-preview.json
dsh-forge verify-batch <batch-id>
dsh-forge revert-batch <batch-id> [--force]
```

保留旧 `compile <profile>` 和 `apply --profile <id>`，旧命令内部可调用单元素 batch，但输出字段和退出码保持兼容。

## 7. 状态、回滚与冲突保护

### 7.1 状态机

```text
planned → previewed → applying → applied → verified
                         └──────→ reverting → reverted
                         └──────→ rollback-failed
```

每个状态都要写入 manifest，并带 `createdAt/updatedAt`。`verified` 只表示目标 bytes/adapter proof 与 manifest 一致；configured/active 仍由 detection 独立报告。空目标、跳过 optional 目标、未知版本、未覆盖的 session proof 必须保留 `NOT_COVERED`，不能将 batch 标为完整成功。

### 7.2 Manifest 最小字段

```json
{
  "schema": "forge.batch-manifest/v1",
  "batchId": "...",
  "status": "applied",
  "plans": [{ "planId": "...", "profile": "codex", "adapter": "codex", "adapterVersion": "1.0.0" }],
  "targets": [{
    "id": "instructions",
    "path": "...",
    "scope": "project",
    "owner": "dsh-forge",
    "beforeSha": null,
    "afterSha": "...",
    "backup": "files/000.bak",
    "identity": { "dev": "...", "ino": "..." }
  }],
  "detection": [{ "status": "configured", "version": "...", "evidence": [] }],
  "rollback": { "attempted": false, "errors": [] }
}
```

路径在 UI/日志中脱敏；manifest 内可记录用于恢复的 canonical path。`planId` 继续跨机器稳定，但 batch manifest 和 preview 是本机产物。

### 7.3 冲突判定

- **预览漂移**：`currentExists` 或 `currentSha != beforeSha`，返回 `preview-conflict`，不写任何目标。
- **同批目标冲突**：同 canonical path + 不同 bytes/owner/block，返回 `batch-target-conflict`。
- **外部编辑**：回滚时 `currentSha != afterSha`、目标被删、换成符号链接，默认拒绝；`--force` 只在显式记录后执行。
- **配置语义冲突**：JSON/TOML 中已有受管键但 owner/hash 不匹配，按 `conflict` 策略 `abort`；不能用递归 merge 静默覆盖。
- **宿主版本漂移**：DSH 继续使用 `lib/engine.mjs` 的 hostVersion guard；其他 adapter 若无法确认版本，状态为 `unknown` 并阻止需要版本保证的 target。
- **活动锁冲突**：批量锁存在时直接 `batch-locked`；锁内容含 pid、createdAt、batchId，过期清理由显式 `unlock`/人工诊断完成，不在第一阶段自动猜测。

## 8. 分阶段实现边界

### 阶段 1：兼容层（建议先做）

范围：

- 新增 adapter 结果类型、`normalizeAdapter()`、Registry 注册/查询；现有六个 host module 不改导出。
- `core/contract.mjs` 接受 v1 可选 `adapter/platform/activation/target.id/required/owner/conflict`，loader 归一化为内部结构。
- `core/compile.mjs` 调 adapter 的可选 preflight/compileTarget，缺省走原有 switch；计划增加 adapter 元数据。
- 新增 `compileMany()`、`applyBatch()`、batch manifest/lock/全量预览和补偿回滚；单计划委托到同一套底层但保留输出兼容。
- 充实五个非 generic `detect()` 的 status/evidence/version 字段；仍只读，不安装、不启动宿主。

停止条件：旧 `npm test`、`npm run verify:profiles` 全部通过；新增 v1 golden tests、六宿主 detection contract tests、batch conflict/rollback tests 通过。

不在阶段 1：重写所有 Profile 为 v2、自动修正平台设置键、自动发现/安装 CLI、运行真实宿主会话验收、跨机器锁服务。

### 阶段 2：平台语义与 v2 Schema

在至少两个 Adapter 需要不同 layer/version/verify 语义后，引入 `forge.profile/v2` 和迁移工具；增加每平台 schema URL/version gate、managed precedence 警告、平台真实诊断 probe。此阶段才考虑把 `target.kind` 迁到 adapter-owned renderers。

### 阶段 3：真实激活证明

实现各宿主的可重复 session probe（或明确 `UNOBSERVABLE`）；将 `configured`、`active`、`verified` 分离展示，并补充真实 CLI/浏览器端到端验收。没有宿主可用环境时只交付 `NOT_COVERED`，不把模拟 fixture 当作真实激活。

## 9. 旧 Profile 迁移方案

1. **读取兼容**：`schema == forge.profile/v1` 的现有 JSON 原样读取；`adapter` 缺失取 `host`，`platform` 为空，`activation` 从 `activationEvidence/requiresRestart` 推导，target 缺失字段使用 v1 默认值。
2. **内部归一化**：只在内存形成 `NormalizedProfile`，保留原始对象和 `sourceSchema`；`planId` 在阶段 1 仍按旧 canonical target 计算，增加 adapter 元数据前用 feature gate，避免同一旧输入的计划 ID 无预警变化。
3. **可选迁移输出**：未来提供 `profiles migrate <file> --to v2 --out <file>`，只生成新文件并显示 diff；不原地修改、不自动覆盖用户 Profile。
4. **旧行为保护**：v1 的 `conflict` 默认 `merge`，DSH `dsh-patches` 保持现有 `PATCHES` 路径；v2 才要求显式 layer/owner/conflict。已有 `model`、`prompt.core`、`targets` 语义不变。
5. **迁移失败边界**：未知 target kind、平台版本不明、managed 设置不可写、旧 JSON 无法解析均返回结构化错误；不静默降级到 generic 或 prompt-only。

## 10. 必须新增的测试

### Adapter / Registry

- `normalizeAdapter()` 能把现有六个 module 转为新接口；重复注册、未知 id、缺失必需方法有稳定错误码。
- `detectAll()` 保留现有 `id/label/support/ok` 字段，同时返回 status/evidence；`configured`、`active`、`unknown` 不互相冒充。
- 版本解析、候选路径优先级、脱敏输出和权限不可读目标的 `NOT_COVERED`。

### Profile / Compile

- 六个现有 v1 Profile 字节级 golden：同 model/mode 的 prompt、actions、旧 `planId`（在兼容开关下）不变。
- 新可选字段的 schema 校验、默认归一化、target id 唯一性、scope 越界、未知 conflict 策略。
- adapter `compileTarget` 返回动作时可用；返回 undefined 时旧 target-kind fallback 与现有结果完全一致。
- Claude/Codex/Gemini/OpenCode 的目标路径和实际官方层级映射；Gemini `autoAccept` 等未确认键必须出现 warning/experimental，而不是 verified。

### Batch / Apply

- 输入排序产生稳定 `batchId`；相同目标同字节去重；不同 bytes/owner/block 报 `batch-target-conflict`。
- preview 期间任一文件变化、删除、换符号链接、计划 ID 不匹配时，确保 0 写入。
- 第二个进程/活动 lock 返回 `batch-locked`；锁释放和异常清理可验证。
- 一个文件成功后第二个文件失败、DSH patch 中途失败、ASAR 解包后失败时，全量回滚并留下 `rollbackErrors`；故意让回滚失败时状态必须是 `rollback-failed`。
- JSON/TOML 受管键外部修改、重复 managed block、旧版本 manifest、hostVersion 漂移均拒绝静默覆盖。
- apply → verify-batch → revert-batch 的字节恢复；`--force` 的 drift 记录和退出码。

### 平台验收

- 用 fixture 覆盖 Claude settings precedence、Codex AGENTS 层级与 TOML root key、Gemini context/settings 分离、OpenCode schema/permission 结构。
- 若没有真实宿主可执行文件、会话或权限，测试结果标为 `NOT_COVERED`；fixture 只能证明解析/计划行为，不能标 `active`。
