# ai-st-gxworks3

AI 驱动的三菱 PLC **GX Works3 ST** 代码生成、校验与编程习惯沉淀工具。

面向 **MELSEC iQ-F / FX5U**（GX Works3 1.128 实测；iQ-R 尚未验证）：把控制需求（Spec 或自然语言）
变成可直接导入 GX Works3 的 **ST 源码 + IEC 61131-10 XML**，导入前先做语法与三菱方言静态检查，
导入后由 GX Works3 `全部转换` 验证。

- 当前版本：**v0.8.0**
- 测试：**297/297 通过**
- 零运行时依赖（Node 22 原生 TypeScript 类型剥离 + `node:test`）

> 说明：仿真不作为主线。PLC 程序的价值在**连设备后监视**，本项目暂停了 GX Simulator3 自动化投入，
> 验证以「单元测试 + GX Works3 导入/全部转换 Error:0」为主。

---

## 这是什么

### 解决什么问题

GX Works3 的工程文件是**专有二进制格式**，外部工具无法直接读写；它也没有西门子 `.scl` 那种
ST 文本导入（剪贴板也是专有二进制）。但 GX Works3 支持 **IEC 61131-10 XML 导入**，
本工具就围绕这条通道构建：

```
需求 Spec（JSON） ──模板/AI──▶ ST 源码 ──▶ 方言检查 ──▶ IEC 61131-10 XML ──▶ GX Works3 导入
                                                      └─▶ 标签 CSV / HMI 表 / 报警表（备选与辅助）
```

### 它是什么

- **ST 生成器**：Spec → 12 个标准/行业模板 + 工业步进/气缸 FB 程序；
- **ST 检查器**：自建词法/语法/分析器，拦截三菱方言坑（伪 IEC 写法、隐式类型转换、设备越界、FB 形参错误）；
- **IEC XML 发射器**：Program、FUNCTION_BLOCK、GlobalVars（含软元件地址与注释）；
- **编程习惯沉淀工具**：把“标签语言、命名前缀、模式划分、报警/停止策略、HMI 地址、报警码”等偏好
  沉淀为可版本化档案，并从用户对生成物的修改中提取候选规则，回注到下一次生成；
- **交付工具链**：`deliver` 交付包、`mcp` 供 AI Agent 调用。

### 它不是什么

- 不生成梯形图/FBD/SFC 图形（只交付纯 ST）；
- 不读写 `.gx3` 工程文件、不下载 PLC 程序；
- 不替代 GX Works3 的硬件配置、模块参数、在线监视；
- 不保证“AI 一次写对”：静态检查 + GX 编译 + 人工评审仍是必要环节。

---

## 30 秒上手

要求：Node.js **22.6+**，GX Works3（导入时需要）。

```bash
git clone https://github.com/mlwei1/ai-st-gxworks3.git
cd ai-st-gxworks3

# 1) 标准模板：Spec → ST + IEC XML + 标签 CSV
node --experimental-strip-types --no-warnings src/cli.ts gen specs/motor_start_stop.json -o ./out

# 2) 本地静态校验
node --experimental-strip-types --no-warnings src/cli.ts check out/motor_start_stop.st

# 3) 工业步进示例（六模式/气缸 FB/报警冻结/停止序列/HMI）
node --experimental-strip-types --no-warnings src/cli.ts gen specs/robot_transfer_steps_v2.json -o ./out

# 4) 叠加“编程习惯档案”（标签名/前缀/模式名/停止顺序/HMI/报警码）
node --experimental-strip-types --no-warnings src/cli.ts gen specs/robot_transfer_steps_v2.json -o ./out \
  --style profiles/industrial/robot_transfer_habits.json

# 5) 用档案检查 spec 是否偏离习惯
node --experimental-strip-types --no-warnings src/cli.ts style check-spec \
  specs/robot_transfer_steps_v2.json --style profiles/industrial/robot_transfer_habits.json
```

然后在 GX Works3：

