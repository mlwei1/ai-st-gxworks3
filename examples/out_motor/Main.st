(* ---------- 本 POU 需在「标签设置」工作表建立的局部标签 ----------
   局部   bStart : BOOL := FALSE
   局部   bStop : BOOL := FALSE
   局部   bReset : BOOL := FALSE
   局部   bFault : BOOL := FALSE
   局部   bAutoStop : BOOL := FALSE
   局部   tRunTimer : TON
   局部   stMotor : ST_Motor
   局部   nStep : INT := 0
(* ----------------------------------------------------------- *)

IF bFault THEN
    Y0 := FALSE;
    nStep := 0;
    RETURN;
END_IF;
CASE nStep OF
    0:
        IF bStart THEN
            nStep := 1;
        END_IF;
    1:
        tRunTimer(IN := TRUE, PT := T#10s);
        IF tRunTimer.Q OR bStop THEN
            nStep := 2;
        END_IF;
    2:
        tRunTimer(IN := FALSE, PT := T#10s);
        nStep := 0;
END_CASE;
CASE nStep OF
    1:
        Y0 := TRUE;
ELSE
    Y0 := FALSE;
END_CASE;