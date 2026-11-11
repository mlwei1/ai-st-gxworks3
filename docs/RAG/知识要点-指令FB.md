# 知识要点：FX5 指令 / FB 速查（来自官方手册）

> 来源：**JY997D58901《MELSEC iQ-F FX5 编程手册(指令/通用FUN/FB篇)》**（1400 页 PDF）。
> 页码：手册印刷页码（搜索脚本会多 1~3 页，见 [查找指南.md](查找指南.md)）。
> 仅记录已核对的具体事实；更完整的参数表按需再查。

## 1. LIMIT：两条路径，别混用

| 路径 | 用法 | ST 支持 | 出处 |
|---|---|---|---|
| **梯形图/指令** `LIMIT(P)(_U)` | `LIMIT(s1, s2, s3, d)`（4 操作数，d 是目标软元件） | ❌ **不支持 ST/FBD/LD**（手册明确注记，ST 应使用通用功能 LIMIT） | p712（PDF 页 714 附近） |
| **通用功能** `LIMIT(_E)` | `d := LIMIT(s1下限, s2输入值, s3上限);`；带 EN/ENO：`d := LIMIT_E(EN, ENO, s1, s2, s3);` | ✅ | p1265（PDF 页 1267） |

- 语义：输入值 > 上限 → 输出上限；输入值 < 下限 → 输出下限；否则原样输出；
- 支持 BOOL/INT/DINT/WORD/DWORD/REAL/STRING/TIME 等；
- 本工具：`STANDARD_FUNCTIONS.LIMIT` = 3 参、通用函数形式；已移除「LIMIT 陷阱」误报，
  4 操作数写法会报 `E011` 参数个数错误。

## 2. RAMPF：斜坡信号（应用指令）

- ST 形式：`ENO := RAMPF(EN, s1, s2, n, d);`
- 操作数：`s1` 初始值、`s2` 目标值、`n` 过渡扫描次数（1~32767）、`d` 目标数组
  （`d+0` 当前值、`d+1` 扫描次数）、`EN`/`ENO` 执行条件/结果；
- 出处：8.17 斜坡信号指令，p747；
- 三菱**没有** `RAMP`、`RAMP_REAL`（全文检索无此指令）；
- 本工具：`STANDARD_FUNCTIONS.RAMPF` = 5 参、返回 BOOL（ENO）；旧版提示文案已改。

## 3. 定时器 / 计数器 / 边沿检测 FB（第 28~33 章）

| FB | 作用 | ST 调用示例（手册写法） | 出处 |
|---|---|---|---|
| `TP` / `TP_E` / `TP_10(_E)` | 脉冲定时器（指定时间 ON） | `TP_1(IN:=s, PT:=n, Q:=d1, ET:=d2);`（`TP_1` 中 1 为实例名） | 32.1，p1315 |
| `TON` / `TON_E` 等 | 接通延时定时器，指定时间后输出 ON | 见 p1317 起 | 32 章，p1317 |
| `CTU` / `CTU_E` 等 | 上升沿计数 | 见 p1306 起 | 30 章，p1306 |
| `F_TRIG` / `F_TRIG_E` | 下降沿检测 | `F_TRIG_1(CLK:=s, Q:=d);` | 30.2，p1306 邻页（PDF 页 1306） |

- 共同规律：无 EN/ENO 版 → `FB_实例(形参:=实参, ...)`；带 `_E` 版 → 前两个参数为 `EN, ENO`；
- 输出参数形参名：定时器常见 `Q`、`ET`；边沿检测 `Q`；计数器 `Q`、`CV` 等（按具体页核对）；
- 本工具 analyzer 已支持 FB 形参校验（`STANDARD_FB_SIGNATURES`），新增 FB 时照手册参数表补数据。

## 4. 其他已核对指令

| 指令/函数 | 结论 | 出处 |
|---|---|---|
| `SQRT` / `SQRT(P)` | 存在：指令（16 位平方根，p844）与通用功能（p1221）；ST 可用 | 指令篇 |
| `ESQRT` | 单精度实数平方根（ST 指南示例用 `SQRT`） | 指令篇 p78 一览 |
| `HIOEN` | 高速 I/O 启用/停止指令，存在 | p1049 |
| `OUT_M` / `OUT_H` / `OUT_L` | **不存在**（v0.1 白名单历史错误，全文检索无命中） | 全文检索 |
| `TIMER_T` / `COUNTER_FB` | **不存在**（同上；正确做法用 TON/CTU 等 FB） | 全文检索 |
| `HIOTRK` / `DHIO_TRK` | 本次检索未命中；使用时需再确认 | 全文检索 |

## 5. 与代码的对应关系

| 知识 | 代码位置 |
|---|---|
| 标准函数白名单 / 参数个数 | `src/dialect/instructions.ts` → `STANDARD_FUNCTIONS` |
| 方言陷阱提示（RAMP_REAL 等） | 同上 → `KNOWN_TRAPS` |
| 未知函数告警（W007） | `src/dialect/analyzer.ts` |
| 软元件范围 | `src/profile/fx5u.ts`（每条带手册来源） |
| 规则回归 | `test/rag-knowledge.test.ts` |

## 6. 待补

- TON/TOF/CTU/CTD/CTUD/R_TRIG/F_TRIG 的**完整形参表**（输入/输出名、类型、默认值）；
- 第 25 章「通用功能」清单（SEL/MUX/MAX/MIN/LIMIT 等）与 ST 参数顺序；
- 模块 FB（定位/温度/串口）参数表（来自 FX5 CPU 模块 FB 参考，另见 README 清单）。
