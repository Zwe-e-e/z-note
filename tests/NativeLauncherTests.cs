using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using ZNote.PortableLauncher;

internal static class NativeLauncherTests
{
    private static int count;
    private static void Check(bool value, string message)
    {
        if (!value) throw new Exception(message);
        count++;
    }
    private static void Missing(string root)
    {
        bool rejected = false;
        try { Launcher.StartInfo(root); }
        catch (FileNotFoundException) { rejected = true; }
        Check(rejected, "An incomplete extracted folder must be rejected before launching anything.");
    }
    private static void LaunchAndCheck(string root)
    {
        string result = Path.Combine(root, "launcher-result.txt");
        using (Process process = Process.Start(new ProcessStartInfo(Path.Combine(root, "Z Note.exe"))
        {
            WorkingDirectory = Path.GetTempPath(), UseShellExecute = false, CreateNoWindow = true
        }))
        {
            if (!process.WaitForExit(5000)) { process.Kill(); throw new Exception("The portable launcher did not exit."); }
            Check(process.ExitCode == 0, "Portable launcher exits successfully.");
        }
        DateTime until = DateTime.UtcNow.AddSeconds(5);
        while (!File.Exists(result) && DateTime.UtcNow < until) Thread.Sleep(25);
        Check(File.Exists(result), "The launcher starts the helper beside its own copy.");
        string[] report = File.ReadAllLines(result);
        Check(report.Length == 2 && report[0] == Path.Combine(root, "Z Note.html"), "The helper receives the complete quoted page path as one argument.");
        Check(report[1] == root, "The helper's working directory follows the portable folder.");
    }
    private static int Main(string[] args)
    {
        // This same test binary acts as a harmless helper in an isolated portable folder.
        if (args.Length == 2 && args[0] == "--page")
        {
            string result = Path.Combine(Path.GetDirectoryName(args[1]), "launcher-result.txt");
            string temporary = result + ".tmp";
            File.WriteAllLines(temporary, new string[] { args[1], Environment.CurrentDirectory });
            File.Move(temporary, result);
            return 0;
        }
        string sandbox = Path.Combine(Path.GetTempPath(), "ZNoteLauncherTests-" + Guid.NewGuid().ToString("N"));
        try
        {
            if (args.Length != 1 || !File.Exists(args[0])) throw new Exception("Build Z Note.exe before running the launcher tests.");
            string root = Path.Combine(sandbox, "Portable # & (\u7b14\u8bb0) with spaces");
            Directory.CreateDirectory(Path.Combine(root, "app", "native"));
            Missing(root);
            string page = Path.Combine(root, "Z Note.html");
            File.WriteAllText(page, "<!doctype html><title>Test-only notebook</title>");
            Missing(root);
            string host = Path.Combine(root, "app", "native", "ZNoteHost.exe");
            File.Copy(Process.GetCurrentProcess().MainModule.FileName, host);
            ProcessStartInfo info = Launcher.StartInfo(root);
            Check(info.FileName == host && info.WorkingDirectory == root, "Launch paths are resolved from the supplied folder.");
            Check(info.Arguments == "--page \"" + page + "\"", "The HTML path is quoted.");
            Check(!info.UseShellExecute && info.CreateNoWindow, "The launcher does not use a command shell or show a console.");
            File.Copy(args[0], Path.Combine(root, "Z Note.exe"));
            LaunchAndCheck(root);

            string moved = Path.Combine(sandbox, "Moved copy # & \u65b0\u4f4d\u7f6e");
            Directory.Move(root, moved);
            File.Delete(Path.Combine(moved, "launcher-result.txt"));
            LaunchAndCheck(moved);
            File.Delete(Path.Combine(moved, "Z Note.html"));
            Missing(moved);
            Console.WriteLine("Passed " + count + " portable launcher assertions, including launch after relocation.");
            return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error); return 1; }
        finally
        {
            string temporaryRoot = Path.GetFullPath(Path.GetTempPath());
            string target = Path.GetFullPath(sandbox);
            if (target.StartsWith(temporaryRoot, StringComparison.OrdinalIgnoreCase) && Path.GetFileName(target).StartsWith("ZNoteLauncherTests-", StringComparison.Ordinal) && Directory.Exists(target))
                Directory.Delete(target, true);
        }
    }
}
