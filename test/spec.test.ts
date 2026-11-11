/**
 * Spec 层测试：schema/加载/校验规则 + 3 个示例 spec。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import {
  KNOWN_TEMPLATES,
  SPEC_JSON_SCHEMA,
  formatSpecDiagnostics,
  loadSpecFile,
  loadSpecFileSync,
  loadSpecText,
  parseSpec,
} from '../src/spec/index.ts';
import type { RequirementSpec, SpecDiagnostic } from '../src/spec/index.ts';

const specPath = (name: string) => fileURLToPath(new URL(`../specs/${name}`, import.meta.url));

/** 合法最小 spec（测试基准，按用例覆盖字段）。 */
function validSpec(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'demo_spec',
    title: '演示',
    cpu: { series: 'FX5U', model: 'FX5U-32MT/ES' },
    template: { name: 'motor_start_stop', params: { autoStopSeconds: 10, faultReset: true } },
    io: [
      { device: 'X0', name: 'bStart', type: 'BOOL', comment: '启动' },
      { device: 'X1', name: 'bStop', type: 'BOOL' },
      { device: 'X2', name: 'bFault', type: 'BOOL' },
      { device: 'Y0', name: 'bMotor', type: 'BOOL' },
      { device: 'D100', name: 'nSpeed', type: 'INT' },
    ],
    vars: [{ name: 'bRunning', type: 'BOOL', scope: 'local', initial: 'FALSE' }],
    requirements: [
      { id: 'R1', text: 'X0 启动 Y0' },
      { id: 'R2', text: 'X1 停止 Y0' },
    ],
    safety: { estop: 'X1', interlocks: ['bFault 时禁止 Y0'] },
    meta: { version: '0.1.0', createdAt: '2026-11-10' },
    ...overrides,
  };
}

function codes(diagnostics: SpecDiagnostic[]): string[] {
  return diagnostics.map((d) => d.code);
}

function errors(diagnostics: SpecDiagnostic[]): SpecDiagnostic[] {
  return diagnostics.filter((d) => d.severity === 'error');
}

/* -------------------- 合法 spec -------------------- */

test('spec：合法对象通过加载并规范化为 RequirementSpec', () => {
  const result = parseSpec(validSpec());
  assert.equal(result.ok, true);
  assert.ok(result.spec);
  assert.equal(result.spec!.name, 'demo_spec');
  assert.equal(result.spec!.cpu.series, 'FX5U');
  assert.equal(result.spec!.template.name, 'motor_start_stop');
  assert.equal(result.spec!.io.length, 5);
  assert.equal(result.spec!.io[0].device, 'X0');
  assert.equal(result.spec!.requirements.length, 2);
  assert.equal(errors(result.diagnostics).length, 0);
});

test('spec：JSON 字符串等价于对象，非法 JSON 报 SPEC_E_JSON', () => {
  assert.equal(parseSpec(JSON.stringify(validSpec())).ok, true);
  assert.equal(loadSpecText(JSON.stringify(validSpec())).ok, true);
  const bad = parseSpec('{ not json');
  assert.equal(bad.ok, false);
  assert.ok(codes(bad.diagnostics).includes('SPEC_E_JSON'));
});

test('spec：空 IO 允许（模板可自带 IO），但 io 字段必须存在', () => {
  const result = parseSpec(validSpec({ io: [] }));
  assert.equal(result.ok, true);
  const missing = validSpec();
  delete (missing as Record<string, unknown>).io;
  const r2 = parseSpec(missing);
  assert.equal(r2.ok, false);
  assert.ok(codes(r2.diagnostics).includes('SPEC_E_IO'));
});

/* -------------------- 基础字段校验 -------------------- */

test('spec：缺 name / name 非法报错', () => {
  const noName = validSpec();
  delete (noName as Record<string, unknown>).name;
  const r1 = parseSpec(noName);
  assert.equal(r1.ok, false);
  assert.ok(codes(r1.diagnostics).includes('SPEC_E_NAME'));

  const badName = parseSpec(validSpec({ name: '1motor' }));
  assert.equal(badName.ok, false);
  assert.ok(codes(badName.diagnostics).includes('SPEC_E_NAME_INVALID'));
});

test('spec：cpu.series 非法报错', () => {
  const r = parseSpec(validSpec({ cpu: { series: 'FX3U' } }));
  assert.equal(r.ok, false);
  assert.ok(codes(r.diagnostics).includes('SPEC_E_CPU_SERIES'));
});

test('spec：未知模板名报错并列出已知模板', () => {
  const r = parseSpec(validSpec({ template: { name: 'tank_level' } }));
  assert.equal(r.ok, false);
  const d = r.diagnostics.find((x) => x.code === 'SPEC_E_TEMPLATE_UNKNOWN');
  assert.ok(d);
  for (const name of KNOWN_TEMPLATES) assert.ok(d!.message.includes(name));
});

