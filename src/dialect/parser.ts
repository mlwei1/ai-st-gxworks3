/**
 * GX Works3 ST 递归下降语法分析器。
 *
 * 覆盖 GX Works3 ST 编辑器支持的语法：
 *   POU (PROGRAM / FUNCTION / FUNCTION_BLOCK)、VAR 段、STRUCT/TYPE、
 *   赋值、IF/CASE/FOR/WHILE/REPEAT、函数与功能块调用、软元件寻址。
 */

import {
  type AST,
  type CallArgument,
  type CaseStatement,
  type Expression,
  type ForStatement,
  type IfStatement,
  type POU,
  type RepeatStatement,
  type SourceLocation,
  type Statement,
  type StructMember,
  type TypeDeclaration,
  type VarDeclaration,
  type VarSectionKind,
  type GlobalVarDeclaration,
  type WhileStatement,
} from './ast.ts';
import { type Token, tokenize } from './lexer.ts';

export class ParseError extends Error {
  readonly line: number;
  readonly column: number;

  constructor(message: string, line: number, column: number) {
    super(`${message} (第 ${line} 行, 第 ${column} 列)`);
    this.name = 'ParseError';
    this.line = line;
    this.column = column;
  }
}

const VAR_SECTIONS: Record<string, VarSectionKind> = {
  VAR: 'VAR',
  VAR_INPUT: 'VAR_INPUT',
  VAR_OUTPUT: 'VAR_OUTPUT',
  VAR_IN_OUT: 'VAR_IN_OUT',
  VAR_TEMP: 'VAR_TEMP',
  VAR_GLOBAL: 'VAR_GLOBAL',
  VAR_EXTERNAL: 'VAR_EXTERNAL',
};

/** 二元运算符优先级（数值越大结合越紧）。 */
const BINARY_PRECEDENCE: Record<string, number> = {
  OR: 1,
  XOR: 2,
  AND: 3,
  '=': 4, '<>': 4, '<': 4, '>': 4, '<=': 4, '>=': 4,
  '+': 5, '-': 5,
  '*': 6, '/': 6, MOD: 6,
};

export class Parser {
  private tokens: Token[];
  private pos = 0;
  /** parseOneTopLevel 的暂存结果。 */
  private pending: AST = { pous: [], globalVars: [], types: [] };
  /** 语句级恢复过程中收集的语法错误。 */
  private recoveryErrors: { message: string; line: number; column: number }[] = [];

  constructor(src: string) {
    this.tokens = tokenize(src);
  }

  /* -------------------- token 辅助 -------------------- */

  /** 暴露当前 token，供错误恢复模块判断恢复点。 */
  peekToken(): Token {
    return this.peek();
  }

