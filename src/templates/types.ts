/**
 * ST 模板库的公共类型（M1-2）。
 *
 * 说明：模板库只依赖 spec 的 **JSON 形状**，不 import `src/spec/` 的实现，
 * 以保证 spec 模块演进时模板库不被耦合。
 */

export interface TemplateParamDef {
  name: string;
  type: 'number' | 'string' | 'boolean';
  description: string;
  default?: string | number | boolean;
}

export interface TemplateContext {
  spec: {
    name: string;
    cpu: { series: string; model?: string };
    io: { device: string; name: string; type: string; comment?: string }[];
    vars?: {
      name: string;
      type: string;
      scope: 'local' | 'global';
      initial?: string;
      device?: string;
      comment?: string;
    }[];
    requirements?: { id: string; text: string }[];
  };
  /** 已合并默认值的参数（缺省时也保证可实例化）。 */
  params: Record<string, string | number | boolean | undefined>;
}

export interface StTemplate {
  /** 与 spec.template.name 对应，如 motor_start_stop */
  name: string;
  description: string;
  params: TemplateParamDef[];
  /** 实例化为完整 ST 源码（可含多个 POU/TYPE/VAR_GLOBAL，由 parser 解析） */
  instantiate(ctx: TemplateContext): string;
}
