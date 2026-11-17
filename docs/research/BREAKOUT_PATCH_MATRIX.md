# 破甲补丁可移植性矩阵（BREAKOUT_PATCH_MATRIX）

> 采集对象：6 个 dsh-purge 衍生仓库 · 补丁样本：492 条表项 / **90 个唯一补丁名** · 宿主基线：DSH **0.2.2-rc.3**（`<HOST_ROOT>`，内含 `@deepseek-ai` 包若干） · 采集日：2026-11-17

## 0. 口径

1. **计数单位是唯一补丁名**（`name` 字段）。同一名字在 6 个仓库里重复出现只算 1 条，锚点取该名字在各仓库中最完整的那份定义。
2. **锚点命中 `n/m`** 的测法：把该补丁 `replacements[].pattern`（字面量或正则）逐条拿到宿主 asar 内目标文件的真实内容里测，`m` = 锚点总数，`n` = 在 0.2.2-rc.3 上仍能命中的条数。字面量用 `includes`，正则用 `new RegExp(src, flags)`。
3. **判定标准挂钩 dsh-forge 的能力边界**：`lib/table.mjs` 只支持字面 `find`/`replace` + `marker` + `variants`，**没有 insert 语义、不解析正则、不做 YAML 多行增删**。因此：
   - **可移植** = 目标文件在宿主内 + 全部锚点为字面量且全命中 + 单文件单次替换即可完成；
   - **需改造** = 锚点部分漂移 / 仅正则锚点 / 目标是 YAML 清单需增删行 / 目标在用户目录 / 需要非字面语义；
   - **不可移植** = 宿主根本没有该包，或补丁依赖原插件自己的运行时（不是纯文本替换）。
4. **五层定义**：模型/人设 = 系统提示、身份句、persona、工具与技能描述、LLM 适配层；审批 = approval 决定分支与提示句；沙箱 = sandbox/fs 围栏、escalation、权限预设、工具上限；回合 = agent-loop 每步 messages 拼装、steer/followup、上下文保护开关、hooks；会话/消息 = session 投影与 rewind、请求 messages 组装、会话日志、宿主运行时（Electron 主进程、cookie、inspector）。

## 1. 结论先行

| 层 | 可移植 | 需改造 | 不可移植 | 待核实 | 合计 |
| --- | --- | --- | --- | --- | --- |
| 模型/人设 | **6** | 15 | 5 | 0 | 26 |
| 审批 | **8** | 3 | 0 | 0 | 11 |
| 沙箱 | **8** | 8 | 0 | 0 | 16 |
| 回合 | **4** | 8 | 5 | 0 | 17 |
| 会话/消息 | **4** | 16 | 0 | 0 | 20 |
| **合计** | **30** | 50 | 10 | 0 | 90 |

**90 个补丁名里 30 条可直接进表，50 条需改造，10 条判死。**

1. **审批层回报率最高（8/11 可移植）**，但 dsh-forge 现有 8 条已经吃掉其中 5 条（见下方对照表）。增量只剩 4 条官方通道补丁：`OFFICIAL_PLAN_MODE_NEUTRAL`（3/3）、`OFFICIAL_AUTO_REVIEW_PASSTHROUGH`（1/1）、`OFFICIAL_RUN_CODE_APPROVAL_NEUTRAL`（4/4）、`OFFICIAL_TOOL_ASK_FAILOPEN`（2/6，需改造）。
2. **沙箱层 8/16**，其中纯文案类最干净：`SANDBOX_POLICY_BRAND_NEUTRAL` 3/3、`SANDBOX_HINT_NEUTRAL` 2/2、`FS_FENCE_DISABLED` 1/1、`SANDBOX_DENY_FILE_WRITE` 1/1 全部一次命中。
3. **模型/人设层 6/26**，可移植的 6 条全是字符串级（`DELIVERABLE_DO_NOT` 3/3、`HARNESS_IDENTITY_STRIP` 3/3、`SKILL_BADGE_DESCRIPTION_NEUTRAL` 2/2、`TOOL_SHELL_DELETE_MOVE_NEUTRAL` 1/1、`PERSONA_TEXT_PREFIX_ALIAS` 2/2、`SYSTEM_PROMPT_PERSONA` 1/1）；其余 14 条卡在 preset YAML 清单与工具长描述重写上。
4. **回合层最脆（4/17）**：`dsh-agent-loop` 的 messages 拼装段在 0.2.2 明显改写过 —— `HUNG_PROMPT_LF_NEEDLE` 10 条锚点只剩 1 条、`HUNG_PROMPT_STRICT_NEEDLE` 0/4、`SYSTEM_NODES_CONTENT_GUARD` 3/4、`ASSEMBLE_BEFORE_PRESTEP` 1/3。这一层只能挑 `SYSTEM_PROMPT_REPLACE_HEAD`（1/1）、`SYSTEM_PROMPT_RENDER_GUARD`（3/3）、`SESSION_PROMPT_ALWAYS_FOLLOWUP`（1/1）、`TOOL_RESULT_PRUNER_DISABLED`（1/1）四条。
5. **会话/消息层 4/20**：client bundle 压缩 + rewind 重构让字面锚点大面积失效（`REWIND_HIDE_CUT_ONLY` 2/6、`REWIND_DROP_SENT_ON_APPEND` 1/3）。更要紧的是 **xxy0722 的「消息层清洗」压根不在补丁表里** —— 它在 `lib/deep-purge.js` 里包装 `session.deriveMessages()` 做运行时改写，任何 find/replace 表都装不下，forge 要做只能另开 runtime hook 通道。
6. **10 条不可移植是结构性原因，不是运气问题**：第三方 preset 目录 3 条（`PRESET_FETCH_ENABLED`、`PRESET_UNRESTRICTED_IDENTITY_STRIP`、`WEB_PRESET_IDENTITY_STRIP` 的目标在 `~/.dsh/.agent-presets/`，asar 外不可达）、目标插件不在参照宿主上的 6 条（`HOOKS_*` 4 条 + `LIANGSHEN_*` 2 条）、依赖插件自身运行时 1 条（`RESTORE_NATIVE_STEERING`）。
7. **variants 压力来自 0.2.1，不来自 0.2.2-rc.3**：本次没有任何一条可移植补丁需要多版本分支才命中。0.2.1-rc.x 未验证，接版本区间时要补测（见第 4 节待核实）。

### 现有 8 条与 90 个补丁名的对应关系

