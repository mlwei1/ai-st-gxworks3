/**
 * 内置 MCP Server（M3，零依赖实现）。
 *
 * 传输：stdio，换行分隔的 JSON-RPC 2.0（MCP 规范）。
 * 支持：initialize / notifications/initialized / ping / tools/list / tools/call / shutdown / exit。
 *
 * 工具：
 *   st_check       ST 静态检查（语法 + 三菱方言）
 *   spec_generate  spec → ST + IEC XML 工程包（同 CLI `gen`）
 *   st_build_xml   ST 文件 → IEC 61131-10 XML + 标签 CSV
 *   sim_validate   仿真场景 + 观测文件断言（同 CLI `sim --observed`）
 *   deliver        生成交付工程包（report.md + trace.json + SHA256）
 *
 * 注意：stdout 只能输出 JSON-RPC 消息，调试信息一律走 stderr。
 */

import { createInterface } from 'node:readline';

import { buildXmlFromStFile } from '../pipeline/build.ts';
import { deliverFromSpec } from '../deliver/index.ts';
import { generateFromSpec } from '../gen/generate.ts';
import { runScenarioWithObservations, validateScenario } from '../sim/index.ts';
import { analyzeST } from '../dialect/analyzer.ts';
import { parseWithRecovery } from '../dialect/recovery.ts';

export const MCP_SERVER_INFO = { name: 'ai-st-gxworks3', version: '0.1.0' };

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const obj = (props: Record<string, unknown>, required: string[] = []): Record<string, unknown> => ({
  type: 'object',
  properties: props,
  required,
  additionalProperties: false,
});

export const MCP_TOOLS: McpTool[] = [
  {
    name: 'st_check',
    description: '校验 ST 文件（语法 + 三菱 FX5U 方言），返回诊断列表。',
    inputSchema: obj({ path: { type: 'string', description: 'ST 文件路径' } }, ['path']),
  },
  {
    name: 'spec_generate',
    description: '从 RequirementSpec JSON 生成 ST + IEC 61131-10 XML 工程包（模板优先，可选 LLM）。',
    inputSchema: obj({
      specPath: { type: 'string', description: 'spec JSON 路径' },
      outDir: { type: 'string', description: '输出目录（可选）' },
      useLlm: { type: 'boolean', description: '启用 LLM 兜底（可选）' },
    }, ['specPath']),
  },
  {
    name: 'st_build_xml',
    description: 'ST 文件 → IEC 61131-10 XML（可直接导入 GX Works3）+ 标签 CSV。',
    inputSchema: obj({
      path: { type: 'string', description: 'ST 文件路径' },
      outDir: { type: 'string', description: '输出目录（可选）' },
      projectName: { type: 'string', description: '工程/内容名（可选）' },
    }, ['path']),
  },
  {
    name: 'sim_validate',
    description: '仿真场景校验 + 观测文件断言；返回 PASS/FAIL 与不一致明细。',
    inputSchema: obj({
      scenarioPath: { type: 'string', description: '场景 JSON 路径' },
      observedPath: { type: 'string', description: '观测 JSON 路径（可选；缺省只校验场景）' },
    }, ['scenarioPath']),
  },
  {
    name: 'deliver',
    description: '生成交付工程包：ST/XML/标签 + report.md + trace.json 需求追溯矩阵 + SHA256。',
    inputSchema: obj({
      specPath: { type: 'string', description: 'spec JSON 路径' },
      outDir: { type: 'string', description: '交付包目录（可选）' },
      simReportPath: { type: 'string', description: '仿真 report.json（可选）' },
      nativeEvidencePaths: {
        type: 'array',
        items: { type: 'string' },
        description: 'GX 编译/导入证据文件路径列表（可选）',
      },
    }, ['specPath']),
  },
];

