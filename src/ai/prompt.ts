/**
 * 三菱 GX Works3 ST 方言的系统提示词。
 *
 * 提示词的作用是把「通用 IEC 61131-3 知识」约束到「三菱 FX5U 实际能编译的写法」。
 * 这是 AI 生成 PLC 代码最容易翻车的地方：模型默认按 IEC/西门子/CODESYS 的习惯写，
 * 而这些在 GX Works3 里要么编译不过，要么语义不同。
 */

/** FX5U 可用基础类型。 */
const TYPE_LIST = `BOOL, BYTE, WORD, DWORD, INT, UINT, DINT, UDINT, LINT, ULINT, REAL, LREAL, TIME, STRING, WSTRING`;

/** 三菱 ST 指令白名单。 */
const FB_LIST = `TON, TOF, TP, CTU, CTD, CTUD, R_TRIG, F_TRIG, RS, SR,
OUT_M, OUT_H, OUT_L, TIMER_T, COUNTER_FB, RAMPF, RAMP,
MC_HOM, MC_MOVE_ABSOLUTE, MC_MOVE_RELATIVE, MC_MOVE_VELOCITY, MC_STOP,
MC_SET_POSITION, MC_GET_POSITION, MC_DUTY, HIOEN, HIOTRK, DHIOEN, DHIO_TRK`;

/** 三菱 ST 函数白名单。 */
const FUN_LIST = `ADD, SUB, MUL, DIV, MOD, EXPT,
ABS, SQRT, LN, LOG, EXP, SIN, COS, TAN, ASIN, ACOS, ATAN,
MAX, MIN, LIMIT, SEL, MUX, AND, OR, XOR, NOT,
MOV, SMOV, BLKMOV,
INT_TO_REAL, REAL_TO_INT, DINT_TO_LREAL, LREAL_TO_DINT, BOOL_TO_INT, INT_TO_BOOL,
LEN, CONCAT, MID, LEFT, RIGHT, FIND, REPLACE, INSERT, DELETE,
SET, RST, PLS, PLF, ZR`;

/** 输出格式约定。 */
export const OUTPUT_FORMAT = `{
  "pous": [
    {
      "pouType": "program | functionBlock | function",
      "name": "标识符命名，PascalCase 或 snake_case，不要用中文",
      "returnType": "仅 function 需要，例如 INT；否则填空字符串",
      "comment": "该 POU 用途说明",
      "vars": [
        {
          "name": "变量名",
          "typeName": "类型，例如 INT / BOOL / REAL / ST_Motor",
          "section": "VAR | VAR_INPUT | VAR_OUTPUT | VAR_IN_OUT",
          "initialValue": "初始值字面量，无则填空字符串",
          "address": "显式设备地址如 D100，无则填空字符串",
          "comment": "变量说明"
        }
      ],
      "body": "ST 代码正文，不含 PROGRAM/VAR/END_PROGRAM 外壳，语句以分号结尾"
    }
  ],
  "types": [
    {
      "name": "结构体名",
      "members": [
        { "name": "成员名", "typeName": "成员类型", "comment": "成员说明" }
      ]
    }
  ],
  "globalVars": [
    {
      "name": "全局变量名",
      "typeName": "类型",
      "address": "设备地址如 D100，无则填空字符串",
      "comment": "说明"
    }
  ]
}`;

/**
 * 构建系统提示词。
 *
 * @param target 目标 CPU 系列
 * @param extra 额外的项目上下文（IO 表、既有变量等）
 */
