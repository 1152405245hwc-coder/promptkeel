# 多平台 Agent/AI CLI 配置管理与注入项目调研

> 调研日期：2026-11-16。范围：agent-purge 加 6 个相似项目（另列 llm-switcher 作为零配置突变对照）。只采用项目自己的 GitHub 仓库、README、源码或测试目录。每条结论均给出 GitHub 直接来源和证据文件/符号；NOT_COVERED 表示本次未读到足够一手证据。

## 结论先行

1. 平台抽象有三条路线：宿主配置适配器（cc-switch2、agentsw、cc-switch-cli）；运行时注入（aweswitch、llm-switcher）；统一提示词/规则通道（agent-purge）。前者原生可见但需维护写回和重启语义，后者隔离并行会话但依赖 shim/代理或 CLI 参数，提示词通道必须严格区分“已写入”和“当前会话已读取”。
2. 可逆性最完整的是 agent-purge、cc-switch2 和 aweswitch：前者用原字节 stash、SHA 指纹、journal 恢复，后两者有首次写入备份/自动轮转或 restore。来源：[agent-purge restore.mjs](https://github.com/ZiChuanLan/agent-purge/blob/main/lib/restore.mjs#L35-L106)、[cc-switch2 备份与状态](https://github.com/aldmd/cc-switch2/blob/main/README.md#L475-L519)、[aweswitch launch/apply](https://github.com/Wehuman01/aweswitch/blob/main/README.md#L28-L33)。
3. 冲突检测最明确的是“写前快照 + 写后指纹 + 只撤回自有内容”。agent-purge 的 swapFile 记录 beforeHash/afterHash/operation/pid，若第三方改写则拒绝覆盖；llm-switcher README 声明 CAS writes；agentsw 用 dry-run、预检和 transaction backup。来源：[agent-purge restore.mjs](https://github.com/ZiChuanLan/agent-purge/blob/main/lib/restore.mjs#L35-L106)、[llm-switcher Switch Lifecycle](https://github.com/louisphamdev/llm-switcher/blob/main/README.md#L39-L47)、[agentsw dry-run/backup](https://github.com/tchivs/agentsw/blob/main/README.md#L19-L35)。
4. 权限边界最佳实践是本地、进程范围、无 OS 全局写入，其次是明确用户拥有字段：llm-switcher 不改宿主配置和 OS trust store；agent-purge 只撤销自己标记/拥有的块；cc-switch2 只替换 endpoint/key/model 等 provider-owned 字段。来源：[llm-switcher CA 边界](https://github.com/louisphamdev/llm-switcher/blob/main/README.md#L97-L110)、[agent-purge README](https://github.com/ZiChuanLan/agent-purge/blob/main/README.md#L23-L30)、[cc-switch2 key fields](https://github.com/aldmd/cc-switch2/blob/main/README.md#L475-L479)。
5. 测试证据差异很大：agent-purge 给出九宿主、四模式、隔离 HOME 的真实请求抓包，并明确未验证项；agentsw 与 aweswitch 有 tests 目录；cc-switch2/cc-switch-tui 有 tests/workflow 入口但本次未逐项读取；cc-switch-cli package.json 只有 start/build，未见自动化测试脚本。来源：[agent-purge compatibility](https://github.com/ZiChuanLan/agent-purge/blob/main/docs/compatibility.md#L4-L31)、[agentsw scripts](https://github.com/tchivs/agentsw/blob/main/package.json#L34-L40)、[aweswitch tests](https://github.com/Wehuman01/aweswitch#L170-L183)、[cc-switch2 tests](https://github.com/aldmd/cc-switch2#L177-L190)、[cc-switch-cli package](https://github.com/OpenCils/cc-switch-cli/blob/main/package.json#L8-L12)。

## 对比矩阵

| 项目 | 平台抽象 | 状态/回滚 | 配置注入 | 冲突检测 | 权限边界 | 测试证据 |
|---|---|---|---|---|---|---|
| agent-purge | backends + install/slash/shim/project channels；每 harness 声明能力 | 独立 ~/.agent-purge；journal、原字节 backup、crash handlers | system/developer prompt、slash、PATH shim、规则文件；replace/strict/append/off | journal 锁、PID 存活、before/after SHA；冲突保留 journal | loopback；只清理自有 marker/块；不改宿主模型工具 | 九宿主×四模式隔离 HOME 真实抓包 |
| cc-switch2 | 每工具 adapter；Switch 单活跃与 Coexist 多 provider；Direct/Routing/Aggregation | SQLite cc-switch.db、live-first-write、自动 backup、live-state | 宿主原生 config；本地 routing/格式转换/failover；MCP/Skills/Prompts | key-fields-only、首次写入备份、删除活跃 provider 前置切换 | 仅写 endpoint/key/model 等 owned fields；OAuth 风险明示 | 仓库 tests/；本次未执行 |
| cc-switch-cli | 检测 Windows/native macOS/Linux/WSL installation；per-installation provider | ~/.cc-switch.json；~/.cc-switch-ato/；端口持久化 | settings.json/config.toml/openclaw.json；ATO proxy | 端口冲突顺延并持久化；文件冲突未证实 | TUI 写 key/base URL/model；退出 keep/stop ATO | package 只有 start/dev/build，未见测试脚本 |
| agentsw | protocol provider store；9 个 agent adapter；按环境变量解析目录 | ~/.config/agentsw/config.json；transaction backup；dry-run 不保存 | 只写 owns fields；use/sync 批量推送；只读导入 cc-switch | dry-run redacted diff、preflight、格式位置错误、provider 去重 | hand-tuned fields/comments 保留；--json 不输出 body | test/*.test.ts、CI、typecheck |
| aweswitch | profiles.api 与 profiles.accounts；Claude/Codex/OpenCode/zcode | launch 无写入；apply 首次 backup；config restore | CLI 参数、env、Codex -c、OpenCode additive upsert | profile/account 全局唯一；OpenCode model overlap 拒绝 | \${VAR} 引用；show 脱敏；launch 进程隔离 | 仓库 tests/；本次未运行 |
| cc-switch-tui | Provider/MCP/Prompts/Skills 统一 store；多 app adapter | SQLite cc-switch.db；backups keep 10；import/export/reset | TOML/JSON/live-config、prompt files、skills symlink/copy | env check、config validate、unmanaged scan；算法未完全读取 | Safe Live Sync 默认不创建未初始化目录 | README 命令、workflow；本次未执行 |
| llm-switcher | 127.0.0.1 gateway；Claude/Codex/Antigravity inbound 到多 upstream | config.json；Switch Lifecycle CAS；background service | PATH shim + 进程内 HTTPS_PROXY/CA；不写宿主 config | README 声明 CAS、TLS domain constraints；实现未逐项读取 | 不改 OS trust store；CA 0600、nameConstraints | tests/、verify-gateway.mjs；本次未执行 |

## 项目证据

### 1. ZiChuanLan/agent-purge（基准项目）

- 统一入口：lib/apply.mjs 的 applyConfiguration、changeChannel、effectFor 让 CLI/Web 共用应用路径，明确 next-launch/next-turn/next-session。来源：[lib/apply.mjs](https://github.com/ZiChuanLan/agent-purge/blob/main/lib/apply.mjs#L0-L35)。
- 状态与回滚：sync 计算 revision、记录 lastApply、逐通道返回 written/failed，支持 onlyFailed 重试。restore.mjs 的 swapFile 使用 journal、PID、原 bytes、beforeHash/afterHash；第三方改写时 restore 拒绝覆盖并保留 journal。来源：[lib/apply.mjs](https://github.com/ZiChuanLan/agent-purge/blob/main/lib/apply.mjs#L37-L134)、[lib/restore.mjs](https://github.com/ZiChuanLan/agent-purge/blob/main/lib/restore.mjs#L35-L106)。
- 注入与权限：install/slash/shim/project 分模块实现；project 默认写规则文件并支持 diff/SHA 冲突，卸载只撤托管内容；控制台 loopback，数据与安装目录分离。来源：[README.md](https://github.com/ZiChuanLan/agent-purge/blob/main/README.md#L23-L30)、[docs/architecture.md](https://github.com/ZiChuanLan/agent-purge/blob/main/docs/architecture.md#L4-L20)。
- 测试：隔离 HOME、配置和本地 provider，九宿主 off/strict/replace/append 共 36 次真实主请求；逐项列出热切成功或未验证。来源：[docs/compatibility.md](https://github.com/ZiChuanLan/agent-purge/blob/main/docs/compatibility.md#L4-L22)、[package.json](https://github.com/ZiChuanLan/agent-purge/blob/main/package.json#L35-L51)。

### 2. aldmd/cc-switch2（桌面型综合管理）

- 平台抽象：十个工具；Switch 为单活跃 provider，Coexist 可并存；Direct/Routing/Aggregation 分离传输语义。来源：[README.md](https://github.com/aldmd/cc-switch2/blob/main/README.md#L310-L320)、[Supported Features](https://github.com/aldmd/cc-switch2/blob/main/README.md#L389-L407)。
- 状态与回滚：SQLite cc-switch.db 保存 providers/MCP/prompts/skills/projects；live-state.json 保存路由状态；首次重写前 live-first-write，定期备份默认保留 10 份，Codex OAuth 有 stash。来源：[README.md](https://github.com/aldmd/cc-switch2/blob/main/README.md#L448-L453)、[README.md](https://github.com/aldmd/cc-switch2/blob/main/README.md#L509-L519)。
- 配置与冲突：只替换 endpoint/key/model/API protocol 等 provider fields，保留插件/hooks/权限/MCP/env/注释；删除单活跃 provider 前必须先切换；Routing 用 loopback 与 PROXY_MANAGED，退出写回 Direct。来源：[README.md](https://github.com/aldmd/cc-switch2/blob/main/README.md#L475-L500)。
- 测试：仓库有 tests/，但本次未执行或读取测试实现，标记 NOT_COVERED。来源：[文件列表](https://github.com/aldmd/cc-switch2#L177-L190)。

### 3. OpenCils/cc-switch-cli（TUI + ATO 代理）

- 平台抽象：检测 Windows、本机 Linux/macOS、WSL installation；原生写回 settings.json/config.toml/openclaw.json。来源：[README.md](https://github.com/OpenCils/cc-switch-cli#L204-L225)。
- 状态与注入：~/.cc-switch.json 保存 provider/active state；~/.cc-switch-ato/ 保存进程记录；ATO 将 Anthropic 转换为 OpenAI Responses，默认 18653，端口占用时顺延并持久化。来源：[README.md](https://github.com/OpenCils/cc-switch-cli#L221-L256)。
- 冲突与权限：退出时显式 keep/stop ATO；配置写入前备份、字段级冲突、权限降级在 README 未证明，NOT_COVERED。来源：[README.md](https://github.com/OpenCils/cc-switch-cli#L215-L227)。
- 测试：package.json 只有 start/dev/build；未看到自动化测试脚本。来源：[package.json](https://github.com/OpenCils/cc-switch-cli/blob/main/package.json#L8-L12)。

### 4. tchivs/agentsw（CLI provider adapter）

- 平台抽象：统一 OpenAI/Anthropic provider store，写入九个 agent；每 adapter 按宿主配置目录变量解析。来源：[README.md](https://github.com/tchivs/agentsw/blob/main/README.md#L1-L7)、[Supported apps](https://github.com/tchivs/agentsw/blob/main/README.md#L131-L151)。
- 状态/回滚/注入：config.json 为 store；提交已有配置产生 transaction backup；--dry-run 输出脱敏 diff 且不保存；只写 owns fields，扩展字段和 YAML 注释保留。来源：[README.md](https://github.com/tchivs/agentsw/blob/main/README.md#L19-L35)、[README.md](https://github.com/tchivs/agentsw/blob/main/README.md#L126-L156)。
- 冲突/权限：import 以 protocol+normalized endpoint+credentials 去重；错误返回文件/位置；批量 sync 预解析 IDs，失败 non-zero。来源：[README.md](https://github.com/tchivs/agentsw/blob/main/README.md#L157-L176)、[README.md](https://github.com/tchivs/agentsw/blob/main/README.md#L241-L279)。
- 测试：test/*.test.ts、CI、typecheck 可见；本次未执行。来源：[package.json](https://github.com/tchivs/agentsw/blob/main/package.json#L34-L40)。

### 5. Wehuman01/aweswitch（运行时 profile launcher）

- 抽象与注入：profiles.api 与 profiles.accounts 分层；launch 只给新进程注入，apply 才写持久配置。Claude 用 --settings env，Codex 用 -c/env，OpenCode additive provider。来源：[README.md](https://github.com/Wehuman01/aweswitch/blob/main/README.md#L28-L33)、[README.md](https://github.com/Wehuman01/aweswitch/blob/main/README.md#L599-L609)。
- 可逆与权限：apply 首次 backup，可 config restore；token 用 \${VAR_NAME} 引用，show/config show 对 token/key/secret/password/auth 脱敏，账号 credential blob 全面遮蔽。来源：[README.md](https://github.com/Wehuman01/aweswitch/blob/main/README.md#L624-L631)、[README.md](https://github.com/Wehuman01/aweswitch/blob/main/README.md#L658-L682)。
- 冲突：profile/account 全局唯一；OpenCode Chat/Responses model overlap 拒绝。来源：[README.md](https://github.com/Wehuman01/aweswitch/blob/main/README.md#L624-L631)、[README.md](https://github.com/Wehuman01/aweswitch/blob/main/README.md#L721-L731)。
- 测试：仓库有 tests/；本次未执行 Python 测试。来源：[文件列表](https://github.com/Wehuman01/aweswitch#L170-L183)。

### 6. handy-sun/cc-switch-tui（Tauri/TUI 综合管理）

- 平台抽象：provider 覆盖 Claude/Codex/Gemini/OpenCode/OpenClaw；MCP、prompts、skills 统一 store，向 TOML/JSON/Markdown 目标同步；skills 支持 symlink/copy。来源：[README.md](https://github.com/handy-sun/cc-switch-tui/blob/main/README.md#L331-L365)、[README.md](https://github.com/handy-sun/cc-switch-tui/blob/main/README.md#L376-L391)。
- 状态/回滚：SQLite ~/.cc-switch-tui/cc-switch.db，backups 保留 10；backup/restore/import/export/reset 命令。来源：[README.md](https://github.com/handy-sun/cc-switch-tui/blob/main/README.md#L397-L434)、[README.md](https://github.com/handy-sun/cc-switch-tui/blob/main/README.md#L480-L501)。
- 权限/冲突：Safe Live Sync 默认跳过未初始化 app，避免意外创建目录；env check、config validate、unmanaged scan 可见，但冲突算法未完全读取。来源：[README.md](https://github.com/handy-sun/cc-switch-tui/blob/main/README.md#L444-L450)。
- 测试：README 给出 speedtest/stream-check/config validate，仓库含 workflow 与 src-tauri；本次未执行。来源：[README.md](https://github.com/handy-sun/cc-switch-tui/blob/main/README.md#L331-L360)、[文件列表](https://github.com/handy-sun/cc-switch-tui#L168-L185)。

### 7. louisphamdev/llm-switcher（网络边缘、零配置突变）

- 抽象：127.0.0.1:3456 gateway 统一 Claude Messages、Codex Responses、Antigravity Code Assist 到 OpenAI Chat/Anthropic/Vertex。来源：[README.md](https://github.com/louisphamdev/llm-switcher/blob/main/README.md#L0-L5)、[README.md](https://github.com/louisphamdev/llm-switcher/blob/main/README.md#L28-L47)。
- 注入/权限：PATH shim 只向当前进程注入 HTTPS_PROXY 和临时 CA；不读写宿主 config，不改 OS trust store，无 sudo；CA 0600 且 nameConstraints 限域。来源：[README.md](https://github.com/louisphamdev/llm-switcher/blob/main/README.md#L97-L110)、[README.md](https://github.com/louisphamdev/llm-switcher/blob/main/README.md#L112-L127)。
- 冲突/测试：README 标注 CAS configuration writes；仓库有 state.mjs、switch.mjs、tests/、verify-gateway.mjs，并声明 48 个 live response combinations；具体执行本次未覆盖。来源：[README.md](https://github.com/louisphamdev/llm-switcher/blob/main/README.md#L39-L47)、[文件列表](https://github.com/louisphamdev/llm-switcher#L161-L212)。

## 可复用设计结论

- 适配器合同至少声明：配置路径解析、拥有字段/marker、注入通道、热切语义、卸载方式、能力状态（OK/FAILED/NOT_COVERED）。可借鉴 agent-purge 的 capsFor/effectFor 与 agentsw 的逐 app 路径解析。
- Provider state 与 live state 分开：保存目标、文件已写入、宿主需重启、当前会话未读取应是不同状态。
- 写入闭环：dry-run 脱敏 diff → preflight（路径/格式/冲突）→ 原字节 backup + before/after hash → 原子写入 → runtime probe；第三方改写时失败并保留证据。
- 默认最小权限：优先运行时注入；必须写宿主时只写 owned fields/托管 marker；API key 用环境变量引用、日志脱敏、路径 0600；不默认安装 OS trust root。
- 测试必须含真实请求与边界：隔离 HOME、本地 provider、四模式、热切/重启、用户冲突、并发写入、卸载恢复、权限失败。任何未实测平台标记 NOT_COVERED。

## 证据边界

本记录依赖 GitHub 公开 main 分支页面/原始文件；未运行外部项目、未读取未公开 issue/PR、未验证供应商条款和真实凭据行为。README 能力宣称只作为项目声明；只有列出抓包、测试入口或源码符号的部分才作为实现证据。
