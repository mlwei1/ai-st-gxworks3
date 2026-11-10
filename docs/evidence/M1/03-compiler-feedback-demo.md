# 编译诊断回灌演示（2026-11-10）

命令：
```
node --experimental-strip-types --no-warnings src/cli.ts gen bench/b_motor_start_stop.json \
  --llm --compiler-errors bench/compiler-errors.sample.json -o out/run1
```

样例错误文件 `bench/compiler-errors.sample.json`（2 条 GX Works3 错误）：
```json
[
  {
    "code": "0x11021040",
    "message": "标签分配在锁存区，但未声明 RETAIN",
    "line": 12,
    "pou": "Main"
  },
  {
    "message": "未定义的标识符 'bFault'",
    "line": 30,
    "pou": "Main"
  }
]
```

实际输出（本机未配置 ANTHROPIC_AUTH_TOKEN；LLM 失败后自动回退模板，不阻断确定性路径）：
```text
已读取 2 条 GX Works3 编译错误，将作为修复反馈。
▲ LLM 带着编译错误重生成未通过本地检查，回退模板生成。
▲ LLM LLM_E_CALL: 未配置 LLM 凭据。请设置环境变量 ANTHROPIC_BASE_URL 与 ANTHROPIC_AUTH_TOKEN。

✓ 生成成功: b_motor_start_stop（模板 motor_start_stop）
  回灌编译错误: 2 条
  生成尝试: 3 轮
  ST       : C:\Users\52900\AppData\Local\Temp\gxw3-m0\gen_cf_demo2\b_motor_start_stop.st
  IEC XML  : C:\Users\52900\AppData\Local\Temp\gxw3-m0\gen_cf_demo2\b_motor_start_stop.xml
  标签 CSV : 1 个
  manifest : C:\Users\52900\AppData\Local\Temp\gxw3-m0\gen_cf_demo2\manifest.json

导入步骤：
  1) 复制纯 ST 模板：copy templates\FX5U_ST_Template.gx3 %TEMP%\run.gx3
  2) GX Works3 打开副本 → 工程 → 导入 → IEC61131-10 XML格式 → 选上面的 XML
  3) 转换 → 全部转换，检查 Error/Warning
```

说明：
- 错误列表被解析（2 条），作为修复循环首轮反馈；
- LLM 不可用 → 明确告警并回退模板生成，产物照常输出；
- 配置 LLM 凭据后，同一命令会带着这些真实编译错误重新生成；
- `manifest.json` 的 `compilerDiagnostics` 保留本次回灌内容。
