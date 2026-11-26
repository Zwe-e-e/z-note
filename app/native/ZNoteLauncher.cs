using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

namespace ZNote.PortableLauncher
{
    internal sealed class MissingHelperException : FileNotFoundException
    {
        internal MissingHelperException(string path)
            : base("The Z Note Windows helper was not found:\r\n" + path, path) { }
    }

    internal static class Launcher
    {
        internal static string ExecutableDirectory()
        {
            // Use the executable Windows actually started, just as the CMD
            // entry point resolves beside itself. AppDomain setup can specify
            // a different base directory when a launcher is hosted externally.
            using (Process process = Process.GetCurrentProcess())
                return Path.GetDirectoryName(Path.GetFullPath(process.MainModule.FileName));
        }

        private static FileAttributes? ReadAttributes(string path)
        {
            // File.Exists also returns false for access errors. Only genuine
            // absence may select browser mode; denied access must stay an error.
            try { return File.GetAttributes(path); }
            catch (FileNotFoundException) { return null; }
            catch (DirectoryNotFoundException) { return null; }
        }

        private static string ExistingPage(string root)
        {
            string page = Path.Combine(root, "Z Note.html");
            FileAttributes? attributes = ReadAttributes(page);
            if (!attributes.HasValue)
                throw new FileNotFoundException("Z Note.html was not found:\r\n" + page +
                    "\r\n\r\nExtract the complete Z Note folder and keep Z Note.exe, Z Note.html and the app folder together.", page);
            if ((attributes.Value & FileAttributes.Directory) != 0)
                throw new IOException("The Z Note page path is a folder instead of a file:\r\n" + page);
            return page;
        }

        private static void CheckHelperParents(string host)
        {
            // A file occupying app/ or app/native/ is a broken path, not an
            // absent helper. Report it instead of silently choosing browser mode.
            for (string parent = Path.GetDirectoryName(host); !String.IsNullOrEmpty(parent); parent = Path.GetDirectoryName(parent))
            {
                FileAttributes? attributes = ReadAttributes(parent);
                if (attributes.HasValue && (attributes.Value & FileAttributes.Directory) == 0)
                    throw new IOException("The Z Note Windows helper folder path is occupied by a file:\r\n" + parent);
            }
        }

        // Resolve beside this launcher, never from a shortcut's working directory.
        internal static ProcessStartInfo StartInfo(string directory)
        {
            string root = Path.GetFullPath(directory);
            string page = ExistingPage(root);
            string host = Path.Combine(root, "app", "native", "ZNoteHost.exe");
            FileAttributes? attributes = ReadAttributes(host);
            if (!attributes.HasValue) { CheckHelperParents(host); throw new MissingHelperException(host); }
            if ((attributes.Value & FileAttributes.Directory) != 0)
                throw new IOException("The Z Note Windows helper path is a folder instead of a file:\r\n" + host);

            // Windows file names cannot contain double quotes; page ends in .html,
            // so its closing quote cannot be escaped by a trailing backslash.
            return new ProcessStartInfo(host, "--page \"" + page + "\"")
            {
                WorkingDirectory = root,
                UseShellExecute = false,
                CreateNoWindow = true
            };
        }

        internal static string FindBrowser(string[] candidates)
        {
            foreach (string candidate in candidates)
            {
                FileAttributes? attributes = ReadAttributes(candidate);
                if (!attributes.HasValue) continue;
                if ((attributes.Value & FileAttributes.Directory) != 0)
                    throw new IOException("The browser program path is a folder instead of a file:\r\n" + candidate);
                return candidate;
            }
            return null;
        }

        internal static string FindBrowser()
        {
            // Keep the same Chrome-then-Edge order as the Windows helper, so
            // browser mode uses the existing default profile and local notes.
            return FindBrowser(new string[] {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Google", "Chrome", "Application", "chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Google", "Chrome", "Application", "chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Google", "Chrome", "Application", "chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft", "Edge", "Application", "msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft", "Edge", "Application", "msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Microsoft", "Edge", "Application", "msedge.exe")
            });
        }

        internal static ProcessStartInfo BrowserStartInfo(string directory, string browser)
        {
            string root = Path.GetFullPath(directory);
            string page = ExistingPage(root);
            string url = new Uri(page).AbsoluteUri;
            if (browser == null)
                return new ProcessStartInfo(url) { WorkingDirectory = root, UseShellExecute = true };
            return new ProcessStartInfo(browser, "--app=\"" + url + "\"") {
                WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true
            };
        }

        [STAThread]
        private static int Main()
        {
            string root = null;
            try
            {
                root = ExecutableDirectory();
                ProcessStartInfo start;
                try { start = StartInfo(root); }
                catch (MissingHelperException error)
                {
                    start = BrowserStartInfo(root, FindBrowser());
                    MessageBox.Show(error.Message + "\r\n\r\nZ Note will open in browser mode. Background Keep Awake and automatic installation of updates are unavailable until the helper is restored. Your notes and connected-folder settings are kept.",
                        "Z Note browser mode", MessageBoxButtons.OK, MessageBoxIcon.Information);
                }
                // Launch errors (including denied access or an invalid helper)
                // are reported, never converted into a different browser/profile.
                using (Process process = Process.Start(start)) { }
                return 0;
            }
            catch (Exception error)
            {
                string details = error.Message;
                if (root != null) details += "\r\n\r\nApplication folder:\r\n" + root +
                    "\r\n\r\nPage:\r\n" + Path.Combine(root, "Z Note.html") +
                    "\r\n\r\nWindows helper:\r\n" + Path.Combine(root, "app", "native", "ZNoteHost.exe");
                MessageBox.Show(details, "Z Note could not open", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
        }
    }
}
