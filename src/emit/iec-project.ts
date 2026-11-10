/**
 * AST → IEC 61131-10 XML 项目 DTO 的映射层。
 *
 * 职责边界：
 *  - 本模块只做「解析后的 AST → 发射器 DTO」的映射，不做 XML 生成（见 iecxml.ts）；
 *  - 本期只支持 Program（FB / Function 会在 warnings 中显式说明并跳过）；
 *  - 局部标签只接受 VAR 段；VAR_INPUT/OUTPUT 属于 FB 形参，本期不支持。
 */

import type { AST, POU, VarDeclaration, TypeDeclaration } from '../dialect/ast.ts';
import { renderExpression, unparse } from './unparser.ts';
import type { IecProgram, IecStruct, IecVar, IecXmlProject } from './iecxml.ts';

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

function mapVar(v: VarDeclaration, owner: string, warnings: string[]): IecVar | null {
  if (v.section !== 'VAR') {
    warnings.push(`'${owner}' 的变量 '${v.name}' 属于 ${v.section}，IEC 导入只支持局部 VAR，已跳过`);
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

function mapProgram(pou: POU, warnings: string[]): IecProgram {
  const vars: IecVar[] = [];
  for (const v of pou.vars) {
    const mapped = mapVar(v, `Program ${pou.name}`, warnings);
    if (mapped) vars.push(mapped);
  }
  const program: IecProgram = {
    name: pou.name,
    vars,
    bodySt: unparse(pou.body),
  };
  if (pou.comment) program.comment = pou.comment;
  return program;
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
 * - Program：全部导出；
 * - Function / FunctionBlock：本期跳过并给出 warning；
 * - 结构体 / 全局变量：全部导出。
 */
export function astToIecProject(ast: AST, options: AstToIecOptions = {}): AstToIecResult {
  const warnings: string[] = [];
  const programs: IecProgram[] = [];

  for (const pou of ast.pous) {
    if (pou.pouType !== 'program') {
      warnings.push(
        `POU '${pou.name}'（${pou.pouType}）暂不支持导出为 IEC XML；本期只支持 Program，已跳过`,
      );
      continue;
    }
    programs.push(mapProgram(pou, warnings));
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
    types,
    globalVars,
  };
  const meta: NonNullable<IecXmlProject['meta']> = {};
  if (options.contentName) meta.contentName = options.contentName;
  if (options.createdAt) meta.createdAt = options.createdAt;
  if (Object.keys(meta).length > 0) project.meta = meta;

  return { project, warnings };
}
