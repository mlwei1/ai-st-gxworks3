# ST 步进程序（SFC/STL 的 ST 实现）

工业设备（搬运机械手、装配工位、包装机等）的运动是**一步一步**的：上一步动作到位，
满足转移条件后进入下一步。梯形图里通常用 **SFC（顺序功能图）** 或 **STL（步进梯形图）** 表达；
本项目只做 ST，因此用**等价的步号状态机**实现同样的语义：

| SFC / STL 概念 | ST 实现 |
|---|---|
| 步（Step） | `nStep : INT`（0=待机，1..N=步号） |
| 初始步 | 启动时 `nStep := initialIndex` |
| 步动作（Action） | 按 `nStep` 的 `CASE` 输出（每扫描持续执行） |
| 转移条件（Transition） | `IF <条件> THEN nStep := <下一步>` |
| 选择分支（Divergence） | 多条转移按顺序 `IF / ELSIF`，先真先走 |
| 汇合（Convergence） | 多个步的转移指向同一个目标步 |
| 步延时 | `delayMs`（共享 TON + 每步设定值） |
| 停止/故障 | 统一复位 `nStep := 0; bRun := FALSE`（输出全 OFF） |

> 当前**不支持**并行分支（SFC parallel）、动作限定符（N/S/R/L/D）、步监视/步复位指令。
> 需要并行时，可生成两个步进程序 + 互锁实现。

---

## 1. 在 spec 里描述步进程序

```json
{
  "template": { "name": "step_sequence" },
  "sequence": {
    "initialStep": "S1",
    "startCondition": "X0",
    "stopCondition": "X1",
    "faultCondition": "X2",
    "steps": [
      {
        "id": "S1",
        "name": "竖直下降",
        "actions": [{ "target": "Y0", "value": "ON" }],
        "next": { "condition": "X10", "to": "S2" }
      },
      {
        "id": "S2",
        "name": "夹紧",
        "actions": [
          { "target": "Y0", "value": "ON" },
          { "target": "Y2", "value": "ON" }
        ],
        "next": { "condition": "X11", "to": "S3" }
      }
    ]
  }
}
```

### sequence 字段

| 字段 | 说明 |
|---|---|
| `initialStep` | 初始步 ID（缺省 = steps 第一个） |
| `startCondition` | 启动条件表达式（缺省 `X0`，**上升沿启动**） |
| `stopCondition` | 停止条件表达式（缺省 `X1`） |
| `faultCondition` | 故障/急停条件表达式（缺省 `X2`） |
| `steps[]` | 步列表（至少 1 步） |

### step 字段

| 字段 | 说明 |
|---|---|
| `id` | 步 ID（唯一，合法标识符，如 `S1`） |
| `name` | 步名称（注释/报告用） |
| `actions[]` | 步动作：`{ "target": "Y0", "value": "ON" }`，或 `{ "target": "nCount", "expression": "nCount + 1" }` |
| `next` | 转移：单个对象或对象数组（选择分支） |

### transition 字段

| 字段 | 说明 |
|---|---|
| `condition` | ST 布尔表达式（如 `X10 AND NOT X11`） |
| `delayMs` | 延时推进（毫秒，正整数）；与 condition 同时出现 = 条件 AND 延时到位 |
| `to` | 目标步 ID；`END` 表示结束本序列（回待机、停输出） |

约束（`spec` 加载时校验）：
- 步 ID 唯一、`initialStep` 必须存在；
- 转移目标必须存在（或 `END`）；
- 转移必须有 `condition` 或 `delayMs`；
- 动作必须给 `value`(ON/OFF) 或 `expression`，二者不能同时；
- `template.name` 必须为 `step_sequence`，且必须提供 `sequence`。

---

## 2. 生成代码结构（以机械手为例）

```st
PROGRAM Main
VAR
    nStep : INT := 0;                 // 0=待机；1..N=步号
    bRun : BOOL := FALSE;             // 运行中
    bStartLast : BOOL := FALSE;       // 启动上升沿
END_VAR

    // 1) 停止 / 故障：直接回待机
    IF (X1) OR (X2) THEN
        bRun := FALSE;
        nStep := 0;
    END_IF;

    // 2) 启动
    IF (X0) AND NOT bStartLast AND NOT bRun AND NOT (X1) AND NOT (X2) THEN
        bRun := TRUE;
        nStep := 1;
    END_IF;
    bStartLast := (X0);

    // 3) 步转移（选择分支先真先走）
    IF bRun THEN
        CASE nStep OF
            1:
                IF (X10) THEN
                    nStep := 2;
                END_IF;
            2:
                IF (X11) THEN
                    nStep := 3;
                END_IF;
            ...
        END_CASE;
    END_IF;

    // 4) 输出驱动（先全断，再按步置位）
    Y0 := FALSE; Y1 := FALSE; Y2 := FALSE; Y3 := FALSE; Y4 := FALSE;
    IF bRun THEN
        CASE nStep OF
            1: Y0 := TRUE;
            2: Y0 := TRUE; Y2 := TRUE;
            ...
        END_CASE;
    END_IF;
END_PROGRAM
```

