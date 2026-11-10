#!/usr/bin/env python3
"""validate-iecxml.py —— 离线校验 src/emit/iecxml.ts 生成的 IEC 61131-10 XML。

策略（按优先级）：
1. 从本机 GX Works3 的 XmlImportExport 实现 DLL 中**提取内嵌 XSD**（共 3 份：
   主 Schema / AddData / ForGXW3），写入临时目录后，用 ForGXW3（含 AddData include）
   作为根 Schema 做真正的 XSD 校验。
2. 若 DLL 不存在 / 提取失败 / Schema 解析失败 → **退化模式**：仅用 lxml 做
   well-formed + 必要结构断言（根元素/命名空间/Types/Program/Vars/MainBody/
   Instances/Configuration/Resource/GlobalVars/ProgramInstance 等），并如实打印
   「degraded」。

用法：
  python scripts/validate-iecxml.py [xml_path]
  python scripts/validate-iecxml.py --schema-dir <dir>   # 复用已提取的 XSD（调试用）

退出码：0 = 通过（XSD valid 或结构断言全过）；1 = 失败；2 = 参数/文件错误。
"""

from __future__ import annotations

import argparse
import re
import sys
import tempfile
from pathlib import Path

DLL_PATH = Path(
    r"C:\Program Files (x86)\MELSOFT\GPPW3\Service\Managed"
    r"\Melco.GXW3.Controller.Project.Managed.XmlImportExport.Impl.dll"
)
DEFAULT_XML = Path(__file__).resolve().parent.parent / "examples" / "out_iecxml" / "motor_demo.xml"

# 三份内嵌 schema 的规范文件名（与 xsd:include 引用一致）
MAIN_XSD = "GXW3_IEC61131_10_Ed1_0.xsd"
ADDATA_XSD = "GXW3_IEC61131_10_Ed1_0.AddData.xsd"
FORGXW3_XSD = "GXW3_IEC61131_10_Ed1_0_ForGXW3.xsd"


def extract_xsds(dll_path: Path) -> dict[str, bytes]:
    """从 DLL 二进制中提取全部 <xsd:schema>…</xsd:schema> 块，按内容特征命名。"""
    raw = dll_path.read_bytes()
    starts = [m.start() for m in re.finditer(rb"<xsd:schema\b", raw)]
    blocks: list[bytes] = []
    for s in starts:
        e = raw.find(b"</xsd:schema>", s)
        if e < 0:
            continue
        blocks.append(raw[s : e + len(b"</xsd:schema>")])
    if len(blocks) < 2:
        raise RuntimeError(f"DLL 中只找到 {len(blocks)} 个 XSD 块，提取失败")

    out: dict[str, bytes] = {}
    for b in blocks:
        text = b.decode("utf-8", "replace")
        has_addata_include = ADDATA_XSD in text
        is_addata_block = "addData element" in text and not has_addata_include
        if has_addata_include:
            out[FORGXW3_XSD] = b  # 含 AddData include 的即 GX Works3 专用根 Schema
        elif is_addata_block:
            out[ADDATA_XSD] = b
        else:
            out[MAIN_XSD] = b
    if FORGXW3_XSD not in out or ADDATA_XSD not in out:
        raise RuntimeError(f"XSD 角色识别失败，得到: {sorted(out)}")
    out.setdefault(MAIN_XSD, out[FORGXW3_XSD])  # 主 Schema 缺失时给个占位（不影响 ForGXW3 校验）
    return out


def resolve_schema_dir(schema_dir: Path | None) -> tuple[Path, str]:
    """返回 (schema 目录, 说明)。优先复用传入目录，否则从 DLL 提取到临时目录。"""
    if schema_dir is not None:
        return schema_dir, f"复用已有 XSD 目录: {schema_dir}"
    if not DLL_PATH.exists():
        raise RuntimeError(f"DLL 不存在: {DLL_PATH}")
    xsds = extract_xsds(DLL_PATH)
    tmp = Path(tempfile.mkdtemp(prefix="gxw3-iecxml-xsd-"))
    for name, data in xsds.items():
        (tmp / name).write_bytes(data)
    return tmp, f"从 DLL 提取 {len(xsds)} 份 XSD → {tmp}"


# --------------------------------------------------------------------------- #
# 退化：结构断言（XSD 不可用时）
# --------------------------------------------------------------------------- #
NS = "www.iec.ch/public/TC65SC65BWG7TF10"
XSI = "http://www.w3.org/2001/XMLSchema-instance"


