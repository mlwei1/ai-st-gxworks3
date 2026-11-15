# 编程习惯档案（Style Profiles）

把用户在对话里反复表达的**编程习惯**沉淀成可版本化的 JSON，生成 ST/XML 时作为默认值应用，
让 AI 不必每次重新猜命名、标签语言、模式划分、报警策略等偏好。

## 目录约定

```text
profiles/
├── README.md                 # 本文件：机制说明
├── questions.md              # AI 初次接触用户时的“习惯提问清单”
├── industrial/
│   └── robot_transfer_habits.json   # 首个档案：搬运机械手工业习惯（来自实际对话）
└── <company>/<name>.json     # 后续：公司规范 / 项目覆盖
```

## 档案优先级

**本次对话/CLI 显式要求 > spec 显式字段 > style 档案 > 内置默认**

- 档案只填充 spec **未显式设置**的字段，不覆盖项目已做的明确选择；
- 公司/项目档案可继承个人档案后再覆盖（支持 `--style a,b,c` 多级合并）。

## 使用方式

```bash
# 生成时应用习惯档案
node --experimental-strip-types --no-warnings src/cli.ts gen specs/robot_transfer_steps_v2.json \
  -o out --style profiles/industrial/robot_transfer_habits.json
```

## 多级档案（个人 → 公司 → 项目）

```bash
# 后者覆盖前者（对象递归合并、数组合并去重）
gen specs/xxx.json --style profiles/user.json,profiles/company.json,profiles/project.json
style merge profiles/user.json profiles/company.json -o profiles/merged.json
```

## 从用户修改提取候选

```bash
style candidates --generated gen.st --actual user_modified.st -o out/style_candidates
```

生成候选报告（标签改名/局部变量改名/语言/前缀/正文修改），人工确认后写入档案。

当前自动应用（v0）：

| 字段 | 作用 |
|---|---|
| `labels.language` | 全局/局部标签语言（en/zh），spec 未设置时生效 |
| `defaults.cylinderTimeoutMs` | 气缸动作超时默认值（spec 未设置时填入） |

其余字段（命名前缀、模式划分、报警策略、HMI 地址规划、停止/急停语义、自检清单）
目前作为**结构化档案**保存：供 AI 阅读并按要求生成，后续逐步映射为生成器规则。

## 如何新增/更新档案

1. 从对话中记录用户明确说过的偏好（“我们习惯…”“以后都…”“不要…”）；
2. 归入最合适的字段：`labels` / `naming` / `codeStructure` / `hmi` / `alarmCodes` / `defaults`；
3. 写进 JSON，并在 `notes` 里保留用户原话出处（便于追溯）；
4. 跑 `node --experimental-strip-types --no-warnings --test test/style.test.ts` 校验；
5. 提交 git（档案可 diff、可回滚）。

更完整的采集/归纳/应用流程见 [docs/编程习惯沉淀.md](../docs/编程习惯沉淀.md)。
