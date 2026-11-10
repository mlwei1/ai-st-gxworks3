(* ---------- 本 POU 需在「标签设置」工作表建立的局部标签 ----------
   输入   bEnable : BOOL
   输入   nTarget : INT
   输出   bRunning : BOOL
   输出   nSpeed : INT
   局部   tRampTimer : TON
   局部   nRampStep : INT := 0
(* ----------------------------------------------------------- *)

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