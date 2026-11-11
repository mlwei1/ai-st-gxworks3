// ============================================================
// 自动生成：ST 步进程序（SFC/STL 的 ST 实现）
// 说明：nStep=0 待机；nStep=1..N 对应 steps 顺序
// 启动/停止/故障条件、步动作、转移条件均来自 spec.sequence
// ============================================================

PROGRAM Main
VAR
    nStep : INT := 0;                       // 0=待机；1..N=步号
    bRun : BOOL := FALSE;                   // 运行中
    bStartLast : BOOL := FALSE;             // 启动条件上一扫描
END_VAR

    // ---- 步号对照（便于审查） ----
    // 0 = 待机（idle）
    // 1 = S1 竖直下降
    // 2 = S2 夹爪夹紧
    // 3 = S3 竖直上升
    // 4 = S4 水平右移
    // 5 = S5 右位竖直下降
    // 6 = S6 夹爪松开
    // 7 = S7 松开后上升
    // 8 = S8 水平左移回原位

    // 1) 停止 / 故障：直接回待机
    IF (X1) OR (X2) THEN
        bRun := FALSE;
        nStep := 0;
    END_IF;

    // 2) 启动：启动条件上升沿（且无停止/故障）
    IF (X0) AND NOT bStartLast AND NOT bRun AND NOT (X1) AND NOT (X2) THEN
        bRun := TRUE;
        nStep := 1;
    END_IF;
    bStartLast := (X0);

    // 3) 步转移（选择分支按顺序先真先走）
    IF bRun THEN
        CASE nStep OF
            // S1 竖直下降
            1:
                IF (X10) THEN
                    nStep := 2;
                END_IF;
            // S2 夹爪夹紧
            2:
                IF (X11) THEN
                    nStep := 3;
                END_IF;
            // S3 竖直上升
            3:
                IF (X12) THEN
                    nStep := 4;
                END_IF;
            // S4 水平右移
            4:
                IF (X13) THEN
                    nStep := 5;
                END_IF;
            // S5 右位竖直下降
            5:
                IF (X10) THEN
                    nStep := 6;
                END_IF;
            // S6 夹爪松开
            6:
                IF (X15) THEN
                    nStep := 7;
                END_IF;
            // S7 松开后上升
            7:
                IF (X12) THEN
                    nStep := 8;
                END_IF;
            // S8 水平左移回原位
            8:
                IF (X14) THEN
                    nStep := 0; bRun := FALSE;
                END_IF;
        END_CASE;
    END_IF;

    // 4) 输出驱动：先复位本程序用到的输出，再按当前步置位
    Y0 := FALSE;
    Y1 := FALSE;
    Y2 := FALSE;
    Y3 := FALSE;
    Y4 := FALSE;
    IF bRun THEN
        CASE nStep OF
            // S1
            1:
                Y0 := TRUE;
            // S2
            2:
                Y0 := TRUE;
                Y2 := TRUE;
            // S3
            3:
                Y1 := TRUE;
                Y2 := TRUE;
            // S4
            4:
                Y2 := TRUE;
                Y3 := TRUE;
            // S5
            5:
                Y0 := TRUE;
                Y2 := TRUE;
                Y3 := TRUE;
            // S6
            6:
                Y0 := TRUE;
                Y3 := TRUE;
            // S7
            7:
                Y1 := TRUE;
                Y3 := TRUE;
            // S8
            8:
                Y4 := TRUE;
        END_CASE;
    END_IF;

END_PROGRAM

// 生成说明：
// - 每个扫描周期先复位所有布尔输出，再由当前步置位 ON；
// - 停止/故障条件成立时立即回待机（输出全部 OFF）；
// - 转移条件为 ST 布尔表达式（传感器/定时器/计数器等任意组合）；
// - 延时转移使用共享 TON，按步设定 tStepTime，步切换时复位；
// - 并行分支（SFC parallel）尚未支持，可用两个步进程序 + 互锁实现。