1. 新建工程（FX5U，程序语言选“不指定”，不要先生成空 SFC 骨架）；
2. `工程 → 导入文件 → IEC61131-10 XML格式`，选 `out/*.xml`；
3. `转换 → 全部转换`，检查 `Error:0`；
4. 打开程序本体即可查看/修改 ST。

也可 `npm link` 后使用 `ai-st-gxworks3` 命令，或直接用 `npm start -- <子命令>`。

---

## 原理

### 1. 生成管线

| 阶段 | 模块 | 做什么 |
|---|---|---|
| Spec 加载 | `src/spec/load.ts` | JSON Schema 校验 + 工业/HMI/步进段规范化 |
| 模板实例化 | `src/templates/*` | 12 个标准/行业模板；`step_sequence` 生成 `nStep + CASE` 状态机 |
| 工业生成 | `src/gen/industrial-step.ts` | 六模式、气缸 FB、报警冻结、手动翻转、停止序列、HMI 状态/数据 |
| 可选 LLM 兜底 | `src/ai/*`、`src/gen/llm.ts` | 模板覆盖不了的非标逻辑；带本地诊断反馈重试 |
| 方言检查 | `src/dialect/*` | 词法/语法（错误恢复）/语义/设备范围/指令白名单/FB 形参 |
| 发射 | `src/emit/*` | ST 文本、IEC XML、标签 CSV（UTF-16LE+BOM，TAB 分隔）、HMI/报警表 |
| 交付 | `src/deliver/*`、`src/mcp/*` | report/trace/SHA256；MCP Server |

### 2. 为什么是 IEC 61131-10 XML

GX Works3 虽不能读工程文件，但支持导入 IEC 61131-10 XML：程序本体、局部标签、全局标签、结构体
可一次落地（实测 `全部转换 Error:0`）。本工具的 XML 严格按 GX 可接受的结构生成：

- `ResourceExecutionType = scan`（否则程序被放到 Initial 只执行一次）；
- GlobalVars 带 `<Address address="X0"/>` 与 VariableComments；
- FUNCTION_BLOCK 的 Parameters/InputVars/OutputVars/Vars/MainBody 与实例调用（`=>` 输出）已实测可导入；
- 锁存变量分组为 RETAIN，避免编译错误码 `0x11021040`。

标签 CSV + 粘贴 ST 的旧通道仍保留（`build-text`），作为备选。

### 3. 三菱方言知识从哪来

不是让 AI 自由发挥，而是把三菱规则固化成三类资产：

- **静态规则**：设备范围、类型规则、指令白名单、FB 形参表（如 `TON` 只有 `IN/PT/Q/ET`）；
- **手册 RAG**：7 本官方手册的核实锚点（定位/通信/温度/计数等），见 `docs/RAG/`；
- **模板经验**：定位/温控/MODBUS/串口/工业步进的校验过的 ST 写法。

生成后用同一套规则检查，检查不过就修复或拒绝产出。

### 4. 编程习惯沉淀（v0.8 重点）

核心思想：**把“这个人/这家公司怎么编程”从一次性对话变成可版本化档案**。

```
用户对话 / 修改生成物
        │
        ▼
style candidates  ← 生成 ST 与用户改后 ST 的 diff
   （全局标签改名、局部变量/FB 形参改名、语言推断、命名前缀推断）
        │ 人工确认
        ▼
style adopt  →  profiles/*.json（标签名/前缀/改名/模式/停止顺序/HMI/报警码…）
        │
        ▼
gen --style / generate --style  →  下次生成直接遵守
        │
        ▼
style check-spec  →  复核偏差；有偏差提示但不阻断
```

- **多级合并**：个人 → 公司 → 项目（目录递归 + scope 排序，后者覆盖前者；对象深合并）；
- **冲突防护**：标签重名、改名循环、非法前缀在 `style check` / `adopt` 阶段拦截；
- **可回滚**：档案是普通 JSON，可 git diff/审阅；
- **AI 也遵守**：`generate --style` 与 LLM 兜底会把档案转成提示段注入。

详见 [docs/风格档案速查表.md](docs/风格档案速查表.md)、[docs/编程习惯沉淀.md](docs/编程习惯沉淀.md)。

---

