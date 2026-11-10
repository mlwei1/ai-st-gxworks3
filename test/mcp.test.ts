/**
 * M3 MCP Server：stdio JSON-RPC 握手、工具清单、工具调用。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';

interface ServerHandle {
  child: ReturnType<typeof spawn>;
  next: (timeoutMs?: number) => Promise<string>;
  send: (msg: unknown) => void;
}

function startMcpServer(): ServerHandle {
  const child = spawn(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', 'src/cli.ts', 'mcp'],
    { cwd: resolve('.'), stdio: ['pipe', 'pipe', 'pipe'] },
  );
  const rl = createInterface({ input: child.stdout! });
  const queue: string[] = [];
  const waiters: Array<(line: string) => void> = [];
  rl.on('line', (line) => {
    const w = waiters.shift();
    if (w) w(line);
    else queue.push(line);
  });
  return {
    child,
    next: (timeoutMs = 15000) =>
      new Promise<string>((res, rej) => {
        if (queue.length > 0) {
          res(queue.shift()!);
          return;
        }
        const timer = setTimeout(() => {
          const idx = waiters.indexOf(handler);
          if (idx >= 0) waiters.splice(idx, 1);
          rej(new Error('等待 MCP 响应超时'));
        }, timeoutMs);
        const handler = (line: string): void => {
          clearTimeout(timer);
          res(line);
        };
        waiters.push(handler);
      }),
    send: (msg: unknown) => {
      child.stdin!.write(`${JSON.stringify(msg)}\n`);
    },
  };
}

test('mcp: initialize → tools/list → st_check → shutdown', async () => {
  const server = startMcpServer();
  try {
    server.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
    });
    const init = JSON.parse(await server.next()) as {
      result: { protocolVersion: string; serverInfo: { name: string }; capabilities: { tools: unknown } };
    };
    assert.equal(init.result.serverInfo.name, 'ai-st-gxworks3');
    assert.equal(init.result.protocolVersion, '2024-11-05');
    assert.ok(init.result.capabilities.tools);

    server.send({ jsonrpc: '2.0', method: 'notifications/initialized' });

    server.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const list = JSON.parse(await server.next()) as { result: { tools: Array<{ name: string; inputSchema: unknown }> } };
    const names = list.result.tools.map((t) => t.name).sort();
    assert.deepEqual(names, ['deliver', 'sim_validate', 'spec_generate', 'st_build_xml', 'st_check']);
    for (const tool of list.result.tools) assert.ok(tool.inputSchema);

    server.send({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'st_check', arguments: { path: 'examples/motor_demo.st' } },
    });
    const call = JSON.parse(await server.next()) as {
      result: { content: Array<{ type: string; text: string }>; isError?: boolean };
    };
    const payload = JSON.parse(call.result.content[0].text) as { ok: boolean; errorCount: number };
    assert.equal(payload.ok, true);
    assert.equal(payload.errorCount, 0);

    server.send({ jsonrpc: '2.0', id: 4, method: 'shutdown' });
    const shutdown = JSON.parse(await server.next()) as { id: number; result: unknown };
    assert.equal(shutdown.id, 4);
    server.send({ jsonrpc: '2.0', method: 'exit' });
  } finally {
    server.child.kill('SIGKILL');
  }
});

test('mcp: tools/call 未知工具返回 JSON-RPC 错误', async () => {
  const server = startMcpServer();
  try {
    server.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    await server.next();
    server.send({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'no_such_tool', arguments: {} },
    });
    const resp = JSON.parse(await server.next()) as { error?: { code: number; message: string } };
    assert.ok(resp.error);
    assert.equal(resp.error!.code, -32602);
  } finally {
    server.child.kill('SIGKILL');
  }
});
