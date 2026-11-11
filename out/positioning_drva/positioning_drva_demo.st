// ============================================================
// 模板：positioning_drva
// 说明：单轴绝对定位（轴1，DRVA）
// 规格：positioning_drva_demo（CPU FX5U）
// 参数：axis=1，target=10000，speed=5000，pulseY=0，dirY=1
// ============================================================

PROGRAM Main
VAR
    bStartLast : BOOL;                      // 启动信号上一扫描（上升沿）
    bMove : BOOL := FALSE;                  // 定位执行中
    bDriving : BOOL := FALSE;               // 已进入定位驱动中
    bDone : BOOL := FALSE;                  // 定位完成
    bErr : BOOL := FALSE;                   // 定位异常/超时
    bEno : BOOL;                            // DRVA 指令执行结果（ENO）
    nTarget : INT := 10000;                 // 目标位置（绝对地址）
    nSpeed : WORD := 5000;                  // 定位速度
    tTimeout : TON;                         // 启动超时监控（2s）
END_VAR
    // 1) 停止/复位（X1）：清除运行、完成、异常
    IF X1 THEN
        bMove := FALSE;
        bDriving := FALSE;
        bDone := FALSE;
        bErr := FALSE;
    END_IF;

    // 2) 启动（X0 上升沿）：仅空闲时允许启动
    IF X0 AND NOT bStartLast AND NOT bMove THEN
        bMove := TRUE;
        bDriving := FALSE;
        bDone := FALSE;
        bErr := FALSE;
    END_IF;
    bStartLast := X0;

    // 3) DRVA 绝对定位：ENO := DRVA(EN, s1, s2, d1, d2)
    //    s1=目标地址, s2=指令速度, d1=脉冲输出Y, d2=方向输出Y
    IF bMove THEN
        bEno := DRVA(TRUE, nTarget, nSpeed, Y0, Y1);

        // 4) 完成判定：定位驱动中标志先 ON 后 OFF（下降沿表示定位结束）
        IF SM5500 THEN
            bDriving := TRUE;
        END_IF;
        IF bDriving AND NOT SM5500 THEN
            bMove := FALSE;
            bDriving := FALSE;
            bDone := TRUE;
        END_IF;

        // 5) 异常：2s 内未进入定位驱动中，或定位出错标志 ON
        tTimeout(IN := bMove AND NOT bDriving, PT := T#2s);
        IF tTimeout.Q THEN
            bMove := FALSE;
            bErr := TRUE;
        END_IF;
        IF SM5532 THEN
            bMove := FALSE;
            bErr := TRUE;
        END_IF;
    END_IF;
END_PROGRAM
