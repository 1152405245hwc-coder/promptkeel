# dsh-forge

[English](README.md)

[![CI](https://img.shields.io/badge/CI-Node%2020+-000?style=flat-square)](#验证与质量门禁)
[![License: MIT](https://img.shields.io/badge/License-MIT-000?style=flat-square)](LICENSE)
[![Runtime Dependencies: 0](https://img.shields.io/badge/Runtime%20Deps-0-000?style=flat-square)](package.json)

**面向 DeepSeek Harness (DSH)、Claude Code、Codex CLI、Gemini CLI、OpenCode、Cursor、Windsurf、Aider、Continue 及本地开源权重运行时的提示词注入、声明式宿主补丁与确定性多平台 Profile 编译器。**

```text
┌────────────┐   compose    ┌──────────────┐   section    ┌───────────────┐
│ prompt/    │ ───────────▶ │ lib/inject   │ ───────────▶ │ DSH 系统提示  │
│ core+mode  │              │ 预算+哈希    │              │ (forge:prompt)│
└────────────┘              └──────────────┘              └───────────────┘
┌────────────┐   dry-run    ┌──────────────┐   backup     ┌───────────────┐
│ table.mjs  │ ───────────▶ │ lib/engine   │ ───────────▶ │ 宿主文件与    │
│ 15 条补丁   │              │ 校验+原子写  │              │ manifest 备份 │
└────────────┘              └──────────────┘              └───────────────┘
```

![dsh-forge panel](docs/ui-preview.png)

---

## 为什么选择 `dsh-forge`

| 维度 | 传统社区补丁包做法 | `dsh-forge` 工程化方案 |
| :--- | :--- | :--- |
| **宿主补丁收敛面** | 80+ 条散落在压缩前端与运行时的字符串替换，宿主小版本更新即失锚 | **仅保留 15 条核心锚点补丁**（覆盖 10 个 `@deepseek-ai/*` 文件），支持多版本区间 `variants` |
| **提示词组合机制** | 单一超长硬编码提示词或手工改写会话记录 | `core + model/adapter + host + mode` 分层组合（默认约 693 tokens），内置 3200 tokens 预算门禁与 `sha256` 头部标识 |
| **可验证性** | 仅展示前端状态开关 | 3 项运行时证明（`proof1-patches`、`proof2-prompt`、`proof3-session` 会话日志校验）+ 12 项 `doctor` 诊断 |
| **管理面板体积** | 650+ KB 外部打包产物 | **15 KB 零运行时依赖侧栏面板**（涵盖总览、补丁、提示词、策略、日志） |
| **备份与事务回滚** | 单文件 `.bak` 覆盖，缺乏版本与篡改保护 | 每次执行生成独立 `manifest.json` + 原始文件 `sha256` + `hostVersion` 防降级覆盖校验 + 符号链接拒绝（`lstatSync`） |
| **跨宿主可移植性** | 绑定单一宿主 | Adapter registry + 纯函数编译器 + 事务执行器，一套提示词与策略可编译至 10 类宿主 |

---

## 项目架构与目录结构

`dsh-forge` 采用双层解耦架构，共享统一的 CLI 入口与模块化提示词库：

1. **跨宿主编译器与事务执行器（`core/`、`hosts/`、`profiles/`、`models/`）**：负责 Schema 校验、多层提示词渲染、生成与机器路径无关的 `planId` 执行计划，并以受管区块或键值合并方式写入各宿主标准配置文件。
2. **DeepSeek Harness 原生治理引擎（`lib/`、`client/`）**：负责 `app.asar` 只读解析与原子解包、15 条版本门控补丁（`lib/table.mjs`）的合并原子写入、Cordis `forge:prompt` 段落注册，以及本地回环 `/dsh-forge/api` 管理接口。

```text
dsh-forge/
├── bin/
│   └── dsh-forge.js        # 统一 CLI 入口（涵盖 DSH 原生命令与跨宿主治理命令）
├── core/                   # 宿主无关编译器与事务执行器
│   ├── contract.mjs        # profiles/*.json 与 models/*.json 的 Schema 校验与加载器
│   ├── capabilities.mjs    # 能力矩阵（prompt, approval, sandbox, tools, rollback）与预检
│   ├── prompt.mjs          # 确定性多层提示词渲染器与中英混合 Token 估算器
│   ├── compile.mjs         # 纯函数编译器：(profile, model, mode) -> 机器无关执行计划
│   ├── executor.mjs        # 事务写入器（mergeBlock, mergeJson, mergeToml, 备份与回滚）
│   ├── batch.mjs           # 多平台批量编译/应用、冲突检查与补偿回滚
│   ├── verify.mjs          # 计划内部哈希校验与执行后目标文件完整性校验
│   ├── profile.mjs         # 面向外部调用的契约导出门面
│   └── errors.mjs          # 结构化异常 ForgeError 与稳定机器可读错误码
├── hosts/                  # 各宿主环境探测器与配置槽位描述符
│   ├── registry.mjs        # 宿主注册表（detectHost, detectAll）
│   └── *.mjs               # dsh, claude-code, codex, gemini, opencode, generic, cursor, windsurf, aider, continue
├── profiles/               # 十个已注册宿主的声明式 Profile 清单
├── models/                 # 模型族元数据与提示词绑定（deepseek, claude, gpt, gemini, qwen, local）
├── prompt/                 # 模块化提示词源
│   ├── core.md             # 核心执行准则（任务分流、边界处理、A-D 证据分级）
│   ├── adapters/           # DSH 运行时适配器（deepseek, generic）
│   ├── hosts/              # 各宿主运行环境微调层
│   ├── models/             # 各模型族行为微调层
│   └── modes/              # 任务模式微调层（coding, research, writing）
├── lib/                    # DSH 原生运行时、ASAR 解包器、补丁引擎与 Cordis 插件
│   ├── table.mjs           # 15 条版本门控宿主补丁定义（支持多版本 variants）
│   ├── engine.mjs          # inspectPatch, dryRun, 按文件合并原子 apply, revert, upgrade
│   ├── asar.mjs            # app.asar 只读头部/文件读取器与原子解包器
│   ├── inject.mjs          # DSH 提示词组合、预算校验、会话日志三阶段证明校验
│   ├── doctor.mjs          # 12 项宿主路径、版本、补丁、预算、冲突与启用顺序诊断
│   ├── preset.mjs          # Workspace 策略（strict/fallback/always）与 bundles 顺序管理
│   ├── paths.mjs           # 路径解析、隐私路径脱敏、符号链接防护与原子写文件工具
│   ├── log.mjs             # 按日切分的 JSONL 结构化日志
│   └── index.js            # Cordis 插件入口、/forge 斜杠命令与回环 /dsh-forge/api 路由
├── client/                 # DSH 侧栏管理面板
│   ├── src/entry.js        # 零依赖 React.createElement 侧栏源码
│   ├── client.js           # DSH 模块加载器打包产物（由 scripts/build-client.mjs 生成）
│   └── preview/index.html  # 独立静态预览页面
├── scripts/                # 前端构建、Profile 冒烟测试、全量验证与隐私扫描脚本
├── tools/                  # 可选离线 Python 工具（tools/abliterate 权重正交化、tools/eval 评测）
├── test/                   # Node.js 内置测试套件（覆盖 core, engine, inject, security, api, asar, e2e）
└── docs/                   # 架构、补丁表、兼容性、排障、设计权衡与跨宿主可移植性文档
```

---

## 跨宿主方案

DSH 是原生且能力最完整的目标宿主；同一套分层提示词与事务回滚模型可编译到其他主流 AI 编程助手，无需修改对方压缩后的运行时代码：

| 宿主 | Profile | 写入位置 | 支持级别 |
| :--- | :--- | :--- | :--- |
| **DSH (macOS / Linux / Windows)** | `dsh` | 15 条 JS 补丁（`@deepseek-ai/*`）+ `~/.dsh/prompt-inject.md` | `verified` |
| **Claude Code** | `claude-code` | `CLAUDE.md`（受管区块）+ `.claude/settings.json` | `verified` |
| **Codex CLI** | `codex` | `AGENTS.md`（受管区块，仅当前项目） | `verified` |
| **Gemini CLI** | `gemini` | `GEMINI.md`（受管区块）+ `.gemini/settings.json` | `experimental` |
| **OpenCode** | `opencode` | `AGENTS.md`（受管区块）+ `opencode.json` | `experimental` |
| **Cursor** | `cursor` | `.cursorrules`（legacy 受管区块） | `experimental` |
| **Windsurf** | `windsurf` | `.windsurfrules`（legacy 受管区块） | `experimental` |
| **Aider** | `aider` | `CONVENTIONS.md`（受管区块） | `experimental` |
| **Continue** | `continue` | `.continue/rules/dsh-forge.md`（受管区块） | `experimental` |
| **通用 API / 本地权重** | `generic` | 仅输出合成后的 system prompt（`prompt-only`） | `experimental` |

```bash
# 1. 纯编译：不触碰任何宿主文件，生成确定性执行计划
node bin/dsh-forge.js compile claude-code --model claude --mode coding --out /tmp/plan.json

# 2. 保存目标文件预览（不加 --yes 不会写入磁盘）
node bin/dsh-forge.js apply --profile codex --dry-run --preview /tmp/forge-preview.json

# 3. 仅在预览文件的 SHA-256 仍匹配时应用
node bin/dsh-forge.js apply --profile codex --yes --preview /tmp/forge-preview.json
node bin/dsh-forge.js plans
node bin/dsh-forge.js verify-plan <plan-id>
node bin/dsh-forge.js revert-plan <plan-id>
```

所有 Profile 均通过 `core/contract.mjs` 校验。Profile 还声明 `risk`、`mutatesHost`、`requiresRestart` 与 `activationEvidence`，用于说明操作影响和验收证据，不会静默改变现有高权限行为。可先执行 `apply --dry-run --preview /tmp/forge-preview.json`，审阅后再用同一个文件配合 `--yes`；若目标文件在预览后发生变化，工具会拒绝覆盖。能力矩阵与 Schema 规范详见 [docs/PORTABILITY.md](docs/PORTABILITY.md)。

多平台编排可使用 `core/batch.mjs` 导出的 `compileMany()` 与**实验性、显式 opt-in 的** `applyBatch()`：计划会稳定排序，同一目标的冲突写入会被拒绝；批量写入必须提供持久化预览并显式传入 `allowExperimental: true`。当前没有稳定的批量 CLI，也没有完整的批量 verify/revert 生命周期；CLI 单 Profile 命令仍是受支持路径。

---

## DeepSeek Harness (DSH) 安装与启用

```bash
# 1) 在 DSH profile 中安装插件包（以 desktop profile 为例）
cd ~/.dsh/profiles/desktop
pnpm add /path/to/dsh-forge

# 2) 写入 profile 的 dsh.profile.bundles（自动排在 dsh-purge* 之后并备份 package.json）
npx dsh-forge profile enable --profile desktop

# 3) 运行 12 项诊断、预检并应用 15 条宿主补丁
npx dsh-forge doctor
npx dsh-forge apply --dry-run
npx dsh-forge apply --yes

# 4) 完全退出 DSH（⌘Q）并重新打开后核验 3 项运行时证明
npx dsh-forge verify
```

### 与 `dsh-purge` 共存

若同一 Profile 内安装了 `dsh-purge-community`，`dsh.profile.bundles` 中 `dsh-forge` 必须排在 `dsh-purge-community` 之后（`dsh-forge profile enable` 会自动维护该顺序）。`cordis.patch.yml` 会自动禁用遗留 `dsh-purge*` 节点，确保仅保留唯一的 `systemPrompt` 注入段（`forge:prompt`）与唯一路由表。

本地 HTTP 管理接口挂载在 DSH 回环服务 `/dsh-forge/api` 下，严格校验 `Host`、`Sec-Fetch-Site` 与 `Origin` 请求头，并限制请求体不超过 256 KB。

当 `apply --yes` 需要解包 `app.asar` 时，补丁或事务失败会恢复原始密封包。成功应用后宿主会保留解包状态；回滚受管补丁文件不会重新封装应用包。

---

## 升级与更新

### 1. 更新 `dsh-forge` 自身

拉取新版本或重新安装 tarball 后，执行 `upgrade` 会先按当前宿主版本的活跃备份回滚旧补丁，再应用最新补丁表并生成新 manifest：

```bash
cd ~/.dsh/profiles/desktop
pnpm add /path/to/dsh-forge
npx dsh-forge upgrade --dry-run
npx dsh-forge upgrade --yes
```

若修改了前端源码 `client/src/entry.js`，运行 `npm run build:client` 重新生成 `client/client.js`。

### 2. DSH 宿主升级后适配

DSH 客户端升级会覆盖应用包目录下的文件。`revert` 会校验备份记录的 `hostVersion`，阻止将旧版 DSH 的备份文件写回新版宿主。升级 DSH 后按以下顺序处理：

```bash
# 检查新版宿主的 15 条补丁锚点是否全部命中
dsh-forge adapt

# 若全部为 ready，一键重新写入补丁
dsh-forge upgrade --yes

# 若某条补丁报 miss，查看目标文件变化并在 lib/table.mjs 的 variants 中追加新版本区间
dsh-forge explain <patch-id>
```

---

## 人设层

`prompt/personas/*.md` 是可以跨适配器迁移的提示词身份层。人设与宿主提示词的组合有四种模式：`replace` 保留宿主工作规则、去掉自称身份，`strict` 只留人设，`append` 追加在宿主提示词之后，`off` 关闭。`dsh-forge personas` 列出内置人设；`dsh-forge compile codex --persona engineer --persona-mode strict` 指定使用，`off` 与不传人设逐字节一致。细节见 [docs/PERSONAS.md](docs/PERSONAS.md)。

## CLI 命令参考

### DeepSeek Harness (`dsh`) 原生命令

| 命令 | 说明 |
| :--- | :--- |
| `dsh-forge doctor [--profile desktop\|web] [--json]` | 检查宿主路径、版本区间、补丁状态、提示词预算、插件冲突与 Profile 顺序等 12 项指标 |
| `dsh-forge status [--profile desktop\|web] [--json]` | 输出 `doctor` 报告、当前策略、Profile 状态与备份列表 |
| `dsh-forge apply [--dry-run\|--yes]` | 预检或原子写入 8 条宿主补丁（`--yes` 时若宿主仍在 `app.asar` 中会自动解包） |
| `dsh-forge unpack [--dry-run\|--yes]` | 将密封的 `Contents/Resources/app.asar` 原子解包到 `Contents/Resources/app` |
| `dsh-forge upgrade [--dry-run\|--yes]` | 回滚同版本旧补丁后重新应用当前补丁表 |
| `dsh-forge revert [--id <backup>] [--force]` | 按备份 manifest 还原宿主文件并校验 `sha256` 与 `hostVersion` |
| `dsh-forge verify [--profile desktop\|web] [--json]` | 校验补丁落盘标记、提示词通道预算/注册状态及最新会话日志 |
| `dsh-forge adapt [--json]` | 检查所有补丁在当前宿主版本上的锚点就绪状态 |
| `dsh-forge explain <patch-id>` | 查看单条补丁的锚点命中次数与目标文件片段 |
| `dsh-forge profile [status\|enable\|disable] [--profile desktop]` | 查看或在 `~/.dsh/profiles/<profile>/package.json` 中启停插件 |
| `dsh-forge prompt compose [--adapter deepseek] [--mode coding] [--out file]` | 组合 `core + adapter + mode` 并检查 Token 预算 |
| `dsh-forge prompt install [--adapter deepseek] [--mode coding] [--home dir]` | 将组合后的提示词原子写入 `~/.dsh/prompt-inject.md`（自动备份旧文件） |
| `dsh-forge preset [strict\|fallback\|always]` | 读取或设置 Workspace 提示词基线共存策略 |
| `dsh-forge log [--limit 50\|--clear]` | 查看或清空 `~/.dsh/dsh-forge/logs/` 下的结构化日志 |
| `dsh-forge collect` | 导出路径脱敏后的诊断归档包（`~/.dsh/dsh-forge/reports/forge-diag-*.tar.gz`） |

### 跨宿主编译与事务计划命令

| 命令 | 说明 |
| :--- | :--- |
| `dsh-forge compile [profile] [--model <id>] [--mode <mode>] [--out file] [--json]` | 纯编译跨宿主执行计划，不改写任何磁盘文件 |
| `dsh-forge apply --profile <id> [--model <id>] [--mode <mode>] [--preview file] [--dry-run\|--yes]` | 预检或事务式应用跨宿主 Profile 计划，并可启用预览 SHA 冲突保护 |
| `dsh-forge plans [--json]` | 列出 `~/.dsh-forge/plans/` 下的历史执行计划记录 |
| `dsh-forge verify-plan <plan-id> [--json]` | 重新校验已应用计划内所有目标文件的 `sha256` 与补丁状态 |
| `dsh-forge revert-plan <plan-id> [--force]` | 字节级回滚已应用的计划（目标文件被外部修改时默认拒绝覆盖） |
| `dsh-forge profiles [--json]` | 列出 `profiles/*.json` 中的全部宿主 Profile |
| `dsh-forge models [--json]` | 列出 `models/*.json` 中的全部模型定义 |
| `dsh-forge hosts [--json]` | 探测本机已安装的 AI 编程助手宿主环境 |

`status --json` 会明确区分生效阶段：`doctor.activation.state` 为 `inactive`、`configured` 或 `active`。`configured` 表示提示词通道已经写入或注册；`active` 表示最近会话已经加载 Forge 头部；`requiresRestart` 表示配置已存在但仍需新建宿主会话。

---

## 验证与质量门禁

```bash
# 可复现安装与仓库质量门禁
npm ci --ignore-scripts
npm run check:repo

# 运行单元、集成、安全边界、ASAR 与 HTTP API 测试套件
npm test

# 对全部已注册 Profile 执行编译与预检冒烟测试
npm run verify:profiles

# 运行完整端到端验证（测试、Profile、前端构建、Python 语法、锚点漂移、隐私扫描）
npm run verify

# 扫描仓库中的本机绝对路径、凭据 Token、个人账号标识与私钥块
npm run privacy:scan

# 审计 npm 打包文件白名单
npm run pack:check
```

---

## 补充文档

- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — 模块分层、时序图、补丁状态机与跨宿主编译执行管线。
- **[docs/PATCHES.md](docs/PATCHES.md)** — 8 条宿主补丁的详细锚点说明与多版本 `variants` 扩展示例。
- **[docs/COMPAT.md](docs/COMPAT.md)** — 支持的 DSH 版本范围（`0.2.1-rc.1` – `0.2.2-rc.3`）、宿主升级流程与运行环境要求。
- **[docs/DEBUG.md](docs/DEBUG.md)** — 故障排查决策树、常见错误码与安装后冒烟测试清单。
- **[docs/DESIGN.md](docs/DESIGN.md)** — 核心架构取舍与工程设计权衡。
- **[docs/PORTABILITY.md](docs/PORTABILITY.md)** — 跨宿主能力矩阵、模型微调层与 `forge.profile/v1` 规范。
- **[tools/abliterate/README.md](tools/abliterate/README.md)** — 本地开源权重残差流激活方向正交投影脚本说明。
- **[tools/eval/README.md](tools/eval/README.md)** — 本地模型拒答率评测脚本说明。

---

## 开源许可

基于 [MIT License](LICENSE) 开源。归属与范围说明详见 [NOTICE.md](NOTICE.md)。
