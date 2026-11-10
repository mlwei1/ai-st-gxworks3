# GX Works3 工程模板

本目录存放 `ai-st-gxworks3` 使用的 GX Works3 **工程模板**：工具不做硬件配置，
而是"复制模板 → 导入 IEC 61131-10 XML / 标签 → 全部转换"。

## FX5U_ST_Template.gx3

- 用途：FX5U 平台的**纯 ST 空模板**（无梯形图/FBD）。
- 生成方式：GX Works3 1.128 → 新建工程 → Series = FX5U → Program Language = ST，
  保存为单文件工程（`.gx3`）。
- 内容：CPU 模块（FX5U CPU）+ 默认 ST Program（`ProgPou`，空），不含业务逻辑与硬件扩展。
- 验证：向该模板导入 `examples/motor_demo` 生成的 IEC XML 后执行「全部转换」，
  结果 **Error 0 / Warning 0**（见 `docs/evidence/M0/04-st-only-template-0-error.png`）。

> 注意：工程内程序/标签的**执行类型与锁存区设置**会影响导入与编译：
> - 导入的 Program 与模板中同名 Program File 的执行类型必须一致（initial/scan 等），否则会被跳过；
> - 分配到锁存区（FX5U 默认 D200 及以上）的全局变量必须声明为 `RETAIN`（对应 `VAR_GLOBAL_RETAIN`），
>   否则编译报 `0x11021040`。

## 使用方式（当前）

```bash
# 1) 生成 IEC XML
node --experimental-strip-types --no-warnings src/cli.ts build-xml examples/motor_demo.st -o out

# 2) 复制模板到临时目录（不要直接改模板）
copy templates\FX5U_ST_Template.gx3 %TEMP%\run.gx3

# 3) GX Works3 打开副本 → 工程 → 导入 → IEC61131-10 XML格式 → 选 out\motor_demo.xml
# 4) 转换 → 全部转换（Shift+Alt+F4），检查 Error/Warning
```

后续 `native build`（OpenIF 调通后）会自动完成第 2–4 步。
