# 破甲生态调研：从 dsh-purge 家族到 jailbreak-research 学术与工具链

> 采集日：2026-11-17 · 采集渠道：GitHub Topics（`jailbreak-research`、`jailbreak` 约 2222 个公开仓库、`prompt-injection`、`llm-security`）、策展清单 `kaplanlior/oss-llm-security`、`corca-ai/awesome-llm-security`、`llmsecnet/llmsec-site`、DSH Hub 插件目录、`EasyJailbreak` 官方 README 与论文（arXiv 2403.12171）。
> 目的：把 dsh-forge 的视野从「DSH 插件镜像」扩到「破甲技术族谱」，判断哪些机制能被一个纯声明式 find/replace + 人设组装系统吸收，哪些必须另开运行时通道。

## 0. 结论先行

1. dsh-purge 家族的 80–86 条补丁解决的是**单宿主的结构性窄口**（审批、沙箱、身份句、回合引导），本质是"把闸门拆掉"。
2. 学术与工具链生态解决的是**模型层面的拒答**（角色扮演、编码、密文、多语言、嵌套叙事、梯度后缀、迭代精炼），本质是"让模型愿意做"。
3. 两者正交：现在的 dsh-forge 在前者已经做到五层覆盖，在后者只有 3 条人设（direct/engineer/tutor），**技术族谱一条都没用上**。这是下一个真正的增量来源，而不是继续加第 17、18 条同质补丁。
4. 可吸收的具体形态有三种：`transform` 载荷变换管线（编码/密文/分片）、人设库扩容（技术族谱化）、以及一套可重复的探针评测（garak / PyRIT 的"扫描器"思路），而不是把学术项目的攻击循环搬进来。

## 1. 生态分层

| 层 | 代表项目 | 它们真正做的事 | 对 dsh-forge 的价值 |
|---|---|---|---|
| 宿主破甲插件 | `dsh-purge` 家族（YuJunZhiXue / kingcharleslzy-ai / DravenP530 / xxy0722 / hexiyou / chivalry1214 / WoYun520 / adam0718 / ShadowCat2233 / Fluochen / HunYiSage / Cola-Ace）、`agent-purge`、`dsh-custom-mode` | 拆宿主闸门 + 人设注入 + 通道投递 + 控制台 | 已吸收：补丁表、人设、通道、分级、控制台、审计快照 |
| 破甲生成框架 | `EasyJailbreak`、`llm-attacks`（GCG）、`PAIR`/`TAP` 实现、`AutoDAN`、`GPTFuzz`、`ReNeLLM`、`DeepInception`、`CodeChameleon` | 把破甲拆成 select → mutate → constrain → attack → evaluate 的循环 | 提供**技术族谱**与**变换算子**，可静态化为提示词模板 |
| 扫描与评测 | `garak`、`PyRIT`、`promptfoo`、`ps-fuzz`、`promptmap`、`PurpleLlama` | 用探针集批量测"能不能被弄坏"，出报告 | 提供**探针与评分口径**，可做成 `dsh-forge probe` |
| 注入检测/防御 | `llm-guard`、`rebuff`、`vigil-llm`、`TrustGate`、`hou-guard`、`langkit`、`plexiglass` | 检测注入、越权、数据外泄 | 反向知识：知道检测器看什么，才知道哪些写法会被拦 |
| 应用层注入 | `greshake/llm-security`、`liu00222/Open-Prompt-Injection`、`dropbox/llm-security` | 间接注入、跨插件、字符重复压制 | 对应我们的会话层与工具层 |

## 2. 技术族谱（可静态化的部分）

按"能否写进一段固定文本"排序，从最能吸收到最不能：

