VAR_GLOBAL

    g_Start : BOOL AT X0; // 启动按钮输入

    g_Stop : BOOL AT X1; // 停止按钮输入

    g_Fault : BOOL AT X2; // 故障信号输入

    g_Pump : BOOL AT Y0; // 水泵输出

    g_LowAlarm : BOOL AT Y1; // 低液位报警输出

    g_HighAlarm : BOOL AT Y2; // 高液位报警输出

    g_TankLevel : REAL AT D100; // 液位值 (REAL 占 D100-D101)

    g_TankLevelPct : REAL AT D110; // 液位百分比 (REAL 占 D110-D111)

END_VAR

FUNCTION_BLOCK FB_TankPumpControl
VAR_INPUT
    bStart : BOOL; // 启动命令
    bStop : BOOL; // 停止命令
    bFault : BOOL; // 故障信号
    rLevelPct : REAL; // 液位百分比
    rLowThreshold : REAL; // 低液位启动阈值
    rHighThreshold : REAL; // 高液位停止阈值
END_VAR
VAR_OUTPUT
    bPump : BOOL; // 泵输出
    bLowAlarm : BOOL; // 低液位报警输出
    bHighAlarm : BOOL; // 高液位报警输出
END_VAR
VAR
    bRun : BOOL; // 运行状态
    bPumpCmd : BOOL; // 泵滞回命令
    fbRun : RS; // 运行控制复位优先功能块
    fbPumpCmd : RS; // 泵命令复位优先功能块
END_VAR
fbRun(S := bStart, R1 := bStop OR bFault, Q1 => bRun);
fbPumpCmd(S := (rLevelPct < rLowThreshold), R1 := (rLevelPct > rHighThreshold), Q1 => bPumpCmd);
bLowAlarm := rLevelPct < rLowThreshold;
bHighAlarm := rLevelPct > rHighThreshold;
bPump := bRun AND bPumpCmd AND NOT bFault;
END_FUNCTION_BLOCK

PROGRAM Main
VAR
    fbPump : FB_TankPumpControl; // 水泵控制功能块实例
END_VAR
fbPump(bStart := g_Start, bStop := g_Stop, bFault := g_Fault, rLevelPct := g_TankLevelPct, rLowThreshold := 10.0, rHighThreshold := 90.0, bPump => g_Pump, bLowAlarm => g_LowAlarm, bHighAlarm => g_HighAlarm);
END_PROGRAM