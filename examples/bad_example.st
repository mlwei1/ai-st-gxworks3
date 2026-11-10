(*
  反例文件 —— 演示 ai-st-gxworks3 的方言检查能拦住什么。
  这段代码模拟「AI 直接按 CODESYS / 通用 IEC 习惯生成」的典型错误。
*)

PROGRAM BadExample
VAR
    bStart : BOOL := FALSE;
    bStop : BOOL := FALSE;
    bRun : BOOL := FALSE;
    nSpeed : INT := 0;
    fLevel : REAL := 0.0;
    nLevel : INT := 0;
    tTimer : TON;
    fbLatch : RS;
END_VAR
    (* 错误 1：整数直接赋给 REAL，三菱不做隐式转换，编译不通过 *)
    fLevel := nLevel;

    (* 错误 2：实数直接赋给整数，同样需要显式转换 *)
    nLevel := fLevel;

    (* 错误 3：RS 触发器的形参名写错。
       IEC 标准是 S / R1 / Q1，不是 SET / RESET1 / Q *)
    fbLatch(SET := bStart, RESET1 := bStop, Q => bRun);

    (* 错误 4：未声明的变量 *)
    nUndeclared := 100;

    (* 错误 5：设备地址越界，FX5U 的 X 只有 X0-X511 *)
    X999 := TRUE;

    (* 错误 6：保留字做变量名 *)
    IF := 1;

    (* 错误 7：布尔量赋值数字 *)
    bRun := 1;

    (* 错误 8：跨品牌函数，西门子的 IREF 在三菱不存在 *)
    nPointer := IREF(X0, 1);

    (* 错误 9：定时器形参名错误，应为 IN / PT *)
    tTimer(INPUT := TRUE, PRESET := T#1s);

    (* 错误 10：CASE 选择器类型不对 *)
    CASE bStart OF
        1: nSpeed := 10;
    END_CASE;
END_PROGRAM
