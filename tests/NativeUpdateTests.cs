using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Text;
using System.Threading;
using ZNote.NativeHost;

internal static class NativeUpdateTests
{
    private static int assertions;
    private static string testRoot;
    private static void Check(bool value, string message) { if (!value) throw new Exception(message); assertions++; }
    private static void Reject(Action action, string message)
    { bool rejected = false; try { action(); } catch (Exception) { rejected = true; } Check(rejected, message); }
    private static string DirectoryFor(string name) { string path = Path.Combine(testRoot, name + Guid.NewGuid().ToString("N").Substring(0, 8)); Directory.CreateDirectory(path); return path; }
    private static void Put(string root, string relative, string text)
    { string path = UpdateFiles.Under(root, relative); Directory.CreateDirectory(Path.GetDirectoryName(path)); File.WriteAllText(path, text); }
    private static string FileText(string relative, string version)
    {
        if (relative == "VERSION.txt") return version + "\n";
        if (relative == "app/js/version.js") return "window.ZN.version = '" + version + "';\n";
        return "test application file " + relative + " " + version;
    }
    private static string Package(string version, string extra = null, bool missing = false, bool duplicate = false, bool launcher = true)
    {
        string path = Path.Combine(testRoot, Guid.NewGuid().ToString("N") + ".zip");
        using (ZipArchive archive = ZipFile.Open(path, ZipArchiveMode.Create))
        {
            foreach (string relative in UpdateFiles.Allowed)
            {
                if (missing && relative == "app/js/store.js") continue;
                if (!launcher && relative == "Z Note.exe") continue;
                using (StreamWriter writer = new StreamWriter(archive.CreateEntry("Z Note/" + relative).Open())) writer.Write(FileText(relative, version));
            }
            if (extra != null) using (StreamWriter writer = new StreamWriter(archive.CreateEntry(extra).Open())) writer.Write("unexpected");
            if (duplicate) using (StreamWriter writer = new StreamWriter(archive.CreateEntry("Z Note/VERSION.txt").Open())) writer.Write(version);
        }
        return path;
    }
    private static string App(string version, bool launcher = true)
    {
        string root = DirectoryFor("app");
        foreach (string relative in UpdateFiles.Allowed)
            if (launcher || relative != "Z Note.exe") Put(root, relative, FileText(relative, version));
        Put(root, "Z Note notebook/pages/private.json", "private notebook content");
        Put(root, "Z Note backup KEEP.json", "private backup content");
        Put(root, "personal.txt", "unrelated file");
        return root;
    }
    private static Dictionary<string, object> Release(string version)
    {
        return new Dictionary<string, object> {
            { "draft", false }, { "prerelease", false }, { "tag_name", "v" + version },
            { "assets", new object[] { new Dictionary<string, object> {
                { "name", "Z-Note-v" + version + "-Portable.zip" }, { "state", "uploaded" }, { "size", 123 },
                { "digest", "sha256:" + new string('a', 64) },
                { "browser_download_url", "https://github.com/Zwe-e-e/z-note/releases/download/v" + version + "/Z-Note-v" + version + "-Portable.zip" }
            } } }
        };
    }
    private static string Json(object data) { return UpdateFiles.Json(1024 * 1024).Serialize(data); }
    private static void VersionsAndRelease()
    {
        Check(UpdateFiles.CompareVersions("2.10.0", "2.9.99") > 0, "Numeric minor version comparison");
        Check(UpdateFiles.CompareVersions("3.0.0", "2.100.0") > 0, "Numeric major version comparison");
        Reject(delegate { UpdateFiles.CompareVersions("02.4.0", "2.3.0"); }, "Ambiguous versions rejected");
        Reject(delegate { UpdateFiles.CompareVersions("2.4.0-beta", "2.3.0"); }, "Prerelease versions rejected");
        Dictionary<string, object> release = Release("2.4.0");
        UpdatePackage package = UpdatePackage.Parse(Json(release), "2.4.0", "2.3.0");
        Check(package.Version == "2.4.0" && package.Size == 123, "Stable matching release accepted");
        Reject(delegate { UpdatePackage.Parse(Json(release), "2.4.1", "2.3.0"); }, "Changed latest release rejected");
        Reject(delegate { UpdatePackage.Parse(Json(release), "2.4.0", "2.4.0"); }, "Same-version update rejected");
        Reject(delegate { UpdatePackage.Parse(Json(release), "2.4.0", "2.5.0"); }, "Downgrade rejected");
        release["draft"] = true; Reject(delegate { UpdatePackage.Parse(Json(release), "2.4.0", "2.3.0"); }, "Draft rejected"); release["draft"] = false;
        release["prerelease"] = true; Reject(delegate { UpdatePackage.Parse(Json(release), "2.4.0", "2.3.0"); }, "Prerelease rejected"); release["prerelease"] = false;
        Dictionary<string, object> asset = (Dictionary<string, object>)((object[])release["assets"])[0];
        asset["browser_download_url"] = "https://example.com/app.zip";
        Reject(delegate { UpdatePackage.Parse(Json(release), "2.4.0", "2.3.0"); }, "Foreign asset URL rejected");
        release = Release("2.5.0"); asset = (Dictionary<string, object>)((object[])release["assets"])[0];
        package = UpdatePackage.Parse(Json(release), "2.5.0", "2.4.2");
        Check(package.DownloadUrl == "https://github.com/Zwe-e-e/z-note/releases/download/v2.5.0/Z-Note-v2.5.0-Portable.zip", "Transferred repository package accepted at new canonical owner");
        asset["browser_download_url"] = ((string)asset["browser_download_url"]).Replace("Zwe-e-e/z-note", "ZweWH/z-note");
        Reject(delegate { UpdatePackage.Parse(Json(release), "2.5.0", "2.4.2"); }, "Old-owner package URL cannot replace new canonical release asset");
        release = Release("2.4.0"); asset = (Dictionary<string, object>)((object[])release["assets"])[0];
        asset["digest"] = null; Reject(delegate { UpdatePackage.Parse(Json(release), "2.4.0", "2.3.0"); }, "Missing digest rejected");
        asset["digest"] = "sha256:" + new string('a', 64); asset["size"] = 67108865;
        Reject(delegate { UpdatePackage.Parse(Json(release), "2.4.0", "2.3.0"); }, "Oversized asset rejected");
    }
    private static void Archives()
    {
        string valid = Package("2.4.0");
        List<string> files = UpdatePackage.Extract(valid, DirectoryFor("stage"), "2.4.0");
        Check(files.Count == UpdateFiles.Allowed.Length && files[files.Count - 1] == "VERSION.txt", "All runtime files validated; version marker last");
        Check(files.Contains("Z Note.exe"), "Exact portable icon launcher path accepted");
        List<string> legacyFiles = UpdatePackage.Extract(Package("2.4.0", null, false, false, false), DirectoryFor("stage"), "2.4.0");
        Check(legacyFiles.Count == UpdateFiles.Allowed.Length - 1 && !legacyFiles.Contains("Z Note.exe"), "Legacy package without icon launcher accepted");
        Reject(delegate { UpdatePackage.Extract(Package("2.4.0", null, true, false, false), DirectoryFor("stage"), "2.4.0"); }, "Legacy package still requires every existing runtime asset");
        Reject(delegate { UpdatePackage.Extract(Package("2.4.0", "Z Note/Other.exe", false, false, false), DirectoryFor("stage"), "2.4.0"); }, "An unrelated executable cannot replace optional launcher");
        Reject(delegate { UpdatePackage.Extract(Package("2.4.0", "Z Note/Z Note.lnk", false, false, false), DirectoryFor("stage"), "2.4.0"); }, "Machine-specific shortcut is not an allowed runtime asset");
        UpdatePackage package = new UpdatePackage { Size = new FileInfo(valid).Length, Digest = UpdateFiles.FileHash(valid) }; package.Verify(valid); assertions++;
        package.Digest = new string('0', 64); Reject(delegate { package.Verify(valid); }, "Corrupt ZIP checksum rejected");
        package.Digest = UpdateFiles.FileHash(valid); package.Size++; Reject(delegate { package.Verify(valid); }, "Wrong ZIP byte count rejected");
        Reject(delegate { UpdatePackage.Extract(Package("2.4.0", "Z Note/../outside.txt"), DirectoryFor("stage"), "2.4.0"); }, "Traversal rejected");
        Reject(delegate { UpdatePackage.Extract(Package("2.4.0", "Z Note/Z Note notebook/pages/private.json"), DirectoryFor("stage"), "2.4.0"); }, "Notebook archive entries rejected");
        Reject(delegate { UpdatePackage.Extract(Package("2.4.0", null, true), DirectoryFor("stage"), "2.4.0"); }, "Missing runtime asset rejected");
        Reject(delegate { UpdatePackage.Extract(Package("2.4.0", null, false, true), DirectoryFor("stage"), "2.4.0"); }, "Duplicate archive entry rejected");
        Reject(delegate { UpdatePackage.Extract(valid, DirectoryFor("stage"), "2.4.1"); }, "Unexpected package version rejected");
        Reject(delegate { UpdateFiles.Under(testRoot, "../outside"); }, "Destination escape rejected");
    }
    private static void Transactions()
    {
        string root = App("2.3.0"), state = DirectoryFor("state"), zip = Package("2.4.0");
        UpdateTransaction transaction = new UpdateTransaction(root, state);
        transaction.Apply(zip, "2.4.0", null, null);
        foreach (string relative in UpdateFiles.Allowed) Check(File.ReadAllText(UpdateFiles.Under(root, relative)) == FileText(relative, "2.4.0"), "Updated app file " + relative);
        Check(File.ReadAllText(Path.Combine(root, "Z Note notebook/pages/private.json")) == "private notebook content", "Notebook unchanged");
        Check(File.ReadAllText(Path.Combine(root, "Z Note backup KEEP.json")) == "private backup content", "Existing backup unchanged");
        Check(File.ReadAllText(Path.Combine(root, "personal.txt")) == "unrelated file", "Unrelated data unchanged");
        Check(!File.Exists(Path.Combine(state, "transaction.json")), "Successful transaction committed");
        root = App("2.3.0"); state = DirectoryFor("state"); transaction = new UpdateTransaction(root, state);
        File.Delete(Path.Combine(root, "app/js/update-native.js"));
        Reject(delegate { transaction.Apply(zip, "2.4.0", null, delegate(int index) { if (index == 7) throw new IOException("Injected replacement failure"); }); }, "Write failure propagates");
        foreach (string relative in UpdateFiles.Allowed)
            if (relative != "app/js/update-native.js") Check(File.ReadAllText(UpdateFiles.Under(root, relative)) == FileText(relative, "2.3.0"), "Rollback restored " + relative);
        Check(!File.Exists(Path.Combine(root, "app/js/update-native.js")), "Rollback removes only a newly installed application file");
        Check(!File.Exists(Path.Combine(state, "transaction.json")), "Rollback completed");
        // Construct a recovery journal from an interrupted process without
        // deliberately terminating any process or touching the real app.
        string previous = Path.Combine(state, "pending/old/VERSION.txt"); Directory.CreateDirectory(Path.GetDirectoryName(previous)); File.WriteAllText(previous, "2.3.0\n");
        File.WriteAllText(Path.Combine(root, "VERSION.txt"), "2.4.0\n");
        File.WriteAllText(Path.Combine(state, "transaction.json"), Json(new Dictionary<string, object> {
            { "root", root }, { "files", new object[] { new Dictionary<string, object> { { "path", "VERSION.txt" }, { "existed", true }, { "hash", UpdateFiles.FileHash(previous) } } } }
        }));
        new UpdateTransaction(root, state).Recover();
        Check(File.ReadAllText(Path.Combine(root, "VERSION.txt")) == "2.3.0\n", "Interrupted transaction rolls back on recovery");
        File.WriteAllText(Path.Combine(state, "transaction.json"), Json(new Dictionary<string, object> {
            { "root", root }, { "files", new object[] { new Dictionary<string, object> { { "path", "Z Note notebook/pages/private.json" }, { "existed", false } } } }
        }));
        Reject(delegate { new UpdateTransaction(root, state).Recover(); }, "Tampered recovery cannot target notebook");
        Check(File.ReadAllText(Path.Combine(root, "Z Note notebook/pages/private.json")) == "private notebook content", "Notebook survives rejected recovery");
        using (UpdateLock held = new UpdateLock(root))
        {
            bool blocked = false;
            Thread other = new Thread(delegate() { try { using (UpdateLock second = new UpdateLock(root)) { } } catch (IOException) { blocked = true; } });
            other.Start(); other.Join(); Check(blocked, "Concurrent installer rejected");
        }
    }
    private static void LauncherTransactions()
    {
        string zip = Package("3.0.0"), legacyZip = Package("3.0.0", null, false, false, false);
        string root = App("2.4.2", false), state = DirectoryFor("state");
        new UpdateTransaction(root, state).Apply(zip, "3.0.0", null, null);
        Check(File.ReadAllText(Path.Combine(root, "Z Note.exe")) == FileText("Z Note.exe", "3.0.0"), "Update adds launcher to an older installation");
        Check(File.ReadAllText(Path.Combine(root, "Z Note notebook/pages/private.json")) == "private notebook content", "Adding launcher leaves notebook untouched");

        root = App("2.4.2"); state = DirectoryFor("state");
        new UpdateTransaction(root, state).Apply(legacyZip, "3.0.0", null, null);
        Check(File.ReadAllText(Path.Combine(root, "Z Note.exe")) == FileText("Z Note.exe", "2.4.2"), "Legacy update preserves an existing optional launcher");
        Check(File.ReadAllText(Path.Combine(root, "app/js/store.js")) == FileText("app/js/store.js", "3.0.0"), "Legacy update still installs required assets");

        root = App("2.4.2", false); state = DirectoryFor("state");
        Reject(delegate {
            new UpdateTransaction(root, state).Apply(zip, "3.0.0", null, delegate(int index) {
                if (File.Exists(Path.Combine(root, "Z Note.exe"))) throw new IOException("Injected failure after new launcher installation");
            });
        }, "Failure after installing a new launcher triggers rollback");
        Check(!File.Exists(Path.Combine(root, "Z Note.exe")), "Rollback removes newly added launcher");
        foreach (string relative in UpdateFiles.Allowed)
            if (relative != "Z Note.exe") Check(File.ReadAllText(UpdateFiles.Under(root, relative)) == FileText(relative, "2.4.2"), "Launcher rollback restores existing app file " + relative);
        Check(File.ReadAllText(Path.Combine(root, "Z Note notebook/pages/private.json")) == "private notebook content", "Launcher rollback leaves notebook untouched");

        root = App("2.4.2"); state = DirectoryFor("state");
        Reject(delegate {
            new UpdateTransaction(root, state).Apply(zip, "3.0.0", null, delegate(int index) {
                if (File.ReadAllText(Path.Combine(root, "Z Note.exe")) == FileText("Z Note.exe", "3.0.0")) throw new IOException("Injected failure after launcher replacement");
            });
        }, "Failure after replacing a launcher triggers rollback");
        Check(File.ReadAllText(Path.Combine(root, "Z Note.exe")) == FileText("Z Note.exe", "2.4.2"), "Rollback restores pre-existing launcher bytes");

        // An interrupted transaction can include a newly added icon launcher.
        root = App("2.4.2", false); state = DirectoryFor("state");
        Put(root, "Z Note.exe", FileText("Z Note.exe", "3.0.0"));
        File.WriteAllText(Path.Combine(state, "transaction.json"), Json(new Dictionary<string, object> {
            { "root", root }, { "files", new object[] { new Dictionary<string, object> { { "path", "Z Note.exe" }, { "existed", false } } } }
        }));
        new UpdateTransaction(root, state).Recover();
        Check(!File.Exists(Path.Combine(root, "Z Note.exe")), "Interrupted launcher installation recovers on reopen");
        Check(File.ReadAllText(Path.Combine(root, "Z Note notebook/pages/private.json")) == "private notebook content", "Launcher recovery leaves notebook untouched");
    }