export interface McpServerOptions {
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
}

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function okResponse(id: JsonRpcRequest['id'], result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function errorResponse(id: JsonRpcRequest['id'], code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function textResult(text: string, isError = false): unknown {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) };
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'st_check': {
      const path = String(args.path ?? '');
      const source = await (await import('node:fs/promises')).readFile(path, 'utf8');
      const { ast, errors } = parseWithRecovery(source);
      const diagnostics = [
        ...errors.map((e) => ({ severity: 'error' as const, code: 'PARSE', message: e.message, line: e.line })),
        ...analyzeST(ast, { target: 'FX5U' }),
      ];
      const errorsCount = diagnostics.filter((d) => d.severity === 'error').length;
      return textResult(
        JSON.stringify({ path, ok: errorsCount === 0, errorCount: errorsCount, diagnostics }, null, 2),
        errorsCount > 0,
      );
    }
    case 'spec_generate': {
      const r = await generateFromSpec(String(args.specPath ?? ''), {
        outDir: args.outDir ? String(args.outDir) : undefined,
        useLlm: args.useLlm === true,
      });
      const summary = {
        ok: r.ok,
        specPath: r.specPath,
        outDir: r.outDir,
        template: r.templateName ?? null,
        generator: r.generator ?? null,
        stPath: r.stPath ?? null,
        xmlPath: r.xmlPath ?? null,
        labelFiles: r.labelFiles ?? [],
        errors: [...r.specDiagnostics, ...r.diagnostics].filter((d) => d.severity === 'error'),
        warnings: r.warnings,
      };
      return textResult(JSON.stringify(summary, null, 2), !r.ok);
    }
    case 'st_build_xml': {
      const r = await buildXmlFromStFile(String(args.path ?? ''), {
        outDir: args.outDir ? String(args.outDir) : undefined,
        projectName: args.projectName ? String(args.projectName) : undefined,
      });
      return textResult(
        JSON.stringify(
          {
            ok: r.ok,
            stPath: r.stPath,
            xmlPath: r.xmlPath ?? null,
            labelFiles: r.labelFiles,
            diagnostics: r.diagnostics,
            warnings: r.warnings,
          },
          null,
          2,
        ),
        !r.ok,
      );
    }
    case 'sim_validate': {
      const { readFile } = await import('node:fs/promises');
      const scenario = JSON.parse(await readFile(String(args.scenarioPath ?? ''), 'utf8'));
      const v = validateScenario(scenario);
      if (!v.ok || !v.scenario || v.diagnostics.length > 0) {
        return textResult(JSON.stringify({ ok: false, diagnostics: v.diagnostics }, null, 2), true);
      }
      if (!args.observedPath) {
        return textResult(JSON.stringify({ ok: true, scenario: scenario.name, steps: scenario.steps.length, mode: 'validate-only' }, null, 2));
      }
      const observedRaw = JSON.parse(await readFile(String(args.observedPath), 'utf8'));
      const r = runScenarioWithObservations(scenario, observedRaw);
      return textResult(JSON.stringify({ ok: r.ok, report: r }, null, 2), !r.ok);
    }
    case 'deliver': {
      const r = await deliverFromSpec({
        specPath: String(args.specPath ?? ''),
        outDir: args.outDir ? String(args.outDir) : undefined,
        simReportPath: args.simReportPath ? String(args.simReportPath) : undefined,
        nativeEvidencePaths: Array.isArray(args.nativeEvidencePaths)
          ? (args.nativeEvidencePaths as string[])
          : undefined,
      });
      return textResult(
        JSON.stringify(
          {
            ok: r.ok,
            outDir: r.outDir,
            reportPath: r.reportPath,
            tracePath: r.tracePath,
            deliveryPath: r.deliveryPath,
            summary: r.summary,
            files: r.files,
          },
          null,
          2,
        ),
        !r.ok,
      );
    }
    default:
      throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32602 });
  }
}

/** 处理单条 JSON-RPC 请求；返回 null 表示不需要响应（通知）。 */
export async function handleMcpMessage(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  const method = req.method ?? '';
  const id = req.id ?? null;
  if (method === 'notifications/initialized' || method.startsWith('notifications/')) return null;
  if (method === 'exit') return null;

  switch (method) {
    case 'initialize': {
      const params = (req.params ?? {}) as { protocolVersion?: string };
      return okResponse(id, {
        protocolVersion: params.protocolVersion ?? '2024-11-05',
        capabilities: { tools: { listChanged: false } },
        serverInfo: MCP_SERVER_INFO,
      });
    }
    case 'ping':
      return okResponse(id, {});
    case 'tools/list':
      return okResponse(id, { tools: MCP_TOOLS });
    case 'tools/call': {
      const params = (req.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
      if (!params.name) return errorResponse(id, -32602, 'Missing tool name');
      try {
        const result = await callTool(params.name, params.arguments ?? {});
        return okResponse(id, result);
      } catch (e) {
        const err = e as Error & { code?: number };
        return errorResponse(id, err.code ?? -32000, err.message);
      }
    }
    case 'shutdown':
      return okResponse(id, {});
    default:
      return errorResponse(id, -32601, `Method not found: ${method}`);
  }
}

/** 启动 stdio MCP 服务（阻塞直到 stdin 关闭或收到 exit）。 */
export async function runMcpServer(options: McpServerOptions = {}): Promise<void> {
  const input = options.stdin ?? process.stdin;
  const output = options.stdout ?? process.stdout;
  const rl = createInterface({ input, crlfDelay: Infinity });

  let shuttingDown = false;
  const write = (msg: JsonRpcResponse): void => {
    output.write(`${JSON.stringify(msg)}\n`);
  };

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let req: JsonRpcRequest;
    try {
      req = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      write(errorResponse(null, -32700, 'Parse error'));
      continue;
    }
    const messages = Array.isArray(req) ? (req as unknown as JsonRpcRequest[]) : [req];
    for (const m of messages) {
      try {
        const resp = await handleMcpMessage(m);
        if (resp) write(resp);
        if (m.method === 'shutdown') shuttingDown = true;
        if (m.method === 'exit') {
          rl.close();
          return;
        }
      } catch (e) {
        write(errorResponse(m.id ?? null, -32603, e instanceof Error ? e.message : String(e)));
      }
    }
    if (shuttingDown) {
      // 标准流程：shutdown 后等 exit 通知；没有则允许继续读，但不再处理新请求
      continue;
    }
  }
}