  /**
   * 从当前位置跳到下一个顶层声明（PROGRAM / FUNCTION / TYPE / VAR_GLOBAL），
   * 返回跳过的文本。用于语法错误后的恢复。
   */
  recoverToNextTopLevel(): string {
    const skipped: string[] = [];
    while (this.peek().type !== 'eof') {
      const t = this.peek();
      if (
        t.type === 'keyword' &&
        ['PROGRAM', 'FUNCTION', 'FUNCTION_BLOCK', 'TYPE', 'VAR_GLOBAL'].includes(
          t.value.toUpperCase(),
        )
      ) {
        break;
      }
      skipped.push(t.value);
      this.next();
    }
    return skipped.join(' ');
  }

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
  }

  private next(): Token {
    const t = this.tokens[this.pos];
    if (this.pos < this.tokens.length - 1) this.pos++;
    return t;
  }

  private at(value: string): boolean {
    const t = this.peek();
    return t.value.toUpperCase() === value.toUpperCase();
  }

  private atKeyword(...names: string[]): boolean {
    const t = this.peek();
    if (t.type !== 'keyword') return false;
    return names.some((k) => t.value.toUpperCase() === k.toUpperCase());
  }

  private accept(value: string): boolean {
    if (this.at(value)) {
      this.next();
      return true;
    }
    return false;
  }

  private expect(value: string): Token {
    if (!this.at(value)) {
      const t = this.peek();
      throw new ParseError(
        `期望 '${value}'，实际读到 '${t.value || 'EOF'}'`,
        t.line,
        t.column,
      );
    }
    return this.next();
  }

  private expectIdentifier(what: string): Token {
    const t = this.peek();
    if (t.type !== 'identifier') {
      throw new ParseError(`期望${what}（标识符），实际读到 '${t.value || 'EOF'}'`, t.line, t.column);
    }
    return this.next();
  }

  /**
   * 变量名允许是关键字。
   * GX Works3 会对保留字变量名报错，但由语义层报错比在语法层直接崩溃更有用，
   * 这样能给出「这是保留字」而不是「期望标识符」这种无信息量的提示。
   */
  private expectVarName(): Token {
    const t = this.peek();
    if (t.type === 'identifier' || t.type === 'keyword') {
      return this.next();
    }
    throw new ParseError(`期望变量名，实际读到 '${t.value || 'EOF'}'`, t.line, t.column);
  }

  private loc(start: Token, end?: Token): SourceLocation {
    const e = end ?? this.tokens[Math.max(this.pos - 1, 0)];
    return { line: start.line, column: start.column, start: start.start, end: e.end };
  }

  /* -------------------- 入口 -------------------- */

  parse(): AST {
    const pous: POU[] = [];
    const globalVars: GlobalVarDeclaration[] = [];
    const types: TypeDeclaration[] = [];

    while (this.peek().type !== 'eof') {
      if (this.atKeyword('PROGRAM')) {
        pous.push(this.parseProgram());
      } else if (this.atKeyword('FUNCTION_BLOCK')) {
        pous.push(this.parseFunctionBlock());
      } else if (this.atKeyword('FUNCTION')) {
        pous.push(this.parseFunction());
      } else if (this.atKeyword('TYPE')) {
        types.push(this.parseTypeDecl());
      } else if (this.atKeyword('VAR_GLOBAL')) {
        globalVars.push(...this.parseGlobalVars());
      } else {
        const t = this.peek();
        throw new ParseError(
          `顶层意外的 '${t.value || 'EOF'}'，期望 PROGRAM / FUNCTION_BLOCK / FUNCTION / TYPE / VAR_GLOBAL`,
          t.line,
          t.column,
        );
      }
    }

    return { pous, globalVars, types };
  }

  /* -------------------- 错误恢复支持 -------------------- */

  /** 是否已解析到文件末尾。 */
  atEnd(): boolean {
    return this.peek().type === 'eof';
  }

  /** 当前 token 索引（用于检测解析是否有进展）。 */
  tokenIndex(): number {
    return this.pos;
  }

  /**
   * 解析一个顶层声明（PROGRAM / FUNCTION / TYPE / VAR_GLOBAL），
   * 结果暂存于 pending 中，供 takeParsed 取走。
   *
   * 这样单个声明出错时不会影响已成功解析的其他声明。
   */
  parseOneTopLevel(): void {
    this.pending = { pous: [], globalVars: [], types: [] };
    if (this.atKeyword('PROGRAM')) {
      this.pending.pous.push(this.parseProgram());
    } else if (this.atKeyword('FUNCTION_BLOCK')) {
      this.pending.pous.push(this.parseFunctionBlock());
    } else if (this.atKeyword('FUNCTION')) {
      this.pending.pous.push(this.parseFunction());
    } else if (this.atKeyword('TYPE')) {
      this.pending.types.push(this.parseTypeDecl());
    } else if (this.atKeyword('VAR_GLOBAL')) {
      this.pending.globalVars.push(...this.parseGlobalVars());
    } else {
      const t = this.peek();
      throw new ParseError(
        `顶层意外的 '${t.value || 'EOF'}'，期望 PROGRAM / FUNCTION_BLOCK / FUNCTION / TYPE / VAR_GLOBAL`,
        t.line,
        t.column,
      );
    }
  }

  /** 取走最近一次 parseOneTopLevel 的结果。 */
  takeParsed(): AST {
    const p = this.pending;
    this.pending = { pous: [], globalVars: [], types: [] };
    return p;
  }

  /** 取走语句级恢复过程中收集的语法错误。 */
  takeRecoveryErrors(): { message: string; line: number; column: number }[] {
    const e = this.recoveryErrors;
    this.recoveryErrors = [];
    return e;
  }

  /**
   * 跳到下一个可恢复的位置。
   *
   * 恢复点定义：语句起始关键字、或语句终止符（`;`）。
   * 找不到时跳到文件末尾。
   *
   * 关键约束：必须保证有进展，否则会与调用方形成死循环。
   * 因此当当前位置本身就是恢复点时，强制先消费一个 token。
   *
   * @returns 是否成功找到恢复点
   */
  skipToRecoveryPoint(): boolean {
    const RECOVER_KEYWORDS = new Set([
      'IF', 'CASE', 'FOR', 'WHILE', 'REPEAT', 'EXIT', 'RETURN', 'CONTINUE',
      'END_IF', 'END_CASE', 'END_FOR', 'END_WHILE', 'END_REPEAT',
      'END_PROGRAM', 'END_FUNCTION', 'END_FUNCTION_BLOCK',
      'END_VAR', 'VAR', 'VAR_INPUT', 'VAR_OUTPUT', 'VAR_IN_OUT', 'VAR_TEMP', 'VAR_GLOBAL',
      'PROGRAM', 'FUNCTION', 'FUNCTION_BLOCK', 'TYPE',
    ]);

    const start = this.pos;
    while (this.peek().type !== 'eof') {
      const t = this.peek();
      // 当前位置已是恢复点：先消费它，保证有进展
      if (this.pos > start) {
        if (t.type === 'keyword' && RECOVER_KEYWORDS.has(t.value.toUpperCase())) {
          return true;
        }
        if (t.type === 'operator' && t.value === ';') {
          this.next();
          return true;
        }
      }
      this.next();
    }
    return false;
  }

  /* -------------------- POU -------------------- */

  private parseProgram(): POU {
    const start = this.expect('PROGRAM');
    const nameTok = this.expectIdentifier('程序名');
    const vars: VarDeclaration[] = [];
    const body: Statement[] = [];

    while (!this.atKeyword('END_PROGRAM')) {
      if (this.peek().type === 'eof') {
        throw new ParseError('PROGRAM 缺少 END_PROGRAM', start.line, start.column);
      }
      if (this.isVarSectionStart()) {
        vars.push(...this.parseVarSection());
      } else {
        body.push(...this.parseStatementsRecovering());
      }
    }
    this.expect('END_PROGRAM');
    return {
      kind: 'pou',
      pouType: 'program',
      name: nameTok.value,
      vars,
      types: [],
      body,
      loc: this.loc(start),
    };
  }

  /**
   * 解析语句序列，遇到语法错误时跳过错误语句继续。
   *
   * 用于 POU 内部：单个语句写错不应导致整个 POU 的后续语句无法检查。
   * 错误通过 this.recoveryErrors 收集。
   */
  private parseStatementsRecovering(): Statement[] {
    const out: Statement[] = [];
    let guard = 0;
    while (guard++ < 500) {
      const before = this.pos;
      try {
        const stmts = this.parseStatements();
        out.push(...stmts);
        return out;
      } catch (e) {
        if (e instanceof ParseError) {
          this.recoveryErrors.push({ message: e.message, line: e.line, column: e.column });
        } else {
          throw e;
        }
        // 跳过错误语句
        if (!this.skipToStatementBoundary()) return out;
        if (this.pos === before) {
          this.next();
        }
      }
    }
    return out;
  }

  /**
   * 跳到下一个语句边界。
   *
   * 规则：向前扫描，遇到分号即认为损坏的语句在此结束（消费掉分号）；
   * 遇到语句起始关键字则停在其前，交由 parseStatements 继续处理。
   *
   * 关键：必须在**消费 token 之前**判断，否则会把下一个正常语句一起吞掉。
   */
  private skipToStatementBoundary(): boolean {
    const STATEMENT_KEYWORDS = new Set([
      'IF', 'CASE', 'FOR', 'WHILE', 'REPEAT', 'EXIT', 'RETURN', 'CONTINUE',
      'END_IF', 'END_CASE', 'END_FOR', 'END_WHILE', 'END_REPEAT',
      'END_PROGRAM', 'END_FUNCTION', 'END_FUNCTION_BLOCK',
      'END_VAR', 'VAR', 'VAR_INPUT', 'VAR_OUTPUT', 'VAR_IN_OUT', 'VAR_TEMP',
    ]);
    while (this.peek().type !== 'eof') {
      const t = this.peek();
      if (t.type === 'operator' && t.value === ';') {
        this.next();
        return true;
      }
      if (t.type === 'keyword' && STATEMENT_KEYWORDS.has(t.value.toUpperCase())) {
        return true;
      }
      this.next();
    }
    return false;
  }

  private parseFunctionBlock(): POU {
    const start = this.expect('FUNCTION_BLOCK');
    const nameTok = this.expectIdentifier('功能块名');
    const vars: VarDeclaration[] = [];
    const body: Statement[] = [];

    while (!this.atKeyword('END_FUNCTION_BLOCK')) {
      if (this.peek().type === 'eof') {
        throw new ParseError('FUNCTION_BLOCK 缺少 END_FUNCTION_BLOCK', start.line, start.column);
      }
      if (this.isVarSectionStart()) {
        vars.push(...this.parseVarSection());
      } else {
        body.push(...this.parseStatementsRecovering());
      }
    }
    this.expect('END_FUNCTION_BLOCK');
    return {
      kind: 'pou',
      pouType: 'functionBlock',
      name: nameTok.value,
      vars,
      types: [],
      body,
      loc: this.loc(start),
    };
  }

  private parseFunction(): POU {
    const start = this.expect('FUNCTION');
    const nameTok = this.expectIdentifier('函数名');
    let returnType: string | undefined;

    if (this.accept(':')) {
      const rt = this.peek();
      if (rt.type === 'identifier') {
        this.next();
        returnType = rt.value;
      } else {
        throw new ParseError('函数返回类型无效', rt.line, rt.column);
      }
    }

    const vars: VarDeclaration[] = [];
    const body: Statement[] = [];

    while (!this.atKeyword('END_FUNCTION')) {
      if (this.peek().type === 'eof') {
        throw new ParseError('FUNCTION 缺少 END_FUNCTION', start.line, start.column);
      }
      if (this.isVarSectionStart()) {
        vars.push(...this.parseVarSection());
      } else {
        body.push(...this.parseStatementsRecovering());
      }
    }
    this.expect('END_FUNCTION');
    return {
      kind: 'pou',
      pouType: 'function',
      name: nameTok.value,
      returnType,
      vars,
      types: [],
      body,
      loc: this.loc(start),
    };
  }

  private isVarSectionStart(): boolean {
    const t = this.peek();
    if (t.type !== 'keyword') return false;
    const up = t.value.toUpperCase();
    return up in VAR_SECTIONS && up !== 'VAR_GLOBAL';
  }

  /* -------------------- 变量声明 -------------------- */

  private parseVarSection(): VarDeclaration[] {
    const sectionTok = this.next();
    const section = VAR_SECTIONS[sectionTok.value.toUpperCase()];
    const vars: VarDeclaration[] = [];

    while (!this.atKeyword('END_VAR')) {
      if (this.peek().type === 'eof') {
        throw new ParseError(`${sectionTok.value} 缺少 END_VAR`, sectionTok.line, sectionTok.column);
      }

      const nameTok = this.expectVarName();
      this.expect(':');
      const typeTok = this.peek();
      if (typeTok.type !== 'identifier' && typeTok.type !== 'keyword') {
        throw new ParseError('期望数据类型', typeTok.line, typeTok.column);
      }
      this.next();

      let typeName = typeTok.value;
      let arrayRange: { from: number; to: number } | undefined;
      // ARRAY[0..10] OF INT 形式
      if (typeName.toUpperCase() === 'ARRAY' && this.at('[')) {
        const arrStart = this.peek();
        this.next();
        const fromTok = this.next();
        const from = Number(fromTok.value);
        if (!this.at('..')) {
          throw new ParseError('数组下标期望 ".." 形式，如 ARRAY[0..10]', arrStart.line, arrStart.column);
        }
        this.next();
        const toTok = this.next();
        const to = Number(toTok.value);
        this.expect(']');
        this.expect('OF');
        const elemType = this.expectIdentifier('数组元素类型');
        typeName = elemType.value;
        arrayRange = { from, to };
      } else if (this.at('[')) {
        // STRING[32] 形式
        const arrStart = this.peek();
        this.next();
        let dim = '';
        while (!this.at(']') && this.peek().type !== 'eof') {
          dim += this.next().value;
        }
        this.expect(']');
        typeName = `${typeName.toUpperCase()}[${dim}]`;
        if (!/\d+$/.test(dim)) {
          throw new ParseError(`字符串长度声明无效: [${dim}]`, arrStart.line, arrStart.column);
        }
      }

      if (!arrayRange && this.at('[')) {
        arrayRange = this.parseArrayRange();
      }

      let address: string | undefined;
      if (this.accept('AT')) {
        const a = this.peek();
        if (a.type === 'identifier' || a.type === 'number') {
          this.next();
          address = a.value;
        } else {
          throw new ParseError('AT 后期望设备地址', a.line, a.column);
        }
      }

      let retain = false;
      let constant = false;
      for (;;) {
        if (this.atKeyword('RETAIN')) {
          this.next();
          retain = true;
        } else if (this.atKeyword('CONSTANT')) {
          this.next();
          constant = true;
        } else {
          break;
        }
      }

      let initialValue: Expression | undefined;
      if (this.accept(':=')) {
        initialValue = this.parseExpression();
      }

      let comment: string | undefined;
      if (this.at(';')) {
        this.next();
        const c = this.peek();
        if (c.type === 'string') {
          this.next();
          comment = c.value;
        }
      } else {
        this.expect(';');
      }

      vars.push({
        kind: 'varDecl',
        name: nameTok.value,
        typeName,
        arrayRange,
        initialValue,
        address,
        retain,
        constant,
        comment,
        section,
        loc: this.loc(nameTok),
      });
    }

    this.expect('END_VAR');
    return vars;
  }

  private parseArrayRange(): { from: number; to: number } {
    this.expect('[');
    const fromTok = this.next();
    const from = Number(fromTok.value);
    if (!this.at('..')) {
      throw new ParseError('数组下标期望 ".." 形式，如 [0..10]', fromTok.line, fromTok.column);
    }
    this.next();
    const toTok = this.next();
    const to = Number(toTok.value);
    this.expect(']');
    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      throw new ParseError('数组下标必须是数字', fromTok.line, fromTok.column);
    }
    return { from, to };
  }

  private parseGlobalVars(): GlobalVarDeclaration[] {
    this.next(); // VAR_GLOBAL
    const vars: GlobalVarDeclaration[] = [];
    while (!this.atKeyword('END_VAR')) {
      if (this.peek().type === 'eof') {
        throw new ParseError('VAR_GLOBAL 缺少 END_VAR', 1, 1);
      }
      const nameTok = this.expectIdentifier('全局变量名');
      this.expect(':');
      const typeTok = this.expectIdentifier('数据类型');
      let typeName = typeTok.value;
      if (this.at('[')) {
        this.next();
        let dim = '';
        while (!this.at(']') && this.peek().type !== 'eof') dim += this.next().value;
        this.expect(']');
        typeName = `${typeName.toUpperCase()}[${dim}]`;
      }
      let address: string | undefined;
      if (this.accept('AT')) {
        const a = this.next();
        address = a.value;
      }
      let retain = false;
      let constant = false;
      for (;;) {
        if (this.atKeyword('RETAIN')) {
          this.next();
          retain = true;
        } else if (this.atKeyword('CONSTANT')) {
          this.next();
          constant = true;
        } else break;
      }
      let initialValue: Expression | undefined;
      if (this.accept(':=')) {
        initialValue = this.parseExpression();
      }
      let comment: string | undefined;
      if (this.at(';')) {
        this.next();
        const c = this.peek();
        if (c.type === 'string') {
          this.next();
          comment = c.value;
        }
      } else {
        this.expect(';');
      }
      vars.push({
        kind: 'globalVar',
        name: nameTok.value,
        typeName,
        address,
        initialValue,
        retain,
        constant,
        comment,
        loc: this.loc(nameTok),
      });
    }
    this.expect('END_VAR');
    return vars;
  }

  /* -------------------- TYPE / STRUCT -------------------- */

  private parseTypeDecl(): TypeDeclaration {
    const start = this.expect('TYPE');
    const nameTok = this.expectIdentifier('类型名');
    this.expect(':');
    this.expect('STRUCT');
    const members: StructMember[] = [];

    while (!this.atKeyword('END_STRUCT')) {
      if (this.peek().type === 'eof') {
        throw new ParseError('STRUCT 缺少 END_STRUCT', start.line, start.column);
      }
      const mName = this.expectIdentifier('成员名');
      this.expect(':');
      const mType = this.expectIdentifier('成员类型');
      let typeName = mType.value;
      if (this.at('[')) {
        this.next();
        let dim = '';
        while (!this.at(']') && this.peek().type !== 'eof') dim += this.next().value;
        this.expect(']');
        typeName = `${typeName.toUpperCase()}[${dim}]`;
      }
      let arrayRange: { from: number; to: number } | undefined;
      if (this.at('[')) arrayRange = this.parseArrayRange();
      let initialValue: Expression | undefined;
      if (this.accept(':=')) initialValue = this.parseExpression();
      let comment: string | undefined;
      if (this.at(';')) {
        this.next();
        const c = this.peek();
        if (c.type === 'string') {
          this.next();
          comment = c.value;
        }
      } else {
        this.expect(';');
      }
      members.push({
        name: mName.value,
        typeName,
        arrayRange,
        initialValue,
        comment,
        loc: this.loc(mName),
      });
    }
    this.expect('END_STRUCT');
    this.expect('END_TYPE');
    return {
      kind: 'typeDecl',
      name: nameTok.value,
      members,
      loc: this.loc(start),
    };
  }

  /* -------------------- 语句 -------------------- */

  /**
   * 解析语句序列。
   *
   * @param stopAtCaseLabel 为 true 时（CASE 分支体），遇到 `标签:` 形式立即结束，
   *                         以便把控制权交回 CASE 解析器处理下一个分支。
   */
  private parseStatements(stopAtCaseLabel = false): Statement[] {
    const out: Statement[] = [];
    while (true) {
      const t = this.peek();
      if (t.type === 'eof') break;
      const up = t.value.toUpperCase();
      if (
        up === 'END_PROGRAM' ||
        up === 'END_FUNCTION' ||
        up === 'END_FUNCTION_BLOCK' ||
        up === 'END_VAR' ||
        up === 'END_CASE' ||
        up === 'END_IF' ||
        up === 'END_FOR' ||
        up === 'END_WHILE' ||
        up === 'END_REPEAT' ||
        up === 'END_STRUCT' ||
        up === 'END_TYPE' ||
        // REPEAT 的循环体在 UNTIL 处结束
        up === 'UNTIL' ||
        // ELSE / ELSIF 只可能属于 IF 或 CASE，遇到即结束当前语句块
        up === 'ELSE' ||
        up === 'ELSIF'
      ) {
        break;
      }
      if (stopAtCaseLabel && (this.isCaseLabelAhead() || this.atKeyword('ELSE'))) break;
      const s = this.parseStatement();
      if (s) out.push(s);
    }
    return out;
  }

  /**
   * 判断当前位置是否是 CASE 分支标签（`常量:` 或 `常量,`）。
   * 常量可以是数字、字符串或标识符形式的枚举值。
   */
  private isCaseLabelAhead(): boolean {
    const t = this.peek();
    if (t.type !== 'number' && t.type !== 'string' && t.type !== 'identifier') return false;
    const next = this.peek(1);
    return next.type === 'operator' && (next.value === ':' || next.value === ',');
  }

  private parseStatement(): Statement | null {
    const t = this.peek();

    if (this.accept(';')) {
      return { kind: 'emptyStmt', loc: this.loc(t) };
    }

    // 保留字被当作变量使用（如 IF := 1;）。
    // 语法上无法继续解析，但报「意外的 ':='」毫无信息量，
    // 这里给出明确诊断，由语义层再补一条 E002。
    if (t.type === 'keyword' && this.peek(1).value === ':=' && !this.atKeyword('TRUE', 'FALSE')) {
      throw new ParseError(
        `保留字 '${t.value}' 不能作为变量名`,
        t.line,
        t.column,
      );
    }

    if (this.atKeyword('IF')) return this.parseIf();
    if (this.atKeyword('CASE')) return this.parseCase();
    if (this.atKeyword('FOR')) return this.parseFor();
    if (this.atKeyword('WHILE')) return this.parseWhile();
    if (this.atKeyword('REPEAT')) return this.parseRepeat();
    if (this.atKeyword('EXIT')) {
      this.next();
      this.expect(';');
      return { kind: 'exitStmt', loc: this.loc(t) };
    }
    if (this.atKeyword('RETURN')) {
      this.next();
      this.expect(';');
      return { kind: 'returnStmt', loc: this.loc(t) };
    }
    if (this.atKeyword('CONTINUE')) {
      this.next();
      this.expect(';');
      return { kind: 'exitStmt', loc: this.loc(t) };
    }

    // 赋值语句：target := expr;
    const expr = this.parseExpression();
    if (this.accept(':=')) {
      const value = this.parseExpression();
      this.expect(';');
      return {
        kind: 'assignStmt',
        target: expr,
        value,
        loc: this.loc(t),
      };
    }

    // 独立函数/功能块调用语句
    if (expr.kind === 'call') {
      this.expect(';');
      return { kind: 'callStmt', call: expr, loc: this.loc(t) };
    }

    throw new ParseError(
      `语句无效：'${t.value}' 后缺少 ':=' 或 ';'`,
      t.line,
      t.column,
    );
  }

  private parseIf(): IfStatement {
    const start = this.expect('IF');
    const condition = this.parseExpression();
    this.expect('THEN');
    const body = this.parseStatements();
    const branches: { condition: Expression; body: Statement[] }[] = [
      { condition, body },
    ];
    let elseBody: Statement[] | undefined;

    while (this.atKeyword('ELSIF')) {
      this.next();
      const c = this.parseExpression();
      this.expect('THEN');
      const b = this.parseStatements();
      branches.push({ condition: c, body: b });
    }
    if (this.atKeyword('ELSE')) {
      this.next();
      elseBody = this.parseStatements();
    }
    this.expect('END_IF');
    this.accept(';');
    return { kind: 'ifStmt', branches, elseBody, loc: this.loc(start) };
  }

  private parseCase(): CaseStatement {
    const start = this.expect('CASE');
    const selector = this.parseExpression();
    this.expect('OF');
    const branches: { labels: Expression[]; body: Statement[] }[] = [];
    let elseBody: Statement[] | undefined;

    while (!this.atKeyword('END_CASE')) {
      if (this.peek().type === 'eof') {
        throw new ParseError('CASE 缺少 END_CASE', start.line, start.column);
      }
      if (this.atKeyword('ELSE')) {
        this.next();
        elseBody = this.parseStatements(true);
        break;
      }
      const labels: Expression[] = [];
      // 标签可以是字面量或枚举常量
      while (true) {
        const lbl = this.parsePrimary();
        labels.push(lbl);
        if (!this.accept(',')) break;
      }
      this.expect(':');
      // 分支体在下一个 case 标签处结束
      const body = this.parseStatements(true);
      branches.push({ labels, body });
    }
    this.expect('END_CASE');
    this.accept(';');
    return { kind: 'caseStmt', selector, branches, elseBody, loc: this.loc(start) };
  }

  private parseFor(): ForStatement {
    const start = this.expect('FOR');
    const varTok = this.expectIdentifier('循环变量');
    this.expect(':=');
    const from = this.parseExpression();
    this.expect('TO');
    const to = this.parseExpression();
    let by: Expression | undefined;
    if (this.accept('BY')) by = this.parseExpression();
    this.expect('DO');
    const body = this.parseStatements();
    this.expect('END_FOR');
    this.accept(';');
    return {
      kind: 'forStmt',
      variable: varTok.value,
      from,
      to,
      by,
      body,
      loc: this.loc(start),
    };
  }

  private parseWhile(): WhileStatement {
    const start = this.expect('WHILE');
    const condition = this.parseExpression();
    this.expect('DO');
    const body = this.parseStatements();
    this.expect('END_WHILE');
    this.accept(';');
    return { kind: 'whileStmt', condition, body, loc: this.loc(start) };
  }

  private parseRepeat(): RepeatStatement {
    const start = this.expect('REPEAT');
    const body = this.parseStatements();
    this.expect('UNTIL');
    const condition = this.parseExpression();
    this.expect(';');
    return { kind: 'repeatStmt', condition, body, loc: this.loc(start) };
  }

  /* -------------------- 表达式 -------------------- */

  private parseExpression(): Expression {
    return this.parseBinary(0);
  }

  private parseBinary(minPrec: number): Expression {
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      const op = t.value.toUpperCase();
      const prec = BINARY_PRECEDENCE[op];
      if (prec === undefined || prec < minPrec) break;

      // 注意：AND/OR/XOR/MOD 是关键字，运算符以字符形式出现
      this.next();
      const right = this.parseBinary(prec + 1);
      left = {
        kind: 'binary',
        op: op === 'MOD' ? 'MOD' : t.value,
        left,
        right,
        loc: this.loc(t),
      };
    }
    return left;
  }

  private parseUnary(): Expression {
    const t = this.peek();
    if (t.type === 'operator' && (t.value === '-' || t.value === '+' || t.value === 'NOT')) {
      this.next();
      const operand = this.parseUnary();
      return {
        kind: 'unary',
        op: t.value.toUpperCase() === 'NOT' ? 'NOT' : t.value,
        operand,
        loc: this.loc(t),
      };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expression {
    let expr = this.parsePrimary();
    for (;;) {
      if (this.at('.')) {
        this.next();
        const m = this.expectIdentifier('成员名');
        expr = { kind: 'member', object: expr, member: m.value, loc: this.loc(m) };
      } else if (this.at('[')) {
        this.next();
        const idx = this.parseExpression();
        this.expect(']');
        expr = { kind: 'index', object: expr, index: idx, loc: this.loc(expr.loc.start ? expr.loc : { line: 0, column: 0, start: 0, end: 0 }) };
      } else {
        break;
      }
    }
    return expr;
  }

  private parsePrimary(): Expression {
    const t = this.peek();

    if (t.type === 'number') {
      this.next();
      return {
        kind: 'literal',
        value: t.value,
        literalType: 'number',
        loc: this.loc(t),
      };
    }
    if (t.type === 'string') {
      this.next();
      return { kind: 'literal', value: t.value, literalType: 'string', loc: this.loc(t) };
    }
    if (t.type === 'wstring') {
      this.next();
      return { kind: 'literal', value: t.value, literalType: 'wstring', loc: this.loc(t) };
    }
    if (t.type === 'time') {
      this.next();
      return { kind: 'literal', value: t.value, literalType: 'time', loc: this.loc(t) };
    }
    if (t.type === 'keyword') {
      const up = t.value.toUpperCase();
      if (up === 'TRUE' || up === 'FALSE') {
        this.next();
        return {
          kind: 'literal',
          value: up,
          literalType: 'boolean',
          loc: this.loc(t),
        };
      }
      if (up === 'NOT') {
        this.next();
        const operand = this.parseUnary();
        return { kind: 'unary', op: 'NOT', operand, loc: this.loc(t) };
      }
    }

    if (t.type === 'identifier') {
      // 软元件地址：X10 / D100 / M8000
      const device = this.tryParseDevice();
      if (device) return device;

      this.next();
      // 函数/功能块调用
      if (this.at('(')) {
        return this.parseCall(t.value, t);
      }
      return { kind: 'identifier', name: t.value, loc: this.loc(t) };
    }

    if (t.type === 'operator' && t.value === '(') {
      this.next();
      const inner = this.parseExpression();
      this.expect(')');
      return { kind: 'paren', inner, loc: this.loc(t) };
    }

    throw new ParseError(`表达式中意外的 '${t.value || 'EOF'}'`, t.line, t.column);
  }

  /** 尝试把形如 X10 的标识符解析为软元件地址。 */
  private tryParseDevice(): Expression | null {
    const t = this.peek();
    if (t.type !== 'identifier') return null;
    const m = /^([A-Za-z]+)([0-9]+)$/.exec(t.value);
    if (!m) return null;
    // 后面不能紧跟 '(' —— 那是函数调用
    const after = this.peek(1);
    if (after.type === 'operator' && after.value === '(') return null;

    const prefix = m[1].toUpperCase();
    const number = Number(m[2]);
    this.next();

    // 位偏移：X10.3
    let bitIndex: number | undefined;
    if (this.at('.') && this.peek(1).type === 'number') {
      this.next();
      const b = this.next();
      bitIndex = Number(b.value);
    }
    return {
      kind: 'device',
      prefix,
      number,
      bitIndex,
      text: t.value,
      loc: this.loc(t),
    };
  }

  private parseCall(callee: string, calleeTok: Token): Expression {
    this.expect('(');
    const args: CallArgument[] = [];
    const outputArgs: CallArgument[] = [];

    while (!this.at(')')) {
      if (this.peek().type === 'eof') {
        throw new ParseError('函数调用缺少右括号 ")"', calleeTok.line, calleeTok.column);
      }
      // 命名参数：name := value（输入）或 name => value（输出）
      let name: string | undefined;
      let isOutput = false;
      if (this.peek().type === 'identifier' && this.peek(1).value === ':=') {
        name = this.next().value;
        this.next(); // :=
      } else if (this.peek().type === 'identifier' && this.peek(1).value === '=>') {
        name = this.next().value;
        this.next(); // =>
        isOutput = true;
      }
      const value = this.parseExpression();
      const arg: CallArgument = { name, value, loc: value.loc };
      // 输出参数使用 =>（形如 name => var 或 var）
      if (isOutput || this.at('=>')) {
        if (!isOutput) this.next();
        outputArgs.push(arg);
      } else {
        args.push(arg);
      }
      if (!this.accept(',')) break;
    }
    this.expect(')');
    return {
      kind: 'call',
      callee,
      args,
      outputArgs,
      loc: this.loc(calleeTok),
    };
  }
}

/** 便捷入口：解析 ST 源码。 */
export function parseST(src: string): AST {
  return new Parser(src).parse();
}