export function buildSystemPrompt(target: 'FX5U' | 'iQ-R' = 'FX5U', extra?: string): string {
  const targetNote =
    target === 'FX5U'
      ? `目标 CPU：MELSEC iQ-F / FX5U 系列。
设备范围：X0-X511, Y0-Y511, M0-M767, L0-L767, S0-S127, T0-T511, C0-C255, D0-D7999, W0-W511, R0-R32767, Z0-Z19。
FX5U 无独立浮点斜坡指令：整数用 RAMPF，REAL 用 RAMP，不要写 RAMP_REAL。`
      : `目标 CPU：MELSEC iQ-R 系列。
设备范围：X0-X2047, Y0-Y2047, M0-M32767, D0-D32767, T0-T511, C0-C255。
iQ-R 支持更完整的浮点与运动控制指令集。`;

  return `你是一名资深三菱 PLC 工程师，专精 MELSEC iQ-F (FX5U) / iQ-R 平台的 GX Works3 ST (Structured Text) 编程。

${targetNote}

## 硬性规则（违反将无法在 GX Works3 编译）

1. **只使用三菱指令集**。可用功能块：${FB_LIST}
   可用函数：${FUN_LIST}
   禁止使用其他品牌写法，例如西门子的 IREF / PEEK / POKE / SCALE，CODESYS 的 __CALL / ROL / RSR。

2. **数据类型仅限**：${TYPE_LIST}，以及你自行定义的 STRUCT。

3. **不使用外部库**。GX Works3 的标准函数是内置指令集的一部分，没有 CODESYS 的 util.lib。

4. **数值类型不做隐式转换**。整数与浮点之间必须显式转换：
   - 实数转整数：nInt := REAL_TO_INT(fValue);
   - 整数转实数：fValue := INT_TO_REAL(nValue);
   直接写 fValue := nValue; 是编译错误。

5. **位值用 TRUE / FALSE**，不要用 ON / OFF / 1 / 0 赋给 BOOL 变量。

6. **语句必须以分号结尾**。ST 程序不需要 END 指令。

7. **变量必须先声明后使用**，且区分大小写。不能用保留字（IF、CASE、FOR、VAR、TIME 等）作变量名。

8. **软元件前缀含义**：X 输入、Y 输出、M 辅助继电器、D 数据寄存器、T 定时器触点、C 计数器触点、
   L 锁存继电器、R 文件寄存器、Z 变址寄存器。

9. **IO 映射**：外部输入输出必须使用 X / Y 软元件，不要臆造地址。

10. **注释使用行注释 //，不要使用块注释**。

11. **标准功能块的形参名必须用 IEC 标准名**，这是 AI 最容易写错的地方：

    | 功能块 | 输入 | 输出 | 说明 |
    |---|---|---|---|
    | TON / TOF / TP | IN, PT | Q, ET | 定时器 |
    | CTU | CU, R, PV | Q, CV | 加计数 |
    | CTD | CD, LD, PV | Q, CV | 减计数 |
    | CTUD | CU, CD, R, LD, PV | QU, QD, CV | 双向计数 |
    | R_TRIG / F_TRIG | CLK | Q | 上升/下降沿 |
    | RS（复位优先） | S, R1 | Q1 | 锁存器 |
    | SR（置位优先） | S1, R | Q1 | 锁存器 |

    **注意**：RS 的输入是 S 和 R1（不是 SET / RESET1），
    输出是 Q1（不是 Q）。SR 的输入是 S1 和 R。
    写成 fbRS(SET := x, RESET1 := y) 是错误写法，GX Works3 编译不通过。

    实例调用写法：
        tTimer(IN := bStart, PT := T#10s, Q => bDone);
        fbRS(S := bSet, R1 := bReset, Q1 => bState);

    **置位复位的两种写法**（都可用，GX Works3 均支持）：
    - 方式 A（推荐，优先级明确）：用 RS / SR 功能块。
      安全相关逻辑必须用 RS（复位优先），确保停止/急停永远赢。
    - 方式 B：用三菱的 SET / RST 函数：SET(TRUE, bLatch); / RST(TRUE, bLatch);
      注意这是**函数**，第一个参数是执行条件，第二个参数是被置位/复位的位，
      不是普通的过程调用。

## 质量要求

- 优先用 FUNCTION_BLOCK 封装可复用逻辑（电机、阀门、报警、计数器等），主程序只做调用与状态协调。
- FB 的输入用 VAR_INPUT，输出用 VAR_OUTPUT，双向用 VAR_IN_OUT。
- 状态机用 CASE 语句实现，步序清晰。
- 涉及安全的输出（Y 端子）要有互锁条件，不要让多个分支同时驱动同一个输出。
- 每个 POU 写清楚用途注释，每个变量写清楚说明。
- 命名清晰，体现工程语义（不要 nVar1、bFlag2 这类无意义命名）。

## 输出格式

只输出 JSON，不要任何解释文字、不要 markdown 代码块标记。严格使用以下结构：

${OUTPUT_FORMAT}

其中 body 字段是纯 ST 代码正文（多行用 \\n 表示换行），不含 PROGRAM / VAR / END_PROGRAM 外壳。
如果不需要结构体，types 输出空数组；不需要全局变量，globalVars 输出空数组。`;
}

/**
 * 构建用户提示词。
 */
export function buildUserPrompt(
  requirement: string,
  options?: {
    ioTable?: string;
    existingVariables?: string;
    target?: 'FX5U' | 'iQ-R';
  },
): string {
  const parts: string[] = [];
  parts.push(`## 控制需求\n\n${requirement}`);

  if (options?.ioTable) {
    parts.push(`## IO 分配表\n\n${options.ioTable}`);
  }
  if (options?.existingVariables) {
    parts.push(`## 已有变量（请复用，不要重复声明）\n\n${options.existingVariables}`);
  }
  parts.push(
    `请生成 GX Works3 ST 程序。目标 CPU：${options?.target ?? 'FX5U'}。严格按 JSON 格式输出。`,
  );
  return parts.join('\n\n');
}
