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
    b使能 : BOOL;                    // 允许动作/监视（自动/停止中/手动）
    b伸出命令 : BOOL;                 // 命令伸出
    b缩回命令 : BOOL;                // 命令缩回
    x伸出到位 : BOOL;                  // 伸出到位磁性开关
    x原位到位 : BOOL;                 // 原位磁性开关
    t超时 : TIME := T#5s;           // 动作超时
    n伸出报警码 : INT := 100;            // 伸出超时报警码
    n缩回报警码 : INT := 101;            // 缩回超时报警码
END_VAR
VAR_OUTPUT
    b伸出输出 : BOOL;                 // 伸出输出（驱动 Y）
    b缩回输出 : BOOL;                // 缩回输出（驱动 Y）
    b报警 : BOOL;                     // 超时报警
    n报警码 : INT;                  // 报警码
END_VAR
VAR
    t伸出超时 : TON;
    t缩回超时 : TON;
END_VAR
    // 输出（b使能=FALSE 时保持输出，配合报警/急停冻结）
    IF b使能 THEN
        b伸出输出 := b伸出命令;
        b缩回输出 := b缩回命令;
    END_IF;

    // 超时监视
    t伸出超时(IN := b使能 AND b伸出命令 AND NOT x伸出到位, PT := t超时);
    t缩回超时(IN := b使能 AND b缩回命令 AND NOT x原位到位, PT := t超时);

    b报警 := FALSE;
    IF t伸出超时.Q THEN
        b报警 := TRUE;
        n报警码 := n伸出报警码;
    ELSIF t缩回超时.Q THEN
        b报警 := TRUE;
        n报警码 := n缩回报警码;
    END_IF;
END_FUNCTION_BLOCK

// ============================================================
// 气缸功能块（单电控/弹簧复位）：夹紧输出 + 双向超时报警
// ============================================================
FUNCTION_BLOCK FB_CylinderSV
VAR_INPUT
    b使能 : BOOL;                    // 允许动作/监视（自动/停止中/手动）
    b夹紧命令 : BOOL;                  // 命令夹紧（FALSE=松开）
    x夹紧到位 : BOOL;                   // 夹紧到位磁性开关
    x松开到位 : BOOL;                  // 松开到位磁性开关
    t超时 : TIME := T#5s;           // 动作超时
    n夹紧报警码 : INT := 100;          // 夹紧超时报警码
    n松开报警码 : INT := 101;        // 松开超时报警码
END_VAR
VAR_OUTPUT
    b夹紧输出 : BOOL;                  // 夹紧输出（驱动 Y）
    b报警 : BOOL;                     // 超时报警
    n报警码 : INT;                  // 报警码
END_VAR
VAR
    t夹紧超时 : TON;
    t松开超时 : TON;
