# MODBUS 模板（modbus_read）

> 第三个工业场景模板：**FX5U 作为 MODBUS 串行主站读取从站寄存器**（ADPRW 指令的 ST 形态）。
> 指令 ST 形式已通过 GX Works3 原生编译验证（Error:0），实际从站通信需实机验证。

## 1. 用法

```bash
node --experimental-strip-types --no-warnings src/cli.ts gen specs/modbus_read.json -o out/modbus_read
```

示例 spec：[specs/modbus_read.json](../specs/modbus_read.json)

```json
"template": {
  "name": "modbus_read",
  "params": { "slave": 1, "func": 3, "addr": 0, "count": 4, "timeoutMs": 3000 }
}
```

| 参数 | 含义 | 默认 / 范围 |
|---|---|---|
| `slave` | 从站站号 | 1（1..247） |
| `func` | 功能码：3=读保持寄存器(03H)、4=读输入寄存器(04H) | 3 |
| `addr` | 起始寄存器地址 | 0（0..32767） |
| `count` | 读取数量 | 1（1..125，MODBUS 03H/04H 标准上限） |
| `timeoutMs` | 通信超时 | 3000（100..10000ms） |

IO 约定（`spec.io` 顺序）：

| 角色 | 默认设备 | 说明 |
|---|---|---|
| 启动 | X0 | 上升沿触发一次读取 |
| 复位 | X1 | 清除完成/异常 |
| 通信中 | Y0 | 请求进行中 |
| 正常结束 | Y1 | 读取成功（1 个扫描） |
| 异常结束 | Y2 | 从站异常或超时 |
| 数据区 | 第一个 D（D100） | 读入的寄存器数据（count 个字） |
| 状态位 | 第一个 M（M100） | M100=执行中、M101=正常结束、M102=异常结束 |

## 2. 生成逻辑（节选）

```st
// 启动：X0 上升沿触发一次读取
IF X0 AND NOT bStartLast AND NOT bReq THEN
    bReq := TRUE;
END_IF;
bStartLast := X0;

// MODBUS 读取：ENO := ADPRW(EN, s1站号, s2功能码, s3地址, s4数量, s5数据区, d2状态位)
IF bReq THEN
    bEno := ADPRW(TRUE, nSlave, nFunc, nAddr, nCount, D100, M100);

    IF M101 THEN          // 正常结束
        bReq := FALSE;
        bDone := TRUE;
    END_IF;
    IF M102 THEN          // 异常结束
        bReq := FALSE;
        bErr := TRUE;
    END_IF;

    tTimeout(IN := bReq, PT := T#3000ms);   // 超时保护
    IF tTimeout.Q THEN
        bReq := FALSE;
        bErr := TRUE;
    END_IF;
END_IF;
```

## 3. 验证记录

| 项目 | 结果 |
|---|---|
| 方言检查（`gen`） | ✅ 0 error |
| IEC XML XSD 校验 | ✅ PASS |
| **GX Works3 导入 + 全部转换** | ✅ **Error:0 Warning:0**（证据 `docs/evidence/M3/09-modbus-template-gx-compile.png`） |
| ADPRW ST 7 参形式独立探针 | ✅ Error:0（`docs/evidence/M3/08-adprw-gx-compile.png`） |
| 实际从站通信 | ⏳ 需 RS-485 实机或支持 MODBUS 的仿真环境 |

## 4. 使用前提

1. **模块参数**：在 GX Works3 的 CPU 模块参数中把 RS-485 通道配置为 MODBUS 主站协议，
   并设置波特率/数据位/校验/停止位（从站参数需一致）；
2. **状态位区**：M100~M102 三个点不能被其他逻辑占用；
3. **数据区**：D100 起 count 个字为读取结果，注意不要与程序其他数据重叠；
4. **轮询/重试**：本模板是“触发一次读取”，需要周期轮询时由用户按节拍触发 X0，
   或在程序里加定时器周期置位；从站通信失败会置 Y2，重试请按 X1 复位后再次触发；
5. **安全**：通信相关联锁不要只依赖 MODBUS，必须有硬接线安全回路。

## 5. 相关文件

- 模板实现：`src/templates/modbus_read.ts`
- 测试：`test/modbus.test.ts`（生成内容/参数覆盖/非法参数）
- 通信指令知识：`docs/RAG/知识要点-通信.md`
- 全局变量/状态位说明见生成文件头部注释。
