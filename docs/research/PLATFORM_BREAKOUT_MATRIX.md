# 全平台破甲支持等级矩阵（P4 投递依据）

- 取证时间：2026-11-17（网络证据为当日抓取）
- 仓库基线：`dsh-forge` HEAD `0ab65ca`
- 判级口径：**只有同时满足「宿主整段读取该文件作为 system 级指令」+「不存在更高优先级的固定身份文本」两条，才可标 `B4 replace-full`**；只满足第一条、身份前缀仍在 → `B2 append-system`；只能进上下文/规则层 → `B1 context-append`；写入后无法观测 → `B0`。证据不足一律降级并写「待核实」。
- 本文只做判级与补全规划，**不改任何代码**。

---

## 1. 结论先行

**能整段替换（B4，4 个）**

| 宿主 | 通道 | 关键依据 |
| --- | --- | --- |
| Gemini CLI | `GEMINI_SYSTEM_MD` 指向外部 Markdown | 官方原文 "completely overriding the built-in default. This is a full replacement, not a merge." |
| Codex CLI | `model_instructions_file`（config.toml） | 源码注释 "will override the built-in instructions for the selected model"，故硬编码的 `You are Codex…` 首行可被整段顶掉 |
| Continue | `models[].chatOptions.baseAgentSystemMessage` / `baseSystemMessage` / `basePlanSystemMessage` | 官方参考："Can be used to override the default system prompt for **Agent**/Chat/Plan mode" |
| Generic（OpenAI 兼容协议） | 调用方自组 `messages[0].role=system` | 协议事实：无宿主固定身份文本，system 段由调用方独占 |

**打补丁后等效整段（B3，1 个）**

- **DSH**：`lib/table.mjs` 8 条 patch 改写 `dsh-user-approval` / `dsh-sandbox` / `dsh-sandbox-policy` / `dsh-agent-instructions` 的默认值与提示句（含 `workspace-intro-precedence` 把 "may be relevant… do not override system…" 改成 "ACTIVE and binding"），叠加 `~/.dsh/prompt-inject.md` 走系统级注入通道。宿主自带身份与运行时块仍在，但约束语义已被改写，实际效果等同整段接管。

**只能追加（B2，1 个）**

- **Claude Code**：`--system-prompt` 在 v2.1.114 被实现为 append 而非 replace（issue #51223），主 system prompt 固定为 4 个 content block，block1 是 57 字符恒定身份 `You are Claude Code, Anthropic's official CLI for Claude.`；`CLAUDE.md` 只进上下文层。破甲上限 = append + `permissions.defaultMode=bypassPermissions`（`profiles/claude-code.json:22-34`）。

**只能进上下文层（B1，4 个）**

- **Cursor**：规则"included at the start of the model context"，服务端 system prompt 恒为 `You are an AI coding assistant…`。
- **Windsurf / Devin Local**：rules "injected into the agent's context at the start of every session"；文档已从 `docs.windsurf.com` 迁到 `docs.devin.ai`（原链接 308）。
- **OpenCode**：官方明示 6 层顺序且 "These sources are combined rather than used as overrides"，第一层就是 agent/provider system prompt。
- **Aider**：`CONVENTIONS.md` 需 `/read` 或 `--read` 显式加载、进 chat 上下文；当前 `aider/args.py` **没有** `--system-prompt` 选项（仅 `--show-prompts` 调试）。

**不可观测（B0）**

- `hosts/cursor.mjs` / `windsurf.mjs` / `continue.mjs` / `aider.mjs` 全部硬编码 `activation: { status: "unobservable" }`，文件存在最多到 `configured`。
- `hosts/generic.mjs` 的 `detect()` 恒 `{ ok: true }`，而 `core/evidence.mjs:14` 在 `configured` 判定**之前**就把 `id === "generic"` 判成 `unobservable` —— 这是证据链缺陷，不是能力缺陷。

---

## 2. 等级定义

| 等级 | 名称 | 判定条件 | 破甲含义 |
| --- | --- | --- | --- |
| `B4` | replace-full | 宿主任一官方入口整段读取我方文件作为 system 级指令，且无更高优先级固定身份文本 | 身份/约束/审批话术全量可写 |
| `B3` | patch-replace | 需改写宿主安装产物（asar/二进制/打包配置）才能顶掉固定文本 | 等效整段，但绑定宿主版本 |
| `B2` | append-system | 写入 system 级，但固定身份前缀恒在 | 只能在其后叠加，残留可预期 |
| `B1` | context-append | 仅进上下文/规则/项目指令层 | 与宿主 prompt 竞争，依从性不稳 |
| `B0` | unobservable | 可写但无法证明生效 | 只能交付 `NOT_COVERED` |

