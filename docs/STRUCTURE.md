# 项目结构

四层，越往下越靠近宿主文件。

```
bin/dsh-forge.js       命令行入口（参数解析、输出格式）
core/                  纯逻辑：编译、契约、校验、探针、审计、控制台渲染
  compile.mjs          组合 profile + model + 宿主 + 人设 → 计划与产物
  prompt.mjs           拼装系统提示（core → persona → model → host）
  persona.mjs          人设库、四模式（replace / strict / append / off）
  transform.mjs        九种载荷变换（base64 / rot13 / leet / morse / split …）
  probe.mjs            静态探针：18 条极端请求 × 7 项检查
  channels.mjs         投递通道（project / install / shim / slash / none）
  grades.mjs           投递分级（replace-full … unobservable）
  audit.mjs           只读审计日志，snapshot.mjs 快照与保留策略
  console.mjs          127.0.0.1:7788 只读控制台（零脚本 HTML）
hosts/                 宿主适配
  table.mjs            九個声明式宿主（候选路径、证据、configTargets）
  registry.mjs         注册、查找、探测；dsh/hermes/openclaw/muse 单独成模块
lib/                   宿主补丁引擎与 DSH 运行时绑定
  table.mjs            16 条补丁（五层：approval/sandbox/turn/persona/session）
  engine.mjs           find/replace + marker + 版本闸门 + 原子写
  provider.mjs         Provider 边界（core 不直接依赖 DSH 运行时）
profiles/ models/      13 个宿主 profile、8 个模型覆盖
prompt/                提示词素材：core.md、hosts/*.md、models/*.md、personas/*.md
scripts/               校验（check_repo / check_docs / privacy_scan / release_check）、
                       build-client、live_matrix（真实调用矩阵）
```

## 三条硬规则

1. `core/` 不 import DSH 运行时（`scripts/check_repo.sh` 拦）。
2. 系统提示有上限：每个 profile 组合 **< 480 token**，单个片段 < 1400 字节（`test/budget.test.mjs` 拦）。
3. 文档里的补丁计数由 `scripts/check_docs.mjs` 从 `lib/table.mjs` 生成，不手写（`verify` 拦）。

## 提示词体量

| 组成 | 位置 | 目标 |
| --- | --- | --- |
| 核心 | `prompt/core.md` | ≈250 token |
| 人设 | `prompt/personas/*.md` | 每人 ≤ 200 字节 |
| 模型覆盖 | `prompt/models/*.md` | 每族 ≤ 400 字节，含禁句与起始 token |
| 宿主覆盖 | `prompt/hosts/*.md` | ≤ 300 字节 |

合计 320–450 token；压缩前的旧版是 650–770 token，多出来的部分主要是重复的执行纪律与输出规范。
