/**
 * IEC 61131-10 (Ed.1.0) XML 发射器 —— GX Works3「工程 → 导入 → IEC61131-10 XML格式」通道。
 *
 * 设计依据（均为官方格式，详见 docs/research/01-GXWorks3原生接口.md §7）：
 * - GX Works3 官方样例：
 *   C:\Program Files (x86)\MELSOFT\GPPW3\SampleData\IEC61131-10XML\Sample.xml
 *   根元素：<Project xmlns="www.iec.ch/public/TC65SC65BWG7TF10" ... schemaVersion="1.000"
 *                   xsi:schemaLocation="www.iec.ch/public/TC65SC65BWG7TF10 GXW3_IEC61131_10_Ed1_0_ForGXW3.xsd">
 * - ST 正文：<MainBody><BodyContent xsi:type="ST"><ST>语句…</ST></BodyContent></MainBody>
 * - 局部标签：<Vars accessSpecifier="private">…</Vars>
 * - 全局标签：<Instances><Configuration name="config1"><Resource name="Main" resourceTypeName="prgFile">…</Resource>
 *                 <GlobalVars constant="false" retain="false">…</GlobalVars></Configuration></Instances>
 *   （官方样例核实：GlobalVars 位于 Configuration 下、Resource 之后，不在 Resource 内；可变多个）
 * - 结构体：<DataTypeDecl name="…"><UserDefinedTypeSpec xsi:type="StructTypeSpec"><Member …/></…>
 *
 * 约束：
 * - 仅支持 ST 语言；本期只接受 **VAR** 类局部标签（VAR_INPUT/OUTPUT/IN_OUT 属于 FB，遇到即显式报错）。
 * - 同输入必须同输出（默认时间戳固定，不受系统时钟影响），便于快照测试与 diff。
 * - 零运行时依赖，仅用 Node 内置模块；不解析 ST、不依赖 parser（调用方给 bodySt 文本）。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** 标签类。本期：局部/全局变量只允许 VAR；其余类属于 FB 形参，暂不支持。 */
export type IecVarSection = 'VAR' | 'VAR_INPUT' | 'VAR_OUTPUT' | 'VAR_IN_OUT';

/** 一个标签（局部 VAR / 全局变量）。 */
export interface IecVar {
  name: string;
  /** 三菱数据类型名，如 BOOL / INT / TON / ST_Motor / INT[0..9] */
  type: string;
  /** 仅允许 'VAR'（省略等同 'VAR'）；其他值会抛错。 */
  section?: IecVarSection;
  /** 初始值字面量，如 FALSE / 100 / T#10s */
  initial?: string;
  /** 软元件/标签分配，如 M100 / D200 / Y0（写入 <Address address="…"/>） */
  address?: string;
  /** 标签注释（写入 AddData/VariableComments） */
  comment?: string;
  /**
   * 是否保持（对应 GX Works3 的 VAR_GLOBAL_RETAIN / VAR_RETAIN）。
   * 注意：分配在锁存区（如 FX5U 的 D200 以上）的全局标签必须为 retain=true，
   * 否则编译报 0x11021040。
   */
  retain?: boolean;
  /** 是否常数（对应 GX Works3 的 VAR_GLOBAL_CONSTANT / VAR_CONSTANT）。 */
  constant?: boolean;
}

/** 结构体成员。 */
export interface IecStructMember {
  name: string;
  type: string;
  initial?: string;
  comment?: string;
}

/** 结构体定义（TYPE … STRUCT）。 */
export interface IecStruct {
  name: string;
  comment?: string;
  members: IecStructMember[];
}

/** 程序块（Program POU），bodySt 为纯 ST 语句文本（不含 VAR 段）。 */
export interface IecProgram {
  name: string;
  comment?: string;
  vars: IecVar[];
  /** ST 正文（不含 VAR…END_VAR；会被 XML 转义并保留换行） */
  bodySt: string;
}

/**
 * 功能块（FUNCTION_BLOCK POU）。
 * 形参分三组（VAR_IN_OUT / VAR_INPUT / VAR_OUTPUT），局部变量放 Vars。
 */
export interface IecFunctionBlock {
  name: string;
  comment?: string;
  inputs?: IecVar[];
  outputs?: IecVar[];
  inouts?: IecVar[];
  vars?: IecVar[];
  bodySt: string;
}

