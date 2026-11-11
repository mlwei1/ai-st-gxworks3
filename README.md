# ai-st-gxworks3

AI 驱动的三菱 PLC **GX Works3 ST 语言**代码生成与校验工具。

面向 **MELSEC iQ-F / FX5U**（当前已验证；iQ-R 尚未验证），把自然语言控制需求变成可直接导入 GX Works3 的
ST 程序，并在导入前完成语法与三菱方言的静态检查。

> **v0.3 核心流程（M0–M3 已验证）**：`gen`（Spec → ST + IEC 61131-10 XML）→ GX Works3 导入编译 →
> `sim` 仿真场景断言 → `deliver` 交付包（报告 + 需求追溯矩阵 + SHA256）→ `mcp` 供 AI Agent 调用。
> 纯 ST 模板工程 `templates/FX5U_ST_Template.gx3`；总体设计与证据见 [docs/整体方案.md](docs/整体方案.md)。

---

## 30 秒上手（v0.2）

```bash
# 1. Spec → ST + IEC 61131-10 XML（12 个模板可选）
node --experimental-strip-types --no-warnings src/cli.ts gen specs/motor_start_stop.json -o ./out

# 2. 本地校验（语法 + 三菱方言）
node --experimental-strip-types --no-warnings src/cli.ts check out/motor_start_stop.st

# 3. 复制纯 ST 模板工程（不要直接改模板）→ GX Works3 导入 out/motor_start_stop.xml → 全部转换 0 error
copy templates\FX5U_ST_Template.gx3 %TEMP%\run.gx3

# 4. 仿真断言（半自动）与交付包
node --experimental-strip-types --no-warnings src/cli.ts sim sim/motor_start_stop.sim.json --observed sim/motor_start_stop.obs.json
node --experimental-strip-types --no-warnings src/cli.ts deliver specs/motor_start_stop.json -o ./out/deliver_motor
```

> **Spec 驱动生成（M1）**：`gen specs/motor_start_stop.json -o out` 会按模板生成 ST + IEC XML 工程包
> （`specs/` 下有多个示例；`gen --list-templates` 查看 12 个标准/行业模板）。
>
> **ST 步进程序 / 定位模板（M3+）**：`gen specs/robot_transfer_steps.json`（SFC/STL 风格的 ST 步进）、
> `gen specs/positioning_drva.json`（DRVA 定位模板）、`gen specs/temperature_two_position.json`（位式温控模板）；均已在 GX Works3 导入 + 全部转换验证 0 error。
> 详见 [docs/ST步进程序.md](docs/ST步进程序.md)、[docs/定位模板.md](docs/定位模板.md)。`r`n> 仿真导入/运行步骤见 [docs/仿真操作手册.md](docs/仿真操作手册.md)。
>
> **仿真场景断言（M2）**：`sim sim/motor_start_stop.sim.json --observed sim/motor_start_stop.obs.json`
> 校验「写输入 → 读输出」场景（半自动执行器，详见 [sim/README.md](sim/README.md)）。
>
> **M3 交付与 MCP**：`deliver` 生成 report.md / trace.json（需求追溯矩阵）/ delivery.json（SHA256 清单）；
> `node src/cli.ts mcp` 启动内置 MCP Server（5 个工具），供 Claude/DeepSeek 等 Agent 调用，
> 详见 [docs/M3-交付与MCP.md](docs/M3-交付与MCP.md)。
>
> **LLM 兜底 + 编译诊断回灌**：模板失败时加 `--llm` 走 LLM 生成；把 GX Works3 转换错误整理成
> JSON/文本后 `--llm --compiler-errors errors.json` 可带着真实编译错误重新生成
> （详见 [docs/编译诊断回灌.md](docs/编译诊断回灌.md)；LLM 需要 `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`）。
>
> 备用通道（v0.1，标签 CSV + 粘贴 ST 正文）：`build-text`，见 [docs/快速上手.md](docs/快速上手.md)；
> 该文档中「标签 XML 导入」的说法已过时（标签编辑器只支持 CSV 导入）。

---

## 为什么需要它

