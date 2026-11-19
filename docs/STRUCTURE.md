# 项目结构

`dsh-forge-kit` 按职责分为四层，由上而下贴近具体宿主（快速上手见 [ONBOARDING.md](ONBOARDING.md)，防回归约束见 [ENGINEERING_RULES.md](ENGINEERING_RULES.md)）：

```
bin/dsh-forge.js       命令行统一分发入口（含 `session` 子命令转发）
bin/commands/          按域拆分的 CLI 处理器（shared / dsh / plan / runtime）
bin/dsh-session.js     持续会话入口（start / turn / record / status / matrix）
core/                  宿主无关核心：契约、编译、策略、网关、执行器、探针、审计、控制台
  index.mjs            core 显式策展公开导出入口（test/public-api.test.mjs 守卫）
  compile.mjs          纯编译器 + normalizeContext：组合 profile + model + 人设 -> 确定性 planId
  prompt.mjs           确定性多层提示词渲染与 CJK 感知 token 估算
  persona.mjs          人设库、四模式（replace / strict / append / off）
  transform.mjs        9 种可逆/有损载荷变换（base64 / rot13 / leet / morse / split 等）
  strategy.mjs         策略引擎（variable 包装、crescendo/deep/layered 多轮、prefill、stuff 稀释）
  gateway.mjs          模型网关与评测引擎（classifierHash 戳记、freeipblk/magpie 拦截、拒答/合规分级）
  executor.mjs         原子文件事务引擎（block/json/toml/yaml/shim 合并、verifyCompiled、零漂移回滚）
  channels.mjs         五类投递通道（project / install / shim / slash / none）与生效时机
  grades.mjs           动态投递分级（根据实编译 actions[] 判定 replace-full / append-only 等）
  probe.mjs            静态探针矩阵（18 条测试载荷 x 7 项检查）
  audit.mjs            只读跨日日志分析；snapshot.mjs 快照保留策略
  console.mjs          127.0.0.1:7788 交互式工作台后端与路由
  net.mjs              共享 Host/authority 解析与 loopback 白名单（控制台与插件共用一份）
  families.mjs         模型家族与策略阶梯（deepseek/claude/gpt/gemini/glm/qwen/llama/generic -> 有序臂序列）及 prefill 能力
  session.mjs          持续会话引擎：会话落盘、逐轮锁定帧、历史过滤、判定与恢复、稳定性度量、并发安全家族统计
ui/                    工作台与侧边栏共享设计 Token（tokens.mjs）与交互脚本（workbench.js）
hosts/                 宿主适配器目录（4 个主力验证宿主 + 9 个冻结/实验档案，evidence.mjs 会话探针）
profiles/ models/      13 个宿主 profile、7 个模型家族叠加配置
prompt/                模块化提示词：core.md、hosts/*.md、models/*.md、personas/*.md、modes/*.md
lib/                   DSH 宿主原生引擎、ASAR 拆包、23 条版本门控补丁与 Cordis 插件（详见 lib/README.md）
client/                DSH 侧边栏插件源码（React.createElement + 工作台 tab）与预编译产物
scripts/               检查与发布工具：check_repo / check_docs / privacy_scan / release_check / bump_version / build-client / live_matrix / session
scripts/fixtures/      可复现的端点测试替身（system-rejecting-gateway 等），配合 test/session-e2e.test.mjs 端到端校验
test/fixtures/hosts/   4 个主力宿主的黄金探测目录快照（test/host-fixtures.test.mjs）
```

## 工程铁律

1. `core/` 禁止 import `lib/`（由 `scripts/check_repo.sh` 强制拦截）。
2. 每个 profile 编译产出的系统提示词必须 **< 480 token**，单个片段 **< 1400 字节**（由 `test/budget.test.mjs` 强制拦截）。
3. 文档中的补丁、档案、模型、人设及运行环境指标由 `scripts/check_docs.mjs` 自动同步与校验。
4. 版本号只有三处权威：`package.json`、`package-lock.json` 根元数据、`lib/paths.mjs` 回退串，由 `scripts/bump_version.mjs` 一次改齐、`scripts/check_repo.sh` 反向校验（并校验 `CHANGELOG.md` 有对应版本小节）。
5. 默认运行与测试状态落盘于 `$XDG_STATE_HOME/dsh-forge-kit` 或 `~/.dsh-forge-kit`（可通过 `--state` / `DSH_FORGE_KIT_STATE` 或兼容变量 `DSH_FORGE_STATE` 指定），DSH 原生备份位于 `~/.dsh/dsh-forge-kit/`，不污染真实工作区。
6. 任何传输/会话改动、主力宿主变更与提交切片规则遵守 [ENGINEERING_RULES.md](ENGINEERING_RULES.md)。
