// ============================================================
// 全局标签（IEC XML <GlobalVars>；此块供本工具 check/build-xml 使用，
// 导入 GX Works3 用 XML，程序正文引用下列标签名）
// ============================================================
VAR_GLOBAL
    启动按钮 : BOOL AT X0; '启动按钮'
    停止按钮 : BOOL AT X1; '停止按钮'
    急停 : BOOL AT X2; '急停（暂停）'
    竖直缸下降到位 : BOOL AT X10; '竖直缸下降到位'
    夹爪夹紧到位 : BOOL AT X11; '夹爪夹紧到位'
    竖直缸上升到位 : BOOL AT X12; '竖直缸上升到位'
    水平右限位 : BOOL AT X13; '水平右限位'
    水平左限位 : BOOL AT X14; '水平左限位'
    夹爪松开到位 : BOOL AT X15; '夹爪松开到位'
    竖直下降电磁阀 : BOOL AT Y0; '竖直下降电磁阀'
    竖直上升电磁阀 : BOOL AT Y1; '竖直上升电磁阀'
    夹爪电磁阀 : BOOL AT Y2; '夹爪电磁阀（ON=夹紧）'
    水平右移电磁阀 : BOOL AT Y3; '水平右移电磁阀'
    水平左移电磁阀 : BOOL AT Y4; '水平左移电磁阀'
    触摸屏启动 : BOOL AT M0; '触摸屏：启动'
    触摸屏停止 : BOOL AT M1; '触摸屏：停止'
    触摸屏复位 : BOOL AT M2; '触摸屏：复位/清除报警'
    触摸屏手动 : BOOL AT M4; '触摸屏：手动模式'
    触摸屏退出手动 : BOOL AT M3; '触摸屏：退出手动/回待机'
    触摸屏继续 : BOOL AT M5; '触摸屏：继续（冻结步）'
    触摸屏从头 : BOOL AT M6; '触摸屏：从头开始'
    状态待机 : BOOL AT M100; '状态：待机'
    状态自动 : BOOL AT M101; '状态：自动运行'
    状态手动 : BOOL AT M102; '状态：手动模式'
    状态停止中 : BOOL AT M103; '状态：停止中'
    状态报警 : BOOL AT M104; '状态：报警中'
    状态急停暂停 : BOOL AT M105; '状态：急停暂停'
    当前步号 : INT AT D0; '数据：当前步号'
    当前模式 : INT AT D1; '数据：当前模式'
    报警代码 : INT AT D2; '数据：报警代码'
    报警步号 : INT AT D3; '数据：报警冻结步号'
    手动竖直缸 : BOOL AT M10; '触摸屏：手动翻转 竖直缸'
    手动水平缸 : BOOL AT M11; '触摸屏：手动翻转 水平缸'
    手动夹爪 : BOOL AT M12; '触摸屏：手动翻转 夹爪'
END_VAR
// ============================================================
// 气缸功能块（双电控）：输出 + 双向超时报警
// ============================================================
FUNCTION_BLOCK FB_Cylinder
VAR_INPUT
    bEnable : BOOL;                    // 允许动作/监视（自动/停止中/手动）
    bCmdExtend : BOOL;                 // 命令伸出
    bCmdRetract : BOOL;                // 命令缩回
    xExtended : BOOL;                  // 伸出到位磁性开关
    xRetracted : BOOL;                 // 原位磁性开关
    tTimeout : TIME := T#5s;           // 动作超时
    nAlarmExt : INT := 100;            // 伸出超时报警码
    nAlarmRet : INT := 101;            // 缩回超时报警码
END_VAR
VAR_OUTPUT
    bOutExtend : BOOL;                 // 伸出输出（驱动 Y）
    bOutRetract : BOOL;                // 缩回输出（驱动 Y）
    bAlarm : BOOL;                     // 超时报警
    nAlarmCode : INT;                  // 报警码
END_VAR
VAR
    tExt : TON;
    tRet : TON;
END_VAR
    // 输出（bEnable=FALSE 时保持输出，配合报警/急停冻结）
    IF bEnable THEN
        bOutExtend := bCmdExtend;
        bOutRetract := bCmdRetract;
    END_IF;

    // 超时监视
    tExt(IN := bEnable AND bCmdExtend AND NOT xExtended, PT := tTimeout);
    tRet(IN := bEnable AND bCmdRetract AND NOT xRetracted, PT := tTimeout);

    bAlarm := FALSE;
    IF tExt.Q THEN
        bAlarm := TRUE;
        nAlarmCode := nAlarmExt;
    ELSIF tRet.Q THEN
        bAlarm := TRUE;
        nAlarmCode := nAlarmRet;
    END_IF;