/** 函数（FUNCTION POU）：有返回类型；局部临时变量放 TempVars。 */
export interface IecFunction {
  name: string;
  comment?: string;
  returnType: string;
  inputs?: IecVar[];
  outputs?: IecVar[];
  temps?: IecVar[];
  vars?: IecVar[];
  bodySt: string;
}

export interface IecXmlMeta {
  companyName?: string;
  companyUrl?: string;
  productName?: string;
  productVersion?: string;
  /** ContentHeader/@name */
  contentName?: string;
  /**
   * ContentHeader 时间戳（ISO 8601）。
   * 默认固定为 1970-01-01T00:00:00+00:00，保证确定性；调用方需要真实时间时显式传入。
   */
  createdAt?: string;
}

/** 发射器输入 DTO。 */
export interface IecXmlProject {
  programs: IecProgram[];
  functionBlocks?: IecFunctionBlock[];
  functions?: IecFunction[];
  types?: IecStruct[];
  globalVars?: IecVar[];
  meta?: IecXmlMeta;
}

/** 默认时间戳：固定值 → 同输入同输出（确定性）。 */
export const DEFAULT_TIMESTAMP = '1970-01-01T00:00:00+00:00';

/** XML 文本节点转义：& < >（' " 在文本中无需转义，但一并转义更安全）。 */
export function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** XML 属性值转义（比文本多转义换行/制表，避免属性值被规范化）。 */
export function escapeXmlAttr(value: string): string {
  return escapeXmlText(value).replace(/\r/g, '&#13;').replace(/\n/g, '&#10;').replace(/\t/g, '&#9;');
}

const INDENT = '  ';

function validateName(kind: string, name: string): void {
  if (!name || !name.trim()) throw new Error(`${kind} 名称不能为空`);
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(name)) {
    throw new Error(`${kind} 名称含非法控制字符: ${JSON.stringify(name)}`);
  }
}

function validateVar(kind: string, v: IecVar, allowSection: boolean): void {
  validateName(kind, v.name);
  if (!v.type || !v.type.trim()) throw new Error(`${kind} '${v.name}' 的 type 不能为空`);
  if (v.section !== undefined && v.section !== 'VAR') {
    if (!allowSection) throw new Error(`${kind} '${v.name}' 指定了 section=${v.section}；全局变量不支持形参类`);
    throw new Error(
      `${kind} '${v.name}' 指定了 section=${v.section}。本期发射器只支持 VAR（FB 形参类 VAR_INPUT/VAR_OUTPUT/VAR_IN_OUT 暂不支持）`,
    );
  }
}

function varLines(v: IecVar, indent: number, extraAttrs = ''): string[] {
  const pad = INDENT.repeat(indent);
  const pad2 = INDENT.repeat(indent + 1);
  const pad3 = INDENT.repeat(indent + 2);
  const pad4 = INDENT.repeat(indent + 3);
  const out: string[] = [];
  out.push(`${pad}<Variable name="${escapeXmlAttr(v.name)}"${extraAttrs}>`);
  if (v.comment) {
    out.push(`${pad2}<AddData>`);
    out.push(
      `${pad3}<Data name="http://www.mitsubishielectric.com/xml/VariableComments" handleUnknown="implementation">`,
    );
    out.push(`${pad4}<VariableComments>`);
    out.push(`${pad4}  <Comment number="6"><CommentText>${escapeXmlText(v.comment)}</CommentText></Comment>`);
    out.push(`${pad4}</VariableComments>`);
    out.push(`${pad3}</Data>`);
    out.push(`${pad2}</AddData>`);
  }
  out.push(`${pad2}<Type>`);
  out.push(`${pad3}<TypeName>${escapeXmlText(v.type)}</TypeName>`);
  out.push(`${pad2}</Type>`);
  if (v.initial !== undefined && v.initial !== '') {
    out.push(`${pad2}<InitialValue>`);
    out.push(`${pad3}<SimpleValue value="${escapeXmlAttr(v.initial)}"/>`);
    out.push(`${pad2}</InitialValue>`);
  }
  if (v.address !== undefined && v.address !== '') {
    out.push(`${pad2}<Address address="${escapeXmlAttr(v.address)}"/>`);
  }
  out.push(`${pad}</Variable>`);
  return out;
}

