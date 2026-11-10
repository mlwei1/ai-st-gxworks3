/**
 * IEC 61131-10 XML 发射器测试（自包含，不依赖 GX Works3 安装路径/官方 Sample.xml）。
 * 运行：node --experimental-strip-types --no-warnings --test test/iecxml.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_TIMESTAMP, emitIecXml, escapeXmlText, type IecXmlProject } from '../src/emit/iecxml.ts';

function baseProject(): IecXmlProject {
  return {
    programs: [
      {
        name: 'Main',
        comment: '主程序',
        vars: [
          { name: 'bStart', type: 'BOOL', initial: 'FALSE' },
          { name: 'nStep', type: 'INT', initial: '0', address: 'D100', comment: '步进' },
        ],
        bodySt: 'IF bStart THEN\n    nStep := 1;\nEND_IF;',
      },
    ],
    types: [{ name: 'ST_Motor', members: [{ name: 'bRunning', type: 'BOOL' }, { name: 'nSpeed', type: 'INT' }] }],
    globalVars: [{ name: 'gSpeedSet', type: 'INT', initial: '100', address: 'D200' }],
  };
}

test('根元素/命名空间/schemaLocation/xsi:type 正确', () => {
  const xml = emitIecXml(baseProject());
  assert.match(xml, /^<\?xml version="1\.0" encoding="utf-8"\?>\n/);
  assert.ok(
    xml.includes(
      '<Project xmlns="www.iec.ch/public/TC65SC65BWG7TF10" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
        'schemaVersion="1.000" xsi:schemaLocation="www.iec.ch/public/TC65SC65BWG7TF10 GXW3_IEC61131_10_Ed1_0_ForGXW3.xsd">',
    ),
  );
  assert.ok(xml.includes('<FileHeader companyName="MITSUBISHI ELECTRIC CORPORATION"'));
  assert.ok(xml.includes('<ContentHeader name="AI-ST Project"'));
  assert.ok(xml.includes('<Vars accessSpecifier="private">'));
  assert.ok(xml.includes('<BodyContent xsi:type="ST">'));
  assert.ok(xml.includes('<UserDefinedTypeSpec xsi:type="StructTypeSpec">'));
  // 程序文件必须循环执行：scan（真机仿真验证发现 initial 只执行一次）
  assert.ok(xml.includes('<ResourceExecutionType type="scan"/>'));
});

test('ST 正文转义 < > &，且不产生未转义标记', () => {
  const project = baseProject();
  project.programs[0]!.bodySt = 'IF a < b AND c > d THEN x := x & y; END_IF;';
  const xml = emitIecXml(project);
  assert.ok(xml.includes('<ST>IF a &lt; b AND c &gt; d THEN x := x &amp; y; END_IF;</ST>'));
  assert.ok(!xml.includes('a < b AND'));
  assert.equal(escapeXmlText('&<>"\''), '&amp;&lt;&gt;&quot;&apos;');
});

test('ST 正文保留换行（含多行/结尾换行）', () => {
  const project = baseProject();
  project.programs[0]!.bodySt = 'x := 1;\ny := 2;\n';
  const xml = emitIecXml(project);
  assert.ok(xml.includes('<ST>x := 1;\ny := 2;\n</ST>'));
  // CRLF 会被归一化为 LF（确定性）
  project.programs[0]!.bodySt = 'a := 1;\r\nb := 2;';
  assert.ok(emitIecXml(project).includes('<ST>a := 1;\nb := 2;</ST>'));
});

test('多 Program + ProgramInstance 数量/顺序', () => {
  const project = baseProject();
  project.programs.push({ name: 'Sub', vars: [], bodySt: 'nStep := 0;' });
  const xml = emitIecXml(project);
  assert.ok(xml.includes('<Program name="Main">'));
  assert.ok(xml.includes('<Program name="Sub">'));
  assert.ok(xml.includes('<ProgramInstance name="Main" typeName="pou" evaluationOrder="1"/>'));
  assert.ok(xml.includes('<ProgramInstance name="Sub" typeName="pou" evaluationOrder="2"/>'));
});

test('结构体定义：DataTypeDecl / StructTypeSpec / Member', () => {
  const xml = emitIecXml(baseProject());
  assert.ok(xml.includes('<DataTypeDecl name="ST_Motor">'));
  assert.ok(xml.includes('<UserDefinedTypeSpec xsi:type="StructTypeSpec">'));
  assert.ok(xml.includes('<Member name="bRunning">'));
  assert.ok(xml.includes('<Type><TypeName>BOOL</TypeName></Type>'));
});

test('全局变量位于 Configuration 下、Resource 之后（官方样例位置）', () => {
  const xml = emitIecXml(baseProject());
  const resClose = xml.indexOf('</Resource>');
  const gvOpen = xml.indexOf('<GlobalVars constant="false" retain="false">');
  const cfgClose = xml.indexOf('</Configuration>');
  assert.ok(resClose > 0 && gvOpen > resClose && cfgClose > gvOpen, 'GlobalVars 应在 </Resource> 与 </Configuration> 之间');
  assert.ok(xml.includes('<Variable name="gSpeedSet">'));
  assert.ok(xml.includes('<Address address="D200"/>'));
});

test('局部变量 Address/InitialValue 顺序为 Type → InitialValue → Address', () => {
  const xml = emitIecXml(baseProject());
  const vIdx = xml.indexOf('<Variable name="nStep">');
  const typeIdx = xml.indexOf('<Type>', vIdx);
  const initIdx = xml.indexOf('<InitialValue>', vIdx);
  const addrIdx = xml.indexOf('<Address address="D100"/>', vIdx);
  assert.ok(vIdx > 0 && typeIdx < initIdx && initIdx < addrIdx, '顺序应为 Type < InitialValue < Address');
});

test('确定性：同输入同输出、默认时间戳固定', () => {
  const a = emitIecXml(baseProject());
  const b = emitIecXml(baseProject());
  assert.equal(a, b);
  assert.ok(a.includes(`creationDateTime="${DEFAULT_TIMESTAMP}"`));
});

test('边界：空 body / 空 vars 仍生成合法骨架', () => {
  const project: IecXmlProject = { programs: [{ name: 'Empty', vars: [], bodySt: '' }], globalVars: [] };
  const xml = emitIecXml(project);
  assert.ok(xml.includes('<Program name="Empty">'));
  assert.ok(xml.includes('<Vars accessSpecifier="private">'));
  assert.ok(xml.includes('<MainBody>'));
  assert.ok(!xml.includes('<BodyContent'));
  assert.ok(xml.includes('<GlobalVars constant="false" retain="false">'));
  // 顶层元素齐全
  for (const el of ['<FileHeader', '<ContentHeader', '<Types>', '<Instances>', '<Configuration name="config1">']) {
    assert.ok(xml.includes(el), `缺少 ${el}`);
  }
});

test('拒绝 VAR_INPUT/VAR_OUTPUT（本期只支持 VAR）', () => {
  const project = baseProject();
  project.programs[0]!.vars.push({ name: 'bEnable', type: 'BOOL', section: 'VAR_INPUT' });
  assert.throws(() => emitIecXml(project), /VAR_INPUT/);
});

test('拒绝空 POU 列表 / 重复 POU / 空结构体', () => {
  assert.throws(() => emitIecXml({ programs: [] }), /至少需要一个/);
  const dup = baseProject();
  dup.programs.push({ name: 'Main', vars: [], bodySt: '' });
  assert.throws(() => emitIecXml(dup), /POU 名称重复/);
  const emptyStruct: IecXmlProject = { programs: [{ name: 'P', vars: [], bodySt: '' }], types: [{ name: 'S', members: [] }] };
  assert.throws(() => emitIecXml(emptyStruct), /至少需要一个成员/);
});

test('注释走 AddData/VariableComments（官方样例 number=6）并正确转义', () => {
  const project = baseProject();
  project.programs[0]!.vars[0]!.comment = 'a & b < c';
  const xml = emitIecXml(project);
  assert.ok(xml.includes('<Comment number="6">'));
  assert.ok(xml.includes('<CommentText>a &amp; b &lt; c</CommentText>'));
});

test('FunctionBlock：Parameters 三分组 + orderWithinParamSet + Vars + MainBody', () => {
  const project: IecXmlProject = {
    programs: [{ name: 'Main', vars: [], bodySt: '' }],
    functionBlocks: [
      {
        name: 'FB_Motor',
        comment: '电机',
        inouts: [{ name: 'nTarget', type: 'INT' }],
        inputs: [{ name: 'bEnable', type: 'BOOL' }],
        outputs: [{ name: 'bRunning', type: 'BOOL' }],
        vars: [{ name: 'tRamp', type: 'TON' }],
        bodySt: 'bRunning := bEnable;',
      },
    ],
  };
  const xml = emitIecXml(project);
  assert.ok(xml.includes('<FunctionBlock name="FB_Motor">'));
  assert.ok(xml.includes('<InoutVars>'));
  assert.ok(xml.includes('<InputVars>'));
  assert.ok(xml.includes('<OutputVars retain="false">'));
  assert.ok(xml.includes('<Variable name="bEnable" orderWithinParamSet="2">'));
  assert.ok(xml.includes('<Variable name="bRunning" orderWithinParamSet="3">'));
  assert.ok(xml.includes('<Vars accessSpecifier="private">'));
  assert.ok(xml.includes('<ST>bRunning := bEnable;</ST>'));
  // FB 不进入 ProgramInstance
  assert.ok(!xml.includes('<ProgramInstance name="FB_Motor"'));
});

test('Function：ResultType + Parameters + TempVars', () => {
  const project: IecXmlProject = {
    programs: [{ name: 'Main', vars: [], bodySt: '' }],
    functions: [
      {
        name: 'F_Add',
        returnType: 'INT',
        inputs: [{ name: 'a', type: 'INT' }],
        outputs: [{ name: 'b', type: 'INT' }],
        temps: [{ name: 't', type: 'INT' }],
        bodySt: 't := a + b;',
      },
    ],
  };
  const xml = emitIecXml(project);
  assert.ok(xml.includes('<Function name="F_Add">'));
  assert.ok(xml.includes('<ResultType>'));
  assert.ok(xml.includes('<TypeName>INT</TypeName>'));
  assert.ok(xml.includes('<TempVars>'));
  assert.ok(xml.includes('<Variable name="t">'));
  assert.ok(xml.includes('<ST>t := a + b;</ST>'));
});
