// ============================================================
// 模板：motor_auto_stop
// 说明：启动后延时自动停止
// 规格：demo_fan_auto_stop（CPU FX5U）
// 参数：autoStopSec=10
// ============================================================

PROGRAM Main
VAR
    bRun : BOOL := FALSE;                   // 运行状态（自锁）
    bFault : BOOL := FALSE;                 // 故障锁存
    tAutoStop : TON;                        // 自动停止定时器
END_VAR
    // 1) 故障锁存与联锁
    IF X2 THEN
        bFault := TRUE;
    END_IF;
    IF bFault OR X1 THEN
        bRun := FALSE;
    END_IF;

    // 2) 启动自锁
    IF X0 AND NOT X1 AND NOT bFault THEN
        bRun := TRUE;
    END_IF;

    // 3) 运行延时：运行期间计时，到 10 秒自动停止
    tAutoStop(IN := bRun, PT := T#10000ms);
    IF bRun AND tAutoStop.Q THEN
        bRun := FALSE;
    END_IF;

    // 4) 输出驱动
    Y0 := bRun;
END_PROGRAM
