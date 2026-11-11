// ============================================================
// 工业步进程序（自动生成：模式/自动/手动/报警/停止序列/HMI）
// 规格：robot_transfer_steps_v2
// 急停：X2；模式：0待机 1自动 2手动 3停止中 4报警 5急停暂停
// ============================================================

PROGRAM Main
VAR
    // ---- 模式/流程 ----
    nMode : INT := 0;                   // 0待机 1自动 2手动 3停止中 4报警 5急停暂停
    nStep : INT := 0;                       // 自动步号（0=待机）
    nStopStep : INT := 0;                   // 停止序列步号
    bStopReq : BOOL := FALSE;               // 停止请求（当前步完成后进入停止序列）
    bStopActive : BOOL := FALSE;            // 停止序列已启动
    bAlarm : BOOL := FALSE;                 // 报警锁存
    nAlarmCode : INT := 0;                  // 报警代码
    nAlarmStep : INT := 0;                  // 报警时冻结的步号
    bEStopPause : BOOL := FALSE;            // 急停暂停标志
    bCylOK : BOOL := FALSE;                 // 所有气缸位置已知（复位/继续条件）

    // ---- HMI 命令上升沿 ----
    bStartLast : BOOL := FALSE;
    bStopLast : BOOL := FALSE;
    bResetLast : BOOL := FALSE;
    bManualLast : BOOL := FALSE;
    bExitLast : BOOL := FALSE;
    bContinueLast : BOOL := FALSE;
    bRestartLast : BOOL := FALSE;
    bBtn1Last : BOOL := FALSE;
    bBtn2Last : BOOL := FALSE;
    bBtn3Last : BOOL := FALSE;

    // ---- HMI 命令上升沿标志 ----
    bStartEdge : BOOL := FALSE;
    bStopEdge : BOOL := FALSE;
    bResetEdge : BOOL := FALSE;
    bManualEdge : BOOL := FALSE;
    bExitEdge : BOOL := FALSE;
    bContinueEdge : BOOL := FALSE;
    bRestartEdge : BOOL := FALSE;
    bBtn1Edge : BOOL := FALSE;
    bBtn2Edge : BOOL := FALSE;
    bBtn3Edge : BOOL := FALSE;

    // ---- 输出映像（自动/停止序列） ----
    bOut0 : BOOL := FALSE;                   // Y0
    bOut1 : BOOL := FALSE;                   // Y2
    bOut2 : BOOL := FALSE;                   // Y1
    bOut3 : BOOL := FALSE;                   // Y3
    bOut4 : BOOL := FALSE;                   // Y4

    // ---- 气缸动作标志/手动命令 ----
    bC1ExtMove : BOOL := FALSE;           // 竖直缸伸出动作中
    bC1RetMove : BOOL := FALSE;           // 竖直缸缩回动作中
    bC1ExtCmd : BOOL := FALSE;            // 竖直缸手动伸出命令
    bC1RetCmd : BOOL := FALSE;            // 竖直缸手动缩回命令
    bC2ExtMove : BOOL := FALSE;           // 水平缸伸出动作中
    bC2RetMove : BOOL := FALSE;           // 水平缸缩回动作中
    bC2ExtCmd : BOOL := FALSE;            // 水平缸手动伸出命令
    bC2RetCmd : BOOL := FALSE;            // 水平缸手动缩回命令
    bC3ExtMove : BOOL := FALSE;           // 夹爪伸出动作中
    bC3RetMove : BOOL := FALSE;           // 夹爪缩回动作中
    bC3RelMove : BOOL := FALSE;           // 夹爪松开动作中
    bC3Clamp : BOOL := FALSE;             // 夹爪手动夹紧命令
    bC3ClampMove : BOOL := FALSE;         // 夹爪手动夹紧动作中

    // ---- 气缸超时定时器 ----
    tC1Ext : TON;                          // 竖直缸伸出/夹紧超时
    tC1Ret : TON;                          // 竖直缸缩回/松开超时
    tC2Ext : TON;                          // 水平缸伸出/夹紧超时
    tC2Ret : TON;                          // 水平缸缩回/松开超时
    tC3Ext : TON;                          // 夹爪伸出/夹紧超时
    tC3Ret : TON;                          // 夹爪缩回/松开超时
