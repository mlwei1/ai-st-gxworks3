/**
 * GX Works3 标签 CSV 生成器。
 *
 * 格式基准（由 GX Works3 1.128J 实际导出文件反推）：
 *   编码    UTF-16LE + BOM
 *   换行    LF
 *   分隔符  TAB（不是逗号！）
 *   引号    每个字段都带双引号，内部双引号写两个
 *
 *   第 1 行  工程名（未设置工程时为 "(工程未设置)"）
 *   第 2 行  表头
 *   第 3+ 行 数据
 *
 *   列（全局标签 30 列，局部标签 27 列）：
 *     类 | 标签名 | 数据类型 | 常数 | 初始值 | 分配(软元件/标签) | 地址 | 注释 | ...
 *
 *   「类」的值：全局标签 = VAR_GLOBAL，局部标签 = VAR，
 *   FB 形参 = VAR_INPUT / VAR_OUTPUT / VAR_IN_OUT
 *
 * 重要：标签**只能导入 CSV**（XML 仅支持导出），所以这是唯一的自动导入通道。
 */

import { type AST, type POU, type VarDeclaration } from '../dialect/ast.ts';

/** 全局标签的表头（30 列）。 */
export const GLOBAL_HEADER: string[] = [
  '类',
  '标签名',
  '数据类型',
  '常数',
  '初始值',
  '分配(软元件/标签)',
  '地址',
  '注释',
  '注释2',
  '注释3',
  '注释4',
  '注释5',
  'Japanese/日本語',
  'English',
  'Chinese Simplified/简体中文',
  'Korean/한국어',
  'Chinese Traditional/繁體中文',
  'German/Deutsch',
  'Italian/Italiano',
  'Reserved1',
  'Reserved2',
  'Reserved3',
  'Reserved4',
  '备注',
  '系统标签的关联',
  '系统标签名',
  '属性',
  '外部设备的访问',
];

/**
 * 局部标签的表头（27 列：类 … 属性）。
 */
export const LOCAL_HEADER: string[] = [
  '类',
  '标签名',
  '数据类型',
  '常数',
  '初始值',
  '分配(软元件/标签)',
  '地址',
  '注释',
  '注释2',
  '注释3',
  '注释4',
  '注释5',
  'Japanese/日本語',
  'English',
  'Chinese Simplified/简体中文',
  'Korean/한국어',
  'Chinese Traditional/繁體中文',
  'German/Deutsch',
  'Italian/Italiano',
  'Reserved1',
  'Reserved2',
  'Reserved3',
  'Reserved4',
  '备注',
  '系统标签的关联',
  '系统标签名',
  '属性',
];

