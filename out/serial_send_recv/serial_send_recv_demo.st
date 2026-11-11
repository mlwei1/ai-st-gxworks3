// ============================================================
// 模板：serial_send_recv
// 说明：串口无协议收发（CH1，8B 发 / 8B 收）
// 规格：serial_send_recv_demo（CPU FX5U）
// 参数：channel=1，sendBytes=8，recvBytes=8，timeoutMs=3000
// ============================================================

PROGRAM Main
VAR
    bStartLast : BOOL := FALSE;             // 启动信号上一扫描（上升沿）
    bReq : BOOL := FALSE;                   // 收发请求（通信中）
    bSending : BOOL := FALSE;               // 发送待机标志已出现（用于完成判定）
    bDone : BOOL := FALSE;                  // 正常结束标志
    bErr : BOOL := FALSE;                   // 异常/超时标志
    bEno : BOOL := FALSE;                   // RS2 执行结果
    tTimeout : TON;                         // 通信超时（3000ms）
END_VAR
    // 1) 复位（X1）：清除请求/完成/异常
    IF X1 THEN
        bReq := FALSE;
        bDone := FALSE;
        bErr := FALSE;
        bSending := FALSE;
    END_IF;

    // 2) 启动（X0 上升沿）：触发一次串口收发
    IF X0 AND NOT bStartLast AND NOT bReq THEN
        bReq := TRUE;
        bDone := FALSE;
        bErr := FALSE;
        bSending := FALSE;
    END_IF;
    bStartLast := X0;

    // 3) RS2 无协议收发：ENO := RS2(EN, s, n1, n2, n3, d)
    //    s=D100 发送区, n1=8 发送字节, n2=8 接收字节,
    //    n3=1 通道, d=D104 接收区
    // 注意：RS2 的 n1/n2/n3 必须是指定软元件/常数，不能是未分配软元件的标签，
    //       因此这里直接写常数。
    IF bReq THEN
        bEno := RS2(TRUE, D100, 8, 8, 1, D104);

        // 4) 发送中：SM8401 ON 表示发送待机
        IF SM8401 THEN
            bSending := TRUE;
        END_IF;

        // 5) 完成：发送结束（SM8401 OFF）且 SD8403 收到数据
        IF bSending AND NOT SM8401 AND SD8403 > 0 THEN
            bReq := FALSE;
            bDone := TRUE;
        END_IF;

        // 6a) 串口超时判定（SM8409）
        IF SM8409 THEN
            bReq := FALSE;
            bErr := TRUE;
        END_IF;

        // 6b) 软件超时监控（3000ms）
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