END_FUNCTION_BLOCK

// ============================================================
// 气缸功能块（单电控/弹簧复位）：夹紧输出 + 双向超时报警
// ============================================================
FUNCTION_BLOCK FB_CylinderSV
VAR_INPUT
    bEnable : BOOL;                    // 允许动作/监视（自动/停止中/手动）
    bCmdClamp : BOOL;                  // 命令夹紧（FALSE=松开）
    xClamped : BOOL;                   // 夹紧到位磁性开关
    xReleased : BOOL;                  // 松开到位磁性开关
    tTimeout : TIME := T#5s;           // 动作超时
    nAlarmClamp : INT := 100;          // 夹紧超时报警码
    nAlarmRelease : INT := 101;        // 松开超时报警码
END_VAR
VAR_OUTPUT
    bOutClamp : BOOL;                  // 夹紧输出（驱动 Y）
    bAlarm : BOOL;                     // 超时报警
    nAlarmCode : INT;                  // 报警码
END_VAR
VAR
    tClamp : TON;
    tRelease : TON;
END_VAR
    // 输出（bEnable=FALSE 时保持输出）
    IF bEnable THEN
        bOutClamp := bCmdClamp;
    END_IF;

    // 超时监视
    tClamp(IN := bEnable AND bCmdClamp AND NOT xClamped, PT := tTimeout);
    tRelease(IN := bEnable AND NOT bCmdClamp AND NOT xReleased, PT := tTimeout);

    bAlarm := FALSE;
    IF tClamp.Q THEN
        bAlarm := TRUE;
        nAlarmCode := nAlarmClamp;
    ELSIF tRelease.Q THEN
        bAlarm := TRUE;
        nAlarmCode := nAlarmRelease;
    END_IF;
END_FUNCTION_BLOCK

// ============================================================
// 工业步进主程序（FB 版：模式/自动/手动/报警/停止序列/HMI）
// 规格：robot_transfer_steps_v2
// 急停：急停；模式：0待机 1自动 2手动 3停止中 4报警 5急停暂停
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
    bAlarmAny : BOOL := FALSE;              // 任一气缸超时
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

    // ---- 气缸命令（自动/停止序列/手动共用） ----
    bC1Ext : BOOL := FALSE;             // 竖直缸：伸出命令
    bC1Ret : BOOL := FALSE;             // 竖直缸：缩回命令
    bC2Ext : BOOL := FALSE;             // 水平缸：伸出命令
    bC2Ret : BOOL := FALSE;             // 水平缸：缩回命令
    bC3Clamp : BOOL := FALSE;            // 夹爪：夹紧命令（FALSE=松开）

    // ---- FB 输出/报警 ----
    bC1OutExt : BOOL := FALSE;
    bC1OutRet : BOOL := FALSE;
    bC1Alarm : BOOL := FALSE;
    nC1AlarmCode : INT := 0;
    bC2OutExt : BOOL := FALSE;
    bC2OutRet : BOOL := FALSE;
    bC2Alarm : BOOL := FALSE;
    nC2AlarmCode : INT := 0;
    bC3OutClamp : BOOL := FALSE;
    bC3Alarm : BOOL := FALSE;
    nC3AlarmCode : INT := 0;

    // ---- FB 实例 ----
    fbCyl1 : FB_Cylinder;  // 竖直缸
    fbCyl2 : FB_Cylinder;  // 水平缸
    fbCyl3 : FB_CylinderSV;  // 夹爪
