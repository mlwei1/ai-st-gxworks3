/**
 * GX Works3 ST 的抽象语法树（AST）定义。
 */

export type Node = Expression | Statement | Declaration | TypeDecl | POU;

export interface SourceLocation {
  line: number;
  column: number;
  start: number;
  end: number;
}

/* ------------------------------------------------------------------ */
/* 表达式                                                             */
/* ------------------------------------------------------------------ */

export type Expression =
  | LiteralExpression
  | IdentifierExpression
  | DeviceExpression
  | BinaryExpression
  | UnaryExpression
  | CallExpression
  | MemberExpression
  | IndexExpression
  | ParenExpression
  | AssignmentExpression;

export interface LiteralExpression {
  kind: 'literal';
  value: string;
  literalType: 'number' | 'string' | 'wstring' | 'time' | 'boolean';
  loc: SourceLocation;
}

export interface IdentifierExpression {
  kind: 'identifier';
  name: string;
  loc: SourceLocation;
}

/** 软元件地址，如 X10、D100、M800。 */
export interface DeviceExpression {
  kind: 'device';
  prefix: string;
  number: number;
  /** 可选的位偏移，如 X10.3 */
  bitIndex?: number;
  text: string;
  loc: SourceLocation;
}

export interface BinaryExpression {
  kind: 'binary';
  op: string;
  left: Expression;
  right: Expression;
  loc: SourceLocation;
}

export interface UnaryExpression {
  kind: 'unary';
  op: string;
  operand: Expression;
  loc: SourceLocation;
}

/** 函数或功能块调用。 */
export interface CallExpression {
  kind: 'call';
  callee: string;
  args: CallArgument[];
  /** `=>` 输出参数 */
  outputArgs: CallArgument[];
  loc: SourceLocation;
}

export interface CallArgument {
  /** 命名参数时为形参名 */
  name?: string;
  value: Expression;
  loc: SourceLocation;
}

/** 结构体成员访问，如 stMotor.cmd。 */
export interface MemberExpression {
  kind: 'member';
  object: Expression;
  member: string;
  loc: SourceLocation;
}

/** 数组下标，如 aData[3]。 */
export interface IndexExpression {
  kind: 'index';
  object: Expression;
  index: Expression;
  loc: SourceLocation;
}

export interface ParenExpression {
  kind: 'paren';
  inner: Expression;
  loc: SourceLocation;
}

export interface AssignmentExpression {
  kind: 'assign';
  target: Expression;
  value: Expression;
  loc: SourceLocation;
}

/* ------------------------------------------------------------------ */
/* 语句                                                               */
/* ------------------------------------------------------------------ */

export type Statement =
  | AssignmentStatement
  | IfStatement
  | CaseStatement
  | ForStatement
  | WhileStatement
  | RepeatStatement
  | ExitStatement
  | ReturnStatement
  | CallStatement
  | EmptyStatement;

export interface AssignmentStatement {
  kind: 'assignStmt';
  target: Expression;
  value: Expression;
  loc: SourceLocation;
}

export interface IfStatement {
  kind: 'ifStmt';
  branches: { condition: Expression; body: Statement[] }[];
  elseBody?: Statement[];
  loc: SourceLocation;
}

export interface CaseStatement {
  kind: 'caseStmt';
  selector: Expression;
  branches: { labels: Expression[]; body: Statement[] }[];
  elseBody?: Statement[];
  loc: SourceLocation;
}

export interface ForStatement {
  kind: 'forStmt';
  variable: string;
  from: Expression;
  to: Expression;
  by?: Expression;
  body: Statement[];
  loc: SourceLocation;
}

export interface WhileStatement {
  kind: 'whileStmt';
  condition: Expression;
  body: Statement[];
  loc: SourceLocation;
}

export interface RepeatStatement {
  kind: 'repeatStmt';
  condition: Expression;
  body: Statement[];
  loc: SourceLocation;
}

export interface ExitStatement {
  kind: 'exitStmt';
  loc: SourceLocation;
}

export interface ReturnStatement {
  kind: 'returnStmt';
  loc: SourceLocation;
}

export interface CallStatement {
  kind: 'callStmt';
  call: CallExpression;
  loc: SourceLocation;
}

export interface EmptyStatement {
  kind: 'emptyStmt';
  loc: SourceLocation;
}

/* ------------------------------------------------------------------ */
/* 声明与 POU                                                         */
/* ------------------------------------------------------------------ */

export type VarSectionKind =
  | 'VAR'
  | 'VAR_INPUT'
  | 'VAR_OUTPUT'
  | 'VAR_IN_OUT'
  | 'VAR_TEMP'
  | 'VAR_GLOBAL'
  | 'VAR_EXTERNAL';

export interface VarDeclaration {
  kind: 'varDecl';
  name: string;
  typeName: string;
  /** 数组维度，如 [0..10] */
  arrayRange?: { from: number; to: number };
  initialValue?: Expression;
  address?: string;
  retain: boolean;
  constant: boolean;
  comment?: string;
  section: VarSectionKind;
  loc: SourceLocation;
}

export interface StructMember {
  name: string;
  typeName: string;
  arrayRange?: { from: number; to: number };
  initialValue?: Expression;
  comment?: string;
  loc: SourceLocation;
}

export interface TypeDeclaration {
  kind: 'typeDecl';
  name: string;
  members: StructMember[];
  comment?: string;
  loc: SourceLocation;
}

export interface POU {
  kind: 'pou';
  /** program | function | functionBlock */
  pouType: 'program' | 'function' | 'functionBlock';
  name: string;
  /** function 的返回类型 */
  returnType?: string;
  /**
   * 存放该 POU 的容器文件名（FB/FUN 文件）。
   * 官方样例中容器名与 POU 名不同（FbFile1 vs FBPou1）。
   */
  containerName?: string;
  vars: VarDeclaration[];
  types: TypeDeclaration[];
  body: Statement[];
  comment?: string;
  loc: SourceLocation;
}

export interface GlobalVarDeclaration {
  kind: 'globalVar';
  name: string;
  typeName: string;
  address?: string;
  initialValue?: Expression;
  retain: boolean;
  constant: boolean;
  comment?: string;
  loc: SourceLocation;
}

/** 一个可解析的 ST 源文件。 */
export interface AST {
  pous: POU[];
  globalVars: GlobalVarDeclaration[];
  types: TypeDeclaration[];
}

/** STSource 是 AST 的别名，保持与旧命名兼容。 */
export type STSource = AST;
