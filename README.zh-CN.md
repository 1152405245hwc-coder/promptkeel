# dsh-forge

[English](README.md)

[![CI](https://img.shields.io/badge/CI-Node%2020+-000?style=flat-square)](#验证与质量闸门)
[![License: MIT](https://img.shields.io/badge/License-MIT-000?style=flat-square)](LICENSE)
[![Runtime Dependencies: 0](https://img.shields.io/badge/Runtime%20Deps-0-000?style=flat-square)](package.json)

**面向 DeepSeek Harness（DSH）、Claude Code、Codex CLI、Gemini CLI、OpenCode、Continue、Cursor、Windsurf、Aider、Hermes 与 OpenClaw 等宿主的系统提示词注入器、声明式宿主补丁引擎、可回滚多平台编译器与本地策略工作台。**

<!-- forge-facts:begin -->
23 host patches · 18 patched files · 17 `@deepseek-ai/*` packages · layers: approval 7, sandbox 9, turn 1, persona 4, session 2 · host range `>=0.2.1-rc.1 <0.3.0`
<!-- forge-facts:end -->

![dsh-forge 面板预览](docs/ui-preview.png)

---

## 核心特性

| 维度 | 传统散装补丁脚本 | `dsh-forge` 工程架构 |
| :--- | :--- | :--- |
| **宿主补丁面** | 80+ 条易碎 UI/字符串替换，小版本升级即大面积失效 | **<!-- forge-facts:begin kind=patches -->23<!-- forge-facts:end --> 条版本门控补丁** 覆盖 <!-- forge-facts:begin kind=files -->18<!-- forge-facts:end --> 个 `@deepseek-ai/*` 文件，支持 `variants` 多版本锚点 |
| **提示词管线** | 硬编码超长提示词或直接污染全局配置 | `core + persona + model + host + mode` 模块化拼接（各档案约 268–361 token），严格受控于 `< <!-- forge-facts:begin kind=promptCeiling -->480<!-- forge-facts:end -->` token 上限与 `sha256` 摘要校验 |
| **跨宿主真实替代 (`B4`)** | 仅追加 `AGENTS.md` / `GEMINI.md` | 自动落盘 Codex `model_instructions_file`、Gemini `GEMINI_SYSTEM_MD`  executable shim (`0755`)、Continue `chatOptions.baseAgentSystemMessage` YAML 块、Claude Code `--append-system-prompt-file` shim，并由 `grades.mjs` 动态校验 |
| **本地策略与网关引擎** | 零散脚本触发 | `core/strategy.mjs` 与 `core/gateway.mjs` 统一提供 `variable` 包装、`crescendo/deep/layered` 多轮推进、`prefill` 前缀引导、`stuff` 上下文稀释，直连 Magpie `:3425` 与 OpenAI/Anthropic/GLM API |
| **交互式工作台** | 只读状态页 | `127.0.0.1:7788` 本地工作台（`/workbench`、`/plans`、`/live`、`/patches`、`/audit`）与约 25 KB 零依赖 DSH 侧边栏，严格受 Loopback + Origin + CSP + CSRF 保护 |
| **备份与隔离回滚** | 覆盖单一 `.bak` 文件 | 每次写入保留完整原始字节 + `sha256` 清单、`symlink` 拒写检查；工作区状态默认隔离于 `~/.dsh-forge`（或 `$XDG_STATE_HOME/dsh-forge`），不干扰线上 `~/.dsh/` 配置 |

---

## 快速开始

需要 **Node.js <!-- forge-facts:begin kind=nodeEngine -->`>=20`<!-- forge-facts:end -->**（零第三方运行时依赖）。

```bash
# 查看所有宿主 Profile、模型覆盖与本地宿主探测
node bin/dsh-forge.js profiles
node bin/dsh-forge.js models
node bin/dsh-forge.js hosts
node bin/dsh-forge.js grades

# 纯编译（不写磁盘）：预览 Codex replace-full 计划
node bin/dsh-forge.js compile codex --model gpt --persona contract --mode coding

# 预检并事务应用（需显式 --yes 才写入），支持校验与零漂移回滚
node bin/dsh-forge.js apply --profile codex --dry-run
node bin/dsh-forge.js apply --profile codex --yes
node bin/dsh-forge.js verify-plan <plan-id>
node bin/dsh-forge.js revert-plan <plan-id>

# 直连本地 Magpie :3425 执行单次策略评测或矩阵测试
node bin/dsh-forge.js run --gateway default --model glm-5.3-flash --strategy variable+contract --prompt-text "..."
node scripts/live_matrix.mjs --gateway default --model glm-5.3-flash --probe lateral-report-digest --strategy deep --limit 10

# 启动本地 127.0.0.1:7788 交互式工作台
node bin/dsh-forge.js console
```

### DeepSeek Harness (`dsh`) 原生命令

```bash
dsh-forge doctor [--profile desktop|web] [--json]   # 运行 12 项宿主、版本、锚点、预算与冲突检查
dsh-forge adapt [--json]                            # 升级 DSH 后只读检查所有 23 条锚点匹配状态
dsh-forge apply [--dry-run|--yes]                   # 原子应用 23 条宿主补丁（必要时自动安全拆包 app.asar）
dsh-forge upgrade [--dry-run|--yes]                 # 从最近同版本备份平滑刷新补丁
dsh-forge revert [--id <backup>] [--force]          # 基于 manifest 与 sha256 精确还原宿主文件
dsh-forge verify [--json]                           # 校验补丁标记、提示词预算与最新会话注入记录
dsh-forge prompt install                            # 原子写入 ~/.dsh/prompt-inject.md（自动备份）
dsh-forge preset [strict|fallback|always]           # 配置工作区提示词基线接管策略
```

---

## 目录结构

详见 [docs/STRUCTURE.md](docs/STRUCTURE.md) 与 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)：

- `bin/dsh-forge.js` — 统一 CLI 入口（DSH 原生管理 + 跨宿主编译 + `run` 实时调试 + `console`）。
- `core/` — 宿主无关核心库（`index.mjs`、`contract.mjs`、`compile.mjs`、`executor.mjs`、`strategy.mjs`、`gateway.mjs`、`console.mjs`、`channels.mjs`、`grades.mjs`、`persona.mjs`、`transform.mjs`、`probe.mjs`、`audit.mjs`、`snapshot.mjs`）。
- `ui/` — 本地工作台与 DSH 侧边栏共享的设计系统 Token（`tokens.mjs`）与无内联脚本交互前端（`workbench.js`）。
- `hosts/` — <!-- forge-facts:begin kind=profiles -->13<!-- forge-facts:end --> 个宿主适配器及只读会话证据探测器（`evidence.mjs`）。
- `profiles/` & `models/` — <!-- forge-facts:begin kind=profiles -->13<!-- forge-facts:end --> 份声明式宿主档案与 <!-- forge-facts:begin kind=models -->7<!-- forge-facts:end --> 份模型家族叠加配置。
- `prompt/` — 核心指令（`core.md`）、<!-- forge-facts:begin kind=personas -->12<!-- forge-facts:end -->+ 份人设（`personas/*.md`）、模型/宿主/模式覆盖片段。
- `lib/` — DSH 专属 `app.asar` 拆包器、23 条版本门控补丁表、Cordis 插件与 `/dsh-forge/api` 接口。
- `client/` — DSH 右侧栏 React 插件源码与构建产物。

---

## 验证与质量闸门

```bash
npm ci --ignore-scripts
npm test                    # 全部单元测试、事务、安全与工作台集成测试
npm run verify:profiles     # 全量 Profile 预算与预检验证
npm run docs:check          # 文档同步事实自检
npm run verify              # 全套测试 + 客户端构建 + Python 语法 + 真实宿主锚点预检 + 隐私扫描
npm run release:check       # 包含 Git 历史扫描的完整发布前闸门
```

---

## 文档索引

- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** / **[docs/STRUCTURE.md](docs/STRUCTURE.md)** — 模块分层、状态机与目录规范
- **[docs/PORTABILITY.md](docs/PORTABILITY.md)** / **[docs/GRADES.md](docs/GRADES.md)** — 跨宿主兼容矩阵与动态投递分级
- **[docs/PATCHES.md](docs/PATCHES.md)** / **[docs/COMPAT.md](docs/COMPAT.md)** — DSH 原生补丁明细与版本兼容范围
- **[docs/LIVE_MATRIX.md](docs/LIVE_MATRIX.md)** / **[docs/PLAYBOOK.md](docs/PLAYBOOK.md)** — Magpie/API 实测方法、安全边界与逐模型策略读数
- **[docs/CONSOLE.md](docs/CONSOLE.md)** — 本地 `:7788` 交互式工作台路由与安全防护
- **[docs/RELATED_PROJECTS.md](docs/RELATED_PROJECTS.md)** / **[docs/TASKS.md](docs/TASKS.md)** — 生态项目借鉴对照与隔离边界、任务里程碑

## 许可

基于 [MIT License](LICENSE) 开源，附加声明见 [NOTICE.md](NOTICE.md)。