    private static void BackupProtocol()
    {
        string root = App("2.4.0"), state = DirectoryFor("state");
        List<Dictionary<string, object>> replies = new List<Dictionary<string, object>>();
        Action<Dictionary<string, object>> send = delegate(Dictionary<string, object> value) { replies.Add(value); };
        byte[] data = Encoding.UTF8.GetBytes("{\"app\":\"znote\",\"version\":1,\"pages\":[],\"images\":[],\"settings\":{\"name\":\"မြန်မာ\"}}");
        using (UpdateSession session = new UpdateSession(Path.Combine(root, "Z Note.html"), true, send, state))
        {
            session.Ready(); Check((string)replies[0]["stage"] == "ready" && (bool)replies[0]["supported"], "Ready capability advertised");
            session.Handle("{\"command\":\"install\",\"version\":\"2.5.0\"}"); Check((string)replies[replies.Count - 1]["stage"] == "error", "Install without backup blocked before network");
            session.Handle(Json(new Dictionary<string, object> { { "command", "backup-begin" }, { "bytes", data.Length } })); Check((string)replies[replies.Count - 1]["stage"] == "backup-started", "Backup starts");
            session.Handle(Json(new Dictionary<string, object> { { "command", "backup-chunk" }, { "data", Convert.ToBase64String(data) } })); Check((long)replies[replies.Count - 1]["received"] == data.Length, "Acknowledged exact UTF-8 bytes");
            session.Handle("{\"command\":\"backup-end\"}");
            Dictionary<string, object> saved = replies[replies.Count - 1]; Check((string)saved["stage"] == "backup-saved", "Backup finished");
            Check(File.ReadAllText((string)saved["backupPath"]) == Encoding.UTF8.GetString(data), "Disk backup contains exact notebook bytes");
            Check(((string)saved["backupPath"]).StartsWith(state), "Backup stays in dedicated local state directory");
        }
        Check(Directory.GetFiles(Path.Combine(state, "backups"), "*.json").Length == 1, "Finished backup persists on disconnect");
        replies.Clear(); state = DirectoryFor("state");
        using (UpdateSession session = new UpdateSession(Path.Combine(root, "Z Note.html"), true, send, state))
        {
            session.Handle("{\"command\":\"backup-begin\",\"bytes\":268435457}"); Check((string)replies[replies.Count - 1]["stage"] == "error", "Oversized backup rejected");
            session.Handle("{\"command\":\"backup-begin\",\"bytes\":10}");
            session.Handle("{\"command\":\"backup-end\"}"); Check((string)replies[replies.Count - 1]["stage"] == "error", "Incomplete backup rejected");
        }
        Check(Directory.GetFiles(Path.Combine(state, "backups")).Length == 0, "Partial backup cleaned on disconnect");
        replies.Clear(); state = DirectoryFor("state");
        using (UpdateSession session = new UpdateSession(Path.Combine(root, "Z Note.html"), false, send, state))
        {
            session.Ready(); Check(!(bool)replies[0]["supported"], "Test helper advertises no automatic install");
            session.Handle("{\"command\":\"backup-begin\",\"bytes\":10}");
            session.Handle("{\"command\":\"install\",\"version\":\"2.5.0\"}");
            Check((string)replies[replies.Count - 1]["stage"] == "error" && !Directory.Exists(Path.Combine(state, "backups")), "Disabled helper writes no notebook backup and does not install");
        }
    }
    private static void AlreadyInstalledProtocol()
    {
        string root = App("2.6.0"), state = DirectoryFor("state");
        List<Dictionary<string, object>> replies = new List<Dictionary<string, object>>();
        Action<Dictionary<string, object>> send = delegate(Dictionary<string, object> value) { replies.Add(value); };
        byte[] data = Encoding.UTF8.GetBytes("{\"app\":\"znote\",\"version\":1,\"pages\":[],\"images\":[],\"settings\":{}}");
        Dictionary<string, string> original = new Dictionary<string, string>();
        foreach (string relative in UpdateFiles.Allowed) original[relative] = UpdateFiles.FileHash(UpdateFiles.Under(root, relative));
        using (UpdateSession session = new UpdateSession(Path.Combine(root, "Z Note.html"), true, send, state))
        {
            session.Handle("{\"command\":\"install\",\"version\":\"2.6.0\"}");
            Check((string)replies[replies.Count - 1]["stage"] == "error", "Already-installed acknowledgement still requires a complete backup");
            session.Handle(Json(new Dictionary<string, object> { { "command", "backup-begin" }, { "bytes", data.Length } }));
            session.Handle(Json(new Dictionary<string, object> { { "command", "backup-chunk" }, { "data", Convert.ToBase64String(data) } }));
            session.Handle("{\"command\":\"backup-end\"}");
            string backupPath = (string)replies[replies.Count - 1]["backupPath"];
            session.Handle("{\"command\":\"install\",\"version\":\"v2.6.0\"}");
            Check((string)replies[replies.Count - 1]["stage"] == "error", "Already-installed acknowledgement rejects malformed requested versions");
            session.Handle("{\"command\":\"install\",\"version\":\"2.5.1\"}");
            Check((string)replies[replies.Count - 1]["stage"] == "error", "Requested downgrade is rejected locally without a download");
            using (UpdateLock held = new UpdateLock(root))
            {
                Thread other = new Thread(delegate() { session.Handle("{\"command\":\"install\",\"version\":\"2.6.0\"}"); });
                other.Start(); other.Join();
                Check((string)replies[replies.Count - 1]["stage"] == "error", "Already-installed acknowledgement cannot bypass another installer's lock");
            }
            // Recovery must complete before an equal version can be confirmed.
            string previous = Path.Combine(state, "pending/old/app/js/store.js");
            Directory.CreateDirectory(Path.GetDirectoryName(previous));
            File.WriteAllText(previous, FileText("app/js/store.js", "2.6.0"));
            Put(root, "app/js/store.js", "interrupted replacement");
            File.WriteAllText(Path.Combine(state, "transaction.json"), Json(new Dictionary<string, object> {
                { "root", root }, { "files", new object[] { new Dictionary<string, object> { { "path", "app/js/store.js" }, { "existed", true }, { "hash", UpdateFiles.FileHash(previous) } } } }
            }));
            int before = replies.Count;
            session.Handle("{\"command\":\"install\",\"version\":\"2.6.0\"}");
            Dictionary<string, object> result = replies[replies.Count - 1];
            Check(replies.Count == before + 1 && (string)result["stage"] == "installed", "Already-installed version confirms completion without fetch or download progress");
            Check((int)result["protocol"] == 1 && (string)result["version"] == "2.6.0" && (string)result["backupPath"] == backupPath, "Existing clients receive their expected installed version and recovery backup path");
            Check(!File.Exists(Path.Combine(state, "transaction.json")), "Recovery finishes before the installed reply");
            foreach (string relative in UpdateFiles.Allowed) Check(UpdateFiles.FileHash(UpdateFiles.Under(root, relative)) == original[relative], "Already-installed request preserves recovered application bytes: " + relative);
            Check(File.ReadAllText(backupPath) == Encoding.UTF8.GetString(data), "Already-installed request keeps the complete recovery backup");
            Check(File.ReadAllText(Path.Combine(root, "Z Note notebook/pages/private.json")) == "private notebook content", "Already-installed request preserves notebook bytes");
            Check(File.ReadAllText(Path.Combine(root, "Z Note backup KEEP.json")) == "private backup content", "Already-installed request preserves older personal backups");
            Check(Directory.GetFiles(state, "package-*.zip").Length == 0, "Already-installed request does not download a package");
            session.Handle("{\"command\":\"install\",\"version\":\"2.6.0\"}");
            Check((string)replies[replies.Count - 1]["stage"] == "error", "A completed session cannot replay installation");
        }
    }
    private static int Main()
    {
        testRoot = Path.Combine(Path.GetTempPath(), "znu-" + Guid.NewGuid().ToString("N").Substring(0, 8)); Directory.CreateDirectory(testRoot);
        try
        {
            VersionsAndRelease(); Archives(); Transactions(); LauncherTransactions(); BackupProtocol(); AlreadyInstalledProtocol();
            Console.WriteLine(assertions + " native updater assertions passed (temporary fixtures only; no network or real app updates)."); return 0;
        }
        catch (Exception e) { Console.Error.WriteLine(e); return 1; }
        finally { if (Directory.Exists(testRoot)) Directory.Delete(testRoot, true); }
    }
}
