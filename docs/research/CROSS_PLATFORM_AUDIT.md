> **Snapshot Note**: Point-in-time research artifact; line anchors and figures may be superseded by current code. See [docs/ARCHITECTURE.md](../ARCHITECTURE.md) and [docs/MEASUREMENT_RULES.md](../MEASUREMENT_RULES.md).

# dsh-forge 跨平台升级审计

审计日期：2026-11-16  
审计范围：`core/`、`hosts/`、`profiles/`、`lib/`、`bin/`、`test/`、`docs/`，以当前 `main` 工作树为准。  
本轮验证：`npm test`，68/68 通过。测试通过只证明现有 DSH 补丁夹具和文件型 profile 的行为，不证明 Claude Code、Codex CLI、Gemini CLI 或 OpenCode 的真实运行时激活。

## 结论

当前代码已经具备“跨平台配置编译器”的骨架，但还不是平台无关的运行时系统。可复用部分集中在：声明式 profile、确定性 prompt 编译、目标路径作用域、Markdown/JSON/TOML/整文件合并、预览 SHA 冲突保护、事务备份和回滚。真正的宿主生命周期仍由 DSH 特例驱动：profile 合约直接导入 DSH patch 表，plan executor 直接调用 DSH patch engine/ASAR，诊断和插件入口直接读取 `~/.dsh`、Cordis、DSH session 日志。

要升级为真正多平台，核心方向不是再添加几个 profile JSON，而是把“宿主适配器”提升为一等运行时边界：由 adapter/registry 提供检测、版本、目标解析、计划动作、应用、验证、回滚、激活证据和状态存储；`core` 只消费这些接口。DSH 继续作为一个 adapter，ASAR 与 `@deepseek-ai/*` patch 只留在该 adapter 内。

另有一个已实测的调用契约问题：`bin/dsh-forge.js:307-323` 把 `stateRoot`、`hostRoot` 放在 `context.env`，而 `core/executor.mjs:11-13,253-280` 期待扁平 `env.stateRoot`；因此 cross-host CLI 的 `--state`（以及 DSH profile 通过 cross-host 命令传入的 `--host-root`）不会按调用者预期传到 executor。现有测试直接调用 `applyPlan(..., { env: {...} })`，未覆盖该 CLI 路径。

## 当前调用链

### 声明式 cross-host 路径

```text
bin/dsh-forge.js:307-323
  └─ loadProfile/loadModel (core/contract.mjs:118-160)
      └─ compile (core/compile.mjs:24-132)
          ├─ renderPrompt (core/prompt.mjs:37-60)
          ├─ resolveTargetPath (core/compile.mjs:7-18)
          └─ 生成 write-file / merge-block / merge-json / merge-toml /
             dsh-patches / prompt-only action
      └─ applyPlan (core/executor.mjs:253-369)
          ├─ 通用文件合并与 SHA manifest
          └─ 若存在 dsh-patches，调用 lib/engine.mjs
```

`core/compile.mjs:21-24` 声称编译纯且不写盘；这一点对普通文件 target 成立。`dsh-patches` 在 `core/compile.mjs:37-41,80-82` 中被特殊处理，不解析路径，随后由 executor 的 `actionPatches`（`core/executor.mjs:161-169`）绑定全局 DSH `PATCHES`。

### DSH native 路径

```text
bin/dsh-forge.js:398-429
  ├─ doctor/status/verify/prompt/profile 命令
  ├─ lib/doctor.mjs
  │   └─ lib/paths.mjs + lib/asar.mjs + lib/engine.mjs + lib/inject.mjs
  ├─ apply/upgrade/revert/adapt/unpack
  │   └─ lib/engine.mjs / lib/asar.mjs / lib/table.mjs
  └─ Cordis 插件 lib/index.js
      └─ systemPrompt、commands、webServer、/dsh-forge/api
```

该路径默认命令就是 DSH：CLI `apply` 没有 `--profile` 时走 `cmdApply`（`bin/dsh-forge.js:402-405`），帮助文本和输出也固定写 DSH（`bin/dsh-forge.js:77-109,116-145`）。

## DSH 硬编码与影响