三菱 GX Works3 的工程文件（`.gx3` / `.gxp`）是**专有二进制格式**，无法被外部工具直接读写。
GX Works3 也没有西门子那种 `.scl` 式 ST 文本导入（外部文本还不能直接粘进梯形图，
剪贴板是专有二进制）。

所以唯一可行的路径是**分三块落地**：

| 产物 | 落地方式 |
|---|---|
| 全局标签 | CSV 导入（`全局标签 → 右键 → 导入文件`） |
| 局部标签 | CSV 导入（`程序/FB → 右键 → 局部标签 → 导入文件`） |
| ST 程序本体 | 复制粘贴进「程序本体」工作表 |

本工具把这三块一次性生成好，你只需要点几下菜单。

---

## ⚠️ 重要：GX Works3 的硬约束（决定了整个技术路线）

GX Works3 强制「结构化工程」模式，**变量声明与 ST 本体是分离存储的**：

| 元素 | 位置 | 能否外部写入 |
|---|---|---|
| 全局标签 | 全局标签工作表 | ✅ **CSV 导入**（XML 只能导出） |
| 局部标签 | **「标签设置」工作表** | ✅ **CSV 导入**（XML 只能导出） |
| ST 程序本体 | **「程序本体」工作表** | ✅ 可粘贴（ST 编辑器是纯文本编辑器） |
| 梯形图 | 梯形图编辑器 | ❌ 剪贴板是专有二进制 |
| 工程文件 | `.gx3` / `.gxp` | ❌ 专有二进制格式 |
| 整个工程 | `工程 → 导入 → IEC61131-10 XML格式` | ❌ 导入后程序内容为空 |

官方文档明确说明（三菱 ST 编程说明）：

> 你没有办法像 codesys 系那样在文本中直接定义标签。

**因此本工具的主流程是「生成文本 + 导入标签 CSV」，不是生成工程文件。**
详见 [docs/快速上手.md](docs/快速上手.md)。

---

## 核心能力

| 能力 | 说明 |
|---|---|
| **ST 解析器** | 自建词法/语法分析，覆盖 POU、VAR 段、STRUCT、CASE/FOR/WHILE/REPEAT、功能块调用 |
| **三菱方言检查** | 拦截跨品牌写法、隐式类型转换、越界设备地址、非法变量名等 |
| **Spec 驱动生成（M1）** | 需求规格 JSON → 12 个标准/行业模板 → ST + IEC 61131-10 XML + 标签 CSV |
| **ST 步进程序（SFC/STL 的 ST 实现）** | `spec.sequence` 定义步/动作/转移/分支/延时 → 生成 `nStep + CASE` 步号状态机（纯 ST） |
| **定位模板（工业场景）** | `positioning_drva`：DRVA ST 指令 + 完成/超时/出错处理，见 [docs/定位模板.md](docs/定位模板.md) |
| **温控模板（工业场景）** | `temperature_two_position`：位式温控（加热/冷却 + 回差 + 超量程保护），见 [docs/温度模板.md](docs/温度模板.md) |
| **MODBUS 模板（工业场景）** | `modbus_read`：ADPRW 主站读取保持/输入寄存器（完成/异常/超时），见 [docs/Modbus模板.md](docs/Modbus模板.md) |
| **串口模板（工业场景）** | `serial_send_recv`：RS2 无协议收发（完成/超时/异常 + 特殊软元件判定），见 [docs/串口模板.md](docs/串口模板.md) |
| **仿真场景断言（M2）** | 场景 DSL + 观测文件断言 + CLI `sim`（GX Simulator3 半自动执行） |
| **交付工程包（M3）** | `deliver`：report.md + 需求追溯矩阵 trace.json + SHA256 交付清单 |
| **MCP Server（M3）** | `mcp`：stdio JSON-RPC，5 个工具（check/generate/build-xml/sim/deliver），供 AI Agent 调用 |
| **CLI** | `check` / `gen` / `sim` / `deliver` / `mcp` / `build-xml` / `build-text` / `generate`，零运行时依赖 |

---

## 快速开始

### 环境要求

- Node.js **22.6+**（使用原生 TypeScript 类型剥离，无需编译步骤）
- GX Works3（导入时需要）