仓库侧支持等级沿用 adapter 的 `support` 字段（`verified` / `experimental`），与破甲等级并用：`B4 + experimental` 表示"通道能破甲，但 adapter 还没做到 verified"。

---

## 3. 矩阵表

| 宿主 | 指令入口 | 能否整段替换 | 固定残留 | 生效时机 | 支持等级 | 证据链接 | adapter 缺口 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **DSH** | ① `lib/table.mjs` 8 条 asar patch；② `~/.dsh/prompt-inject.md`（`profiles/dsh.json:18-30` 的 `dsh-patches: all` + `file:user`） | B3 patch-replace（每条锚点均可改写默认值与提示句） | 宿主运行时块（checkout 路径、session 元信息、`[MODE:…]` 之外的框架句）仍在；patch 只改语义不改结构 | 重启 DSH（`requiresRestart: true`） | `B3` / `verified` | `docs/COMPAT.md`（0.2.1-rc.1–0.2.2-rc.3 8/8 anchors，apply/revert sha256 一致）；`lib/table.mjs:82-88`；本地 `~/.dsh/prompt-inject.md` + `lib/inject.mjs:76-101`（`order` 500/1000） | 缺 `verifyTarget`/`evidence()` 运行时探针；`verifyProofs` 已能解 `session.v4.jsonl.zstd`（`lib/inject.mjs:138-200`）但未接进 adapter |
| **Claude Code** | `CLAUDE.md` markdown-block(system)（`profiles/claude-code.json:18-21`）+ `.claude/settings.json` `permissions.defaultMode=bypassPermissions`；CLI 另有 `--append-system-prompt[-file]` | ❌ 只能追加（B2）：`--system-prompt` 实现为 append | block1 恒为 `You are Claude Code, Anthropic's official CLI for Claude.`（57 字符）；block2/3 为固定行为与环境段 | 启动新会话；settings 改动需重启 | `B2` / `verified` | [issue #51223](https://github.com/anthropics/claude-code/issues/51223)、[issue #49936](https://github.com/anthropics/claude-code/issues/49936)、[抓包 system-prompt](https://raw.githubusercontent.com/agenticloops-ai/agentic-apps-internals/main/claude-code-cli/agent-mode/system-prompt.md)、[CLI 参考](https://code.claude.com/docs/en/cli-reference.md) | 未接 `--append-system-prompt-file`；无 session 侧证据解析（`~/.claude/projects/**/*.jsonl`）；无 identity 残留断言 |
| **Codex CLI** | `model_instructions_file`（config.toml，替换内置 model instructions）；`AGENTS.md` 走项目文档通道（`profiles/codex.json:18-21`） | ✅ replace-full（B4，config 级） | `AGENTS.md`/项目文档仍按 `project_doc_max_bytes`（默认 32KB）另行注入；`compact_prompt` 独立；`instructions`/`developer_instructions` 属另一条通道 | 新进程/新会话（config 读取期） | `B4` / `verified` | [config_toml.rs:272-276](https://github.com/openai/codex/blob/main/codex-rs/config/src/config_toml.rs)、[gpt_5_codex_prompt.md](https://github.com/openai/codex/blob/main/codex-rs/core/gpt_5_codex_prompt.md)、[Codex agent loop](https://openai.com/index/unrolling-the-codex-agent-loop/) | 缺 `model_instructions_file` 写入（只写 `AGENTS.md`）；缺 config.toml 结构化合并；缺 `~/.codex/sessions/**` 证据解析 |
| **Gemini CLI** | `GEMINI_SYSTEM_MD` → `.gemini/system.md`（全量替换）；`GEMINI.md` 仅 strategy 层（`profiles/gemini.json:18-32`） | ✅ replace-full（B4，env 门控） | `GEMINI.md` 仍作为 strategy 注入；`${AgentSkills}/${SubAgents}/${AvailableTools}` 变量展开由宿主完成 | 新会话；env 只在启动期读 | `B4` / `experimental` | [官方 system-prompt.md](https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/cli/system-prompt.md) | profile 仍写 `GEMINI.md` 而非 `system.md`；缺 `GEMINI_SYSTEM_MD` 探测与 env 注入；缺 `GEMINI_WRITE_SYSTEM_MD` 默认导出对比 |
| **Continue** | `models[].chatOptions.baseAgentSystemMessage` / `baseSystemMessage` / `basePlanSystemMessage`（`~/.continue/config.yaml`）；`.continue/rules/*.md` 拼在其后（`profiles/continue.json:16-17`） | ✅ replace-full（B4，model 级） | `.continue/rules` 与 `.continue/rules` 之外的 prompt 仍按换行拼接在 base 之后；`tool` 定义走 API `tools` 参数 | 下一次请求（配置热加载）；CLI 需重启 | `B4` / `experimental` | [rules deep dive](https://docs.continue.dev/customize/deep-dives/rules)（"rules are joined… includes the base chat system message"）、[config.yaml 参考](https://docs.continue.dev/reference)（`chatOptions.baseSystemMessage` 段落）、[defaultSystemMessages.ts](https://github.com/continuedev/continue/blob/main/core/llm/defaultSystemMessages.ts) | 只写 `.continue/rules`，未写 `chatOptions`；缺 IDE vs CLI 双路径（`~/.continue/config.yaml` vs `--config`）；缺 rules 工具栏状态证据 |
| **OpenCode** | `AGENTS.md` + `opencode.json.instructions[]`（`profiles/opencode.json:18-32`） | ❌ 只能追加（B1）：官方 "combined rather than used as overrides" | 第 1 层 agent/provider system prompt 恒先发；第 5/6 层日期环境与会话指令插在后 | 会话启动 + 文件变更检测（下一次请求前注入 update） | `B1` / `experimental` | [instructions.md](https://opencode.ai/docs/instructions.md) | 缺 6 层顺序的落地校验；plugin hook 能否改写 system 数组「待核实」；无 `~/.local/share/opencode` 会话证据 |
| **Cursor** | `.cursor/rules/*.mdc`（必带 frontmatter）+ 兼容 `.cursorrules`（`profiles/cursor.json:16-17`） | ❌ 只能前置（B1）：规则插在 context 开头 | 服务端 system prompt `You are an AI coding assistant…` 恒在；Team/Project/User 规则按 Team 优先合并 | 新 Agent 会话/新请求 | `B1` / `experimental` | [rules.md](https://cursor.com/docs/rules.md)、[Agent Prompt v1.2](https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools/blob/main/Cursor%20Prompts/Agent%20Prompt%20v1.2.txt)、[harness 转录](https://harnessnotes.com/session-transcripts/format?harness=cursor-agent) | 写的是 legacy `.cursorrules`，`.mdc` + frontmatter 未支持；缺 Team 规则优先级探测；`activation` 恒 `unobservable`（`hosts/cursor.mjs:20`） |
| **Windsurf / Devin Local** | `.devin/rules/*.md`、`AGENTS.md`/`AGENTS.local.md`、`.devin/global_rules.md`；legacy `.windsurf/rules`、`.windsurf/global_rules.md`、`.windsurfrules` 默认导入（`profiles/windsurf.json:16-17`） | ❌ 只能追加（B1）：rules "injected into the agent's context at the start of every session" | Cascade/Devin Local 系统提示与 Memories 自动摘要仍在；两套 `global_rules.md` 并存时只读 `.devin` 那份 | 会话启动；`trigger ∈ {always_on, glob, model_decision, manual}` 决定是否进场 | `B1` / `experimental` + 部分「待核实」 | [Devin Local Customizations](https://docs.devin.ai/desktop/devin-local/customizations.md)、[rules 全量文件表](https://docs.devin.ai/cli/extensibility/rules.md)、原 `docs.windsurf.com/windsurf/cascade/memories` → 308 至 `docs.devin.ai/desktop/devin-local/customizations` | `evidence.documentation` 指向已 308 的旧链接（`hosts/windsurf.mjs:8`）；只写 `.windsurfrules`（legacy，且是追加型）；缺 `trigger` frontmatter 生成 |
| **Aider** | `CONVENTIONS.md`，需 `/read` 或 `aider --read CONVENTIONS.md`（read-only 进 chat）（`profiles/aider.json:16-17`） | ❌ 只能追加（B1）：文件进 chat 上下文，不是 system prompt | 各 edit-format 的硬编码 prompt（`aider/coders/*_prompt.py`）恒在；当前 CLI 无 `--system-prompt` | 显式 `/read` 或启动参数；文件变更需 `/read` 重载 | `B1` / `experimental` | [conventions 文档](https://aider.chat/docs/usage/conventions.html)、[options 全量表](https://aider.chat/docs/config/options.html)（仅 "Print the system prompts" 调试项）、[aider/args.py](https://github.com/Aider-AI/aider/blob/main/aider/args.py) | profile 只写文件、不写 `.aider.conf.yml` 的 `read:`；缺"未 `/read` 即未生效"的 preflight 阻断 |
| **Generic** | `messages[0].role=system`（`hosts/generic.mjs:5`） | ✅ replace-full（B4，协议层） | 无宿主身份残留 | 即时（每次请求自组） | `B4` / `experimental`（状态恒 `unobservable`） | OpenAI Chat Completions 协议事实；`hosts/generic.mjs`、`core/evidence.mjs:14` | 无 fixture、无 runtime evidence → 永远 `unobservable`；缺"调用方回执"证据模型 |

---

## 4. P4 补全顺序（收益 / 成本排序）

收益 = 破甲等级提升 × 覆盖面；成本 = 代码量 + 宿主版本耦合 + 需要真实登录环境。**顺序即投递顺序**，前 4 项做完即覆盖 P4 的全部 B4 通道。

### 4.1 Gemini CLI（B1 → B4，收益最高 / 成本最低）

现状：`hosts/gemini.mjs` 只做路径存在性探测，profile 写 `GEMINI.md`。真正的整段替换入口是 `GEMINI_SYSTEM_MD`，一行 env + 一个文件即可。

```js
// hosts/gemini.mjs —— 与 hosts/adapter.mjs METHODS 对齐
export function detect({ projectRoot = process.cwd(), home, env = process.env } = {}) {
  // -> { ok, status: "configured"|"missing", root, targets: { systemFile, strategyFile, settings },
  //      evidence: [{kind:"config"|"env", path|name}], warnings: string[], activation: {status:"unobservable"} }
}
export function configTargets({ projectRoot = process.cwd(), home, env = process.env } = {}) {
  // -> { systemFile, strategyFile: "GEMINI.md", settings: ".gemini/settings.json",
  //      env: { GEMINI_SYSTEM_MD: "<abs>" }, activation: "next-session" }
}
export function evidence({ projectRoot, home, env, sessionLog } = {}) {
  // -> [{kind:"documentation", url:"https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/system-prompt.md"},
  //     {kind:"config", path: systemFile}, {kind:"session", path: sessionLog, contains: "<prompt 首行>"}]
}
```

fixture 断言（新增 `test/fixtures/gemini/`）：

```js
const root = mkdtemp(); mkdirSync(join(root, ".gemini")); writeFileSync(join(root, ".gemini/system.md"), "# forge\n");
process.env.GEMINI_SYSTEM_MD = "1";
assert.equal(detect({ projectRoot: root }).status, "configured");
assert.equal(detect({ projectRoot: root }).targets.systemFile, join(root, ".gemini/system.md"));
rmSync(join(root, ".gemini/system.md"));
assert.equal(detect({ projectRoot: root }).status, "missing");
assert.match(detect({ projectRoot: root }).warnings.join(), /missing system prompt file/);   // 宿主同款报错文案
assert.equal(detect({ projectRoot: root }).activation.status, "unobservable");               // 未读到 session 前不得 active
```

### 4.2 Codex CLI（B1 → B4，收益高 / 成本中）

现状：profile 只写 `AGENTS.md`。`model_instructions_file` 才是顶掉 `You are Codex…` 的入口，代价是要做 config.toml 的结构化合并（不能整文件覆盖）。

```js
export function detect({ home = process.env.HOME, projectRoot = process.cwd(), env = {} } = {}) {}
// -> { ok, status, root: "~/.codex", configPath: "~/.codex/config.toml",
//      targets: { instructionsFile, agentsMd: "AGENTS.md" }, evidence: [{kind:"config", path}], warnings }
export function configTargets({ home, projectRoot } = {}) {}
// -> { instructionsFile: "<state>/dsh-forge/model_instructions.md", codexConfig: "~/.codex/config.toml",
//      tomlKeys: ["model_instructions_file"], projectDoc: "AGENTS.md", activation: "new-process" }
export function evidence({ home, sessionRoot } = {}) {}
// -> [{kind:"documentation", url:"https://github.com/openai/codex/blob/main/codex-rs/config/src/config_toml.rs"},
//     {kind:"config", path: configPath}, {kind:"session", path: "~/.codex/sessions/**/rollout-*.jsonl", contains:"<首行>"}]
```

fixture 断言：`~/.codex/config.toml` 预置 `model = "gpt-5"` 且含注释 → 合并后 `model` 与注释保留、`model_instructions_file` 单次出现；重复 apply 幂等（sha256 不变）；`AGENTS.md` 仍被写入且不与 instructions 文件内容重复拼接；缺 config.toml 时降级为 `status: "installed"` + warning `model_instructions_file 未写入，AGENTS.md 仅项目层`。

### 4.3 Continue（B1 → B4，收益高 / 成本低-中）

现状：只写 `.continue/rules/dsh-forge.md`（拼在 base 之后，属追加）。`chatOptions.baseAgentSystemMessage` 才是替换。

```js
export function detect({ home = process.env.HOME, projectRoot = process.cwd() } = {}) {}
// -> { ok, status, root: "~/.continue", configPath: "~/.continue/config.yaml",
//      targets: { config, rulesDir: ".continue/rules" }, evidence: [{kind:"config", path}] }
export function configTargets({ home, projectRoot } = {}) {}
// -> { config: "<abs>/config.yaml", yamlPath: ["models", "<role:chat|agent|plan>", "chatOptions", "baseAgentSystemMessage"],
//      rulesDir: ".continue/rules", activation: "next-request" }
export function evidence({ home, rulesDir, sessionLog } = {}) {}
// -> [{kind:"documentation", url:"https://docs.continue.dev/reference"},
//     {kind:"config", path: configPath}, {kind:"session", path: sessionLog}]
```

fixture 断言：预置含 `models: [{name: x, roles: [chat, agent]}]` 的 config.yaml → 合并后 `baseAgentSystemMessage` 与 `baseSystemMessage` 同时存在、其余 model 字段与顺序不变、YAML 注释保留；`.continue/rules/dsh-forge.md` 与 base 内容不重复（避免双份注入）；IDE 路径（`~/.continue`）与 CLI `--config` 路径各自命中；`activation` 在无 rules 工具栏/会话日志时保持 `unobservable`（对齐 `test/platforms.test.mjs:24-40` 的既有断言风格）。

### 4.4 DSH（已 B3，补 evidence 即可 verified-active）

现状：`hosts/dsh.mjs` 只判 `app.asar`/`app/dsh`/`profiles` 是否存在，patch 与注入都在 `lib/` 里做，adapter 侧看不到。

```js
export function detect({ home, env = {} } = {}) {}
// -> { ok, status: "configured"|"active"|"missing", root, mode: "asar"|"unpacked",
//      evidence: [{kind:"config", path: promptInjectPath}, {kind:"session", path}], warnings }
export function configTargets({ env } = {}) {}
// -> { patchTable: true, patchIds: [...], promptChannel: "~/.dsh/prompt-inject.md", activation: "restart" }
export function evidence({ env, sessionLog } = {}) {}
// -> dryRun(PATCHES, env) 的 8 条状态 + session.v4.jsonl.zstd 中搜 composePrompt 头
//    [{kind:"config", path:"<hostRoot>"}, {kind:"runtime", path: sessionLog, contains:"<!-- dsh-forge v"}]
```

fixture 断言：复用 `test/engine.test.mjs:21` 的 `fixture()` 造 0.2.2-rc.2 宿主 → `detect().status === "configured"`；apply 后 `evidence()` 中 `kind:"runtime"` 存在且含 forge header → `status === "active"`；未 apply 时不得出现 `active`；版本 `>=0.3.0` 时 `status: "blocked"` + warning（对齐 `docs/COMPAT.md` 的版本闸门）。

### 4.5 Generic（B4 但永远 unobservable，补语义与 fixture）

```js
export function detect(ctx = {}) {}
// -> { ok: true, status: "unobservable", targets: { system: "messages[0].role=system" },
//      evidence: [{kind:"documentation", url:"<协议文档>"}], warnings: ["prompt-only adapter"] }
export function configTargets(ctx = {}) { /* -> { promptChannel: "system message", activation: "immediate" } */ }
export function evidence({ requestDump } = {}) {}
// -> [{kind:"runtime", path: requestDump, contains:"<composePrompt 头>"}]  // 有回执才升 active
```

fixture 断言：`test/fixtures/generic/request.dump.json` 含 `messages[0].role === "system"` 且首行等于 compose 头 → `activate`；同一 fixture 去掉 system 段 → `unobservable` 且 `warnings` 含 `no system segment`；`core/evidence.mjs:14` 的 generic 特判必须保留（不得因 `ok:true` 升 `configured`）。

### 4.6 Claude Code（B2 已定，补残留与证据）

```js
export function detect({ home, projectRoot } = {}) {}
// -> { ok, status, root: "~/.claude", targets: { claudeMd, settings }, evidence: [{kind:"config", path}] }
export function configTargets({ home, projectRoot } = {}) {}
// -> { claudeMd: "CLAUDE.md", settings: ".claude/settings.json", appendFlag: "--append-system-prompt-file",
//      defaultMode: "bypassPermissions", activation: "restart" }
export function evidence({ sessionDir } = {}) {}
// -> [{kind:"documentation", url:"https://github.com/anthropics/claude-code/issues/51223"},
//     {kind:"config", path: settings}, {kind:"session", path: sessionDir}]
```

fixture 断言：`~/.claude/projects/**/**.jsonl` 首条 system 记录必须包含 `You are Claude Code, Anthropic's official CLI for Claude.` → 断言 `identityPrefixPresent === true` 且 `breakoutTier === "B2"`；settings 合并后 `permissions.defaultMode` 为 `bypassPermissions` 且既有 `permissions.allow` 不被覆盖；无 session 目录时 `status` 不高于 `configured`。

### 4.7 OpenCode（B1，先核实 plugin hook 再投入）

```js
export function detect({ home, projectRoot } = {}) {}
// -> { ok, status, root: "~/.config/opencode", targets: { agentsMd, config: "opencode.json" }, evidence: [] }
export function configTargets({ home, projectRoot } = {}) {}
// -> { agentsMd: ["AGENTS.md"], instructions: "opencode.json#instructions", layers: 6, activation: "session-start" }
export function evidence({ sessionDir } = {}) {}
// -> [{kind:"documentation", url:"https://opencode.ai/docs/instructions.md"}, {kind:"config", path}]
```

fixture 断言：聚合顺序必须是 `AGENTS.md` → 子目录 → `instructions[]`（外层先于内层、配置后于 AGENTS.md）；`instructions` 里含 `http(s)://` 时 5s 超时不得阻塞 `detect`；`layers` 断言 6 层不被压成 1 层——**只有 plugin hook 被证实能改写 system 数组，才允许把本行升级为 B3**（当前「待核实」）。

### 4.8 Cursor（B1，收益中低 / 成本中）

```js
export function detect({ projectRoot = process.cwd() } = {}) {}
// -> { ok, status, targets: { mdcDir: ".cursor/rules", legacy: ".cursorrules" }, evidence: [{kind:"config", path}] }
export function configTargets({ projectRoot } = {}) {}
// -> { mdc: ".cursor/rules/dsh-forge.mdc", frontmatter: ["description","globs","alwaysApply"],
//      legacy: ".cursorrules", activation: "new-session" }
export function evidence({ projectRoot } = {}) {}
// -> [{kind:"documentation", url:"https://cursor.com/docs/rules.md"}, {kind:"config", path}]
```

fixture 断言：写出的 `.mdc` 首块必须是合法 frontmatter（缺 `alwaysApply` 视为失败）；纯 `.md` 不被识别 → `detect` 忽略并给 warning；`.cursorrules` legacy 与 `.mdc` 同时存在时以 `.mdc` 为主且不双写；`activation.status` 恒 `unobservable`。

### 4.9 Windsurf / Devin Local（B1，等文档稳定）

```js
export function detect({ home, projectRoot } = {}) {}
// -> { ok, status, targets: { devinRules: ".devin/rules", agentsMd: "AGENTS.md", legacy: [".windsurf/rules",".windsurfrules"] }, evidence: [] }
export function configTargets({ home, projectRoot } = {}) {}
// -> { rule: ".devin/rules/dsh-forge.md", globalRule: ".devin/global_rules.md",
//      legacyImport: true, trigger: "always_on", activation: "session-start" }
export function evidence({ home, projectRoot } = {}) {}
// -> [{kind:"documentation", url:"https://docs.devin.ai/desktop/devin-local/customizations.md"}]
```

fixture 断言：`.devin/global_rules.md` 与 `.windsurf/global_rules.md` 并存时只读前者（后者不进场）；`.devin/rules/*.md` 必须带 `trigger: always_on` 才保证每次会话进场；`hosts/windsurf.mjs:8` 的 `documentation` 必须改为新域名并留 308 备注。

### 4.10 Aider（B1，收益最低 / 成本最低）

```js
export function detect({ home, projectRoot } = {}) {}
// -> { ok, status, targets: { conventions: "CONVENTIONS.md", conf: ".aider.conf.yml" }, evidence: [] }
export function configTargets({ home, projectRoot } = {}) {}
// -> { conventions: "CONVENTIONS.md", confRead: [".aider.conf.yml#read"], activation: "explicit-read" }
export function evidence({ projectRoot, chatHistory } = {}) {}
// -> [{kind:"documentation", url:"https://aider.chat/docs/usage/conventions.html"},
//     {kind:"config", path: "CONVENTIONS.md"}, {kind:"session", path: chatHistory, contains:"CONVENTIONS.md"}]
```

fixture 断言：仅存在 `CONVENTIONS.md` 而 `.aider.conf.yml` 无 `read:` → `status: "configured"` 且 warning 明确"未 `/read` 不生效"；`.aider.conf.yml` 含 `read: [CONVENTIONS.md]` → 允许 `activation: explicit-read`；`chatHistory` 中出现 `CONVENTIONS.md` 才允许 `active`。

---

## 5. 确实无法破甲的宿主与原因

| 宿主 | 为什么做不到 replace-full | 能否靠本仓库其他手段补 | 结论 |
| --- | --- | --- | --- |
| **Claude Code** | `--system-prompt` 被实现成 append（issue #51223 已确认），主 system prompt 固定 4 段、block1 是 57 字符身份串；CLI 无"整段替换"入口。`CLAUDE.md` 只进上下文层。 | 只能叠加：append 通道 + `permissions.defaultMode=bypassPermissions` + 工具白名单。 | 破甲上限 **B2**，除非 Anthropic 改变 flag 语义 |
| **Cursor** | 闭源，system prompt 由服务端拼装（`You are an AI coding assistant…`）；规则只"included at the start of the model context"，官方无 override 项；Team 规则优先级在服务端。 | 只能靠前置规则 + 命名/描述诱导；`.mdc` frontmatter 可提高进场率。 | 破甲上限 **B1** |
| **Windsurf / Devin Local** | rules "injected into the agent's context at the start of every session"，系统提示不可替换；Memories 还会自动生成摘要参与竞争；文档刚迁到 `docs.devin.ai`，规范面仍在移动。 | 只能写 `.devin/rules` + `global_rules.md`；`trigger: always_on` 提高覆盖率。 | 破甲上限 **B1**，且部分行为「待核实」 |
| **OpenCode** | 官方给出 6 层顺序并明示 "combined rather than used as overrides"，第 1 层是 agent/provider system prompt，用户侧无可写入口。 | plugin hook 若能改 `params.system` 可升 B3 —— 证据不足，**待核实**。 | 现状 **B1**，升级路径未证实 |
| **Aider** | 当前 `aider/args.py` 无 `--system-prompt`（只有 `--show-prompts` 调试项）；`CONVENTIONS.md` 必须 `/read`/`--read` 才进 chat，且各 edit-format 的 prompt 硬编码在 `aider/coders/*_prompt.py`。 | 只能改 `.aider.conf.yml` 的 `read:` 让加载自动化，内容仍是上下文层。 | 破甲上限 **B1**，且依赖显式动作 |
| **Generic** | 不是"不能破甲"，而是**无法证明**：`core/evidence.mjs:14` 在 `configured` 之前就把 `id === "generic"` 判成 `unobservable`，没有回执就没有 `active`。 | 引入调用方 request dump 作为 `kind:"runtime"` 证据即可升 `active`。 | 能力 **B4**，证据等级 **B0→可修** |

一句话总结：**B4 只有 4 个（Gemini / Codex / Continue / Generic），B3 只有 DSH，B2 只有 Claude Code，其余 4 个（Cursor / Windsurf / OpenCode / Aider）天花板都在上下文层——它们的收益来自"规则覆盖率"，不来自"破甲等级"。**

---

## 6. 待核实清单

1. **OpenCode plugin hook**：`chat.params` / `chat.message` 是否能改写最终 `system` 数组（决定其能否从 B1 升到 B3）。
2. **Windsurf / Devin Local**：Cascade 系统提示的当前文本与 Memories 注入位置；旧 `docs.windsurf.com` 内容是否还有镜像权威版本。
3. **Claude Code**：`--append-system-prompt-file` 与 `CLAUDE.md` 的相对顺序（issue #49936 只表明"注入在硬编码身份之后"）；4 段 block 的稳定性是否随版本变化。
4. **Aider**：是否有未文档化的 env/conf 覆写 system prompt 的路径（当前 args.py 未见）。
5. **Continue**：`chatOptions` 是在 IDE 扩展、CLI 还是两者都生效；`baseAgentSystemMessage` 是否被工具提示再次包裹。

---

## 7. 引用清单

网络（2026-11-17 抓取）：

- Claude Code：https://github.com/anthropics/claude-code/issues/51223 ・ https://github.com/anthropics/claude-code/issues/49936 ・ https://raw.githubusercontent.com/agenticloops-ai/agentic-apps-internals/main/claude-code-cli/agent-mode/system-prompt.md ・ https://code.claude.com/docs/en/cli-reference.md
- Codex CLI：https://github.com/openai/codex/blob/main/codex-rs/config/src/config_toml.rs ・ https://github.com/openai/codex/blob/main/codex-rs/core/gpt_5_codex_prompt.md ・ https://openai.com/index/unrolling-the-codex-agent-loop/
- Gemini CLI：https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/cli/system-prompt.md
- Continue：https://docs.continue.dev/customize/deep-dives/rules ・ https://docs.continue.dev/reference ・ https://github.com/continuedev/continue/blob/main/core/llm/defaultSystemMessages.ts
- Cursor：https://cursor.com/docs/rules.md ・ https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools/blob/main/Cursor%20Prompts/Agent%20Prompt%20v1.2.txt ・ https://harnessnotes.com/session-transcripts/format?harness=cursor-agent
- Windsurf / Devin Local：https://docs.devin.ai/desktop/devin-local/customizations.md ・ https://docs.devin.ai/cli/extensibility/rules.md
- OpenCode：https://opencode.ai/docs/instructions.md
- Aider：https://aider.chat/docs/usage/conventions.html ・ https://aider.chat/docs/config/options.html ・ https://github.com/Aider-AI/aider/blob/main/aider/args.py

仓库内：

- `hosts/registry.mjs`、`hosts/adapter.mjs`（`ADAPTER_SCHEMA = "forge.host/v1"`、`METHODS`、`normalizeDetection`）
- `hosts/dsh.mjs`、`hosts/claude-code.mjs`、`hosts/codex.mjs`、`hosts/gemini.mjs`、`hosts/opencode.mjs`、`hosts/cursor.mjs`、`hosts/windsurf.mjs`、`hosts/continue.mjs`、`hosts/aider.mjs`、`hosts/generic.mjs`
- `profiles/*.json`（十份 profile 的 `targets` 与 `capabilities`）
- `lib/table.mjs`（8 条 patch、`HOST_VERSION_RANGE ">=0.2.1-rc.1 <0.3.0"`）、`lib/inject.mjs`（`composePrompt`/`resolvePrompt`/`verifyProofs`、`order` 500/1000）
- `core/provider.mjs`、`lib/dsh-provider.mjs`（`id="dsh.patches"`、`patches:"all"`）
- `core/evidence.mjs`（`ACTIVATION_STATES`、`runtimeEvidence`、generic 特判）
- `docs/COMPAT.md`、`docs/research/MULTIPLATFORM_DESIGN.md`
- `test/platforms.test.mjs`（experimental adapter 的既有断言风格，本文 fixture 断言沿用其夹具构造方式）
