# M3：交付工程包 与 MCP Server

M3 把工具链从「能生成」推进到「能交付、能被 Agent 调用」。

---

## 1. `deliver`：交付工程包

```bash
node --experimental-strip-types --no-warnings src/cli.ts deliver specs/motor_start_stop.json ^
  -o out/deliver_motor_start_stop ^
  --sim docs/evidence/M2/02-sim-scenario/report.json
```

产出目录结构：

```
out/deliver_motor_start_stop/
├── artifacts/
│   ├── motor_start_stop.st        # ST 源码（人工审查主文件）
│   ├── motor_start_stop.xml       # IEC 61131-10，GX Works3 导入
│   ├── Main_local_labels.csv      # 标签表（备选通道）
│   ├── manifest.json              # 生成记录
│   └── diagnostics.json           # 诊断
├── evidence/
│   └── sim-report.json            # 仿真报告副本（--sim 传入时）
├── report.md                      # 人读交付报告
├── trace.json                     # 机读需求追溯矩阵
└── delivery.json                  # 交付清单 + 每个文件的 SHA256
```

### report.md 内容

1. 基本信息（工程名、CPU、模板、生成方式、交付状态）
2. 交付文件说明
3. **需求追溯矩阵**：需求 ID / 内容 / 相关软元件 / 本地检查 / 仿真 / 原生编译
4. 验证状态（0 error、警告数、证据文件）
5. 失败诊断（FAIL 时逐条列出）
6. 导入 GX Works3 步骤
7. 人工审查点清单

### trace.json 字段

```json
{
  "trace": [
    {
      "id": "R1",
      "text": "按下启动按钮 X0 后，电机输出 Y0 置 ON 并自保持",
      "devices": ["X0", "Y0"],
      "io": ["X0:bStart", "Y0:bMotor"],
      "template": "motor_start_stop",
      "artifacts": ["artifacts/motor_start_stop.st", "artifacts/motor_start_stop.xml"],
      "localCheck": "pass",
      "sim": "pass",
      "nativeCompile": "not-run",
      "note": "本地检查通过，仿真场景通过"
    }
  ]
}
```

设计原则：**失败也产出报告**——生成/校验失败时 `report.md` 会标 FAIL 并列出诊断，
`delivery.json` 仍然记录产物与哈希，便于排查和归档。

### 参数

| 参数 | 说明 |
|---|---|
| `<spec.json>` | 需求规格（必填） |
| `-o, --out` | 交付包目录，默认 `out/deliver_<spec.name>` |
| `--sim <report.json>` | 仿真报告（`sim --observed` 产物），归档到 `evidence/` 并标记 sim 状态 |
| `--native-evidence a.png,b.png` | GX 编译/导入证据文件，逗号分隔，复制进 `evidence/` |
| `--target FX5U` | 覆盖 CPU 目标（透传 gen） |

---

## 2. `mcp`：内置 MCP Server

```bash
node --experimental-strip-types --no-warnings src/cli.ts mcp
```

- 传输：**stdio**，换行分隔的 JSON-RPC 2.0（MCP 规范）；
- 零依赖，仅用 Node 内置模块；
- 支持 `initialize` / `notifications/initialized` / `ping` / `tools/list` / `tools/call` / `shutdown` / `exit`。

### 工具清单

| 工具 | 作用 | 必填参数 |
|---|---|---|
| `st_check` | ST 语法 + 三菱方言检查 | `path` |
| `spec_generate` | spec → ST + IEC XML 工程包 | `specPath`（可选 `outDir`、`useLlm`） |
| `st_build_xml` | ST 文件 → IEC XML + 标签 CSV | `path`（可选 `outDir`、`projectName`） |
| `sim_validate` | 仿真场景校验 + 观测文件断言 | `scenarioPath`（可选 `observedPath`） |
| `deliver` | 生成交付工程包 | `specPath`（可选 `outDir`、`simReportPath`、`nativeEvidencePaths`） |

### 在 Agent 里挂载（示例）

```json
{
  "mcpServers": {
    "ai-st-gxworks3": {
      "command": "node",
      "args": [
        "--experimental-strip-types",
        "--no-warnings",
        "C:/path/to/ai_st_gxworks3/src/cli.ts",
        "mcp"
      ]
    }
  }
}
```

### 调用示例（JSON-RPC 行）

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"demo","version":"0"}}}
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"st_check","arguments":{"path":"examples/motor_demo.st"}}}
```

`tools/call` 返回：

```json
{"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"{\"ok\":true,\"errorCount\":0,...}"}]}}
```

工具出错时返回 `isError: true`，参数错误（未知工具）返回 JSON-RPC `-32602`。

---

## 3. 测试与 CI

- `test/deliver.test.ts`：交付包结构、追溯矩阵、SHA256、仿真证据归档、非法 spec FAIL 报告；
- `test/mcp.test.ts`：stdio 握手、工具清单（5 个）、`st_check` 调用、未知工具错误码；
- GitHub Actions：`.github/workflows/ci.yml`，Node 22 下跑全量 `npm test`。

---

## 4. 当前边界

- **原生编译状态**目前需人工/半自动提供证据（`--native-evidence`），MCP 不直接驱动 GX Works3 编译；
- 追溯矩阵是「需求 → 软元件 → 产物」的静态映射，**不代表逐条需求已被动态验证**；
  要看仿真是否真跑过，需传 `--sim`，`trace.json` 会标 `sim: pass/fail`；
- 工业场景知识库（手册 RAG、行业模板）按计划后置，不在本次 M3 范围内。