```bash
# 校验 ST 代码
node --experimental-strip-types --no-warnings src/cli.ts check examples/motor_demo.st

# 生成可粘贴的 ST 文本 + 标签 CSV（主流程）
node --experimental-strip-types --no-warnings src/cli.ts build-text examples/motor_demo.st -o ./out

# AI 生成
node --experimental-strip-types --no-warnings src/cli.ts generate "电机启停控制，按下启动按钮运行10秒后自动停止"
```

安装为全局命令：

```bash
npm link
ai-st-gxworks3 check program.st
```

---

## 命令说明

### `check` —— 静态检查

```bash
ai-st-gxworks3 check program.st [更多文件...]
```

对 ST 源码做语法解析 + 三菱方言检查，输出分级诊断：

```
motor_demo.st —— 0 个错误, 0 个警告

✖ program.st:25:5 [Main] E008: 未定义的标识符 'bFault'
    ↳ 检查拼写、是否在 VAR 段声明，或是否使用了其他品牌的指令
```

诊断码分三类：

- **E0xx** —— GX Works3 编译必然失败
- **W0xx** —— 能编译但很可能埋坑（跨品牌写法、隐式转换、地址冲突）
- **I0xx** —— 风格建议

常见诊断：

| 码 | 含义 |
|---|---|
| `E004` | 未知数据类型 |
| `E008` | 未定义的标识符 |
| `E010` | 用了其他品牌的函数（西门子 `IREF` 等） |
| `E014` | 把数值赋给 BOOL |
| `E015` | 整数与浮点隐式赋值（三菱不允许） |
| `E016` / `E017` | 功能块形参名错误（如 `RS` 用 `SET` 而非 `S`） |
| `E009` | 设备地址越界 |

### 错误恢复

检查器**一次运行报告全部问题**，而不是遇到第一个错误就停：

- 某个 POU 有语法错误 → 其他 POU 照常检查
- POU 内某条语句写错 → 该 POU 的其余语句照常检查
- 同一位置的重复错误自动去重

```
bad_example.st —— 1 个语法错误
✖ bad_example.st:29:5 语法错误: 保留字 'IF' 不能作为变量名

bad_example.st —— 5 个错误, 2 个警告
✖ bad_example.st:38:5 [BadExample] E016: 功能块 'TON' 没有名为 'INPUT' 的输入参数
    ↳ 可用输入参数：IN, PT
```

`examples/bad_example.st` 是一份故意写错的样例，演示检查器能拦住哪些问题。

### `build-text` —— 生成可粘贴文本（主流程）

```bash
ai-st-gxworks3 build-text program.st -o ./out
```

产出：

```
out/
├── Main.st               ← 粘贴进「程序本体」工作表
├── Main_labels.txt       ← 「标签设置」工作表录入表
├── FB_Motor.st
├── FB_Motor_labels.txt
├── global_labels.csv     ← 导入「全局标签」
└── local_labels_table.txt
```

完整导入步骤见 **[docs/GXWorks3-导入指南.md](docs/GXWorks3-导入指南.md)**。

### `generate` —— AI 生成

```bash
ai-st-gxworks3 generate "水箱液位控制，低于10%启动水泵，高于90%停泵" --io io.txt --out tank.st
```

流程：调用 LLM → 解析 JSON → 还原成 ST → **静态检查** → 输出 `.st` + 标签 CSV + 录入表。

内置两种重试：

- **输出格式错误** → 把错误信息反馈给模型，让它自我修正后重新输出
- **网络/超时/5xx** → 指数退避后重试（4xx 属请求本身问题，直接失败）

LLM 凭据从环境变量读取（与 MCode 运行时一致）：

```bash
export ANTHROPIC_BASE_URL="https://api.deepseek.com/anthropic"
export ANTHROPIC_AUTH_TOKEN="sk-..."
export ANTHROPIC_MODEL="deepseek-v4-pro[1m]"
```

---

### `step_sequence` —— ST 步进程序（SFC/STL 的 ST 实现）

在 spec 中加 `sequence` 段并令 `template.name = "step_sequence"`，按工位分步生成 ST：

```bash
ai-st-gxworks3 gen specs/robot_transfer_steps.json -o out/robot_steps
```

