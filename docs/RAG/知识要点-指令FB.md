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

## 3. 定时器 / 计数器 / 边沿检测 / 锁存 FB（29~32 章，形参已逐页核实）

> 核实日期 2026-11-11，来源 JY997D58901；页码为手册**印刷页**（PDF 页序多 2 页）。
> 已写入 `src/profile/fx5u.ts`（`FX5_STANDARD_FBS`，`paramsVerified: 'verified'`），
> 并由 `test/fb-knowledge.test.ts` 回归。

### 3.1 定时器：`TP` / `TON` / `TOF`

| 形参 | 方向 | 类型 | 说明 |
|---|---|---|---|
| `IN` | 输入变量 | BOOL | 时间计测（TP 为“输出开始”） |
| `PT` | 输入变量 | TIME | 延迟/输出时间设定，0~32767ms |
| `Q` | 输出变量 | BOOL | 输出 |
| `ET` | 输出变量 | TIME | 经过时间 |

| FB | 功能 | ST 示例 | 出处 |
|---|---|---|---|
| `TP` | 脉冲定时器：IN=ON 后 Q 保持 PT 时间 | `TP_1(IN:=s, PT:=T#1s, Q:=d1, ET:=d2);` | 32.1 p1315 |
| `TON` | 接通延时：IN=ON 持续 PT 后 Q=ON | `TON_1(IN:=s, PT:=T#2s, Q:=d1, ET:=d2);` | 32.2 p1317 |
| `TOF` | 断开延时：IN 由 ON→OFF 后 Q 再保持 PT | `TOF_1(IN:=s, PT:=T#500ms, Q:=d1, ET:=d2);` | 32.3 p1319 |

### 3.2 计数器：`CTU` / `CTD` / `CTUD`

| 形参 | 方向 | 类型 | 说明 |
|---|---|---|---|
| `CU` | 输入变量 | BOOL | 递增计数（OFF→ON 加 1） |
| `CD` | 输入变量 | BOOL | 递减计数（OFF→ON 减 1） |
| `R` | 输入变量 | BOOL | 计数值复位（CTU/CTUD） |
| `LD` | 输入变量 | BOOL | 计数值设置（CTD/CTUD） |
| `PV` | 输入变量 | INT | 计数最大值/开始值（0~32767） |
| `Q` | 输出变量 | BOOL | 计数完成（CTU/CTD） |
| `QU` / `QD` | 输出变量 | BOOL | 递增/递减计数完成（CTUD） |
| `CV` | 输出变量 | INT | 当前计数值 |

| FB | 输入 → 输出 | 出处 |
|---|---|---|
| `CTU` | CU, R, PV → Q, CV | 31.1 p1306 |
| `CTD` | CD, LD, PV → Q, CV | 31.2 p1308 |
| `CTUD` | CU, CD, R, LD, PV → QU, QD, CV | 31.3 p1310 |

### 3.3 边沿检测 / 锁存

| FB | 形参 | 功能 | 出处 |
|---|---|---|---|
| `R_TRIG` | CLK → Q | 上升沿输出 1 个扫描 | 30.1 p1302 |
| `F_TRIG` | CLK → Q | 下降沿输出 1 个扫描 | 30.2 p1304 |
| `RS` | S, R1 → Q1 | 复位优先锁存 | 29.2 p1300 |
| `SR` | S1, R → Q1 | 设置优先锁存 | 29.1 p1298 |

### 3.4 调用规则

- 无 EN/ENO 版：`FB实例(形参:=实参, ..., 输出=>变量);`（如 `t1(IN:=s, PT:=T#1s, Q=>d);`）；
- 带 EN/ENO 版为独立类型/变体（如 `TON_E`、`TON_10`），前两个形参为 `EN`/`ENO`
  （本工具当前只对无 EN/ENO 版做形参校验；生成代码默认用无 EN/ENO 版）；
- `PT` 必须是 `TIME`（`T#1s` / `T#500ms`），不要传常数 1000；
- analyzer 已按 `STANDARD_FB_SIGNATURES` 校验 E016（未知输入）/E017（未知输出）/
  W009（缺必填输入），数据来自 profile，测试见 `test/fb-knowledge.test.ts`。

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
| 标准 FB 形参表（名称/方向/类型） | `src/profile/fx5u.ts` → `FX5_STANDARD_FBS[].params` |
| FB 形参校验（E016/E017/W009） | `src/dialect/analyzer.ts` → `checkFbInstanceCall` |
| FB 知识回归 | `test/fb-knowledge.test.ts` |

## 6. 待补

- ✅ **已完成**：TON/TOF/TP/CTU/CTD/CTUD/R_TRIG/F_TRIG/RS/SR 完整形参表（名称/方向/类型/必填）；
- 第 25 章「通用功能」清单（SEL/MUX/MAX/MIN/LIMIT 等）与 ST 参数顺序（部分已核实，见指令篇 p1265 等）；
- `_E`（EN/ENO）变体与 `_10`（10ms 单位）定时器变体的形参表；
- 模块 FB（定位/温度/串口）参数表（来自 FX5 CPU 模块 FB 参考，另见 README 清单）。
