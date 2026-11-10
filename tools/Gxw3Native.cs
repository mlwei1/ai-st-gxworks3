// GX Works3 OpenIF native helper (32-bit, strongly typed interop).
//
// Purpose: one scriptable step for "open project copy -> import IEC 61131-10 XML
// -> rebuild -> collect compile result", used by ai-st-gxworks3 native build.
// Interop generation and compilation: tools/build-gxw3-native.ps1
//
// Usage (must run 32-bit; compiled with /platform:x86):
//   Gxw3Native.exe probe
//   Gxw3Native.exe build --project <gx3 copy> --xml <xml> [--ui 0|1] [--flags 0] [--mode 0]
//                        [--save] [--export-xml <out.xml>] [--export-format 0|1]
//
// Output: UTF-8 KEY=VALUE lines, easy to parse from Node/scripts.
using System;
using System.IO;
using System.Text;
using GXW3CallLib;

internal static class Program
{
    private static readonly Encoding Utf8 = new UTF8Encoding(false);

    [STAThread]
    private static int Main(string[] args)
    {
        Console.OutputEncoding = Utf8;
        try
        {
            if (args.Length == 0) { Help(); return 2; }
            switch (args[0])
            {
                case "probe": return Probe();
                case "build": return Build(args);
                default: Help(); return 2;
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine("FATAL=" + ex.GetType().Name + ": " + ex.Message);
            return 1;
        }
    }

    private static void Help()
    {
        Console.WriteLine("usage: Gxw3Native.exe probe | build --project <path> --xml <path> [--ui 0] [--flags 0] [--mode 0] [--save] [--export-xml <path>] [--export-format 0]");
    }

    private static string Arg(string[] args, string name, string def)
    {
        for (int i = 0; i < args.Length - 1; i++)
            if (string.Equals(args[i], name, StringComparison.OrdinalIgnoreCase)) return args[i + 1];
        return def;
    }

    private static bool Flag(string[] args, string name)
    {
        for (int i = 0; i < args.Length; i++)
            if (string.Equals(args[i], name, StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    private static void Line(string key, object value)
    {
        Console.WriteLine(key + "=" + (value == null ? "" : value.ToString()));
    }

    private static string Hex(byte[] bytes)
    {
        if (bytes == null) return "";
        var sb = new StringBuilder();
        foreach (var b in bytes) sb.Append(b.ToString("X2"));
        return sb.ToString();
    }

    private static int Probe()
    {
        var tx = new GXW3CallTransmitterClass();
        var product = new GXW3CallProductClass();
        product.Initialize(tx);
        int version = 0;
        product.GetOpenIFVersion(out version);
        Line("openIFVersion", version);
        var session = new GXW3CallSessionClass();
        session.Initialize(tx);
        Line("sessionCheckSupport", "ok");
        try { session.CheckSupport(1); Line("checkSupport(1)", "ok"); }
        catch (Exception ex) { Line("checkSupport(1)", "ERR " + ex.Message); }
        var project = new GXW3CallProjectClass();
        project.Initialize(tx);
        Line("projectObject", "created");
        return 0;
    }

    private static int Build(string[] args)
    {
        string projectPath = Arg(args, "--project", null);
        string xmlPath = Arg(args, "--xml", null);
        if (string.IsNullOrEmpty(projectPath) || !File.Exists(projectPath)) { Line("error", "project not found: " + projectPath); return 3; }
        if (string.IsNullOrEmpty(xmlPath) || !File.Exists(xmlPath)) { Line("error", "xml not found: " + xmlPath); return 3; }
        int uiMode = int.Parse(Arg(args, "--ui", "0"));
        int importFlags = int.Parse(Arg(args, "--flags", "0"));
        int importMode = int.Parse(Arg(args, "--mode", "0"));
        int exportFormat = int.Parse(Arg(args, "--export-format", "0"));
        bool doSave = Flag(args, "--save");
        bool attach = Flag(args, "--attach");
        string exportXml = Arg(args, "--export-xml", null);

        var tx = new GXW3CallTransmitterClass();
        var product = new GXW3CallProductClass();
        product.Initialize(tx);
        int version = 0;
        product.GetOpenIFVersion(out version);
        Line("openIFVersion", version);

        var session = new GXW3CallSessionClass();
        session.Initialize(tx);
        var project = new GXW3CallProjectClass();
        project.Initialize(tx);

        byte[] callId = new byte[1];
        int isReadOnly = 0, rc = -1;
        try
        {
            project.OpenProject(projectPath, 60000, uiMode, callId, ref isReadOnly, out rc);
            Line("openProject.rc", rc);
            Line("openProject.readOnly", isReadOnly);
            Line("openProject.callId", Hex(callId));
            if (rc != 0) { Line("error", "OpenProject failed rc=" + rc); return 4; }
        }
        catch (Exception ex)
        {
            Line("openProject.exception", ex.Message);
            return 4;
        }

        int modified = 0, rcMod = -1;
        try { project.IsProjectModified(callId, out modified, out rcMod); Line("isProjectModified", modified + " rc=" + rcMod); } catch (Exception ex) { Line("isProjectModified", "ERR " + ex.Message); }

        int importErrors = -1, rcImport = -1;
        try
        {
            project.ImportProjectXml(callId, xmlPath, importFlags, importMode, "", out importErrors, out rcImport);
            Line("importProjectXml.rc", rcImport);
            Line("importProjectXml.errors", importErrors);
            Line("importProjectXml.callId", Hex(callId));
        }
        catch (Exception ex)
        {
            Line("importProjectXml.exception", ex.Message);
            // Continue to rebuild; it still tells us whether the project is compile-ready.
        }

        uint err = 0, warn = 0, chkWarn = 0;
        int rcBuild = -1;
        try
        {
            project.RebuildProjectExt(callId, 0, 1, out err, out warn, out chkWarn, out rcBuild);
            Line("rebuild.rc", rcBuild);
            Line("rebuild.error", err);
            Line("rebuild.warning", warn);
            Line("rebuild.checkWarning", chkWarn);
            Line("rebuild.callId", Hex(callId));
        }
        catch (Exception ex)
        {
            Line("rebuild.exception", ex.Message);
        }

        int compiled = 0, rcCompiled = -1;
        try { project.IsProjectCompiled(callId, out compiled, out rcCompiled); Line("isProjectCompiled", compiled + " rc=" + rcCompiled); } catch (Exception ex) { Line("isProjectCompiled", "ERR " + ex.Message); }

        if (!string.IsNullOrEmpty(exportXml))
        {
            int exportErrors = -1, rcExport = -1;
            try
            {
                project.ExportProjectXml(callId, exportXml, exportFormat, out exportErrors, out rcExport);
                Line("exportProjectXml.rc", rcExport);
                Line("exportProjectXml.errors", exportErrors);
            }
            catch (Exception ex) { Line("exportProjectXml.exception", ex.Message); }
        }

        if (doSave)
        {
            int rcSave = -1;
            try { project.SaveProject(callId, out rcSave); Line("saveProject.rc", rcSave); }
            catch (Exception ex) { Line("saveProject.exception", ex.Message); }
        }

        if (!attach)
        {
            int rcClose = -1;
            try { project.CloseProject(callId, 0, out rcClose); Line("closeProject.rc", rcClose); }
            catch (Exception ex) { Line("closeProject.exception", ex.Message); }
        }

        bool ok = (err == 0 && rcBuild == 0);
        Line("RESULT", ok ? "PASS" : "FAIL");
        return ok ? 0 : 5;
    }
}
