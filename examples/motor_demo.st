(*
  三菱 FX5U 示例程序 —— 三相电机启停控制
  演示：状态机 + 定时器 + 故障联锁
*)

TYPE ST_Motor:
STRUCT
    bRunning : BOOL;
    bFault : BOOL;
    nSpeed : INT;
END_STRUCT
END_TYPE

VAR_GLOBAL
    nSpeedSet : INT AT D200 RETAIN := 100; // 速度设定
    nActualSpeed : INT AT D201 RETAIN := 0; // 实际速度
END_VAR

PROGRAM Main
VAR
    bStart : BOOL := FALSE;
    bStop : BOOL := FALSE;
    bReset : BOOL := FALSE;
    bFault : BOOL := FALSE;
    bAutoStop : BOOL := FALSE;
    tRunTimer : TON;
    stMotor : ST_Motor;
    nStep : INT := 0;
END_VAR
    (* 故障优先处理：任何故障都立即停机 *)
    IF bFault THEN
        Y0 := FALSE;
        nStep := 0;
        RETURN;
    END_IF;

    CASE nStep OF
        0: (* 待机 *)
            IF bStart THEN
                nStep := 1;
            END_IF;

        1: (* 运行 *)
            tRunTimer(IN := TRUE, PT := T#10s);
            IF tRunTimer.Q OR bStop THEN
                nStep := 2;
            END_IF;

        2: (* 停机 *)
            tRunTimer(IN := FALSE, PT := T#10s);
            nStep := 0;
    END_CASE;

    (* 输出驱动 *)
    CASE nStep OF
        1: Y0 := TRUE;
        ELSE Y0 := FALSE;
    END_CASE;
END_PROGRAM

FUNCTION_BLOCK FB_Motor
VAR_INPUT
    bEnable : BOOL;
    nTarget : INT;
END_VAR
VAR_OUTPUT
    bRunning : BOOL;
    nSpeed : INT;
END_VAR
VAR
    tRampTimer : TON;
    nRampStep : INT := 0;
END_VAR
    IF bEnable THEN
        tRampTimer(IN := TRUE, PT := T#100ms);
        IF tRampTimer.Q THEN
            tRampTimer(IN := FALSE, PT := T#100ms);
            nRampStep := nRampStep + 10;
            IF nRampStep >= nTarget THEN
                nRampStep := nTarget;
            END_IF;
        END_IF;
        nSpeed := nRampStep;
        bRunning := TRUE;
    ELSE
        nSpeed := 0;
        nRampStep := 0;
        bRunning := FALSE;
    END_IF;
END_FUNCTION_BLOCK
