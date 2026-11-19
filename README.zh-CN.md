# dsh-forge-kit

[English](README.md)

[![CI](https://img.shields.io/badge/CI-Node%2020+-000?style=flat-square)](#验证与质量闸门)
[![License: MIT](https://img.shields.io/badge/License-MIT-000?style=flat-square)](LICENSE)
[![Runtime Dependencies: 0](https://img.shields.io/badge/Runtime%20Deps-0-000?style=flat-square)](package.json)

> **首次接手？** 请先读 [docs/ONBOARDING.md](docs/ONBOARDING.md)（30 分钟上手路径）和 [docs/ENGINEERING_RULES.md](docs/ENGINEERING_RULES.md)（工程防回归铁律）。

**面向 `DSH` / `Claude Code` / `Codex CLI` / `OpenCode` 四大主力验证宿主的确定性策略编译器、零漂移回滚执行器、持续自适应交付会话（`dsh-session`）与本地工作台，零第三方运行时依赖。**

命令行入口：`dsh-forge-kit`、`dsh-forge`、`dsh-session`。

![dsh-forge-kit 面板预览](docs/ui-preview.png)

---

## 核心能力排序

| 维度 | 传统散装补丁脚本 | `dsh-forge-kit` 工程架构 |
| :--- | :--- | :--- |
| **确定性策略编译** | 硬编码超长提示词或直接污染全局配置 | `core + persona + model + host + mode` 模块化拼接（约 268–361 token），受控于 `< <!-- forge-facts:begin kind=promptCeiling -->480<!-- forge-facts:end -->` token 硬上限与机器无关 `planId` |
| **零漂移事务回滚** | 覆盖单一 `.bak` 文件 | 每次写入保留完整原始字节与 `beforeSha`/`afterSha` 清单、`symlink` 拒写检查；状态隔离于 `~/.dsh-forge-kit/`（或 `$XDG_STATE_HOME/dsh-forge-kit`） |
| **持续自适应交付会话** | 一次性生成，无状态、易漂移 | `dsh-session` / `dsh-forge session` 落盘每轮记录、戳记 `classifierHash`、自动降级 `systemMode`（`full→inline→lock→bare`）与 `shape`（`history→single→bare`），并跨会话积累家族 UCB1 战绩 |
| **四大主力验证宿主** | 绑定单一宿主或浅层未测规则 | **DSH**、**Claude Code**、**Codex CLI**、**OpenCode** 均具备黄金探测 fixture 与完整 `compile→apply→verify→revert` 覆盖（其余 9 个档案标记为冻结/实验态） |
| **交互式工作台** | 只读状态页 | `127.0.0.1:7788` 本地工作台（`/workbench`、`/plans`、`/live`、`/patches`、`/audit`）与约 25 KB 零依赖 DSH 侧边栏，严格受 Loopback + Origin + CSP + CSRF 保护 |
| **技术规格（DSH 原生补丁）** | 80+ 条易碎 UI/字符串替换 | <!-- forge-facts:begin kind=patches -->23<!-- forge-facts:end --> 条版本门控 DSH 补丁覆盖 <!-- forge-facts:begin kind=files -->18<!-- forge-facts:end --> 个 `@deepseek-ai/*` 文件，支持 `variants` 多版本锚点 |

DSH 原生补丁表面事实（由 `lib/table.mjs` 自动派生）：

<!-- forge-facts:begin -->
23 host patches · 18 patched files · 17 `@deepseek-ai/*` packages · layers: approval 7, sandbox 9, turn 1, persona 4, session 2 · host range `>=0.2.1-rc.1 <0.3.0`
<!-- forge-facts:end -->

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

# 持续自适应会话（`dsh-session` 或 `dsh-forge session`）
node bin/dsh-session.js start --model gpt-4o --task "实现确定性配置合并器"
node bin/dsh-session.js turn <session-id> --send --gateway http://127.0.0.1:3425/v1
node bin/dsh-session.js status <session-id>

# 直连本地网关执行单次策略评测或矩阵测试，或启动 :7788 工作台
node bin/dsh-forge.js run --gateway default --model glm-5.3-flash --strategy variable+contract --prompt-text "..."
node scripts/live_matrix.mjs --gateway default --model glm-5.3-flash --probe lateral-report-digest --strategy deep --limit 10
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

详见 [docs/STRUCTURE.md](docs/STRUCTURE.md)、[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 与 [docs/ONBOARDING.md](docs/ONBOARDING.md)：

- `bin/dsh-forge.js` & `bin/commands/` — 精简 CLI 分发入口与按域拆分的命令模块（`shared`/`dsh`/`plan`/`runtime` + `session` 子命令）。
- `bin/dsh-session.js` — 持续交付会话独立入口。
- `core/` — 宿主无关核心库（`index.mjs` 显式策展导出；含 `compile`、`executor`、`strategy`、`families`、`session`、`gateway`、`net`、`console` 等）。
- `ui/` — 本地工作台与 DSH 侧边栏共享的设计系统 Token（`tokens.mjs`）与交互前端（`workbench.js`）。
- `hosts/` — <!-- forge-facts:begin kind=profiles -->13<!-- forge-facts:end --> 个宿主适配器及只读会话证据探测器（4 个主力已配黄金 fixture）。
- `profiles/` & `models/` — <!-- forge-facts:begin kind=profiles -->13<!-- forge-facts:end --> 份声明式宿主档案与 <!-- forge-facts:begin kind=models -->7<!-- forge-facts:end --> 份模型家族叠加配置。
- `prompt/` — 核心指令（`core.md`）、<!-- forge-facts:begin kind=personas -->13<!-- forge-facts:end -->+ 份人设（`personas/*.md`）、模型/宿主/模式覆盖片段。
- `lib/` — DSH 专属 `app.asar` 拆包器、23 条版本门控补丁表、Cordis 插件（`dsh-forge-kit`）与 `/dsh-forge-kit/api` 接口（详见 [lib/README.md](lib/README.md)）。
- `client/` — DSH 右侧栏 React 插件源码与构建产物。

---

## 验证与质量闸门

```bash
npm ci --ignore-scripts
npm test                    # 单元测试、HTTP fixture 端到端测试、黄金宿主 fixture、安全与工作台测试
npm run verify:profiles     # 全量 Profile 预算与预检验证
npm run check:repo          # 分层边界、CLI 表面、语法、锁文件、隐私与 tarball 内容门禁
npm run docs:check          # 文档同步事实自检
npm run verify              # 全套测试 + 客户端构建 + Python 语法 + 真实宿主锚点预检 + 隐私扫描
npm run release:check       # 包含 Git 历史扫描的完整发布前闸门
```

---

## 持续交付会话（全模型）

`dsh-session`（`dsh-forge session`）把一次性生成变成可续跑、可度量的交付循环：会话状态落盘于 `~/.dsh-forge-kit/sessions/`，每轮自动重申任务锁并过滤非交付拒答历史，内置系统槽与消息形态两级降级以及代理封 IP（`chatcmpl-freeipblk`）拦截，每条记录戳记 `classifierHash`。详见 [docs/SESSION.md](docs/SESSION.md)。

## 文档索引

- **[docs/ONBOARDING.md](docs/ONBOARDING.md)** / **[docs/ENGINEERING_RULES.md](docs/ENGINEERING_RULES.md)** — 新人 30 分钟上手路径与防回归工程铁律
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** / **[docs/STRUCTURE.md](docs/STRUCTURE.md)** — 模块分层、状态机与目录规范
- **[docs/PORTABILITY.md](docs/PORTABILITY.md)** / **[docs/GRADES.md](docs/GRADES.md)** — 四大主力验证宿主、冻结实验宿主与动态投递分级
- **[docs/PATCHES.md](docs/PATCHES.md)** / **[docs/COMPAT.md](docs/COMPAT.md)** — DSH 原生补丁明细与版本兼容范围
- **[docs/LIVE_MATRIX.md](docs/LIVE_MATRIX.md)** / **[docs/PLAYBOOK.md](docs/PLAYBOOK.md)** — Magpie/API 实测方法、安全边界与逐模型策略读数
- **[docs/SESSION.md](docs/SESSION.md)** — 持续会话：落盘状态、逐轮锁定、传输降级、家族阶梯与稳定性度量
- **[docs/EXTREME_TEST_REPORT.md](docs/EXTREME_TEST_REPORT.md)** — 全平台实机校验、虚构直出长文本、推理饥饿扩容与全模型极限压力测试报告
- **[docs/CONSOLE.md](docs/CONSOLE.md)** — 本地 `:7788` 交互式工作台路由与安全防护
- **[docs/MEASUREMENT_RULES.md](docs/MEASUREMENT_RULES.md)** — 发布任何实测数字前必须满足的八条规则，每条都能追到逼出它的那次提交
- **[docs/RELEASE.md](docs/RELEASE.md)** — 发布前的五道门禁、版本怎么切与 `dsh-forge-kit` 包名迁移说明
- **[docs/RELATED_PROJECTS.md](docs/RELATED_PROJECTS.md)** / **[docs/TASKS.md](docs/TASKS.md)** — 生态项目借鉴对照与隔离边界、任务里程碑

## 许可

基于 [MIT License](LICENSE) 开源，附加声明见 [NOTICE.md](NOTICE.md)。
