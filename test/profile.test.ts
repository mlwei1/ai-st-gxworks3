/**
 * M0-1：FX5U 事实库 profile + 设备地址/类型检查修复的回归测试。
 *
 * 覆盖：软元件范围/进制（含 FX5UJ 变体）、parseDeviceAddress 进制解析、
 * analyzer 设备范围/类型/字符串引号诊断、类型表（无 LINT/ULINT/LREAL）、
 * 提示词事实修正。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FX5U_PROFILE,
  FX5UJ_PROFILE,
  FX5_TYPE_NAMES,
  checkDeviceNumber,
  getCpuProfile,
  getDeviceFact,
  getDeviceRange,
  isIqROnlyType,
  isSupportedFx5Type,
} from '../src/profile/index.ts';
import { DEVICE_RANGES, STANDARD_FB_SIGNATURES, parseDeviceAddress } from '../src/dialect/instructions.ts';
import {
  PRIMITIVE_TYPES,
  isIqROnlyPrimitiveType,
  isPrimitiveType,
} from '../src/dialect/types.ts';
import { parseST } from '../src/dialect/parser.ts';
import { analyzeST, type Diagnostic } from '../src/dialect/analyzer.ts';
import { buildSystemPrompt } from '../src/ai/prompt.ts';

/** 便捷：分析一段 ST。 */
function diags(src: string, target: 'FX5U' | 'FX5UJ' | 'iQ-R' = 'FX5U'): Diagnostic[] {
  return analyzeST(parseST(src), { target });
}

function codes(src: string, target: 'FX5U' | 'FX5UJ' | 'iQ-R' = 'FX5U'): string[] {
  return diags(src, target).map((d) => d.code);
}

function hasCode(src: string, code: string, target: 'FX5U' | 'FX5UJ' | 'iQ-R' = 'FX5U'): boolean {
  return codes(src, target).includes(code);
}

/* -------------------- profile 事实 -------------------- */

test('profile：FX5U 软元件范围与进制（手册 JY997D58701 text/08003/06000）', () => {
  const x = getDeviceFact('X')!;
  assert.deepEqual(x.range, [0, 0o1777]);
  assert.equal(x.base, 8, 'X 为八进制');
  assert.equal(getDeviceFact('Y')!.base, 8);
  assert.equal(getDeviceFact('Y')!.range![1], 0o1777);

  assert.equal(getDeviceFact('M')!.range![1], 32767);
  assert.equal(getDeviceFact('L')!.range![1], 32767);
  assert.equal(getDeviceFact('S')!.range![1], 4095);
  assert.equal(getDeviceFact('T')!.range![1], 1023);
  assert.equal(getDeviceFact('ST')!.range![1], 1023);
  assert.equal(getDeviceFact('C')!.range![1], 1023);
  assert.equal(getDeviceFact('LC')!.range![1], 1023);
  assert.equal(getDeviceFact('D')!.range![1], 7999);
  assert.equal(getDeviceFact('R')!.range![1], 32767);

  const b = getDeviceFact('B')!;
  assert.equal(b.base, 16, 'B 为十六进制');
  assert.equal(b.range![1], 0x7fff);
  assert.equal(getDeviceFact('W')!.base, 16);
  assert.equal(getDeviceFact('W')!.range![1], 0x7fff);

  // SM/SD 存在但范围未核实：不做范围检查
  assert.equal(getDeviceFact('SM')!.verified, 'unverified');
  assert.equal(getDeviceFact('SM')!.range, null);
});

test('profile：FX5UJ 变体范围更小', () => {
  const uj = getCpuProfile('FX5UJ');
  assert.equal(uj.devices.M.range![1], 7679);
  assert.equal(uj.devices.L.range![1], 7679);
  assert.equal(uj.devices.T.range![1], 511);
  assert.equal(uj.devices.ST.range![1], 15);
  assert.equal(uj.devices.C.range![1], 255);
  assert.equal(uj.devices.LC.range![1], 63);
  assert.equal(uj.devices.W.base, 16);
  assert.deepEqual(uj.devices.W.range, [0, 0x3ff]);
  // X/Y/D 与 FX5U 相同
  assert.equal(uj.devices.X.range![1], FX5U_PROFILE.devices.X.range![1]);
  assert.equal(uj.devices.D.range![1], 7999);
  assert.notEqual(FX5UJ_PROFILE.model, FX5U_PROFILE.model);
});

test('profile：checkDeviceNumber 区分非法进制/越界/未核实范围', () => {
  assert.equal(checkDeviceNumber('X', 0o1777), 'ok');
  assert.equal(checkDeviceNumber('X', 0o2000), 'out-of-range');
  assert.equal(checkDeviceNumber('M', 32767), 'ok');
  assert.equal(checkDeviceNumber('M', 40000), 'out-of-range');
  assert.equal(checkDeviceNumber('B', 0x7fff), 'ok');
  assert.equal(checkDeviceNumber('SM', 400), 'range-unverified');
  assert.equal(checkDeviceNumber('Z', 19), 'ok');
  assert.equal(checkDeviceNumber('Z', 24), 'out-of-range');
  assert.equal(checkDeviceNumber('M', 10000, 'FX5UJ'), 'out-of-range');
  assert.equal(checkDeviceNumber('M', 7000, 'FX5UJ'), 'ok');
});