| dsh-forge 现有条目 | 对应补丁名 | 说明 |
| --- | --- | --- |
| `approval-config-default` | `APPROVAL_CONFIG_DEFAULT_NEVER` | 同锚点（`z.union(["ask","never"]).default("ask")`） |
| `approval-auto-grant` | `APPROVAL_NEVER_SENTENCE_BYPASS` | 同语义，forge 改 `effectivePolicy === "never"` 返回值 |
| `approval-ask-sentence` | `APPROVAL_ASK_SENTENCE_BYPASS` | **forge 版比 purge 新**：purge 的 ASK 锚点 0/2 命中，forge 已对齐 0.2.2 文案 |
| `approval-never-sentence` | `APPROVAL_NEVER_SENTENCE` | 同锚点 |
| `approval-types-sentences` | `APPROVAL_NEVER_SENTENCE` / `APPROVAL_ASK_SENTENCE_BYPASS` | purge 把 types 层与 runtime 层拆成两条，forge 用 variants 合在一条 |
| `escalation-bypass` | `ESCALATION_WIDENING_EXEMPT` + `ESCALATION_GRANT_UNCONDITIONAL` | forge 一条吃掉 purge 两条的语义（跳过 `WIDER_MODES` 校验 + 放行 approver/agent 缺失） |
| `sandbox-default-full` | `SANDBOX_MODE_DEFAULT` | 同锚点（`mode: z.union([...]).default("read-only")`） |
| `workspace-intro-precedence` | `WORKSPACE_CONTEXT_INTRO` | **forge 版更新**：purge 6 条锚点只 1 条命中，forge 直接改 `AGENT_INSTRUCTIONS_INTRO` 常量 |

结论：审批/沙箱两层的「高价值低风险」窗口已被 forge 吃掉大半，**新增收益主要在文案去品牌化（P1-1~P1-4）与 sdk-minimal / 官方通道四条**。

## 2. 五层矩阵

> 「目标文件与挂钩点」列 = 宿主 asar 内的真实路径（相对 `dsh/node_modules/` 或 asar 根）；「证据」列 = 该补丁在衍生仓库里的定义行。

