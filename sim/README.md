# 仿真场景（M2）

GX Simulator3 没有公开的读写 API，当前采用**半自动**方式：

1. `sim/<name>.sim.json`：场景（写什么输入、期望什么输出）；
2. 在 GX Works3 仿真中按清单操作（批监视写输入、读输出）；
3. `sim/<name>.obs.json`：把每步读到的值填进去；
4. `ai-st-gxworks3 sim <scenario> --observed <obs>` 断言并生成 `report.json`。

## 文件格式

场景（`motor_start_stop.sim.json`）：

```json
{
  "name": "motor_start_stop_sim",
  "spec": "bench/b_motor_start_stop.json",
  "cpu": "FX5U",
  "program": { "resource": "MAIN", "name": "Main" },
  "steps": [
    { "name": "按下启动 X0=1", "set": { "X0": 1 }, "waitMs": 500, "expect": { "Y0": 1 } },
    { "name": "松开启动 X0=0（自锁保持）", "set": { "X0": 0 }, "waitMs": 500, "expect": { "Y0": 1 } }
  ]
}
```

观测（`motor_start_stop.obs.json`）：

```json
{
  "scenario": "motor_start_stop_sim",
  "steps": [
    { "step": 1, "values": { "Y0": 1 } },
    { "step": 2, "values": { "Y0": 1 } }
  ]
}
```

## 已跑通的例子

- `motor_start_stop.sim.json` + `motor_start_stop.obs.json`：4 步全部 PASS
  （启动 → 自锁 → 停止 → 保持停机），证据见
  `docs/evidence/M2/02-sim-scenario/`。

## GX Works3 仿真操作要点（批监视）

- `在线 → 监视 → 设备/缓冲存储器批量监视`，输入起始设备（如 `X0`）回车，再点
  `Start Monitoring`；
- 表格列是位 `7..0`（八进制设备中 `X1` 在 `X0` 行的“1”列，不是另一行）；
- 双击位单元格 → 输入 `1/0` → 回车 完成写入；写后建议切到输出设备重新监视读取；
- 自锁回路注意：`X0=0` 不会停机，需要写 `X1=1` 停止。