END_VAR
    // 输出（b使能=FALSE 时保持输出）
    IF b使能 THEN
        b夹紧输出 := b夹紧命令;
    END_IF;

    // 超时监视
    t夹紧超时(IN := b使能 AND b夹紧命令 AND NOT x夹紧到位, PT := t超时);
    t松开超时(IN := b使能 AND NOT b夹紧命令 AND NOT x松开到位, PT := t超时);

    b报警 := FALSE;
    IF t夹紧超时.Q THEN
        b报警 := TRUE;
        n报警码 := n夹紧报警码;
    ELSIF t松开超时.Q THEN
        b报警 := TRUE;
        n报警码 := n松开报警码;
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
    n模式 : INT := 0;                   // 0待机 1自动 2手动 3停止中 4报警 5急停暂停
    n步号 : INT := 0;                       // 自动步号（0=待机）
    n停止步号 : INT := 0;                   // 停止序列步号
    b停止请求 : BOOL := FALSE;               // 停止请求（当前步完成后进入停止序列）
    b停止序列启动 : BOOL := FALSE;            // 停止序列已启动
    b报警 : BOOL := FALSE;                 // 报警锁存
    b存在报警 : BOOL := FALSE;              // 任一气缸超时
    n报警码 : INT := 0;                  // 报警代码
    n报警步号 : INT := 0;                  // 报警时冻结的步号
    b急停暂停 : BOOL := FALSE;            // 急停暂停标志
    b气缸位置正常 : BOOL := FALSE;                 // 所有气缸位置已知（复位/继续条件）

    // ---- HMI 命令上升沿 ----
    b启动上次 : BOOL := FALSE;
    b停止上次 : BOOL := FALSE;
    b复位上次 : BOOL := FALSE;
    b手动上次 : BOOL := FALSE;
    b退出手动上次 : BOOL := FALSE;
    b继续上次 : BOOL := FALSE;
    b从头上次 : BOOL := FALSE;
    b手动竖直缸上次 : BOOL := FALSE;
    b手动水平缸上次 : BOOL := FALSE;
    b手动夹爪上次 : BOOL := FALSE;

    // ---- HMI 命令上升沿标志 ----
    b启动上升沿 : BOOL := FALSE;
    b停止上升沿 : BOOL := FALSE;
    b复位上升沿 : BOOL := FALSE;
    b手动上升沿 : BOOL := FALSE;
    b退出手动上升沿 : BOOL := FALSE;
    b继续上升沿 : BOOL := FALSE;
    b从头上升沿 : BOOL := FALSE;
    b手动竖直缸上升沿 : BOOL := FALSE;
    b手动水平缸上升沿 : BOOL := FALSE;
    b手动夹爪上升沿 : BOOL := FALSE;

    // ---- 气缸命令（自动/停止序列/手动共用） ----
    b竖直缸伸出命令 : BOOL := FALSE;             // 竖直缸：伸出命令
    b竖直缸缩回命令 : BOOL := FALSE;             // 竖直缸：缩回命令
    b水平缸伸出命令 : BOOL := FALSE;             // 水平缸：伸出命令
    b水平缸缩回命令 : BOOL := FALSE;             // 水平缸：缩回命令
    b夹爪夹紧命令 : BOOL := FALSE;            // 夹爪：夹紧命令（FALSE=松开）

    // ---- FB 输出/报警 ----
    b竖直缸伸出输出 : BOOL := FALSE;
    b竖直缸缩回输出 : BOOL := FALSE;
    b竖直缸报警 : BOOL := FALSE;
    n竖直缸报警码 : INT := 0;
    b水平缸伸出输出 : BOOL := FALSE;
    b水平缸缩回输出 : BOOL := FALSE;
    b水平缸报警 : BOOL := FALSE;
    n水平缸报警码 : INT := 0;
    b夹爪夹紧输出 : BOOL := FALSE;
    b夹爪报警 : BOOL := FALSE;
    n夹爪报警码 : INT := 0;

    // ---- FB 实例 ----
    fb竖直缸 : FB_Cylinder;  // 竖直缸
    fb水平缸 : FB_Cylinder;  // 水平缸
    fb夹爪 : FB_CylinderSV;  // 夹爪