/* -------------------- 设备地址解析（进制） -------------------- */

test('parseDeviceAddress：X/Y 八进制、B/W 十六进制、其余十进制', () => {
  const x1777 = parseDeviceAddress('X1777')!;
  assert.equal(x1777.prefix, 'X');
  assert.equal(x1777.base, 8);
  assert.equal(x1777.number, 1023);
  assert.equal(x1777.validDigits, true);

  const x198 = parseDeviceAddress('X198')!;
  assert.equal(x198.base, 8);
  assert.equal(x198.validDigits, false, 'X198 的 9 不是八进制数字');
  assert.ok(Number.isNaN(x198.number));

  const m = parseDeviceAddress('M1000')!;
  assert.equal(m.base, 10);
  assert.equal(m.number, 1000);

  const b = parseDeviceAddress('B7FFF')!;
  assert.equal(b.base, 16);
  assert.equal(b.number, 32767);
  assert.equal(b.validDigits, true);

  const bHex = parseDeviceAddress('B0AE')!;
  assert.equal(bHex.base, 16);
  assert.equal(bHex.number, 0xae);
  assert.equal(bHex.validDigits, true);

  const d = parseDeviceAddress('D100')!;
  assert.equal(d.base, 10);
  assert.equal(d.number, 100);

  assert.equal(parseDeviceAddress('X10.3'), null, '位偏移由 parser 处理，本函数只解析主地址');
  assert.equal(parseDeviceAddress('not-a-device'), null);
});

/* -------------------- analyzer：设备范围 -------------------- */

test('检查：X1777 合法（八进制上限）', () => {
  assert.ok(!hasCode('PROGRAM P\nVAR\nEND_VAR\n    X1777 := TRUE;\nEND_PROGRAM', 'E009'));
});

test('检查：X2000 越界（八进制 2000 = 1024 > 1777）', () => {
  assert.ok(hasCode('PROGRAM P\nVAR\nEND_VAR\n    X2000 := TRUE;\nEND_PROGRAM', 'E009'));
});

test('检查：X198 非法（8/9 不是八进制数字）', () => {
  assert.ok(hasCode('PROGRAM P\nVAR\nEND_VAR\n    X198 := TRUE;\nEND_PROGRAM', 'E009'));
});

test('检查：M1000 合法、M40000 越界（FX5U M0~M32767）', () => {
  assert.ok(!hasCode('PROGRAM P\nVAR\nEND_VAR\n    M1000 := TRUE;\nEND_PROGRAM', 'E009'));
  assert.ok(hasCode('PROGRAM P\nVAR\nEND_VAR\n    M40000 := TRUE;\nEND_PROGRAM', 'E009'));
});

test('检查：B7FFF 合法（十六进制上限）', () => {
  const src = 'PROGRAM P\nVAR\n    bFlag : BOOL AT B7FFF;\nEND_VAR\nEND_PROGRAM';
  assert.ok(!hasCode(src, 'E009'));
});

test('检查：声明中的 AT X1777 合法、AT X198 报错', () => {
  assert.ok(!hasCode('PROGRAM P\nVAR\n    bIn : BOOL AT X1777;\nEND_VAR\nEND_PROGRAM', 'E009'));
  assert.ok(hasCode('PROGRAM P\nVAR\n    bIn : BOOL AT X198;\nEND_VAR\nEND_PROGRAM', 'E009'));
});

test('检查：FX5UJ 差异生效（M10000 在 FX5U 合法、在 FX5UJ 越界）', () => {
  const src = 'PROGRAM P\nVAR\nEND_VAR\n    M10000 := TRUE;\nEND_PROGRAM';
  assert.ok(!hasCode(src, 'E009', 'FX5U'));
  assert.ok(hasCode(src, 'E009', 'FX5UJ'));
});

test('检查：iQ-R 目标给出未实现提示（I001）', () => {
  const d = diags('PROGRAM P\nVAR\nEND_VAR\nEND_PROGRAM', 'iQ-R');
  assert.ok(d.some((x) => x.code === 'I001'), `实际: ${d.map((x) => x.code).join(',')}`);
});

/* -------------------- analyzer：类型与字符串引号 -------------------- */

test('检查：LINT/ULINT/LREAL/UINT/UDINT 在 FX5U 被拒（E004）', () => {
  for (const t of ['LINT', 'ULINT', 'LREAL', 'UINT', 'UDINT']) {
    const src = `PROGRAM P\nVAR\n    v : ${t};\nEND_VAR\nEND_PROGRAM`;
    assert.ok(hasCode(src, 'E004'), `${t} 应报 E004`);
  }
});

