// ============================================================
// 模板：temperature_two_position
// 说明：位式温度控制（加热/冷却 + 回差）
// 规格：temperature_two_position_demo（CPU FX5U）
// 参数：setpoint=600，hysteresis=20，tempMin=-500，tempMax=1500
// ============================================================

PROGRAM Main
VAR
    bStartLast : BOOL;                      // 启动信号上一扫描（上升沿）
    bRun : BOOL := FALSE;                   // 温控运行中
    bErr : BOOL := FALSE;                   // 传感器超量程故障
    bHeat : BOOL := FALSE;                  // 加热请求
    bCool : BOOL := FALSE;                  // 冷却请求
    nTemp : INT;                            // 当前温度（0.1°C）
    nSet : INT := 600;                      // 设定温度（0.1°C）
    nHyst : INT := 20;                      // 回差（0.1°C）
    nTempMin : INT := -500;                 // 传感器量程下限（0.1°C）
    nTempMax : INT := 1500;                 // 传感器量程上限（0.1°C）
END_VAR
    // 1) 当前温度：D100（0.1°C，由模拟量/通信写入）
    nTemp := D100;

    // 2) 传感器量程检查：超量程时停止运行（回到量程内可重新启动）
    bErr := FALSE;
    IF nTemp <= nTempMin OR nTemp >= nTempMax THEN
        bErr := TRUE;
        bRun := FALSE;
    END_IF;

    // 3) 启动/停止
    IF X1 THEN
        bRun := FALSE;
    END_IF;
    IF X0 AND NOT bStartLast AND NOT bErr THEN
        bRun := TRUE;
    END_IF;
    bStartLast := X0;

    // 4) 位式温控（带回差，避免临界点频繁动作）
    IF bRun AND NOT bErr THEN
        // 加热：低于(设定-回差)开，达到设定关
        IF nTemp <= nSet - nHyst THEN
            bHeat := TRUE;
        END_IF;
        IF nTemp >= nSet THEN
            bHeat := FALSE;
        END_IF;
        // 冷却：高于(设定+回差)开，降到设定关
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

    // 5) 输出
    Y0 := bRun AND bHeat;
    Y1 := bRun AND bCool;
END_PROGRAM
