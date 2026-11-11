/**
 * GX Works3 ST 语义分析与方言静态检查器。
 *
 * 检查项分为三类：
 *   error   ——  GX Works3 编译必然失败（语法外的硬错误）
 *   warning ——  能编译但很可能埋坑（跨品牌写法、地址冲突、隐式转换）
 *   info    ——  风格与可维护性建议
 */

import {
  type AST,
  type Expression,
  type POU,
  type Statement,
  type VarDeclaration,
} from './ast.ts';
import {
  baseLabel,
  checkDeviceNumber,
  getCpuProfile,
  isIqROnlyType,
  isSupportedFx5Type,
  type CpuModel,
} from '../profile/index.ts';
import {
  FOREIGN_BRANDS_FUNCTIONS,
  KNOWN_TRAPS,
  MITSUBISHI_FUNCTIONS,
  MITSUBISHI_FUNCTION_BLOCKS,
  POSITIONING_FUNCTIONS,
  RESERVED_WORDS,
  STANDARD_FB_SIGNATURES,
  STANDARD_FUNCTION_BLOCKS,
  STANDARD_FUNCTIONS,
  isValidIdentifier,
  parseDeviceAddress,
} from './instructions.ts';
import {
  baseTypeName,
  builtinTypeName,
  inferLiteralType,
  isAssignable,
  literalIntValue,
  normalizeTypeName,
} from './types.ts';

export type Severity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  severity: Severity;
  code: string;
  message: string;
  line: number;
  column: number;
  /** 所在 POU 名 */
  pou?: string;
  /** 建议修复方式 */
  hint?: string;
}

export interface AnalysisOptions {
  /** 目标 CPU 机型，影响可用指令与地址范围。 */
  target?: 'FX5U' | 'FX5UJ' | 'iQ-R';
  /** 是否检查跨品牌写法等 warning 项。 */
  includeWarnings?: boolean;
}

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

/** 单个 POU 的符号表。 */
interface Scope {
  vars: Map<string, VarDeclaration>;
  /** 用户自定义类型（STRUCT）。 */
  types: Map<string, { name: string; members: Map<string, string> }>;
  /** 局部可调用名。 */
  functions: Map<string, string>;
}

/**
 * 标准功能块的形参表（IEC 61131-3 / GX Works3 一致）。
 *
 * 用于校验功能块实例调用的参数名是否正确。
 * required 为必填输入参数。
 */
const RS_PARAM_TRAPS: Record<string, string> = {
  SET: 'RS 的置位输入形参名是 S，不是 SET；复位输入是 R1，不是 RESET1。正确写法：fbRS(S := x, R1 := y, Q1 => z);',
  RESET: 'RS 的复位输入形参名是 R1，不是 RESET/RSET。正确写法：fbRS(S := x, R1 := y, Q1 => z);',
  RESET1: 'RS 的复位输入形参名是 R1，不是 RESET1。正确写法：fbRS(S := x, R1 := y, Q1 => z);',
  RSET: 'RS 的复位输入形参名是 R1，不是 RSET。正确写法：fbRS(S := x, R1 := y, Q1 => z);',
  Q: 'RS/SR 的输出形参名是 Q1，不是 Q。正确写法：fbRS(S := x, R1 := y, Q1 => z);',
};

export class Analyzer {
  private diagnostics: Diagnostic[] = [];
  private scope: Scope = {
    vars: new Map(),
    types: new Map(),
    functions: new Map(),
  };
  private globalScope: Scope = {
    vars: new Map(),
    types: new Map(),
    functions: new Map(),
  };
  /** 工程中自定义的功能块定义（按大写名索引），用于校验实例调用参数。 */
  private pouDefinitions = new Map<string, POU>();
  private options: Required<AnalysisOptions> & { target: 'FX5U' | 'FX5UJ' | 'iQ-R' };
  /** 设备/类型检查使用的 CPU 机型（iQ-R 未实现，按 FX5U 检查）。 */
  private cpuModel: CpuModel;

  constructor(options: AnalysisOptions = {}) {
    this.options = {
      target: options.target ?? 'FX5U',
      includeWarnings: options.includeWarnings ?? true,
    };
    this.cpuModel = this.options.target === 'FX5UJ' ? 'FX5UJ' : 'FX5U';
  }

