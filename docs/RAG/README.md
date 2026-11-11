# RAG 手册资料库

本目录存放「工业场景知识库 / 手册 RAG」的原始手册。**手册数量大（7 本、约 3000 页），
不整本阅读**，而是：

1. `tools/extract-rag.ps1` 抽取全文（`docs/RAG/extracted/`，已 gitignore）；
2. `tools/rag-search.ps1` 按关键词 + 文档过滤查找，输出「文档 + PDF 页序 + 上下文」；
3. 把核实过的结论写进 `知识要点-*.md`（带页码出处），并在代码/测试中固化。

## 手册清单（7 本）

| 文件 | 页数 | 抽取字符 | 定位 | 优先查什么 |
|---|---|---|---|---|
| `MELSEC iQ-F FX5 编程手册 (指令,通用FUN FB篇).pdf` | 1400 | 3.12M | **指令/FB 规格大全** | 指令名与操作数、TON/CTU 等 FB 参数、EN/ENO、各指令 ST 写法 |
| `MELSEC iQ-F FX5 用户手册 (应用篇).pdf` | 950 | 2.07M | **软元件/功能规格** | 软元件范围与进制、特殊继电器/寄存器、模块功能 |
| `MELSEC iQ-F FX5SFX5UJFX5UFX5UC 用户手册(硬件篇).pdf` | 286 | 0.57M | 硬件规格 | 供电/接线/模块型号（对代码生成价值低） |
| `MELSEC iQ-F FX5 编程手册 (程序设计篇).pdf` | 126 | 0.22M | 程序结构/标签/ST 概览 | 程序执行类型、结构体、FB 定义、标签 |
| `MELSEC iQ-F FX5 用户手册 (入门篇).pdf` | 64 | 0.09M | 入门操作 | 项目创建、仿真入门（教程性质） |
| `MELSEC iQ-F FX5 CPU 模块FB参考.pdf` | 90 | 0.18M | **模块 FB 库** | 15 个 `M+FX5UCPU-*` FB 参数（定位/温度/串口/计数） |
| `MELSEC iQ-R 结构化文本(ST)编程指南.pdf`（SH-081465CHN） | 106 | 0.18M | **ST 语言规则** | 注释/字符串/循环/FB 调用/iQ-F 差异 |

导出文本全量约 6.4M 字符；`pdfinfo` 显示均为可检索文本 PDF（非扫描件），`pdftotext -layout` 可用。

> 页码说明：搜索脚本输出的「PDF 页序」从第 1 页（封面）起算，与印刷页码可能差 1~3 页；
> 手册内部交叉引用（如「参阅 712 页」）用的是**印刷页码**。

## 常用查找

```powershell
pwsh tools/rag-search.ps1 -Keyword 'TON' -Doc '指令' -Max 10
pwsh tools/rag-search.ps1 -Keyword 'X1777' -Doc '应用篇' -Max 5
pwsh tools/rag-search.ps1 -Keyword 'LIMIT' -Doc '指令' -Context 2
pwsh tools/rag-search.ps1 -Keyword 'VAR_GLOBAL_RETAIN|RETAIN' -Doc '应用篇|程序设计'
```

更完整的「要查什么 → 哪本手册 → 关键词」见 [查找指南.md](查找指南.md)。

## 已核实锚点（摘录）

| 事实 | 出处 | 状态 |
|---|---|---|
| `LIMIT` 有两条路径：ST 用通用功能 `d := LIMIT(s1下限, s2输入, s3上限)`；梯形图指令 `LIMIT(P)` **不支持 ST** | 指令篇 p1265/1267、p712 注 | ✅ 已修正 analyzer 误报陷阱 + 测试 |
| `RAMPF` 是应用指令，ST 形式 `ENO := RAMPF(EN, s1, s2, n, d);`（5 操作数） | 指令篇 8.17 p747 | ✅ 已加入函数白名单 + 测试 |
| 三菱**无 RAMP / RAMP_REAL**（只有 RAMPF） | 指令篇检索「RAMP」无命中、只有 RAMPF | ✅ 已修正提示文案 |
| `TON`/`TOF`/`TP`/`CTU`/`CTD`/`CTUD`/`R_TRIG`/`F_TRIG`/`RS`/`SR` 的**完整形参表**（名称/方向/类型）已逐页核实 | 指令篇 29~32 章：SR p1298、RS p1300、R_TRIG p1302、F_TRIG p1304、CTU p1306、CTD p1308、CTUD p1310、TP p1315、TON p1317、TOF p1319 | ✅ 写入 profile（`paramsVerified: verified`）+ `test/fb-knowledge.test.ts` 回归 |
| `SQRT` 同时有指令（p844）与通用功能（p1221）；ST 中可用 | 指令篇 | ✅ 与现有白名单一致 |
| `HIOEN` 高速 I/O 指令存在（p1049） | 指令篇 | ✅ 记录 |
| 旧版白名单里的 `OUT_M/OUT_H/OUT_L/HIOTRK/DHIO_TRK/TIMER_T/COUNTER_FB` 在指令篇中**检索不到** | 指令篇全文检索 | ✅ 已从白名单移除（v0.1 历史错误） |
| FX5U：X/Y `0~1777`（八进制）、M/L `0~32767`、B `0~7FFF`、S `0~4095`、T/C `0~1023`、D `0~7999` 等 | 应用篇 p87、p142 | ✅ profile 一致（本目录 README 旧表已改） |

## 本轮已固化到代码/测试的结论

| 规则 | 依据 | 落地 |
|---|---|---|
| 支持 `(* *)`、`/**/`、`//` 三类注释 | ST 指南 p13/88 | lexer 修复 `/* */`；`test/rag-knowledge.test.ts` |
| ASCII 字符串单引号 / Unicode 双引号；iQ-F 不支持 Unicode 字符串常数 | ST 指南 p31/91、附3 p98 | E019 文案 + W010 告警 |
| ST 中 LIMIT 是 3 参通用功能，不是 4 操作数指令 | 指令篇 p712/p1265 | 移除 LIMIT 陷阱误报 + 参数个数测试 |
| RAMPF ST 形式 5 参、返回 ENO | 指令篇 p747 | 加入白名单 + 测试 |
| 三菱无 RAMP/RAMP_REAL | 指令篇检索 | 修正 KNOWN_TRAPS 文案 |

## 后续计划

1. 用同流程补齐：`TON/TOF/CTU/CTD/CTUD/R_TRIG/F_TRIG` 等 FB 的形参表（指令篇第 28~33 章），
   以数据文件形式进 `src/knowledge/`，analyzer 按形参名/类型校验 E016/E017；
2. 从应用篇提取完整软元件/特殊寄存器表，替换 profile 中的 `unverified` 项（SM/SD 等）；
3. 从模块 FB 参考提取 15 个 FB 的参数表，供定位/温度/串口类工业模板使用；
4. 用测试固化每条知识（`test/knowledge-*.test.ts`），并保留 `source` 页码。