| 位置 | 现状证据 | 跨平台影响 |
|---|---|---|
| `core/contract.mjs:4-15` | 直接 `import { PATCHES } from "../lib/table.mjs"`；`HOSTS`、`TARGET_KINDS`、`PATCH_IDS` 是静态列表 | host 合约依赖 DSH runtime 模块；新增宿主要改 core 常量和 patch ID 校验，无法由 registry/profile 插件扩展 |
| `core/contract.mjs:58,72,95-109` | model/profile host 必须命中静态 `HOSTS`；`dsh-patches` 的参数必须命中 DSH `PATCHES` | 目标类型和校验无法由宿主适配器注册；非 DSH patch provider 没有 schema 入口 |
| `core/compile.mjs:37-41,80-82` | `dsh-patches` 和 `prompt-only` 不解析路径；`dsh-patches` 直接生成 DSH action | compile 的 action vocabulary 混入 DSH 专用 op；任何新宿主都只能绕过或仿造这个特例 |
| `core/compile.mjs:123-124` | `requiresRestart` 默认值是 `profile.host !== "generic"`，激活证据默认 `config/session` | 把 restart 和 activation 当成 profile 静态布尔值，没有 host runtime probe 或状态转换 |
| `core/executor.mjs:5-7` | 顶层导入 `PATCHES`、`lib/engine.mjs`、`restorePackedAsar` | executor 即使执行纯文件 profile，也加载 DSH patch/ASAR 依赖；边界无法按 host 替换 |
| `core/executor.mjs:161-169` | `actionPatches` 只从全局 `PATCHES` 解析 `dsh-patches` | action 没有 provider/adapter ID；不能按 plan 选择不同宿主的 apply/verify/revert 实现 |
| `core/executor.mjs:284-294,315-325` | manifest 固定含 `dsh: null`；应用结果写 `manifest.dsh`、`backupDir`、`hostRoot`、`dshHome`、`unpackedAsar` | 状态 schema 无法表达多个宿主的 provider state，跨宿主计划必须塞进 DSH 字段 |
| `core/executor.mjs:342-355,427-459` | rollback/verify 只要看到 `manifest.dsh` 就调用 `revertPatches`/`verifyAppliedPatches`，并专门恢复 ASAR | 通用文件事务与宿主 runtime 事务耦合；新 adapter 无法注入自己的回滚/验证逻辑 |
| `lib/paths.mjs:42-74` | `dshHome`、`profileDir`、`DSH_HOME`、`DSH_FORGE_PROFILE`、DSH macOS/Linux/Windows host candidates；`hostRoot` 检查 `@deepseek-ai` | 默认 state、profile、安装探测都以 DSH 为中心，其他宿主不能复用同一套路径上下文 |
| `lib/paths.mjs:76-94,120-145` | forge 目录、prompt 路径固定在 `~/.dsh`；`targetPath` 除 user data 外一律落到 DSH `hostRoot` | cross-host 状态与 target root 不能按宿主隔离；目标路径解析与 DSH hostRoot 语义混在一起 |
| `lib/table.mjs:7-114` | 8 条 patch 全部指向 `node_modules/@deepseek-ai/dsh-*`，版本范围为 DSH `0.2.x` | 这是有效的 DSH patch provider，但不能作为 core 的全局知识 |
| `lib/engine.mjs:4-7,114-127,129-207` | engine 依赖 DSH `targetPath/hostRoot/hostVersion`、ASAR reader、`PATCHES`；inspect/dryRun 读取 DSH package/version | 没有抽象的 host file reader、version probe 或 patch provider；只可审计 DSH 锚点 |
| `lib/engine.mjs:215-377,402-518` | apply/upgrade/revert/verify 都围绕 DSH patch、backup、host version、ASAR | “应用一个宿主计划”的生命周期没有可替换 seam |
| `lib/asar.mjs:20-43,142-170,222-357` | `resolveAsarLayout` 识别 `app/dsh`，prefix 为 `dsh`；存储状态检查 `@deepseek-ai`；错误信息写 DSH | 包装格式/解包是 DSH 私有能力，却位于通用 `lib` 命名空间并被 core executor 直接导入 |
| `lib/inject.mjs:5-9,22-50,138-213` | prompt 写入 `promptInjectPath`；验证 DSH patches、`dsh.profile.bundles`、session.v4.zstd | 非 DSH profile 没有等价的 runtime prompt activation/verify；`composePrompt` 与 `core/renderPrompt` 是两套组合器 |
| `lib/inject.mjs:216-232` | `injectionSource` 只识别 `~/.dsh/prompt-inject.md` 和 `AGENTS.md` managed block | Claude/Gemini/OpenCode 的 target 已写入，但 doctor/status 不会识别其来源 |
| `lib/doctor.mjs:14-124` | 12 项检查全部是 host root、DSH version、8 patches、DSH prompt、bundles、session log、DSH backup | doctor 的返回 schema、activation state 和 risk 固定 DSH，无法成为多宿主健康检查接口 |
| `lib/preset.mjs:36-99` | 只读写 `~/.dsh/profiles/<profile>/package.json` 的 `dsh.profile.bundles`，并排序 `dsh-forge`/`dsh-purge` | plugin enable/disable 是 DSH/Cordis 生命周期，其他宿主没有对应注册层 |
| `lib/index.js:8-13,119-173,175-256` | Cordis `systemPrompt` 注入、`commands`、`webServer`、固定 `/dsh-forge/api`，命令描述写 DSH | 该入口应成为 DSH adapter/plugin，不能充当通用宿主接口 |
| `bin/dsh-forge.js:6-18,77-109,112-305` | CLI 顶层同时加载 DSH native 模块和 core；默认命令、环境变量、提示、收集报告均写 DSH | CLI 路由没有 host adapter dispatch；非 DSH 只能走较窄的 compile/apply-profile 分支 |
| `bin/dsh-forge.js:307-323,341-354` | `forgeContext` 返回嵌套 `context.env`，`applyPlan` 接口却读取扁平 env | host/state override 在 cross-host CLI 中丢失；这也是未来 context/adapter seam 必须先统一的契约 |
| `profiles/*.json` | profile 的 target 直接写 `CLAUDE.md`、`AGENTS.md`、`GEMINI.md`、`opencode.json` 和权限值；只有 DSH profile 使用 `dsh-patches` | 声明数据能表达文件合并，不能表达检测、配置版本、运行时激活、验证或宿主级回滚 |
| `hosts/*.mjs` + `hosts/registry.mjs` | 每个 host 有 `detect`、`configTargets`、label/support；registry 静态导入 6 个模块 | 这是最接近 adapter 的现有 seam，但 `configTargets()` 没有被 core/CLI/executor 调用；registry 只服务 `hosts` 命令 |