function programLines(p: IecProgram): string[] {
  const pad = INDENT.repeat(3); // inside Types/GlobalNamespace
  const pad2 = INDENT.repeat(4);
  const pad3 = INDENT.repeat(5);
  const pad4 = INDENT.repeat(6);
  const out: string[] = [];
  out.push(`${pad}<Program name="${escapeXmlAttr(p.name)}">`);
  if (p.comment) {
    out.push(`${pad2}<Documentation xsi:type="SimpleText">${escapeXmlText(p.comment)}</Documentation>`);
  }
  out.push(`${pad2}<Vars accessSpecifier="private">`);
  for (const v of p.vars) out.push(...varLines(v, 5));
  out.push(`${pad2}</Vars>`);
  out.push(`${pad2}<MainBody>`);
  const body = (p.bodySt ?? '').replace(/\r\n?/g, '\n');
  if (body.length > 0) {
    out.push(`${pad3}<BodyContent xsi:type="ST">`);
    // 正文原样保留（不逐行缩进，避免改变 ST 文本内容），仅做 XML 转义。
    out.push(`${pad4}<ST>${escapeXmlText(body)}</ST>`);
    out.push(`${pad3}</BodyContent>`);
  }
  out.push(`${pad2}</MainBody>`);
  out.push(`${pad}</Program>`);
  return out;
}

/** 参数变量（带 orderWithinParamSet），用于 FB/FUN 的 InoutVars/InputVars/OutputVars。 */
function paramSectionLines(
  section: 'InoutVars' | 'InputVars' | 'OutputVars',
  vars: IecVar[] | undefined,
  indent: number,
  startOrder: number,
): { lines: string[]; nextOrder: number } {
  const list = vars ?? [];
  if (list.length === 0) return { lines: [], nextOrder: startOrder };
  const pad = INDENT.repeat(indent);
  const out: string[] = [];
  const attrs = section === 'OutputVars' ? ' retain="false"' : '';
  out.push(`${pad}<${section}${attrs}>`);
  let order = startOrder;
  for (const v of list) {
    out.push(...varLines(v, indent + 1, ` orderWithinParamSet="${order}"`));
    order++;
  }
  out.push(`${pad}</${section}>`);
  return { lines: out, nextOrder: order };
}

/** MainBody 的公共片段。 */
function mainBodyLines(bodySt: string, indent: number): string[] {
  const pad = INDENT.repeat(indent);
  const out: string[] = [];
  out.push(`${pad}<MainBody>`);
  const body = (bodySt ?? '').replace(/\r\n?/g, '\n');
  if (body.length > 0) {
    out.push(`${pad}${INDENT}<BodyContent xsi:type="ST">`);
    out.push(`${pad}${INDENT}${INDENT}<ST>${escapeXmlText(body)}</ST>`);
    out.push(`${pad}${INDENT}</BodyContent>`);
  }
  out.push(`${pad}</MainBody>`);
  return out;
}

/** 功能块（FUNCTION_BLOCK）：Parameters(Inout/Input/Output) + Vars + MainBody。 */
function functionBlockLines(fb: IecFunctionBlock): string[] {
  const pad = INDENT.repeat(4);
  const pad2 = INDENT.repeat(5);
  const out: string[] = [];
  out.push(`${pad}<FunctionBlock name="${escapeXmlAttr(fb.name)}">`);
  if (fb.comment) {
    out.push(`${pad2}<Documentation xsi:type="SimpleText">${escapeXmlText(fb.comment)}</Documentation>`);
  }
  out.push(`${pad2}<Parameters>`);
  let order = 1;
  for (const section of ['InoutVars', 'InputVars', 'OutputVars'] as const) {
    const vars = section === 'InoutVars' ? fb.inouts : section === 'InputVars' ? fb.inputs : fb.outputs;
    const res = paramSectionLines(section, vars, 6, order);
    out.push(...res.lines);
    order = res.nextOrder;
  }
  out.push(`${pad2}</Parameters>`);
  if (fb.vars && fb.vars.length > 0) {
    out.push(`${pad2}<Vars accessSpecifier="private">`);
    for (const v of fb.vars) out.push(...varLines(v, 6));
    out.push(`${pad2}</Vars>`);
  }
  out.push(...mainBodyLines(fb.bodySt, 5));
  out.push(`${pad}</FunctionBlock>`);
  return out;
}

