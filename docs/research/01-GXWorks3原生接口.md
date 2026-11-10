# GX Works3 原生接口能力边界调研（GXW3Call / Open Interface）

> 调研目的：把「AI 生成的 ST 如何**零人工**落进 GX Works3、并拿到**真实编译结果**」这件事的技术可行性钉死。
>
> 调研方式：**只做静态分析**（本机安装文件、类型库 dump、e-Manual 手册数据库、嵌入 XSD、官方样例 XML、菜单资源表）+ 网络文档检索。**未启动 GX Works3、未创建/打开/保存工程、未执行任何 COM 调用或仿真。**
>
> 环境基线：GX Works3 `1.128.0.1`（安装版本 `1.128.04519`，中文版）；`GXW3Call.dll`（OpenIF COM）`1.28.5.1`；Windows 11（`C:\Program Files (x86)\MELSOFT\GPPW3`）。
>
> 证据等级：**【已验证】**= 本机静态证据可复现（文件/类型库/手册/e-Manual 页面/Schema）；**【推断】**= 有间接证据但未做运行时验证；**【未知】**= 没有可靠证据，必须实验。
>
> 证据原文：类型库签名 dump 已保存在 [`docs/research/GXW3Call-API-raw.txt`](GXW3Call-API-raw.txt)（下文用 `raw:L42` 形式引用行号）。

---

## 0. 结论摘要（TL;DR）

| # | 结论 | 等级 |
|---|---|---|
| 1 | 本机确实安装了**官方自动化接口** `GXW3Call.dll`（OpenIF，COM/IDispatch，6 个 CoClass：Product / Session / Project / View / Communication / Transmitter，接口声明方法数 21/16/**100**/33/170/8，含各自 7 个标准 IDispatch 方法），能力覆盖「建/开/存/删工程、导入导出工程 XML、导入导出对象 CSV、编译、工程校验、在线读写、仿真起停、库管理」。 | **已验证**（raw:24-124、178-348、540-561、599-615、621-655） |
| 1b | **COM 调用环境已跑通**：32 位 PowerShell **晚绑定**（`[Type]::GetTypeFromCLSID` + `[Activator]::CreateInstance`，**不需要** Interop 程序集）成功创建 `GXW3CallProduct`/`GXW3CallTransmitter`/`GXW3CallSession`；`Product.Initialize(transmitter)`、`Product.GetOpenIFVersion()`（返回 **34**）、`Session.Initialize(transmitter)`、`Session.CheckSupport(1)` 均成功；过程中**没有**残留/新起 GXW3 GUI 进程。即：**「COM 桥缺 Interop 不是死路」**——落地路线 A 拆成 A1（晚绑定 sidecar，推荐）/A2（修复 Interop 桥）。 | **已验证（Lead，2026-11-10 本机只读探测；未含工程/编译/仿真调用）** |
| 2 | OpenIF **没有**「返回编译错误明细」的方法：`BuildProject`/`BuildProjectExt`/`RebuildProjectExt` 只回 `error/warning/checkWarning` 三个**数量**。但**编译前/编译中**有官方替代路径：UI 菜单「语法检查」「程序检查」的结果落在 Output 窗口（可用 UI 自动化读取）。ST 的编译错误明细获取是「全自动闭环」的**最大缺口之一**。 | **已验证**（raw:65、103-104；手册页 ID 132） |
| 3 | GX Works3 **官方支持**用 `IEC61131-10 XML` 一次导入「程序块 + 程序本体（ST 源码）+ 局部标签 + 全局标签 + 结构体 + FB/函数」，且有**官方样例** `SampleData\IEC61131-10XML\Sample.xml`、**官方手册附录**（附8）与**内嵌 XSD**（从 `XmlImportExport.Impl.dll` 中可直接提取）。**这推翻了仓库现有文档「IEC61131-10 XML 导入后程序内容为空 = 三菱缺陷」的结论**：v0.1 生成的文件其实是 **PLCopen TC6_0201（`<project>` 小写、`http://www.plcopen.org/xml/tc6_0201`）**，与 GX Works3 期望的 **`<Project>` + `www.iec.ch/public/TC65SC65BWG7TF10` 命名空间** 不是同一种格式，导入「空」更可能是格式不匹配，而不是三菱缺陷（需 M9 实验最终确认）。 | **已验证**（本机样例/手册/XSD）+ **推断**（失败根因） |
| 4 | 标签编辑器（全局/局部）**只能 CSV 导入**，XML **只能导出**（手册 5.x 标签的导出/导入）。现有 `docs/GXWorks3-导入指南.md`「局部标签 XML 导入（方式 A，推荐）」**是错的**。标签 XML 唯一可行的导入通道是「IEC61131-10 工程 XML 里的 `Vars`/`GlobalVars`」，而不是标签编辑器的导入菜单。 | **已验证**（手册页 ID 91） |
| 5 | 梯形图**不是**「只能手画」：`Edit → Import File → CSV(制表符分隔)` 可把**指令列表 CSV** 导入梯形图程序（8 列以后忽略；导入后未转换；FB 实例会变未定义部件）；也可把梯形图导出为 CSV/HTML/文本。ST 编辑器则没有文件导入，只有剪贴板粘贴 + 「Register Label（未定义标签登录）」。 | **已验证**（手册页 ID 111、92） |
| 6 | GX Works3 的 ST 编辑器里**没有变量声明区**：变量声明永远在「标签编辑器（局部标签）」；粘贴的 ST 正文里写 `VAR...END_VAR` 不会被当作声明（只能当非法语句）。所以「AI 生成 ST（含声明）直接粘进程序本体」这条路在语义上不成立，必须先落标签（CSV 导入 / IEC XML 一起导入 / Register Label）。 | **已验证**（手册 5.x、6.4、6.10；工程实践推断） |
| 7 | 已找到 **UI 自动化**的强证据基础：`MenuIdTableForQuickSearch.csv` 给出全部菜单 ID（含 `ID_MAINFRAME_CONVERT_ALL`=37634、`ID_ST_REGISTER_LABEL`=40006、`ID_MAINFRAME_PROJECT_IEC61131_10_XML_IMPORT`=37003、`IDR_LABEL_IMPORT_CSVDATA`=19009、`ID_MAINFRAME_TOOL_PRGCHECK`=38916 等），可作为菜单级 UI 自动化的稳定锚点。 | **已验证**（本机 `Service\Native\MenuIdTableForQuickSearch.csv`） |
| 8 | **OpenIF 参数取值（对象类型/语言类型/格式/模式/标志位）在本机无法得知**：类型库里没有 `TKIND_ENUM`，参数都是 `long/word`；原始 dump 只含方法签名，**不含 record 字段与常量**。这些取值只能来自外部 OpenIF 手册（本次未能取得）或运行时探测（`GetLanguageTypeList` 等）。这是路线 A 的**头号未知项**。 | **已验证**（raw 无枚举/记录字段）+ **未知**（具体取值） |
| 9 | **推荐路线**（综合确定性/维护成本）：**模板工程 + OpenIF 导入 IEC61131-10 XML → Build →（错误明细走 UI Output 窗口）**。**COM 环境已用 32 位晚绑定 sidecar 验证可行（§2.3）**，路线 A 因此拆为 A1（晚绑定 sidecar，推荐）/A2（修复 Interop 桥）。纯 OpenIF 闭环的剩余缺口集中在：枚举/记录取值、编译错误明细、新建工程后的 Program/任务绑定、硬件配置无法经 API 设置（只能靠模板工程）、32 位 STA 工程化、许可与合规确认。 | **推断**（基于 1-8 与本机证据）；其中「COM 可调用」已是 **已验证** |

---

## 1. 调研对象与方法

### 1.1 本机静态证据清单（全部为只读检查）