## 已有可复用抽象

1. **Profile/model 合约与确定性编译**：`core/contract.mjs:53-160` 做 schema、路径字段和 capability 值校验；`core/compile.mjs:20-132` 生成不含绝对路径 digest 的 `planId`。这应保留为 host-neutral plan IR，但去掉对 `lib/table.mjs` 的导入。
2. **目标路径作用域**：`core/compile.mjs:7-18` 已把 `user/project/absolute` 解析和越界保护集中起来；可扩展为 adapter 提供 named roots，而不让 profile 直接知道每个平台的 home layout。
3. **可组合的文件操作**：`core/executor.mjs:53-159` 的 Markdown block、JSON recursive merge、TOML top-level merge、整文件写入及 `core/compile.mjs:43-78` action 生成，可成为通用 target handler。
4. **预览、哈希、事务和恢复**：`core/executor.mjs:171-247,249-369,393-460` 已有 symlink 拒绝、before/after SHA、preview conflict、backup、byte-exact revert；应提炼成 host-independent transaction store，再由 adapter 提供额外 runtime transaction。
5. **Prompt renderer**：`core/prompt.mjs:21-60` 的 core → model → host → mode 顺序、hash、token 估算可复用。当前 `lib/inject.mjs:22-50` 的 DSH 组合器应收敛为 adapter 的 prompt sink，而不是保留第二套 renderer。
6. **Host catalog 雏形**：`hosts/claude-code.mjs:4-17`、`hosts/codex.mjs:4-16`、`hosts/gemini.mjs:4-17`、`hosts/opencode.mjs:4-17`、`hosts/generic.mjs:1-5`、`hosts/dsh.mjs:6-18` 已提供 id/label/support/detect/configTargets；`hosts/registry.mjs:8-17` 已提供查找和全量检测。
7. **Capability 行与 preflight**：`core/capabilities.mjs:3-48` 给出统一能力名和 support rank。可保留输出格式，但能力来源应由 adapter probe + profile policy 合并，且必须绑定到动作/验证。
8. **错误码与 CLI JSON**：`core/errors.mjs:5-23` 和 `bin/dsh-forge.js:430-437` 已形成稳定错误边界，适合让 adapter 报告 `detect/apply/verify/revert` 的机器可读失败。