/** 函数（FUNCTION）：ResultType + Parameters(Input/Output) + TempVars/Vars + MainBody。 */
function functionLines(fn: IecFunction): string[] {
  const pad = INDENT.repeat(4);
  const pad2 = INDENT.repeat(5);
  const pad3 = INDENT.repeat(6);
  const out: string[] = [];
  out.push(`${pad}<Function name="${escapeXmlAttr(fn.name)}">`);
  if (fn.comment) {
    out.push(`${pad2}<Documentation xsi:type="SimpleText">${escapeXmlText(fn.comment)}</Documentation>`);
  }
  out.push(`${pad2}<ResultType>`);
  out.push(`${pad3}<TypeName>${escapeXmlText(fn.returnType)}</TypeName>`);
  out.push(`${pad2}</ResultType>`);
  out.push(`${pad2}<Parameters>`);
  let order = 1;
  for (const section of ['InputVars', 'OutputVars'] as const) {
    const vars = section === 'InputVars' ? fn.inputs : fn.outputs;
    const res = paramSectionLines(section, vars, 6, order);
    out.push(...res.lines);
    order = res.nextOrder;
  }
  out.push(`${pad2}</Parameters>`);
  if (fn.temps && fn.temps.length > 0) {
    out.push(`${pad2}<TempVars>`);
    for (const v of fn.temps) out.push(...varLines(v, 6));
    out.push(`${pad2}</TempVars>`);
  }
  if (fn.vars && fn.vars.length > 0) {
    out.push(`${pad2}<Vars accessSpecifier="private">`);
    for (const v of fn.vars) out.push(...varLines(v, 6));
    out.push(`${pad2}</Vars>`);
  }
  out.push(...mainBodyLines(fn.bodySt, 5));
  out.push(`${pad}</Function>`);
  return out;
}

function structLines(t: IecStruct): string[] {
  const pad = INDENT.repeat(3);
  const pad2 = INDENT.repeat(4);
  const pad3 = INDENT.repeat(5);
  const pad4 = INDENT.repeat(6);
  const pad5 = INDENT.repeat(7);
  const out: string[] = [];
  out.push(`${pad}<DataTypeDecl name="${escapeXmlAttr(t.name)}">`);
  if (t.comment) {
    out.push(`${pad2}<Documentation xsi:type="SimpleText">${escapeXmlText(t.comment)}</Documentation>`);
  }
  out.push(`${pad2}<UserDefinedTypeSpec xsi:type="StructTypeSpec">`);
  for (const m of t.members) {
    const member: IecStructMember = m;
    out.push(`${pad3}<Member name="${escapeXmlAttr(member.name)}">`);
    if (member.comment) {
      out.push(`${pad4}<AddData>`);
      out.push(
        `${pad5}<Data name="http://www.mitsubishielectric.com/xml/VariableComments" handleUnknown="implementation">`,
      );
      out.push(`${pad5}  <VariableComments>`);
      out.push(
        `${pad5}    <Comment number="6"><CommentText>${escapeXmlText(member.comment)}</CommentText></Comment>`,
      );
      out.push(`${pad5}  </VariableComments>`);
      out.push(`${pad5}</Data>`);
      out.push(`${pad4}</AddData>`);
    }
    out.push(`${pad4}<Type><TypeName>${escapeXmlText(member.type)}</TypeName></Type>`);
    if (member.initial !== undefined && member.initial !== '') {
      out.push(`${pad4}<InitialValue><SimpleValue value="${escapeXmlAttr(member.initial)}"/></InitialValue>`);
    }
    out.push(`${pad3}</Member>`);
  }
  out.push(`${pad2}</UserDefinedTypeSpec>`);
  out.push(`${pad}</DataTypeDecl>`);
  return out;
}

/**
 * 按 (constant, retain) 把全局标签分组，生成多个 <GlobalVars> 块。
 * 顺序：普通 → retain → constant → constant+retain。
 */
interface GlobalVarsGroup {
  constant: boolean;
  retain: boolean;
  vars: IecVar[];
}

