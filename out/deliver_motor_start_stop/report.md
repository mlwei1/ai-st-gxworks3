# 交付报告：电机启停控制（启动/停止/故障联锁）

- 工程名：`motor_start_stop`
- CPU：FX5U / FX5U-32MT/ES
- 模板：`motor_start_stop`（生成方式：template）
- 生成时间：2026-11-10T15:16:43.725Z
- 交付状态：**PASS**（需求 5/5 通过）
- 仿真报告：PASS（不一致 0 处，见 `evidence/sim-report.json`）

## 1. 交付文件

| 文件 | 说明 |
|---|---|
| `artifacts/*.st` | ST 源码（人工审查主文件） |
| `artifacts/*.xml` | IEC 61131-10 工程包（GX Works3 导入） |
| `artifacts/*.csv` | 标签表（备选导入通道） |
| `artifacts/manifest.json` | 生成记录（spec/模板/诊断） |
| `trace.json` | 需求追溯矩阵（机读） |
| `delivery.json` | 交付清单 + SHA256 |
| `evidence/*` | 仿真报告 / GX 编译证据副本 |

## 2. 需求追溯矩阵

| 需求 | 内容 | 软元件 | 本地检查 | 仿真 | 原生编译 |
|---|---|---|---|---|---|
| R1 | 按下启动按钮 X0 后，电机输出 Y0 置 ON 并自保持 | X0:bStart<br>Y0:bMotor | pass | pass | not-run |
| R2 | 按下停止按钮 X1 时，电机输出 Y0 立即 OFF | X1:bStop<br>Y0:bMotor | pass | pass | not-run |
| R3 | 故障信号 X2 为 ON 时，Y0 立即 OFF 且不允许再启动 | X2:bFault<br>Y0:bMotor | pass | pass | not-run |
| R4 | 故障消失后需重新按下启动按钮方可再次运行 | — | pass | pass | not-run |
| R5 | 连续运行达到 autoStopSeconds 秒后自动停止（模板参数） | — | pass | pass | not-run |

## 3. 验证状态

- 本地检查：✓ 通过（0 error）
- 警告：0 条
- 编译/导入证据：见 evidence/

## 4. 诊断摘要

- error：0 条
- warning：0 条

## 5. 导入 GX Works3

1. 打开已配置 FX5U CPU 参数/任务的 GX Works3 工程（推荐模板工程）；
2. 工程 → 导入 → IEC61131-10 XML 格式 → 选择 `artifacts/*.xml`；
3. 转换 → 全部转换，确认 Error 0；
4. 需要时钟/扫描设置时按工程模板核对（生成的程序执行类型为 scan）。

## 6. 人工审查点

- [ ] IO 表与现场接线一致（设备地址、常开/常闭）；
- [ ] 需求条款与 ST 逻辑逐条对照（见 trace.json）；
- [ ] 安全/联锁回路由人工复核（本工具不做安全 PLC 逻辑）；
- [ ] 现场联调前先在 GX Simulator3 跑仿真场景。