| 证据 | 路径 | 说明 |
|---|---|---|
| OpenIF COM 类型库 dump | `docs/research/GXW3Call-API-raw.txt`（源：`%TEMP%\gxw3call-dump\interfaces.txt`） | 6 个接口全部方法签名 + 参数名；`TypeInfoCount=142`；**不含 record 字段、不含 enum 常量** |
| OpenIF 主 DLL | `C:\Program Files (x86)\MELSOFT\GPPW3\GXW3Call.dll` | 文件/产品版本 `1.28.5.1`；ATL 单线程（Apartment）；TypeLib `{B315BAD7-5F04-4D1B-9689-EA2F41BC5BF4}` v1.0，注册名 `GXW3CallLib` |
| OpenIF 原生实现 | `Service\Native\Melco.GXW3.Controller.OpenIF.Native.Impl.dll`（3.29 MB） | 内含 `OpenIFControllerImpl / OpenIFCallDispatcher / ProjectCall / SessionCall / ViewCall / ProductCall / CommunicationCall / TransmitSink` 等实现类，印证「OpenIF 是把 COM 调用转发给 GX Works3 内部控制器」的架构（**推断**） |
| XML 导入导出实现 | `Service\Managed\Melco.GXW3.Controller.Project.Managed.XmlImportExport.Impl.dll`（2.2 MB） | 内含 **IEC61131-10 全套 XSD 与 AddData XSD**（可直接从 DLL 中提取，见 §6）；含 `IsCodesysXmlFile`、`XmlImportMode`、`ConvertErrorCodeForIEC61131_10` 等符号 |
| PLCOpen XML 转换器 | `Service\Managed\Melco.GXW3.Controller.ExternalData.Managed.PLCOpenXMLConverter.Impl.dll` | 另一个 XML 通道（PLCopen 方向，未展开） |
| 官方 IEC61131-10 样例 | `C:\Program Files (x86)\MELSOFT\GPPW3\SampleData\IEC61131-10XML\Sample.xml`（48,440 B，1,269 行，UTF-8） | 含 Program/FB/FUN/结构体/全局标签/**ST 程序本体**的完整可导入样例（手册明说「应参考存储位置中的样本文件」） |
| 电子手册（e-Manual） | `Doc\*.ema`（ZIP → SQLite `TBL_CONTENT`），共 59 本 | 含 **GX Works3 操作手册 SH-081271CHN**（本次主要依据）；**不含 Open Interface 手册** |
| 菜单 ID 全表 | `Service\Native\MenuIdTableForQuickSearch.csv`（118 KB） | 全部菜单 ID/父 ID/文本资源 ID，UI 自动化锚点 |
| GX Simulator3 | `GXSimulator3\Common\*`（FSim3Dlg.exe / GXS3IOSystem.exe / GXS3SysSim.exe 等） | 仿真器随 GX Works3 安装；OpenIF `View.StartSimulator` 走同一套 |
| 注册表 | `HKLM\SOFTWARE\WOW6432Node\Classes\CLSID\{B8FB0F14-…}\InprocServer32` 等 | CoClass 以 InprocServer32 注册在 32 位视图（**说明客户端必须 32 位**，与 MCP 桥缺 `GXW3Call.Interop.dll` 的现象一致） |
| **COM 晚绑定探测**（Lead 执行，2026-11-10） | 32 位 PowerShell：CLSID `{8da501e2-a5c2-48f5-9e18-b396fe88c5dc}`=Product、`{538f4ca5-cc9d-4e21-aa5e-ae293cdeaf9a}`=Transmitter、`{6896a2ff-5f4e-4540-a167-00e220c5a521}`=Session | **已验证**：三个对象可创建；`Product.Initialize`/`Session.Initialize`/`Session.CheckSupport(1)` 成功；`GetOpenIFVersion()`=**34**；探测前后无 GXW3 进程残留；out 参数在 PowerShell 需强类型（`[ref]`/C# 声明），否则 `DISP_E_BADVARTYPE` |
| 版本 | `GXW3.exe` 1.128.0.1；`GXW3Call.dll` 1.28.5.1；已装产品 `GX Works3 1.128.04519 / 1.128J` | 本调研基线 |

### 1.2 未做/不能做的事

- 本文档作者**未**启动 GX Works3 GUI、**未**创建/打开/保存工程、**未**执行仿真调用；**Lead 另行完成了只读晚绑定 COM 探测**（§2.3），其结论已并入本文并单独标注来源与时间。
- `web_fetch` 在本会话**全部失败**（网络出口受限），外部结论只能来自 `web_search` 的标题/摘要；因此 §12 的外部链接均标注「**仅检索摘要命中，未打开正文**」。
- 未取得 Mitsubishi 官方 *Open Interface* 单独手册（本机未安装、网络未检索到可打开的 PDF）。

---

## 2. OpenIF（GXW3Call）接口全景

### 2.1 六个 CoClass / 接口与调用模型【已验证】

| CoClass | 接口 | 方法数 | 角色 | raw 行 |
|---|---|---|---|---|
| `GXW3CallProduct` | `IGXW3CallProduct` | 14 + 7 | 产品/PLC 型号/语言类型/运行模式枚举、版本、帮助、文化 | raw:540-561 |
| `GXW3CallSession` | `IGXW3CallSession` | 9 + 7 | 会话（打开/关闭工程、连接、仿真状态、CheckSupport、Preload） | raw:599-615 |
| `GXW3CallProject` | `IGXW3CallProject` | **93 + 7** | **核心**：建/开/存/删工程、导入导出（XML/CSV/PLC 格式/PrivateData）、编译、校验、标签、POU、库、密码 | raw:24-124 |
| `GXW3CallView` | `IGXW3CallView` | 26 + 7 | GUI 视图/对话框：ShowPOUBody、显示标签、诊断/校验对话框、**StartSimulator/StopSimulator**、新建工程对话框 | raw:621-655 |
| `GXW3CallCommunication` | `IGXW3CallCommunication` | 163 + 7 | 在线通信：OpenOnline、设备读写、监视、下载/上传、SLMP/CC-Link IE、错误信息 | raw:178-348 |
| `GXW3CallTransmitter` | `IGXW3CallTransmitter` / `IGXW3CallTransmitterEvent` | 1 + 7 / 1 | 命令通道（`SendData/BroadcastSendData(ulCommandID, data)`），配合各接口的 `_IGXW3CallXxxEvents` 做异步通知 | raw:573-593 |

【已验证】每个 CoClass 都有对应的 `_IGXW3Call*Events` 连接点接口（`IConnectionPointContainerImpl`），即 **OpenIF 是「同步调用 + 事件回调」模型**，多数耗时方法带 `wTimeOut` 与 `lpbCallID`（调用 ID，用于和事件回调对齐）。
【未知】事件回调的具体签名与触发时机（原始 dump 中 Events 接口 `funcs=0`，无方法列表；需要重新 dump 或手册）。

### 2.2 通用参数/返回约定【推断】

- 几乎所有方法末尾都有 `lpbCallID`（out，调用 ID）与 `lplReturnCode`（out，`long` 返回码）；`lpb...`/`lpl...` 是匈牙利前缀（`b`=BYTE? `l`=LONG），**不是** HRESULT 语义。
- 约定 **`lplReturnCode == 0` 表示成功**（**推断**：所有方法都回传它，且 ATL/OpenIF 惯例如此；需 M1 实测）。
- 耗时操作带 `wTimeOut`（WORD，秒或毫秒**未知**）。
- `lUserInterfaceMode` / `lOpenInterfaceMode`：GUI 模式选择（**推断**：0=无界面、1=显示界面；**未知**具体取值）。
- `Initialize(lpCommandSender)` 需传入一个命令接收者（客户端的 `IGXW3CallTransmitterEvent` 实现），`InitializeEX(lpCommandSender, bstrCultureName)` 额外指定语言（zh-CN 等）。
- 所有调用都需要 **32 位 STA 客户端**：CoClass 以 32 位 InprocServer32 注册，且 GXW3Call 内部是 ATL SingleThreadModel（`ThreadingModel = 'Apartment'`，见 GXW3Call.dll 字符串）【已验证】。

### 2.3 COM 调用环境：晚绑定 sidecar 已跑通（**已验证**，Lead 2026-11-10 只读探测）

| 项 | 结果 | 等级 |
|---|---|---|
| 32 位 PowerShell 晚绑定（不依赖 `GXW3Call.Interop.dll`） | `[Type]::GetTypeFromCLSID(…)` + `[Activator]::CreateInstance(…)` 成功创建 `GXW3CallProduct`(`{8da501e2-a5c2-48f5-9e18-b396fe88c5dc}`)、`GXW3CallTransmitter`(`{538f4ca5-cc9d-4e21-aa5e-ae293cdeaf9a`)、`GXW3CallSession`(`{6896a2ff-5f4e-4540-a167-00e220c5a521}`) | **已验证** |
| `Product.Initialize(transmitter)` → `Product.GetOpenIFVersion()` | 成功，返回 **34**（该整数与文件版本 `1.28.5.1` 的换算关系**未知**，仅作版本一致性校验基线） | **已验证**（返回值）；换算 **未知** |
| `Session.Initialize(transmitter)` → `Session.CheckSupport(1)` | `Initialize` 成功、`CheckSupport(1)` 返回 ok（`1` 对应的 API ID **未知**） | **已验证**（调用成功）；入参语义 **未知** |
| 是否拉起 GUI | 探测前后进程列表**无残留/新起 GXW3 进程** → 这 3 个对象**不强制**运行 GUI 引擎 | **已验证**（对 Product/Transmitter/Session） |
| 晚绑定的 out 参数 | PowerShell 直接传 `lpbCallID/lplReturnCode` 等 out 参数会出现 `DISP_E_BADVARTYPE`；需用 **C# 声明强类型**或 `[ref]`/`[System.Runtime.InteropServices]` 包装 | **已验证**（现象）；具体包装方式待 M0 固化 |
| 尚未验证 | `Project.CreateNewProject/OpenProject/ImportProjectXml/ImportObjectCsv`、`BuildProjectExt`、`ExportProjectXml`、`StartSimulator`、`Communication.*` | **待验证（M0-M10）** |

【推断】OpenIF 的实际架构是：客户端进程（32 位）加载 `GXW3Call.dll`（InprocServer），后者把调用转发给本机 GX Works3 控制器服务（`Melco.GXW3.Controller.*`，见 §1.1「OpenIF 原生实现」dll）；是否/何时需要 GX Works3 GUI 由 `lUserInterfaceMode` 及各方法自身语义决定（**U11**）。因此「COM 调不通」不再构成路线 A 的阻断点，剩余风险回到 **枚举取值 / 导入语义 / 编译错误明细 / 硬件配置**。

---

## 3. 接口能力表（按任务分类）

> 约定：`S` = 同步；`A` = 异步（带 `lpbCallID` + 事件）；「返回」列写 out 参数/返回值形式。
> 状态：✅已验证（签名/存在性）／⚠️推断（语义）／❓未知（取值/行为）。

### 3.1 建工程 / 开工程 / 存工程

| 方法（Project 接口） | 关键参数 | 返回 | 状态与备注 |
|---|---|---|---|
| `CreateNewProject` raw:34 | `bstrProjectPath, bstrTitle, lSaveType, dwPlcSeries, dwPlcType, dwLanguageType, wTimeOut, lUserInterfaceMode` | callID + returnCode | ✅存在；⚠️`dwLanguageType` 是**程序语言**（0=LD/1=ST? ❓）；❓新建后是否自带 Program 节点/任务；❓`bstrProjectPath` 指工作区目录还是 `.gx3` 单文件；❓`lSaveType`（工作区/单文件）取值 |
| `CreateNewProjectWithPassword(PrefixExt)` raw:56/68 | 同上 + `userName/password(+dwOperationMode)` | 同上 | ✅存在 |
| `CreateNewProjectForTypeModel` raw:112 | `dwPlcTypeModel, dwPlcAxisNum, dwNetworkType, …` | 同上 | ✅存在（MX 控制器类机型，非本任务主线） |
| `CreateNewProjectFromRecordingFile` raw:109 | `bstrRecordingFilePath` | 同上 | ✅存在（从「记录文件」恢复工程，未验证用途） |
| `ChangePlcType(Ext)` raw:58/77 | 新旧 PLC 系列/机型（`bstrNewProjectPath`、`bOverwrite`） | returnCode | ✅存在 |
| `OpenProject(WithPassword[Ext])` raw:35/57/105 | `bstrProjectPath, wTimeOut, lUserInterfaceMode[, user/pass]` | callID + `pbIsReadOnly` + returnCode | ✅存在；⚠️打开已有工程是最稳的入口 |
| `AttachProject` raw:37 | `bstrProjectPath` | callID + `pbIsReadOnly` | ✅存在；语义（附着到已在 GUI 打开的工程？）❓ |
| `CloseProject` / `SaveProject` / `SaveAsProject` raw:36/38/39 | `lOption`（保存选项？）、`lSaveType`、`lInheritanceRights` | returnCode | ✅存在；`lOption` 取值 ❓ |
| `DeleteProject` / `RenameProject(Ext)` raw:40/41/106 | 路径 | returnCode | ✅存在 |
| `IsProjectOpened` / `GetProjectStatus(Ext)` / `SetProjectStatus` raw:42-44/115 | 路径/状态 | `lplOpenCount`/`lpdwStatus` | ✅存在；状态枚举 ❓ |
| `IsProjectModified` / `IsProjectCompiled` raw:62/63 | — | bool | ✅存在；**`IsProjectCompiled` 可作为 Build 结果的旁证** |
| `GetPlcType` / `GetSystemHardwareConfiguration(×FXV)` raw:45/67/78 | — | `lpdwPlcType/lpdwPlcSeries` / `lpSystem` | ✅存在；**只读，无 Set 硬件配置方法**（见 §4 缺口） |
| `GetOperationMode(Ext)` raw:69/116 | 路径 | `lpdwOperationMode` | ✅存在 |
| `GetDefaultConnection` / `SetDefaultConnection` raw:46/47 | `_ST_CONNECTION_INFO` | — | ✅存在（在线通信目标设置） |
| `GetConnectionList` / `SetConnectionList` raw:70/93 | `_ST_CONNECTION_INFO_ALL` | 列表 | ✅存在 |
| `GetUpdateTimeList` raw:95 | 工程路径 | `_ST_UPDATE_TIME` 列表 | ✅存在（工程改写时间，可用于「是否真的写入成功」的旁证） |
| `ImportPlcFormatData(Ext)` / `ExportPlcFormatData(Ext)` raw:79/80/97/108 | `_ST_PLC_FILE_DATA` 列表 + 目标目录 | 数据/错误 | ✅存在；❓「PLC format data」是否可整包替换程序文件（若可，这是绕开 XML 的另一条写入通道） |

### 3.2 标签（全局 / 局部）

| 方法 | 关键参数 | 返回 | 状态与备注 |
|---|---|---|---|
| `GetGlobalLabelListNames` raw:83 | — | `lpdwSize, lppstNames` | ✅存在（全局标签表名列表） |
| `GetPOUNames` raw:85 | `lPOUType` | `lppstNames` | ✅存在；❓`lPOUType`（程序/FB/函数）取值，但**配合 `GetLabels` 可用于「导入后回读校验」** |
| `GetLabels` raw:86 | `lLabelListType, bstrLabelListName, lClassFilter, lRequestedProperties` | `_ST_LABEL_INFO[]`（11 字段❓） | ✅存在；**只读**，没有 Set/AddLabel 方法 |
| `GetLabelAssignment` raw:89 | `bstrLabelName, bstrObjectName, lObjecType` | `lpbstrLabelAssignment`（设备分配）、`lpbstrLabelClass`、`lpbstrLabelDataType` | ✅存在；**编译后查询「标签→自动分配软元件」的关键接口** |
| `GetLabelAssignmentExt` raw:110 | 同上 + 列表大小 | `_ST_LABEL_ASSIGNMENT_DATA[]`（4 字段❓） | ✅存在 |
| `GetLabelDeviceComment` raw:111 | 名称/对象 | `lpbstrComment` | ✅存在 |
| `GetLabelCategory` raw:119 | 名称/对象 | `lpdwLabelCategory` | ✅存在 |
| `GetSDTNames` raw:84 | — | 结构体名列表 | ✅存在 |
| （导入通道） | — | — | **OpenIF 无「直接写标签」方法**；标签只能随 **IEC61131-10 XML**（`Vars`/`GlobalVars`）或 **UI 的 CSV 导入**进入 |

### 3.3 程序体（ST）写入 / 导入导出

| 方法 | 关键参数 | 返回 | 状态与备注 |
|---|---|---|---|
| `ImportProjectXml` raw:51 | `bstrImportFilePath, lImportFlags, lImportMode, bstrReservedForFutureUse` | `lplImportErrors, lplReturnCode` | ✅存在；⚠️**最可能对应 UI「工程 → 导入文件 → IEC61131-10 XML格式」**（同名功能；M3 验证）；`lImportFlags/lImportMode` 取值 ❓ |
| `ExportProjectXml(Ext)` raw:49/54 | `bstrExportFilePath, bFormat(, lExportMode)` | `lplExportErrors` | ✅存在；❓`bFormat`（0/1?）决定导出哪种 XML（IEC61131-10? PLCopen? 内部格式?）；**M0 用它导出真实 ST 工程反推格式** |
| `ImportObjectCsv` raw:122 | `bstrImportFilePath, bstrObjectName, lObjectType, dwLanguageType, dwConversionMethod` | returnCode | ✅存在；⚠️参数组合高度类似 UI「梯形图 CSV 导入」的「错误指令转换方法」（`dwConversionMethod`），**是否支持 ST 语言 = 头号未知**；`lObjectType/dwLanguageType` 取值 ❓ |
| `ExportObjectCsv` raw:121 | `bstrExportFilePath, bstrObjectName, lObjectType` | returnCode | ✅存在；**先用它导出 ST 程序，即可回答「ST 能否 CSV 往返」** |
| `ExportObjectXml(Ext)` raw:50/55 | `bstrExportFilePath, bFormat, bstrObjectName, lObjectType(, lExportMode)` | `lplExportErrors` | ✅存在；建议先用它导出**已有 ST 工程**看 XML 结构 |
| `PastePrivateData` raw:72 | `dwSize, lpucData, bstrProgDataMapFileName` | returnCode | ✅存在；⚠️这是「粘贴私有数据」的 API 化：**若 blob 格式可构造，就能绕过剪贴板**；但格式专有、无导出方法（只有单向 Paste/Import）→ 可作「模板 blob 替换」方向，不做主线 |
| `ImportPrivateData` raw:73 | 同上 | returnCode | ✅存在；同上 |
| `DeleteProjectViewObject` / `RenameObject` raw:52/64 | 名称 + `lObjectType` | returnCode | ✅存在（建/删/改名对象；**没有 CreatePOU**，只有删/改名） |
| `ExportProgramViewHtml` raw:81 | `bstrProgramName, bstrExportFilePath` | returnCode | ✅存在（渲染程序视图 HTML，可做「真实产物证据」） |
| （无直接写 ST 文本方法） | — | — | ❌**没有** `ImportStText/SetProgramBody`；ST 正文进入工程的合法通道只有：① IEC61131-10 XML；② 对象 CSV（待验证 ST）；③ PrivateData；④ UI 剪贴板 |

### 3.4 编译与错误获取

| 方法 | 关键参数 | 返回 | 状态与备注 |
|---|---|---|---|
| `BuildProject` raw:65 | — | `lpdwError, lpdwWarning, lpdwCheckWarning` | ✅存在；⚠️等价「转换（Convert）」；**只有数量，无明细** |
| `BuildProjectExt` raw:103 | — | 同上 | ✅存在（Ext 版本，通常修复/扩展语义，差异❓） |
| `RebuildProject` raw:66 | `lLabelAssignmentType, bCheckProgram` | 三个计数 | ✅存在；⚠️等价「全部转换（Rebuild All）」；`lLabelAssignmentType`=维持/重新分配（❓取值） |
| `RebuildProjectExt` raw:104 | 同上 | 同上 | ✅存在 |
| `IsProjectCompiled` raw:63 | — | bool | ✅存在 |
| `SimpleVerifyProject(Ext)` raw:92/107 | `bstrProjectPath, bstrReportFilePath, SourceHeader, DestinationHeader[, user/pass]` | `lpbIsIdentical` + **报告文件** | ✅存在；**编译/导入后的回归对比利器** |
| `SimpleVerifyProjectDiff(Ext)` raw:123/124 | + `lDiffMode` | 同上 | ✅存在；`lDiffMode` ❓ |
| `GetFileListForDownload` raw:101 | — | `_ST_PLC_FILE_DATA` 列表 | ✅存在；**编译成功会生成可下载程序文件，可用文件列表/大小作为「真的编译出了代码」的行为证据** |
| `GetExecutingFunctions` raw:102 | — | `ldwExecutingFunctions` | ✅存在（语义❓，名称像「GX Works3 正在执行的功能」，可能与长任务状态有关） |
| **没有** `GetBuildErrors/GetOutputMessage` | — | — | ❌**能力缺口**：错误明细必须另找通道（UI Output 窗口自动化 / 导出 HTML？❓ / 事件回调？❓） |
| `GetDiagnosticsDialog`（View）raw:645 | `lDiagnosticsDialog` | returnCode | ✅存在（诊断对话框，非编译输出） |

**编译错误获取的候选路径（按确定性排序）**：
1. **UI 自动化读 Output 窗口文本**（手册明确：语法检查/程序检查/转换错误都显示在 Output 窗口；页 ID 132/133）——最确定，但依赖 GUI；
2. 先用 `ExportProgramViewHtml` 或 `ExportObjectXml` 导出「带未转换标志」的程序再对比（间接，❓）；
3. 事件回调（`_IGXW3CallProjectEvents`）是否携带错误字符串（❓，需补 dump/手册）；
4. `BuildProject` 返回三个计数 + `GetFileListForDownload`/`IsProjectCompiled`/`GetLabelAssignment` 组合做「粗判定」，再对失败工程读取 UI 输出——**推荐**：非零 error 时才启动 UI 读取明细，降低对 GUI 的依赖。

### 3.5 仿真启动 / 停止

| 方法 | 关键参数 | 返回 | 状态与备注 |
|---|---|---|---|
| `StartSimulator`（View）raw:651 | `lStartUpMode` | returnCode | ✅存在；❓`lStartUpMode` 取值；❓是否需要 GUI/是否有无界面模式；❓仿真程序从哪来（是否自动编译下载） |
| `StopSimulator`（View）raw:652 | — | returnCode | ✅存在 |
| `IsSimulation`（Session）raw:611 | — | `lpdwStatus` | ✅存在 |
| `GetSimulatorNo` raw:114 | — | `lpwSystemID, lpwCPUID, lpwSimulatorType` | ✅存在 |
| `IsPlcOnline`（Communication）raw:241 | — | `lpbIsOnline, lpbIsSimulation, lpbstrPlcType` | ✅存在（区分「真机/仿真」） |

【已验证】本机安装了 GX Simulator3（`GXSimulator3\Common\GXS3SysSim.exe` 等）。
【未知】OpenIF 能否**无 GUI** 完成「编译→下载到仿真→RUN→读设备」；`StartSimulator` 只有启动，**没有**「Download to simulator」显式方法（`Download` 在 Communication 接口面向真实连接目标），仿真下载很可能仍由 UI 完成 → 对「零人工行为验证」是重要风险。

### 3.6 在线设备读写（真机/仿真网关）

| 方法 | 关键参数 | 返回 | 状态与备注 |
|---|---|---|---|
| `OpenOnline` / `CloseOnline` raw:195/196 | `dwOnlineOperation` | returnCode | ✅存在 |
| `DeviceReadOpen/Run/Close` raw:264-266 | `dw{Bit,Word,DWord,QWord}Length + lpsz*Device + 输出缓冲` | 值数组 | ✅存在（**批量随机读写，一次可混合 bit/word/dword/qword**） |
| `DeviceWriteOpen/Run/Close` raw:267-269 | 同上（无 errorCheck） | returnCode | ✅存在 |
| `ReadDeviceRandom` raw:202 | `lpbstrAddress, dwDataSize` | `lpwData` | ✅存在 |
| `ReadBufferMemory` raw:246 | `wIONumber, lStartOffset, lReadSize` | 数据 | ✅存在 |
| `MonitorAll` / `MonitorPOU` raw:244/245 | `lMonitorAction`(start/stop), `bstrPOUName, bstrFBInstanceName, bstrTargetLocation` | returnCode | ✅存在（程序监视；可用于行为验证） |
| `LogonToPlc` / `SetRemotePassword` raw:239/219 | — | returnCode | ✅存在 |
| `GetPlcRunStatus` / `SetPlcRunStatus` raw:189/322 | `wTarget, wPlcStatus, lNetNo, lGroupNo, lClearMode, lSignalMode` | returnCode | ✅存在（RUN/STOP/clear） |
| `Download` raw:321 | `lWriteMode, _ST_PLC_FILE_DATA 列表` | returnCode | ✅存在（写 PLC 程序/数据；**面向真实 PLC，不是仿真**） |
| `Upload` / `UploadProject` raw:220/275 | `lDriveNo, dwFileTypes, …` | 文件数据 | ✅存在 |
| `GetPlcFileList` / `GetFileListForDownload` raw:217/101 | `lDriveNo` | 文件列表 | ✅存在 |
| `GetErrorMessage` raw:260 | `dwErrorCode` | `lpszErrorMessage` | ✅存在（**通信/PLC 错误码**，不是编译错误） |
| `SendReceiveSLMPCommand` / `ExecuteSLMPCommand*` raw:247/199/312 | 帧类型参数 + 收发数据 | PDU 返回码 | ✅存在（可直接发原始 SLMP 帧，是「补充通道」：读写设备/远程控制） |

【推断】SLMP/MC 协议本身只覆盖**软元件读写/远程 RUN-STOP**，**不能写程序**；程序下载仍必须由 GX Works3（OpenIF `Download` 或 UI 在线菜单）完成。这与仓库 README「不下载 PLC」的现状一致。

### 3.7 工程对比与导出报告

| 方法 | 关键参数 | 返回 | 状态与备注 |
|---|---|---|---|
| `SimpleVerifyProject(Ext)` | 目标工程 + **报告文件路径** + 左/右表头 | `lpbIsIdentical` | ✅存在（生成「工程校验」报告文件；可做 CI 回归） |
| `SimpleVerifyProjectDiff(Ext)` | + `lDiffMode` | 同上 | ✅存在 |
| `ExportUsedDeviceAndLabel` raw:120 | `bstrExportFilePath` | returnCode | ✅存在（导出已用软元件+标签；**编译后可用于核对标签地址分配**） |
| `ExportProgramViewHtml` raw:81 | 程序名 + 文件路径 | returnCode | ✅存在 |
| `ExportProjectXml/ObjectXml` | 见 3.3 | `lplExportErrors` | ✅存在（可做 XML 快照对比） |
| `GetUpdateTimeList` | 工程路径 | 时间列表 | ✅存在 |
| `ExportLibrary` / `OpenLibrary` / `UpdateLibraryPou` raw:87/88/90 | 库文件 | — | ✅存在（用户库导出/打开/更新） |
| `GetPOUsLockedByBlockPassword` / `Unlock/AddPOUBlockPassword` raw:98/99/100 | POU 名 + 口令 | — | ✅存在（块口令管理） |

### 3.8 OpenIF **明确没有**的能力（对方案最关键）

| 缺口 | 影响 | 现状替代 |
|---|---|---|
| 无「获取编译错误明细」 | 无法自动生成「错误→修复」闭环 | UI Output 窗口自动化；或计数+导出对比 |
| 无「写单个标签 / 建 POU」API | 不能逐条建标签；POU 只能随导入整体生成 | IEC61131-10 XML / UI CSV 导入 |
| 无「设置 CPU 参数 / 模块配置 / 任务绑定」API | 新建工程若缺硬件配置，程序可能无法转换 | **模板工程**（人工准备）→ 只导程序/标签 |
| 无「写 ST 正文」API | ST 必须经 XML/CSV/PrivateData/剪贴板 | 同 3.3 |
| 无「导出 `.gx3` 二进制 / 解析工程文件」API | 只能通过 XML/CSV/HTML 等官方导出物做外部审查 | 官方导出物 + 工程校验报告 |
| 无「无 GUI 仿真下载/运行」明确路径 | 行为验证仍可能要 GUI | `StartSimulator`+UI 操作（M10 验证） |
| 无「授权/许可检查」API | 自动化运行的合规边界不明 | 需人工确认 Mitsubishi 许可条款（❓） |

---

## 4. 关键未知项清单（按优先级）

| # | 未知项 | 为什么关键 | 取得方式 | 优先级 |
|---|---|---|---|---|
| U1 | `ImportObjectCsv` 的 `lObjectType` / `dwLanguageType` / `dwConversionMethod` 取值；**是否支持 ST 语言** | 若支持，则「ST 文本→CSV→工程」是一条比 XML 更细粒度的写入通道 | ① 用 `ExportObjectCsv` 导出真实 ST/LD 程序反推；② `Product.GetLanguageTypeList` 枚举语言码；③ OpenIF 手册（未取得） | **P0** |
| U2 | `ExportProjectXml/ExportObjectXml` 的 `bFormat`（与 `ExportProjectXmlExt` 的 `lExportMode`）取值；导出的 XML 是 IEC61131-10 / PLCopen / 内部格式中的哪一种 | 决定「导出→比对→再导入」闭环能否成立；也是 M0 实验核心 | 对同一 ST 工程用不同 bFormat 各导一次，比对 XML 根元素/命名空间；与 `Sample.xml` 对照 | **P0** |
| U3 | `ImportProjectXml` 的 `lImportFlags` / `lImportMode` / `bstrReservedForFutureUse` 语义 | 决定导入是「追加/替换/跳过」「仅导入选中对象」还是别的 | 手册（未取得）+ 实验矩阵（0..3 × 0..3 小样本） | **P0** |
| U4 | 编译错误明细如何取得（事件？Output 窗口？导出？） | 决定「AI 修复闭环」的自动化程度 | 补 dump `_IGXW3CallProjectEvents`；UI 自动化读 Output；抓 `BuildProject` 调用期间是否有事件/文件产生 | **P0** |
| U5 | `CreateNewProject` 后是否自带 Program 节点 + 任务/执行类型；`dwLanguageType` 是否决定程序语言 | 决定「从零建工程」能否一步到位，还是必须模板工程 | M2 实验：建工程后 `GetPOUNames(Program)` + UI 观察；或建后 `ExportProjectXml` 看结构 | **P0** |
| U6 | 全部枚举取值：`lPOUType`、`lLabelListType`、`lClassFilter`、`lRequestedProperties`、`lObjecType`、`lSaveType`、`lOption`、`lLabelAssignmentType`、`lImportFlags/Mode`、`lExportMode`、`lUserInterfaceMode`、`lOpenInterfaceMode`、`lStartUpMode`、`lMonitorAction`、`dwOnlineOperation`、`lWriteMode`、`lDiffMode` | 没有取值几乎无法写稳定代码 | 外部 OpenIF 手册（优先）/ 运行时枚举法（`GetPlcSeriesList`→`GetPlcTypeList`→`GetLanguageTypeList`、`GetOperationModeList`）；交叉验证 | **P0** |
| U7 | 原始 dump 缺 **record 字段布局**（`_ST_LABEL_INFO` 11 字段、`_ST_OBJID` 11、`_ST_LABEL_ASSIGNMENT_DATA` 4、`_ST_PLC_FILE_DATA` 5、`_ST_PROJECT_OBJECT` 2 …） | 无字段名/类型无法构造结构体入参（如 `_ST_LABEL_INFO` 回读、`_ST_PLC_FILE_DATA` 导入） | 重新 dump 类型库（同一工具补 `ITypeInfo::GetVarDesc`/`GetImplTypeFlags`）；或从 OpenIF 手册抄结构体 | **P1** |
| U8 | `PastePrivateData`/`ImportPrivateData` 的 blob 格式（是否 = GX Works3 剪贴板私有格式；`ProgDataMapFileName` 是什么） | 若可构造，可绕开 XML 直接写程序体；若不可，只能作模板迁移 | 抓一次真实「复制程序→粘贴」的剪贴板/PrivateData 字节做比对；手册 | P2 |
| U9 | `bstrProjectPath` 指向「工作区目录」还是「单文件 `.gx3`」；`lSaveType` 与文件格式关系 | 决定工程落盘形态与清理策略 | M2 实验 + 手册「3.1 工程文件与数据结构」（工作区/单文件两种） | P1 |
| U10 | OpenIF 是否需要额外 License/Option；是否允许第三方程序自动化 GX Works3 | 商用合规红线 | 人工确认 Mitsubishi 许可/销售渠道；OpenIF 手册（未取得） | P1（非技术） |
| U11 | 无 GUI 模式的完整可行性（`lUserInterfaceMode=0` 时哪些方法可用；是否必须已登录桌面会话） | 决定能否放进 CI/服务端 | M1 实验矩阵 | P1 |
| U12 | `ExportProgramViewHtml` 是否包含编译错误/未转换标记；是否可替代 Output 窗口 | 错误明细的低成本替代 | 对「故意写错」的工程导出 HTML 观察 | P2 |
| U13 | 菜单 ID `ID_MAINFRAME_PROJECT_PLCOPEN_XML_IMPORT`(36997) 是否存在 UI 入口、导入什么格式 | 若 GX Works3 支持 PLCopen XML 导入，则可直接用标准格式（生态更通用） | UI 观察 + 手册英文版核对（未取得正文） | P2 |
| U14 | `GetLanguageTypeList` 返回结构（`lpstLanguageTypeArray` 的 record 定义与取值） | 一次性解决 U1 的一半 | 调用+回读；或补 dump | P0（与 U1 合并） |

> **建议的补 dump 脚本要点**（后续授权会话执行，非本次）：遍历 `ITypeInfo` 的 `TYPEATTR`，对 `TKIND_ENUM` 输出 `VARDESC.desc.constValue`，对 `TKIND_RECORD` 输出 `VARDESC` 的 `elemdescVar`（类型名/偏移）；事件接口 `TKIND_DISPATCH` 的方法表也要 dump（当前为 0）。

---

## 5. 两条/三条落地路线

> 三条路线的共同前提（本机已验证）：**程序转换（Build）依赖 CPU 参数/执行类型/模块配置**（手册 6.10/6.11、README 的实践结论），因此**建议所有路线都从「模板工程」起步**：人工准备一个「已配置 CPU/模块、已有 MAIN 程序块（ST）、已有任务绑定」的 `.gx3` 模板，自动化只做「填内容 + 编译 + 取结果」。

### 路线 A：OpenIF 导入 IEC61131-10 XML（或对象 CSV）→ Build

> **A 已不再是「能不能调通」的问题**：Lead 的晚绑定探测（§2.3，**已验证**）证明 32 位 sidecar 不依赖 Interop 即可创建 OpenIF 对象并完成 `Initialize`/`CheckSupport`/`GetOpenIFVersion`。因此路线 A 拆成两个实现方案：

#### A1（**推荐**）：32 位晚绑定 sidecar 进程

**形态**：Node CLI 通过 `child_process` 启动一个**常驻 32 位 sidecar**（PowerShell 或最小 C# exe），sidecar 用 CLSID 晚绑定持有 `GXW3CallProduct/Session/Project`，通过 stdin/stdout（JSON 行）与主进程通信；所有 COM 调用集中在 sidecar 内，主进程保持零依赖 TS。

| 维度 | 评估 |
|---|---|
| 可行性 | **已验证到「对象可创建 + 基础调用成功」**（§2.3）；工程级调用待 M0 验证 |
| 优点 | 不依赖 `GXW3Call.Interop.dll`；不污染主 CLI 的「零依赖」定位；sidecar 可独立重启（崩溃隔离）；out 参数可在 C#/PowerShell 侧用强类型声明一次性解决 `DISP_E_BADVARTYPE` |
| 脆弱点 | ① 需保证 sidecar 是 **32 位**（`%WINDIR%\SysWOW64\WindowsPowerShell\v1.0\powershell.exe` 或 x86 编译目标）；② 需 STA 线程（PowerShell 默认 MTA → 显式 `[Threading.Thread]::CurrentThread.ApartmentState='STA'` 或用 C# `[STAThread]`）；③ 大参数（XML 路径/数组/结构体）要序列化；④ 32 位地址空间限制（对 XML 文件路径无碍） |
| 需要的验证 | **M1 已部分通过**（Product/Session），**M2-M6、M9 全部待做** |

#### A2（备选）：修复 `GXW3Call.Interop.dll` COM 桥

**形态**：为 MCP gxworks3 桥生成/放置 Interop 程序集（或改用 `dynamic`/`Type.GetTypeFromCLSID` 的现有桥代码路径），让桥直接调用 OpenIF。

| 维度 | 评估 |
|---|---|
| 可行性 | 理论上可行（Interop 可用 `tlbimp` 从注册的 `GXW3CallLib` 生成），但本次复现的错误是桥**硬编码路径**查找 `GXW3Call.Interop.dll`（`%TEMP%\dsh-gxworks3-com-test\`），属工程修补 |
| 优点 | 与现有 MCP 工具链天然集成；无需新进程 |
| 脆弱点 | ① 需 tlbimp/注册类型库，构建链变重；② 32 位/64 位宿主不匹配风险；③ 修的是「桥」而不是「接口」，桥的其它假设（超时、线程、错误映射）仍需验证 |
| 需要的验证 | M1（桥侧）；与 A1 可并行，作为 MCP 集成形态 |

**A 的完整流程**：模板工程（或 `CreateNewProject`）→ `ImportProjectXml`（一次导入 Program/Vars/GlobalVars/结构体/FB，ST 正文在 `MainBody/BodyContent xsi:type="ST"`）→ `BuildProject`/`RebuildProject` → 取错误数 →（错误明细：UI Output 窗口）→ `GetLabelAssignment`/`ExportUsedDeviceAndLabel`/`IsProjectCompiled`/`GetFileListForDownload` 做结果证据。

| 维度（A 整体） | 评估 |
|---|---|
| 确定性 | **高**（格式侧有官方样例+手册+内嵌 XSD；接口侧有官方 COM 签名；COM 环境已跑通基础调用）；剩余风险集中在 §4 未知项 |
| 零人工潜力 | **最高**：一次导入=标签+程序本体+结构体，天然避免「逐条建标签」 |
| 主要脆弱点 | ① 枚举/格式取值未知（U1-U3、U6、U7）；② 错误明细缺失（U4）；③ 硬件配置必须靠模板（§3.8）；④ 32 位 STA sidecar 的工程细节（A1）/ Interop 修补（A2）；⑤ 无 GUI 模式未知（U11）；⑥ OpenIF 手册缺失导致参数语义只能实验反推 |
| 需要的验证 | **M0-M6、M9、M10**（见 §6） |

### 路线 B：UI 自动化（剪贴板粘贴 ST + 菜单/快捷键）

**流程**：打开模板工程 → 打开目标 POU 的「程序本体」工作表（ST 编辑器）→ `Ctrl+A / Ctrl+V` 粘贴 AI 生成 ST（**只含语句**）→ 标签先由 CSV 导入（`IDR_LABEL_IMPORT_CSVDATA`）或粘贴后用 `Edit → Register Label`（菜单 ID `ID_ST_REGISTER_LABEL`=40006）批量登记未定义标签 → `Convert → Rebuild All`（`ID_MAINFRAME_CONVERT_ALL`=37634）→ 读 Output 窗口错误 → 保存。

| 维度 | 评估 |
|---|---|
| 确定性 | **中高**（剪贴板文本粘贴是 GX Works3 一直支持的操作；但**手册未把「粘贴」写成条目**，属工程实践；UI 自动化对窗口焦点/语言/DPI/模态框敏感） |
| 零人工潜力 | 高（可做到「全自动」，但稳定性低于路线 A） |
| 主要脆弱点 | ① 粘贴前必须先有标签（否则转换必报「未定义标签」）；② 每个 POU 都要导航+选中工作表，重复动作多；③ 模态对话框（覆盖确认、未保存提示、转换错误）容易卡住；④ 错误定位仍需读 Output 窗口（与 A 共同痛点） |
| 需要的验证 | **M7（含重复稳定性 50 次）** |

### 路线 C（补充）：Register Label「未定义标签登录」

**流程**：把 AI 生成的 ST 里**不写声明**（或写注释），粘贴正文 → 选中未定义 token → `Edit → Register Label` → 在「Undefined Label Registration」对话框里为每个未定义标签选数据类型/类 → 关闭 → 转换。

| 维度 | 评估 |
|---|---|
| 确定性 | 中（手册页 ID 92 明确记载 ST 编辑器有该功能；对话框字段/是否支持批量/是否记住数据类型 = ❓） |
| 适用场景 | 没有标签 CSV/XML 生成能力时的**兜底**；或做「ST 代码增量修改、只新增少量标签」 |
| 主要脆弱点 | 未定义标签通常**无法推断数据类型**（AI 必须额外给声明元数据；GX Works3 可能弹默认类型），且对话框是逐标签交互 → 自动化收益有限 |

**推荐**：**A1（32 位晚绑定 sidecar）+ 模板工程 + IEC61131-10 XML** 为唯一主线；**A2** 仅作为「要让 MCP 工具链原生集成」时的并行实现；B 作为 A 不稳定时的备份；C 只做局部补丁场景。

---

## 6. 验证实验清单（每条：输入 / 操作 / 期望输出 / 判定）

> 前置前提：在**获授权**的桌面会话中，用 **32 位 sidecar（晚绑定，已验证可行，§2.3；无需 `GXW3Call.Interop.dll`）** 或修复后的 Interop 桥调用 OpenIF；先确认 `lplReturnCode=0` 语义与 out 参数强类型封装（M1）。每条实验都必须遵守：**只在副本工程上操作、不碰生产工程、不下载真机**（仿真相关实验单列 M10 并单独授权）。

| ID | 目的 | 输入 | 操作 | 期望输出 | 判定/回退 |
|---|---|---|---|---|---|
| **M0** | **反推导出格式（最高优先）** | 人工建好的最小 ST 工程（1 个程序块 + 2 局部标签 + 2 全局标签 + 1 结构体） | 人工用 GX Works3 GUI 打开并另存副本；随后（授权会话）`ExportProjectXml` 以 `bFormat=0` 与 `1` 各导一次；`ExportObjectXml` 对同一 Program 各导一次 | 至少一种导出物包含 `<Project…>`/`<Program>`/`<MainBody><BodyContent xsi:type="ST"><ST>…</ST>` 与 `Vars`/`GlobalVars`；文本含 AI 能识别的 ST 源码 | 若两种 bFormat 都不是 IEC61131-10 → 记下实际根元素/命名空间，扩大 bFormat 扫描（0..7）；**任何结论都要回写 §4 U2** |
| **M1** | 打通 OpenIF 调用环境 | 32 位 PowerShell/C# sidecar（无需 Interop） | ✅ 已做（Lead）：创建 Product/Transmitter/Session、`Product.Initialize`、`Session.Initialize`、`CheckSupport(1)`、`GetOpenIFVersion`；**待做**：`GetCulture/SetCulture`、`GetPlcSeriesList`→`GetPlcTypeList`→`GetLanguageTypeList`、`GetOperationModeList`、STA 线程确认、out 参数强类型封装 | 版本号=**34** 可读；系列/机型/语言列表返回（语言列表应含 ST 的语言码） | **已部分通过（§2.3）**；失败项记录返回码，检查 GUI 依赖/STA/管理员权限 |
| **M2** | `CreateNewProject` 行为 | 路径/机型（FX5U 或 iQ-R）/`dwLanguageType` 枚举试探 | 建工程 → `GetPOUNames`→`GetProjectStatus`→（GUI 观察） | 明确：是否生成 Program 节点、任务/执行类型、默认标签；工程落盘形态 | 若不自带 Program/任务 → 固化「模板工程」策略 |
| **M3** | IEC61131-10 导入闭环 | 按官方 `Sample.xml` 改造的 XML：1 Program（ST 正文 `x:=y;`）+ 局部标签 + 全局标签 | `ImportProjectXml(flags=i, mode=j)` → `GetPOUNames`/`GetLabels`/`ExportObjectXml` 回读 | 程序本体出现 ST 源码；标签数量/类型正确 | 若空 → 从命名空间/`FileHeader`/`ContentHeader`/`BodyContent` 逐项排查（对照 §7）；同时检验 flags/mode 语义 |
| **M4** | ST 能否 CSV 往返 | 人工 ST 工程 | `ExportObjectCsv(program, objectType=?)` → 看 CSV 是否含 ST 行 → `ImportObjectCsv(..., languageType=?, conversionMethod=?)` | CSV 内含完整 ST；导入后程序等值 | 若不支持 ST → 关闭该支路（记入 U1 结论） |
| **M5** | 编译与错误证据 | 一好一坏两个 XML（坏：引用未定义标签/类型错） | `BuildProject`/`RebuildProject` → 记录三计数 → 读 GUI Output 窗口文本 → `IsProjectCompiled`/`GetFileListForDownload`/`GetLabelAssignment` | 好工程 error=0 且可下载文件非空；坏工程 error>0 且 Output 有错误文本 | 若 error=0 但实际未编译 → 说明 Build 是异步，需等事件/callID |
| **M6** | ImportProjectXml 的替换/合并语义 | 同一工程连续导两次（先 A 后 B，B 改标签名） | `ImportProjectXml` 两次，观察同名/异名处理 | 明确 flags/mode 的「追加/替换/跳过」组合 | 用 `SimpleVerifyProject` 报告做前后对比 |
| **M7** | UI 自动化路线稳定性 | 模板工程 + 10 份 AI 生成 ST | 自动化：打开工程 → 选 POU 工作表 → 粘贴 → 全部转换 → 读 Output → 保存；**重复 50 次** | 成功率、平均耗时、失败模式分类（焦点/模态框/语言/DPI） | 成功率 <95% → 以 A 为唯一主线 |
| **M8** | Register Label 路线 | 未声明变量的 ST | 粘贴 → 选中 token → `Edit→Register Label` → 对话框字段探查（自动化填写可行性） | 能否批量/半批量登记；类型默认规则 | 若只能逐条 → 仅作补丁场景 |
| **M9** | **v0.1「导入为空」根因确认** | 仓库 `build-xml` 产物（PLCopen TC6_0201） | 通过 GUI「工程 → 导入文件 → IEC61131-10 XML格式」导入 | 预期**仍为空**（因为根元素 `<project>`/命名空间不符）；再改用官方命名空间的最小 XML → **应成功** | 两结果即为根因证据；若不成立，说明 GX Works3 还接受 PLCopen TC6 → 结论改写并尝试菜单 36997 |
| **M10**（可选） | 行为验证上限 | 编译通过的工程 | `StartSimulator` → 观察是否需要 GUI/自动下载；`IsSimulation`/`ReadDeviceRandom`/`MonitorAll` | 明确「仿真启动→运行→读值」的自动化边界 | 若必须 GUI 下载 → 行为验证降级为「人工一次性配置仿真」 |

---

## 7. IEC61131-10 XML 导入规格（已从官方样例/手册/XSD 核实）

> 这是路线 A 的核心。以下内容来自：① 本机官方样例 `SampleData\IEC61131-10XML\Sample.xml`；② 手册 SH-081271CHN「数据的导入（IEC61131-10 XML格式）」与「附8 XML文件格式（IEC61131-10格式）」（e-Manual 页 ID 40、280-284）；③ `XmlImportExport.Impl.dll` 内嵌 XSD（3 个：主 Schema、AddData Schema、`_ForGXW3` 简化 Schema）。

### 7.1 文档骨架（对照官方样例）

```xml
<?xml version="1.0" encoding="utf-8"?>
<Project xmlns="www.iec.ch/public/TC65SC65BWG7TF10"
         schemaVersion="1.000"
         xsi:schemaLocation="www.iec.ch/public/TC65SC65BWG7TF10 GXW3_IEC61131_10_Ed1_0_ForGXW3.xsd">
  <FileHeader companyName="…" companyURL="…" productName="GX Works3" productVersion="…"/>
  <ContentHeader name="…" creationDateTime="…" modificationDateTime="…"/>
  <Types>
    <GlobalNamespace>
      <!-- 结构体 -->
      <DataTypeDecl name="ST_X"><UserDefinedTypeSpec><StructTypeSpec>
         <Member name="m1"><Type><TypeName>BOOL</TypeName></Type></Member>
      </StructTypeSpec></UserDefinedTypeSpec></DataTypeDecl>
      <!-- 程序块（ST） -->
      <Program name="ProgPou">
        <Vars accessSpecifier="private">                <!-- 局部标签（VAR）-->
          <Variable name="bStart">
            <Type><TypeName>BOOL</TypeName></Type>
            <Address address="X0"/>                     <!-- 可选：显式软元件 -->
            <InitialValue><SimpleValue value="FALSE"/></InitialValue>
          </Variable>
        </Vars>
        <TempVars retain="false" constant="false"/>     <!-- 临时变量（VAR_TEMP）-->
        <MainBody>
          <BodyContent xsi:type="ST"><ST>IF bStart THEN … END_IF;</ST></BodyContent>
        </MainBody>
      </Program>
      <!-- FB / Function 同理由 FunctionBlock / Function 元素表达，Parameters 内含 InputVars/OutputVars/InoutVars -->
    </GlobalNamespace>
  </Types>
  <Instances>
    <Configuration name="Configuration1">
      <Resource name="Resource1" resourceTypeName="…">
        <GlobalVars>                                     <!-- 全局标签 -->
          <Variable name="gRun"><Type><TypeName>BOOL</TypeName></Type></Variable>
        </GlobalVars>
        <ProgramInstance name="ProgPou_1" typeName="ProgPou" evaluationOrder="1"/>
      </Resource>
    </Configuration>
  </Instances>
</Project>
```

【已验证】样例中 ST 正文就是纯文本：`<BodyContent xsi:type="ST"><ST>Local1_1:=B0;</ST></BodyContent>`；多工作表用 `MainBody/AddData/Data[BodyProperties]`（`orderWithinBodyProperties`、`workSheetName`、`executeOrder`）描述。
【已验证】手册附8 的元素映射：程序块=`Project/Types/GlobalNamespace/Program`；数据名=`Program.name`；程序语言=`MainBody/BodyContent/xsi:type`；局部标签=`Program/Vars`（仅 `accessSpecifier="private"`）+`Program/TempVars`；FB=`FunctionBlock`；函数=`Function`；结构体=`DataTypeDecl/UserDefinedTypeSpec/StructTypeSpec`；全局标签=`Project/Instances/Configuration/Resource/GlobalVars`（也支持 `Instances/Configuration/GlobalVars`、`Program/GlobalVars` 两种位置）。
【已验证】「仅导入 **ST 语言**的数据」（手册 0600E 原文）；LD/FBD/SFC 的 `xsi:type` 在 Schema 中存在，但**导入器只处理 ST**。
【已验证】缺元素时的默认值：名称缺失→不创建；标题/版本/帮助路径→空；更新时间→导入时刻；类/保留区域等有默认；`Vars` 的 `accessSpecifier` 非 private 的变量**不创建**。
【已验证】`AddData` 扩展（Mitsubishi 私有，缺省可省略，导入用默认值）包括：
`PouProperties`(title/version/helpFilePath/supportVersion/modificationDateTime/safety)、`FbPouProperties`(isMcMcr/isEnEno/labelAssignmentArea/latchLabelAssignmentArea/signalFlowAssignmentArea)、`FunPouProperties`、`DataTypeProperties`、`GlobalVarsProperties`、`LocalVarsProperties`、**`BodyProperties`**(orderWithinBodyProperties/workSheetName/executeOrder)、`ProgramFileProperties`、`ResourceExecutionType`(initial/scan/standby/fixedScan/event/noExecution)、`ResourceFolders`/`PouResourceFolder`、`FbFiles/FbPouFile`、`FunFiles/FunPouFile`、`VariableLineNumber`、`VariableComments`(含数组/位注释)、`VariableRemark`、`VariableStructDeviceAssignment`、`VariableExternalDeviceAccess`、`VariableFbInitialValue`、`VariableSystemLabel`。
【已验证】内嵌 XSD 的三个 schema 名：`GXW3_IEC61131_10_Ed1_0.xsd`、`GXW3_IEC61131_10_Ed1_0.AddData.xsd`、`GXW3_IEC61131_10_Ed1_0_ForGXW3.xsd`；样例声明使用 `_ForGXW3.xsd`。
【未知】`FileHeader/ContentHeader` 的具体校验严格度；`schemaVersion` 取值是否必须 `1.000`；同一 XML 中多 POU 顺序是否影响导入；`Program` 与 `ProgramInstance` 的绑定是否强制。

### 7.2 导入入口（两处，均指向同一导入器【推断】）

1. GUI：`[Project] → [Import File] → [IEC61131-10 XML Format]`（菜单 ID `ID_MAINFRAME_PROJECT_IEC61131_10_XML_IMPORT`=37003），或在导航窗口选中「工程/程序文件夹/FB/FUN/全局标签/结构体」右键导入（导入范围随之变化：整体/仅同名数据）。
2. OpenIF：`IGXW3CallProject.ImportProjectXml`（raw:51）。
【推断】两者是同一功能的 COM/UI 两个入口（方法名、参数数量、错误计数 `lplImportErrors` 均吻合；M0/M3 可证实）。

---

## 8. 标签 CSV 规格与导入导出（已验证，用于纠错与路线 B）

| 事实 | 内容 | 来源 |
|---|---|---|
| 标签编辑器导出 | 可导出 **CSV**（不含数组/位注释、结构体分配、FB 实例初始值等细节）或 **XML**（含上述细节） | 手册页 ID 91 |
| 标签编辑器导入 | **仅 CSV**；按「列标题名」匹配（列顺序可变）；不同语言版本导出文件需改标题名 | 手册页 ID 91 |
| 初值限制 | 「Label Initial Value Setting」里的初值不随 CSV/XML 导出/导入，需手工复制 | 手册页 ID 91 |
| 外部设备访问列 | 勾选=1、未勾选=0 | 手册页 ID 91 |
| 本仓库实测格式 | TAB 分隔、每字段双引号、UTF-16LE+BOM、首行工程名、局部 27 列/全局 28 列 | 仓库 `src/emit/label-csv.ts` + `test/verify-label-csv.ts`（对照真实导出文件） |
| 结论 | **README 的「标签只能 CSV 导入」正确；`docs/GXWorks3-导入指南.md` 的「局部标签用 XML 导入」错误** | — |

---

## 9. ST 程序体进入 GX Works3 的全部已知通道（汇总）

| 通道 | 可行性 | 载体 | 备注 |
|---|---|---|---|
| ① IEC61131-10 XML 导入 | **高**（官方支持、含 ST 正文+标签） | `.xml` | 路线 A 主线；M3/M9 验证 |
| ② 对象 CSV 导入（OpenIF） | **未知**（ST 语言是否支持 = U1） | `.csv` | 用 `ExportObjectCsv` 反推 |
| ③ PrivateData 粘贴/导入（OpenIF） | **未知**（格式专有，无导出 API） | blob + map 文件 | 只能做「模板 blob」方向 |
| ④ UI 剪贴板粘贴（ST 编辑器） | **中高**（工程实践；手册未成文） | 文本 | 只含语句；标签另建 |
| ⑤ Register Label（UI） | 中（手册明确有；弹窗交互） | 交互 | 兜底/增量 |

---

## 10. 对仓库现有文档的纠正（逐条）

> 依据：本机官方样例 + 手册（SH-081271CHN）+ 内嵌 XSD + 仓库代码/产物实际检查。

| # | 现有表述（README / 导入指南 / 快速上手） | 纠正 | 依据 |
|---|---|---|---|
| 1 | 「IEC61131-10 XML 导入后程序内容为空 → 三菱导入器缺陷 / 私有变体导致不生效」（README §「关于…」，导入指南 §四，快速上手表格） | **机制不支持该结论**：官方样例与手册附8 证明 ST 程序体+标签可导入。v0.1 实际产物是 **PLCopen TC6_0201**（`<project>` 小写、`http://www.plcopen.org/xml/tc6_0201`，见 `out/*.xml`），与 GX Works3 期望的 `<Project>` + `www.iec.ch/public/TC65SC65BWG7TF10` **结构/命名空间均不同**；「空导入」更可能是格式不匹配（M9 验证）。 | `Sample.xml`、手册页 ID 40/280-284、`out/Global.xml` 实际头两行 |
| 2 | 「局部标签：XML 导入（方式 A，推荐）」「全局标签 XML 导入」（导入指南 §二 方式 A） | **错**：标签编辑器只支持 **CSV 导入**，XML 仅导出。XML 导入标签的唯一途径是 IEC61131-10 工程 XML（`Vars`/`GlobalVars`）。 | 手册页 ID 91 |
| 3 | 「标签 XML 为标准 PLCopen TC6_0201，与 GX Works3 导出文件逐行一致，可直接导入」（导入指南 §二） | 前半句可能是「标签**导出**格式」的正确描述；「可直接导入」**错**（同上）。且仓库内**没有**该「逐行一致」的对照测试（README 提到的 `test/label-xml.test.ts` 不存在，`test/` 下只有 `verify-label-csv.ts` 等）。 | 目录检查 + 手册页 ID 91 |
| 4 | 「梯形图不能从外部粘贴（剪贴板专有二进制）→ 梯形图只能手画」（README 硬约束表） | **不完整**：梯形图支持 **CSV（制表符分隔）指令列表导入**（`Edit→Import File`；8 列以后忽略；导入后未转换；FB/函数实例导入会变未定义部件），并支持导出 CSV/HTML/文本。剪贴板专有的说法**未在手册中查到**（推断成立，但不要再写成唯一手段）。 | 手册页 ID 111（梯形图程序的导入/导出） |
| 5 | 「ST 正文含 VAR 声明；『简单工程（非 IEC 模式）下变量声明在独立工作表，本工具生成的是结构化工程格式，声明与本体同处一个 POU』」（README 三菱方言节末尾） | **错**：GX Works3 只有结构化工程（手册无「简单工程」，只有 GX Works2 手册才有）；且**任何模式下 ST 正文都不含声明**——声明在「标签编辑器（局部标签）」。v0.1 输出 `.st` 顶部的 VAR 注释块只是给人看的，GX Works3 不会解析成声明；若把真 `VAR…END_VAR` 粘进正文会被当语法错误。 | 手册页 ID 91/112/132；手册附录附15 |
| 6 | 术语「标签设置工作表」（导入指南反复使用） | GX Works3 实际叫「**局部标签编辑器**（Label Editor）」，不是「标签设置」工作表；CSV 导入入口在标签编辑器 `Edit → Import File`，也可在导航窗口对 POU/全局标签右键导入。 | 手册页 ID 91、ID 18 菜单表 |
| 7 | 「导入指南：必须先建好 CPU 模块配置，否则 Program 可能挂不上去」 | 方向正确但表述含糊：真正需要的是**CPU 参数 + 程序执行类型/任务**；默认新建工程通常已带 RCPU/FX5 参数，但 OpenIF `CreateNewProject` 的默认产物未知（U5）。建议写成「用模板工程规避」，而不是让用户手工配模块。 | 手册 6.10/6.11；本机菜单/样例 |
| 8 | 「GX Works3 强制结构化工程，没有简单工程选项」 | **正确**（保留）。 | 手册附录附15（只对比 GX Works2 的简单/结构化工程） |
| 9 | 「不下载 PLC；MC/SLMP 只能读写软元件不能写程序」 | **基本正确**：SLMP/MC 侧确实只到设备读写/远程 RUN-STOP；但 OpenIF 另有 `Download`/`Upload`/`UploadProject`（需在线连接目标，真机/仿真），可用于**程序下载**。 | raw:220/321；communication 接口 |
| 10 | 「测试 104 个」/「71 个测试」等数字 | 文档数字与仓库现状/Lead 口径不一致（README 写 104，Lead 说 71），且 README 引用了不存在的测试文件 → 文档整体陈旧，需在 v0.2 一并修订。 | 目录检查 |
| 11 | 缺失引用 | 导入指南未引用新增的**官方样例** `SampleData\IEC61131-10XML\Sample.xml` 与手册附8；应在 v0.2 补上（这是最权威的模板）。 | — |

---

## 11. 官方文档线索（本机 + 外部）

### 11.1 本机官方文档（最权威，均可离线复现）

| 文档 | 位置/标识 | 覆盖内容 | 可信度 |
|---|---|---|---|
| GX Works3 操作手册（中文）SH-081271CHN | `Doc\sh081271chnaq.ema`（e-Manual，SQLite `TBL_CONTENT`） | 工程管理、标签、程序创建/检查/转换、导入导出菜单、IEC61131-10 XML 导入（页 ID 40）、附8 XML 格式（页 ID 280-284）、菜单一览（页 ID 18）、标签导出/导入（页 ID 91）、未定义标签登录（页 ID 92）、梯形图 CSV 导入导出（页 ID 111）、程序检查（页 ID 132）、转换（页 ID 133） | 高（官方，本机可查） |
| 官方 IEC61131-10 样例 | `SampleData\IEC61131-10XML\Sample.xml` | 完整可导入 XML（含 ST/FB/FUN/结构体/全局标签/AddData） | 高（官方随安装包） |
| 内嵌 XSD | `Service\Managed\Melco.GXW3.Controller.Project.Managed.XmlImportExport.Impl.dll` | 三个 schema 全文（主/AddData/ForGXW3） | 高（官方实现内） |
| 菜单 ID 表 | `Service\Native\MenuIdTableForQuickSearch.csv` | 全部 UI 菜单 ID（自动化锚点） | 高 |
| e-Manual 包（59 本） | `Doc\*.ema` | **不含 Open Interface 手册**（已确认） | — |

### 11.2 外部线索（`web_search` 命中；**本会话 `web_fetch` 全部失败，未打开正文**，引用时请复核）

| 线索 | URL | 说明/可信度 |
|---|---|---|
| GX Works3 英文操作手册（含 IEC61131-10 XML 导入附录） | [sh081215engap.pdf](https://dl.mitsubishielectric.com/dl/fa/document/manual/plc/sh081215eng/sh081215engap.pdf) | 检索摘要出现「POUs (program block, function block, function, program body, local label)」「Basic menus [Project]…」——与中文版附8 对应；**可信度高**（官方域名），未打开正文 |
| GX Works3 英文操作手册（正文） | [sh081215engar.pdf](https://dl.mitsubishielectric.com/dl/fa/document/manual/plc/sh081215eng/sh081215engar.pdf) | 同上，未打开正文 |
| 三菱 FA 手册下载入口 | [mitsubishielectric.com/fa/download/search.page](https://www.mitsubishielectric.com/fa/download/search.page?q=GX+Works3&mode=manual) | 用于检索 OpenIF/其他手册；未打开正文 |
| MX Component（补充通道：ActiveX 通信） | [MELSEC MX Component](https://www.mitsubishielectric.co.jp/fa/products/cnt/plceng/smerit/mx_component/) | 官方产品页；用于**在线设备读写**的替代/补充（不能写程序）；未打开正文 |
| GX Works3 产品/编程功能页 | [GX Works3 programming](https://www.mitsubishielectric.com/fa/id_id/products/cnt/plceng/smerit/gx_works3/programming.html) | 语言支持背景；未打开正文 |
| 第三方：GX Works3 的 C# 读写实践 | [zenn.dev/kumasysjp/articles/19a41ec8b317a8](https://zenn.dev/kumasysjp/articles/19a41ec8b317a8) | 标题即「GX Works３に C# で読み書きしてみた」——**与本任务高度相关但未读取正文**；仅作线索，不作依据 |
| 第三方：VS Code 扩展 `Melsec GX Import` | [marketplace.visualstudio.com](https://marketplace.visualstudio.com/items?itemName=MariuszCzyrnek.melsec-import) | 疑似「ST/梯形图导入 GX Works3」的工具；未读正文；**生态信号** |
| 第三方：`gx3-cli-mcp`（Python MCP） | [pypi.org/project/gx3-cli-mcp](https://pypi.org/project/gx3-cli-mcp/) | 疑似 GX Works3 自动化的第三方 MCP；未读正文；**生态信号** |
| **Open Interface 手册** | **本次未取得**（本机未装、检索未见可打开 PDF） | 手头所有 `lObjectType/dwLanguageType/bFormat/lImportFlags…` 的**权威取值应在这份手册里**；建议后续向 Mitsubishi 渠道索取（对应 GX Works3 版本的 OpenIF 手册），这是 U1-U6 的最快解法 |

> 说明：以上外部链接均只用于「线索指向」，本文档中**没有任何结论依赖未打开的外部正文**。所有硬结论都可回溯到 §1.1 的本机静态证据。

---

## 12. 还缺什么（「全自动闭环」的最小缺口清单）

1. **OpenIF 调用环境**（**风险已大幅降低**）：基础调用已在 32 位晚绑定 sidecar 上验证通过（§2.3：3 个 CoClass 可创建、`Initialize`/`CheckSupport`/`GetOpenIFVersion` 成功）；剩余是 **STA 线程、out 参数强类型、GX Works3 进程生命周期** 的工程化（A1），以及可选的 A2（修 Interop 桥）以支持 MCP 原生集成。
2. **枚举/记录取值**（U1-U3、U6、U7）：没有它们，代码只能靠「枚举探测 + 试错」，不可维护。
3. **编译错误明细**（U4）：Build 只回数量；需 UI Output 窗口自动化或补事件 dump。
4. **硬件配置与任务绑定**：OpenIF 无 Set 硬件配置；必须「模板工程」策略 + `CreateNewProject` 行为确认（U5）。
5. **导入语义**（U3）：flags/mode 未定 → 导入的合并/替换行为不确定。
6. **无 GUI 模式**（U11）与**许可合规**（U10）。
7. （可选）**行为验证**：仿真下载/RUN/读值能否自动化（M10）。

**最小可行闭环（建议，A1 形态）**：模板 `.gx3` + **32 位晚绑定 sidecar** + `ImportProjectXml`（IEC61131-10）+ `RebuildProject` + 计数判定 + 失败时 UI 读 Output + `GetLabelAssignment`/`ExportUsedDeviceAndLabel` 出报告 + `SaveProject`。做到这一步，可以把「零人工落地 + 真实编译结果」做到 **90% 自动化**，最后 10%（错误明细解析、偶发模态框）用 UI 自动化兜底。

---

## 13. 证据索引（本机可复现）

| 主题 | 证据 |
|---|---|
| 接口签名 | `docs/research/GXW3Call-API-raw.txt`：Project 接口 raw:24-124；Communication raw:178-348；Product raw:540-561；Transmitter raw:573-593；Session raw:599-615；View raw:621-655 |
| 类型库缺口 | raw 中 `TypeInfoCount=142`、records 仅给 `vartypes=N`（如 raw:128/160/162/172），无字段与枚举 |
| OpenIF DLL 版本 | `(Get-Item …\GXW3Call.dll).VersionInfo` → 1.28.5.1；`GXW3.exe` → 1.128.0.1 |
| COM 注册 | `HKLM\SOFTWARE\WOW6432Node\Classes\CLSID\{B8FB0F14-3102-4C45-BC50-DDD931402475}\InprocServer32`；TypeLib `{B315BAD7-5F04-4D1B-9689-EA2F41BC5BF4}` → `GXW3CallLib` |
| **COM 可行性探测**（Lead） | 2026-11-10 本机 32 位 PowerShell 晚绑定：创建 Product/Transmitter/Session ✓；`Product.Initialize` ✓；`GetOpenIFVersion()`=**34**；`Session.Initialize` ✓；`Session.CheckSupport(1)` ✓；无 GXW3 进程残留（明细见 §2.3） |
| 官方样例 | `C:\Program Files (x86)\MELSOFT\GPPW3\SampleData\IEC61131-10XML\Sample.xml`（`MainBody/BodyContent xsi:type="ST"`） |
| 内嵌 XSD | `XmlImportExport.Impl.dll` 中提取的 3 个 `<xsd:schema>`（主 62,772 B / AddData 19,339 B / ForGXW3 16,553 B），含 `GXW3_IEC61131_10_Ed1_0*.xsd` 引用与全部 AddData 定义 |
| 手册 | e-Manual `Doc\sh081271chnaq.ema` → `melsec/database/SH081271CHN-C.msql` → `TBL_CONTENT`（页 ID 18/40/91/92/111/132/133/280-284） |
| 菜单 ID | `Service\Native\MenuIdTableForQuickSearch.csv`（36997/37003/37634/37639/38916/40006/40285/40286/19009/19010/38400 等） |
| 仿真器 | `GXSimulator3\Common\GXS3SysSim.exe`、`GXS3IOSystem.exe`、`FSim3Dlg.exe` 等 |
| 仓库现状（纠错输入） | `README.md`、`docs/GXWorks3-导入指南.md`、`docs/快速上手.md`、`out/*.xml`（实际为 PLCopen TC6_0201）、`test/`（无 label-xml 测试） |

---

*本文档完成于 2026-11-10。外部链接均来自 `web_search` 检索结果（本会话无法打开网页正文），引用前请人工复核；本机静态证据可按 §13 逐条复现。*