  private add(
    severity: Severity,
    code: string,
    message: string,
    loc: { line: number; column: number },
    pou?: string,
    hint?: string,
  ): void {
    if (severity === 'warning' && !this.options.includeWarnings) return;
    // 同一位置同一诊断只报一次（表达式可能在目标/值两侧被多次访问）
    if (
      this.diagnostics.some(
        (d) => d.code === code && d.line === loc.line && d.column === loc.column,
      )
    ) {
      return;
    }
    this.diagnostics.push({
      severity,
      code,
      message,
      line: loc.line,
      column: loc.column,
      pou,
      hint,
    });
  }

  /* -------------------- 入口 -------------------- */

  analyze(ast: AST): Diagnostic[] {
    this.diagnostics = [];

    // iQ-R 目标尚未实现：明确告知，避免把 FX5U 检查结果当成 iQ-R 结论
    if (this.options.target === 'iQ-R') {
      this.add(
        'info',
        'I001',
        'iQ-R 目标尚未实现：当前按 FX5U 规则检查（设备范围/指令集可能不适用）',
        { line: 1, column: 1 },
      );
    }

    // 全局变量与全局类型
    for (const gv of ast.globalVars) {
      this.globalScope.vars.set(gv.name, {
        kind: 'varDecl',
        name: gv.name,
        typeName: gv.typeName,
        initialValue: undefined,
        address: gv.address,
        retain: gv.retain,
        constant: gv.constant,
        comment: gv.comment,
        section: 'VAR_GLOBAL',
        loc: gv.loc,
      });
      this.checkVarDeclaration(gv.name, gv.typeName, gv.address, gv.constant, gv.loc, '全局变量');
    }
    for (const td of ast.types) {
      this.registerType(td);
    }

    // 登记工程中自定义的功能块与函数。
    // 它们既可以作为变量类型（`fbPump : FB_TankPumpControl;`），
    // 也可以被调用（`fbPump(IN := ..., Q => ...)`）。
    for (const pou of ast.pous) {
      if (pou.pouType === 'functionBlock' || pou.pouType === 'function') {
        this.globalScope.functions.set(pou.name.toUpperCase(), pou.name);
        this.pouDefinitions.set(pou.name.toUpperCase(), pou);
      }
    }

    for (const pou of ast.pous) {
      this.analyzePOU(pou);
    }

    return this.diagnostics.sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.line - b.line,
    );
  }

  private registerType(td: { name: string; members: { name: string; typeName: string }[] }): void {
    const members = new Map<string, string>();
    for (const m of td.members) members.set(m.name, m.typeName);
    this.globalScope.types.set(td.name, { name: td.name, members });
  }

  private analyzePOU(pou: POU): void {
    this.scope = {
      vars: new Map(),
      types: new Map(this.globalScope.types),
      functions: new Map(this.globalScope.functions),
    };

    // 变量声明检查
    for (const v of pou.vars) {
      if (this.scope.vars.has(v.name)) {
        this.add(
          'error',
          'E001',
          `变量 '${v.name}' 重复声明`,
          v.loc,
          pou.name,
          '同一 POU 内变量名必须唯一',
        );
      }
      this.scope.vars.set(v.name, v);
      this.checkVarDeclaration(v.name, v.typeName, v.address, v.constant, v.loc, pou.name);
      this.checkInitializer(v, pou);
    }

    // 函数返回类型
    if (pou.pouType === 'function' && pou.returnType) {
      this.checkVarDeclaration(
        `${pou.name}.返回值`,
        pou.returnType,
        undefined,
        false,
        pou.loc,
        pou.name,
      );
    }

    // 函数内不可调用其他函数（IEC 约束）时的粗略提示
    for (const stmt of pou.body) {
      this.checkStatement(stmt, pou);
    }
  }

  private checkVarDeclaration(
    name: string,
    typeName: string,
    address: string | undefined,
    constant: boolean,
    loc: { line: number; column: number },
    pou: string,
  ): void {
    if (!isValidIdentifier(name)) {
      if (RESERVED_WORDS.has(name.toUpperCase())) {
        this.add('error', 'E002', `'${name}' 是保留字，不能作为变量名`, loc, pou, '请更换变量名');
      } else {
        this.add(
          'error',
          'E003',
          `变量名 '${name}' 非法`,
          loc,
          pou,
          '只允许字母、数字、下划线，且不能以数字开头；GX Works3 区分大小写且不支持全角字符',
        );
      }
    }

    const base = baseTypeName(typeName);
    const builtin = builtinTypeName(typeName);
    // 标准功能块类型可作为变量类型声明（如 tTimer : TON;）
    const fbType =
      STANDARD_FUNCTION_BLOCKS[builtin] !== undefined ||
      MITSUBISHI_FUNCTION_BLOCKS[builtin] !== undefined;
    // 工程中自定义的功能块也可作为变量类型（如 fbPump : FB_Motor;）
    const userFbType = this.globalScope.functions.has(base.toUpperCase());
    const isKnownType =
      fbType ||
      userFbType ||
      this.scope.types.has(base) ||
      this.globalScope.types.has(base) ||
      // v2：类型表来自 FX5 profile（JY997D58901 text/03001）
      isSupportedFx5Type(builtin);
    if (!isKnownType) {
      this.add(
        'error',
        'E004',
        `未知数据类型 '${typeName}'`,
        loc,
        pou,
        isIqROnlyType(builtin)
          ? `FX5U 不支持类型 '${builtin}'（仅 iQ-R 支持，且本工具尚未验证 iQ-R）；可用类型见 profile`
          : `${this.cpuModel} 支持 BOOL/WORD/DWORD/INT/DINT/REAL/TIME/STRING/WSTRING/TIMER/RETENTIVETIMER/COUNTER/LCOUNTER/POINTER，以及自定义 STRUCT/FB`,
      );
    }

    if (address) {
      const dev = parseDeviceAddress(address);
      if (!dev) {
        this.add('error', 'E005', `设备地址 '${address}' 格式无效`, loc, pou, '应形如 X10 / D100 / M800');
      } else {
        const check = checkDeviceNumber(dev.prefix, dev.number, this.cpuModel);
        if (check === 'unknown-prefix') {
          this.add(
            'warning',
            'W001',
            `设备前缀 '${dev.prefix}' 不是 FX5 软元件`,
            loc,
            pou,
            '常见前缀：X/Y/M/L/B/S/T/C/D/W/R/Z/SM/SD',
          );
        } else if (!dev.validDigits) {
          this.add(
            'error',
            'E009',
            `设备地址 '${address}' 含非法${baseLabel(dev.base)}数字`,
            loc,
            pou,
            `${dev.prefix} 的编号为${baseLabel(dev.base)}（如 X/Y 只能用 0~7）`,
          );
        } else if (check === 'out-of-range') {
          const profile = getCpuProfile(this.cpuModel);
          const fact = profile.devices[dev.prefix];
          const range = fact?.range;
          this.add(
            'error',
            'E009',
            `设备地址 '${address}' 超出 ${this.cpuModel} ${dev.prefix} 的有效范围 (${range?.[0]}..${range?.[1]}，${baseLabel(dev.base)})`,
            loc,
            pou,
          );
        }
        // range-unverified（SM/SD）：只校验进制，不做范围检查
      }
    }

    if (constant && !address) {
      // CONSTANT 无地址是允许的，不报错
    }
  }

  /**
   * @deprecated v0.1 的空实现；「自动分配区间冲突」无手册依据（见 02 审计）。
   * 新语义：未分配软元件的标签进入标签存储器；显式分配的软元件只需查重。
   * 保留方法签名以防后续接入“分配软元件重复检查”。
   */
  private checkAddressCollision(
    _prefix: string,
    _number: number,
    _loc: { line: number; column: number },
    _pou: string,
  ): void {
    // 手册（SH081271 text/0A023）未定义 M8000/D512 自动分配边界 → 不做判断。
  }

  /* -------------------- 语句遍历 -------------------- */

  private checkStatement(stmt: Statement, pou: POU): void {
    switch (stmt.kind) {
      case 'assignStmt': {
        this.checkExpression(stmt.target, pou, true);
        this.checkExpression(stmt.value, pou, false);
        this.checkAssignment(stmt.target, stmt.value, stmt.loc, pou);
        break;
      }
      case 'ifStmt': {
        for (const b of stmt.branches) {
          this.checkExpression(b.condition, pou, false);
          this.checkConditionType(b.condition, pou);
          for (const s of b.body) this.checkStatement(s, pou);
        }
        for (const s of stmt.elseBody ?? []) this.checkStatement(s, pou);
        break;
      }
      case 'caseStmt': {
        this.checkExpression(stmt.selector, pou, false);
        // CASE 的选择器是整数/枚举，不是布尔量，故不做 BOOL 检查
        for (const b of stmt.branches) {
          for (const l of b.labels) this.checkExpression(l, pou, false);
          for (const s of b.body) this.checkStatement(s, pou);
        }
        for (const s of stmt.elseBody ?? []) this.checkStatement(s, pou);
        break;
      }
      case 'forStmt': {
        this.checkExpression(stmt.from, pou, false);
        this.checkExpression(stmt.to, pou, false);
        if (stmt.by) this.checkExpression(stmt.by, pou, false);
        if (!this.scope.vars.has(stmt.variable) && !this.globalScope.vars.has(stmt.variable)) {
          this.add(
            'error',
            'E007',
            `FOR 循环变量 '${stmt.variable}' 未声明`,
            stmt.loc,
            pou.name,
            '循环变量需在 VAR 段声明为 INT/DINT',
          );
        }
        for (const s of stmt.body) this.checkStatement(s, pou);
        break;
      }
      case 'whileStmt': {
        this.checkExpression(stmt.condition, pou, false);
        this.checkConditionType(stmt.condition, pou);
        for (const s of stmt.body) this.checkStatement(s, pou);
        break;
      }
      case 'repeatStmt': {
        for (const s of stmt.body) this.checkStatement(s, pou);
        this.checkExpression(stmt.condition, pou, false);
        this.checkConditionType(stmt.condition, pou);
        break;
      }
      case 'callStmt': {
        this.checkExpression(stmt.call, pou, false);
        break;
      }
      default:
        break;
    }
  }

  private checkConditionType(expr: Expression, pou: POU): void {
    const t = this.inferType(expr);
    if (t && builtinTypeName(t) !== 'BOOL') {
      this.add(
        'warning',
        'W002',
        `条件表达式类型为 ${t}，非 BOOL`,
        expr.loc,
        pou.name,
        '条件应为布尔量，或使用比较运算',
      );
    }
  }

  /* -------------------- 表达式遍历 -------------------- */

  private checkExpression(expr: Expression, pou: POU, isTarget: boolean): void {
    switch (expr.kind) {
      case 'literal': {
        // MELSEC iQ-R/MELSEC iQ-F 结构化文本(ST)编程指南（SH-081465CHN）附3：
        // iQ-F 系列不支持 Unicode 字符串（双引号）常数。
        if (expr.literalType === 'wstring' && this.options.target !== 'iQ-R') {
          this.add(
            'warning',
            'W010',
            'iQ-F 不支持 Unicode 字符串常数（双引号），GX Works3 编译可能失败',
            expr.loc,
            pou.name,
            "改用 ASCII 字符串（单引号），例如 'ABC'；Unicode 字符串常数仅 iQ-R 支持",
          );
        }
        break;
      }
      case 'identifier': {
        if (!this.scope.vars.has(expr.name) && !this.globalScope.vars.has(expr.name)) {
          // 可能是枚举值或结构体类型名，暂不报错
          const known =
            this.scope.types.has(expr.name) ||
            this.globalScope.types.has(expr.name) ||
            STANDARD_FUNCTIONS[expr.name.toUpperCase()] !== undefined ||
            MITSUBISHI_FUNCTIONS[expr.name.toUpperCase()] !== undefined ||
            STANDARD_FUNCTION_BLOCKS[expr.name.toUpperCase()] !== undefined ||
            MITSUBISHI_FUNCTION_BLOCKS[expr.name.toUpperCase()] !== undefined;
          if (!known) {
            this.add(
              'error',
              'E008',
              `未定义的标识符 '${expr.name}'`,
              expr.loc,
              pou.name,
              '检查拼写、是否在 VAR 段声明，或是否使用了其他品牌的指令',
            );
          }
        }
        break;
      }
      case 'device': {
        // v2：以原文重新解析，才能拿到进制信息（parser 的 number 是十进制字面量）。
        const parsed = parseDeviceAddress(expr.text);
        const check = parsed ? checkDeviceNumber(parsed.prefix, parsed.number, this.cpuModel) : 'unknown-prefix';
        if (check === 'unknown-prefix') {
          this.add(
            'warning',
            'W003',
            `设备前缀 '${expr.prefix}' 不是 FX5 软元件`,
            expr.loc,
            pou.name,
          );
        } else if (parsed && !parsed.validDigits) {
          this.add(
            'error',
            'E009',
            `设备地址 '${expr.text}' 含非法${baseLabel(parsed.base)}数字`,
            expr.loc,
            pou.name,
            `${parsed.prefix} 的编号为${baseLabel(parsed.base)}（如 X/Y 只能用 0~7）`,
          );
        } else if (check === 'out-of-range' && parsed) {
          const range = getCpuProfile(this.cpuModel).devices[parsed.prefix]?.range;
          this.add(
            'error',
            'E009',
            `设备地址 '${expr.text}' 超出 ${this.cpuModel} ${parsed.prefix} 的有效范围 (${range?.[0]}..${range?.[1]}，${baseLabel(parsed.base)})`,
            expr.loc,
            pou.name,
          );
        }
        break;
      }
      case 'call': {
        this.checkCall(expr, pou, isTarget);
        break;
      }
      case 'binary': {
        this.checkExpression(expr.left, pou, false);
        this.checkExpression(expr.right, pou, false);
        this.checkBinaryTypes(expr, pou);
        break;
      }
      case 'unary': {
        this.checkExpression(expr.operand, pou, false);
        break;
      }
      case 'member': {
        this.checkExpression(expr.object, pou, false);
        break;
      }
      case 'index': {
        this.checkExpression(expr.object, pou, false);
        this.checkExpression(expr.index, pou, false);
        break;
      }
      case 'paren': {
        this.checkExpression(expr.inner, pou, false);
        break;
      }
      default:
        break;
    }
  }

  private checkBinaryTypes(
    expr: Extract<Expression, { kind: 'binary' }>,
    pou: POU,
  ): void {
    const lt = this.inferType(expr.left);
    const rt = this.inferType(expr.right);
    if (!lt || !rt) return;

    const lb = builtinTypeName(lt);
    const rb = builtinTypeName(rt);

    // 逻辑运算要求 BOOL
    if (['AND', 'OR', 'XOR'].includes(expr.op.toUpperCase())) {
      if (lb !== 'BOOL' || rb !== 'BOOL') {
        this.add(
          'warning',
          'W004',
          `逻辑运算符 ${expr.op} 的操作数应为 BOOL，实际为 ${lt} 和 ${rt}`,
          expr.loc,
          pou.name,
        );
      }
      return;
    }

    // 算术运算要求数值（FX5 数值类型：INT/DINT/REAL/WORD/DWORD/TIME）
    const numeric = new Set([
      'INT', 'DINT', 'REAL', 'WORD', 'DWORD', 'TIME',
    ]);
    if (!numeric.has(lb) || !numeric.has(rb)) {
      this.add(
        'warning',
        'W005',
        `算术运算符 ${expr.op} 的操作数应为数值类型，实际为 ${lt} 和 ${rt}`,
        expr.loc,
        pou.name,
      );
    }
  }

  /* -------------------- 调用检查 -------------------- */

  private checkCall(
    call: Extract<Expression, { kind: 'call' }>,
    pou: POU,
    isTarget: boolean,
  ): void {
    for (const a of call.args) this.checkExpression(a.value, pou, false);
    for (const a of call.outputArgs) this.checkExpression(a.value, pou, false);

    const upper = call.callee.toUpperCase();

    // 跨品牌函数
    const foreign = FOREIGN_BRANDS_FUNCTIONS[upper];
    if (foreign) {
      this.add('error', 'E010', `函数 '${call.callee}' 不适用于三菱 GX Works3`, call.loc, pou.name, foreign);
      return;
    }

    // 已知陷阱
    const trap = KNOWN_TRAPS[upper];
    if (trap) {
      this.add('warning', 'W006', `函数 '${call.callee}' 存在方言差异`, call.loc, pou.name, trap);
    }

    // 标准函数
    const std = STANDARD_FUNCTIONS[upper];
    if (std) {
      const total = call.args.length + call.outputArgs.length;
      if (total < std.min || total > std.max) {
        this.add(
          'error',
          'E011',
          `函数 '${call.callee}' 参数个数错误：期望 ${std.min === std.max ? std.min : `${std.min}..${std.max}`}，实际 ${total}`,
          call.loc,
          pou.name,
        );
      }
      return;
    }

    // 三菱特有函数
    const mitsu = MITSUBISHI_FUNCTIONS[upper];
    if (mitsu) {
      const total = call.args.length + call.outputArgs.length;
      if (total !== mitsu.argTypes.length) {
        this.add(
          'error',
          'E012',
          `函数 '${call.callee}' 参数个数错误：期望 ${mitsu.argTypes.length}，实际 ${total}`,
          call.loc,
          pou.name,
        );
      }
      return;
    }

    // 功能块实例调用：被调用者是已声明的功能块类型变量
    // （如 tTimer : TON; 后调用 tTimer(IN := ..., PT := ...)）
    const instVar = this.scope.vars.get(call.callee) ?? this.globalScope.vars.get(call.callee);
    if (instVar) {
      const instType = builtinTypeName(instVar.typeName);
      const isStandardFb =
        STANDARD_FUNCTION_BLOCKS[instType] !== undefined ||
        MITSUBISHI_FUNCTION_BLOCKS[instType] !== undefined;
      if (isStandardFb) {
        // 实例调用参数校验：命名参数需与标准 FB 形参匹配
        this.checkFbInstanceCall(call, instType, pou);
        return;
      }
      // 工程中自定义的功能块实例：按该 FB 自己声明的输入输出名校验
      const userFbName = this.globalScope.functions.get(baseTypeName(instVar.typeName).toUpperCase());
      if (userFbName) {
        this.checkUserFbInstanceCall(call, userFbName, pou);
        return;
      }
    }

    // 标准功能块
    if (STANDARD_FUNCTION_BLOCKS[upper] || MITSUBISHI_FUNCTION_BLOCKS[upper]) {
      return;
    }

    // 用户自定义 FB：检查是否在工程中定义
    const userFB = this.scope.functions.get(upper) ?? this.globalScope.functions.get(upper);
    if (userFB) return;

    // 定位指令（ST 函数形式，如 ENO:=DRVA(EN,s1,s2,d1,d2);）
    const pos = POSITIONING_FUNCTIONS[upper];
    if (pos) {
      const total = call.args.length + call.outputArgs.length;
      if (total < pos.min || total > pos.max) {
        this.add(
          'error',
          'E011',
          `定位指令 '${call.callee}' 参数个数错误：期望 ${pos.min}，实际 ${total}`,
          call.loc,
          pou.name,
          '定位指令 ST 形式见 docs/RAG/知识要点-定位.md',
        );
      }
      return;
    }

    // 未知的调用目标 —— 可能是本工程定义的 FB（跨 POU），仅提示
    this.add(
      'warning',
      'W007',
      `无法确认函数/功能块 '${call.callee}' 是否存在`,
      call.loc,
      pou.name,
      '若为自定义 FB，请确认已在本工程创建；标准库请参考 GX Works3 指令集',
    );
  }

  /**
   * 自定义功能块实例调用的参数校验。
   *
   * 形参表取自该 FB 自身声明的 VAR_INPUT / VAR_OUTPUT / VAR_IN_OUT。
   */
  private checkUserFbInstanceCall(
    call: Extract<Expression, { kind: 'call' }>,
    fbName: string,
    pou: POU,
  ): void {
    const def = this.pouDefinitions.get(fbName.toUpperCase());
    if (!def) return;

    const inputs = new Set<string>();
    const outputs = new Set<string>();
    for (const v of def.vars) {
      if (v.section === 'VAR_INPUT') inputs.add(v.name.toUpperCase());
      else if (v.section === 'VAR_OUTPUT') outputs.add(v.name.toUpperCase());
      else if (v.section === 'VAR_IN_OUT') {
        inputs.add(v.name.toUpperCase());
        outputs.add(v.name.toUpperCase());
      }
    }

    for (const a of call.args) {
      if (!a.name) continue;
      const n = a.name.toUpperCase();
      if (!inputs.has(n)) {
        this.add(
          'error',
          'E016',
          `功能块 '${fbName}' 没有名为 '${a.name}' 的输入参数`,
          call.loc,
          pou.name,
          inputs.size > 0
            ? `可用输入参数：${[...inputs].join(', ')}`
            : '该功能块未声明 VAR_INPUT',
        );
      }
    }
    for (const a of call.outputArgs) {
      if (!a.name) continue;
      const n = a.name.toUpperCase();
      if (!outputs.has(n)) {
        this.add(
          'error',
          'E017',
          `功能块 '${fbName}' 没有名为 '${a.name}' 的输出参数`,
          call.loc,
          pou.name,
          outputs.size > 0
            ? `可用输出参数：${[...outputs].join(', ')}`
            : '该功能块未声明 VAR_OUTPUT',
        );
      }
    }
  }

  /**
   * 标准功能块实例调用的参数校验。
   *
   * 形参表依据 IEC 61131-3 / GX Works3 的标准功能块定义。
   */
  private checkFbInstanceCall(
    call: Extract<Expression, { kind: 'call' }>,
    fbType: string,
    pou: POU,
  ): void {
    const sig = STANDARD_FB_SIGNATURES[fbType];
    if (!sig) return;

    const named = call.args.filter((a) => a.name).map((a) => a.name!.toUpperCase());
    const positional = call.args.filter((a) => !a.name);
    const outs = call.outputArgs.filter((a) => a.name).map((a) => a.name!.toUpperCase());

    for (const n of named) {
      if (!sig.inputs.some((i) => i.toUpperCase() === n)) {
        this.add(
          'error',
          'E016',
          `功能块 '${fbType}' 没有名为 '${n}' 的输入参数`,
          call.loc,
          pou.name,
          RS_PARAM_TRAPS[n.toUpperCase()] ?? `可用输入参数：${sig.inputs.join(', ')}`,
        );
      }
    }
    for (const n of outs) {
      if (!sig.outputs.some((o) => o.toUpperCase() === n)) {
        this.add(
          'error',
          'E017',
          `功能块 '${fbType}' 没有名为 '${n}' 的输出参数`,
          call.loc,
          pou.name,
          RS_PARAM_TRAPS[n.toUpperCase()] ?? `可用输出参数：${sig.outputs.join(', ')}`,
        );
      }
    }
    // 位置参数数量不得超过输入参数总数
    if (positional.length > sig.inputs.length) {
      this.add(
        'error',
        'E018',
        `功能块 '${fbType}' 的位置参数过多：最多 ${sig.inputs.length} 个，实际 ${positional.length} 个`,
        call.loc,
        pou.name,
        '请使用命名参数，如 tTimer(IN := TRUE, PT := T#1s);',
      );
    }
    // 必填输入参数缺失
    for (const required of sig.required) {
      const provided = named.includes(required.toUpperCase());
      if (!provided) {
        this.add(
          'warning',
          'W009',
          `功能块 '${fbType}' 缺少输入参数 '${required}'`,
          call.loc,
          pou.name,
        );
      }
    }
  }

  /* -------------------- 类型推断 -------------------- */

  inferType(expr: Expression): string | null {
    switch (expr.kind) {
      case 'literal': {
        if (expr.literalType === 'number') {
          return inferLiteralType(expr.value) ?? 'INT';
        }
        if (expr.literalType === 'boolean') return 'BOOL';
        if (expr.literalType === 'time') return 'TIME';
        if (expr.literalType === 'string') return 'STRING';
        return 'WSTRING';
      }
      case 'identifier': {
        const v = this.scope.vars.get(expr.name) ?? this.globalScope.vars.get(expr.name);
        if (v) return v.typeName;
        return null;
      }
      case 'device': {
        if (expr.prefix === 'X' || expr.prefix === 'Y' || expr.prefix === 'M' ||
            expr.prefix === 'L' || expr.prefix === 'B' || expr.prefix === 'S' ||
            expr.prefix === 'T' || expr.prefix === 'C' || expr.prefix === 'SM') {
          return 'BOOL';
        }
        return 'WORD';
      }
      case 'paren':
        return this.inferType(expr.inner);
      case 'unary': {
        if (expr.op === 'NOT') return 'BOOL';
        return this.inferType(expr.operand);
      }
      case 'binary': {
        const lt = this.inferType(expr.left);
        const rt = this.inferType(expr.right);
        if (!lt || !rt) return null;
        const op = expr.op.toUpperCase();
        if (['AND', 'OR', 'XOR'].includes(op)) return 'BOOL';
        if (['=', '<>', '<', '>', '<=', '>='].includes(op)) return 'BOOL';
        if (op === '/') return lt;
        return widen(lt, rt);
      }
      case 'index': {
        const objType = this.inferType(expr.object);
        if (!objType) return null;
        // 数组元素类型：取声明的基础类型
        return baseTypeName(objType);
      }
      case 'member': {
        const objType = this.inferType(expr.object);
        if (!objType) return null;
        const structName = baseTypeName(objType);
        const struct = this.scope.types.get(structName) ?? this.globalScope.types.get(structName);
        if (struct) {
          const mt = struct.members.get(expr.member);
          if (mt) return mt;
          this.add(
            'error',
            'E013',
            `结构体 '${structName}' 没有成员 '${expr.member}'`,
            expr.loc,
          );
        }
        return null;
      }
      case 'call': {
        const upper = expr.callee.toUpperCase();
        const std = STANDARD_FUNCTIONS[upper];
        if (std?.ret) return std.ret;
        if (std && !std.ret) {
          const at = this.inferType(expr.args[0]?.value);
          return at;
        }
        const mitsu = MITSUBISHI_FUNCTIONS[upper];
        if (mitsu?.ret) return mitsu.ret;
        return null;
      }
      case 'assign':
        return this.inferType(expr.target);
      default:
        return null;
    }
  }

  /* -------------------- 赋值检查 -------------------- */

  private checkAssignment(
    target: Expression,
    value: Expression,
    loc: { line: number; column: number },
    pou: POU,
  ): void {
    const tt = this.inferType(target);
    const vt = this.inferType(value);
    if (!tt || !vt) return;

    const tb = builtinTypeName(tt);
    const vb = builtinTypeName(vt);

    if (tb === 'BOOL' && vb !== 'BOOL') {
      this.add(
        'error',
        'E014',
        `类型不匹配：无法把 ${vt} 赋给 BOOL 类型的 '${describeTarget(target)}'`,
        loc,
        pou.name,
        '用比较运算产生布尔结果，例如 bFlag := (nA > nB);',
      );
      return;
    }

    // 字符串常数引号规则（JY997D58901 text/03001）：
    //   ST 中 STRING 用单引号、WSTRING 用双引号；写反在 GX Works3 是类型不匹配。
    if (tb === 'STRING' && vb === 'WSTRING') {
      this.add(
        'error',
        'E019',
        `字符串常数引号错误：ASCII 字符串常数须用单引号（双引号为 Unicode 字符串常数，iQ-F 不支持）`,
        loc,
        pou.name,
        `改为单引号，例如 'abc'；Unicode 字符串常数仅 iQ-R 支持（iQ-F 不支持）`,
      );
      return;
    }
    if (tb === 'WSTRING' && vb === 'STRING') {
      this.add(
        'error',
        'E019',
        `字符串常数引号错误：Unicode 字符串常数须用双引号（单引号为 ASCII 字符串）`,
        loc,
        pou.name,
        `改为双引号，例如 "abc"（Unicode 字符串常数仅 iQ-R 支持）`,
      );
      return;
    }

    if (!isAssignable(tt, vt)) {
      const numericMix =
        (['INT', 'DINT'].includes(tb) && ['REAL'].includes(vb)) ||
        (['REAL'].includes(tb) && ['INT', 'DINT'].includes(vb));
      if (numericMix) {
        this.add(
          'error',
          'E015',
          `类型不匹配：不能把 ${vt} 直接赋给 ${tt} 类型的 '${describeTarget(target)}'`,
          loc,
          pou.name,
          '显式转换，例如 nInt := REAL_TO_INT(fReal); 或 fReal := INT_TO_REAL(nInt);',
        );
      } else {
        this.add(
          'warning',
          'W008',
          `赋值类型不匹配：${tt} <- ${vt}`,
          loc,
          pou.name,
          '建议使用显式类型转换函数',
        );
      }
    }
  }

  /**
   * 变量声明初始值检查（v2 仅覆盖字符串引号；其余类型检查待后续任务）。
   */
  private checkInitializer(v: VarDeclaration, pou: POU): void {
    const init = v.initialValue;
    if (!init || init.kind !== 'literal') return;
    const target = builtinTypeName(v.typeName);
    if (target === 'STRING' && init.literalType === 'wstring') {
      this.add(
        'error',
        'E019',
        `字符串常数引号错误：ASCII 字符串常数须用单引号（双引号为 Unicode 字符串常数，iQ-F 不支持）`,
        v.loc,
        pou.name,
        `改为单引号，例如 '${init.value}'`,
      );
    } else if (target === 'WSTRING' && init.literalType === 'string') {
      this.add(
        'error',
        'E019',
        `字符串常数引号错误：Unicode 字符串常数须用双引号（单引号为 ASCII 字符串）`,
        v.loc,
        pou.name,
        `改为双引号，例如 "${init.value}"`,
      );
    }
  }
}

