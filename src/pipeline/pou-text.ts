/**
 * 从 ST 源文件提取各 POU 的正文文本（保留注释与格式）。
 *
 * 目的：IEC XML 的 `<ST>` 正文默认由 unparser 从 AST 重新生成，语句级注释会丢失；
 * 若源文件在手，可直接截取原始正文，让 GX 导入后仍能看到注释。
 *
 * 规则（面向 GX ST 的常规写法，不做完整语法分析）：
 *  - POU 起始：行首 `PROGRAM|FUNCTION_BLOCK|FUNCTION name`
 *  - 正文起点：POU 内最后一个 `END_VAR` 之后；没有 VAR 段时从 POU 头之后开始
 *  - POU 结束：行首 `END_PROGRAM|END_FUNCTION_BLOCK|END_FUNCTION`
 *  - 正文保留原始缩进/注释；去掉首尾空行
 */

const POU_START = /^\s*(PROGRAM|FUNCTION_BLOCK|FUNCTION)\s+([A-Za-z_][A-Za-z0-9_]*)/;
const POU_END = /^\s*END_(PROGRAM|FUNCTION_BLOCK|FUNCTION)\b/;
const VAR_START = /^\s*VAR(_[A-Z_]+)?\b/;
const VAR_END = /^\s*END_VAR\b/;

/** 提取 source 中每个 POU 的正文；返回 POU 名 → 正文文本。 */
export function extractPouBodies(source: string): Map<string, string> {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const bodies = new Map<string, string>();

  let headerIndex = -1;
  let pouName = '';
  let inVar = false;
  let lastEndVar = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (headerIndex < 0) {
      const m = line.match(POU_START);
      if (m) {
        headerIndex = i;
        pouName = m[2];
        inVar = false;
        lastEndVar = -1;
      }
      continue;
    }

    if (POU_END.test(line)) {
      const start = lastEndVar >= 0 ? lastEndVar + 1 : headerIndex + 1;
      const body = lines
        .slice(start, i)
        .join('\n')
        .replace(/^\n+/, '')
        .replace(/\n+$/, '');
      bodies.set(pouName, body);
      headerIndex = -1;
      pouName = '';
      inVar = false;
      lastEndVar = -1;
      continue;
    }

    if (!inVar && VAR_START.test(line)) {
      inVar = true;
      continue;
    }
    if (inVar && VAR_END.test(line)) {
      inVar = false;
      lastEndVar = i;
      continue;
    }
  }

  return bodies;
}
