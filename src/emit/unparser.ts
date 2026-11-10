/**
 * AST → GX Works3 ST 源码 反向生成器。
 *
 * 生成的代码遵循 GX Works3 ST 编辑器的书写习惯：
 *  - 语句以 `;` 结尾
 *  - 缩进用 4 空格
 *  - IF/THEN/ELSE/END_IF、CASE/OF/END_CASE 等关键字大写
 */

import {
  type Expression,
  type POU,
  type Statement,
  type VarDeclaration,
} from '../dialect/ast.ts';

const INDENT = '    ';

/** 顶层：把语句数组渲染为 ST 文本。 */
export function unparse(statements: Statement[]): string {
  const out: string[] = [];
  for (const s of statements) {
    renderStatement(s, 0, out);
  }
  return out.join('\n');
}

/** 渲染整个 POU（含 VAR 段）。 */
export function unparsePOU(pou: POU): string {
  const out: string[] = [];
  const header =
    pou.pouType === 'program'
      ? 'PROGRAM'
      : pou.pouType === 'functionBlock'
        ? 'FUNCTION_BLOCK'
        : 'FUNCTION';
  out.push(`${header} ${pou.name}${pou.returnType ? ` : ${pou.returnType}` : ''}`);

  // VAR 段分组
  const sections = [
    'VAR_INPUT',
    'VAR_OUTPUT',
    'VAR_IN_OUT',
    'VAR',
    'VAR_TEMP',
  ];
  for (const section of sections) {
    const vars = pou.vars.filter((v) => v.section === section);
    if (vars.length === 0) continue;
    out.push(`${section}`);
    for (const v of vars) {
      out.push(`${INDENT}${renderVar(v)}`);
    }
    out.push('END_VAR');
  }

  const body = unparse(pou.body);
  if (body.trim().length > 0) {
    out.push(body);
  }

  const footer =
    pou.pouType === 'program'
      ? 'END_PROGRAM'
      : pou.pouType === 'functionBlock'
        ? 'END_FUNCTION_BLOCK'
        : 'END_FUNCTION';
  out.push(footer);
  return out.join('\n');
}

/** 渲染单条变量声明。 */
function renderVar(v: VarDeclaration): string {
  let s = `${v.name} : ${v.typeName}`;
  if (v.arrayRange) {
    s += ` ARRAY[${v.arrayRange.from}..${v.arrayRange.to}]`;
  }
  if (v.address) s += ` AT ${v.address}`;
  if (v.retain) s += ' RETAIN';
  if (v.constant) s += ' CONSTANT';
  if (v.initialValue) s += ` := ${renderExpression(v.initialValue)}`;
  if (v.comment) s += `; // ${v.comment}`;
  else s += ';';
  return s;
}

/* ------------------------------------------------------------------ */
/* 语句                                                               */
/* ------------------------------------------------------------------ */

function renderStatement(stmt: Statement, depth: number, out: string[]): void {
  const pad = INDENT.repeat(depth);

  switch (stmt.kind) {
    case 'assignStmt':
      out.push(`${pad}${renderExpression(stmt.target)} := ${renderExpression(stmt.value)};`);
      break;

    case 'ifStmt': {
      const [first, ...rest] = stmt.branches;
      out.push(`${pad}IF ${renderExpression(first.condition)} THEN`);
      for (const s of first.body) renderStatement(s, depth + 1, out);
      for (const b of rest) {
        out.push(`${pad}ELSIF ${renderExpression(b.condition)} THEN`);
        for (const s of b.body) renderStatement(s, depth + 1, out);
      }
      if (stmt.elseBody && stmt.elseBody.length > 0) {
        out.push(`${pad}ELSE`);
        for (const s of stmt.elseBody) renderStatement(s, depth + 1, out);
      }
      out.push(`${pad}END_IF;`);
      break;
    }

    case 'caseStmt': {
      out.push(`${pad}CASE ${renderExpression(stmt.selector)} OF`);
      for (const b of stmt.branches) {
        const labels = b.labels.map((l) => renderExpression(l)).join(', ');
        out.push(`${pad}${INDENT}${labels}:`);
        for (const s of b.body) renderStatement(s, depth + 2, out);
      }
      if (stmt.elseBody && stmt.elseBody.length > 0) {
        out.push(`${pad}ELSE`);
        for (const s of stmt.elseBody) renderStatement(s, depth + 1, out);
      }
      out.push(`${pad}END_CASE;`);
      break;
    }

    case 'forStmt': {
      let s = `${pad}FOR ${stmt.variable} := ${renderExpression(stmt.from)} TO ${renderExpression(stmt.to)}`;
      if (stmt.by) s += ` BY ${renderExpression(stmt.by)}`;
      out.push(`${s} DO`);
      for (const st of stmt.body) renderStatement(st, depth + 1, out);
      out.push(`${pad}END_FOR;`);
      break;
    }

    case 'whileStmt': {
      out.push(`${pad}WHILE ${renderExpression(stmt.condition)} DO`);
      for (const s of stmt.body) renderStatement(s, depth + 1, out);
      out.push(`${pad}END_WHILE;`);
      break;
    }

    case 'repeatStmt': {
      out.push(`${pad}REPEAT`);
      for (const s of stmt.body) renderStatement(s, depth + 1, out);
      out.push(`${pad}UNTIL ${renderExpression(stmt.condition)};`);
      break;
    }

    case 'exitStmt':
      out.push(`${pad}EXIT;`);
      break;

    case 'returnStmt':
      out.push(`${pad}RETURN;`);
      break;

    case 'callStmt':
      out.push(`${pad}${renderExpression(stmt.call)};`);
      break;

    case 'emptyStmt':
      break;
  }
}

/* ------------------------------------------------------------------ */
/* 表达式                                                             */
/* ------------------------------------------------------------------ */

export function renderExpression(expr: Expression): string {
  switch (expr.kind) {
    case 'literal': {
      if (expr.literalType === 'string') return `'${expr.value.replace(/'/g, "''")}'`;
      if (expr.literalType === 'wstring') return `"${expr.value}"`;
      if (expr.literalType === 'boolean') return expr.value;
      return expr.value;
    }
    case 'identifier':
      return expr.name;
    case 'device':
      return expr.text;
    case 'binary': {
      const op = expr.op.toUpperCase() === 'MOD' ? 'MOD' : expr.op;
      return `${renderExpression(expr.left)} ${op} ${renderExpression(expr.right)}`;
    }
    case 'unary':
      if (expr.op === 'NOT') return `NOT ${renderExpression(expr.operand)}`;
      return `${expr.op}${renderExpression(expr.operand)}`;
    case 'paren':
      return `(${renderExpression(expr.inner)})`;
    case 'member':
      return `${renderExpression(expr.object)}.${expr.member}`;
    case 'index':
      return `${renderExpression(expr.object)}[${renderExpression(expr.index)}]`;
    case 'call': {
      const args = expr.args.map((a) =>
        a.name ? `${a.name} := ${renderExpression(a.value)}` : renderExpression(a.value),
      );
      const outs = expr.outputArgs.map((a) =>
        a.name ? `${a.name} => ${renderExpression(a.value)}` : `=> ${renderExpression(a.value)}`,
      );
      const all = [...args, ...outs];
      return `${expr.callee}(${all.join(', ')})`;
    }
    case 'assign':
      return `${renderExpression(expr.target)} := ${renderExpression(expr.value)}`;
    default:
      return '';
  }
}
