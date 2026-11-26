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
    private static List<object> RecoverySnapshot(string root, string state, bool includeLauncher = true)
    {
        List<object> records = new List<object>();
        foreach (string relative in UpdateFiles.Allowed)
        {
            if (relative == "Z Note.exe" && !includeLauncher) continue;
            string target = UpdateFiles.Under(root, relative); bool existed = File.Exists(target); string hash = null;
            if (existed)
            {
                string old = UpdateFiles.Under(state, "pending/old/" + relative);
                Directory.CreateDirectory(Path.GetDirectoryName(old)); UpdateFiles.CopyDurable(target, old); hash = UpdateFiles.FileHash(old);
            }
            records.Add(new Dictionary<string, object> { { "path", relative }, { "existed", existed }, { "hash", hash } });
        }
        return records;
    }
    private static void RecoveryJournal(string root, string state, List<object> records)
    { File.WriteAllText(Path.Combine(state, "transaction.json"), Json(new Dictionary<string, object> { { "root", root }, { "files", records } })); }
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
        Check(transaction.FailureOutcome == "rolled-back", "Completed verified rollback has an explicit safe outcome");
        foreach (string relative in UpdateFiles.Allowed)
            if (relative != "app/js/update-native.js") Check(File.ReadAllText(UpdateFiles.Under(root, relative)) == FileText(relative, "2.3.0"), "Rollback restored " + relative);
        Check(!File.Exists(Path.Combine(root, "app/js/update-native.js")), "Rollback removes only a newly installed application file");
        Check(!File.Exists(Path.Combine(state, "transaction.json")), "Rollback completed");
        // Construct a recovery journal from an interrupted process without
        // deliberately terminating any process or touching the real app.
        List<object> recovery = RecoverySnapshot(root, state);
        File.WriteAllText(Path.Combine(root, "VERSION.txt"), "2.4.0\n");
        RecoveryJournal(root, state, recovery);
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

        root = App("2.3.0"); state = DirectoryFor("state"); transaction = new UpdateTransaction(root, state);
        Reject(delegate {
            transaction.Apply(zip, "2.4.0", null, delegate(int index) {
                if (index == 0) { File.Delete(Path.Combine(state, "transaction.json")); throw new IOException("Injected lost recovery record"); }
            });
        }, "Missing journal after an application write cannot claim rollback success");
        Check(transaction.FailureOutcome == "recovery-required", "Unprovable rollback keeps the browser protected");
        Check(Directory.Exists(Path.Combine(state, "pending/old")), "Uncertain recovery preserves application backup files");
    }
    private static void PreparationFailures()
    {
        string fixture = DirectoryFor("readonly"), source = Path.Combine(fixture, "source.txt"), copy = Path.Combine(fixture, "copy.txt");
        File.WriteAllText(source, "original application bytes"); File.SetAttributes(source, FileAttributes.ReadOnly);
        try
        {
            UpdateFiles.CopyDurable(source, copy);
            Check(File.ReadAllText(copy) == File.ReadAllText(source), "Durable staging copy preserves exact original bytes");
            Check((File.GetAttributes(copy) & FileAttributes.ReadOnly) == 0, "Generated backup does not inherit source ReadOnly");
            using (FileStream stream = new FileStream(copy, FileMode.Open, FileAccess.ReadWrite, FileShare.Read)) stream.Flush(true);
            Check((File.GetAttributes(source) & FileAttributes.ReadOnly) != 0, "Copying never clears the original file's attributes");
        }
        finally { File.SetAttributes(source, FileAttributes.Normal); }

        string root = App("2.6.0"), state = DirectoryFor("state"), zip = Package("2.6.1");
        string legacyStaging = Path.Combine(state, "pending/old/legacy.txt");
        Directory.CreateDirectory(Path.GetDirectoryName(legacyStaging)); File.WriteAllText(legacyStaging, "old generated copy"); File.SetAttributes(legacyStaging, FileAttributes.ReadOnly);
        string protectedFile = Path.Combine(root, "app/js/store.js"); File.SetAttributes(protectedFile, FileAttributes.ReadOnly);
        UpdateTransaction transaction = new UpdateTransaction(root, state);
        string failure = null;
        try
        {
            try { transaction.Apply(zip, "2.6.1", null, null); } catch (UnauthorizedAccessException e) { failure = e.Message; }
            Check(failure != null && failure.Contains("read-only") && failure.Contains("writable local copy"), "Read-only app file gets an actionable preparation error");
            Check(transaction.FailureOutcome == "unchanged", "Read-only preparation failure proves application files unchanged");
            Check(!File.Exists(Path.Combine(state, "transaction.json")), "Preparation failure happens before journaling or application writes");
            Check(!File.Exists(legacyStaging), "Old read-only staging copies are cleaned without changing app-file attributes");
            Check((File.GetAttributes(protectedFile) & FileAttributes.ReadOnly) != 0, "App-file read-only protection stays in place");
            foreach (string relative in UpdateFiles.Allowed) Check(File.ReadAllText(UpdateFiles.Under(root, relative)) == FileText(relative, "2.6.0"), "Preparation failure preserves application file " + relative);
            Check(File.ReadAllText(Path.Combine(root, "Z Note notebook/pages/private.json")) == "private notebook content", "Preparation error preserves notebook data");
        }
        finally { File.SetAttributes(protectedFile, FileAttributes.Normal); }

        state = DirectoryFor("invalidjournal"); Directory.CreateDirectory(Path.Combine(state, "transaction.json"));
        Put(state, "pending/old/keep.txt", "recovery evidence"); transaction = new UpdateTransaction(root, state);
        Reject(delegate { transaction.Apply(zip, "2.6.1", null, null); }, "A directory at the journal path cannot masquerade as a missing journal");
        Check(transaction.FailureOutcome == "recovery-required", "Unverified recovery never claims unchanged files");
        Check(File.ReadAllText(Path.Combine(state, "pending/old/keep.txt")) == "recovery evidence", "Invalid recovery state is retained for repair");

        state = DirectoryFor("alreadyrestored");
        RecoveryJournal(root, state, RecoverySnapshot(root, state));
        protectedFile = Path.Combine(root, "VERSION.txt"); File.SetAttributes(protectedFile, FileAttributes.ReadOnly);
        try
        {
            new UpdateTransaction(root, state).Recover();
            Check(!File.Exists(Path.Combine(state, "transaction.json")), "Recovery completes when a read-only target already matches verified original bytes");
            Check((File.GetAttributes(protectedFile) & FileAttributes.ReadOnly) != 0 && File.ReadAllText(protectedFile) == FileText("VERSION.txt", "2.6.0"), "Idempotent recovery preserves original bytes and read-only attribute");
        }
        finally { File.SetAttributes(protectedFile, FileAttributes.Normal); }
    }
    private static void FailureStateTransactions()
    {
        string zip = Package("2.6.1");
        // New-file installation exercises the real journal and recovery path
        // independently of OS-specific File.Replace metadata restrictions.
        string root = DirectoryFor("emptyapp"), state = DirectoryFor("state");
        Put(root, "Z Note notebook/pages/private.json", "private notebook content");
        UpdateTransaction transaction = new UpdateTransaction(root, state);
        Reject(delegate { transaction.Apply(zip, "2.6.1", null, delegate(int index) { if (index == 0) throw new IOException("Injected failure after first new app file"); }); }, "New-file installation failure returns after rollback");
        Check(transaction.FailureOutcome == "rolled-back", "Actual verified new-file rollback returns the safe rolled-back outcome");
        foreach (string relative in UpdateFiles.Allowed) Check(!File.Exists(UpdateFiles.Under(root, relative)), "Rollback removes only newly installed application file " + relative);
        Check(File.ReadAllText(Path.Combine(root, "Z Note notebook/pages/private.json")) == "private notebook content", "New-file rollback preserves existing notebook content");
        Check(!File.Exists(Path.Combine(state, "transaction.json")), "Verified rollback removes its journal");
        foreach (bool missing in new bool[] { true, false })
        {
            root = DirectoryFor("emptyapp"); state = DirectoryFor("state"); transaction = new UpdateTransaction(root, state);
            Reject(delegate {
                transaction.Apply(zip, "2.6.1", null, delegate(int index) {
                    if (index != 0) return;
                    if (missing) File.Delete(Path.Combine(state, "transaction.json"));
                    else File.WriteAllText(Path.Combine(state, "transaction.json"), Json(new Dictionary<string, object> { { "root", root }, { "files", new object[0] } }));
                    throw new IOException("Injected unavailable recovery proof");
                });
            }, "Missing or altered journal cannot establish rollback success");
            Check(transaction.FailureOutcome == "recovery-required", "Lost rollback proof keeps a conservative outcome");
            Check(Directory.Exists(Path.Combine(state, "pending/new")), "Uncertain rollback preserves staging evidence");
        }
    }
    private static void InvalidRecoveryRecords()
    {
        foreach (string kind in new string[] { "empty", "subset", "duplicate", "bad-hash", "wrong-hash", "bad-type", "false-with-hash", "missing-hash" })
        {
            string root = App("2.6.0"), state = DirectoryFor("invalidrecovery");
            List<object> records = RecoverySnapshot(root, state);
            Dictionary<string, object> last = (Dictionary<string, object>)records[records.Count - 1];
            if (kind == "empty") records.Clear();
            else if (kind == "subset") records.RemoveAt(0);
            else if (kind == "duplicate") records[1] = records[0];
            else if (kind == "bad-hash") last["hash"] = new string('A', 64);
            else if (kind == "wrong-hash") last["hash"] = new string('0', 64);
            else if (kind == "bad-type") last["existed"] = "true";
            else if (kind == "false-with-hash") last["existed"] = false;
            else if (kind == "missing-hash") last.Remove("hash");
            // A real interrupted update can leave changed files. Invalid
            // metadata must not restore even an earlier valid entry.
            Put(root, "VERSION.txt", "2.6.1\n"); Put(root, "app/js/store.js", "interrupted replacement");
            Dictionary<string, string> before = new Dictionary<string, string>();
            foreach (string relative in UpdateFiles.Allowed) before[relative] = UpdateFiles.FileHash(UpdateFiles.Under(root, relative));
            RecoveryJournal(root, state, records);
            string journalText = File.ReadAllText(Path.Combine(state, "transaction.json"));
            UpdateTransaction transaction = new UpdateTransaction(root, state);
            Reject(delegate { transaction.Recover(); }, kind + " recovery record rejected before rollback writes");
            Check(transaction.FailureOutcome == "recovery-required", kind + " recovery record retains the conservative outcome");
            foreach (string relative in UpdateFiles.Allowed) Check(UpdateFiles.FileHash(UpdateFiles.Under(root, relative)) == before[relative], kind + " recovery error does not mutate " + relative);
            Check(File.ReadAllText(Path.Combine(state, "transaction.json")) == journalText, kind + " recovery journal is preserved");
            Check(Directory.Exists(Path.Combine(state, "pending/old")), kind + " recovery backups are preserved");
            List<Dictionary<string, object>> replies = new List<Dictionary<string, object>>();
            byte[] data = Encoding.UTF8.GetBytes("{\"app\":\"znote\",\"version\":1,\"pages\":[],\"images\":[],\"settings\":{}}");
            using (UpdateSession session = new UpdateSession(Path.Combine(root, "Z Note.html"), true, delegate(Dictionary<string, object> reply) { replies.Add(reply); }, state))
            {
                session.Handle(Json(new Dictionary<string, object> { { "command", "backup-begin" }, { "bytes", data.Length } }));
                session.Handle(Json(new Dictionary<string, object> { { "command", "backup-chunk" }, { "data", Convert.ToBase64String(data) } }));
                session.Handle("{\"command\":\"backup-end\"}");
                session.Handle("{\"command\":\"install\",\"version\":\"2.6.1\"}");
                Check((string)replies[replies.Count - 1]["stage"] == "error" && (string)replies[replies.Count - 1]["outcome"] == "recovery-required", kind + " startup recovery cannot unlock editing or acknowledge an installed version");
                Check(File.ReadAllText(Path.Combine(state, "transaction.json")) == journalText, kind + " session error keeps recovery evidence");
            }
        }
        string legacyRoot = App("2.6.0"), legacyState = DirectoryFor("legacyrecovery");
        RecoveryJournal(legacyRoot, legacyState, RecoverySnapshot(legacyRoot, legacyState, false));
        new UpdateTransaction(legacyRoot, legacyState).Recover();
        Check(!File.Exists(Path.Combine(legacyState, "transaction.json")), "Complete 37-file legacy journal remains compatible");
        Check(File.ReadAllText(Path.Combine(legacyRoot, "Z Note.exe")) == FileText("Z Note.exe", "2.6.0"), "Legacy recovery leaves the optional launcher unchanged");
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
        List<object> recovery = RecoverySnapshot(root, state);
        Put(root, "Z Note.exe", FileText("Z Note.exe", "3.0.0"));
        RecoveryJournal(root, state, recovery);
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
            List<object> recovery = RecoverySnapshot(root, state);
            Put(root, "app/js/store.js", "interrupted replacement");
            RecoveryJournal(root, state, recovery);
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
    private static void FailureOutcomesProtocol()
    {
        string root = App("2.6.0"), state = DirectoryFor("state");
        List<Dictionary<string, object>> replies = new List<Dictionary<string, object>>();
        Action<Dictionary<string, object>> send = delegate(Dictionary<string, object> value) { replies.Add(value); };
        byte[] data = Encoding.UTF8.GetBytes("{\"app\":\"znote\",\"version\":1,\"pages\":[],\"images\":[],\"settings\":{}}");
        using (UpdateSession session = new UpdateSession(Path.Combine(root, "Z Note.html"), true, send, state))
        {
            session.Handle("{\"command\":\"install\",\"version\":\"2.5.1\"}");
            Check((string)replies[replies.Count - 1]["outcome"] == "recovery-required", "Failure before backup and lock cannot claim a safe baseline");
            session.Handle(Json(new Dictionary<string, object> { { "command", "backup-begin" }, { "bytes", data.Length } }));
            session.Handle(Json(new Dictionary<string, object> { { "command", "backup-chunk" }, { "data", Convert.ToBase64String(data) } }));
            session.Handle("{\"command\":\"backup-end\"}");
            string saved = (string)replies[replies.Count - 1]["backupPath"];
            session.Handle("{\"command\":\"install\",\"version\":\"2.5.1\"}");
            Dictionary<string, object> failure = replies[replies.Count - 1];
            Check((string)failure["stage"] == "error" && (string)failure["outcome"] == "unchanged", "Rejected downgrade after locked recovery reports unchanged application files");
            Check((string)failure["version"] == "2.5.1" && (string)failure["backupPath"] == saved, "Safe outcome is bound to the exact request and validated backup");
            using (UpdateLock held = new UpdateLock(root))
            {
                Thread other = new Thread(delegate() { session.Handle("{\"command\":\"install\",\"version\":\"2.5.1\"}"); });
                other.Start(); other.Join();
                Check((string)replies[replies.Count - 1]["outcome"] == "recovery-required", "Concurrent updater rejection cannot reuse an earlier safe outcome");
            }
            Directory.CreateDirectory(Path.Combine(state, "transaction.json"));
            session.Handle("{\"command\":\"install\",\"version\":\"2.6.0\"}");
            Check((string)replies[replies.Count - 1]["outcome"] == "recovery-required", "Invalid recovery record cannot acknowledge the current version or release editing");
            Check(File.ReadAllText(saved) == Encoding.UTF8.GetString(data), "Every failure keeps the completed notebook recovery backup");
            Check(Directory.GetFiles(state, "package-*.zip").Length == 0, "Outcome checks use no download or application mutation");
        }
    }
    private static int Main(string[] args)
    {
        testRoot = Path.Combine(Path.GetTempPath(), "znu-" + Guid.NewGuid().ToString("N").Substring(0, 8)); Directory.CreateDirectory(testRoot);
        try
        {
            bool focused = args.Length == 1 && args[0] == "--preparation-and-outcomes";
            if (args.Length > 0 && !focused) throw new ArgumentException("Unknown native updater test group.");
            VersionsAndRelease(); Archives(); PreparationFailures(); FailureStateTransactions(); InvalidRecoveryRecords(); BackupProtocol(); FailureOutcomesProtocol();
            if (!focused) { Transactions(); LauncherTransactions(); AlreadyInstalledProtocol(); }
            Console.WriteLine(assertions + " native updater assertions passed (temporary fixtures only; no network or real app updates)."); return 0;
        }
        catch (Exception e) { Console.Error.WriteLine(e); return 1; }
        finally { if (Directory.Exists(testRoot)) Directory.Delete(testRoot, true); }
    }
}
