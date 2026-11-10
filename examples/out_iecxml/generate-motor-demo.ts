/**
 * 用 examples/motor_demo.st 的语义构造最小 DTO，生成 examples/out_iecxml/motor_demo.xml。
 * 仅用于产生「样例产物」并给 scripts/validate-iecxml.py 做校验输入；
 * 不解析 ST（example 的 body 文本手工取自 motor_demo.st 的 PROGRAM Main 本体）。
 *
 * 运行：node --experimental-strip-types --no-warnings examples/out_iecxml/generate-motor-demo.ts
 */
import { fileURLToPath } from 'node:url';

import { writeIecXmlFile, type IecXmlProject } from '../../src/emit/iecxml.ts';

const bodySt = `    (* 故障优先处理：任何故障都立即停机 *)
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
    END_CASE;`;

const project: IecXmlProject = {
  // 与 motor_demo.st 对应的最小自包含 DTO（FX5U / ST）
  programs: [
    {
      name: 'Main',
      comment: '三相电机启停控制（来自 examples/motor_demo.st）',
      vars: [
        { name: 'bStart', type: 'BOOL', initial: 'FALSE', comment: '启动按钮' },
        { name: 'bStop', type: 'BOOL', initial: 'FALSE', comment: '停止按钮' },
        { name: 'bReset', type: 'BOOL', initial: 'FALSE', comment: '复位按钮' },
        { name: 'bFault', type: 'BOOL', initial: 'FALSE', comment: '故障标志' },
        { name: 'bAutoStop', type: 'BOOL', initial: 'FALSE', comment: '自动停止' },
        { name: 'tRunTimer', type: 'TON', comment: '运行定时器' },
        { name: 'stMotor', type: 'ST_Motor', comment: '电机状态' },
        { name: 'nStep', type: 'INT', initial: '0', comment: '状态机步进' },
      ],
      bodySt,
    },
  ],
  types: [
    {
      name: 'ST_Motor',
      comment: '电机状态结构体',
      members: [
        { name: 'bRunning', type: 'BOOL', comment: '运行中' },
        { name: 'bFault', type: 'BOOL', comment: '故障' },
        { name: 'nSpeed', type: 'INT', comment: '转速' },
      ],
    },
  ],
  globalVars: [
    { name: 'nSpeedSet', type: 'INT', initial: '100', address: 'D200', comment: '速度设定' },
    { name: 'nActualSpeed', type: 'INT', initial: '0', address: 'D201', comment: '实际速度' },
  ],
  meta: {
    contentName: 'motor_demo',
    productVersion: 'ver.1.0',
  },
};

const outPath = fileURLToPath(new URL('./motor_demo.xml', import.meta.url));
writeIecXmlFile(project, outPath);
console.log(`written: ${outPath}`);
