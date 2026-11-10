# 机器人 / 手写 ST 示例

| 文件 | 说明 |
|---|---|
| `robot_transfer.st` | 搬运机械手（**定时步进版**）：启动后竖直下降→夹紧→上升→右移→下降→松开→上升→左移，每步固定时间，适合演示和初调 |
| `robot_transfer_sensors.st` | 搬运机械手（**传感器到位版**）：每步由下降/夹紧/上升/右限位/左限位/松开到位信号推进，带每步 5 秒超时故障 |

两份都已通过 `check`（语法 + 三菱方言，0 error）。

## IO 约定

| 设备 | 含义 | 设备 | 含义 |
|---|---|---|---|
| X0 | 启动（上升沿） | X1 | 停止 |
| X2 | 故障/急停 | | |
| X10 | 下降到位 | X11 | 夹紧到位 |
| X12 | 上升到位 | X13 | 右限位 |
| X14 | 左限位 | X15 | 松开到位 |
| Y0 | 竖直下降阀 | Y1 | 竖直上升阀 |
| Y2 | 夹爪阀（ON=夹紧） | Y3 | 水平右移阀 |
| Y4 | 水平左移阀 | Y5 | 故障报警灯（传感器版） |

> 若现场是单线圈弹簧复位阀：删去 Y1 / Y4 赋值，对应动作靠断电磁阀弹回（文件末尾有注释说明）。

## 生成 GX Works3 可导入的 XML

```bash
node --experimental-strip-types --no-warnings src/cli.ts build-xml examples\robot_transfer.st -o out\robot_transfer
node --experimental-strip-types --no-warnings src/cli.ts build-xml examples\robot_transfer_sensors.st -o out\robot_transfer_sensors
```

## 真实 GX Works3 验证（定时版）

- 用模板工程导入 `out/robot_transfer/robot_transfer.xml`：XML Import **Error 0 / Warning 0**；
- Rebuild All (Reassignment)：**Error 0 / Warning 0**；
- 导入的 POU `Main` 注册在 `Scan → MAIN` 下。

证据截图：[docs/evidence/examples/robot_transfer/](docs/evidence/examples/robot_transfer/)。
