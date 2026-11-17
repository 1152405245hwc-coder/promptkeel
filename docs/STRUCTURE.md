# 项目结构

`dsh-forge` 按职责分为四层，由上而下贴近具体宿主：

```
bin/dsh-forge.js       命令行统一入口（DSH 原生指令 + 跨宿主编排 + run/console）
core/                  宿主无关核心：契约、编译、策略、网关、执行器、探针、审计、控制台
  index.mjs            core 统一公开导出入口
  compile.mjs          纯编译器 + normalizeContext：组合 profile + model + 人设 -> 确定性 planId
  prompt.mjs           确定性多层提示词渲染与 CJK 感知 token 估算
  persona.mjs          人设库、四模式（replace / strict / append / off）
  transform.mjs        9 种可逆/有损载荷变换（base64 / rot13 / leet / morse / split 等）
  strategy.mjs         策略引擎（variable 包装、crescendo/deep/layered 多轮、prefill、stuff 稀释）
  gateway.mjs          模型网关与评测引擎（Magpie :3425、OpenAI/Anthropic/GLM、拒答/合规分级）
  executor.mjs         原子文件事务引擎（block/json/toml/yaml/shim 合并、verifyCompiled、零漂移回滚）
  channels.mjs         五类投递通道（project / install / shim / slash / none）与生效时机
  grades.mjs           动态投递分级（根据实编译 actions[] 判定 replace-full / append-only 等）
  probe.mjs            静态探针矩阵（18 条测试载荷 x 7 项检查）
  audit.mjs            只读跨日日志分析；snapshot.mjs 快照保留策略
  console.mjs          127.0.0.1:7788 交互式工作台后端与路由
ui/                    工作台与侧边栏共享设计 Token（tokens.mjs）与交互脚本（workbench.js）
hosts/                 宿主适配器目录（registry.mjs、table.mjs declarative 宿主、evidence.mjs 会话探针）
profiles/ models/      13 个宿主 profile、7 个模型家族叠加配置
prompt/                模块化提示词：core.md、hosts/*.md、models/*.md、personas/*.md、modes/*.md
lib/                   DSH 宿主原生引擎、ASAR 拆包、23 条版本门控补丁与 Cordis 插件
client/                DSH 侧边栏插件源码（React.createElement + 工作台 tab）与预编译产物
scripts/               check_repo / check_docs / privacy_scan / release_check / live_matrix
```

## 四条工程铁律

1. `core/contract.mjs` 与 `core/compile.mjs` 禁止 import `lib/`（由 `scripts/check_repo.sh` 强制拦截）。
2. 每个 profile 编译产出的系统提示词必须 **< 480 token**，单个片段 **< 1400 字节**（由 `test/budget.test.mjs` 强制拦截）。
3. 文档中的补丁、档案、模型、人设及运行环境指标由 `scripts/check_docs.mjs` 自动同步与校验。
4. 默认运行与测试状态落盘于 `$XDG_STATE_HOME/dsh-forge` 或 `~/.dsh-forge`（可通过 `--state` / `DSH_FORGE_STATE` 指定），不污染真实工作区的 `~/.dsh/`。
