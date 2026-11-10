/**
 * AST → IEC 61131-10 XML 项目 DTO 的映射层。
 *
 * 职责边界：
 *  - 本模块只做「解析后的 AST → 发射器 DTO」的映射，不做 XML 生成（见 iecxml.ts）；
 *  - 支持 Program / FunctionBlock / Function 三类 POU；
 *  - FB 形参按段拆分：VAR_IN_OUT → InoutVars、VAR_INPUT → InputVars、VAR_OUTPUT → OutputVars；
 *  - Function 的 VAR_TEMP → TempVars，返回类型 → ResultType；
 *  - 数组暂按标量导出并给出 warning（数组类型在 GX Works3 XML 中尚未验证）。
 */

import type { AST, POU, VarDeclaration, TypeDeclaration, VarSectionKind } from '../dialect/ast.ts';
import { renderExpression, unparse } from './unparser.ts';
import type {
  IecFunction,
  IecFunctionBlock,
  IecProgram,
  IecStruct,
  IecVar,
  IecXmlProject,
} from './iecxml.ts';

export interface AstToIecOptions {
  /** 写入 ContentHeader@name / 工程标识；默认用第一个 POU 名。 */
  contentName?: string;
  /** ContentHeader 时间戳（ISO 8601）；默认使用发射器的确定性固定值。 */
  createdAt?: string;
}

export interface AstToIecResult {
  project: IecXmlProject;
  warnings: string[];
}

function mapVar(
  v: VarDeclaration,
  owner: string,
  warnings: string[],
  allowAnySection = false,
): IecVar | null {
  if (!allowAnySection && v.section !== 'VAR') {
    warnings.push(`'${owner}' 的变量 '${v.name}' 属于 ${v.section}，已跳过`);
    return null;
  }
  if (v.arrayRange) {
    warnings.push(`'${owner}' 的变量 '${v.name}' 是数组，数组类型在 IEC XML 中尚未支持，已按标量导出（可能不准确）`);
  }
  const out: IecVar = { name: v.name, type: v.typeName };
  if (v.initialValue) out.initial = renderExpression(v.initialValue);
  if (v.address) out.address = v.address;
  if (v.comment) out.comment = v.comment;
  if (v.retain) out.retain = true;
  if (v.constant) out.constant = true;
  return out;
}

/** 取出某 VAR 段的变量并映射；section 为 undefined 时取全部。 */
function mapVarList(
  pou: POU,
  section: VarSectionKind | undefined,
  warnings: string[],
  owner: string,
): IecVar[] {
  const out: IecVar[] = [];
  for (const v of pou.vars) {
    if (section !== undefined && v.section !== section) continue;
    if (section === undefined && v.section !== 'VAR') {
      warnings.push(`'${owner}' 的变量 '${v.name}' 属于 ${v.section}，未找到对应 XML 段，已跳过`);
      continue;
    }
    const mapped = mapVar(v, owner, warnings, true);
    if (mapped) out.push(mapped);
  }
  return out;
}

function mapProgram(pou: POU, warnings: string[]): IecProgram {
  const program: IecProgram = {
    name: pou.name,
    vars: mapVarList(pou, 'VAR', warnings, `Program ${pou.name}`),
    bodySt: unparse(pou.body),
  };
  if (pou.comment) program.comment = pou.comment;
  return program;
}

function mapFunctionBlock(pou: POU, warnings: string[]): IecFunctionBlock {
  const owner = `FunctionBlock ${pou.name}`;
  const fb: IecFunctionBlock = {
    name: pou.name,
    inouts: mapVarList(pou, 'VAR_IN_OUT', warnings, owner),
    inputs: mapVarList(pou, 'VAR_INPUT', warnings, owner),
    outputs: mapVarList(pou, 'VAR_OUTPUT', warnings, owner),
    vars: mapVarList(pou, 'VAR', warnings, owner),
    bodySt: unparse(pou.body),
  };
  if (pou.comment) fb.comment = pou.comment;
  return fb;
}

function mapFunction(pou: POU, warnings: string[]): IecFunction | null {
  if (!pou.returnType) {
    warnings.push(`函数 '${pou.name}' 缺少返回类型，无法导出为 IEC XML，已跳过`);
    return null;
  }
  const owner = `Function ${pou.name}`;
  const fn: IecFunction = {
    name: pou.name,
    returnType: pou.returnType,
    inputs: mapVarList(pou, 'VAR_INPUT', warnings, owner),
    outputs: mapVarList(pou, 'VAR_OUTPUT', warnings, owner),
    temps: mapVarList(pou, 'VAR_TEMP', warnings, owner),
    vars: mapVarList(pou, 'VAR', warnings, owner),
    bodySt: unparse(pou.body),
  };
  if (pou.comment) fn.comment = pou.comment;
  return fn;
}

function mapStruct(t: TypeDeclaration, warnings: string[]): IecStruct {
  const members = t.members.map((m) => {
    if (m.arrayRange) {
      warnings.push(`结构体 '${t.name}' 的成员 '${m.name}' 是数组，暂未支持，已按标量导出`);
    }
    return {
      name: m.name,
      type: m.typeName,
      initial: m.initialValue ? renderExpression(m.initialValue) : undefined,
      comment: m.comment,
    };
  });
  return { name: t.name, members, comment: t.comment };
}

/**
 * 把解析后的 ST 工程映射为 IEC XML 发射器 DTO。
 *
 * - Program / FunctionBlock / Function：全部导出；
 * - 结构体 / 全局变量：全部导出。
 */
export function astToIecProject(ast: AST, options: AstToIecOptions = {}): AstToIecResult {
  const warnings: string[] = [];
  const programs: IecProgram[] = [];
  const functionBlocks: IecFunctionBlock[] = [];
  const functions: IecFunction[] = [];

  for (const pou of ast.pous) {
    if (pou.pouType === 'program') {
      programs.push(mapProgram(pou, warnings));
    } else if (pou.pouType === 'functionBlock') {
      functionBlocks.push(mapFunctionBlock(pou, warnings));
    } else {
      const fn = mapFunction(pou, warnings);
      if (fn) functions.push(fn);
    }
  }

  const types: IecStruct[] = ast.types.map((t) => mapStruct(t, warnings));

  const globalVars: IecVar[] = ast.globalVars.map((g) => {
    const out: IecVar = { name: g.name, type: g.typeName };
    if (g.initialValue) out.initial = renderExpression(g.initialValue);
    if (g.address) out.address = g.address;
    if (g.comment) out.comment = g.comment;
    if (g.retain) out.retain = true;
    if (g.constant) out.constant = true;
    return out;
  });

  const project: IecXmlProject = {
    programs,
    functionBlocks,
    functions,
    types,
    globalVars,
  };
  const meta: NonNullable<IecXmlProject['meta']> = {};
  if (options.contentName) meta.contentName = options.contentName;
  if (options.createdAt) meta.createdAt = options.createdAt;
  if (Object.keys(meta).length > 0) project.meta = meta;

  return { project, warnings };
}