要点：
- **输出先复位再置位**：避免上一步输出残留（等价 STL 的「步进接点」语义）；
- 每扫描执行的动作 = SFC 的「N（非存储）动作」；需要 S/R 等限定符时用 `expression` 自行实现；
- 延时转移才有 `bTimerDone / tStep / tStepTime / bTimerReset` 变量，并在步切换时复位一个扫描，
  保证下一步重新计时；
- 转移条件是任意 ST 布尔表达式，可组合传感器、定时器 `.Q`、计数器比较等。

---

## 3. 选择分支 / 汇合 / 延时

**选择分支**（多条 next）：

```json
"next": [
  { "condition": "X10 AND X12", "to": "S2" },
  { "condition": "X11", "to": "S3" }
]
```

生成 `IF (X10 AND X12) THEN ... ELSIF (X11) THEN ... END_IF;`（先真先走）。

**汇合**：多个步的 `to` 指向同一个步即可。

**延时**：`"next": { "delayMs": 1500, "to": "S2" }`，生成共享 TON；
也可写 `{ "condition": "X10", "delayMs": 500, "to": "S2" }` = 「X10 到位后 500ms 再走」。

---

## 4. 生成与验证

```bash
# 生成 ST + IEC XML
node --experimental-strip-types --no-warnings src/cli.ts gen specs/robot_transfer_steps.json -o out/robot_steps

# 本地校验（生成时已自动做；也可单独跑）
node --experimental-strip-types --no-warnings src/cli.ts check out/robot_steps/robot_transfer_steps.st
```

### GX Works3 导入验证（2026-11-11，FX5U，GX Works3 1.128.0.1）

验证流程（**不要生成 SFC 骨架程序**）：

1. GX Works3 → 新建工程：系列 FX5CPU / 机型 FX5U / **程序语言「不指定」**；
2. 工程(P) → 导入文件 → IEC61131-10 XML格式 → 选 `out/robot_steps/robot_transfer_steps.xml`；
3. 转换(C) → 全部转换(R) → 确定。

结果：ST Program 直接落在 **程序 → 扫描 → Main → Main**（程序本体 + 局部标签 `nStep`/`bRun`/`bStartLast`），
全部转换 **Error:0 Warning:0**。

证据：
- [02-step-program-gx-import.png](evidence/M3/02-step-program-gx-import.png)：程序树（Main 在 MAIN 下）+ 输出窗口 Error:0；
- [03-step-program-gx-labels.png](evidence/M3/03-step-program-gx-labels.png)：Main 的局部标签（生成变量已导入）；
- [04-step-program-gx-comments.png](evidence/M3/04-step-program-gx-comments.png)：**导入后程序正文保留注释**
  （XML 正文直接使用 ST 源文件原始正文，而不是从 AST 重新生成；2026-11-11 验证 Error:0）。

> 踩坑记录：若新建工程时 GX 自动生成了空 SFC 骨架程序（`000:Block [SFC]`），
> 全部转换会报 `Action0/Transition0 未定义`（这是空 SFC 骨架的问题，**不是**我们生成的 ST 代码）。
> 处理：不要生成 SFC 程序；若已生成，先在工程树删除该 SFC 骨架程序，再导入/转换。
> 我们的 `step_sequence` 只生成 ST 源码（`CASE nStep`），不生成任何 SFC 对象。

示例：
- `specs/robot_transfer_steps.json`：搬运机械手 8 步（下降→夹紧→上升→右移→下降→松开→上升→左移），
  每步由到位信号推进；
- 生成结果：`out/robot_steps/robot_transfer_steps.st` / `.xml`；
- 测试：`test/step-sequence.test.ts`（校验、分支、延时、表达式动作、端到端 gen）。

## 5. 与其它模板的关系

| 场景 | 用哪个 |
|---|---|
| 工位/动作分步、每步有到位信号 | `step_sequence`（本功能） |
| 纯定时多步（无外部信号） | `timer_sequence` 模板 |
| 设备只有 3 态（待机/运行/停止） | `state_machine` 模板 |
| 步内需要复杂分支/并行/动作限定符 | 当前 `step_sequence` 覆盖选择分支；并行需拆两个程序 + 互锁 |

## 6. 后续可扩展

1. 并行分支（`sequence.parallel`）：同一转移同时激活多个步集合；
2. 动作限定符（`N/S/R/L/D`、`P` 脉冲）：`actions[].qualifier`；
3. 步超时监控（`timeoutMs` → 自动故障步/报警）；
4. 由 SFC 图反向生成 `sequence`（图形→spec），以及 `sequence` → Mermaid/SFC 图（报告可视化）。
