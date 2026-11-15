# CHANGELOG

## 0.8.0（2026-11-15）——编程习惯沉淀闭环

### 新增：风格档案（Style Profile）

- `profiles/*.json`：标签语言、标签名覆盖、命名前缀/精确改名、默认超时、模式名、停止顺序、
  HMI 规划、报警码分配、自检清单；
- 多级合并：个人 → 公司 → 项目；支持逗号列表、目录自动发现（递归 + scope 排序）；
- `style` CLI：`list/show/check/check-spec/merge/diff/init/migrate/candidates/adopt`；
- 从用户修改 ST 提取候选：全局标签改名、局部变量/FB 形参改名、语言推断、命名前缀推断；
- `style adopt` 采纳候选（冲突校验、默认拒绝写盘、`--dry-run` 预览）；
- 档案驱动生成：
  - `labels.names` / `naming.prefixes` / `naming.renames` 实际生效；
  - `defaults.cylinderTimeoutMs` 与 `alarmCodes.mapping` 兜底；
  - `codeStructure.modes` 模式名、`stopSequence.order` 停止顺序；
  - `--hmi-from-style` 显式覆盖 HMI 地址；
- 生成前/后习惯校验 `style check-spec`：HMI/超时/报警码/手动按钮/停止序列安全规则；
- 档案注入 LLM：`generate --style` 与 LLM 兜底的需求/系统提示词；
- 停止序列：`stopSequence: []` 自动生成安全序列（缩回→松夹→全关），支持 `hold-clamp-until-release` /
  `return-home-before-idle` 规则校验；
- HMI 地址表 / 报警表自动导出（`hmi_map.csv` / `alarm_map.csv`，UTF-8 BOM）；
- 演示：`tools/demo-style-loop.ps1`（单用户闭环）、`tools/demo-multi-user-style.ps1`（多级档案）；
- 文档：编程习惯沉淀、风格档案速查表、多用户演示、进度刷新。

### 工业程序（M4）

- 工业步进 v2：六模式、气缸 FB（双/单电控）、5s 卡缸报警冻结、停止序列、手动翻转、急停暂停、HMI 地址；
- 全局标签 + ST 正文标签化（无裸软元件）；中文标签（全局/局部/FB 形参，b/n/t/x 前缀）；
- GX Works3 导入 + 全部转换 Error:0 证据（M4/11～22）；`startButton/stopButton` 修复物理启动/停止未接线，并新增未引用全局标签审计。

### 验证

- 测试 297/297 通过；
- `style` 档案校验、spec 校验、自动停止序列、GX 导入均有测试/证据。

## 0.3.0（历史）——M0–M3

- FX5U ST 方言前端（词法/语法/分析）、Spec→模板→ST+XML、12 个模板、手册 RAG、交付包/MCP/CI；
- 步进程序（`nStep + CASE`）、定位/温控/MODBUS/串口模板、GX 导入 Error:0。

## 0.1.0（历史）

- 项目骨架、XML 导入链路验证。