def structural_checks(xml_path: Path) -> tuple[bool, list[str]]:
    try:
        from lxml import etree  # type: ignore
    except Exception as exc:  # pragma: no cover
        return False, [f"lxml 不可用（{exc}），无法做结构断言"]

    parser = etree.XMLParser(resolve_entities=False, no_network=True)
    try:
        tree = etree.parse(str(xml_path), parser)
    except Exception as exc:
        return False, [f"XML 解析失败（不是 well-formed）: {exc}"]
    root = tree.getroot()
    msgs: list[str] = []
    ok = True

    def check(cond: bool, msg: str) -> None:
        nonlocal ok
        msgs.append(("PASS " if cond else "FAIL ") + msg)
        if not cond:
            ok = False

    def q(tag: str) -> str:
        return f"{{{NS}}}{tag}"

    check(root.tag == q("Project"), f"根元素为 {q('Project')}（实际 {root.tag}）")
    check(root.get("schemaVersion") == "1.000", "schemaVersion=1.000")
    check(root.get(f"{{{XSI}}}schemaLocation", "").endswith("GXW3_IEC61131_10_Ed1_0_ForGXW3.xsd"),
          "xsi:schemaLocation 指向 ForGXW3.xsd")
    check(root.find(q("FileHeader")) is not None, "存在 FileHeader")
    check(root.find(q("ContentHeader")) is not None, "存在 ContentHeader")
    types = root.find(q("Types"))
    check(types is not None and types.find(q("GlobalNamespace")) is not None,
          "存在 Types/GlobalNamespace")
    gns = types.find(q("GlobalNamespace")) if types is not None else None
    programs = gns.findall(q("Program")) if gns is not None else []
    check(len(programs) >= 1, f"至少 1 个 Program（实际 {len(programs)}）")
    for p in programs:
        name = p.get("name", "?")
        vars_el = p.find(q("Vars"))
        check(vars_el is not None and vars_el.get("accessSpecifier") == "private",
              f"Program({name}) 有 Vars@accessSpecifier=private")
        body = p.find(q("MainBody"))
        check(body is not None, f"Program({name}) 有 MainBody")
        if body is not None:
            contents = body.findall(q("BodyContent"))
            for c in contents:
                xsi_type = c.get(f"{{{XSI}}}type")
                check(xsi_type == "ST", f"Program({name}) BodyContent@xsi:type=ST（实际 {xsi_type}）")
                st = c.find(q("ST"))
                check(st is not None and (st.text or "").strip() != "",
                      f"Program({name}) 的 ST 正文非空")
    inst = root.find(q("Instances"))
    check(inst is not None, "存在 Instances")
    cfg = inst.find(q("Configuration")) if inst is not None else None
    check(cfg is not None, "存在 Instances/Configuration")
    res = cfg.find(q("Resource")) if cfg is not None else None
    check(res is not None and res.get("name") == "Main" and res.get("resourceTypeName") == "prgFile",
          "存在 Resource(name=Main, resourceTypeName=prgFile)")
    gv = cfg.find(q("GlobalVars")) if cfg is not None else None
    check(gv is not None, "GlobalVars 位于 Configuration 下（官方样例位置）")
    pis = res.findall(q("ProgramInstance")) if res is not None else []
    check(len(pis) >= 1 and all(pi.get("typeName") == "pou" for pi in pis),
          "Resource 下存在 ProgramInstance@typeName=pou")
    return ok, msgs


# --------------------------------------------------------------------------- #
# 主流程
# --------------------------------------------------------------------------- #
def validate(xml_path: Path, schema_dir: Path | None, verbose: bool) -> int:
    print(f"[validate-iecxml] XML: {xml_path}")
    if not xml_path.exists():
        print(f"[FATAL] 文件不存在: {xml_path}", file=sys.stderr)
        return 2

    try:
        sdir, how = resolve_schema_dir(schema_dir)
        print(f"[schema] {how}")
        from lxml import etree  # type: ignore

        schema_doc = etree.parse(str(sdir / FORGXW3_XSD))
        schema = etree.XMLSchema(schema_doc)
        doc = etree.parse(str(xml_path))
        valid = schema.validate(doc)
        if valid:
            print("[RESULT] PASS —— XSD 校验通过（mode=xsd, schema=ForGXW3+AddData）")
            return 0
        print("[RESULT] FAIL —— XSD 校验不通过（mode=xsd）", file=sys.stderr)
        for err in schema.error_log:
            print(f"  - line {err.line}: {err.message}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"[WARN] XSD 校验不可用，退化为结构断言: {type(exc).__name__}: {exc}")
        ok, msgs = structural_checks(xml_path)
        for m in msgs:
            if verbose or not m.startswith("PASS "):
                print("  " + m)
        if ok:
            print("[RESULT] PASS —— 结构断言全部通过（mode=degraded, 未做 XSD 校验）")
            return 0
        print("[RESULT] FAIL —— 结构断言未通过（mode=degraded）", file=sys.stderr)
        return 1


def main() -> int:
    ap = argparse.ArgumentParser(description="离线校验 GX Works3 IEC 61131-10 XML")
    ap.add_argument("xml", nargs="?", default=str(DEFAULT_XML), help="待校验 XML 路径")
    ap.add_argument("--schema-dir", default=None, help="复用已提取 XSD 的目录（可选）")
    ap.add_argument("-v", "--verbose", action="store_true", help="打印全部断言")
    args = ap.parse_args()
    return validate(Path(args.xml), Path(args.schema_dir) if args.schema_dir else None, args.verbose)


if __name__ == "__main__":
    raise SystemExit(main())