END_VAR

    // ---- 1) HMI 命令上升沿 ----
    b启动上升沿 := 触摸屏启动 AND NOT b启动上次;
    b启动上次 := 触摸屏启动;
    b停止上升沿 := 触摸屏停止 AND NOT b停止上次;
    b停止上次 := 触摸屏停止;
    b复位上升沿 := 触摸屏复位 AND NOT b复位上次;
    b复位上次 := 触摸屏复位;
    b手动上升沿 := 触摸屏手动 AND NOT b手动上次;
    b手动上次 := 触摸屏手动;
    b退出手动上升沿 := 触摸屏退出手动 AND NOT b退出手动上次;
    b退出手动上次 := 触摸屏退出手动;
    b继续上升沿 := 触摸屏继续 AND NOT b继续上次;
    b继续上次 := 触摸屏继续;
    b从头上升沿 := 触摸屏从头 AND NOT b从头上次;
    b从头上次 := 触摸屏从头;
    b手动竖直缸上升沿 := 手动竖直缸 AND NOT b手动竖直缸上次;
    b手动竖直缸上次 := 手动竖直缸;
    b手动水平缸上升沿 := 手动水平缸 AND NOT b手动水平缸上次;
    b手动水平缸上次 := 手动水平缸;
    b手动夹爪上升沿 := 手动夹爪 AND NOT b手动夹爪上次;
    b手动夹爪上次 := 手动夹爪;

    // ---- 2) 急停：任何模式立即暂停，冻结步号 ----
    IF 急停 THEN
        IF n模式 <> 5 THEN
            n模式 := 5;
            b急停暂停 := TRUE;
        END_IF;
    END_IF;

    // ---- 3) 模式与 HMI 命令 ----
    b气缸位置正常 := ((竖直缸下降到位) OR (竖直缸上升到位)) AND ((水平右限位) OR (水平左限位)) AND ((夹爪夹紧到位) OR (夹爪松开到位));

    // 待机：启动/切手动
    IF n模式 = 0 THEN
        IF b启动上升沿 THEN
            n步号 := 1;
            n模式 := 1;
            b停止请求 := FALSE;
            b停止序列启动 := FALSE;
            b报警 := FALSE;
            b急停暂停 := FALSE;
            n报警码 := 0;
            n报警步号 := 0;
        END_IF;
        IF b手动上升沿 AND NOT 急停 THEN
            n模式 := 2;
            b竖直缸伸出命令 := FALSE;
            b竖直缸缩回命令 := FALSE;
            b水平缸伸出命令 := FALSE;
            b水平缸缩回命令 := FALSE;
            b夹爪夹紧命令 := (夹爪夹紧到位);  // 保持当前夹紧状态
        END_IF;
    END_IF;

    // 自动：停止请求（当前步完成后进入停止序列）
    IF n模式 = 1 THEN
        IF b停止上升沿 THEN
            b停止请求 := TRUE;
        END_IF;
    END_IF;

    // 报警/急停暂停：切手动处理、停止、从头开始
    IF (n模式 = 4) OR (n模式 = 5) THEN
        IF b手动上升沿 AND NOT 急停 THEN
            n模式 := 2;
            b竖直缸伸出命令 := FALSE;
            b竖直缸缩回命令 := FALSE;
            b水平缸伸出命令 := FALSE;
            b水平缸缩回命令 := FALSE;
            b夹爪夹紧命令 := (夹爪夹紧到位);  // 保持当前夹紧状态
        END_IF;
        IF b停止上升沿 THEN
            n模式 := 3;
            IF NOT b停止序列启动 THEN
                n停止步号 := 1;
                b停止序列启动 := TRUE;
            END_IF;
        END_IF;
        IF b从头上升沿 THEN
            n模式 := 0;
            n步号 := 0;
            n停止步号 := 0;
            b停止序列启动 := FALSE;
            b停止请求 := FALSE;
            b报警 := FALSE;
            b急停暂停 := FALSE;
            n报警码 := 0;
            n报警步号 := 0;
            b竖直缸伸出命令 := FALSE;
            b竖直缸缩回命令 := FALSE;
            b水平缸伸出命令 := FALSE;
            b水平缸缩回命令 := FALSE;
            b夹爪夹紧命令 := FALSE;
        END_IF;
    END_IF;

    // 手动：清故障、退出手动、继续/停止/从头
    IF n模式 = 2 THEN
        IF b复位上升沿 AND b气缸位置正常 AND NOT 急停 THEN
            b报警 := FALSE;
            b急停暂停 := FALSE;
            n报警码 := 0;
            n报警步号 := 0;
        END_IF;
        IF b退出手动上升沿 AND b气缸位置正常 AND NOT b报警 AND NOT b急停暂停 AND NOT 急停 THEN
            n模式 := 0;
            n步号 := 0;
            b停止序列启动 := FALSE;
        END_IF;
        IF b继续上升沿 AND b气缸位置正常 AND NOT b报警 AND NOT b急停暂停 AND NOT 急停 THEN
            IF b停止序列启动 THEN
                n模式 := 3;
            ELSE
                n模式 := 1;
            END_IF;
            b停止请求 := FALSE;
        END_IF;
        IF b停止上升沿 THEN
            n模式 := 3;
            IF NOT b停止序列启动 THEN
                n停止步号 := 1;
                b停止序列启动 := TRUE;
            END_IF;
        END_IF;
        IF b从头上升沿 THEN
            n模式 := 0;
            n步号 := 0;
            n停止步号 := 0;
            b停止序列启动 := FALSE;
            b停止请求 := FALSE;
            b报警 := FALSE;
            b急停暂停 := FALSE;
            n报警码 := 0;
            n报警步号 := 0;
            b竖直缸伸出命令 := FALSE;
            b竖直缸缩回命令 := FALSE;
            b水平缸伸出命令 := FALSE;
            b水平缸缩回命令 := FALSE;
            b夹爪夹紧命令 := FALSE;
        END_IF;
    END_IF;

    // 急停仍按住时禁止任何模式切换
    IF 急停 THEN
        n模式 := 5;
    END_IF;

    // ---- 4) 手动翻转（仅手动模式） ----
        IF n模式 = 2 THEN
            // 手动翻转：竖直缸（手动竖直缸）
            IF b手动竖直缸上升沿 THEN
                IF 竖直缸上升到位 THEN
                    b竖直缸伸出命令 := TRUE;
                    b竖直缸缩回命令 := FALSE;
                ELSIF 竖直缸下降到位 THEN
                    b竖直缸伸出命令 := FALSE;
                    b竖直缸缩回命令 := TRUE;
                ELSE
                    // 位置未知（卡在中间）：默认缩回原位，便于人工恢复
                    b竖直缸伸出命令 := FALSE;
                    b竖直缸缩回命令 := TRUE;
                END_IF;
            END_IF;
            IF b竖直缸伸出命令 AND 竖直缸下降到位 THEN
                b竖直缸伸出命令 := FALSE;
            END_IF;
            IF b竖直缸缩回命令 AND 竖直缸上升到位 THEN
                b竖直缸缩回命令 := FALSE;
            END_IF;

            // 手动翻转：水平缸（手动水平缸）
            IF b手动水平缸上升沿 THEN
                IF 水平左限位 THEN
                    b水平缸伸出命令 := TRUE;
                    b水平缸缩回命令 := FALSE;
                ELSIF 水平右限位 THEN
                    b水平缸伸出命令 := FALSE;
                    b水平缸缩回命令 := TRUE;
                ELSE
                    // 位置未知（卡在中间）：默认缩回原位，便于人工恢复
                    b水平缸伸出命令 := FALSE;
                    b水平缸缩回命令 := TRUE;
                END_IF;
            END_IF;
            IF b水平缸伸出命令 AND 水平右限位 THEN
                b水平缸伸出命令 := FALSE;
            END_IF;
            IF b水平缸缩回命令 AND 水平左限位 THEN
                b水平缸缩回命令 := FALSE;
            END_IF;

            // 手动翻转：夹爪（手动夹爪）
            IF b手动夹爪上升沿 THEN
                IF 夹爪松开到位 THEN
                    b夹爪夹紧命令 := TRUE;
                ELSIF 夹爪夹紧到位 THEN
                    b夹爪夹紧命令 := FALSE;
                ELSE
                    // 位置未知（卡在中间）：默认松开回原位，便于人工恢复
                    b夹爪夹紧命令 := FALSE;
                END_IF;
            END_IF;

        END_IF;

    // ---- 5) 气缸命令（按模式；双电控默认保持，单电控默认松开） ----
    IF n模式 <> 2 THEN
    b竖直缸伸出命令 := FALSE;
    b竖直缸缩回命令 := FALSE;
    b水平缸伸出命令 := FALSE;
    b水平缸缩回命令 := FALSE;
    b夹爪夹紧命令 := FALSE;
    END_IF;

    IF n模式 = 1 THEN
        CASE n步号 OF
            // S1 竖直下降
            1:
        b竖直缸伸出命令 := TRUE;
            // S2 夹爪夹紧
            2:
        b竖直缸伸出命令 := TRUE;
        b夹爪夹紧命令 := TRUE;
            // S3 竖直上升
            3:
        b竖直缸缩回命令 := TRUE;
        b夹爪夹紧命令 := TRUE;
            // S4 水平右移
            4:
        b夹爪夹紧命令 := TRUE;
        b水平缸伸出命令 := TRUE;
            // S5 右位竖直下降
            5:
        b竖直缸伸出命令 := TRUE;
        b夹爪夹紧命令 := TRUE;
        b水平缸伸出命令 := TRUE;
            // S6 夹爪松开
            6:
        b竖直缸伸出命令 := TRUE;
        b夹爪夹紧命令 := FALSE;
        b水平缸伸出命令 := TRUE;
            // S7 松开后上升
            7:
        b竖直缸缩回命令 := TRUE;
        b水平缸伸出命令 := TRUE;
            // S8 水平左移回原位
            8:
        b水平缸缩回命令 := TRUE;
        END_CASE;
    ELSIF n模式 = 3 THEN
        CASE n停止步号 OF
            // T1 竖直上升回原位
            1:
        b竖直缸伸出命令 := TRUE;
        b竖直缸缩回命令 := TRUE;
        b夹爪夹紧命令 := TRUE;
            // T2 水平左移回原位
            2:
        b水平缸伸出命令 := TRUE;
        b水平缸缩回命令 := TRUE;
        b夹爪夹紧命令 := TRUE;
            // T3 夹爪松开
            3:
        b夹爪夹紧命令 := FALSE;
            // T4 全部输出关闭
            4:
        b竖直缸伸出命令 := TRUE;
        b竖直缸缩回命令 := TRUE;
        b夹爪夹紧命令 := FALSE;
        b水平缸伸出命令 := TRUE;
        b水平缸缩回命令 := TRUE;
        END_CASE;
    END_IF;

    // ---- 6) 气缸 FB 调用（输出 + 5s 超时监视） ----
    // 竖直缸（双电控）
    fb竖直缸(b使能 := (n模式 = 1) OR (n模式 = 2) OR (n模式 = 3),
              b伸出命令 := b竖直缸伸出命令, b缩回命令 := b竖直缸缩回命令,
              x伸出到位 := 竖直缸下降到位, x原位到位 := 竖直缸上升到位,
              t超时 := T#5000ms,
              n伸出报警码 := 10, n缩回报警码 := 11,
              b伸出输出 => b竖直缸伸出输出, b缩回输出 => b竖直缸缩回输出,
              b报警 => b竖直缸报警, n报警码 => n竖直缸报警码);

    // 水平缸（双电控）
    fb水平缸(b使能 := (n模式 = 1) OR (n模式 = 2) OR (n模式 = 3),
              b伸出命令 := b水平缸伸出命令, b缩回命令 := b水平缸缩回命令,
              x伸出到位 := 水平右限位, x原位到位 := 水平左限位,
              t超时 := T#5000ms,
              n伸出报警码 := 20, n缩回报警码 := 21,
              b伸出输出 => b水平缸伸出输出, b缩回输出 => b水平缸缩回输出,
              b报警 => b水平缸报警, n报警码 => n水平缸报警码);

    // 夹爪（单电控）
    fb夹爪(b使能 := (n模式 = 1) OR (n模式 = 2) OR (n模式 = 3),
              b夹紧命令 := b夹爪夹紧命令,
              x夹紧到位 := 夹爪夹紧到位, x松开到位 := 夹爪松开到位,
              t超时 := T#5000ms,
              n夹紧报警码 := 30, n松开报警码 := 31,
              b夹紧输出 => b夹爪夹紧输出, b报警 => b夹爪报警, n报警码 => n夹爪报警码);


    // ---- 7) 报警汇总（任一气缸超时 → 冻结步号、等手动处理） ----
    b存在报警 := b竖直缸报警 OR b水平缸报警 OR b夹爪报警;
    IF b存在报警 AND NOT b报警 THEN
        b报警 := TRUE;
        n模式 := 4;
        n报警步号 := n步号;
        IF b竖直缸报警 THEN n报警码 := n竖直缸报警码;  // 竖直缸
        ELSIF b水平缸报警 THEN n报警码 := n水平缸报警码;  // 水平缸
        ELSIF b夹爪报警 THEN n报警码 := n夹爪报警码;  // 夹爪
        END_IF;
    b竖直缸伸出命令 := FALSE;
    b竖直缸缩回命令 := FALSE;
    b水平缸伸出命令 := FALSE;
    b水平缸缩回命令 := FALSE;
    b夹爪夹紧命令 := FALSE;
    END_IF;

    // ---- 8) 自动步转移（报警/急停时 n模式 不是自动，流程不跳转） ----
        IF n模式 = 1 THEN
            CASE n步号 OF
                // S1 竖直下降
                1:
                    IF (竖直缸下降到位) THEN
                        IF b停止请求 THEN
                            n模式 := 3;
                            n停止步号 := 1;
                            b停止序列启动 := TRUE;
                            b停止请求 := FALSE;
                        ELSE
                            n步号 := 2;
                        END_IF;
                    END_IF;
                // S2 夹爪夹紧
                2:
                    IF (夹爪夹紧到位) THEN
                        IF b停止请求 THEN
                            n模式 := 3;
                            n停止步号 := 1;
                            b停止序列启动 := TRUE;
                            b停止请求 := FALSE;
                        ELSE
                            n步号 := 3;
                        END_IF;
                    END_IF;
                // S3 竖直上升
                3:
                    IF (竖直缸上升到位) THEN
                        IF b停止请求 THEN
                            n模式 := 3;
                            n停止步号 := 1;
                            b停止序列启动 := TRUE;
                            b停止请求 := FALSE;
                        ELSE
                            n步号 := 4;
                        END_IF;
                    END_IF;
                // S4 水平右移
                4:
                    IF (水平右限位) THEN
                        IF b停止请求 THEN
                            n模式 := 3;
                            n停止步号 := 1;
                            b停止序列启动 := TRUE;
                            b停止请求 := FALSE;
                        ELSE
                            n步号 := 5;
                        END_IF;
                    END_IF;
                // S5 右位竖直下降
                5:
                    IF (竖直缸下降到位) THEN
                        IF b停止请求 THEN
                            n模式 := 3;
                            n停止步号 := 1;
                            b停止序列启动 := TRUE;
                            b停止请求 := FALSE;
                        ELSE
                            n步号 := 6;
                        END_IF;
                    END_IF;
                // S6 夹爪松开
                6:
                    IF (夹爪松开到位) THEN
                        IF b停止请求 THEN
                            n模式 := 3;
                            n停止步号 := 1;
                            b停止序列启动 := TRUE;
                            b停止请求 := FALSE;
                        ELSE
                            n步号 := 7;
                        END_IF;
                    END_IF;
                // S7 松开后上升
                7:
                    IF (竖直缸上升到位) THEN
                        IF b停止请求 THEN
                            n模式 := 3;
                            n停止步号 := 1;
                            b停止序列启动 := TRUE;
                            b停止请求 := FALSE;
                        ELSE
                            n步号 := 8;
                        END_IF;
                    END_IF;
                // S8 水平左移回原位
                8:
                    IF (水平左限位) THEN
                        IF b停止请求 THEN
                            n模式 := 3;
                            n停止步号 := 1;
                            b停止序列启动 := TRUE;
                            b停止请求 := FALSE;
                        ELSE
                            n步号 := 0;
                            n模式 := 0;
                        END_IF;
                    END_IF;
            END_CASE;
        END_IF;

    // ---- 9) 停止序列（按顺序回原点，不直接清输出） ----
        IF n模式 = 3 THEN
            CASE n停止步号 OF
                // T1 竖直上升回原位
                1:
                    IF (竖直缸上升到位) THEN
                        n停止步号 := 2;
                    END_IF;
                // T2 水平左移回原位
                2:
                    IF (水平左限位) THEN
                        n停止步号 := 3;
                    END_IF;
                // T3 夹爪松开
                3:
                    IF (夹爪松开到位) THEN
                        n停止步号 := 4;
                    END_IF;
                // T4 全部输出关闭
                4:
                    IF (TRUE) THEN
                        n停止步号 := 5;
                    END_IF;
                ELSE
                    n模式 := 0;
                    n步号 := 0;
                    n停止步号 := 0;
                    b停止序列启动 := FALSE;
                    b停止请求 := FALSE;
            END_CASE;
        END_IF;

    // ---- 输出汇总（Y 只在此处驱动；待机全关，其他模式取 FB 输出） ----
    IF n模式 = 0 THEN
        竖直下降电磁阀 := FALSE;
        竖直上升电磁阀 := FALSE;
        水平右移电磁阀 := FALSE;
        水平左移电磁阀 := FALSE;
        夹爪电磁阀 := FALSE;
    ELSE
        竖直下降电磁阀 := b竖直缸伸出输出;
        竖直上升电磁阀 := b竖直缸缩回输出;
        水平右移电磁阀 := b水平缸伸出输出;
        水平左移电磁阀 := b水平缸缩回输出;
        夹爪电磁阀 := b夹爪夹紧输出;
    END_IF;

    // ---- 11) HMI 状态/数据 ----
    状态待机 := (n模式 = 0);
    状态自动 := (n模式 = 1);
    状态手动 := (n模式 = 2);
    状态停止中 := (n模式 = 3);
    状态报警 := b报警;
    状态急停暂停 := b急停暂停;
    当前步号 := n步号;
    当前模式 := n模式;
    报警代码 := n报警码;
    报警步号 := n报警步号;

END_PROGRAM