## 缺失的关键 seam

### 1. Adapter contract（最重要）

当前 host 模块只有 `detect()` 和未使用的 `configTargets()`。建议新增明确的、版本化的 adapter contract（例如 `forge.host/v1`），至少包括：

```text
id / label / support
detect(context) -> installation, roots, version, runtime availability
resolveTargets(profile, context) -> target descriptors with named roots
capabilities(context, profile) -> observed capabilities + evidence
compileTargets(profile, prompt, context) -> host-neutral actions or provider actions
apply(plan/providerActions, transaction, context)
verify(manifest, context) -> rows + activation state
revert(manifest, context, options)
activationEvidence(context) -> configured / active / unobservable
stateNamespace(context) -> host-scoped state root and manifest metadata
```

DSH adapter 可以把现有 `lib/engine.mjs`、`lib/asar.mjs`、`lib/inject.mjs`、`lib/doctor.mjs`、`lib/preset.mjs`、`lib/index.js` 包起来；Claude/Codex/Gemini/OpenCode 先实现文件配置和最小 verify，再逐步补 runtime probe。

### 2. Registry 不是单纯检测表

`hosts/registry.mjs:8-17` 目前静态导入所有模块并只返回 `detect` 结果；`configTargets` 完全没有调用点。Registry 应成为 contract、CLI、compiler、executor、doctor 的唯一 host lookup，返回 adapter 实例和 schema/capability metadata。新增平台只注册 adapter，不修改 `core/contract.mjs` 的数组。

### 3. Target/action handler registry

`core/compile.mjs:42-88` 和 `core/executor.mjs:153-169` 各自维护 `switch`/DSH action 逻辑。应把 `markdown-block/json-merge/toml-merge/file/prompt-only` 注册为 core handlers，把 runtime/patch action 注册为 adapter provider action；plan action 应带 `provider`、`operation`、`targetRef` 和可序列化 input。这样 verify/revert 不必判断 `manifest.dsh`。

### 4. Capability probe 与 policy

`core/capabilities.mjs:25-43` 只校验 host/model 和 rollback 是否 unsupported；它不会检查目标文件格式、宿主版本、运行时 API 或是否真的拥有 approval/sandbox/tools 能力。`profiles/*.json` 的 capability 值是静态声明，甚至 `approval`/`sandbox` 值没有和 action 绑定。需要区分：

```text
declared: profile 声明支持什么
observed: adapter 在当前机器探测到什么
effective: policy 与 observed 的交集
evidence: 每个 capability 的 probe、时间、版本和结果
```

preflight 应在 apply 前拒绝 `effective=unsupported` 的动作，而不是只有 rollback 失败才阻断。

### 5. Host-scoped state and manifest

`core/executor.mjs:284-294` 的 manifest 应改为统一 provider records，例如：

```json
{
  "schema": "forge.manifest/v2",
  "host": "codex",
  "adapter": "codex@v1",
  "roots": {"project": "...", "user": "..."},
  "transactions": [
    {"provider": "core.files", "records": []},
    {"provider": "codex.config", "records": [], "state": {}}
  ],
  "activation": {"required": ["config"], "observed": []}
}
```

