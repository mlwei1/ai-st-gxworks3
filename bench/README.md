# 基准场景（Bench）

用于 M1 的**回归基准**：每个 spec 对应一个标准回路模板，`test/benchmark.test.ts` 会批量
`gen`（spec → 模板 → 解析/检查 → IEC XML）并断言全部通过。

| spec | 模板 | 覆盖点 |
|---|---|---|
| `b_motor_start_stop.json` | motor_start_stop | 启停/故障/复位自锁 |
| `b_motor_auto_stop.json` | motor_auto_stop | TON 延时自动停（autoStopSec=5） |
| `b_motor_reverse.json` | motor_reverse_interlock | 正反转互锁 + 换向死区 1s |
| `b_timer_sequence.json` | timer_sequence | 步数可配置（4 步） |
| `b_counter_batch.json` | counter_batch | 计数批量复位（batchSize=20） |
| `b_state_machine.json` | state_machine | CASE 状态机 + 非法状态保护 |
| `b_analog_scale.json` | analog_scale | 模拟量标定（400..2000 → 0..100） |
| `b_alarm_first_out.json` | alarm_first_out | 报警路数可配置（2 路首出） |

```bash
# 单个场景
node --experimental-strip-types --no-warnings src/cli.ts gen bench/b_motor_start_stop.json -o out/b_motor_start_stop

# 全量回归
node --experimental-strip-types --no-warnings --test test/benchmark.test.ts

# 真机验证（复制模板 → 导入 XML → 全部转换）
copy templates\FX5U_ST_Template.gx3 %TEMP%\run.gx3
```

> 基准只校验"能生成 + 本地检查通过 + XML 结构合法"；GX Works3 编译器结论仍需真机导入验证。
