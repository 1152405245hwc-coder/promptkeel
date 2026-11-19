# PromptKeel（龙骨）v0.2.0 中英双语多社群宣发工具包

适用版本：`v0.2.0` · 仓库主页：https://github.com/liangsiweiethan-wq/promptkeel · 发布页：https://github.com/liangsiweiethan-wq/promptkeel/releases/tag/v0.2.0 · 社交分享图：[docs/assets/social-preview.png](assets/social-preview.png)（`1280×640`，可在 GitHub Settings → Social preview 直接上传）

---

## 一、品牌命名说明

- **英文主名**：**PromptKeel**（`Prompt` + `Keel`，船底主龙骨，意为跨多宿主 AI 编程工作流的零漂移结构主梁）
- **中文副名**：**龙骨**
- **一句话 Slogan**：
  - 中文：`给 Claude Code / Codex / OpenCode / DSH 装上同一根确定性「龙骨」：预算受控编译、SHA-256 事务回滚、多模型持续会话，零运行时依赖。`
  - 英文：`The zero-drift backbone for coding agents — compile prompts under a strict 480-token ceiling, apply with SHA-256 transactional rollback, and run persistent adaptive delivery sessions with zero runtime dependencies.`
- **GitHub Description**：
  `Zero-drift prompt & policy compiler, transactional rollback executor, and adaptive delivery sessions for Claude Code, Codex CLI, OpenCode, and DeepSeek Harness (DSH) — zero runtime dependencies.`
- **GitHub Topics**：
  `promptkeel`, `prompt-compiler`, `ai-agents`, `claude-code`, `codex`, `opencode`, `deepseek-harness`, `cli`, `nodejs`, `zero-dependency`, `rollback`

---

## 二、GitHub Release Notes（`v0.2.0` 中英双语）