test('spec：10 个已知模板名全部被接受', () => {
  for (const name of KNOWN_TEMPLATES) {
    const r = parseSpec(validSpec({ template: { name } }));
    assert.equal(r.ok, true, `${name} 应被接受: ${codes(r.diagnostics).join(',')}`);
  }
});

test('spec：模板参数只接受标量', () => {
  const r = parseSpec(validSpec({ template: { name: 'timer_sequence', params: { nested: { a: 1 } } } }));
  assert.equal(r.ok, false);
  assert.ok(codes(r.diagnostics).includes('SPEC_E_TEMPLATE_PARAM_VALUE'));
});

test('spec：空 requirements / 重复 id / 缺 text 报错', () => {
  const empty = parseSpec(validSpec({ requirements: [] }));
  assert.equal(empty.ok, false);
  assert.ok(codes(empty.diagnostics).includes('SPEC_E_REQUIREMENTS'));

  const dup = parseSpec(
    validSpec({
      requirements: [
        { id: 'R1', text: 'a' },
        { id: 'R1', text: 'b' },
      ],
    }),
  );
  assert.equal(dup.ok, false);
  assert.ok(codes(dup.diagnostics).includes('SPEC_E_REQ_DUPLICATE_ID'));

  const noText = parseSpec(validSpec({ requirements: [{ id: 'R1', text: '' }] }));
  assert.equal(noText.ok, false);
  assert.ok(codes(noText.diagnostics).includes('SPEC_E_REQ_TEXT'));
});

/* -------------------- IO 校验（profile 联动） -------------------- */

test('spec：X1777 合法、B7FFF 合法', () => {
  const r1 = parseSpec(
    validSpec({
      io: [
        { device: 'X1777', name: 'bIn', type: 'BOOL' },
        { device: 'B7FFF', name: 'bLink', type: 'BOOL' },
      ],
    }),
  );
  assert.equal(r1.ok, true, codes(r1.diagnostics).join(','));
});

test('spec：X198 报非法八进制（SPEC_E_IO_DEVICE_BASE）', () => {
  const r = parseSpec(
    validSpec({ io: [{ device: 'X198', name: 'bBad', type: 'BOOL' }] }),
  );
  assert.equal(r.ok, false);
  assert.ok(codes(r.diagnostics).includes('SPEC_E_IO_DEVICE_BASE'));
});

test('spec：X2000 报越界（SPEC_E_IO_DEVICE_RANGE）', () => {
  const r = parseSpec(
    validSpec({ io: [{ device: 'X2000', name: 'bOut', type: 'BOOL' }] }),
  );
  assert.equal(r.ok, false);
  assert.ok(codes(r.diagnostics).includes('SPEC_E_IO_DEVICE_RANGE'));
});

test('spec：未知前缀 / 格式错误报错', () => {
  const p = parseSpec(validSpec({ io: [{ device: 'Q0', name: 'bQ', type: 'BOOL' }] }));
  assert.equal(p.ok, false);
  assert.ok(codes(p.diagnostics).includes('SPEC_E_IO_DEVICE_PREFIX'));

  const f = parseSpec(validSpec({ io: [{ device: 'X', name: 'bF', type: 'BOOL' }] }));
  assert.equal(f.ok, false);
  assert.ok(codes(f.diagnostics).includes('SPEC_E_IO_DEVICE_FORMAT'));
});

test('spec：FX5UJ 范围更小（M10000 在 FX5U 合法、FX5UJ 越界）', () => {
  const io = [{ device: 'M10000', name: 'bRelay', type: 'BOOL' }];
  const fx5u = parseSpec(validSpec({ cpu: { series: 'FX5U' }, io }));
  assert.equal(fx5u.ok, true, codes(fx5u.diagnostics).join(','));
  const uj = parseSpec(validSpec({ cpu: { series: 'FX5UJ' }, io }));
  assert.equal(uj.ok, false);
  assert.ok(codes(uj.diagnostics).includes('SPEC_E_IO_DEVICE_RANGE'));
});

test('spec：SM 系统软元件只给 range-unverified 警告，不影响 ok', () => {
  const r = parseSpec(validSpec({ io: [{ device: 'SM400', name: 'bAlwaysOn', type: 'BOOL' }] }));
  assert.equal(r.ok, true);
  assert.ok(codes(r.diagnostics).includes('SPEC_W_IO_DEVICE_RANGE_UNVERIFIED'));
});

test('spec：IO 类型非法报错', () => {
  const r = parseSpec(validSpec({ io: [{ device: 'X0', name: 'bX', type: 'LREAL' }] }));
  assert.equal(r.ok, false);
  assert.ok(codes(r.diagnostics).includes('SPEC_E_IO_TYPE'));
});

