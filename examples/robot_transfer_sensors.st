// ============================================================
// 搬运机械手（传感器到位版）：竖直缸下降 → 夹紧 → 上升 → 右移
//   → 下降 → 松开 → 上升 → 左移，每步由“到位信号”推进，带超时故障
// CPU：FX5U（三菱方言，纯 ST）
//
// IO 分配（双线圈电磁阀 + 传感器）
//   X0   启动按钮（上升沿启动）        X1   停止按钮
//   X2   故障/急停（外部）
//   X10  竖直缸下降到位                X11  夹爪夹紧到位
//   X12  竖直缸上升到位                X13  水平缸右移到位
//   X14  水平缸左移到位                X15  夹爪松开到位
//   Y0   竖直下降电磁阀                Y1   竖直上升电磁阀
//   Y2   夹爪电磁阀（ON=夹紧）          Y3   水平右移电磁阀
//   Y4   水平左移电磁阀                Y5   故障报警灯（超时未到位）
//
// 每步等待对应“到位信号”；等待超过 STEP_TIMEOUT（默认 5 秒）
// 判为故障：全部输出断开、报警灯 Y5 亮、需按停止按钮复位。
// ============================================================

PROGRAM Main
VAR
    nStep : INT := 0;                       // 0=待机，1..8=动作步
    bRun : BOOL := FALSE;                   // 运行中
    bFault : BOOL := FALSE;                 // 超时故障锁存
    bX0Last : BOOL := FALSE;                // X0 上升沿
    tStep : TON;                            // 每步超时计时
    STEP_TIMEOUT : TIME := T#5s;            // 单步超时时间（按需要调整）
END_VAR

    // 1) 外部故障/急停：立即停止并报警
    IF X2 THEN
        bFault := TRUE;
        bRun := FALSE;
        nStep := 0;
    END_IF;

    // 2) 停止按钮：复位故障、回到待机（停机不报警）
    IF X1 THEN
        bFault := FALSE;
        bRun := FALSE;
        nStep := 0;
    END_IF;

    // 3) 启动：X0 上升沿，且无故障/停止
    IF X0 AND NOT bX0Last AND NOT X1 AND NOT X2 AND NOT bFault THEN
        bRun := TRUE;
        nStep := 1;
    END_IF;
    bX0Last := X0;

    // 4) 单步超时保护：运行中某一步超过 5 秒仍未到位 → 故障
    tStep(IN := bRun AND NOT bFault, PT := STEP_TIMEOUT);
    IF tStep.Q THEN
        bFault := TRUE;
        bRun := FALSE;
        nStep := 0;
    END_IF;

    // 5) 步进：每步由对应到位信号推进（到位即进入下一步）
    IF bRun AND NOT bFault THEN
        CASE nStep OF
            1:  // 竖直下降 → 等待下降到位 X10
                IF X10 THEN
                    nStep := 2;
                END_IF;

            2:  // 夹紧 → 等待夹紧到位 X11
                IF X11 THEN
                    nStep := 3;
                END_IF;

            3:  // 竖直上升 → 等待上升到位 X12
                IF X12 THEN
                    nStep := 4;
                END_IF;

            4:  // 水平右移 → 等待右限位 X13
                IF X13 THEN
                    nStep := 5;
                END_IF;

            5:  // 右位竖直下降 → 等待下降到位 X10
                IF X10 THEN
                    nStep := 6;
                END_IF;

            6:  // 夹爪松开 → 等待松开到位 X15
                IF X15 THEN
                    nStep := 7;
                END_IF;

            7:  // 竖直上升 → 等待上升到位 X12
                IF X12 THEN
                    nStep := 8;
                END_IF;

            8:  // 水平左移 → 等待左限位 X14，完成回待机
                IF X14 THEN
                    nStep := 0;
                    bRun := FALSE;
                END_IF;
        END_CASE;
    END_IF;

    // 6) 输出驱动：先全部断开，再按当前步置位（安全优先）
    Y0 := FALSE;
    Y1 := FALSE;
    Y2 := FALSE;
    Y3 := FALSE;
    Y4 := FALSE;
    Y5 := bFault;

    IF bRun AND NOT bFault THEN
        CASE nStep OF
            1:  // 竖直下降
                Y0 := TRUE;

            2:  // 夹紧（保持下压）
                Y0 := TRUE;
                Y2 := TRUE;

            3:  // 夹紧后竖直上升
                Y1 := TRUE;
                Y2 := TRUE;

            4:  // 水平右移（夹紧保持）
                Y2 := TRUE;
                Y3 := TRUE;

            5:  // 右位竖直下降（夹紧保持）
                Y0 := TRUE;
                Y2 := TRUE;
                Y3 := TRUE;

            6:  // 底部松开（保持下压、右位不动）
                Y0 := TRUE;
                Y3 := TRUE;

            7:  // 松开后竖直上升
                Y1 := TRUE;
                Y3 := TRUE;

            8:  // 水平左移回原位
                Y4 := TRUE;
        END_CASE;
    END_IF;

END_PROGRAM

// 说明：
// 1) 传感器信号为“到位保持型”（到位后一直 ON）时可直接用上面逻辑；
//    若为“动作中 ON、到位断开”的脉冲型传感器，把 X10 等改为取反即可。
// 2) 若现场是单线圈弹簧复位阀：删去 Y1、Y4 的赋值（对应动作靠断电磁阀弹回），
//    第 3/7 步改为等待上升到位 X12，第 8 步改为 Y3=FALSE 后等待 X14。
// 3) 本版本不需要“每步时间”，节拍由机械动作决定，超时只用于故障保护。