## 核心能力

| 能力 | 说明 |
|---|---|
| ST 前端 | 词法/语法（一次报告全部错误）/分析器；中文标识符支持 |
| 三菱方言检查 | 设备范围、类型、指令白名单、FB 形参、跨品牌写法拦截 |
| Spec 生成 | 12 个模板：电机启停/延时/正反转互锁/多步定时/计数/状态机/模拟量/报警首出/定位/温控/MODBUS/串口 |
| 步进程序 | `sequence` → `nStep + CASE`，分支/延时/动作；工业版含六模式与气缸 FB |
| 全局标签 | XML GlobalVars（地址+注释）；ST 正文使用标签名，无裸软元件 |
| 中文标签 | 全局/局部/FB 形参中文，类型前缀 b/n/t/x；可切英文 |
| 编程习惯档案 | 多级合并、diff 候选提取、adopt、check-spec、LLM 注入 |
| HMI/报警表 | 自动导出 `hmi_map.csv` / `alarm_map.csv`（UTF-8 BOM） |
| 停止序列 | 安全规则校验；`stopSequence: []` 自动生成（缩回→松夹→全关） |
| 交付/MCP | `deliver` 报告+追溯+SHA256；`mcp` 5 个工具 |
| LLM 兜底 | `--llm`，支持 GX 编译错误回灌重生成 |

---

## 怎么用

### CLI 命令

```bash
node --experimental-strip-types --no-warnings src/cli.ts <命令> [参数]
```

| 命令 | 用途 |
|---|---|
| `gen <spec.json> [-o outdir]` | Spec → ST + XML + 标签 CSV + manifest；工业程序附加 HMI/报警表 |
| `gen --list-templates` | 列出 12 个模板及参数 |
| `check <file.st...>` | ST 语法 + 三菱方言检查 |
| `build-xml <file.st> [-o outdir]` | 纯 ST → IEC XML |
| `build-text <file.st> [-o outdir]` | ST → 可粘贴文本 + 标签 CSV（备选通道） |
| `generate "<需求>" [--io io.txt] [--style p.json]` | AI 生成 ST（需 LLM 环境变量） |
| `generate ... --llm --compiler-errors errors.json` | 带 GX 编译错误重新生成 |
| `deliver <spec.json> [-o outdir]` | 交付包（报告/追溯/SHA256） |
| `mcp` | 启动 MCP Server（stdio） |
| `style <子命令>` | 编程习惯档案管理与候选提取 |
| `prompt` | 打印系统提示词（调试） |

### 风格档案 CLI

```bash
style init --out profiles/users/alice.json --name alice --scope user
style list [--dir profiles]
style check [files...]
style check-spec specs/xxx.json --style profiles/users/alice
style merge a.json b.json -o merged.json
style diff a.json b.json [--json]
style migrate old.json -o old.migrated.json
style candidates --generated out/gen.st --actual user_modified.st -o out/candidate
style adopt --profile p.json --candidates out/candidate/style_candidates.json -o p.new.json --dry-run
```

生成时：

```bash
gen spec.json --style profiles/users/alice                 # 单档案
gen spec.json --style a.json,b.json,c.json                 # 多级（后覆盖前）
gen spec.json --style profiles/users/alice                 # 目录（递归 + scope 排序）
gen spec.json --style p.json --hmi-from-style              # 档案 HMI 地址覆盖 spec
```

### 输出物

一次工业程序 `gen` 典型产出：

```text
out/
├── <name>.st             ST 源码（可直接检查/粘贴）
├── <name>.xml            IEC 61131-10（GX Works3 导入）
├── *_labels*.csv         标签 CSV（备选通道）
├── hmi_map.csv           触摸屏地址表
├── alarm_map.csv         报警码表
├── manifest.json         程序/结构体/全局变量/告警清单
└── diagnostics.json      诊断与警告
```

### GX Works3 导入

1. 新建 FX5U 工程（程序语言“不指定”，不要生成空 SFC 骨架程序）；
2. `工程 → 导入文件 → IEC61131-10 XML格式`，选 `.xml`；
3. 确认数据名重复处理（添加）；
4. `转换 → 全部转换`，输出面板确认 `Error:0`。

