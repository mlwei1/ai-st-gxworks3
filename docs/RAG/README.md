# RAG 手册资料评估（2026-11-11）

本目录存放后续「工业场景知识库 / 手册 RAG」的原始资料。当前两份 PDF 已评估，结论如下。

## 文件清单

| 文件 | 页数 | 性质 | 手册编号 |
|---|---|---|---|
| `MELSEC iQ-F FX5 CPU 模块FB参考.pdf` | 90 | FX5（FX5S/FX5UJ/FX5U/FX5UC）**模块 FB 库**参考 | 关联手册见文中（主手册编号未在 TOC 页给出） |
| `MELSEC iQ-R 结构化文本(ST)编程指南.pdf` | 106 | iQ-R/iQ-F **ST 语言编程指南** | SH-081465CHN |

两份都是**可检索文本 PDF**（不是扫描件），`pdftotext -layout` 可稳定抽出文本（各约 18 万字符）。

## 各自有什么用

### 1. FX5 CPU 模块 FB 参考（90 页）

覆盖 **15 个模块 FB**（命名规则 `M+FX5UCPU-分类_功能`）：

| 分类 | FB（数量） |
|---|---|
| 输入输出 | `IO_OutputOnTimes`、`IO_CompareRelayOnTimes`（2） |
| 定位 | `Positioning_ABRST`、`Positioning_StartPositioning`（2） |
| 串行通信 | `SerialComm_InputOutput`、`SerialComm_Input`、`SerialComm_Output`、`SerialComm_ExeCommonProtocol`（4） |
| 高速计数器 | `Counter_PulseMeasure`（1） |
| 温度调节 | `TemperatureCtrl_TwoPositionControl` / `...Pd` / `...Pi`、`ThreePositionControl` / `...Pd` / `...Pi`（6） |

每个 FB 都给出：概要、使用标签、功能内容、**参数设置**、性能值、出错代码。

**用途**：
- 后续工业场景模板（定位、温度控制、串口通信、高速计数）的**权威参数表**；
- 校验「MELSEC 专用 FB」名称/参数名（对应我们 analyzer 的 E016/E017 形参检查）；
- 生成模块 FB 调用示例（`i_param := ...`、`o_param => ...`）。

**不是**：标准 IEC FB（TON/CTU 等）参考，也不覆盖指令白名单——那部分在
`MELSEC iQ-F FX5编程手册(指令/通用FUN/FB篇)[JY997D58901]`（尚未入库）。

### 2. iQ-R/iQ-F 结构化文本(ST)编程指南（SH-081465CHN，106 页）

内容：ST 基本规则（可字符、指令函数、语句表达式）、运算/条件/循环、数据类型（BOOL/整数实数/
字符串/时间/数组结构体）、注释、FB 调用（含 EN/ENO、`:=`/`=>`）、程序示例、附录（ST 语言规格、
ST 中无法使用的指令、**iQ-F 差异**）。

**用途**：
- 方言检查规则的**一手依据**（字符串引号、注释、循环、FB 调用参数写法、iQ-F 限制）；
- 生成提示词里的硬规则补充；
- 附录 2「ST 中无法使用的指令」可作为 analyzer 的规则候选清单。

**不覆盖**：具体指令/FB 规格（TON 等在指令手册）、软元件地址范围/进制（在 FX5 用户手册应用篇）。

## 本轮已固化的结论（有测试）

| 结论 | 依据 | 落地 |
|---|---|---|
| GX Works3 支持 `(* *)`、`/**/`、`//` 三种注释 | ST 指南 p13/88 | 修复 lexer 不支持 `/* */` 的问题，新增 `test/rag-knowledge.test.ts` |
| ASCII 字符串常数用单引号；Unicode 字符串常数用双引号 | ST 指南 p31/91 | E019 诊断文案改为「ASCII 单引号 / Unicode 双引号」 |
| **iQ-F 不支持 Unicode 字符串常数**（双引号） | ST 指南 附3 p98 | 新增 warning `W010`（FX5/FX5UJ 目标 + 双引号字符串） |
| iQ-F 不支持 `LREAL` | ST 指南 附3 p98 | 与现有 profile（`IQ_R_ONLY_TYPES`）一致，本次探针验证会报 E004 |
| 循环语句 FOR/WHILE/REPEAT 可用 | ST 指南 3.3、附录 | 与现有 parser 支持一致 |
| FB 输出参数用 `=>`，输入参数用 `:=` | ST 指南 p48/51/93 | 与现有 `fb_call_demo.st` 验证一致 |
| ST 不支持梯形图触点指令（LD/OUT 等） | ST 指南 附2 p95 | 待补 analyzer 规则（候选） |
| `SQRT` 在 ST 中可用 | ST 指南函数示例 p31 附近 | 与现有白名单一致（旧方案里「SQRT 不支持」的说法作废） |
| `LIMIT` / `RAMPF` / `RAMP` 未被 ST 指南提及 | — | 保留为「需原生编译验证」，不据此删除白名单 |

详细条目见 [知识要点-FX5-ST.md](知识要点-FX5-ST.md)。

## 后续 RAG 计划（工业场景知识阶段）

1. 用 `tools/extract-rag.ps1` 抽取全文 → 按「章/节」切块（保留页码，便于引用）；
2. 在 `src/knowledge/` 下按主题建数据文件：CPU/类型规则、指令白名单、FB 参数表、ST 限制；
3. 每条知识带 `source`（手册号 + 页码）与 `verifiedBy`（测试/原生编译证据）；
4. 生成器与 analyzer 只读这些数据文件，配套回归测试；
5. 再补 `JY997D58901`（指令/通用FUN/FB篇）与 FX5 用户手册（软元件、地址进制）两份 PDF。

## 文本抽取

```powershell
# 依赖 poppler 的 pdftotext（本机已安装）
pwsh tools/extract-rag.ps1
# 输出 docs/RAG/extracted/*.txt（已在 .gitignore，避免仓库膨胀）
```
