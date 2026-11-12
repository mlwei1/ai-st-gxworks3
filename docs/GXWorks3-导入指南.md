# GX Works3 导入操作手册

本手册说明如何把 `ai-st-gxworks3` 生成的产物导入三菱 GX Works3。

---

## 一、先理解 GX Works3 的硬约束

这决定了为什么不能用「AI 直接生成工程文件」：

| 约束 | 事实 | 影响 |
|---|---|---|
| 工程文件格式 | `.gx3` / `.gxp` 是**专有二进制**，无法外部读写 | 不能让 AI 直接生成工程文件 |
| 编程模式 | GX Works3 **强制「结构化工程」**，没有「简单工程」选项 | 无处选择简单模式规避 |
| 变量声明 | 在**「标签设置」工作表**单独维护 | 贴 ST 文本**不会**自动建标签 |
| ST 本体 | 在**「程序本体」工作表** | 贴进去的是代码，不是声明 |
| 外部粘贴 | 梯形图**不能**从外部粘贴（剪贴板是专有二进制） | 梯形图只能手画 |
| ST 文本 | ST 编辑器是**纯文本编辑器**，可以粘贴 | ✅ 这条路是通的 |

官方文档明确说明（三菱 ST 编程说明）：

> 你没有办法像 codesys 系那样在文本中直接定义标签。

所以正确的工作流是 **两条腿并行**：

```
全局标签  →  CSV 导入（自动）
局部标签  →  标签设置工作表手工录入（AI 生成的表格照抄）
程序本体  →  复制粘贴（AI 生成的 .st）
```

---

## 二、标准操作流程

### 第 0 步：准备工程

在 GX Works3 中新建工程（**结构化工程**，这是 GX Works3 的唯一模式）：

1. `文件 → 新建 → 工程`
2. 系列选 **FX5U**（或 iQ-R）
3. 程序语言选 **ST**
4. 勾选「使用标签」
5. 完成工程向导（模块配置按实际硬件填）

> ⚠️ **必须先建好 CPU 模块配置**。没有模块参数时，Program 可能挂不上去，
> 表现为「导入成功但看不到内容」。

### 第 1 步：生成产物

```bash
node --experimental-strip-types --no-warnings src/cli.ts build-text 你的程序.st -o ./out
```

产出：

```
out/
├── Main.st                ← 粘贴进「程序本体」
├── Main_labels.txt        ← 「标签设置」录入表（方式 B 用）
├── Main_local_labels.xml  ← 局部标签 XML（方式 A 用）
├── FB_Motor.st
├── FB_Motor_labels.txt
├── FB_Motor_local_labels.xml
├── Global.xml             ← 全局标签 XML（方式 A 用）
├── global_labels.csv      ← 全局标签 CSV（方式 B 用）
└── local_labels_table.txt ← 全部局部标签汇总
```

> **标签 XML 的格式**：标准 PLCopen TC6_0201（`http://www.plcopen.org/xml/tc6_0201`），
> UTF-16 编码 + BOM，CRLF 换行 —— 与 GX Works3 导出的标签文件逐行一致。
> `test/label-xml.test.ts` 会把生成结果与真实导出文件做逐行比对。

### 第 2 步：导入标签（两种方式）

#### 方式 A —— 用 XML（推荐，全自动）

工具生成的文件与 GX Works3 导出的标签文件**结构逐行一致**（标准 PLCopen TC6_0201，
UTF-16 编码），可直接导入：

1. **局部标签**：导航窗口 → 右键对应的 Program 或 `FB/FUN` → **局部标签** → **导入**
   → 选择 `Main_local_labels.xml` / `FB_Motor_local_labels.xml`
2. **全局标签**：导航窗口 → **全局标签** → 右键 → **导入** → 选择 `Global.xml`

#### 方式 B —— 用表格（无 XML 时备选）

1. **全局标签**：右键 → **导入** → 选择 `global_labels.csv`
2. **局部标签**：打开 POU 的**「标签设置」**工作表，照着 `Main_labels.txt` 逐行录入：

   ```
   方向    标签名              数据类型   初始值   软元件     注释
   输入    bEnable             BOOL                         启动命令
   输出    bRunning            BOOL                         运行状态
   局部    tRampTimer          TON                          斜坡定时器
   局部    nRampStep           INT          0              斜坡步进
   ```

   | 列 | 对应 GX Works3 字段 |
   |---|---|
   | 方向 | 决定放进哪个标签区（输入/输出/局部） |
   | 标签名 | 标签名 |
   | 数据类型 | 数据类型 |
   | 初始值 | 初始值 |
   | 软元件 | 软元件号（留空则编译时自动分配） |
   | 注释 | 注释 |