function groupGlobalVars(vars: IecVar[]): GlobalVarsGroup[] {
  const groups: GlobalVarsGroup[] = [];
  for (const v of vars) {
    const constant = v.constant === true;
    const retain = v.retain === true;
    let group = groups.find((g) => g.constant === constant && g.retain === retain);
    if (!group) {
      group = { constant, retain, vars: [] };
      groups.push(group);
    }
    group.vars.push(v);
  }
  const order = (g: GlobalVarsGroup) => (g.constant ? 2 : 0) + (g.retain ? 1 : 0);
  return groups.sort((a, b) => order(a) - order(b));
}

/**
 * 生成完整的 GX Works3 可导入 IEC 61131-10 XML 字符串。
 * 输出：UTF-8 语义、2 空格缩进、`<?xml?>` 声明、确定性（不读系统时钟）。
 */
export function emitIecXml(project: IecXmlProject): string {
  const fbs = project.functionBlocks ?? [];
  const fns = project.functions ?? [];
  if (
    !project ||
    !Array.isArray(project.programs) ||
    (project.programs.length === 0 && fbs.length === 0 && fns.length === 0)
  ) {
    throw new Error('IecXmlProject 至少需要一个 Program / FunctionBlock / Function');
  }
  // ---- 输入校验（Program / FunctionBlock / Function 共享同一命名空间）----
  const pouNames = new Set<string>();
  for (const p of project.programs) {
    validateName('Program', p.name);
    if (pouNames.has(p.name)) throw new Error(`POU 名称重复: ${p.name}`);
    pouNames.add(p.name);
    for (const v of p.vars) validateVar(`程序 ${p.name} 的局部标签`, v, true);
  }
  for (const fb of fbs) {
    validateName('FunctionBlock', fb.name);
    if (pouNames.has(fb.name)) throw new Error(`POU 名称重复: ${fb.name}`);
    pouNames.add(fb.name);
    for (const [kind, vars] of [
      ['VAR_IN_OUT', fb.inouts],
      ['VAR_INPUT', fb.inputs],
      ['VAR_OUTPUT', fb.outputs],
      ['VAR', fb.vars],
    ] as const) {
      for (const v of vars ?? []) validateVar(`功能块 ${fb.name} 的 ${kind}`, v, true);
    }
  }
  for (const fn of fns) {
    validateName('Function', fn.name);
    if (pouNames.has(fn.name)) throw new Error(`POU 名称重复: ${fn.name}`);
    pouNames.add(fn.name);
    if (!fn.returnType || !fn.returnType.trim()) throw new Error(`函数 ${fn.name} 缺少 returnType`);
    for (const [kind, vars] of [
      ['VAR_INPUT', fn.inputs],
      ['VAR_OUTPUT', fn.outputs],
      ['VAR_TEMP', fn.temps],
      ['VAR', fn.vars],
    ] as const) {
      for (const v of vars ?? []) validateVar(`函数 ${fn.name} 的 ${kind}`, v, true);
    }
  }
  const structNames = new Set<string>();
  for (const t of project.types ?? []) {
    validateName('结构体', t.name);
    if (structNames.has(t.name)) throw new Error(`结构体名称重复: ${t.name}`);
    structNames.add(t.name);
    if (t.members.length === 0) throw new Error(`结构体 '${t.name}' 至少需要一个成员`);
    const memberNames = new Set<string>();
    for (const m of t.members) {
      validateName(`结构体 '${t.name}' 成员`, m.name);
      if (memberNames.has(m.name)) throw new Error(`结构体 '${t.name}' 成员重复: ${m.name}`);
      memberNames.add(m.name);
      if (!m.type || !m.type.trim()) throw new Error(`结构体 '${t.name}' 成员 '${m.name}' 的 type 不能为空`);
    }
  }
  for (const g of project.globalVars ?? []) validateVar('全局变量', g, false);

  const meta = project.meta ?? {};
  const ts = meta.createdAt ?? DEFAULT_TIMESTAMP;
  const companyName = meta.companyName ?? 'MITSUBISHI ELECTRIC CORPORATION';
  const companyUrl = meta.companyUrl ?? 'http://www.mitsubishielectric.com';
  const productName = meta.productName ?? 'GX Works3';
  const productVersion = meta.productVersion ?? 'ver.1.0';
  const contentName = meta.contentName ?? 'AI-ST Project';

  const L: string[] = [];
  L.push('<?xml version="1.0" encoding="utf-8"?>');
  L.push(
    '<Project xmlns="www.iec.ch/public/TC65SC65BWG7TF10" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
      `schemaVersion="1.000" xsi:schemaLocation="www.iec.ch/public/TC65SC65BWG7TF10 GXW3_IEC61131_10_Ed1_0_ForGXW3.xsd">`,
  );
  L.push(
    `${INDENT}<FileHeader companyName="${escapeXmlAttr(companyName)}" companyURL="${escapeXmlAttr(companyUrl)}" ` +
      `productName="${escapeXmlAttr(productName)}" productVersion="${escapeXmlAttr(productVersion)}"/>`,
  );
  L.push(
    `${INDENT}<ContentHeader name="${escapeXmlAttr(contentName)}" creationDateTime="${escapeXmlAttr(ts)}" ` +
      `modificationDateTime="${escapeXmlAttr(ts)}"/>`,
  );
  L.push(`${INDENT}<Types>`);
  L.push(`${INDENT}${INDENT}<GlobalNamespace>`);
  for (const t of project.types ?? []) L.push(...structLines(t));
  for (const p of project.programs) L.push(...programLines(p));
  for (const fb of fbs) L.push(...functionBlockLines(fb));
  for (const fn of fns) L.push(...functionLines(fn));
  L.push(`${INDENT}${INDENT}</GlobalNamespace>`);
  L.push(`${INDENT}</Types>`);

  // ---- Instances：Configuration / Resource(Main, prgFile) / GlobalVars / ProgramInstance ----
  L.push(`${INDENT}<Instances>`);
  L.push(`${INDENT}${INDENT}<Configuration name="config1">`);
  L.push(
    `${INDENT.repeat(3)}<Resource name="Main" resourceTypeName="prgFile">`,
  );
  const resPad = INDENT.repeat(4);
  // 执行类型：scan（循环执行）。官方样例中 "Main" 用 initial、"MainScan" 用 scan；
  // 实际项目程序必须循环执行，否则仿真/运行只执行一次（M2 仿真验证发现的真问题）。
  L.push(`${resPad}<AddData>`);
  L.push(
    `${resPad}${INDENT}<Data name="http://www.mitsubishielectric.com/xml/ResourceExecutionType" handleUnknown="implementation">`,
  );
  L.push(`${resPad}${INDENT}${INDENT}<ResourceExecutionType type="scan"/>`);
  L.push(`${resPad}${INDENT}</Data>`);
  L.push(`${resPad}</AddData>`);
  project.programs.forEach((p, i) => {
    L.push(
      `${resPad}<ProgramInstance name="${escapeXmlAttr(p.name)}" typeName="pou" evaluationOrder="${i + 1}"/>`,
    );
  });
  L.push(`${INDENT.repeat(3)}</Resource>`);
  // 全局标签：官方样例确认位于 Configuration 下、Resource 之后（不在 Resource 内）。
  // 按 (constant, retain) 分组：锁存区地址（如 FX5U 的 D200 以上）必须用 retain=true 的 VAR_GLOBAL_RETAIN 组，
  // 否则 GX Works3 编译报 0x11021040。
  const globalGroups = groupGlobalVars(project.globalVars ?? []);
  if (globalGroups.length === 0) {
    // 没有任何全局变量时仍保留一个空的普通组，保持输出骨架稳定（与官方样例的工程结构一致）。
    globalGroups.push({ constant: false, retain: false, vars: [] });
  }
  for (const group of globalGroups) {
    L.push(
      `${INDENT.repeat(3)}<GlobalVars constant="${group.constant}" retain="${group.retain}">`,
    );
    for (const g of group.vars) L.push(...varLines(g, 4));
    L.push(`${INDENT.repeat(3)}</GlobalVars>`);
  }
  L.push(`${INDENT}${INDENT}</Configuration>`);
  L.push(`${INDENT}</Instances>`);
  L.push('</Project>');
  return L.join('\n') + '\n';
}

/** 生成并写入 UTF-8 XML 文件（自动创建父目录）。 */
export function writeIecXmlFile(project: IecXmlProject, filePath: string): void {
  const xml = emitIecXml(project);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, xml, { encoding: 'utf8' });
}