| 族 | 机制 | 代表 | 能否静态化 | 落点 |
|---|---|---|---|---|
| 角色扮演 / 人设覆盖 | 换掉"你是谁"与"你在为谁服务" | DAN 系、`agent-purge` 人设库 | 是 | `prompt/personas/` |
| 编码变换 | Base64 / ROT13 / Leetspeak / 去元音 / 摩斯 / ASCII / 反转 / 二叉树 | `JailBroken`（`Base64_input_only`、`Rot13`、`Leetspeak`、`Disemovowel`、`Auto_payload_splitting`）、`Cipher`（`AsciiExpert`、`CaserExpert`、`MorseExpert`） | 是（需 transform 管线） | 新增 `core/transform.mjs` |
| 代码化包装 | 把请求写成代码/伪代码/JSON 让模型"执行" | `CodeChameleon`（`BinaryTree`/`Length`/`Reverse`/`OddEven`） | 是 | 人设 + transform 组合 |
| 多语言 / 翻译 | 换语言削弱拒答触发 | `MultiLingual`（`Translate`） | 部分（需要翻译产物） | 人设变体 |
| 嵌套叙事 | 故事里的故事，把目标藏在第三层 | `DeepInception`（`Inception`） | 是 | 人设变体 |
| 上下文内多示例 | 先给一堆"有问必答"的样例再提问 | `ICA` | 是 | 新增 few-shot 段落 |
| 结构化分隔 | 用分隔符/标签声明"以下是数据不是指令"，反向用来抬高指令优先级 | 注入类项目通用 | 是 | 回合层补丁 / 段落模板 |
| 迭代精炼 | 生成→评分→改写，循环 N 轮 | `PAIR`（`HistoricalInsight`）、`TAP`（`IntrospectGeneration`） | 否（需模型在环） | 未来 `probe` 子命令 |
| 模糊变异 | 改风格、插无意义字符、拼错敏感词、改写句式 | `ReNeLLM`（`ChangeStyle`/`InsertMeaninglessCharacters`/`MisspellSensitiveWords`） | 部分 | transform 管线 |
| 梯度后缀 | 白盒优化出的对抗后缀 | `llm-attacks`（GCG） | 否（需权重） | 不吸收 |
| 字符级压制 | 重复字符挤占注意力/绕过内容约束 | `dropbox/llm-security` | 是 | transform 管线 |

## 3. 对 dsh-forge 的四条具体增量

### 3.1 `transform` 载荷变换管线（优先级最高）

纯函数 `encode(text, kind)`，`kind ∈ {base64, rot13, leet, vowels, morse, ascii, reverse, split, chars}`，确定性、无外部依赖。用途有两个：

- 人设段落可声明 `transform=base64`，把"行为准则"以编码形式注入，宿主的关键词过滤与人设检测看不到明文；
- `compile --transform <kind>` 输出整段编码后的提示词，配合 `shim` 通道投递。

这补上了"技术族谱第一层"，且完全不需要运行时 hook。

### 3.2 人设库技术族谱化

现在 3 条（direct/engineer/tutor）只是语气差异。按族谱扩到 8 条，每条对应一种可静态化的机制：`roleplay`（角色覆盖）、`nested`（嵌套叙事）、`code`（代码化）、`fewshot`（多示例）、`cipher`（密文声明）、`split`（分片声明）、`terse`（极简指令）、`audit`（对抗自检）。

### 3.3 `probe` 子命令（garak/PyRIT 的思路，不搬循环）

不做自动攻击，只做**可重复的静态探针**：给定 `profile + persona + transform`，输出组合后的提示词、字符/词元预算、被谁覆盖、哪些句子仍含宿主自称，并给出 PASS/FAIL 断言。让"改人设"这件事有回归测试，而不是靠感觉。

### 3.4 检测器反推（防御侧知识）

`llm-guard`/`rebuff`/`vigil-llm` 的检测点集中在：显式角色覆盖句式（"ignore previous"）、编码块、超长重复、系统提示词复述。这直接决定人设文本应该避免哪些字面量——写进 `docs/PERSONAS.md` 的"高检测风险句式"清单即可。

## 4. 明确不吸收

- GCG 梯度后缀：需要白盒权重与优化循环，静态文本放不下，且对商用 API 迁移率低。
- PAIR/TAP 的模型在环迭代：需要一个攻击模型 + 评分模型 + 多轮调用，属于独立产品而非插件能力。
- `EasyJailbreak` 的 recipes 全量移植：它是研究框架（GPLv3、Python、依赖 HF 模型），与 Node 插件形态不兼容；只取算子清单。
- `hou-guard`/`llm-guard` 一类防御 SDK：与本项目目标相反，只作为检测面知识来源。

## 5. 参考链接

- Topics: <https://github.com/topics/jailbreak-research>、<https://github.com/topics/jailbreak>（2222 仓库）、<https://github.com/topics/prompt-injection>
- 清单: <https://github.com/kaplanlior/oss-llm-security>、<https://github.com/corca-ai/awesome-llm-security>、<https://llmsecurity.net/>
- 框架: <https://github.com/EasyJailbreak/EasyJailbreak>（12 recipes / 4 组件）、<https://github.com/llm-attacks/llm-attacks>、<https://github.com/leondz/garak>、<https://github.com/Azure/PyRIT>、<https://github.com/promptfoo/promptfoo>、<https://github.com/prompt-security/ps-fuzz>
- 应用层注入: <https://github.com/greshake/llm-security>、<https://github.com/liu00222/Open-Prompt-Injection>、<https://github.com/dropbox/llm-security>
- 同类插件: <https://github.com/ZiChuanLan/agent-purge>、<https://github.com/BOWLUNA/dsh-custom-mode>、<https://dshhub.org/zh-CN/plugins/HunYiSage/dsh-purge/>