**关于软元件号**：
- 局部标签（VAR 段）通常**留空**，由编译器自动分配地址
- 只有需要固定地址（比如 HMI 要读写）才填 D100 这类地址
- 自动分配区在 `M8000` 以下 / `D512` 以下，显式占用这些地址会和自动分配冲突

### 第 4 步：粘贴程序本体

1. 打开该 POU 的**「程序本体」**工作表
2. 用记事本/VS Code 打开对应的 `.st` 文件，**Ctrl+A 全选 → Ctrl+C**
3. 在 GX Works3 的「程序本体」里 **Ctrl+A → Ctrl+V**

   > `.st` 文件顶部有一段 `(* 本 POU 需在「标签设置」工作表建立的局部标签 *)` 注释，
   > 它只是给你核对用的，粘进去不影响编译，可以保留（便于日后维护）。
   > 不想保留就用 `--no-declare` 去掉。

4. 重复直到所有 POU 完成

### 第 5 步：编译验证

`转换 → 全部转换`（或 Rebuild All）。

常见错误与对策：

| 报错 | 原因 | 解决 |
|---|---|---|
| 变量未定义 | 局部标签没建全 | 对照 `*_labels.txt` 补齐 |
| 类型不匹配 | 标签类型建错 | 检查数据类型列 |
| 语法错误 | 粘贴时丢了内容 | 重新全选粘贴 |

---

## 三、AI 辅助生成（完整链路）

```bash
node --experimental-strip-types --no-warnings src/cli.ts generate \
  "水箱液位控制：低于10%启动水泵，高于90%停泵，带高低限报警" \
  --io examples/io_table.txt --out ./out/generated.st
```

流程：AI 生成 ST → 方言静态检查 → 输出 `.st` + 标签 CSV → 按上面步骤导入。

**AI 生成的代码在导入前已经过检查**，能拦住的典型问题：

- 用了其他品牌的指令（西门子 `IREF`、CODESYS `ROL`）
- 整数与浮点隐式赋值（三菱不允许，必须 `REAL_TO_INT`）
- `RS` 触发器形参名写错（应为 `S`/`R1`/`Q1`）
- 设备地址越界（FX5U 的 X 只有 X0–X511）
- 未声明变量、保留字做变量名

---

## 四、关于 IEC61131-10 XML 导入

GX Works3 的 `工程 → 导入 → IEC61131-10 XML格式` 确实可用，本工具早期也走这条路，
但实测**导入后程序内容为空**。

原因：该格式的 `<ST>` 段落与 `<Vars>`（标签表）分离，而 GX Works3 的导入器
在处理 ST 主体时不建立与标签表的关联。官方样例
`C:\Program Files (x86)\MELSOFT\GPPW3\SampleData\IEC61131-10XML\Sample.xml`
中的 `BodyProperties` / `workSheetName` 映射机制，在导入新工程时未能生效。

因此**推荐 `build-text` 流程**。`build-xml` 命令保留，仅作参考与归档用途。

---

## 五、给 AI 的工程上下文（可选）

如果工程里已有大量标签，可以让 AI 复用而不是重造：

```bash
# 导出已有的全局标签作为上下文
# （GX Works3：全局标签 → 右键 → 导出至文件 → XML）
node --experimental-strip-types --no-warnings src/cli.ts generate \
  "新增一个冷却泵控制" --vars existing_labels.txt --io io.txt
```

`--vars` 传入的已有变量清单会进提示词，AI 会优先复用同名标签。

## XML 中的 FUNCTION_BLOCK（2026-11-12 实测）

IEC 61131-10 XML **可以包含 FunctionBlock 定义**，本工具支持 `FUNCTION_BLOCK` + 实例调用：

- 生成：ST 中写 `FUNCTION_BLOCK FB_Cylinder ... END_FUNCTION_BLOCK` 与
  `fbVert : FB_Cylinder;`，`build-xml` 会输出 `<FunctionBlock>`（Parameters/InputVars/OutputVars/Vars/MainBody）；
- 调用：程序正文写 `fbVert(bEnable := TRUE, bExtend := X0, ...);`
- GX Works3 实测：XML 导入 **Error:0 Warning:0**，全部转换 **Error:0 Warning:0**；
  证据 `docs/evidence/M4/16-fb-xml-import.png`、`docs/evidence/M4/17-fb-xml-compile.png`。

注意：FB 形参目前只支持 VAR_INPUT / VAR_OUTPUT / VAR（本发射器限制），且 XML 中 FB 与 Program 共享命名空间。