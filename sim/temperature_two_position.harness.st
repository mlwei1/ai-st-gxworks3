// ============================================================
// 自驱动温度模板仿真 harness（测试脚手架，不属于交付模板）
// 目的：不依赖外部写 D100，程序内部用 TON（1 秒）推进 7 个阶段，
//       把每阶段结束时刻的 Y0/Y1 记录到 D310~D316，
//       最后自检写入 D320（0=PASS，1=FAIL）。
// 运行：FX5U + GX Simulator3，启动仿真后用批量监视读 D310~D316、D320。
// ============================================================

PROGRAM Main
VAR
    nPhase : INT := 0;                      // 当前阶段 0..7
    tTick : TON;                            // 1 秒节拍（TON 在 Simulator3 中正常）
    nTemp : INT;                            // 当前温度（0.1°C）
    nSet : INT := 600;                      // 设定 60.0°C
    nHyst : INT := 20;                      // 回差 2.0°C
    nTempMin : INT := -500;                 // 量程下限 -50.0°C
    nTempMax : INT := 1500;                 // 量程上限 150.0°C
    bRun : BOOL := FALSE;                   // 温控运行
    bErr : BOOL := FALSE;                   // 传感器故障
    bHeat : BOOL := FALSE;                  // 加热请求
    bCool : BOOL := FALSE;                  // 冷却请求
    nBits : INT := 0;                       // Y0/Y1 记录值：bit0=Y0, bit1=Y1
    bChecked : BOOL := FALSE;               // 自检已执行
END_VAR
    // ---- 1) 每秒推进阶段，并记录上一阶段结束时的 Y0/Y1 ----
    tTick(IN := NOT tTick.Q, PT := T#1s);
    IF tTick.Q THEN
        nBits := 0;
        IF Y0 THEN
            nBits := nBits + 1;
        END_IF;
        IF Y1 THEN
            nBits := nBits + 2;
        END_IF;

        CASE nPhase OF
            0: D310 := nBits;
            1: D311 := nBits;
            2: D312 := nBits;
            3: D313 := nBits;
            4: D314 := nBits;
            5: D315 := nBits;
            6: D316 := nBits;
        END_CASE;

        nPhase := nPhase + 1;

        // 7 个阶段结束后自检（0=PASS，1=FAIL）
        IF nPhase = 7 AND NOT bChecked THEN
            bChecked := TRUE;
            IF D310 = 0 AND D311 = 1 AND D312 = 0 AND D313 = 2
               AND D314 = 0 AND D315 = 0 AND D316 = 1 THEN
                D320 := 0;
            ELSE
                D320 := 1;
            END_IF;
        END_IF;
    END_IF;

    // ---- 2) 各阶段设定温度 D100 ----
    CASE nPhase OF
        0: D100 := 0;      // 冷态、未启动
        1: D100 := 0;      // 启动 → 加热
        2: D100 := 600;    // 到设定 → 停加热
        3: D100 := 620;    // 到设定+回差 → 冷却
        4: D100 := 600;    // 回设定 → 停冷却
        5: D100 := 2000;   // 超量程 → 故障停输出
        6: D100 := 0;      // 回到量程、重新启动 → 加热
        ELSE
            D100 := 0;
    END_CASE;

    // ---- 3) 与模板一致的控制逻辑（故障非锁存） ----
    nTemp := D100;
    bErr := FALSE;
    IF nTemp <= nTempMin OR nTemp >= nTempMax THEN
        bErr := TRUE;
        bRun := FALSE;
    END_IF;

    // 阶段 1..4 正常运行；阶段 6 模拟 X0 重新启动
    IF nPhase >= 1 AND nPhase <= 4 THEN
        bRun := TRUE;
    END_IF;
    IF nPhase = 6 THEN
        bRun := TRUE;
    END_IF;

    IF bRun AND NOT bErr THEN
        IF nTemp <= nSet - nHyst THEN
            bHeat := TRUE;
        END_IF;
        IF nTemp >= nSet THEN
            bHeat := FALSE;
        END_IF;
        IF nTemp >= nSet + nHyst THEN
            bCool := TRUE;
        END_IF;
        IF nTemp <= nSet THEN
            bCool := FALSE;
        END_IF;
    ELSE
        bHeat := FALSE;
        bCool := FALSE;
    END_IF;

    // ---- 4) 输出 ----
    Y0 := bRun AND bHeat;
    Y1 := bRun AND bCool;
END_PROGRAM