生成「步号状态机」：`nStep` + 步转移 `CASE` + 按步输出，等价梯形图 STL 的步进写法（**纯 ST，不含 SFC 对象**）。
支持选择分支（多条 `next`）、延时转移（`delayMs`）、表达式动作；并行分支暂不支持。
详见 [docs/ST步进程序.md](docs/ST步进程序.md)。

### `positioning_drva` —— 定位模板（工业场景）

```bash
ai-st-gxworks3 gen specs/positioning_drva.json -o out/positioning_drva
```

生成 `ENO := DRVA(EN,s1,s2,d1,d2);` 的 ST 调用 + 完成（SM5500 下降沿）/超时/出错处理；
参数：轴号、目标地址、速度、脉冲/方向 Y。需在 GX 模块参数中配置定位参数后才会实际输出脉冲。
详见 [docs/定位模板.md](docs/定位模板.md)。

### `deliver` —— 交付工程包（M3）

```bash
ai-st-gxworks3 deliver specs/motor_start_stop.json -o out/deliver_motor `
  --sim docs/evidence/M2/02-sim-scenario/report.json
```

产出 `report.md`（人读交付报告 + 需求追溯矩阵）、`trace.json`（机读追溯）、
`delivery.json`（每个文件的 SHA256）、`artifacts/`（ST/XML/CSV/manifest）与 `evidence/`。
失败也会产出报告并标 FAIL。详见 [docs/M3-交付与MCP.md](docs/M3-交付与MCP.md)。

### `mcp` —— 内置 MCP Server（M3）

```bash
ai-st-gxworks3 mcp
```

stdio JSON-RPC 服务，暴露 `st_check` / `spec_generate` / `st_build_xml` / `sim_validate` / `deliver`
五个工具，可直接挂到 Claude/DeepSeek 等支持 MCP 的 Agent 上。零依赖实现。

## 三菱方言规则

这是本工具区别于「通用 IEC 61131-3 代码生成」的核心。以下规则已内置到提示词和静态检查器中。

### 指令白名单

| 类别 | 允许 |
|---|---|
| 标准功能块 | `TON` `TOF` `TP` `CTU` `CTD` `CTUD` `R_TRIG` `F_TRIG` `RS` `SR` |
| 三菱功能块 | `OUT_M` `OUT_H` `OUT_L` `TIMER_T` `COUNTER_FB` `RAMPF` `RAMP` `MC_HOM` `MC_MOVE_ABSOLUTE` `MC_MOVE_RELATIVE` `MC_MOVE_VELOCITY` `MC_STOP` `MC_SET_POSITION` `MC_GET_POSITION` `MC_DUTY` `HIOEN` `HIOTRK` `DHIOEN` `DHIO_TRK` |
| 标准函数 | `ABS` `SQRT` `SIN` `COS` `MAX` `MIN` `LIMIT` `SEL` `MUX` `MOV` `SMOV` `BLKMOV` `INT_TO_REAL` `REAL_TO_INT` `LEN` `CONCAT` `MID` `LEFT` `RIGHT` `FIND` `REPLACE` `INSERT` `DELETE` 等 |
| 三菱函数 | `SET` `RST` `PLS` `PLF` `ZR` |

**明确拦截**（AI 最容易误用的部分）：

- 西门子：`IREF` `POKE` `PEEK` `SCALE` `NORM_X`
- CODESYS：`__CALL` `CU_ADD` `RSR` `ROL`
- 伪 IEC：`RAMP_REAL`（三菱用 `RAMPF` / `RAMP`）、`CTU_DINT`、`TONR`

### 类型规则

- 可用类型：`BOOL` `BYTE` `WORD` `DWORD` `INT` `UINT` `DINT` `UDINT` `LINT` `ULINT` `REAL` `LREAL` `TIME` `STRING` `WSTRING`
- **整数与浮点之间不做隐式转换**，必须显式：`nInt := REAL_TO_INT(fValue);`
- `BOOL` 只能用 `TRUE` / `FALSE`，不用 `ON` / `OFF` / `1` / `0`
- 寄存器宽度：`REAL` 占 2 个 D，`LREAL` 占 4 个 D

### 地址规则

| 前缀 | 含义 | FX5U 范围（应用篇 p87/p142） |
|---|---|---|
| `X` / `Y` | 输入 / 输出 | `X0~X1777` / `Y0~Y1777`（**八进制**） |
| `M` / `L` | 内部/锁存继电器 | 0–32767 |
| `B` / `SB` | 链接继电器 | `B0~B7FFF`（十六进制） |
| `S` | 步进继电器 | 0–4095 |
| `T` / `ST` / `C` / `LC` | 定时器 / 累计定时器 / 计数器 / 长计数器 | 0–1023 |
| `D` | 数据寄存器 | 0–7999 |
| `W` / `SW` | 链接寄存器 | `W0~W7FFF`（十六进制） |
| `R` / `ER` | 文件寄存器 / 扩展文件寄存器 | 0–32767 |
| `Z` / `LZ` | 变址寄存器 | 0–19 / 0–1（可配，合计 24 字） |

`M8000` 以上、`D512` 以上留给编译期自动分配，显式地址落在低区可能冲突。

### 三菱特有陷阱

- `LIMIT` 参数顺序与部分 IEC 实现不同
- `SET(TRUE, Y0)` / `RST(TRUE, Y0)` 是函数，不是 IEC 的 `SR` 触发器
- `OUT_M(M0, Y0)` 是上升沿触发输出
- 简单工程（非 IEC 模式）下 ST 变量声明在**独立工作表**，不在源码里；本工具生成的是
  **结构化工程（IEC 模式）** 格式，声明与本体同处一个 POU

---

## 关于标签 CSV 格式（重要）

GX Works3 的标签**只能导入 CSV**（XML 仅支持导出）。格式很挑，
本工具的 `src/emit/label-csv.ts` 严格按 GX Works3 实际导出文件复刻：

```csv
"(工程未设置)"                                              ← 第 1 行：工程名
"类"	"标签名"	"数据类型"	"常数"	"初始值"	"分配(软元件/标签)"	"地址"	"注释"	…  ← 第 2 行：表头
"VAR_GLOBAL"	"label_global"	"BOOL"	""	""	"M1000"	""	""	…	"0"   ← 数据行
```

关键约束（都是实测踩出来的）：

| 项 | 要求 |
|---|---|
| 分隔符 | **TAB**，不是逗号 |
| 引号 | 每个字段都带双引号，内部引号写两个 |
| 表头 | 第 1 行是**工程名**，第 2 行才是表头 |
| 局部标签 | **27** 列（到「属性」结束） |
| 全局标签 | **28** 列（多「外部设备的访问」列，值为 `0`） |
| 「类」值 | 全局 `VAR_GLOBAL`；局部 `VAR`；FB 形参 `VAR_INPUT`/`VAR_OUTPUT`/`VAR_IN_OUT` |
| 软元件号 | 写在第 6 列「分配(软元件/标签)」，第 7 列「地址」留空 |
| 编码 | **UTF-16LE + BOM** |
| 换行 | LF |

`test/label-csv.test.ts` 会把生成结果与真实导出文件**逐行逐列**比对。

> ⚠️ 自定义类型名（如 `ST_Motor`）**必须保持原样大小写** ——
> GX Works3 区分大小写，写成 `ST_MOTOR` 会指向一个不存在的类型。

---

## 文本输出格式（主流程）

`build-text` 产出三类文件，分别对应 GX Works3 的三个落点：

### 1. 程序本体（`Main.st`）—— 粘贴进「程序本体」工作表

```text
(* ---------- 本 POU 需在「标签设置」工作表建立的局部标签 ----------
   输入   bEnable : BOOL
   输出   bRunning : BOOL
   局部   tRampTimer : TON
   局部   nRampStep : INT := 0
(* ----------------------------------------------------------- *)

IF bEnable THEN
    tRampTimer(IN := TRUE, PT := T#100ms);
    IF tRampTimer.Q THEN
        nRampStep := nRampStep + 10;
    END_IF;
    bRunning := TRUE;
END_IF;
```

顶部的注释块是给人工核对用的，不影响编译，可用 `--no-declare` 去掉。

### 2. 标签 CSV（`*_local_labels.csv` / `Global.csv`）—— 直接导入

格式与 GX Works3 导出的标签文件**逐行逐列一致**（TAB 分隔、UTF-16 + BOM）。
导入路径：

- 局部标签：程序/FB 右键 → **局部标签** → **导入文件** → 选 `Main_local_labels.csv`
- 全局标签：**全局标签** → 右键 → **导入文件** → 选 `Global.csv`

### 3. 标签录入表（`Main_labels.txt`）—— 备选

```text
(* FB_Motor —— 在「标签设置」工作表按此表逐行录入
   方向    标签名              数据类型   初始值   软元件     注释
   输入    bEnable             BOOL                         启动命令
   输出    bRunning            BOOL                         运行状态
   局部    tRampTimer          TON                          斜坡定时器
   局部    nRampStep           INT          0              斜坡步进
*)
```

---

## 关于「工程 → 导入 → IEC61131-10 XML格式」

**已实测可用，是本工具的主路径（M0/M1 验证）**。GX Works3 1.128 上导入本工具生成的
IEC 61131-10 XML 后，程序本体、局部标签、全局标签、结构体一次落地，`全部转换` **Error 0 / Warning 0**。
（早期 v0.1 生成的 PLCopen TC6_0201 格式导入为空，该结论已作废；证据见 `docs/evidence/M0/`。）

注意事项：
- 资源执行类型必须是 `scan`（本工具已固化），否则程序会被放到 Initial 只执行一次；
- 锁存区变量（如 D200+）需声明为 `VAR_GLOBAL_RETAIN`，否则编译报 `0x11021040`（发射器已按此分组）；
- 标签 CSV + 粘贴 ST 仍作为**备选通道**保留（`build-text`）。

---


## 项目结构

```
src/
  dialect/
    lexer.ts       词法分析（注释、进制前缀、时间字面量、=> 输出参数）
    parser.ts      递归下降语法分析 + 语句级错误恢复
    recovery.ts    多错误收集（一次报告全部问题）
    ast.ts         AST 定义
    analyzer.ts    语义分析与方言检查
    types.ts       FX5U 类型系统与兼容规则
    instructions.ts 指令白名单、陷阱、地址范围、功能块形参表
  emit/
    text.ts        ★ ST 文本输出（程序本体 / 标签录入表）
    label-csv.ts   ★ 标签 CSV（TAB 分隔、UTF-16，与 GX Works3 导出格式一致）
    unparser.ts    AST → ST 源码
  ai/
    prompt.ts      三菱方言系统提示词
    client.ts      LLM 调用与 JSON 重试
    convert.ts     AI JSON → ST/AST
  cli.ts           命令行入口
test/
  dialect.test.ts         解析器与检查器
  text.test.ts            ST 文本输出格式
  label-csv.test.ts       标签 CSV（与 GX Works3 实际导出逐行逐列比对）
  ai.test.ts              AI 输出转换层
  prompt.test.ts          提示词内容与格式
  recovery.test.ts        语法错误恢复
examples/
  motor_demo.st   三相电机启停控制示例（正确代码）
  bad_example.st  故意写错的反例（演示检查器）
  io_table.txt    IO 分配表示例
  out_motor/      build-text 的产物示例
docs/
  GXWorks3-导入指南.md   完整导入操作手册
```

---

## 开发

```bash
npm test          # 203 个测试（含 deliver / MCP 集成测试）
npm run check -- examples/motor_demo.st
```

零运行时依赖，仅用 Node 内置模块与 `node:test`。

---

## 已知限制

- **局部标签需手工录入**。GX Works3 的标签在「标签设置」工作表单独维护，
  贴 ST 文本不会自动建标签。工具提供 `*_labels.txt` 录入表来降低这项工作量，
  但这一步目前无法自动化。
- **仅覆盖 ST**。梯形图 / FBD 无法从外部粘贴（三菱剪贴板是专有二进制），
  也不生成图形化程序体。
- **不覆盖硬件配置**。模块型号、I/O 分配、网络参数需在 GX Works3 中配置；
  全局标签的设备地址由 `--io` 指定或写在 ST 的 `VAR_GLOBAL` 段里。
- **不下载 PLC**。MC/SLMP 协议可读写软元件，但不能写程序；
  程序下载仍需 GX Works3 在线操作。
- **HMI 标签需物理地址**。三菱 HMI/上位机不支持按符号名寻址，
  供 HMI 读写的全局变量必须显式分配地址。

---

## 许可证

MIT