状态根不应默认叫 `~/.dsh-forge` 并依赖 `DSH_HOME`；可保留兼容迁移，但新默认应是通用 `~/.forge`（或显式 `stateRoot`），并按 host/profile/plan 分层。DSH 的 `~/.dsh/dsh-forge` 作为 adapter 私有 legacy state 读取。

### 6. Activation/state machine

DSH 的 `lib/doctor.mjs:99-117` 已有 `inactive/configured/active` 三态，但其判定依赖 DSH bundle、patch 数量和 session log。应把这套状态抽到 core：`inactive → configured → active`，另有 `drifted`、`blocked`、`unobservable`；每个平台 adapter 声明如何取得 `config/session/runtime` 证据。没有可观察 session 时必须返回 `unobservable/NOT_COVERED`，不能用“配置文件存在”冒充 active。

### 7. Context/path contract

当前 `compile` 接收 `home/projectRoot`，DSH engine 另读 `env.hostRoot/dshHome`，CLI 又包成 `context.env`。应统一成：

```text
ForgeContext { hostId, profileId, projectRoot, userRoot, stateRoot, hostRoot?, env }
```

所有 adapter、target resolver、state store 只消费该 context；CLI 在进入 core 前完成一次扁平化和 host 选择。至少先修正 `bin/dsh-forge.js:307-323` 到 `applyPlan` 的参数契约并加 CLI integration test。

### 8. Prompt sink/activation source

`core/prompt.mjs` 与 `lib/inject.mjs` 重复组合逻辑，`injectionSource` 只识别 DSH prompt file/AGENTS block（`lib/inject.mjs:216-232`）。应让 adapter 声明 prompt sink（managed block、whole file、system-message callback、Cordis section）和 source probe，通用 verify 才能报告每个 host 的实际激活状态。

## 分阶段改造清单

### 阶段 0：冻结行为与修正调用契约

- 保持现有 `forge.profile/v1`、`forge.plan/v1`、`forge.manifest/v1` 兼容读取。
- 修正 `forgeContext`/`applyPlan` 的扁平 `ForgeContext` 传递；新增一个 CLI 测试，使用临时 `--state`，确认 apply、plans、verify-plan、revert-plan 读写同一目录；对 DSH profile 额外验证 `--host-root` 进入 patch engine。
- 为每个现有 profile 记录当前真实覆盖：普通文件 profile 仅有 compile/apply/revert 字节测试；真实 host runtime 的 activation 为 `NOT_COVERED`。
- 不移动 DSH 实现，先建立 contract tests 作为迁移护栏。

### 阶段 1：抽出通用 transaction/action 层

- 新增 `core/actions.mjs`（或等价 registry），把 `mergeBlock/mergeJson/mergeToml/write-file` handler 统一注册；`compile` 只生成 provider-neutral action。
- 新增 `core/state.mjs`，统一 state root、manifest、preview、SHA、backup；保留现有 manifest 读取适配器。
- 将 `core/executor.mjs` 中 `actionPatches`、`manifest.dsh`、ASAR rollback 分支改为 provider hook；未注册 provider 时返回结构化 `provider-unsupported`，不能静默跳过。
- 保持现有 68 项测试，并增加 provider action 的 apply/verify/revert contract test。

### 阶段 2：把 hosts registry 升级为 adapter registry

- 将 `hosts/*.mjs` 的 `detect/configTargets` 扩展为 `forge.host/v1` adapter；`hosts/registry.mjs` 提供 `getAdapter(id)`、`listAdapters()`、`detectAll(context)`。
- 从 `core/contract.mjs:8` 移除静态 host 数组，改为 registry 查询；model `hosts` 校验也走 registry。
- profile target 改用 adapter 提供的 named target/roots 或 `targetRef`，保留路径安全检查；`configTargets()` 必须参与 compile/preflight，而不是仅供未来使用。
- CLI 的 `profiles`、`hosts`、`compile`、`apply`、`status` 共用同一 adapter lookup，默认命令不再隐式等于 DSH；DSH native 命令显式进入 `dsh` adapter。

### 阶段 3：迁移 DSH 为私有 adapter

