// 扫描/时钟诊断探针：D0=扫描计数（应递增），D1=TON 1s 计数（应递增），D2=SM412 计数
PROGRAM Main
VAR
    nScan : INT := 0;
    tTick : TON;
    nTonCount : INT := 0;
    nSmCount : INT := 0;
END_VAR
    nScan := nScan + 1;
    D0 := nScan;

    tTick(IN := NOT tTick.Q, PT := T#1s);
    IF tTick.Q THEN
        nTonCount := nTonCount + 1;
    END_IF;
    D1 := nTonCount;

    IF SM412 THEN
        nSmCount := nSmCount + 1;
    END_IF;
    D2 := nSmCount;
END_PROGRAM