END_VAR

    // ---- 1) HMI 命令上升沿 ----
    bStartEdge := 触摸屏启动 AND NOT bStartLast;
    bStartLast := 触摸屏启动;
    bStopEdge := 触摸屏停止 AND NOT bStopLast;
    bStopLast := 触摸屏停止;
    bResetEdge := 触摸屏复位 AND NOT bResetLast;
    bResetLast := 触摸屏复位;
    bManualEdge := 触摸屏手动 AND NOT bManualLast;
    bManualLast := 触摸屏手动;
    bExitEdge := 触摸屏退出手动 AND NOT bExitLast;
    bExitLast := 触摸屏退出手动;
    bContinueEdge := 触摸屏继续 AND NOT bContinueLast;
    bContinueLast := 触摸屏继续;
    bRestartEdge := 触摸屏从头 AND NOT bRestartLast;
    bRestartLast := 触摸屏从头;
    bBtn1Edge := 手动竖直缸 AND NOT bBtn1Last;
    bBtn1Last := 手动竖直缸;
    bBtn2Edge := 手动水平缸 AND NOT bBtn2Last;
    bBtn2Last := 手动水平缸;
    bBtn3Edge := 手动夹爪 AND NOT bBtn3Last;
    bBtn3Last := 手动夹爪;

    // ---- 2) 急停：任何模式立即暂停，冻结步号 ----
    IF 急停 THEN
        IF nMode <> 5 THEN
            nMode := 5;
            bEStopPause := TRUE;
        END_IF;
    END_IF;

    // ---- 3) 模式与 HMI 命令 ----
    bCylOK := ((竖直缸下降到位) OR (竖直缸上升到位)) AND ((水平右限位) OR (水平左限位)) AND ((夹爪夹紧到位) OR (夹爪松开到位));

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
        IF bManualEdge AND NOT 急停 THEN
            nMode := 2;
            bC1Ext := FALSE;
            bC1Ret := FALSE;
            bC2Ext := FALSE;
            bC2Ret := FALSE;
            bC3Clamp := (夹爪夹紧到位);  // 保持当前夹紧状态
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
        IF bManualEdge AND NOT 急停 THEN
            nMode := 2;
            bC1Ext := FALSE;
            bC1Ret := FALSE;
            bC2Ext := FALSE;
            bC2Ret := FALSE;
            bC3Clamp := (夹爪夹紧到位);  // 保持当前夹紧状态
        END_IF;
        IF bStopEdge THEN
            nMode := 3;
            IF NOT bStopActive THEN
                nStopStep := 1;
                bStopActive := TRUE;
            END_IF;
        END_IF;
        IF bRestartEdge THEN
            nMode := 0;
            nStep := 0;
            nStopStep := 0;
            bStopActive := FALSE;
            bStopReq := FALSE;
            bAlarm := FALSE;
            bEStopPause := FALSE;
            nAlarmCode := 0;
            nAlarmStep := 0;
            bC1Ext := FALSE;
            bC1Ret := FALSE;
            bC2Ext := FALSE;
            bC2Ret := FALSE;
            bC3Clamp := FALSE;
        END_IF;
    END_IF;

    // 手动：清故障、退出手动、继续/停止/从头
    IF nMode = 2 THEN
        IF bResetEdge AND bCylOK AND NOT 急停 THEN
            bAlarm := FALSE;
            bEStopPause := FALSE;
            nAlarmCode := 0;
            nAlarmStep := 0;
        END_IF;
        IF bExitEdge AND bCylOK AND NOT bAlarm AND NOT bEStopPause AND NOT 急停 THEN
            nMode := 0;
            nStep := 0;
            bStopActive := FALSE;
        END_IF;
        IF bContinueEdge AND bCylOK AND NOT bAlarm AND NOT bEStopPause AND NOT 急停 THEN
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
            nMode := 0;
            nStep := 0;
            nStopStep := 0;
            bStopActive := FALSE;
            bStopReq := FALSE;
            bAlarm := FALSE;
            bEStopPause := FALSE;
            nAlarmCode := 0;
            nAlarmStep := 0;
            bC1Ext := FALSE;
            bC1Ret := FALSE;
            bC2Ext := FALSE;
            bC2Ret := FALSE;
            bC3Clamp := FALSE;
        END_IF;
    END_IF;

    // 急停仍按住时禁止任何模式切换
    IF 急停 THEN
        nMode := 5;
    END_IF;

    // ---- 4) 手动翻转（仅手动模式） ----
        IF nMode = 2 THEN
            // 手动翻转：竖直缸（手动竖直缸）
            IF bBtn1Edge THEN
                IF 竖直缸上升到位 THEN
                    bC1Ext := TRUE;
                    bC1Ret := FALSE;
                ELSIF 竖直缸下降到位 THEN
                    bC1Ext := FALSE;
                    bC1Ret := TRUE;
                ELSE
                    // 位置未知（卡在中间）：默认缩回原位，便于人工恢复
                    bC1Ext := FALSE;
                    bC1Ret := TRUE;
                END_IF;
            END_IF;
            IF bC1Ext AND 竖直缸下降到位 THEN
                bC1Ext := FALSE;
            END_IF;
            IF bC1Ret AND 竖直缸上升到位 THEN
                bC1Ret := FALSE;
            END_IF;

            // 手动翻转：水平缸（手动水平缸）
            IF bBtn2Edge THEN
                IF 水平左限位 THEN
                    bC2Ext := TRUE;
                    bC2Ret := FALSE;
                ELSIF 水平右限位 THEN
                    bC2Ext := FALSE;
                    bC2Ret := TRUE;
                ELSE
                    // 位置未知（卡在中间）：默认缩回原位，便于人工恢复
                    bC2Ext := FALSE;
                    bC2Ret := TRUE;
                END_IF;
            END_IF;
            IF bC2Ext AND 水平右限位 THEN
                bC2Ext := FALSE;
            END_IF;
            IF bC2Ret AND 水平左限位 THEN
                bC2Ret := FALSE;
            END_IF;

            // 手动翻转：夹爪（手动夹爪）
            IF bBtn3Edge THEN
                IF 夹爪松开到位 THEN
                    bC3Clamp := TRUE;
                ELSIF 夹爪夹紧到位 THEN
                    bC3Clamp := FALSE;
                ELSE
                    // 位置未知（卡在中间）：默认松开回原位，便于人工恢复
                    bC3Clamp := FALSE;
                END_IF;
            END_IF;

        END_IF;

    // ---- 5) 气缸命令（按模式；双电控默认保持，单电控默认松开） ----
    IF nMode <> 2 THEN
    bC1Ext := FALSE;
    bC1Ret := FALSE;
    bC2Ext := FALSE;
    bC2Ret := FALSE;
    bC3Clamp := FALSE;
    END_IF;

    IF nMode = 1 THEN
        CASE nStep OF
            // S1 竖直下降
            1:
        bC1Ext := TRUE;
            // S2 夹爪夹紧
            2:
        bC1Ext := TRUE;
        bC3Clamp := TRUE;
            // S3 竖直上升
            3:
        bC1Ret := TRUE;
        bC3Clamp := TRUE;
            // S4 水平右移
            4:
        bC3Clamp := TRUE;
        bC2Ext := TRUE;
            // S5 右位竖直下降
            5:
        bC1Ext := TRUE;
        bC3Clamp := TRUE;
        bC2Ext := TRUE;
            // S6 夹爪松开
            6:
        bC1Ext := TRUE;
        bC3Clamp := FALSE;
        bC2Ext := TRUE;
            // S7 松开后上升
            7:
        bC1Ret := TRUE;
        bC2Ext := TRUE;
            // S8 水平左移回原位
            8:
        bC2Ret := TRUE;
        END_CASE;
    ELSIF nMode = 3 THEN
        CASE nStopStep OF
            // T1 竖直上升回原位
            1:
        bC1Ext := TRUE;
        bC1Ret := TRUE;
        bC3Clamp := TRUE;
            // T2 水平左移回原位
            2:
        bC2Ext := TRUE;
        bC2Ret := TRUE;
        bC3Clamp := TRUE;
            // T3 夹爪松开
            3:
        bC3Clamp := FALSE;
            // T4 全部输出关闭
            4:
        bC1Ext := TRUE;
        bC1Ret := TRUE;
        bC3Clamp := FALSE;
        bC2Ext := TRUE;
        bC2Ret := TRUE;
        END_CASE;
    END_IF;

    // ---- 6) 气缸 FB 调用（输出 + 5s 超时监视） ----
    // 竖直缸（双电控）
    fbCyl1(bEnable := (nMode = 1) OR (nMode = 2) OR (nMode = 3),
              bCmdExtend := bC1Ext, bCmdRetract := bC1Ret,
              xExtended := 竖直缸下降到位, xRetracted := 竖直缸上升到位,
              tTimeout := T#5000ms,
              nAlarmExt := 10, nAlarmRet := 11,
              bOutExtend => bC1OutExt, bOutRetract => bC1OutRet,
              bAlarm => bC1Alarm, nAlarmCode => nC1AlarmCode);

    // 水平缸（双电控）
    fbCyl2(bEnable := (nMode = 1) OR (nMode = 2) OR (nMode = 3),
              bCmdExtend := bC2Ext, bCmdRetract := bC2Ret,
              xExtended := 水平右限位, xRetracted := 水平左限位,
              tTimeout := T#5000ms,
              nAlarmExt := 20, nAlarmRet := 21,
              bOutExtend => bC2OutExt, bOutRetract => bC2OutRet,
              bAlarm => bC2Alarm, nAlarmCode => nC2AlarmCode);

    // 夹爪（单电控）
    fbCyl3(bEnable := (nMode = 1) OR (nMode = 2) OR (nMode = 3),
              bCmdClamp := bC3Clamp,
              xClamped := 夹爪夹紧到位, xReleased := 夹爪松开到位,
              tTimeout := T#5000ms,
              nAlarmClamp := 30, nAlarmRelease := 31,
              bOutClamp => bC3OutClamp, bAlarm => bC3Alarm, nAlarmCode => nC3AlarmCode);


    // ---- 7) 报警汇总（任一气缸超时 → 冻结步号、等手动处理） ----
    bAlarmAny := bC1Alarm OR bC2Alarm OR bC3Alarm;
    IF bAlarmAny AND NOT bAlarm THEN
        bAlarm := TRUE;
        nMode := 4;
        nAlarmStep := nStep;
        IF bC1Alarm THEN nAlarmCode := nC1AlarmCode;  // 竖直缸
        ELSIF bC2Alarm THEN nAlarmCode := nC2AlarmCode;  // 水平缸
        ELSIF bC3Alarm THEN nAlarmCode := nC3AlarmCode;  // 夹爪
        END_IF;
    bC1Ext := FALSE;
    bC1Ret := FALSE;
    bC2Ext := FALSE;
    bC2Ret := FALSE;
    bC3Clamp := FALSE;
    END_IF;

    // ---- 8) 自动步转移（报警/急停时 nMode 不是自动，流程不跳转） ----
        IF nMode = 1 THEN
            CASE nStep OF
                // S1 竖直下降
                1:
                    IF (竖直缸下降到位) THEN
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
                    IF (夹爪夹紧到位) THEN
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
                    IF (竖直缸上升到位) THEN
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
                    IF (水平右限位) THEN
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
                    IF (竖直缸下降到位) THEN
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
                    IF (夹爪松开到位) THEN
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
                    IF (竖直缸上升到位) THEN
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
                    IF (水平左限位) THEN
                        IF bStopReq THEN
                            nMode := 3;
                            nStopStep := 1;
                            bStopActive := TRUE;
                            bStopReq := FALSE;
                        ELSE
                            nStep := 0;
                            nMode := 0;
                        END_IF;
                    END_IF;
            END_CASE;
        END_IF;

    // ---- 9) 停止序列（按顺序回原点，不直接清输出） ----
        IF nMode = 3 THEN
            CASE nStopStep OF
                // T1 竖直上升回原位
                1:
                    IF (竖直缸上升到位) THEN
                        nStopStep := 2;
                    END_IF;
                // T2 水平左移回原位
                2:
                    IF (水平左限位) THEN
                        nStopStep := 3;
                    END_IF;
                // T3 夹爪松开
                3:
                    IF (夹爪松开到位) THEN
                        nStopStep := 4;
                    END_IF;
                // T4 全部输出关闭
                4:
                    IF (TRUE) THEN
                        nStopStep := 5;
                    END_IF;
                ELSE
                    nMode := 0;
                    nStep := 0;
                    nStopStep := 0;
                    bStopActive := FALSE;
                    bStopReq := FALSE;
            END_CASE;
        END_IF;

    // ---- 输出汇总（Y 只在此处驱动；待机全关，其他模式取 FB 输出） ----
    IF nMode = 0 THEN
        竖直下降电磁阀 := FALSE;
        竖直上升电磁阀 := FALSE;
        水平右移电磁阀 := FALSE;
        水平左移电磁阀 := FALSE;
        夹爪电磁阀 := FALSE;
    ELSE
        竖直下降电磁阀 := bC1OutExt;
        竖直上升电磁阀 := bC1OutRet;
        水平右移电磁阀 := bC2OutExt;
        水平左移电磁阀 := bC2OutRet;
        夹爪电磁阀 := bC3OutClamp;
    END_IF;

    // ---- 11) HMI 状态/数据 ----
    状态待机 := (nMode = 0);
    状态自动 := (nMode = 1);
    状态手动 := (nMode = 2);
    状态停止中 := (nMode = 3);
    状态报警 := bAlarm;
    状态急停暂停 := bEStopPause;
    当前步号 := nStep;
    当前模式 := nMode;
    报警代码 := nAlarmCode;
    报警步号 := nAlarmStep;

END_PROGRAM
