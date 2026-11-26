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
    private static Exception Rejected(Action action, string message)
    {
        try { action(); }
        catch (Exception error) { count++; return error; }
        throw new Exception(message);
    }
    private static void Missing(string root, bool helper)
    {
        Exception error = Rejected(delegate { Launcher.StartInfo(root); }, "An incomplete extracted folder must be rejected before launching anything.");
        string path = helper ? Path.Combine(root, "app", "native", "ZNoteHost.exe") : Path.Combine(root, "Z Note.html");
        Check(error is FileNotFoundException && ((FileNotFoundException)error).FileName == path && error.Message.Contains(path), "Missing-file diagnostics identify the exact expected file.");
        Check((error is MissingHelperException) == helper, "Only a missing helper can select browser fallback.");
        if (!helper)
        {
            Exception browserError = Rejected(delegate { Launcher.BrowserStartInfo(root, null); }, "A missing page cannot select the default browser.");
            Check(browserError is FileNotFoundException && !(browserError is MissingHelperException), "Missing HTML prevents fallback as well as native startup.");
        }
    }
    private static void BrowserPlans(string root)
    {
        // Inspect plans only: fake browser files are never executed.
        string chrome = Path.Combine(root, "chrome test.exe"), edge = Path.Combine(root, "edge test.exe");
        File.WriteAllText(chrome, "test browser candidate"); File.WriteAllText(edge, "test browser candidate");
        string absent = Path.Combine(root, "absent browser.exe");
        Check(Launcher.FindBrowser(new string[] { absent, chrome, edge }) == chrome, "The first installed candidate preserves Chrome-before-Edge preference.");
        File.Delete(chrome);
        Check(Launcher.FindBrowser(new string[] { chrome, edge }) == edge, "A missing Chrome candidate allows the Edge candidate.");
        Check(Launcher.FindBrowser(new string[] { absent, chrome }) == null, "No installed candidate selects the default-browser plan.");
        ProcessStartInfo browser = Launcher.BrowserStartInfo(root, edge);
        Check(browser.FileName == edge && browser.WorkingDirectory == root && !browser.UseShellExecute && browser.CreateNoWindow, "Known-browser fallback is a direct hidden launch in the portable folder.");
        Check(browser.Arguments.StartsWith("--app=\"", StringComparison.Ordinal) && browser.Arguments.EndsWith("\"", StringComparison.Ordinal), "Browser fallback quotes its full app URL.");
        string url = browser.Arguments.Substring(7, browser.Arguments.Length - 8);
        Uri uri = new Uri(url);
        Check(uri.IsFile && uri.LocalPath == Path.Combine(root, "Z Note.html") && uri.Fragment == "" && uri.Query == "", "The encoded fallback URL round-trips to the exact page, including literal percent sequences.");
        Check(url.Contains("%20") && url.Contains("%23") && url.Contains("%2523") && url.Contains("%E7%AC%94%E8%AE%B0"), "Spaces, hash, literal percent, and Unicode are encoded in the file URL.");
        Check(!browser.Arguments.Contains("--user-data-dir") && !browser.Arguments.Contains("--incognito") && !browser.Arguments.Contains("--inprivate"), "Fallback keeps the browser's normal profile and local notes.");
        ProcessStartInfo standard = Launcher.BrowserStartInfo(root, null);
        Check(standard.FileName == url && standard.UseShellExecute && standard.WorkingDirectory == root && standard.Arguments == "", "Default-browser fallback opens the same encoded page without shell arguments.");
        string browserDirectory = Path.Combine(root, "browser directory"); Directory.CreateDirectory(browserDirectory);
        Exception invalidBrowser = Rejected(delegate { Launcher.FindBrowser(new string[] { browserDirectory, edge }); }, "A browser path that is a directory must be reported.");
        Check(invalidBrowser is IOException, "An invalid browser path is not silently skipped for another profile.");
    }
    private static void MalformedPaths(string sandbox)
    {
        string pageDirectory = Path.Combine(sandbox, "page-directory"); Directory.CreateDirectory(Path.Combine(pageDirectory, "Z Note.html"));
        Exception error = Rejected(delegate { Launcher.StartInfo(pageDirectory); }, "A directory cannot act as the HTML file.");
        Check(error is IOException && !(error is MissingHelperException), "An HTML directory is an error rather than a fallback signal.");
        error = Rejected(delegate { Launcher.BrowserStartInfo(pageDirectory, null); }, "Browser fallback cannot open an HTML directory.");
        Check(error is IOException, "Browser fallback validates its page file.");
        foreach (string component in new string[] { "app", "app/native", "app/native/ZNoteHost.exe" })
        {
            string root = Path.Combine(sandbox, "invalid-" + Guid.NewGuid().ToString("N").Substring(0, 8)); Directory.CreateDirectory(root);
            File.WriteAllText(Path.Combine(root, "Z Note.html"), "test page");
            string invalid = Path.Combine(root, component.Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(Path.GetDirectoryName(invalid));
            if (component.EndsWith(".exe", StringComparison.Ordinal)) Directory.CreateDirectory(invalid); else File.WriteAllText(invalid, "file instead of directory");
            error = Rejected(delegate { Launcher.StartInfo(root); }, "A malformed helper path must not select fallback.");
            Check(error is IOException && !(error is MissingHelperException), "A file/directory mismatch is reported separately from a missing helper: " + component);
        }
        error = Rejected(delegate { Launcher.StartInfo(sandbox + "\0invalid"); }, "Invalid path characters must be rejected.");
        Check(error is ArgumentException && !(error is MissingHelperException), "An invalid path cannot select browser fallback.");
        string missingApp = Path.Combine(sandbox, "no-app-folder"); Directory.CreateDirectory(missingApp); File.WriteAllText(Path.Combine(missingApp, "Z Note.html"), "test page");
        Missing(missingApp, true);
    }
    private static void LaunchAndCheck(string root)
    {
        string result = Path.Combine(root, "launcher-result.txt");
        using (Process process = Process.Start(new ProcessStartInfo(Path.Combine(root, "Z Note.exe"))
        {
            WorkingDirectory = Path.GetDirectoryName(root), UseShellExecute = false, CreateNoWindow = true
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
        string sandbox = null, fixtureParent = null, fixtureName = "fixtures-" + Guid.NewGuid().ToString("N");
        bool created = false;
        try
        {
            if (args.Length != 3 || args[1] != "--test-root" || !File.Exists(args[0])) throw new Exception("Pass the built launcher and --test-root with an existing absolute fixture parent directory.");
            if (!Path.IsPathRooted(args[2])) throw new ArgumentException("The launcher test fixture parent must be absolute.");
            fixtureParent = Path.GetFullPath(args[2]);
            if (fixtureParent.Length > Path.GetPathRoot(fixtureParent).Length) fixtureParent = fixtureParent.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            if (!Directory.Exists(fixtureParent)) throw new ArgumentException("The launcher test fixture parent must exist.");
            sandbox = Path.Combine(fixtureParent, fixtureName);
            if (Directory.Exists(sandbox) || File.Exists(sandbox)) throw new IOException("Launcher test fixture directory already exists.");
            Directory.CreateDirectory(sandbox); created = true;
            string root = Path.Combine(sandbox, "Portable # & %23 ! (\u7b14\u8bb0) with spaces");
            Directory.CreateDirectory(Path.Combine(root, "app", "native"));
            Missing(root, false);
            string page = Path.Combine(root, "Z Note.html");
            File.WriteAllText(page, "<!doctype html><title>Test-only notebook</title>");
            Missing(root, true);
            BrowserPlans(root);
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
            Missing(moved, false);
            MalformedPaths(sandbox);
            Console.WriteLine("Passed " + count + " portable launcher assertions, including launch after relocation.");
            return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error); return 1; }
        finally
        {
            if (created && Directory.Exists(sandbox))
            {
                string target = Path.GetFullPath(sandbox);
                if (!String.Equals(Path.GetDirectoryName(target), fixtureParent, StringComparison.OrdinalIgnoreCase) || Path.GetFileName(target) != fixtureName) throw new IOException("Launcher test cleanup refused a directory outside its generated fixture.");
                Directory.Delete(target, true);
            }
        }
    }
}
