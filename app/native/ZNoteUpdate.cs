// Application-only updates. Notebook data never leaves this PC.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

namespace ZNote.NativeHost
{
    internal static class UpdateFiles
    {
        // Closed set: no notebook, browser state, source-folder handles, backup,
        // developer configuration, or arbitrary new archive path is writable.
        internal static readonly string[] Allowed = new string[] {
            "VERSION.txt", "CHANGELOG.md", "Z Note.html", "Open Z Note.cmd", "START HERE.txt", "Z Note.exe",
            "app/css/board.css", "app/css/note.css", "app/css/shell.css", "app/css/snip.css", "app/css/theme.css", "app/css/todo.css",
            "app/img/icon.ico", "app/img/icon.png", "app/js/awake-native.js", "app/js/awake.js", "app/js/board.js", "app/js/db.js",
            "app/js/home.js", "app/js/icons.js", "app/js/main.js", "app/js/note.js", "app/js/search.js", "app/js/settings.js",
            "app/js/setup.js", "app/js/shell.js", "app/js/snip.js", "app/js/source-folder.js", "app/js/store.js", "app/js/sync.js",
            "app/js/templates.js", "app/js/todo.js", "app/js/ui.js", "app/js/updates.js", "app/js/update-native.js", "app/js/util.js",
            "app/js/version.js", "app/native/ZNoteHost.exe"
        };
        internal static readonly HashSet<string> AllowSet = new HashSet<string>(Allowed, StringComparer.Ordinal);
        internal static JavaScriptSerializer Json(int maximum) { return new JavaScriptSerializer { MaxJsonLength = maximum, RecursionLimit = 256 }; }
        internal static string Hash(byte[] bytes) { using (SHA256 sha = SHA256.Create()) return Hex(sha.ComputeHash(bytes)); }
        internal static string FileHash(string path) { using (SHA256 sha = SHA256.Create()) using (Stream stream = File.OpenRead(path)) return Hex(sha.ComputeHash(stream)); }
        private static string Hex(byte[] value) { return BitConverter.ToString(value).Replace("-", "").ToLowerInvariant(); }
        internal static string InstallKey(string root) { return Hash(Encoding.UTF8.GetBytes(Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar).ToUpperInvariant())); }
        internal static string StateRoot(string root) { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Z Note", "Updates", InstallKey(root)); }
        internal static string Under(string root, string relative)
        {
            string prefix = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            string path = Path.GetFullPath(Path.Combine(prefix, relative.Replace('/', Path.DirectorySeparatorChar)));
            if (!path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) throw new IOException("An update path is outside its application folder.");
            CheckRedirects(path);
            return path;
        }

        [StructLayout(LayoutKind.Sequential)] private struct AttributeTag { internal uint Attributes; internal uint Tag; }
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint mode, uint flags, IntPtr template);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool GetFileInformationByHandleEx(SafeFileHandle file, int type, out AttributeTag info, uint size);
        internal static void CheckRedirects(string path)
        {
            // OneDrive cloud placeholders are not name-surrogate reparses and
            // remain supported. Junctions/symlinks redirect writes and fail closed.
            for (string current = Path.GetFullPath(path); !String.IsNullOrEmpty(current); current = Path.GetDirectoryName(current))
            {
                if (!File.Exists(current) && !Directory.Exists(current)) continue;
                if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) == 0) continue;
                using (SafeFileHandle file = CreateFile(current, 0, 7, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero))
                {
                    AttributeTag info;
                    if (file.IsInvalid || !GetFileInformationByHandleEx(file, 9, out info, 8) || (info.Tag & 0x20000000) != 0)
                        throw new IOException("Automatic updates cannot write through a linked folder or file. Use a normal local folder.");
                }
            }
        }
        internal static void WriteDurable(string path, byte[] bytes)
        {
            CheckRedirects(path);
            using (FileStream stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            { stream.Write(bytes, 0, bytes.Length); stream.Flush(true); }
        }
        internal static void AtomicText(string path, string text)
        {
            string temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            WriteDurable(temporary, Encoding.UTF8.GetBytes(text));
            if (File.Exists(path)) { CheckRedirects(path); File.Replace(temporary, path, null); }
            else File.Move(temporary, path);
        }
        internal static int CompareVersions(string left, string right)
        {
            string pattern = @"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$";
            if (left == null || right == null || !Regex.IsMatch(left, pattern) || !Regex.IsMatch(right, pattern)) throw new InvalidDataException("Invalid application version.");
            string[] a = left.Split('.'), b = right.Split('.');
            for (int i = 0; i < 3; i++)
            {
                long x, y;
                if (!Int64.TryParse(a[i], out x) || !Int64.TryParse(b[i], out y)) throw new InvalidDataException("Invalid application version.");
                if (x != y) return x.CompareTo(y);
            }
            return 0;
        }
        internal static string Text(IDictionary<string, object> data, string key)
        { object value; return data.TryGetValue(key, out value) ? value as string : null; }
        internal static long Integer(IDictionary<string, object> data, string key)
        {
            object value;
            if (!data.TryGetValue(key, out value) || !(value is int || value is long)) throw new InvalidDataException("Invalid update message.");
            return Convert.ToInt64(value, CultureInfo.InvariantCulture);
        }
    }

    internal sealed class UpdateLock : IDisposable
    {
        private readonly Mutex mutex;
        private bool held;
        internal UpdateLock(string root)
        {
            mutex = new Mutex(false, @"Local\ZNoteUpdate-" + UpdateFiles.InstallKey(root));
            try { held = mutex.WaitOne(0); } catch (AbandonedMutexException) { held = true; }
            if (!held) { mutex.Dispose(); throw new IOException("Another Z Note window is updating this app. Wait for it to finish."); }
        }
        public void Dispose() { if (held) { held = false; mutex.ReleaseMutex(); } mutex.Dispose(); }
    }

    internal sealed class UpdatePackage
    {
        internal string Version, DownloadUrl, Digest;
        internal long Size;
        private const string Repo = "https://github.com/Zwe-e-e/z-note";
        internal static UpdatePackage Parse(string json, string requested, string installed)
        {
            IDictionary<string, object> release = UpdateFiles.Json(2 * 1024 * 1024).DeserializeObject(json) as IDictionary<string, object>;
            object value;
            if (release == null || !release.TryGetValue("draft", out value) || !(value is bool) || (bool)value ||
                !release.TryGetValue("prerelease", out value) || !(value is bool) || (bool)value) throw new InvalidDataException("The latest release is not a stable published release.");
            string tag = UpdateFiles.Text(release, "tag_name");
            string version = tag != null && tag.StartsWith("v", StringComparison.Ordinal) ? tag.Substring(1) : tag;
            if (UpdateFiles.CompareVersions(version, installed) <= 0) throw new InvalidDataException("This app is already current. Check for updates again.");
            if (!String.Equals(version, requested, StringComparison.Ordinal)) throw new InvalidDataException("The latest release changed. Check for updates again before installing.");
            if (!release.TryGetValue("assets", out value)) throw new InvalidDataException("The release download is not ready.");
            object[] assets = value as object[];
            if (assets == null) throw new InvalidDataException("The release download is not ready.");
            foreach (object item in assets)
            {
                IDictionary<string, object> asset = item as IDictionary<string, object>;
                if (asset == null) continue;
                string name = UpdateFiles.Text(asset, "name");
                if (name != "Z-Note-v" + version + "-Portable.zip" && name != "Z-Note-Portable.zip") continue;
                string url = Repo + "/releases/download/" + tag + "/" + name;
                string digest = UpdateFiles.Text(asset, "digest");
                long size = UpdateFiles.Integer(asset, "size");
                if (UpdateFiles.Text(asset, "state") != "uploaded" || UpdateFiles.Text(asset, "browser_download_url") != url ||
                    digest == null || !Regex.IsMatch(digest, "^sha256:[a-f0-9]{64}$") || size <= 0 || size > 64 * 1024 * 1024)
                    throw new InvalidDataException("The release does not have a verifiable portable package yet.");
                return new UpdatePackage { Version = version, DownloadUrl = url, Digest = digest.Substring(7), Size = size };
            }
            throw new InvalidDataException("The release download is not ready.");
        }
        internal static HttpWebResponse Get(string url, bool asset)
        {
            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
            Uri uri = new Uri(url);
            for (int redirect = 0; redirect < 5; redirect++)
            {
                bool permitted = asset ? uri.Host == "github.com" || uri.Host == "release-assets.githubusercontent.com" || uri.Host == "objects.githubusercontent.com" : uri.Host == "api.github.com";
                if (!permitted || uri.Scheme != "https" || !String.IsNullOrEmpty(uri.UserInfo) || !uri.IsDefaultPort) throw new IOException("The update download redirected outside GitHub.");
                HttpWebRequest request = (HttpWebRequest)WebRequest.Create(uri);
                request.UserAgent = "Z-Note-Portable-Updater";
                request.Accept = asset ? "application/octet-stream" : "application/vnd.github+json";
                request.AllowAutoRedirect = false; request.Timeout = 30000; request.ReadWriteTimeout = 30000;
                request.UseDefaultCredentials = false; request.Credentials = null;
                HttpWebResponse response = (HttpWebResponse)request.GetResponse();
                int code = (int)response.StatusCode;
                if (code >= 300 && code <= 399)
                {
                    string destination = response.Headers["Location"];
                    response.Dispose();
                    if (String.IsNullOrEmpty(destination)) throw new IOException("GitHub did not provide a download location.");
                    uri = new Uri(uri, destination); continue;
                }
                if (code != 200) { response.Dispose(); throw new IOException("GitHub could not provide the update."); }
                return response;
            }
            throw new IOException("Too many update download redirects.");
        }
        internal static UpdatePackage Latest(string requested, string installed)
        {
            using (HttpWebResponse response = Get("https://api.github.com/repos/Zwe-e-e/z-note/releases/latest", false))
            using (Stream source = response.GetResponseStream())
            using (MemoryStream buffer = new MemoryStream())
            {
                CopyBounded(source, buffer, 2 * 1024 * 1024);
                return Parse(new UTF8Encoding(false, true).GetString(buffer.ToArray()), requested, installed);
            }
        }
        internal static void CopyBounded(Stream source, Stream target, long limit)
        {
            byte[] buffer = new byte[32768]; long total = 0; int read;
            Stopwatch deadline = Stopwatch.StartNew();
            while ((read = source.Read(buffer, 0, buffer.Length)) != 0)
            {
                total += read;
                if (total > limit || deadline.ElapsedMilliseconds > 120000) throw new IOException("The update download exceeded its size or time limit.");
                target.Write(buffer, 0, read);
            }
        }
        internal void Download(string path)
        {
            using (HttpWebResponse response = Get(DownloadUrl, true))
            using (Stream source = response.GetResponseStream())
            using (FileStream target = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            { CopyBounded(source, target, Size); target.Flush(true); }
            Verify(path);
        }
        internal void Verify(string path)
        { if (new FileInfo(path).Length != Size || UpdateFiles.FileHash(path) != Digest) throw new InvalidDataException("The update download failed its SHA-256 check. Your app has not been changed."); }
        internal static List<string> Extract(string zipPath, string stage, string expectedVersion)
        {
            List<string> files = new List<string>();
            HashSet<string> names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            long expanded = 0;
            using (ZipArchive archive = ZipFile.OpenRead(zipPath))
            {
                if (archive.Entries.Count < 1 || archive.Entries.Count > UpdateFiles.Allowed.Length) throw new InvalidDataException("Unexpected files in the update package.");
                foreach (ZipArchiveEntry entry in archive.Entries)
                {
                    string name = entry.FullName;
                    if (!name.StartsWith("Z Note/", StringComparison.Ordinal)) throw new InvalidDataException("Invalid update package folder.");
                    string relative = name.Substring(7);
                    if (!UpdateFiles.AllowSet.Contains(relative) || !names.Add(relative) || (entry.ExternalAttributes >> 16 & 0xF000) == 0xA000 ||
                        entry.Length < 0 || entry.Length > 32 * 1024 * 1024 || (expanded += entry.Length) > 128 * 1024 * 1024)
                        throw new InvalidDataException("The package contains an unexpected or unsafe application file.");
                    string destination = UpdateFiles.Under(stage, relative);
                    Directory.CreateDirectory(Path.GetDirectoryName(destination));
                    using (Stream source = entry.Open())
                    using (FileStream target = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                    { CopyBounded(source, target, entry.Length); target.Flush(true); }
                    if (new FileInfo(destination).Length != entry.Length) throw new InvalidDataException("The update package is incomplete.");
                    files.Add(relative);
                }
            }
            // The icon launcher is optional so this updater can also install a
            // legacy-format package. Every existing runtime component remains
            // required; no other new archive paths are permitted.
            foreach (string name in UpdateFiles.Allowed)
                if (name != "Z Note.exe" && !names.Contains(name)) throw new InvalidDataException("The update package is missing " + name + ".");
            if (File.ReadAllText(UpdateFiles.Under(stage, "VERSION.txt")).Trim() != expectedVersion) throw new InvalidDataException("The package version does not match the release.");
            string versionScript = File.ReadAllText(UpdateFiles.Under(stage, "app/js/version.js"));
            if (!versionScript.Contains("window.ZN.version = '" + expectedVersion + "';")) throw new InvalidDataException("The app version does not match the release.");
            files.Sort(StringComparer.Ordinal);
            files.Remove("VERSION.txt"); files.Add("VERSION.txt"); // Commit marker last.
            return files;
        }
    }

    internal sealed class UpdateTransaction
    {
        private readonly string root, state, pending, journal;
        internal UpdateTransaction(string applicationRoot, string stateRoot)
        {
            root = Path.GetFullPath(applicationRoot); state = Path.GetFullPath(stateRoot);
            UpdateFiles.CheckRedirects(root); UpdateFiles.CheckRedirects(state);
            Directory.CreateDirectory(state);
            pending = UpdateFiles.Under(state, "pending"); journal = UpdateFiles.Under(state, "transaction.json");
        }
        internal void Recover()
        {
            if (!File.Exists(journal)) return;
            IDictionary<string, object> record = UpdateFiles.Json(1024 * 1024).DeserializeObject(File.ReadAllText(journal)) as IDictionary<string, object>;
            object raw;
            if (record == null || UpdateFiles.Text(record, "root") != root || !record.TryGetValue("files", out raw) || !(raw is object[]))
                throw new IOException("The previous update needs recovery. Keep the app folder and contact the Z Note maintainer.");
            object[] files = (object[])raw;
            foreach (object item in files)
            {
                IDictionary<string, object> file = item as IDictionary<string, object>;
                string relative = file == null ? null : UpdateFiles.Text(file, "path");
                object existed;
                if (relative == null || !UpdateFiles.AllowSet.Contains(relative) || !file.TryGetValue("existed", out existed) || !(existed is bool)) throw new IOException("Invalid update recovery record.");
                string target = UpdateFiles.Under(root, relative);
                if ((bool)existed)
                {
                    string old = UpdateFiles.Under(pending, "old/" + relative);
                    if (!File.Exists(old) || UpdateFiles.FileHash(old) != UpdateFiles.Text(file, "hash")) throw new IOException("The previous update backup could not be verified. Your notebook is untouched.");
                    ReplaceFile(old, target);
                }
                else if (File.Exists(target)) { UpdateFiles.CheckRedirects(target); File.Delete(target); }
            }
            File.Delete(journal);
            CleanupPending();
        }
        private static void ReplaceFile(string source, string target)
        {
            UpdateFiles.CheckRedirects(target); Directory.CreateDirectory(Path.GetDirectoryName(target));
            string temporary = target + ".zn-update-" + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                using (Stream input = File.OpenRead(source))
                using (FileStream output = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                { input.CopyTo(output); output.Flush(true); }
                UpdateFiles.CheckRedirects(target);
                if (File.Exists(target)) File.Replace(temporary, target, null);
                else File.Move(temporary, target);
            }
            catch (IOException e) { throw new IOException("Could not replace application file " + target + ". " + e.Message, e); }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
        }
        private void CleanupPending()
        {
            if (!Directory.Exists(pending)) return;
            // Explicit generated transaction tree only; no app folder deletion.
            DeleteStagingTree(pending);
        }
        private static void DeleteStagingTree(string directory)
        {
            UpdateFiles.CheckRedirects(directory);
            foreach (string file in Directory.GetFiles(directory)) { UpdateFiles.CheckRedirects(file); File.Delete(file); }
            foreach (string child in Directory.GetDirectories(directory)) DeleteStagingTree(child);
            Directory.Delete(directory, false);
        }
        internal void Apply(string zip, string version, Action<string> progress, Action<int> afterFile)
        {
            Recover(); CleanupPending();
            Directory.CreateDirectory(pending);
            string stage = UpdateFiles.Under(pending, "new"); Directory.CreateDirectory(stage);
            List<string> files = UpdatePackage.Extract(zip, stage, version);
            List<object> records = new List<object>();
            foreach (string relative in files)
            {
                string target = UpdateFiles.Under(root, relative);
                if (Directory.Exists(target)) throw new IOException("An application file is occupied by a folder.");
                bool existed = File.Exists(target); string hash = null;
                if (existed)
                {
                    string old = UpdateFiles.Under(pending, "old/" + relative);
                    Directory.CreateDirectory(Path.GetDirectoryName(old));
                    File.Copy(target, old, false); hash = UpdateFiles.FileHash(old);
                    if (hash != UpdateFiles.FileHash(target)) throw new IOException("An application file changed while preparing the update.");
                    using (FileStream check = new FileStream(old, FileMode.Open, FileAccess.ReadWrite, FileShare.Read)) check.Flush(true);
                }
                records.Add(new Dictionary<string, object> { { "path", relative }, { "existed", existed }, { "hash", hash } });
            }
            UpdateFiles.AtomicText(journal, UpdateFiles.Json(1024 * 1024).Serialize(new Dictionary<string, object> { { "root", root }, { "files", records } }));
            try
            {
                if (progress != null) progress("Installing the verified app files. Your notebook folder and browser settings are kept.");
                for (int i = 0; i < files.Count; i++)
                {
                    string relative = files[i];
                    ReplaceFile(UpdateFiles.Under(stage, relative), UpdateFiles.Under(root, relative));
                    if (afterFile != null) afterFile(i);
                }
                // A missing journal marks a committed update. Leftover staging
                // is harmless and removed before the next transaction.
                File.Delete(journal);
            }
            catch (Exception)
            {
                try { Recover(); } catch (Exception recovery) { throw new IOException("The update was interrupted and needs recovery when Z Note is reopened. Your notebook and saved backup were not changed. " + recovery.Message); }
                throw;
            }
            try { CleanupPending(); } catch (IOException) { } catch (UnauthorizedAccessException) { }
        }
    }

    internal sealed class UpdateSession : IDisposable
    {
        internal const int MaximumFrame = 49152;
        internal const long MaximumBackup = 268435456;
        private readonly string root, state;
        private readonly bool automatic;
        private readonly Action<Dictionary<string, object>> send;
        private FileStream backup;
        private string partial, saved;
        private long expected, received;
        private bool installed;
        internal UpdateSession(string page, bool supported, Action<Dictionary<string, object>> sender, string testStateRoot = null)
        { root = Path.GetDirectoryName(Path.GetFullPath(page)); state = testStateRoot ?? UpdateFiles.StateRoot(root); send = sender; automatic = supported; }
        internal static Dictionary<string, object> Reply(string stage)
        { return new Dictionary<string, object> { { "type", "update" }, { "protocol", 1 }, { "stage", stage } }; }
        internal void Ready()
        {
            Dictionary<string, object> result = Reply("ready");
            result["supported"] = automatic && !String.Equals(Path.GetFullPath(Process.GetCurrentProcess().MainModule.FileName), UpdateFiles.Under(root, "app/native/ZNoteHost.exe"), StringComparison.OrdinalIgnoreCase);
            result["version"] = File.ReadAllText(UpdateFiles.Under(root, "VERSION.txt")).Trim();
            result["maxBackupBytes"] = MaximumBackup; send(result);
        }
        internal void Handle(string text)
        {
            try
            {
                IDictionary<string, object> data = UpdateFiles.Json(MaximumFrame).DeserializeObject(text) as IDictionary<string, object>;
                if (data == null) throw new InvalidDataException("Invalid update message.");
                if (!automatic) throw new InvalidOperationException("Automatic installation is disabled in this helper session. Open Z Note with Z Note.exe or Open Z Note.cmd.");
                string command = UpdateFiles.Text(data, "command");
                if (command == "backup-begin") Begin(UpdateFiles.Integer(data, "bytes"));
                else if (command == "backup-chunk") Chunk(UpdateFiles.Text(data, "data"));
                else if (command == "backup-end") End();
                else if (command == "install") Install(UpdateFiles.Text(data, "version"));
                else throw new InvalidDataException("Unknown update command.");
            }
            catch (Exception e)
            {
                Dictionary<string, object> error = Reply("error"); error["message"] = e.Message; send(error);
            }
        }
        private void Begin(long bytes)
        {
            if (backup != null || partial != null || saved != null || installed || bytes < 1 || bytes > MaximumBackup) throw new InvalidDataException("The notebook backup is too large or an update is already in progress.");
            UpdateFiles.CheckRedirects(state); Directory.CreateDirectory(state);
            string directory = UpdateFiles.Under(state, "backups"); Directory.CreateDirectory(directory);
            if (new DriveInfo(Path.GetPathRoot(directory)).AvailableFreeSpace < bytes * 3 + 256 * 1024 * 1024) throw new IOException("There is not enough disk space for a safe backup and update.");
            partial = UpdateFiles.Under(directory, "Z Note backup " + DateTime.UtcNow.ToString("yyyy-MM-dd-HHmmss", CultureInfo.InvariantCulture) + "-" + Guid.NewGuid().ToString("N") + ".partial");
            backup = new FileStream(partial, FileMode.CreateNew, FileAccess.Write, FileShare.None);
            expected = bytes; received = 0; send(Reply("backup-started"));
        }
        private void Chunk(string encoded)
        {
            if (backup == null || encoded == null || encoded.Length > 43692) throw new InvalidDataException("Start the notebook backup before sending its contents.");
            byte[] bytes = Convert.FromBase64String(encoded);
            if (bytes.Length == 0 || bytes.Length > 32768 || received + bytes.Length > expected) throw new InvalidDataException("The backup chunk has an invalid size.");
            backup.Write(bytes, 0, bytes.Length); received += bytes.Length;
            Dictionary<string, object> reply = Reply("backup-chunk"); reply["received"] = received; send(reply);
        }
        private void End()
        {
            if (backup == null || received != expected) throw new InvalidDataException("The notebook backup is incomplete. The app has not been changed.");
            backup.Flush(true); backup.Dispose(); backup = null;
            string json = new UTF8Encoding(false, true).GetString(File.ReadAllBytes(partial));
            IDictionary<string, object> data = UpdateFiles.Json((int)MaximumBackup).DeserializeObject(json) as IDictionary<string, object>;
            object value;
            if (data == null || UpdateFiles.Text(data, "app") != "znote" || UpdateFiles.Integer(data, "version") != 1 ||
                !data.TryGetValue("pages", out value) || !(value is object[]) ||
                !data.TryGetValue("images", out value) || !(value is object[]) ||
                !data.TryGetValue("settings", out value) || !(value is IDictionary<string, object>)) throw new InvalidDataException("The notebook backup could not be validated. The app has not been changed.");
            saved = Path.ChangeExtension(partial, ".json"); File.Move(partial, saved); partial = null;
            Dictionary<string, object> reply = Reply("backup-saved"); reply["backupPath"] = saved; send(reply);
        }
        private void Progress(string message) { Dictionary<string, object> reply = Reply("progress"); reply["message"] = message; send(reply); }
        private void Install(string requested)
        {
            if (saved == null || !File.Exists(saved) || installed) throw new InvalidDataException("Save a complete notebook backup before installing an update.");
            if (String.Equals(Path.GetFullPath(Process.GetCurrentProcess().MainModule.FileName), UpdateFiles.Under(root, "app/native/ZNoteHost.exe"), StringComparison.OrdinalIgnoreCase)) throw new IOException("Reopen Z Note through Z Note.exe or Open Z Note.cmd before installing updates.");
            UpdateFiles.CompareVersions(requested, "0.0.0");
            using (UpdateLock updateLock = new UpdateLock(root))
            {
                UpdateTransaction transaction = new UpdateTransaction(root, state); transaction.Recover();
                string current = File.ReadAllText(UpdateFiles.Under(root, "VERSION.txt")).Trim();
                int order = UpdateFiles.CompareVersions(requested, current);
                if (order == 0)
                {
                    // A browser window can still have the previous JavaScript
                    // loaded after these app files were updated. Confirm the
                    // requested version only after recovery and under the same
                    // installation lock, so older clients can safely reload.
                    installed = true;
                    Dictionary<string, object> reply = Reply("installed"); reply["version"] = current; reply["backupPath"] = saved; send(reply);
                    return;
                }
                if (order < 0) throw new InvalidDataException("This app is already newer than the requested update. Reopen Z Note and check for updates again.");
                Progress("Checking the official GitHub release and package checksum…");
                UpdatePackage package = UpdatePackage.Latest(requested, current);
                string zip = UpdateFiles.Under(state, "package-" + Guid.NewGuid().ToString("N") + ".zip");
                try
                {
                    Progress("Downloading the update. Your current app and notebook are still available."); package.Download(zip);
                    transaction.Apply(zip, package.Version, Progress, null); installed = true;
                    Dictionary<string, object> reply = Reply("installed"); reply["version"] = package.Version; reply["backupPath"] = saved; send(reply);
                }
                finally
                {
                    // Cleanup failure must not turn an already committed update
                    // into a second, contradictory response to the browser.
                    try { if (File.Exists(zip)) File.Delete(zip); } catch (IOException) { } catch (UnauthorizedAccessException) { }
                }
            }
        }
        public void Dispose()
        {
            if (backup != null) { backup.Dispose(); backup = null; }
            if (partial != null && File.Exists(partial)) File.Delete(partial);
        }
    }

    internal static class CachedHost
    {
        internal static bool Launch(string page)
        {
            string source = Path.GetFullPath(Process.GetCurrentProcess().MainModule.FileName);
            string digest = UpdateFiles.FileHash(source);
            string directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Z Note", "Host", digest);
            UpdateFiles.CheckRedirects(directory); Directory.CreateDirectory(directory);
            string cached = UpdateFiles.Under(directory, "ZNoteHost.exe");
            if (String.Equals(source, cached, StringComparison.OrdinalIgnoreCase)) return false;
            using (UpdateLock cacheLock = new UpdateLock(directory))
            {
                if (!File.Exists(cached))
                {
                    string temporary = cached + "." + Guid.NewGuid().ToString("N") + ".tmp";
                    File.Copy(source, temporary, false);
                    if (UpdateFiles.FileHash(temporary) != digest) throw new IOException("The Windows helper copy could not be verified.");
                    File.Move(temporary, cached);
                }
                if (UpdateFiles.FileHash(cached) != digest) throw new IOException("The Windows helper cache could not be verified.");
            }
            Process.Start(new ProcessStartInfo(cached, "--page \"" + page + "\"") { UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden });
            return true;
        }
        internal static void Recover(string page)
        {
            string root = Path.GetDirectoryName(Path.GetFullPath(page));
            string state = UpdateFiles.StateRoot(root);
            if (!File.Exists(Path.Combine(state, "transaction.json"))) return;
            using (UpdateLock updateLock = new UpdateLock(root)) new UpdateTransaction(root, state).Recover();
        }
    }
}