```markdown
## PromptKeel v0.2.0 (龙骨)

**The zero-drift prompt & policy compiler, SHA-256 transactional rollback executor, and persistent adaptive delivery session runtime for coding agents — with zero runtime dependencies.**

**面向 `DSH` / `Claude Code` / `Codex CLI` / `OpenCode` 的确定性策略编译器、SHA-256 事务级零漂移回滚执行器与持续自适应会话引擎——零第三方运行时依赖。**

### Highlights / 核心亮点
- **Brand Upgrade (`PromptKeel / 龙骨`)**: Renamed package, Cordis plugin ID, `/promptkeel/api` loopback route, and `~/.promptkeel/` state root, while keeping backwards-compatible `dsh-forge` / `dsh-session` CLI aliases, `DSH_FORGE_*` environment fallbacks, and existing `<!-- dsh-forge ... -->` managed block markers.
- **Verified 4-Host Core + Golden Fixtures**: Promoted `opencode` to `verified` alongside `dsh`, `claude-code`, and `codex`, each backed by golden detection fixtures (`test/fixtures/hosts/`) covering `missing`, `configured`, `active`, and false-positive prevention.
- **Hardened `promptkeel session` Runtime**: Fixes `bare` / `single` variant emission, HTTP `httpStatus` rejection detection, replay isolation (`delivered`/`partial` only on the wire, full raw audit on disk), two-axis transport degradation (`systemMode` & `shape`), concurrent-safe UCB1 `_family-*.json` updates, `chatcmpl-freeipblk*` / `[magpie/*]` proxy-banner traps, `classifierHash` stamping, and real in-process `http.createServer` E2E verification (`test/session-e2e.test.mjs`).
- **Curated Architecture & Quality Gates**: Split CLI into `bin/commands/{shared,dsh,plan,runtime}.mjs`, replaced `core/index.mjs` blanket `export *` with explicit named exports (`test/public-api.test.mjs`), shared `core/net.mjs` loopback Host-header validation, and **224 passing tests** across CI (`ubuntu-latest` + `macos-latest` × Node `20`/`22`).

### 30-Second Quickstart
```bash
git clone https://github.com/liangsiweiethan-wq/promptkeel.git
cd promptkeel
node bin/promptkeel.js compile codex --model gpt --persona contract --mode coding
node bin/promptkeel.js console   # http://127.0.0.1:7788
npm test                         # 224 passing, 0 dependencies
```
```

---

## 三、LINUX DO / V2EX / 掘金长文发布帖

### 标题候选
1. `[开源自荐] PromptKeel（龙骨）：给 Claude Code / Codex / OpenCode / DSH 装上同一根确定性「龙骨」—— 不超过 480 Token 预算编译、SHA-256 零漂移回滚、零依赖开箱跑`
2. `改写了跨宿主 Prompt 与配置注入工程：PromptKeel v0.2.0 开源（支持 4 大主力 Agent 黄金探测 + 自适应持续会话）`

### 正文模板

```markdown
各位佬友们好，最近把之前在多套 AI 编程 CLI（**Claude Code**、**Codex CLI**、**OpenCode**、**DeepSeek Harness (DSH)**）之间折腾的一套策略编译与配置治理工具做了彻底审计和品牌重构，定名为 **PromptKeel（龙骨）**，MIT 协议开源，`v0.2.0` 刚刚完整推上 GitHub。

### 为什么要造 PromptKeel（龙骨）？
在工程里同时用多个 AI 编程 Agent，很快会撞上三类反复返工的问题：
1. **Prompt 与宿主规则越改越肥、越改越乱**：不同工具分别读 `CLAUDE.md`、`AGENTS.md`、`opencode.json`、`.codex/config.toml`、`~/.dsh/prompt-inject.md`，手改一遍就漂移，还动辄塞爆系统上下文。
2. **改完配置没法安全回滚**：很多脚本要么覆盖单一 `.bak` 文件，要么不核对文件事后有没有被用户编辑，回滚一次就把自己后写的代码盖没了。
3. **跨模型多轮会话与网关评测容易被污染**：代理返回一条 `200 OK` 的封 IP 提示（比如 `chatcmpl-freeipblk*`）或者模型吐半句拒答后继续重放历史，后续几轮全歪。

于是 **PromptKeel（龙骨）** 按一条严格单向分层 (`core/` 不允许 import `lib/`) 重写了整个工程基座：**零任何第三方 npm 运行时/开发依赖，只需 Node.js 20+。**

### 核心设计取舍
1. **模块拼接 + `< 480` Token 硬门禁**：把指令拆成 `core + persona + model + host + mode`（13 份宿主档案默认约 268–361 token），用 CI 门禁 `verify:profiles` 卡死不超过 480 token，同一组合生成与本机绝对路径无关的确定性 `planId`。
2. **SHA-256 清单留痕 + 零漂移回滚**：`apply --dry-run --preview` 生成预检清单；真正写入前检查文件是否在预览后被改动，并拒绝通过 symlink 写入；写前逐文件保存原始字节与 `beforeSha`/`afterSha` 到 `~/.promptkeel/plans/`，一旦外部改动文件，默认拒绝覆盖式 `revert-plan`。
3. **4 大主力宿主黄金 Fixture 校验**：`dsh`（含 23 条版本门控补丁覆盖 18 个 `@deepseek-ai/*` 文件与安全 `app.asar` 拆包）、`claude-code`、`codex`、`opencode` 均配有 `missing / configured / active / 防误报` 四态合成目录测试（另附 9 份冻结/实验档案）。
4. **`promptkeel session` 持续自适应交付会话**：落盘到 `~/.promptkeel/sessions/`，把**原始审计记录**与**重放上下文**分离（拒答轮次留盘审计但不重放毒化后续对话）；支持 `systemMode`（`full→inline→lock→bare`）与 `shape`（`history→single→bare`）两轴降级，以及跨会话 UCB1 家族臂先验，配套真实进程内 `http.createServer` E2E 测试守住线缆报文。
5. **环回本地工作台**：`node bin/promptkeel.js console` 直接拉起 `http://127.0.0.1:7788`，严格检验 `Host` / `Origin` / `Sec-Fetch-Site`、`script-src 'self'` CSP 与每进程 CSRF 令牌。

欢迎试跑体验、提 Issue 或 Star 支持！
- 仓库主页：https://github.com/liangsiweiethan-wq/promptkeel
- 30 分钟工程上手指南：`docs/ONBOARDING.md`
```

---

## 四、Show HN / Reddit / GitHub Discussion（英文简帖）

**Title:**
`Show HN: PromptKeel – Zero-drift prompt compiler & SHA-256 rollback for Claude Code, Codex CLI, and OpenCode`

**Body:**
```text
I built PromptKeel (formerly dsh-forge-kit), a zero-dependency Node.js (>=20) CLI and studio for compiling, applying, verifying, and rolling back agent instruction bundles across Claude Code, Codex CLI, OpenCode, and DeepSeek Harness (DSH).

Why not just copy CLAUDE.md / AGENTS.md by hand?
- Budget & determinism: Profiles compose modular fragments (`core + model + host + persona + mode`) and fail any build exceeding a 480-token ceiling, yielding a path-independent `planId`.
- Byte-exact transactional rollback: `apply` saves pre-write bytes, `beforeSha`, and `afterSha` under `~/.promptkeel/plans/`, refuses symlink targets via `lstatSync`, and blocks `revert-plan` if a user edited a managed file after apply (unless `--force`).
- Golden detection fixtures: Verified lifecycle tests cover 4 primary hosts (`dsh`, `claude-code`, `codex`, `opencode`) across missing, configured, active, and false-positive states, alongside 9 frozen/experimental targets.
- Stateful adaptive sessions (`promptkeel session`): Isolates replay history from on-disk audit logs, degrades system/message packing (`full -> inline -> lock -> bare` / `history -> single -> bare`) against real in-process HTTP server fixtures, and stamps every outcome with `classifierHash`.

It runs 100% offline with zero npm dependencies (`224 passing` built-in `node --test` cases). Would love feedback from people managing multi-agent configs across repositories.

Repo: https://github.com/liangsiweiethan-wq/promptkeel
```

---

## 五、X (Twitter) 英文首发串 (Thread)

**Post 1 (Hook)**
> Juggling instructions across Claude Code, Codex CLI, OpenCode, and DSH quickly turns into config drift—no token budget checks, overwritten backups, and silent breakage across tools.
>
> Meet **PromptKeel (龙骨)** `v0.2.0`: a zero-dependency prompt/policy compiler with SHA-256 transactional rollback. 🧵👇

**Post 2 (Core Guarantees)**
> Why engineers reach for PromptKeel:
> 1️⃣ Modular compilation strictly capped `< 480 tokens` across 13 host profiles
> 2️⃣ `apply --preview` + `beforeSha`/`afterSha` manifests + symlink refusal (`lstatSync`)
> 3️⃣ `verify-plan` & `revert-plan` that fail closed when a file was edited externally
> 4️⃣ Verified 4-host core with golden fixtures (`dsh`, `claude-code`, `codex`, `opencode`)

**Post 3 (Session Runtime & Workbench)**
> Also ships with `promptkeel session` + a loopback workbench (`127.0.0.1:7788`):
> • Replay isolation (non-delivered turns stay in audit logs, out of prompt replay)
> • Two-axis transport degradation (`full->inline->lock->bare` & `history->single->bare`)
> • `classifierHash` stamping & proxy IP-block guards tested against real HTTP E2E fixtures

**Post 4 (CTA)**
> Zero npm runtime dependencies. Node 20+ stdlib only. 224 passing tests on Linux & macOS CI.
>
> Clone and spin up the local studio in 30 seconds:
> https://github.com/liangsiweiethan-wq/promptkeel

---

## 六、小红书 / 即刻图文短文案与配图分镜

**标题候选（三选一）：**
1. `多款 AI 编程 Agent 配置老打架？我给它们造了一根零依赖「龙骨」📌`
2. `写代码同时用 Claude Code + Codex + OpenCode？这招让你一键编译 + SHA-256 零漂移回滚`
3. `零第三方依赖、224 项实测通过：开源工具 PromptKeel（龙骨）v0.2.0 上线`

**配图 5 张分镜建议：**
1. **封面图**：使用 `docs/assets/hero.svg` 深海石板绿金架构主视觉，突出「零漂移编译 · SHA-256 回滚 · 零依赖」。
2. **图 2（痛点对照）**：「手改 AGENTS.md / CLAUDE.md 反复覆盖漂移」vs「PromptKeel 模块化编译 + `< 480` Token 硬上限」。
3. **图 3（回滚与安全）**：展示 `apply -> manifest.json (beforeSha / afterSha) -> verify-plan -> revert-plan` 的可逆闭环。
4. **图 4（本地工作台）**：直接截取 `docs/ui-preview.png` / `127.0.0.1:7788` 暗色工作台界面。
5. **图 5（30 秒命令卡）**：4 行开箱命令 + GitHub 主页地址。

**小红书正文：**
```text
工程里同时用 Claude Code、Codex CLI、OpenCode 甚至本地 DeepSeek Harness 的同学，一定踩过这几个坑👇
❌ 每家配置文件长得不一样，同一套工程规范复制三份转头就忘同步；
❌ 脚本覆盖改坏了配置想退回，旧版 `.bak` 早被二次覆盖了；
❌ 提示词越写越长，没开聊就先吃掉上千 Token 预算。

所以我整理开源了 **PromptKeel（龙骨）**——零任何第三方 npm 依赖，纯 Node.js 20+ 一键跑通：
✅ **确定性编译 + 480 Token 硬上限**：`core + model + host + persona + mode` 自由拼装，不留模糊漂移；
✅ **SHA-256 零漂移事务回滚**：每次写入留存完整备份与 `beforeSha`/`afterSha` 清单，外边改过文件默认拒绝盲目覆盖回滚；
✅ **自带本地可视化工作台**：一行 `promptkeel console` 启动 `127.0.0.1:7788` 控制台，编译、静态探针、计划管理、审计全在一个面板里；
✅ **持续多模型会话引擎**：拒答与代理封 IP 横幅不混入后续重放上下文，自带多端降级与家族先验学习。

MIT 完全开源，仓库带 224 项自动化测试与 30 分钟工程师上手手册，搜 GitHub `liangsiweiethan-wq/promptkeel` 就能玩！
#AI编程 #ClaudeCode #Codex #OpenCode #开源工具 #独立开发者
```
