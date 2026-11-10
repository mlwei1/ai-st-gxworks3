/**
 * 修复循环骨架（M1）。
 *
 * 设计目标：把「生成 → 诊断 → 带着诊断重新生成」抽象成可测试的循环，
 * 供后续接入 LLM 修复或模板重选使用。
 *
 * - 本模块不依赖 spec / 模板 / LLM，只负责循环控制、反馈文本与历史记录；
 * - 具体的「生成器」由调用方提供（模板生成 / LLM 生成 / 模板重选）；
 * - 诊断通过字符串反馈给下一轮，格式与 `docs/整体方案.md` 的 diagnostics 一致。
 */

export interface DiagnosticLike {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  line?: number;
  column?: number;
  pou?: string;
  hint?: string;
}

/** 一轮尝试的结果。 */
export interface RepairAttemptResult<T> {
  output: T;
  diagnostics: DiagnosticLike[];
}

/** 一轮尝试记录。 */
export interface RepairAttempt<T> extends RepairAttemptResult<T> {
  attempt: number;
  /** 本轮开始前收到的反馈（第一轮为空）。 */
  feedback: string;
  elapsedMs: number;
}

export interface RepairLoopOptions<T> {
  /** 最大尝试次数（含首次），默认 3。 */
  maxAttempts?: number;
  /** 首轮就带上的初始反馈（如 GX Works3 编译错误），默认空串。 */
  initialFeedback?: string;
  /**
   * 生成器：第 attempt 轮（1 起）调用；
   * feedback 是上一轮诊断的格式化文本，首轮为空字符串（或 initialFeedback）。
   */
  generate: (attempt: number, feedback: string) => Promise<RepairAttemptResult<T>> | RepairAttemptResult<T>;
  /** 判定成功；默认「无 error 级诊断」即成功。 */
  isSuccess?: (diagnostics: DiagnosticLike[]) => boolean;
  /** 每轮结束回调（便于日志/测试）。 */
  onAttempt?: (attempt: RepairAttempt<T>) => void;
}

export interface RepairLoopResult<T> {
  ok: boolean;
  result: T;
  diagnostics: DiagnosticLike[];
  attempts: RepairAttempt<T>[];
}

/** 默认成功判定：没有 error 级诊断。 */
export function hasNoErrors(diagnostics: DiagnosticLike[]): boolean {
  return !diagnostics.some((d) => d.severity === 'error');
}

/** 把诊断格式化成可回灌给生成器的文本（一行一条，带位置/规则号）。 */
export function formatDiagnosticsForFeedback(s: DiagnosticLike): string {
  const loc = s.line != null ? `:${s.line}${s.column != null ? `:${s.column}` : ''}` : '';
  const pou = s.pou ? ` [${s.pou}]` : '';
  const hint = s.hint ? `\n    提示: ${s.hint}` : '';
  return `${s.severity.toUpperCase()} ${s.code}${loc}${pou} ${s.message}${hint}`;
}

/** 只把 error（可选含 warning）反馈给生成器，避免噪音。 */
export function buildFeedback(diagnostics: DiagnosticLike[], includeWarnings = false): string {
  const picked = diagnostics.filter(
    (d) => d.severity === 'error' || (includeWarnings && d.severity === 'warning'),
  );
  if (picked.length === 0) return '';
  return picked.map(formatDiagnosticsForFeedback).join('\n');
}

/**
 * 运行修复循环。
 *
 * 返回最后一轮的结果（无论成功失败），并附带全部尝试记录；
 * 调用方可根据 `ok` 决定是否进入编译/仿真阶段。
 */
export async function runRepairLoop<T>(options: RepairLoopOptions<T>): Promise<RepairLoopResult<T>> {
  const maxAttempts = options.maxAttempts ?? 3;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error(`maxAttempts 必须是正整数，收到 ${maxAttempts}`);
  }
  const isSuccess = options.isSuccess ?? hasNoErrors;
  const attempts: RepairAttempt<T>[] = [];
  let feedback = options.initialFeedback ?? '';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const started = Date.now();
    const { output, diagnostics } = await options.generate(attempt, feedback);
    const record: RepairAttempt<T> = {
      attempt,
      feedback,
      output,
      diagnostics,
      elapsedMs: Date.now() - started,
    };
    attempts.push(record);
    options.onAttempt?.(record);

    if (isSuccess(diagnostics)) {
      return { ok: true, result: output, diagnostics, attempts };
    }
    feedback = buildFeedback(diagnostics);
    // 如果诊断无法形成有效反馈（例如只有 info），再重试也难有价值，提前结束。
    if (feedback.length === 0) {
      return { ok: false, result: output, diagnostics, attempts };
    }
  }

  const last = attempts[attempts.length - 1];
  return { ok: false, result: last.output, diagnostics: last.diagnostics, attempts };
}
