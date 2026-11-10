// ============================================================
// 模板：motor_start_stop
// 说明：电机启停 / 故障联锁 / 自锁回路
// 规格：motor_start_stop（CPU FX5U）
// 参数：faultReset=true
// ============================================================

PROGRAM Main
VAR
    bRun : BOOL := FALSE;                   // 运行状态（自锁）
    bFault : BOOL := FALSE;                 // 故障锁存
END_VAR
    // 1) 故障锁存：故障输入为 ON 时置位故障标志
    IF X2 THEN
        bFault := TRUE;
    END_IF;

    // 2) 故障复位（manual）：故障消失后按停止或复位按钮复位
    IF bFault AND NOT X2 THEN
        IF X1 OR X3 THEN
            bFault := FALSE;
        END_IF;
    END_IF;

    // 3) 启动自锁：启动按钮按下、无停止且无故障时自锁
    IF X0 AND NOT X1 AND NOT bFault THEN
        bRun := TRUE;
    END_IF;

    // 4) 停止优先：停止按钮或故障立即解除自锁
    IF X1 OR bFault THEN
        bRun := FALSE;
    END_IF;

    // 5) 输出驱动
    Y0 := bRun;
END_PROGRAM