完整操作见 [docs/GXWorks3-导入指南.md](docs/GXWorks3-导入指南.md)。

---

## 目录结构

```text
src/
├── dialect/        ST 词法/语法/错误恢复/AST/分析器/三菱方言规则
├── emit/           ST 文本、IEC XML、标签 CSV、HMI/报警表
├── spec/           Spec JSON Schema/加载/规范化
├── templates/      12 个标准/行业模板
├── gen/            生成管线：步进/工业/LLM 兜底/修复/交付编排
├── style/          编程习惯档案：合并/校验/候选提取/adopt/停止序列/提示词
├── deliver/        交付包（报告/追溯/SHA256）
├── mcp/            内置 MCP Server
└── cli.ts          命令行入口

specs/              需求 Spec 示例（标准/工业/定位/温控/通信）
profiles/           编程习惯档案（个人/公司/项目 + 提问清单 + 速查表）
templates/          FX5U_ST_Template.gx3（纯 ST 模板工程）
docs/               设计文档、导入指南、RAG、证据
test/               node:test（297 用例）
tools/              demo 与维护脚本
```

---

## 验证与边界

### 已验证

| 项 | 结果 |
|---|---|
| 单元/集成测试 | **297/297 通过**（`npm test`） |
| GX Works3 XML 导入 + 全部转换 | 标准模板、工业 v2、FB、中文标签、自动停止序列均 `Error:0`（证据见 `docs/evidence/M4/`） |
| 工业程序 | robot_transfer_steps_v2：六模式/气缸 FB/报警冻结/停止序列/HMI 地址 |
| 习惯档案闭环 | 单用户闭环、多用户多级（demo 脚本实际运行通过） |
| 中文标签 | 全局/局部/FB 形参导入编译 `Error:0` |

### 已知边界

- **仅 FX5U 系统验证**；FX5UJ/iQ-R 差异未系统验证；
- **仅 ST**，不生成图形程序；不写 `.gx3`、不下载 PLC；
- **编译级验证**：GX 侧只验证到导入+全部转换，未做真机运行/时序验证；
- 仿真自动化已暂停（用户明确：连设备监视才有价值）；
- 工业程序的报警/停止/HMI 语义需按具体设备评审，工具只保证结构与静态规则；
- 非标逻辑依赖 LLM 时，仍需人工评审与 GX 编译确认。

---

## 文档索引

- 总体方案：[docs/整体方案.md](docs/整体方案.md)
- 进度与路线：[docs/进度与路线.md](docs/进度与路线.md)
- 导入指南：[docs/GXWorks3-导入指南.md](docs/GXWorks3-导入指南.md)
- 工业程序结构：[docs/工业程序结构-robot_steps设计稿.md](docs/工业程序结构-robot_steps设计稿.md)
- 风格档案：[docs/风格档案速查表.md](docs/风格档案速查表.md)、[docs/编程习惯沉淀.md](docs/编程习惯沉淀.md)
- 演示：[docs/演示-习惯沉淀闭环.md](docs/演示-习惯沉淀闭环.md)、[docs/演示-多用户档案.md](docs/演示-多用户档案.md)
- 步进/定位/温控/MODBUS/串口：[docs/ST步进程序.md](docs/ST步进程序.md)、[docs/定位模板.md](docs/定位模板.md)、[docs/温度模板.md](docs/温度模板.md)、[docs/Modbus模板.md](docs/Modbus模板.md)、[docs/串口模板.md](docs/串口模板.md)
- 交付/MCP：[docs/M3-交付与MCP.md](docs/M3-交付与MCP.md)
- 变更记录：[CHANGELOG.md](CHANGELOG.md)

---

## 开发

```bash
npm test                 # 297 个测试
npm start -- gen specs/motor_start_stop.json -o ./out
```

零运行时依赖，仅 Node 内置模块与 `node:test`；TypeScript 通过 Node 22 类型剥离直接运行。

## 许可证

MIT（见仓库 LICENSE；如未附带请补充）。
