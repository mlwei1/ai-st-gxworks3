(*
  三菱 FX5U 示例 —— FB 实例调用验证
  演示：Program 中声明 FB 实例、调用 FB、访问 FB 输出成员
*)

FUNCTION_BLOCK FB_Motor
VAR_INPUT
    bEnable : BOOL;
    nTarget : INT;
END_VAR
VAR_OUTPUT
    bRunning : BOOL;
    nSpeed : INT;
END_VAR
    IF bEnable THEN
        bRunning := TRUE;
        nSpeed := nTarget;
    ELSE
        bRunning := FALSE;
        nSpeed := 0;
    END_IF;
END_FUNCTION_BLOCK

PROGRAM Main
VAR
    bStart : BOOL;
    fbMotor : FB_Motor;
END_VAR
    fbMotor(bEnable := bStart, nTarget := 100);
    IF fbMotor.bRunning THEN
        Y0 := TRUE;
    ELSE
        Y0 := FALSE;
    END_IF;
END_PROGRAM