/** 类型加宽（FX5：整数只有 INT/DINT，浮点只有 REAL）。 */
function widen(a: string, b: string): string {
  const ta = baseTypeName(a);
  const tb = baseTypeName(b);
  if (ta === tb) return ta;
  const isFloat = (t: string) => t === 'REAL';
  if (isFloat(ta) || isFloat(tb)) {
    return 'REAL';
  }
  const width: Record<string, number> = {
    INT: 1, WORD: 1,
    DINT: 2, DWORD: 2,
  };
  const w = Math.max(width[ta] ?? 1, width[tb] ?? 1);
  const signed = !['WORD', 'DWORD'].includes(ta) || !['WORD', 'DWORD'].includes(tb);
  if (w === 1) return signed ? 'INT' : 'WORD';
  return signed ? 'DINT' : 'DWORD';
}

/** 目标表达式的可读描述。 */
function describeTarget(expr: Expression): string {
  switch (expr.kind) {
    case 'identifier':
      return expr.name;
    case 'device':
      return expr.text;
    case 'member':
      return `${describeTarget(expr.object)}.${expr.member}`;
    case 'index':
      return `${describeTarget(expr.object)}[...]`;
    default:
      return '目标变量';
  }
}

/** 便捷入口。 */
export function analyzeST(ast: AST, options?: AnalysisOptions): Diagnostic[] {
  return new Analyzer(options).analyze(ast);
}