/** 字段转义：加双引号，内部双引号翻倍。 */
function q(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * 把一行字段渲染成 TSV（每字段带引号）。
 */
function renderRow(fields: string[]): string {
  return fields.map(q).join('\t');
}

/**
 * 类型名规范化。
 *
 * 内置类型统一大写（BOOL/INT/REAL…），但**自定义类型必须保持原样**——
 * GX Works3 区分大小写，`ST_Motor` 写成 `ST_MOTOR` 会变成另一个不存在的类型。
 */
function csvTypeName(typeName: string): string {
  const bare = typeName.replace(/\[\d+\]/, '');
  const up = bare.toUpperCase();
  const BUILTIN = new Set([
    'BOOL', 'BYTE', 'WORD', 'DWORD', 'INT', 'UINT', 'DINT', 'UDINT',
    'LINT', 'ULINT', 'REAL', 'LREAL', 'TIME', 'STRING', 'WSTRING',
  ]);
  return BUILTIN.has(up) ? up : bare;
}

/** 初始值文本。 */
function initText(v: VarDeclaration): string {
  if (!v.initialValue) return '';
  return initialValueText(v);
}

/** 从 AST 表达式节点取字面量文本。 */
function initialValueText(v: VarDeclaration): string {
  const e = v.initialValue;
  if (!e) return '';
  if (e.kind === 'literal') {
    if (e.literalType === 'string') return e.value;
    if (e.literalType === 'boolean') return e.value;
    return e.value;
  }
  return '';
}

/** 局部标签的「类」值。 */
function localClass(v: VarDeclaration): string {
  switch (v.section) {
    case 'VAR_INPUT':
      return 'VAR_INPUT';
    case 'VAR_OUTPUT':
      return 'VAR_OUTPUT';
    case 'VAR_IN_OUT':
      return 'VAR_IN_OUT';
    case 'VAR_TEMP':
      return 'VAR_TEMP';
    default:
      return 'VAR';
  }
}

export interface CsvOptions {
  /** 工程名，写在第 1 行。未设置时用 "(工程未设置)"。 */
  projectName?: string;
}

/**
 * 生成**局部标签** CSV（一个 POU 一个文件）。
 *
 * 对应 GX Works3：程序/FB 右键 → 局部标签 → 导出至文件 → CSV。
 */
export function generateLocalLabelsCSV(
  pou: POU,
  options: CsvOptions = {},
): string {
  const lines: string[] = [];

  // 第 1 行：工程名
  lines.push(q(options.projectName ?? '(工程未设置)'));
  // 第 2 行：表头
  lines.push(renderRow(LOCAL_HEADER));

  // 数据行
  const vars = pou.vars.filter((v) => v.section !== 'VAR_GLOBAL');
  for (const v of vars) {
    const row: string[] = [];
    row.push(localClass(v));                       // 1 类
    row.push(v.name);                             // 2 标签名
    row.push(csvTypeName(v.typeName));             // 3 数据类型
    row.push(v.constant ? '1' : '');               // 4 常数
    row.push(initText(v));                         // 5 初始值
    row.push(v.address ?? '');                     // 6 分配(软元件/标签)
    row.push('');                                 // 7 地址
    row.push(v.comment ?? '');                     // 8 注释
    // 其余列补空到表头长度
    while (row.length < LOCAL_HEADER.length) row.push('');
    lines.push(renderRow(row));
  }

  return lines.join('\n') + '\n';
}

/**
 * 生成**全局标签** CSV。
 *
 * 对应 GX Works3：全局标签 → 右键 → 导出至文件 → CSV。
 */
export function generateGlobalLabelsCSV(
  globals: {
    name: string;
    typeName: string;
    address?: string;
    initialValue?: string;
    retain?: boolean;
    constant?: boolean;
    comment?: string;
  }[],
  options: CsvOptions = {},
): string {
  const lines: string[] = [];

  lines.push(q(options.projectName ?? '(工程未设置)'));
  lines.push(renderRow(GLOBAL_HEADER));

  for (const g of globals) {
    const row: string[] = [];
    row.push('VAR_GLOBAL');                        // 1 类
    row.push(g.name);                             // 2 标签名
    row.push(csvTypeName(g.typeName));             // 3 数据类型
    row.push(g.constant ? '1' : '');               // 4 常数
    row.push(g.initialValue ?? '');                // 5 初始值
    row.push(g.address ?? '');                     // 6 分配(软元件/标签)
    row.push('');                                 // 7 地址
    row.push(g.comment ?? '');                     // 8 注释
    // 补空到「属性」列
    while (row.length < GLOBAL_HEADER.length - 1) row.push('');
    // 最后一列「外部设备的访问」官方写 0
    row.push('0');
    lines.push(renderRow(row));
  }

  return lines.join('\n') + '\n';
}

/**
 * 编码为 UTF-16LE + BOM（GX Works3 导出的编码）。
 */
export function toUtf16LE(text: string): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from(text, 'utf16le'),
  ]);
}

/**
 * 从 AST 一次性生成全部标签 CSV 文件。
 */
export function generateLabelCsvFiles(
  ast: AST,
  options: CsvOptions = {},
): { name: string; content: Buffer }[] {
  const files: { name: string; content: Buffer }[] = [];

  for (const pou of ast.pous) {
    files.push({
      name: `${pou.name}_local_labels.csv`,
      content: toUtf16LE(generateLocalLabelsCSV(pou, options)),
    });
  }

  if (ast.globalVars.length > 0) {
    files.push({
      name: 'Global.csv',
      content: toUtf16LE(
        generateGlobalLabelsCSV(
          ast.globalVars.map((g) => ({
            name: g.name,
            typeName: g.typeName,
            address: g.address,
            initialValue: g.initialValue ? initialValueText(g) : undefined,
            retain: g.retain,
            constant: g.constant,
            comment: g.comment,
          })),
          options,
        ),
      ),
    });
  }

  return files;
}
