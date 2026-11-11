// ============================================================
// 模板：modbus_read
// 说明：MODBUS 主站读取（从站 1，03H 读保持寄存器）
// 规格：modbus_read_demo（CPU FX5U）
// 参数：slave=1，func=3，addr=0，count=4，timeoutMs=3000
// ============================================================

PROGRAM Main
VAR
    bStartLast : BOOL := FALSE;             // 启动信号上一扫描（上升沿）
    bReq : BOOL := FALSE;                   // 读取请求（通信中）
    bDone : BOOL := FALSE;                  // 正常结束标志
    bErr : BOOL := FALSE;                   // 异常结束/超时标志
    bEno : BOOL := FALSE;                   // ADPRW 执行结果
    nSlave : INT := 1;                      // 从站站号
    nFunc : INT := 3;                       // 功能码（03H 读保持寄存器）
    nAddr : INT := 0;                       // 起始寄存器地址
    nCount : INT := 4;                      // 读取寄存器数量
    tTimeout : TON;                         // 通信超时（3000ms）
END_VAR
    // 1) 复位（X1）：清除请求/完成/异常
    IF X1 THEN
        bReq := FALSE;
        bDone := FALSE;
        bErr := FALSE;
    END_IF;

    // 2) 启动（X0 上升沿）：触发一次读取
    IF X0 AND NOT bStartLast AND NOT bReq THEN
        bReq := TRUE;
        bDone := FALSE;
        bErr := FALSE;
    END_IF;
    bStartLast := X0;

    // 3) MODBUS 读取（功能码 03H 读保持寄存器）：ENO := ADPRW(EN, s1, s2, s3, s4, s5, d2)
    //    s1=站号1, s2=功能码3, s3=起始地址0, s4=数量4,
    //    s5=读数据区 D100，d2=状态位 M100/M101/M102
    IF bReq THEN
        bEno := ADPRW(TRUE, nSlave, nFunc, nAddr, nCount, D100, M100);

        // 4) 正常结束（状态位 M101 ON，ON 持续 1 个扫描）
        IF M101 THEN
            bReq := FALSE;
            bDone := TRUE;
        END_IF;

        // 5) 异常结束（状态位 M102 ON）
        IF M102 THEN
            bReq := FALSE;
            bErr := TRUE;
        END_IF;

        // 6) 超时监控：3000ms 内未结束判通信异常
        tTimeout(IN := bReq, PT := T#3000ms);
        IF tTimeout.Q THEN
            bReq := FALSE;
            bErr := TRUE;
        END_IF;
    END_IF;

    // 7) 状态输出
    Y0 := bReq;
    Y1 := bDone;
    Y2 := bErr;
END_PROGRAM