test('检查：FX5 类型（含 TIMER/COUNTER/WSTRING）被接受', () => {
  for (const t of ['BOOL', 'WORD', 'DWORD', 'INT', 'DINT', 'REAL', 'TIME', 'STRING', 'WSTRING', 'TIMER', 'COUNTER']) {
    const src = `PROGRAM P\nVAR\n    v : ${t};\nEND_VAR\nEND_PROGRAM`;
    assert.ok(!hasCode(src, 'E004'), `${t} 不应报 E004`);
  }
});

test('检查：STRING 用双引号报 E019，用单引号通过', () => {
  const bad = 'PROGRAM P\nVAR\n    sMsg : STRING;\nEND_VAR\n    sMsg := "abc";\nEND_PROGRAM';
  assert.ok(hasCode(bad, 'E019'));
  const good = "PROGRAM P\nVAR\n    sMsg : STRING;\nEND_VAR\n    sMsg := 'abc';\nEND_PROGRAM";
  assert.ok(!hasCode(good, 'E019'));
});

test('检查：WSTRING 用单引号报 E019', () => {
  const bad = 'PROGRAM P\nVAR\n    wsMsg : WSTRING;\nEND_VAR\n    wsMsg := \'abc\';\nEND_PROGRAM';
  assert.ok(hasCode(bad, 'E019'));
});

test('检查：声明初始值中的字符串引号也检查', () => {
  const bad = 'PROGRAM P\nVAR\n    sMsg : STRING := "abc";\nEND_VAR\nEND_PROGRAM';
  assert.ok(hasCode(bad, 'E019'));
  const good = 'PROGRAM P\nVAR\n    sMsg : STRING := \'abc\';\nEND_VAR\nEND_PROGRAM';
  assert.ok(!hasCode(good, 'E019'));
});

/* -------------------- 兼容导出 -------------------- */

test('instructions：DEVICE_RANGES 由 profile 派生（保留旧导出名）', () => {
  assert.equal(DEVICE_RANGES.M.max, 32767);
  assert.equal(DEVICE_RANGES.X.max, 0o1777);
  assert.equal(DEVICE_RANGES.D.max, 7999);
  assert.equal(DEVICE_RANGES.R.max, 32767);
  assert.equal(DEVICE_RANGES.Z.max, 19);
  assert.equal(DEVICE_RANGES.SM, undefined, 'SM 范围未核实，不应出现');
});

test('instructions：STANDARD_FB_SIGNATURES 与 profile 一致（TON/RS 已核实）', () => {
  assert.deepEqual(STANDARD_FB_SIGNATURES.TON.inputs, ['IN', 'PT']);
  assert.deepEqual(STANDARD_FB_SIGNATURES.TON.outputs, ['Q', 'ET']);
  assert.deepEqual(STANDARD_FB_SIGNATURES.RS.inputs, ['S', 'R1']);
  assert.deepEqual(STANDARD_FB_SIGNATURES.RS.outputs, ['Q1']);
  assert.ok(STANDARD_FB_SIGNATURES.COUNTER_FB === undefined, 'v0.1 的错误 FB 名不应出现在签名表');
});

test('types：PRIMITIVE_TYPES 为 FX5 口径，不含 LINT/ULINT/LREAL', () => {
  for (const t of PRIMITIVE_TYPES) {
    assert.ok(!['LINT', 'ULINT', 'LREAL', 'UINT', 'UDINT', 'BYTE'].includes(t), `不应包含 ${t}`);
  }
  assert.ok(PRIMITIVE_TYPES.includes('TIMER'));
  assert.ok(PRIMITIVE_TYPES.includes('RETENTIVETIMER'));
  assert.ok(PRIMITIVE_TYPES.includes('LCOUNTER'));
  assert.equal(isPrimitiveType('TIMER'), true);
  assert.equal(isPrimitiveType('LREAL'), false);
  assert.equal(isIqROnlyPrimitiveType('LREAL'), true);
  assert.ok(FX5_TYPE_NAMES.has('STRING'));
});

/* -------------------- 提示词事实 -------------------- */

test('prompt：FX5U 提示词已修正范围/进制/引号/SQRT，且明确 LINT 等不支持', () => {
  const p = buildSystemPrompt('FX5U');
  assert.ok(p.includes('X1777'));
  assert.ok(p.includes('八进制'));
  assert.ok(p.includes('单引号'));
  assert.ok(p.includes('SQRT'));
  assert.ok(p.includes('LINT') && p.includes('不支持'), '应说明 FX5 不支持 LINT 等类型');
  assert.ok(!p.includes('X0-X511'), '不应残留 FX3U 口径范围');
});

test('profile：FX5 类型查询函数可用', () => {
  assert.equal(isSupportedFx5Type('REAL'), true);
  assert.equal(isSupportedFx5Type('LREAL'), false);
  assert.equal(isIqROnlyType('LINT'), true);
  assert.equal(isIqROnlyType('INT'), false);
  assert.deepEqual(getDeviceRange('X'), [0, 0o1777]);
  assert.equal(getDeviceRange('SM'), null);
  assert.equal(getDeviceRange('NOPE'), undefined);
});
