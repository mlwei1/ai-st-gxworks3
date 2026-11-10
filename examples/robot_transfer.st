// ============================================================
// 搬运机械手：竖直缸下降 → 夹紧 → 上升 → 右移 → 下降 → 松开 → 上升 → 左移
// CPU：FX5U（三菱方言，纯 ST）
//
// IO 分配（双线圈电磁阀示例；若为单线圈弹簧复位阀，见文末说明）
//   X0  启动按钮            X1  停止按钮
//   X2  故障信号（如气压低/急停）
//   Y0  竖直缸下降电磁阀     Y1  竖直缸上升电磁阀
//   Y2  夹爪电磁阀（ON=夹紧，OFF=松开）
//   Y3  水平缸右移电磁阀     Y4  水平缸左移电磁阀
//
// 时序：步号 nStep 1..8，每步停留时间见 CASE nStep 分支（可按实际速度调整）。
// 停止/故障：立即复位步号并断开全部输出。
// 启动：X0 上升沿启动（避免按住不放自动重复循环）。
// ============================================================

PROGRAM Main
VAR
    nStep : INT := 0;                       // 当前步号：0=待机，1..8=动作步
    bRun : BOOL := FALSE;                   // 运行中
    bX0Last : BOOL := FALSE;                // X0 上一扫描状态（上升沿用）
    bDelayAck : BOOL := FALSE;              // 本步计时完成标记（每步只前进一步）
    tStep : TON;                            // 步进定时器
    tStepTime : TIME := T#1500ms;           // 当前步停留时间
END_VAR

    // 1) 停止 / 故障：立即复位到待机（故障消失后需重新按启动）
    IF X1 OR X2 THEN
        bRun := FALSE;
        bDelayAck := FALSE;
        nStep := 0;
    END_IF;

    // 2) 启动：X0 上升沿，且无停止/故障
    IF X0 AND NOT bX0Last AND NOT X1 AND NOT X2 THEN
        bRun := TRUE;
        bDelayAck := FALSE;
        nStep := 1;
    END_IF;
    bX0Last := X0;

    // 3) 每步停留时间（单位 ms；按机械手实际速度调整）
    CASE nStep OF
        1: tStepTime := T#1500ms;   // 竖直下降
        2: tStepTime := T#600ms;    // 夹紧
        3: tStepTime := T#1500ms;   // 竖直上升
        4: tStepTime := T#2000ms;   // 右移
        5: tStepTime := T#1500ms;   // 右位下降
        6: tStepTime := T#600ms;    // 松开
        7: tStepTime := T#1500ms;   // 松开后上升
        8: tStepTime := T#2000ms;   // 左移（回原位）
    ELSE
        tStepTime := T#500ms;
    END_CASE;

    // 4) 步进：每步到时只推进一步；第 8 步完成回到待机
    tStep(IN := bRun AND NOT bDelayAck, PT := tStepTime);
    IF tStep.Q THEN
        bDelayAck := TRUE;
        IF nStep >= 8 THEN
            nStep := 0;
            bRun := FALSE;
        ELSE
            nStep := nStep + 1;
        END_IF;
    END_IF;
    IF NOT tStep.Q THEN
        bDelayAck := FALSE;
    END_IF;

    // 5) 输出驱动：先全部断开，再按当前步置位（安全优先）
    Y0 := FALSE;
    Y1 := FALSE;
    Y2 := FALSE;
    Y3 := FALSE;
    Y4 := FALSE;

    IF bRun THEN
        CASE nStep OF
            1:  // 竖直缸下降
                Y0 := TRUE;

            2:  // 下降到位：夹爪夹紧（保持下压）
                Y0 := TRUE;
                Y2 := TRUE;

            3:  // 夹紧后竖直上升
                Y1 := TRUE;
                Y2 := TRUE;

            4:  // 水平缸右移（保持夹紧）
                Y2 := TRUE;
                Y3 := TRUE;

            5:  // 右位竖直下降
                Y0 := TRUE;
                Y2 := TRUE;
                Y3 := TRUE;

            6:  // 底部夹爪松开（保持下压，右位不动）
                Y0 := TRUE;
                Y3 := TRUE;

            7:  // 松开后竖直上升
                Y1 := TRUE;
                Y3 := TRUE;

            8:  // 水平缸左移回原位
                Y4 := TRUE;
        END_CASE;
    END_IF;

END_PROGRAM

// 说明：
// 1) 以上按“双线圈电磁阀”写（Y0/Y1、Y3/Y4 分别对应伸出/缩回两个线圈）。
//    若实际是“单线圈弹簧复位阀”，则：
//      - 上升不需要 Y1：改由 Y0=FALSE 自动弹回，删去 Y1 赋值；
//      - 左移不需要 Y4：改由 Y3=FALSE 自动弹回，删去 Y4 赋值；
//      - 第 8 步可改为等待回原位或直接结束。
// 2) 当前为“定时步进”，适合演示和初步联调；接真机建议把每步改为
//    传感器条件（下降到位 X10、夹紧到位 X11、上升到位 X12、右限位 X13、
//    左限位 X14、松开到位 X15），到位的上升沿再推进 nStep，安全性和节拍更好。