test('spec：IO 名称非法 / 重复 name / 重复 device 报错', () => {
  const badName = parseSpec(validSpec({ io: [{ device: 'X0', name: '1bad', type: 'BOOL' }] }));
  assert.equal(badName.ok, false);
  assert.ok(codes(badName.diagnostics).includes('SPEC_E_IO_NAME_INVALID'));

  const dupName = parseSpec(
    validSpec({
      io: [
        { device: 'X0', name: 'bSame', type: 'BOOL' },
        { device: 'X1', name: 'bSame', type: 'BOOL' },
      ],
    }),
  );
  assert.equal(dupName.ok, false);
  assert.ok(codes(dupName.diagnostics).includes('SPEC_E_IO_DUPLICATE_NAME'));

  const dupDevice = parseSpec(
    validSpec({
      io: [
        { device: 'X0', name: 'bA', type: 'BOOL' },
        { device: 'x0', name: 'bB', type: 'BOOL' },
      ],
    }),
  );
  assert.equal(dupDevice.ok, false);
  assert.ok(codes(dupDevice.diagnostics).includes('SPEC_E_IO_DUPLICATE_DEVICE'));
});

/* -------------------- vars / safety / meta -------------------- */

test('spec：vars 名称唯一、scope 合法、device 走同一套设备校验', () => {
  const dup = parseSpec(
    validSpec({
      vars: [
        { name: 'v1', type: 'BOOL', scope: 'local' },
        { name: 'v1', type: 'INT', scope: 'global' },
      ],
    }),
  );
  assert.equal(dup.ok, false);
  assert.ok(codes(dup.diagnostics).includes('SPEC_E_VAR_DUPLICATE_NAME'));

  const badScope = parseSpec(validSpec({ vars: [{ name: 'v1', type: 'BOOL', scope: 'globalx' }] }));
  assert.equal(badScope.ok, false);
  assert.ok(codes(badScope.diagnostics).includes('SPEC_E_VAR_SCOPE'));

  const badDevice = parseSpec(
    validSpec({ vars: [{ name: 'v1', type: 'WORD', scope: 'global', device: 'D9999' }] }),
  );
  assert.equal(badDevice.ok, false);
  assert.ok(codes(badDevice.diagnostics).includes('SPEC_E_IO_DEVICE_RANGE'));
});

test('spec：safety.estop 为变量名时接受，为设备时校验', () => {
  assert.equal(parseSpec(validSpec({ safety: { estop: 'bEStop' } })).ok, true);
  const bad = parseSpec(validSpec({ safety: { estop: 'X198' } }));
  assert.equal(bad.ok, false);
  assert.ok(codes(bad.diagnostics).includes('SPEC_E_IO_DEVICE_BASE'));
});

/* -------------------- 文件加载 -------------------- */

test('spec：3 个示例 spec 全部可加载（同步/异步）', async () => {
  for (const name of ['motor_start_stop.json', 'tank_level.json', 'alarm_interlock.json']) {
    const sync = loadSpecFileSync(specPath(name));
    assert.equal(sync.ok, true, `${name}: ${formatSpecDiagnostics(sync.diagnostics)}`);
    assert.ok(sync.spec);
    const asyncResult = await loadSpecFile(specPath(name));
    assert.equal(asyncResult.ok, true, `${name}（async）: ${formatSpecDiagnostics(asyncResult.diagnostics)}`);
  }
});

test('spec：motor_start_stop 示例的 IO 与需求可读', () => {
  const { spec } = loadSpecFileSync(specPath('motor_start_stop.json'));
  assert.ok(spec);
  const devices = spec!.io.map((i) => i.device).sort();
  assert.deepEqual(devices, ['X0', 'X1', 'X2', 'Y0']);
  assert.equal(spec!.io.find((i) => i.device === 'Y0')!.name, 'bMotor');
  assert.ok(spec!.requirements.length >= 2);
});

test('spec：文件不存在返回 SPEC_E_READ（不抛异常）', async () => {
  const r = loadSpecFileSync(specPath('__missing__.json'));
  assert.equal(r.ok, false);
  assert.ok(codes(r.diagnostics).includes('SPEC_E_READ'));
  const a = await loadSpecFile(specPath('__missing__.json'));
  assert.equal(a.ok, false);
  assert.ok(codes(a.diagnostics).includes('SPEC_E_READ'));
});

test('spec：JSON Schema 与已知模板常量可用', () => {
  assert.equal(KNOWN_TEMPLATES.length, 11);
  const schema = SPEC_JSON_SCHEMA as { required?: string[]; properties?: Record<string, unknown> };
  assert.deepEqual(schema.required, ['name', 'cpu', 'template', 'io', 'requirements']);
  assert.ok(schema.properties);
});

test('spec：formatSpecDiagnostics 输出可读文本', () => {
  const r = parseSpec(validSpec({ io: [{ device: 'X198', name: 'bBad', type: 'BOOL' }] }));
  const text = formatSpecDiagnostics(r.diagnostics);
  assert.ok(text.includes('SPEC_E_IO_DEVICE_BASE'));
  assert.ok(text.includes('io[0].device'));
});

test('spec：校验结果类型可被 TS 使用（结构自检）', () => {
  const r = parseSpec(validSpec());
  const spec: RequirementSpec | null = r.spec;
  assert.ok(spec);
  assert.equal(typeof r.ok, 'boolean');
  assert.ok(Array.isArray(r.diagnostics));
});
