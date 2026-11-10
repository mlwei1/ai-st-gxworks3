/**
 * 编译错误条目类型（独立文件，避免循环依赖）。
 */
export interface CompilerErrorEntry {
  /** 错误码：0x11021040 / C1200 / E009 等。 */
  code?: string;
  message: string;
  /** 行号（1 起，若可定位）。 */
  line?: number;
  column?: number;
  /** POU/程序名（若可定位）。 */
  pou?: string;
}