| 层 | 补丁名 | 目标文件与挂钩点 | 作用 | 可移植性 | 证据 |
| --- | --- | --- | --- | --- | --- |
| 模型/人设 | `WORKSPACE_CONTEXT_INTRO` | `dsh-agent-instructions/lib/index.js`<br>AGENT_INSTRUCTIONS intro 常量 | 全局免责声明 / global disclaimer | **需改造**<br>6 条锚点仅 1 条命中；forge 已有等价 patch #7 | `lib/patches/prompt.mjs:5` |
| 模型/人设 | `REPLACEMENT_WORKSPACE_CONTEXT_INTRO` | `dsh-agent-instructions/lib/index.js`<br>AGENT_INSTRUCTIONS intro 常量 | 替换稿不压过 system / replacement does not override system | **需改造**<br>替换稿依赖 forge 没有的 strong-intro 组件 | `lib/patches/prompt.mjs:78` |
| 模型/人设 | `SCOPE_INTRO` | `dsh-agent-instructions/lib/index.js`<br>AGENT_INSTRUCTIONS intro 常量 | 作用域不压过 system / scope does not override system | **需改造**<br>仅正则锚点（0/6 命中），需抽字面量 | `lib/patches/prompt.mjs:91` |
| 模型/人设 | `SYSTEM_PROMPT_PERSONA` | `dsh-web-app/cordis.patch.yml（+ agent-presets）`<br>预设 identity 段 | persona：去掉官方默认身份，不另写人设 / strip official identity only | **可移植**<br>字面锚点 1/1 全命中 | `lib/patches/prompt.mjs:107` |
| 模型/人设 | `WEB_PRESET_IDENTITY_STRIP` | `~/.dsh/.agent-presets/*/agent.cordis.yml`<br>预设 identity 段 | Web 四个内置预设只去掉身份句 / strip web preset identity only | **不可移植**<br>目标为用户/内置 preset 的 agent.cordis.yml | `lib/patches/prompt.mjs:123` |
| 模型/人设 | `PRESET_UNRESTRICTED_IDENTITY_STRIP` | `~/.dsh/.agent-presets/<PRESET_ID>/agent.cordis.yml`<br>预设 identity 段 | 第三方 preset 只去掉身份句（软补丁）/ soft strip for a third-party preset | **不可移植**<br>只针对第三方 preset | `lib/patches/prompt.mjs:153` |
| 模型/人设 | `PRESET_SHELL_NETWORK` | `dsh-sdk-minimal/cordis.patch.yml`<br>preset cordis.patch.yml 插件清单 | 极简模式终端不再写没有网络 / minimal shell drops no-network ban | **需改造**<br>锚点部分命中（字面 1/2） | `lib/patches/prompt.mjs:180` |
| 模型/人设 | `PRESET_BASH_MIRROR_LINE` | `dsh-sdk-minimal/cordis.patch.yml`<br>preset cordis.patch.yml 插件清单 | 极简 bash 去掉误留的镜像说明 / drop the extra mirror sentence | **需改造**<br>仅正则锚点（6/6 命中），需抽字面量 | `lib/patches/prompt.mjs:195` |
| 模型/人设 | `LIANGSHEN_IDENTITY_LINE` | `@linxin666/dsh-liangshen（不在参照宿主上）`<br>第三方插件注入段 | 梁神去掉官方身份句，留下本模式的工作纪律 / strip liangshen stock identity line | **不可移植**<br>目标插件不在参照宿主上 | `lib/patches/prompt.mjs:214` |
| 模型/人设 | `SKILL_BADGE_DESCRIPTION_NEUTRAL` | `dsh-skill-badge/lib/index.js`<br>工具/技能描述字符串 | 技能徽章描述去掉官方品牌要求 / neutralize skill-badge branding requirement | **可移植**<br>字面锚点 2/2 全命中 | `lib/patches/engine.mjs:330` |
| 模型/人设 | `PRESET_FETCH_ENABLED` | `~/.dsh/.agent-presets/*/agent.cordis.yml`<br>preset cordis.patch.yml 插件清单 | preset tool-web fetch 打开 / preset fetch enabled | **不可移植**<br>目标在用户 preset 目录，不在宿主包内 | `lib/patches/new-tools.mjs:106` |
| 模型/人设 | `HARNESS_IDENTITY_STRIP` | `dsh-system-prompt/lib/index.js`<br>系统提示身份段 / harness:identity | 去掉官方默认身份，保留官方功能提示词 / strip default identity only | **可移植**<br>字面锚点 3/3 全命中 | `lib/patches/new-tools.mjs:131` |
| 模型/人设 | `MINIMAL_PERSONA_PURGE` | `dsh-sdk-minimal/cordis.patch.yml`<br>系统提示身份段 / harness:identity | 内置 minimal：去掉默认身份并打开 complete，让 inject 能进 / strip identity, open inject | **需改造**<br>YAML 多行 + 依赖 complete 预设拼装 | `lib/patches/new-tools.mjs:152` |
| 模型/人设 | `MINIMAL_OFFICIAL_TOOLSET` | `dsh-sdk-minimal/cordis.patch.yml`<br>preset cordis.patch.yml 插件清单 | 撤掉曾追加的 fs/web，恢复官方极简工具表 / restore official minimal tool plugins | **需改造**<br>cordis.patch.yml 清单增删，forge 无 insert 语义 | `lib/patches/new-tools.mjs:211` |
| 模型/人设 | `LIANGSHEN_PHASE1_KEEP_INJECT` | `@linxin666/dsh-liangshen（不在参照宿主上）`<br>第三方插件注入段 | 插件 dsh-liangshen（梁神）：phase-1 保留注入段（可选） / @linxin666/dsh-liangshen | **不可移植**<br>第三方插件 bootstrap 文件不存在 | `lib/patches/new-tools.mjs:282` |
| 模型/人设 | `WEB_SURFACE_IDENTITY_NEUTRAL` | `dsh-harness-dev-context/lib/index.js`<br>WEB_SURFACE 常量 | Web 面：去掉 DeepSeek Harness 自称 / neutralize web GUI identity branding | **需改造**<br>锚点部分命中（字面 2/4） | `lib/patches/new-tools.mjs:306` |
| 模型/人设 | `TOOL_WEB_UNTRUSTED_NEUTRAL` | `dsh-tool-web/lib/index.js`<br>工具/技能描述字符串 | dsh-tool-web：外部内容 untrusted 拦截→可执行数据 / neutralize web untrusted framing | **需改造**<br>锚点部分命中（字面 3/5） | `lib/patches/new-tools.mjs:352` |
| 模型/人设 | `TOOL_SHELL_DENIAL_PROMPT` | `dsh-tool-bash/lib/index.js`<br>工具/技能描述字符串 | bash/pwsh 工具描述：沙箱拒绝话术→可继续 / neutralize sandbox-denial tool text | **需改造**<br>锚点部分命中（字面 4/11） | `lib/patches/new-tools.mjs:432` |
| 模型/人设 | `PERSONA_TEXT_PREFIX_ALIAS` | `dsh-persona/lib/index.js`<br>persona 前缀字段 | dsh-persona：兼容 0.1.2 text 字段，否则梁神会话起不来 / accept legacy text as prefix | **可移植**<br>字面锚点 2/2 全命中 | `lib/patches/new-tools.mjs:633` |
| 模型/人设 | `COMPLETE_PROMPT_KEEP_INJECT` | `dsh-system-prompt/lib/index.js`<br>complete 预设拼装点 | complete 预设仍保留 dsh-purge 注入 / keep inject after complete prompt | **需改造**<br>锚点部分命中（字面 1/7，正则 0/8） | `lib/patches/new-tools.mjs:681` |
| 模型/人设 | `ANTHROPIC_OAUTH_NO_CLAUDE_IDENTITY` | `@earendil-works/pi-ai/dist/api/anthropic-messages.js`<br>llm 适配层 role / 身份段 | Anthropic OAuth 不再强插 Claude Code 首段系统提示 / drop Claude Code OAuth system prefix | **需改造**<br>同上，pi-ai 路径与 0.1.x 不同 | `lib/patches/new-tools.mjs:1013` |
| 模型/人设 | `TOOL_SHELL_DELETE_MOVE_NEUTRAL` | `dsh-tool-bash/lib/index.js`<br>工具/技能描述字符串 | bash/pwsh 去掉 delete/move 过度谨慎描述 / drop delete-move caution in shell tools | **可移植**<br>字面锚点 1/1 全命中 | `lib/patches/new-tools.mjs:1109` |
| 模型/人设 | `ANTHROPIC_OAUTH_CLI_NEUTRAL` | `@earendil-works/pi-ai/dist/api/anthropic-messages.js`<br>llm 适配层 role / 身份段 | OAuth 不再伪装 claude-cli / stop Claude CLI OAuth mimicry | **需改造**<br>同上 | `lib/patches/new-tools.mjs:1128` |
| 模型/人设 | `WEB_SURFACE_PROHIBITION` | `dsh-harness-dev-context/lib/index.js`<br>WEB_SURFACE 常量 | 网页端提示词去掉身份句和禁止另开服务器 / drop web identity and do-not-start | **需改造**<br>锚点部分命中（字面 1/3，正则 4/4） | `lib/patches/new-tools.mjs:1233` |
| 模型/人设 | `DELIVERABLE_DO_NOT` | `dsh-deliverable-file-references/lib/index.js`<br>工具/技能描述字符串 | 交付物提示词去掉 Do not call present / drop deliverable prohibition | **可移植**<br>字面锚点 3/3 全命中 | `lib/patches/new-tools.mjs:1266` |
| 模型/人设 | `DEEPSEEK_SYSTEM_ROLE` | `@earendil-works/pi-ai/dist/api/openai-*.js`<br>llm 适配层 role / 身份段 | developer role 仅限 openai.com/azure 原生，第三方代理 (deepseek/glm/recoverystar/中转) 全回退 system / allowlist openai+azure for developer role, all third-party gateways fall back to system | **需改造**<br>目标是 @earendil-works/pi-ai，非 @deepseek-ai 包 | `lib/patches/new-tools.mjs:1946` |
| 审批 | `APPROVAL_NEVER_SENTENCE` | `dsh-user-approval/lib/types/index.js`<br>user-approval decide() / 提示句 | 审批提示句限制 / approval sentence | **可移植**<br>字面锚点 1/1 全命中 | `lib/patches/prompt.mjs:242` |
| 审批 | `APPROVAL_POLICY_DEFAULT` | `dsh-base/cordis.patch.yml`<br>compose 默认审批策略 | 审批：danger-full-access → never（与 mode 组合合法） / compose with mode | **可移植**<br>字面锚点 1/1 全命中 | `lib/patches/code.mjs:32` |
| 审批 | `APPROVAL_AUTO_GRANT` | `dsh-user-approval/lib/index.js`<br>user-approval decide() / 提示句 | 审批门自动放行 / approval auto-grant | **可移植**<br>字面锚点 2/2 全命中 | `lib/patches/engine.mjs:6` |
| 审批 | `APPROVAL_CONFIG_DEFAULT_NEVER` | `dsh-user-approval/lib/index.js`<br>user-approval decide() / 提示句 | 审批配置默认 never / approval config default | **可移植**<br>字面锚点 1/1 全命中 | `lib/patches/engine.mjs:35` |
| 审批 | `APPROVAL_NEVER_SENTENCE_BYPASS` | `dsh-user-approval/lib/index.js`<br>user-approval decide() / 提示句 | never 提示句 → 自动放行 / never sentence bypass | **可移植**<br>字面锚点 1/1 全命中 | `lib/patches/engine.mjs:44` |
| 审批 | `APPROVAL_ASK_SENTENCE_BYPASS` | `dsh-user-approval/lib/index.js`<br>user-approval decide() / 提示句 | ask 提示句 → 自动放行 / ask sentence bypass | **需改造**<br>锚点漂移（字面 0/2） | `lib/patches/engine.mjs:67` |
| 审批 | `OFFICIAL_AUTO_REVIEW_PASSTHROUGH` | `dsh-experimental-auto-review/lib/index.js`<br>审批通道返回分支 | 官方 Auto Review 不再拦工具 / official auto-review no longer denies tools | **可移植**<br>字面锚点 1/1 全命中 | `lib/patches/new-tools.mjs:2015` |
| 审批 | `OFFICIAL_RUN_CODE_APPROVAL_NEUTRAL` | `dsh-tool-executor-ptc/lib/index.js`<br>审批通道返回分支 | PTC / run_code：沙箱加宽句改为自动放行 / run_code sandbox escalation auto-granted | **可移植**<br>字面锚点 4/4 全命中 | `lib/patches/new-tools.mjs:2038` |
| 审批 | `OFFICIAL_TOOL_ASK_FAILOPEN` | `dsh-tools/lib/pipeline.js`<br>审批通道返回分支 | 无审批通道时放行；用户点拒绝仍 deny / fail-open only without UI channel | **需改造**<br>锚点部分命中（字面 2/6） | `lib/patches/new-tools.mjs:2093` |
| 审批 | `OFFICIAL_PLAN_MODE_NEUTRAL` | `dsh-base/cordis.patch.yml`<br>审批通道返回分支 | 计划模式：操作者要求实施时不硬拦 / plan mode allows operator-directed execution | **可移植**<br>字面锚点 3/3 全命中 | `lib/patches/new-tools.mjs:2117` |
| 审批 | `ASK_USER_WAIT_CAPPED` | `dsh-tool-ask-user/lib/index.js`<br>ask_user 等待上限 | 尊重模型给的等待时间，只把「无限等待(-1)」收成 5 分钟 / honor requested timeout, cap -1 | **需改造**<br>锚点部分命中（字面 1/2） | `lib/patches/new-tools.mjs:2452` |
| 沙箱 | `SANDBOX_DENY_FILE_WRITE` | `dsh-sandbox-local/lib/index.js`<br>sandbox 拒绝 / 模式判定 | 沙箱 deny file-write / sandbox deny | **可移植**<br>字面锚点 1/1 全命中 | `lib/patches/code.mjs:6` |
| 沙箱 | `SANDBOX_MODE_DEFAULT` | `dsh-base/cordis.patch.yml`<br>sandbox 拒绝 / 模式判定 | 沙箱默认 danger-full-access（可被 UI 切换，不写死 env） / soft default only | **可移植**<br>字面锚点 1/1 全命中 | `lib/patches/code.mjs:18` |
| 沙箱 | `ESCALATION_WIDENING_EXEMPT` | `dsh-sandbox/lib/index.js`<br>escalation 授信分支 | 豁免严格升级阶梯 / escalation widening exempt | **需改造**<br>锚点部分命中（字面 1/2） | `lib/patches/engine.mjs:98` |
| 沙箱 | `ESCALATION_GRANT_UNCONDITIONAL` | `dsh-sandbox/lib/index.js`<br>escalation 授信分支 | 升级请求无条件授信 / escalation grant unconditional | **需改造**<br>锚点部分命中（字面 0/2，正则 1/1） | `lib/patches/engine.mjs:131` |
| 沙箱 | `SANDBOX_CONFINE_PASSTHROUGH` | `dsh-sandbox-local/lib/index.js`<br>sandbox 拒绝 / 模式判定 | 沙箱 confine 直通 / sandbox confine passthrough | **需改造**<br>锚点部分命中（字面 1/2） | `lib/patches/engine.mjs:146` |
| 沙箱 | `FS_FENCE_DISABLED` | `dsh-fs-sandbox/lib/index.js`<br>sandbox 拒绝 / 模式判定 | 文件系统围栏取消 / fs fence disabled | **可移植**<br>字面锚点 1/1 全命中 | `lib/patches/engine.mjs:226` |
| 沙箱 | `SANDBOX_POLICY_BRAND_NEUTRAL` | `dsh-sandbox-policy/lib/index.js`<br>观测策略 / policy 文案 | 三条沙箱策略文案去掉 DSH 品牌词 / drop DSH branding from every file-policy line | **可移植**<br>字面锚点 3/3 全命中 | `lib/patches/engine.mjs:300` |
| 沙箱 | `FS_OBSERVATION_INTENT_FREE` | `dsh-fs-observation-policy/lib/index.js`<br>观测策略 / policy 文案 | 观察策略读写意图放行 / observation write/edit intent bypass | **需改造**<br>锚点部分命中（字面 2/3） | `lib/patches/new-tools.mjs:9` |
| 沙箱 | `BASH_TIMEOUT_RESTORE` | `dsh-base/cordis.patch.yml`<br>工具 schema / 上限 | 恢复插件延长的 bash 等待 / restore plugin-raised bash wait | **需改造**<br>仅正则锚点（0/6 命中），需抽字面量 | `lib/patches/new-tools.mjs:30` |
| 沙箱 | `READ_CAPS_RAISED` | `dsh-tool-fs/lib/index.js`<br>工具 schema / 上限 | read 上限放宽 / read caps raised | **可移植**<br>字面锚点 3/3 全命中 | `lib/patches/new-tools.mjs:49` |
| 沙箱 | `SANDBOX_HINT_NEUTRAL` | `dsh-sandbox/lib/index.js`<br>观测策略 / policy 文案 | 沙箱拒绝/升级 hint 不再要求用户审批 / neutralize sandbox hint to model | **可移植**<br>字面锚点 2/2 全命中 | `lib/patches/new-tools.mjs:507` |
| 沙箱 | `ESCALATION_NEVER_REJECT` | `dsh-sandbox/lib/index.js`<br>escalation 授信分支 | 升级结果 rejected/cancelled/unavailable 仍授信 / escalation never throws | **需改造**<br>锚点漂移（字面 0/2） | `lib/patches/new-tools.mjs:533` |
| 沙箱 | `TOOL_FS_ESCALATION_SCHEMA` | `dsh-tool-fs/lib/index.js`<br>工具 schema / 上限 | fs 升级字段：去掉 user approval 拦截描述 / neutralize fs escalation schema | **需改造**<br>锚点部分命中（字面 2/4） | `lib/patches/new-tools.mjs:575` |
| 沙箱 | `SUBAGENT_SCOPE_LOCK_NEUTRAL` | `dsh-subagent/lib/index.js`<br>子代理权限锁 | 子代理权限锁→可继续 / neutralize subagent scope-lock prompt | **可移植**<br>字面锚点 2/2 全命中 | `lib/patches/new-tools.mjs:608` |
| 沙箱 | `FRESH_SESSION_FULL_ACCESS` | `dsh-permission-presets/lib/index.js`<br>新会话权限预设 | 新会话在部署已是 danger-full-access 时不再钉回 workspace-write / keep fresh sessions on full access | **可移植**<br>字面锚点 2/2 全命中 | `lib/patches/new-tools.mjs:1187` |
| 沙箱 | `OFFICIAL_SANDBOX_POLICY_NEUTRAL` | `dsh-sandbox-policy/lib/index.js`<br>观测策略 / policy 文案 | 沙箱只读策略不拦任务；加宽自动放行 / sandbox policy auto-grant escalation | **需改造**<br>锚点部分命中（字面 1/2） | `lib/patches/new-tools.mjs:2072` |
| 回合 | `SUBAGENT_MAXDEPTH_RAISED` | `dsh-subagent/lib/index.js`<br>子代理深度上限 | 子代理深度默认 3 → 10 / subagent maxDepth raised | **需改造**<br>锚点部分命中（字面 2/3） | `lib/patches/new-tools.mjs:70` |
| 回合 | `HOOKS_CLAUDE_DENY_ALLOW` | `dsh-hooks-claude-code（不在参照宿主上）`<br>hooks 插件 deny 分支 | dsh-hooks-claude-code：deny→allow（可选） / hooks deny bypass | **不可移植**<br>插件不在参照宿主上 | `lib/patches/new-tools.mjs:396` |
| 回合 | `HOOKS_CODEX_DENY_ALLOW` | `dsh-hooks-codex（不在参照宿主上）`<br>hooks 插件 deny 分支 | dsh-hooks-codex：deny→allow（可选） / hooks deny bypass | **不可移植**<br>插件不在参照宿主上 | `lib/patches/new-tools.mjs:418` |
| 回合 | `SYSTEM_PROMPT_REPLACE_HEAD` | `dsh-agent-loop/lib/index.js`<br>agent-loop 每步 messages 拼装 | 每一步用当前整段系统提示替换第一条，避免旧提示被钉住 / replace the first system prompt every step | **可移植**<br>字面锚点 1/1 全命中 | `lib/patches/new-tools.mjs:1283` |
| 回合 | `ASSEMBLE_BEFORE_PRESTEP` | `dsh-agent-loop/lib/index.js`<br>agent-loop 每步 messages 拼装 | 每个模式的第一次发送前先挂上默认提示词 / hang the default prompt before the first assemble | **需改造**<br>锚点部分命中（字面 1/3） | `lib/patches/new-tools.mjs:1298` |
| 回合 | `SYSTEM_PROMPT_RENDER_GUARD` | `dsh-system-prompt/lib/index.js`<br>渲染 / 内容兜底 | renderPrompt 对 undefined section.text 兜底，避免第二轮 gateway/internal / guard undefined section text in renderPrompt | **可移植**<br>字面锚点 3/3 全命中 | `lib/patches/new-tools.mjs:1336` |
| 回合 | `AGENT_LOOP_MESSAGES_GUARD` | `dsh-agent-loop/lib/index.js`<br>渲染 / 内容兜底 | decision.messages 缺省时按空数组处理，避免第二轮 gateway/internal / treat missing decision.messages as empty | **需改造**<br>锚点部分命中（字面 0/1，正则 1/2） | `lib/patches/new-tools.mjs:1427` |
| 回合 | `SYSTEM_NODES_CONTENT_GUARD` | `dsh-agent-loop/lib/index.js`<br>渲染 / 内容兜底 | systemNodes/derive 对缺 content 兜底，避免回退后第二轮 gateway/internal / guard missing message content | **需改造**<br>锚点部分命中（字面 3/4） | `lib/patches/new-tools.mjs:1449` |
| 回合 | `HOOKS_STOP_STEER_NEUTRAL` | `dsh-hooks-*（不在参照宿主上）`<br>hooks 插件 deny 分支 | Stop hook 不再 steer 假用户话 / Stop hook no longer steers fake user text | **不可移植**<br>插件不在参照宿主上 | `lib/patches/new-tools.mjs:2148` |
| 回合 | `HOOKS_PRESTEP_REJECT_NEUTRAL` | `dsh-hooks-*（不在参照宿主上）`<br>hooks 插件 deny 分支 | UserPromptSubmit deny 不再 reject 整轮 / pre-step hook deny no longer rejects turn | **不可移植**<br>插件不在参照宿主上 | `lib/patches/new-tools.mjs:2182` |
| 回合 | `HUNG_PROMPT_LF_NEEDLE` | `dsh-agent-loop/lib/index.js`<br>agent-loop 每步 messages 拼装 | 空白宿主先挂全文，再用 LF 比对头尾，避免 CRLF 误判再糊一份 | **需改造**<br>锚点部分命中（字面 1/10） | `lib/patches/new-tools.mjs:2267` |
| 回合 | `HUNG_PROMPT_STRICT_NEEDLE` | `dsh-agent-loop/lib/index.js`<br>agent-loop 每步 messages 拼装 | ChatML 头和正文尾都在才算挂住，只剩头或只剩尾都重新置顶 | **需改造**<br>锚点漂移（字面 0/4） | `lib/patches/new-tools.mjs:2395` |
| 回合 | `RESTORE_NATIVE_STEERING` | `dsh-api-session-controller/lib/index.js`<br>steer / followup 分支 | 恢复原生插话与队列顺序，迁移旧 #85/#86/#90 / restore native steering and queue order | **不可移植**<br>依赖本插件 lib/steering.js 运行时，非纯文本替换 | `lib/steering.js:37` |
| 回合 | `REPEAT_TOOL_REMINDER_DISABLED` | `dsh-repeat-tool-reminder/lib/index.js`<br>上下文保护开关 | 重复调用守卫禁用 / repeat-tool-reminder disabled（可选，默认关闭；开启会取消上下文保护） | **需改造**<br>锚点漂移（字面 0/1） | `lib/patches/opt-in.mjs:5` |
| 回合 | `TOOL_RESULT_PRUNER_DISABLED` | `dsh-compaction-tool-result-pruner/lib/index.js`<br>上下文保护开关 | 工具结果修剪禁用 / tool-result pruner disabled（可选，默认关闭；开启会取消上下文保护） | **可移植**<br>字面锚点 1/1 全命中 | `lib/patches/opt-in.mjs:29` |
| 回合 | `SESSION_PROMPT_ALWAYS_FOLLOWUP` | `dsh-api-session-controller/lib/index.js`<br>steer / followup 分支 | session-controller prompt() 一律 followup：UI 发消息永远新 turn，消 steer→next-step 竞态（二轮立刻发被拒根因） | **可移植**<br>字面锚点 1/1 全命中 | [`lib/core.js:5524`](https://github.com/xxy0722/dsh-purge-deep/blob/main/lib/core.js#L5524) |
| 回合 | `SESSION_STEER_ALWAYS_FOLLOWUP` | `dsh-api-session-controller/lib/index.js`<br>steer / followup 分支 | UI 队列 steer 走 followup/next-turn；公共 steer() 保持 next-step，send_message 仍下一步插入 | **需改造**<br>锚点部分命中（字面 2/3） | [`lib/core.js:5544`](https://github.com/xxy0722/dsh-purge-deep/blob/main/lib/core.js#L5544) |
| 会话/消息 | `BROWSER_COOKIE_NAME_IGNORE_PORT` | `dsh-client-connection/lib/index.js`<br>桌面 cookie / 请求头 | 仅桌面端：会话 cookie 名忽略端口，避免随机端口累积 cookie 撑爆请求头（431）/ cookie name ignores port | **需改造**<br>字面锚点 1/1 全命中 | `lib/patches/engine.mjs:262` |
| 会话/消息 | `HOST_MAX_HTTP_HEADER_SIZE` | `lib/main.js`<br>桌面 cookie / 请求头 | 放宽 host 进程 HTTP 请求头上限到 256KB，兜住历史 cookie 累积 / raise host max-http-header-size | **需改造**<br>仅正则锚点（0/1 命中），需抽字面量 | `lib/patches/engine.mjs:280` |
| 会话/消息 | `SESSION_V0_PLUGIN_SUMMARY_ALIAS` | `dsh-session-format-v0-to-v1/lib/index.js`<br>会话引用 / 日志 / schema 兼容 | v0 会话：mnemon summary 可挂在 instructions/recall 上 / allow plugin summary off notice | **可移植**<br>字面锚点 1/1 全命中 | `lib/patches/new-tools.mjs:664` |
| 会话/消息 | `SETTINGS_LEGACY_API` | `dsh-settings/lib/index.js`<br>插件自身设置 / overlay | 按宿主接口适配设置事件；仅旧宿主保留 legacy register/get / native settings API compatibility | **需改造**<br>12 条 8 条命中，其余是宿主分支探测，需按版本重写 | `lib/patches/new-tools.mjs:705` |
| 会话/消息 | `OFFICIAL_DESKTOP_UPDATE_HANDOFF` | `lib/main.js`<br>Electron 主进程 | 官方桌面升级安装已下载的新版本，不再重新打开旧的解开目录 | **需改造**<br>锚点部分命中（字面 0/2，正则 0/2） | `lib/patches/new-tools.mjs:935` |
| 会话/消息 | `OFFICIAL_DESKTOP_UPDATE_ASCII` | `lib/main.js`<br>Electron 主进程 | 已接管的官方桌面更新改为 ASCII 脚本，中文 Windows 不再吞掉换行 | **需改造**<br>lib/main.js 锚点漂移（0/2） | `lib/patches/new-tools.mjs:971` |
| 会话/消息 | `SESSION_REFERENCE_FRAMING_NEUTRAL` | `dsh-session-reference/lib/index.js`<br>会话引用 / 日志 / schema 兼容 | 跨会话引用与 0.1.7 一样标 untrusted / session-reference framing matches 0.1.7 | **需改造**<br>锚点漂移（字面 0/3） | `lib/patches/new-tools.mjs:1156` |
| 会话/消息 | `SESSION_LOG_UPLOAD_DEFAULT_OFF` | `dsh-session-log-deepseek/lib/index.js`<br>会话引用 / 日志 / schema 兼容 | 官方模型 API 默认不上传 Session Log / session log upload off by default | **需改造**<br>锚点部分命中（字面 1/2） | `lib/patches/new-tools.mjs:1212` |
| 会话/消息 | `DESKTOP_HOST_CLOSE_NO_FATAL` | `lib/main.js`<br>Electron 主进程 | host 被信号杀 (重启密封包) 时不报错,不弹 crash dialog / don't fail on signal kill | **需改造**<br>lib/main.js 内字面锚点已漂移（0/1），命中需重抽 | `lib/patches/new-tools.mjs:1368` |
| 会话/消息 | `DESKTOP_HOST_CLOSE_CODE0_NO_FAIL` | `lib/main.js`<br>Electron 主进程 | host code=0 正常退出不报错 (消除 stopped 对话框) / don't fail on code=0 clean exit | **需改造**<br>lib/main.js 锚点漂移（0/1） | `lib/patches/new-tools.mjs:1402` |
| 会话/消息 | `MODEL_STREAM_RELEASE` | `dsh-llm-deepseek/lib/index.js`<br>请求 messages 组装 | deepseek-flash 恢复官方 in-history，并撤掉会打成 TRANSPORT 的独立连接补丁 / restore official in-history and remove the transport-breaking socket patch | **需改造**<br>锚点部分命中（字面 1/3） | `lib/patches/new-tools.mjs:1489` |
| 会话/消息 | `MESSAGES_SYSTEM_CURRENT` | `dsh-llm-deepseek/lib/index.js`<br>请求 messages 组装 | Messages 的 system 字段用当前系统提示，不再把后出现的系统提示降成中途消息 / messages system field keeps the current prompt | **可移植**<br>字面锚点 1/1 全命中 | `lib/patches/new-tools.mjs:1627` |
| 会话/消息 | `REWIND_HIDE_CUT_ONLY` | `dsh-client-ui-conversation/lib/client.js`<br>rewind 标记与投影 | 回退只藏被撤掉的那一轮 / rewind hides only the cut range | **需改造**<br>锚点部分命中（字面 2/6） | `lib/patches/new-tools.mjs:1655` |
| 会话/消息 | `REWIND_DROP_SENT_ON_APPEND` | `dsh-client-ui-conversation/lib/client.js`<br>rewind 标记与投影 | 回退标记到达时立刻从当前对话拿掉已发送的消息 / drop sent messages when the rewind marker appends | **需改造**<br>锚点部分命中（字面 1/3） | `lib/patches/new-tools.mjs:1863` |
| 会话/消息 | `REWIND_RESET_TODOS` | `dsh-tool-todo/lib/index.js`<br>rewind 标记与投影 | 回退把已完成任务收回成未开始 / rewind resets completed todos to pending | **可移植**<br>字面锚点 1/1 全命中 | `lib/patches/new-tools.mjs:1917` |
| 会话/消息 | `REWIND_SKIP_DERIVE` | `dsh-session/lib/index.js`<br>rewind 标记与投影 | 回退空标记不进模型请求 / rewind markers stay off the model transcript | **可移植**<br>字面锚点 1/1 全命中 | `lib/patches/new-tools.mjs:1997` |
| 会话/消息 | `OVERLAY_RESTORE_FROM_BAK` | `dsh-app-boot/lib/index.js`<br>插件自身设置 / overlay | 声明过的补丁文件不见时，从 .dshpurge.bak 拷回再加载 / restore a missing declared overlay from its bak | **需改造**<br>字面锚点 1/1 全命中 | `lib/patches/new-tools.mjs:2206` |
| 会话/消息 | `DESKTOP_SHELL_PROFILE_FALLBACK` | `lib/main.js`<br>Electron 主进程 | 主进程兜底 DSH_PROFILE=desktop：双击 exe 从 explorer 继承 env 常缺 DSH_PROFILE → host 'cannot determine the boot profile' → dsh-purge 插件没 activate → inject 全断 | **需改造**<br>lib/main.js 锚点漂移（0/2），且依赖 DSH_PROFILE 环境假设 | `lib/patches/new-tools.mjs:2247` |
| 会话/消息 | `INSPECTOR_FRAME_BUDGET_RECORD_OVERHEAD` | `dsh-experimental-inspector/lib/index.js`<br>inspector 帧预算 | Cordis 树预留记录开销，超限时保留上一帧 | **需改造**<br>experimental-inspector 可选插件，1/3 | 待核实 |
| 会话/消息 | `INSPECTOR_FRAME_BUDGET_RECORD_OVERHEAD_CLIENT` | `dsh-experimental-inspector/lib/client.js`<br>inspector 帧预算 | Cordis 树预留记录开销，超限时保留上一帧 | **需改造**<br>同上，client 侧 1/3 | 待核实 |

## 3. P1 落地清单（12 条，风险由低到高）

选入标准：属「可移植」判定 + 不重复 dsh-forge 现有 8 条 + 替换不改控制流或只改单条返回/文案。字段含义：**锚点** 为 0.2.2-rc.3 asar 内实测命中的原文（复制即用，注意前导空格与全角引号是锚点的一部分）；**自检** 三步固定为 `doctor` 预检 → `verify` 查 marker → 行为观察。

### P1-1 `SANDBOX_POLICY_BRAND_NEUTRAL`（沙箱 · 纯文案）

- **目标文件**：`dsh-sandbox-policy/lib/index.js`
- **锚点特征**（3 条全命中）：`Current DSH file policy: ` / `enforced by the DSH file sandbox` / `The DSH file sandbox does not restrict`
- **替换要点**：去掉 DSH 品牌词（`Current file policy: ` / `enforced by the file sandbox` / `The file sandbox does not restrict`），不触碰 `${mode}` 插值。
- **自检**：`node bin/dsh-forge.js doctor` 应报 3/3 命中；`verify` 查 marker；起会话让模型读一次 workspace 外文件，看回报的 policy 行不再出现 DSH。
- **variants**：否（三条同文件同版本段，单条即可）。

### P1-2 `SKILL_BADGE_DESCRIPTION_NEUTRAL`（模型/人设 · 纯文案）

- **目标文件**：`dsh-skill-badge/lib/index.js`
- **锚点特征**（2/2）：`Add the official “powered by dsh” badge to documents, pull requests, merge requests, and other content produced with DeepSeek Harness.` / `Also use when the user asks for a dsh badge, powered-by-dsh attribution, or a reusable dsh badge asset or snippet.`
- **替换要点**：整句替换为中性描述（forge 没有 insert/删段语义，只能原地换掉）；锚点含全角引号 `“ ”`，写入表时必须原样保留 UTF-8 字符。
- **自检**：`doctor` 2/2；`verify` marker；`/skill` 列表里 badge 描述已中性。
- **variants**：否。

### P1-3 `DELIVERABLE_DO_NOT`（模型/人设 · 纯文案）

- **目标文件**：`dsh-deliverable-file-references/lib/index.js`
- **锚点特征**（3/3，首条）：` Do not call present just to list edited source files, or run commands to check whether a diff view will appear.`（**前导空格是锚点的一部分**）
- **替换要点**：换成单个空格，等于删掉这句约束；不要连后面的句子一起吃。
- **自检**：`verify` marker；让模型改完文件，观察它是否还自动 `present`。
- **variants**：否。

### P1-4 `TOOL_SHELL_DELETE_MOVE_NEUTRAL`（模型/人设 · 纯文案）

- **目标文件**：`dsh-tool-bash/lib/index.js`（同句在 `dsh-tool-pwsh/lib/index.js` 也有）
- **锚点特征**（1/1）：`Before any delete or move, verify that the resolved absolute target path is the intended one; never run it against a computed path you have not checked. `（**尾随空格是锚点的一部分**，替换为空串会残留一行空白）
- **替换要点**：替换为空串或中性句；若要覆盖 pwsh，另加一条 find（同名不同 file），这正是 `variants` 不适用、应新建第二条条目的场景。
- **自检**：`doctor` 报 1/1；`verify` marker；bash 工具描述里不再出现 delete/move 双保险句。
- **variants**：否（pwsh 走独立条目）。

### P1-5 `HARNESS_IDENTITY_STRIP`（模型/人设 · 身份段）

- **目标文件**：`dsh-system-prompt/lib/index.js`
- **锚点特征**（3/3）：`includeHarnessIdentity: z.boolean().default(true)` / `if (config.includeHarnessIdentity ?? true)` / `text: "You are an AI agent powered by DeepSeek Harness."`
- **替换要点**：`default(true)` → `default(false)`、`?? true` → `?? false`；第三条可置空字符串。属配置默认值翻转，不删代码。
- **自检**：`doctor` 3/3；新会话首条 system prompt 里搜不到 `powered by DeepSeek Harness`。
- **variants**：否。

### P1-6 `SANDBOX_HINT_NEUTRAL`（沙箱 · 提示文案 + 分支措辞）

- **目标文件**：`dsh-sandbox/lib/index.js`
- **锚点特征**（2/2）：模板串 `[sandbox: file access denied under \${mode} mode]` 与升级提示长句 `[sandbox: escalation available — retry this exact \${subject} once with sandbox_permissions (the narrowest wider mode that suffices) + justification; the approval prompt asks the user]`
- **替换要点**：只改提示文本（去掉 "the approval prompt asks the user" 这类描述），保留 `${mode}` / `${subject}` 插值占位符不动，否则运行时拼串会断。
- **自检**：`verify` marker；在 `read-only` 模式下触发一次写文件，看回报文案已中性。
- **variants**：否。

### P1-7 `SYSTEM_PROMPT_PERSONA`（模型/人设 · preset YAML 段）

- **目标文件**：`dsh-web-app/cordis.patch.yml`（同一段在 `~/.dsh/.agent-presets/*/agent.cordis.yml` 也有，后者在 asar 外，forge 按 asar 相对路径打不到）
- **锚点特征**（1/1，多行）：`personaPrefix: >-` + 换行 + 缩进 `You are a coding agent powered by the {{model}} model.`
- **替换要点**：把 YAML 折叠块缩进后的正文一起替换（必须写全 `\n      ` 缩进），只换第一行会留下悬空块。
- **自检**：`doctor` 1/1；新会话 system 首段不再出现该 persona 句；**同时确认会话未因 YAML 断裂起不来**（这是本条的真正风险点）。
- **variants**：**是** —— 至少两份（web-app 与 headless/preset-* 各一份，缩进与模型插值都可能不同）。

### P1-8 `PERSONA_TEXT_PREFIX_ALIAS`（模型/人设 · 兼容字段）

- **目标文件**：`dsh-persona/lib/index.js`
- **锚点特征**（2/2）：zod 配置块 `const Config = z.object({ prefix: z.string().required(), suffix: z.string().default(""), complete: …, includeRuntimeContext: … });` 与取值行 `\t\ttext: config.prefix,`
- **替换要点**：把 `text` 读取回退到 `prefix`（0.1.2 旧字段兼容）。属于兼容层，不是绕过。
- **自检**：`doctor` 2/2；起一个带 persona 预设的会话，验证 persona 段正常渲染而不是空/抛错。
- **variants**：否（若接 0.2.1 需复测该 zod 块）。

### P1-9 `SANDBOX_DENY_FILE_WRITE`（沙箱 · 单条规则）

- **目标文件**：`dsh-sandbox-local/lib/index.js`
- **锚点特征**（1/1）：`"(deny file-write*)"`
- **替换要点**：替换为空串（移掉这条 seatbelt/sandbox-exec 规则串）。注意别把相邻规则数组语法改坏。
- **自检**：`verify` marker；`workspace-write` 下往 `/tmp` 外写文件，确认不再报 deny。
- **variants**：否。

### P1-10 `OFFICIAL_PLAN_MODE_NEUTRAL`（审批 · yml 文案，多文件）

- **目标文件**：`dsh-base/cordis.patch.yml`（同一批文案在 `preset-ptc` / `preset-standard` / `preset-cordis` 各有一份）
- **锚点特征**（3/3）：`A user's conversational agreement — including an answer confirming something you asked — approves nothing and does not end plan mode; …` / `Do not edit or write files, change configuration, run formatters or code generation that rewrites tracked files, commit, or otherwise carry out the plan.` / `do not proceed with implementation.`
- **替换要点**：把硬拦语义改成「操作者明确要求实施时可直接执行」；破折号 `—` 是锚点的一部分。
- **自检**：`doctor` 3/3；plan 模式下让它实施，观察是否仍被 `exit_plan_mode` 卡住。
- **variants**：**是** —— 4 个 yml 各一条（文案一致但文件不同，用多条条目比 variants 更清晰）。

### P1-11 `FS_FENCE_DISABLED`（沙箱 · 代码逻辑，本组起点）

- **目标文件**：`dsh-fs-sandbox/lib/index.js`
- **锚点特征**（1/1）：`async checkedTarget(target, sandboxPolicy) {` 段内 `const { mode } = policy; if (mode === "danger-full-access") return target; if (mode === "read-only") throw new FsError(…`
- **替换要点**：把方法入口改成直接 `return target;`（围栏失效）。**这是本清单第一条真正改控制流的补丁**，`revert` 必须验证字节级还原。
- **自检**：`apply` → `verify` → `revert` → `verify` 应回到未打；行为面：`workspace-write` 下写 workspace 外文件成功。
- **variants**：否（锚点含完整方法签名，跨版本易漂，接 0.2.1 时优先复测）。

### P1-12 `FRESH_SESSION_FULL_ACCESS`（沙箱 · 权限预设，最高风险）

- **目标文件**：`dsh-permission-presets/lib/index.js`
- **锚点特征**（2/2）：`const name = this.defaultPreset;` / `Write inside the workspace and permitted temporary directories; wider retries require approval.`
- **替换要点**：让新会话跟随部署已生效的 `danger-full-access`，不再被钉回 `workspace-write`。与现有 `sandbox-default-full` 是**互补而非重复**：后者改 `dsh-base` 默认值，本条改运行时钉回逻辑，两条同时存在才不漏。
- **自检**：新建会话看 permission mode 是否为 `danger-full-access`；再 `revert` 确认回到 `workspace-write`。
- **variants**：否（若 UI 侧另有一套默认，需补一条）。

### 未进 P1 但值得排期（P2/P3 提示）

- **P2**：`OFFICIAL_AUTO_REVIEW_PASSTHROUGH`（1/1，但属官方审阅通道，行为面影响大）、`OFFICIAL_RUN_CODE_APPROVAL_NEUTRAL`（4/4，PTC 通道）、`READ_CAPS_RAISED`（3/3）、`SUBAGENT_SCOPE_LOCK_NEUTRAL`（2/2）、`REWIND_RESET_TODOS` / `REWIND_SKIP_DERIVE`（各 1/1）。
- **P3（回合主干）**：`SYSTEM_PROMPT_REPLACE_HEAD`（1/1 但改每步 messages 首条）、`SYSTEM_PROMPT_RENDER_GUARD`（3/3，兜底改错会吞异常）、`TOOL_RESULT_PRUNER_DISABLED`（1/1，等于取消上下文保护）、`SESSION_PROMPT_ALWAYS_FOLLOWUP`（1/1，改 steer 语义）。
- **明确不做**：`RESTORE_NATIVE_STEERING`（依赖插件自己的 `lib/steering.js`，不是文本替换）；所有 `HOOKS_*`、`LIANGSHEN_*`（目标插件不在参照宿主上，打了也永不命中）；`PRESET_FETCH_ENABLED` / `*_PRESET_IDENTITY_STRIP`（目标在 `~/.dsh/.agent-presets/`，asar 外不可达）。

## 4. 附录：矩阵装不下的运行时机制

xxy0722/dsh-purge-deep 的「消息层」是**唯一一家**在补丁表之外做拦截的：

- 位置：`lib/deep-purge.js`（约 450 行），包装 `session.deriveMessages()` 后改写消息数组。
- 关键函数：`installDeepPurge(ctx, options)`、`looksLikeRefusal(text)`、`voidMessage(message)`、`stripPrefillInMessage(message)`、`appendTailSteer(messages, steer)`、`pickPrefill(base, messages)`、`resolvePrefillMode(cfg)`。
- 默认开关：历史拒绝清洗 = 开、预填充遗迹剥离 = 开、「assistant 预填充（中文 `可以，` / 英文 `Yes. `）」= 关、尾部棘轮 = 关。
- system 层另有唯一尾锚 `dshpg-anchor`（order 1000000）与身份段结构性剥离 `harness:identity`。

对 dsh-forge 的含义：这类改写**不可能**用 `find/replace` 表达，要么新增一条 runtime hook 通道（等于给 forge 加第二个执行器），要么放弃消息层。本次矩阵按「不在表内」处理，不给可移植性判定。

## 5. 待核实

1. **0.2.1-rc.x 的锚点命中率未测**。本表全部判定基于 0.2.2-rc.3；`HOST_VERSION_RANGE` 下界 0.2.1-rc.1 需要单独跑一遍同样的校验才能决定哪些条目要拆 `variants`。
2. `AGENT_LOOP_MESSAGES_GUARD`、`ESCALATION_GRANT_UNCONDITIONAL`、`PRESET_BASH_MIRROR_LINE`、`WEB_SURFACE_PROHIBITION` 等仅在**正则**上命中，字面量形式尚未抽取，改造工作量取决于能否找到稳定的行首/行尾子串。
3. `SCOPE_INTRO` 与 `BASH_TIMEOUT_RESTORE` 的 6 条正则锚点在 0.2.2-rc.3 上**全部 0 命中**；前者匹配到模板结尾反引号，字面化难度高；后者源码注释自称「migration only」，可能已无实际作用 —— 需回源码确认是否放弃。
4. 桌面端 5 条（`DESKTOP_*`、`OFFICIAL_DESKTOP_UPDATE_*`）锚点在 asar 根 `lib/main.js`（828 KB）里 0 命中，说明该文件在 0.2.2 已重新构建；需要人工重新定位，本次不判可移植。
5. `dsh-experimental-inspector` 在宿主内但不是默认加载，两条 inspector 补丁的行为面收益待评估。

## 6. 执行修正（2026-11-17）

- **P1-12 `FRESH_SESSION_FULL_ACCESS` 判为冗余，不接。** `dsh-permission-presets/lib/index.js:182` 的 `inferredDefault = this.derive(EMPTY_KNOBS)` 是从部署层 sandbox/approval 组合推导出来的；`sandbox-default-full` 已把部署默认改成 `danger-full-access`，新会话的默认 preset 会跟着推导，不需要再改 `this.defaultPreset`。矩阵原判「互补而非重复」在本版本不成立。
- **`fs-fence-disabled` 必须删整条分支。** engine 的 applied 判定是 `marker 存在 && 所有 find 计数为 0`（`lib/engine.mjs:162`），所以任何「在 find 前后插入内容」的替换都会让 find 继续命中、被判回 `hit`。改为删除 read-only 与 workspace-write 两条 throw 分支后才成立。
- **P1-4 `TOOL_SHELL_DELETE_MOVE_NEUTRAL` 不接。** 那句是「删前确认路径」的操作纪律，去掉只增加误删风险，破甲收益为零。
