using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

namespace ZNote.PortableLauncher
{
    internal static class Launcher
    {
        // Resolve beside this launcher, never from a shortcut's working directory.
        internal static ProcessStartInfo StartInfo(string directory)
        {
            string root = Path.GetFullPath(directory);
            string page = Path.Combine(root, "Z Note.html");
            string host = Path.Combine(root, "app", "native", "ZNoteHost.exe");
            if (!File.Exists(page) || !File.Exists(host))
                throw new FileNotFoundException("Extract the complete Z Note folder first. Keep Z Note.exe, Z Note.html and the app folder together.");

            // Windows file names cannot contain double quotes; page ends in .html,
            // so its closing quote cannot be escaped by a trailing backslash.
            return new ProcessStartInfo(host, "--page \"" + page + "\"")
            {
                WorkingDirectory = root,
                UseShellExecute = false,
                CreateNoWindow = true
            };
        }

        [STAThread]
        private static int Main()
        {
            try
            {
                using (Process process = Process.Start(StartInfo(AppDomain.CurrentDomain.BaseDirectory))) { }
                return 0;
            }
            catch (Exception error)
            {
                MessageBox.Show(error.Message, "Z Note could not open", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
        }
    }
}