END_VAR

    // ---- 1) HMI 命令上升沿 ----
    bStartEdge := M0 AND NOT bStartLast;
    bStartLast := M0;
    bStopEdge := M1 AND NOT bStopLast;
    bStopLast := M1;
    bResetEdge := M2 AND NOT bResetLast;
    bResetLast := M2;
    bManualEdge := M4 AND NOT bManualLast;
    bManualLast := M4;
    bExitEdge := M3 AND NOT bExitLast;
    bExitLast := M3;
    bContinueEdge := M5 AND NOT bContinueLast;
    bContinueLast := M5;
    bRestartEdge := M6 AND NOT bRestartLast;
    bRestartLast := M6;
    bBtn1Edge := M10 AND NOT bBtn1Last;
    bBtn1Last := M10;
    bBtn2Edge := M11 AND NOT bBtn2Last;
    bBtn2Last := M11;
    bBtn3Edge := M12 AND NOT bBtn3Last;
    bBtn3Last := M12;

    // ---- 2) 急停：任何模式立即暂停，冻结步号 ----
    IF X2 THEN
        IF nMode <> 5 THEN
            nMode := 5;
            bEStopPause := TRUE;
        END_IF;
    END_IF;

    // ---- 3a) 自动输出映像与气缸方向标志 ----
    bOut0 := FALSE;
    bOut1 := FALSE;
    bOut2 := FALSE;
    bOut3 := FALSE;
    bOut4 := FALSE;
    bC1ExtMove := FALSE;
    bC1RetMove := FALSE;
    bC2ExtMove := FALSE;
    bC2RetMove := FALSE;
    bC3ExtMove := FALSE;
    bC3RetMove := FALSE;
    bC3RelMove := FALSE;

    IF nMode = 1 THEN
        CASE nStep OF
            // S1 竖直下降
            1:
                bOut0 := TRUE;
                bC1ExtMove := TRUE;
            // S2 夹爪夹紧
            2:
                bOut0 := TRUE;
                bC1ExtMove := TRUE;
                bOut1 := TRUE;
                bC3ExtMove := TRUE;
            // S3 竖直上升
            3:
                bOut2 := TRUE;
                bC1RetMove := TRUE;
                bOut1 := TRUE;
                bC3ExtMove := TRUE;
            // S4 水平右移
            4:
                bOut1 := TRUE;
                bC3ExtMove := TRUE;
                bOut3 := TRUE;
                bC2ExtMove := TRUE;
            // S5 右位竖直下降
            5:
                bOut0 := TRUE;
                bC1ExtMove := TRUE;
                bOut1 := TRUE;
                bC3ExtMove := TRUE;
                bOut3 := TRUE;
                bC2ExtMove := TRUE;
            // S6 夹爪松开
            6:
                bOut0 := TRUE;
                bC1ExtMove := TRUE;
                bOut1 := FALSE;
                bC3RelMove := TRUE;
                bOut3 := TRUE;
                bC2ExtMove := TRUE;
            // S7 松开后上升
            7:
                bOut2 := TRUE;
                bC1RetMove := TRUE;
                bOut3 := TRUE;
                bC2ExtMove := TRUE;
            // S8 水平左移回原位
            8:
                bOut4 := TRUE;
                bC2RetMove := TRUE;
        END_CASE;
    END_IF;

    // ---- 3b) 停止序列输出映像 ----
    IF nMode = 3 THEN
        CASE nStopStep OF
            // T1 竖直上升回原位
            1:
                bOut0 := FALSE;
                bOut2 := TRUE;
                bC1RetMove := TRUE;
            // T2 水平左移回原位
            2:
                bOut3 := FALSE;
                bOut4 := TRUE;
                bC2RetMove := TRUE;
            // T3 夹爪松开
            3:
                bOut1 := FALSE;
                bC3RelMove := TRUE;
            // T4 全部输出关闭
            4:
                bOut0 := FALSE;
                bOut2 := FALSE;
                bOut1 := FALSE;
                bC3RelMove := TRUE;
                bOut3 := FALSE;
                bOut4 := FALSE;
        END_CASE;
    END_IF;

    // ---- 4) 气缸动作超时检测（目标磁性开关 5s 未到位 → 报警） ----
    // 竖直缸：伸出/到位检测
    tC1Ext(IN := (((nMode = 1) OR (nMode = 3)) AND bC1ExtMove AND NOT X10) OR ((nMode = 2) AND bC1ExtCmd AND NOT X10), PT := T#5000ms);
    IF tC1Ext.Q THEN
        nMode := 4;
        bAlarm := TRUE;
        nAlarmCode := 10;
        nAlarmStep := nStep;
        bC1ExtCmd := FALSE;
        bC1RetCmd := FALSE;
        bC2ExtCmd := FALSE;
        bC2RetCmd := FALSE;
        bC3ClampMove := FALSE;
        bC3RelMove := FALSE;
        // 竖直缸下降超时（卡缸）
    END_IF;

    // 竖直缸：缩回/原位检测
    tC1Ret(IN := (((nMode = 1) OR (nMode = 3)) AND bC1RetMove AND NOT X12) OR ((nMode = 2) AND bC1RetCmd AND NOT X12), PT := T#5000ms);
    IF tC1Ret.Q THEN
        nMode := 4;
        bAlarm := TRUE;
        nAlarmCode := 11;
        nAlarmStep := nStep;
        bC1ExtCmd := FALSE;
        bC1RetCmd := FALSE;
        bC2ExtCmd := FALSE;
        bC2RetCmd := FALSE;
        bC3ClampMove := FALSE;
        bC3RelMove := FALSE;
        // 竖直缸上升超时（卡缸）
    END_IF;

    // 水平缸：伸出/到位检测
    tC2Ext(IN := (((nMode = 1) OR (nMode = 3)) AND bC2ExtMove AND NOT X13) OR ((nMode = 2) AND bC2ExtCmd AND NOT X13), PT := T#5000ms);
    IF tC2Ext.Q THEN
        nMode := 4;
        bAlarm := TRUE;
        nAlarmCode := 20;
        nAlarmStep := nStep;
        bC1ExtCmd := FALSE;
        bC1RetCmd := FALSE;
        bC2ExtCmd := FALSE;
        bC2RetCmd := FALSE;
        bC3ClampMove := FALSE;
        bC3RelMove := FALSE;
        // 水平缸右移超时（卡缸）
    END_IF;

    // 水平缸：缩回/原位检测
    tC2Ret(IN := (((nMode = 1) OR (nMode = 3)) AND bC2RetMove AND NOT X14) OR ((nMode = 2) AND bC2RetCmd AND NOT X14), PT := T#5000ms);
    IF tC2Ret.Q THEN
        nMode := 4;
        bAlarm := TRUE;
        nAlarmCode := 21;
        nAlarmStep := nStep;
        bC1ExtCmd := FALSE;
        bC1RetCmd := FALSE;
        bC2ExtCmd := FALSE;
        bC2RetCmd := FALSE;
        bC3ClampMove := FALSE;
        bC3RelMove := FALSE;
        // 水平缸左移超时（卡缸）
    END_IF;

    // 夹爪：夹紧/到位检测
    tC3Ext(IN := (((nMode = 1) OR (nMode = 3)) AND bC3ExtMove AND NOT X11) OR ((nMode = 2) AND bC3ClampMove AND NOT X11), PT := T#5000ms);
    IF tC3Ext.Q THEN
        nMode := 4;
        bAlarm := TRUE;
        nAlarmCode := 30;
        nAlarmStep := nStep;
        bC1ExtCmd := FALSE;
        bC1RetCmd := FALSE;
        bC2ExtCmd := FALSE;
        bC2RetCmd := FALSE;
        bC3ClampMove := FALSE;
        bC3RelMove := FALSE;
        bC3RelMove := FALSE;
        // 夹爪夹紧超时（卡缸）
    END_IF;

    // 夹爪：松开/回原位检测
    tC3Ret(IN := bC3RelMove AND NOT X15 AND ((nMode = 1) OR (nMode = 3) OR (nMode = 2)), PT := T#5000ms);
    IF tC3Ret.Q THEN
        nMode := 4;
        bAlarm := TRUE;
        nAlarmCode := 31;
        nAlarmStep := nStep;
        bC1ExtCmd := FALSE;
        bC1RetCmd := FALSE;
        bC2ExtCmd := FALSE;
        bC2RetCmd := FALSE;
        bC3ClampMove := FALSE;
        bC3RelMove := FALSE;
        bC3RelMove := FALSE;
        // 夹爪松开超时（卡缸）
    END_IF;


    // ---- 5) 模式与 HMI 命令 ----
    bCylOK := ((X10) OR (X12)) AND ((X13) OR (X14)) AND ((X11) OR (X15));

    // 待机：启动/切手动
    IF nMode = 0 THEN
        IF bStartEdge THEN
            nStep := 1;
            nMode := 1;
            bStopReq := FALSE;
            bStopActive := FALSE;
            bAlarm := FALSE;
            bEStopPause := FALSE;
            nAlarmCode := 0;
            nAlarmStep := 0;
        END_IF;
        IF bManualEdge AND NOT X2 THEN
            nMode := 2;
            bC1ExtCmd := FALSE;
            bC1RetCmd := FALSE;
            bC2ExtCmd := FALSE;
            bC2RetCmd := FALSE;
            bC3Clamp := (X11);
            bC3ClampMove := FALSE;
            bC3RelMove := FALSE;
        END_IF;
    END_IF;

    // 自动：停止请求（当前步完成后进入停止序列）
    IF nMode = 1 THEN
        IF bStopEdge THEN
            bStopReq := TRUE;
        END_IF;
    END_IF;

    // 报警/急停暂停：切手动处理、停止、从头开始
    IF (nMode = 4) OR (nMode = 5) THEN
        IF bManualEdge AND NOT X2 THEN
            nMode := 2;
            bC1ExtCmd := FALSE;
            bC1RetCmd := FALSE;
            bC2ExtCmd := FALSE;
            bC2RetCmd := FALSE;
            bC3Clamp := (X11);
            bC3ClampMove := FALSE;
            bC3RelMove := FALSE;
        END_IF;
        IF bStopEdge THEN
            nMode := 3;
            IF NOT bStopActive THEN
                nStopStep := 1;
                bStopActive := TRUE;
            END_IF;
        END_IF;
        IF bRestartEdge THEN
            Y0 := FALSE;
            Y2 := FALSE;
            Y1 := FALSE;
            Y3 := FALSE;
            Y4 := FALSE;
            bC1ExtCmd := FALSE;
            bC1RetCmd := FALSE;
            bC2ExtCmd := FALSE;
            bC2RetCmd := FALSE;
            bC3ClampMove := FALSE;
            bC3RelMove := FALSE;
            nMode := 0;
            nStep := 0;
            nStopStep := 0;
            bStopActive := FALSE;
            bStopReq := FALSE;
            bAlarm := FALSE;
            bEStopPause := FALSE;
            nAlarmCode := 0;
            nAlarmStep := 0;
        END_IF;
    END_IF;

    // 手动：清故障、退出手动、继续/停止/从头
    IF nMode = 2 THEN
        IF bResetEdge AND bCylOK AND NOT X2 THEN
            bAlarm := FALSE;
            bEStopPause := FALSE;
            nAlarmCode := 0;
            nAlarmStep := 0;
        END_IF;
        IF bExitEdge AND bCylOK AND NOT bAlarm AND NOT bEStopPause AND NOT X2 THEN
            Y0 := FALSE;
            Y2 := FALSE;
            Y1 := FALSE;
            Y3 := FALSE;
            Y4 := FALSE;
            nMode := 0;
            nStep := 0;
            bStopActive := FALSE;
        END_IF;
        IF bContinueEdge AND bCylOK AND NOT bAlarm AND NOT bEStopPause AND NOT X2 THEN
            IF bStopActive THEN
                nMode := 3;
            ELSE
                nMode := 1;
            END_IF;
            bStopReq := FALSE;
        END_IF;
        IF bStopEdge THEN
            nMode := 3;
            IF NOT bStopActive THEN
                nStopStep := 1;
                bStopActive := TRUE;
            END_IF;
        END_IF;
        IF bRestartEdge THEN
            Y0 := FALSE;
            Y2 := FALSE;
            Y1 := FALSE;
            Y3 := FALSE;
            Y4 := FALSE;
            bC1ExtCmd := FALSE;
            bC1RetCmd := FALSE;
            bC2ExtCmd := FALSE;
            bC2RetCmd := FALSE;
            bC3ClampMove := FALSE;
            bC3RelMove := FALSE;
            nMode := 0;
            nStep := 0;
            nStopStep := 0;
            bStopActive := FALSE;
            bStopReq := FALSE;
            bAlarm := FALSE;
            bEStopPause := FALSE;
            nAlarmCode := 0;
            nAlarmStep := 0;
        END_IF;
    END_IF;

    // 急停仍按住时禁止任何模式切换
    IF X2 THEN
        nMode := 5;
    END_IF;

    // ---- 6) 自动步转移（报警/急停时 nMode 不是自动，流程不跳转） ----
        IF nMode = 1 THEN
            CASE nStep OF
                // S1 竖直下降
                1:
                    IF (X10) THEN
                        IF bStopReq THEN
                            nMode := 3;
                            nStopStep := 1;
                            bStopActive := TRUE;
                            bStopReq := FALSE;
                        ELSE
                            nStep := 2;
                        END_IF;
                    END_IF;
                // S2 夹爪夹紧
                2:
                    IF (X11) THEN
                        IF bStopReq THEN
                            nMode := 3;
                            nStopStep := 1;
                            bStopActive := TRUE;
                            bStopReq := FALSE;
                        ELSE
                            nStep := 3;
                        END_IF;
                    END_IF;
                // S3 竖直上升
                3:
                    IF (X12) THEN
                        IF bStopReq THEN
                            nMode := 3;
                            nStopStep := 1;
                            bStopActive := TRUE;
                            bStopReq := FALSE;
                        ELSE
                            nStep := 4;
                        END_IF;
                    END_IF;
                // S4 水平右移
                4:
                    IF (X13) THEN
                        IF bStopReq THEN
                            nMode := 3;
                            nStopStep := 1;
                            bStopActive := TRUE;
                            bStopReq := FALSE;
                        ELSE
                            nStep := 5;
                        END_IF;
                    END_IF;
                // S5 右位竖直下降
                5:
                    IF (X10) THEN
                        IF bStopReq THEN
                            nMode := 3;
                            nStopStep := 1;
                            bStopActive := TRUE;
                            bStopReq := FALSE;
                        ELSE
                            nStep := 6;
                        END_IF;
                    END_IF;
                // S6 夹爪松开
                6:
                    IF (X15) THEN
                        IF bStopReq THEN
                            nMode := 3;
                            nStopStep := 1;
                            bStopActive := TRUE;
                            bStopReq := FALSE;
                        ELSE
                            nStep := 7;
                        END_IF;
                    END_IF;
                // S7 松开后上升
                7:
                    IF (X12) THEN
                        IF bStopReq THEN
                            nMode := 3;
                            nStopStep := 1;
                            bStopActive := TRUE;
                            bStopReq := FALSE;
                        ELSE
                            nStep := 8;
                        END_IF;
                    END_IF;
                // S8 水平左移回原位
                8:
                    IF (X14) THEN
                        IF bStopReq THEN
                            nMode := 3;
                            nStopStep := 1;
                            bStopActive := TRUE;
                            bStopReq := FALSE;
                        ELSE
                            Y0 := FALSE;
                            Y2 := FALSE;
                            Y1 := FALSE;
                            Y3 := FALSE;
                            Y4 := FALSE;
                            nStep := 0;
                            nMode := 0;
                        END_IF;
                    END_IF;
            END_CASE;
        END_IF;

    // ---- 7) 停止序列（按顺序回原点，不直接清输出） ----
        IF nMode = 3 THEN
            CASE nStopStep OF
                // T1 竖直上升回原位
                1:
                    IF (X12) THEN
                        nStopStep := 2;
                    END_IF;
                // T2 水平左移回原位
                2:
                    IF (X14) THEN
                        nStopStep := 3;
                    END_IF;
                // T3 夹爪松开
                3:
                    IF (X15) THEN
                        nStopStep := 4;
                    END_IF;
                // T4 全部输出关闭
                4:
                    IF (TRUE) THEN
                        nStopStep := 5;
                    END_IF;
                ELSE
                    Y0 := FALSE;
                    Y2 := FALSE;
                    Y1 := FALSE;
                    Y3 := FALSE;
                    Y4 := FALSE;
                    nMode := 0;
                    nStep := 0;
                    nStopStep := 0;
                    bStopActive := FALSE;
                    bStopReq := FALSE;
            END_CASE;
        END_IF;

    // ---- 8) 手动翻转（仅手动模式） ----
        IF nMode = 2 THEN
            // 手动翻转：竖直缸（M10）
            IF bBtn1Edge THEN
                IF X12 THEN
                    bC1ExtCmd := TRUE;
                    bC1RetCmd := FALSE;
                ELSIF X10 THEN
                    bC1ExtCmd := FALSE;
                    bC1RetCmd := TRUE;
                ELSE
                    // 位置未知（卡在中间）：默认缩回原位，便于人工恢复
                    bC1ExtCmd := FALSE;
                    bC1RetCmd := TRUE;
                END_IF;
            END_IF;
            IF bC1ExtCmd AND X10 THEN
                bC1ExtCmd := FALSE;
            END_IF;
            IF bC1RetCmd AND X12 THEN
                bC1RetCmd := FALSE;
            END_IF;

            // 手动翻转：水平缸（M11）
            IF bBtn2Edge THEN
                IF X14 THEN
                    bC2ExtCmd := TRUE;
                    bC2RetCmd := FALSE;
                ELSIF X13 THEN
                    bC2ExtCmd := FALSE;
                    bC2RetCmd := TRUE;
                ELSE
                    // 位置未知（卡在中间）：默认缩回原位，便于人工恢复
                    bC2ExtCmd := FALSE;
                    bC2RetCmd := TRUE;
                END_IF;
            END_IF;
            IF bC2ExtCmd AND X13 THEN
                bC2ExtCmd := FALSE;
            END_IF;
            IF bC2RetCmd AND X14 THEN
                bC2RetCmd := FALSE;
            END_IF;

            // 手动翻转：夹爪（M12）
            IF bBtn3Edge THEN
                IF X15 THEN
                    bC3Clamp := TRUE;
                    bC3ClampMove := TRUE;
                ELSIF X11 THEN
                    bC3Clamp := FALSE;
                    bC3RelMove := TRUE;
                ELSE
                    // 位置未知（卡在中间）：默认松开回原位，便于人工恢复
                    bC3Clamp := FALSE;
                    bC3RelMove := TRUE;
                END_IF;
            END_IF;
            IF bC3ClampMove AND X11 THEN
                bC3ClampMove := FALSE;
            END_IF;
            IF bC3RelMove AND X15 THEN
                bC3RelMove := FALSE;
            END_IF;

        END_IF;

    // ---- 输出汇总（同一输出只在此处驱动；报警/急停/待机保持输出不变） ----
    IF (nMode = 1) OR (nMode = 3) THEN
        Y0 := bOut0;
        Y2 := bOut1;
        Y1 := bOut2;
        Y3 := bOut3;
        Y4 := bOut4;
    ELSIF nMode = 2 THEN
        Y0 := bC1ExtCmd;
        Y1 := bC1RetCmd;
        Y3 := bC2ExtCmd;
        Y4 := bC2RetCmd;
        Y2 := bC3Clamp;
    END_IF;

    // ---- 10) HMI 状态/数据 ----
    M100 := (nMode = 0);
    M101 := (nMode = 1);
    M102 := (nMode = 2);
    M103 := (nMode = 3);
    M104 := bAlarm;
    M105 := bEStopPause;
    D0 := nStep;
    D1 := nMode;
    D2 := nAlarmCode;
    D3 := nAlarmStep;

END_PROGRAM