- 建立 `adapters/dsh/`（或 `hosts/dsh/adapter.mjs`）边界，把 `lib/table.mjs`、`lib/engine.mjs`、`lib/asar.mjs`、DSH path candidates、Cordis plugin、session proof、preset bundle ordering 放进去。
- DSH adapter 实现 version probe、patch provider、ASAR storage provider、prompt sink、activation evidence 和 DSH legacy state migration。
- `core/contract` 不再导入 DSH patch table；`dsh-patches` 不再是全局 target kind，而是 adapter action/provider（例如 `provider: "dsh.patches"`）。
- 将 `lib/index.js` 作为 DSH plugin entry 保留，但改为调用 adapter service；通用 CLI/doctor 不再直接导入该模块。
- DSH 的 8 条 patch 和 packed `app.asar` 测试原样保留为 DSH adapter contract tests。

### 阶段 4：补齐其他平台的运行时 adapter

- **Codex**：已有 `AGENTS.md` block 和 `hosts/codex.mjs` 检测；补 `config`/`session` probe、`~/.codex/config.toml`（若确有政策写入需求）的显式 target schema，以及 drift/activation verify。当前 profile 的 `mutatesHost=false` 与实际写 project `AGENTS.md` 语义需重新定义并测试。
- **Claude Code**：补 `.claude/settings.json` schema/version probe、权限模式的有效值校验、session/运行时可观察证据；不要仅以 `CLAUDE.md` 存在判 active。
- **Gemini CLI**：当前 support 为 experimental，`autoAccept` 和 `--yolo` 的版本差异应由 adapter capability probe 报告；配置 key 不存在或版本不匹配时返回 `unsupported/NOT_COVERED`。
- **OpenCode**：验证 `opencode.json` permission schema 和实际 tool mode；`hosts/opencode.mjs` 的 `~/.config/opencode` 检测要进入 adapter roots/verify。
- **Generic API**：保留 `prompt-only`，把 activation 明确标为 caller-owned/unobservable；输出 plan prompt 和 capability evidence，不伪造 rollback 或 session proof。

### 阶段 5：统一 status/doctor/迁移文档

- 新增通用 `core/status` 返回 `{configured, active, hostReady, requiresRestart, evidence}`；各 adapter 贡献 rows，DSH 的 12 项 doctor 作为 DSH-specific details。
- 将 `docs/PORTABILITY.md` 的 “verified” 定义改为按 adapter contract、真实 target fixture、运行时 probe 三层分别标注；当前文档声称 cross-host `verified`，但 `test/hosts.test.mjs` 只做 compile/preflight，必须修正证据等级。
- 把 `README`/`docs/ARCHITECTURE` 中 DSH default、`~/.dsh` state、`dsh-patches` action 的描述更新为 adapter architecture；保留 DSH 安装章节作为单独 adapter 文档。
- 增加 adapter matrix：detect、compile、apply、verify、revert、activation、version drift、state migration，每项明确 `verified/experimental/unsupported/NOT_COVERED`。

## 验收门槛与未覆盖项

升级完成前应同时满足：

1. `core` 在不加载 DSH patch/ASAR 模块时可以 compile/apply/verify/revert 一个普通 adapter plan。
2. 新增宿主只需注册 adapter 和 profile/fixture，不修改 `core/contract.mjs` 的 host 数组、`core/executor.mjs` 的 DSH 分支或 CLI 的 DSH 默认分支。
3. 每个 applied plan 的 manifest 能列出 provider、宿主版本、目标 roots、before/after SHA、activation evidence，并能由对应 adapter verify/revert。
4. `hosts`、`profiles`、`compile`、`apply`、`status`、`doctor` 对同一 host 使用同一个 registry/adapter 实例和 context。
5. 每项 capability 同时有 declared、observed、effective 和 evidence；缺失 runtime 观测必须是 `unobservable/NOT_COVERED`。
6. DSH 现有 8 patch、ASAR unpack/rollback、Cordis prompt、session proof 测试继续通过，且其实现不再成为 core 的启动依赖。

本轮未覆盖真实 Claude Code、Codex CLI、Gemini CLI、OpenCode 安装及 session runtime；没有这些宿主的最小真实请求、版本和激活证据，不能把现有 `verified` profile 字段解读为端到端验证。
