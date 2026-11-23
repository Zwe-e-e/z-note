// Z Note's portable Windows host. No installation, registry entries or power-plan changes.
// The browser retains its existing file:// URL/storage; this loopback channel exposes
// keep-awake commands and a separate backup-first application updater.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Windows.Forms;

[assembly: System.Reflection.AssemblyTitle("Z Note Portable Host")]
[assembly: System.Reflection.AssemblyVersion("1.0.0.0")]

namespace ZNote.NativeHost
{
    internal static class Native
    {
        internal const uint Continuous = 0x80000000;
        internal const uint Required = Continuous | 0x00000001 | 0x00000002;
        [DllImport("kernel32.dll")]
        internal static extern uint SetThreadExecutionState(uint flags);
    }

    internal sealed class AwakeSession : IDisposable
    {
        private readonly Func<uint, uint> setState;
        private readonly int ownerThread = Thread.CurrentThread.ManagedThreadId;
        internal bool Active { get; private set; }
        internal AwakeSession() : this(Native.SetThreadExecutionState) { }
        internal AwakeSession(Func<uint, uint> setter) { setState = setter; }
        private void CheckThread()
        {
            if (ownerThread != Thread.CurrentThread.ManagedThreadId)
                throw new InvalidOperationException("Power requests belong to their connection thread.");
        }
        internal bool Start()
        {
            CheckThread();
            if (Active) return true;
            if (setState(Native.Required) == 0) return false;
            Active = true;
            return true;
        }
        internal bool Stop()
        {
            CheckThread();
            if (!Active) return true;
            if (setState(Native.Continuous) == 0) return false;
            Active = false;
            return true;
        }
        public void Dispose() { Stop(); }
    }

    internal sealed class ProtocolException : Exception
    {
        internal readonly ushort Code;
        internal ProtocolException(ushort code) { Code = code; }
    }

    internal sealed class Host : IDisposable
    {
        private const int MaximumHeaders = 8192, MaximumFrame = 1024, MaximumClients = 8;
        private const int IoTimeoutMilliseconds = 5000;
        private const long PingIntervalMilliseconds = 20000, PongTimeoutMilliseconds = 30000;
        private readonly TcpListener listener;
        private readonly string token;
        private readonly object gate = new object();
        private readonly HashSet<TcpClient> clients = new HashSet<TcpClient>();
        private readonly Stopwatch clock = Stopwatch.StartNew();
        private long idleSince;
        private bool disposed;
        private readonly string page;
        private readonly bool automaticUpdates;
        internal readonly int Port;
        internal string Token { get { return token; } }

        internal Host(string appPage, bool enableAutomaticUpdates)
        {
            page = appPage;
            automaticUpdates = enableAutomaticUpdates;
            byte[] bytes = new byte[32];
            using (RandomNumberGenerator random = RandomNumberGenerator.Create()) random.GetBytes(bytes);
            token = BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant();
            listener = new TcpListener(IPAddress.Loopback, 0);
            listener.ExclusiveAddressUse = true;
            listener.Start(MaximumClients);
            Port = ((IPEndPoint)listener.LocalEndpoint).Port;
        }

        internal void Run()
        {
            // No browser process monitoring: Chrome may reuse an existing process.
            // A live WebSocket, including a hidden/frozen page, owns the lifetime.
            while (!disposed)
            {
                lock (gate)
                {
                    if (clients.Count == 0 && clock.ElapsedMilliseconds - idleSince >= 30000) return;
                }
                if (!listener.Pending()) { Thread.Sleep(100); continue; }
                TcpClient client = listener.AcceptTcpClient();
                lock (gate)
                {
                    if (clients.Count >= MaximumClients) { client.Close(); continue; }
                    clients.Add(client);
                }
                Thread thread = new Thread(delegate() { Serve(client); });
                thread.IsBackground = true;
                thread.Name = "Z Note Keep Awake";
                thread.Start();
            }
        }

        private void Serve(TcpClient client)
        {
            // Start, Stop and final cleanup execute on this same dedicated thread.
            using (AwakeSession awake = new AwakeSession())
            {
                try
                {
                    client.NoDelay = true;
                    client.SendTimeout = IoTimeoutMilliseconds;
                    NetworkStream stream = client.GetStream();
                    bool update;
                    if (!Handshake(stream, out update)) return;
                    if (update) { ServeUpdate(client, stream); return; }
                    SendState(stream, awake, null);
                    long lastPing = clock.ElapsedMilliseconds, pongDue = 0;
                    byte[] expectedPong = null;
                    while (!disposed)
                    {
                        // Poll on the owning thread. Browser networking responds to
                        // protocol pings without relying on a JavaScript timer.
                        if (client.Client.Poll(500000, SelectMode.SelectRead))
                        {
                            Frame frame = ReadFrame(stream);
                            if (frame.Opcode == 8)
                            {
                                ValidateClose(frame.Payload);
                                SendFrame(stream, 8, frame.Payload);
                                return;
                            }
                            if (frame.Opcode == 9) SendFrame(stream, 10, frame.Payload);
                            else if (frame.Opcode == 10)
                            {
                                if (SameBytes(expectedPong, frame.Payload)) expectedPong = null;
                            }
                            else
                            {
                                string command;
                                try { command = new UTF8Encoding(false, true).GetString(frame.Payload); }
                                catch (DecoderFallbackException) { throw new ProtocolException(1007); }
                                if (command == "start")
                                    SendState(stream, awake, awake.Start() ? null : "Windows could not enable Keep Awake.");
                                else if (command == "stop")
                                    SendState(stream, awake, awake.Stop() ? null : "Windows could not stop Keep Awake. Close Z Note to release it.");
                                else if (command == "status") SendState(stream, awake, null);
                                else throw new ProtocolException(1008);
                            }
                        }
                        long now = clock.ElapsedMilliseconds;
                        if (expectedPong != null && now >= pongDue) return;
                        if (expectedPong == null && now - lastPing >= PingIntervalMilliseconds)
                        {
                            expectedPong = BitConverter.GetBytes(now);
                            SendFrame(stream, 9, expectedPong);
                            lastPing = now;
                            pongDue = now + PongTimeoutMilliseconds;
                        }
                    }
                }
                catch (ProtocolException e)
                {
                    try { SendFrame(client.GetStream(), 8, new byte[] { (byte)(e.Code >> 8), (byte)(e.Code & 255) }); }
                    catch (Exception) { }
                }
                catch (IOException) { }
                catch (SocketException) { }
                catch (ObjectDisposedException) { }
                finally
                {
                    // Dispose also retries a failed release, and termination of this
                    // dedicated native thread finally removes any remaining request.
                    awake.Stop();
                    client.Close();
                    lock (gate)
                    {
                        clients.Remove(client);
                        if (clients.Count == 0) idleSince = clock.ElapsedMilliseconds;
                    }
                }
            }
        }

        private void ServeUpdate(TcpClient client, NetworkStream stream)
        {
            using (UpdateSession session = new UpdateSession(page, automaticUpdates, delegate(Dictionary<string, object> message) {
                SendFrame(stream, 1, Encoding.UTF8.GetBytes(UpdateFiles.Json(65536).Serialize(message)));
            }))
            {
                session.Ready();
                Stopwatch idle = Stopwatch.StartNew();
                while (!disposed)
                {
                    if (!client.Client.Poll(500000, SelectMode.SelectRead))
                    { if (idle.ElapsedMilliseconds > 180000) return; continue; }
                    Frame frame = ReadFrame(stream, UpdateSession.MaximumFrame);
                    idle.Restart();
                    if (frame.Opcode == 8) { ValidateClose(frame.Payload); SendFrame(stream, 8, frame.Payload); return; }
                    if (frame.Opcode == 9) { SendFrame(stream, 10, frame.Payload); continue; }
                    if (frame.Opcode == 10) continue;
                    string command;
                    try { command = new UTF8Encoding(false, true).GetString(frame.Payload); }
                    catch (DecoderFallbackException) { throw new ProtocolException(1007); }
                    session.Handle(command);
                }
            }
        }

        private bool Handshake(NetworkStream stream, out bool update)
        {
            update = false;
            MemoryStream bytes = new MemoryStream();
            Stopwatch deadline = Stopwatch.StartNew();
            int matched = 0;
            byte[] terminator = Encoding.ASCII.GetBytes("\r\n\r\n");
            while (bytes.Length < MaximumHeaders)
            {
                int remaining = IoTimeoutMilliseconds - (int)deadline.ElapsedMilliseconds;
                if (remaining <= 0) throw new IOException("Handshake timed out.");
                stream.ReadTimeout = remaining;
                int value = stream.ReadByte();
                if (value < 0) throw new EndOfStreamException();
                if (value > 126 || (value < 32 && value != 9 && value != 10 && value != 13))
                    return Reject(stream, "400 Bad Request");
                bytes.WriteByte((byte)value);
                matched = value == terminator[matched] ? matched + 1 : value == 13 ? 1 : 0;
                if (matched == 4) break;
            }
            if (matched != 4) return Reject(stream, "431 Request Header Fields Too Large");
            string[] lines = Encoding.ASCII.GetString(bytes.ToArray()).Split(new string[] { "\r\n" }, StringSplitOptions.None);
            string[] request = lines[0].Split(' ');
            if (request.Length != 3 || request[0] != "GET" || request[2] != "HTTP/1.1")
                return Reject(stream, "400 Bad Request");
            update = SameText(request[1], "/update/" + token);
            if (!update && !SameText(request[1], "/awake/" + token)) return Reject(stream, "403 Forbidden");
            Dictionary<string, string> headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            for (int i = 1; i < lines.Length - 2; i++)
            {
                int colon = lines[i].IndexOf(':');
                if (colon <= 0) return Reject(stream, "400 Bad Request");
                string name = lines[i].Substring(0, colon);
                if (name.Trim() != name || headers.ContainsKey(name)) return Reject(stream, "400 Bad Request");
                headers.Add(name, lines[i].Substring(colon + 1).Trim());
            }
            if (Header(headers, "Host") != "127.0.0.1:" + Port.ToString(CultureInfo.InvariantCulture) ||
                Header(headers, "Origin") != "null") return Reject(stream, "403 Forbidden");
            if (!String.Equals(Header(headers, "Upgrade"), "websocket", StringComparison.OrdinalIgnoreCase) ||
                !HasToken(Header(headers, "Connection"), "Upgrade") || Header(headers, "Sec-WebSocket-Version") != "13")
                return Reject(stream, "400 Bad Request");
            string key = Header(headers, "Sec-WebSocket-Key");
            try { if (Convert.FromBase64String(key).Length != 16) return Reject(stream, "400 Bad Request"); }
            catch (FormatException) { return Reject(stream, "400 Bad Request"); }
            string accept;
            using (SHA1 sha = SHA1.Create())
                accept = Convert.ToBase64String(sha.ComputeHash(Encoding.ASCII.GetBytes(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")));
            byte[] response = Encoding.ASCII.GetBytes("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n");
            stream.Write(response, 0, response.Length);
            return true;
        }

        private static string Header(Dictionary<string, string> headers, string name)
        {
            string value;
            return headers.TryGetValue(name, out value) ? value : "";
        }
        private static bool HasToken(string value, string token)
        {
            foreach (string item in value.Split(','))
                if (String.Equals(item.Trim(), token, StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }
        private static bool SameText(string left, string right)
        {
            if (left.Length != right.Length) return false;
            int difference = 0;
            for (int i = 0; i < left.Length; i++) difference |= left[i] ^ right[i];
            return difference == 0;
        }
        private static bool SameBytes(byte[] left, byte[] right)
        {
            if (left == null || left.Length != right.Length) return false;
            int difference = 0;
            for (int i = 0; i < left.Length; i++) difference |= left[i] ^ right[i];
            return difference == 0;
        }
        private static bool Reject(NetworkStream stream, string status)
        {
            byte[] response = Encoding.ASCII.GetBytes("HTTP/1.1 " + status + "\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
            stream.Write(response, 0, response.Length);
            return false;
        }

        private sealed class Frame
        {
            internal int Opcode;
            internal byte[] Payload;
        }
        private static byte[] ReadExact(NetworkStream stream, int count, Stopwatch deadline)
        {
            byte[] result = new byte[count];
            int offset = 0;
            while (offset < count)
            {
                int remaining = IoTimeoutMilliseconds - (int)deadline.ElapsedMilliseconds;
                if (remaining <= 0) throw new IOException("Frame timed out.");
                stream.ReadTimeout = remaining;
                int read = stream.Read(result, offset, count - offset);
                if (read == 0) throw new EndOfStreamException();
                offset += read;
            }
            return result;
        }
        private static Frame ReadFrame(NetworkStream stream, int maximum = MaximumFrame)
        {
            Stopwatch deadline = Stopwatch.StartNew();
            byte[] header = ReadExact(stream, 2, deadline);
            int opcode = header[0] & 15;
            if ((header[0] & 128) == 0 || (header[0] & 112) != 0 || (header[1] & 128) == 0 ||
                (opcode != 1 && opcode != 8 && opcode != 9 && opcode != 10)) throw new ProtocolException(1002);
            int length = header[1] & 127;
            if (opcode >= 8 && length > 125) throw new ProtocolException(1002);
            if (length == 127) throw new ProtocolException(1009);
            if (length == 126)
            {
                byte[] extended = ReadExact(stream, 2, deadline);
                length = (extended[0] << 8) | extended[1];
                if (length < 126) throw new ProtocolException(1002);
            }
            if (length > maximum) throw new ProtocolException(1009);
            byte[] mask = ReadExact(stream, 4, deadline);
            byte[] payload = ReadExact(stream, length, deadline);
            for (int i = 0; i < payload.Length; i++) payload[i] ^= mask[i % 4];
            return new Frame { Opcode = opcode, Payload = payload };
        }
        private static void ValidateClose(byte[] payload)
        {
            if (payload.Length == 1) throw new ProtocolException(1002);
            if (payload.Length < 2) return;
            int code = (payload[0] << 8) | payload[1];
            if (code < 1000 || code >= 5000 || code == 1004 || code == 1005 || code == 1006 ||
                code == 1015 || (code > 1014 && code < 3000)) throw new ProtocolException(1002);
            try { new UTF8Encoding(false, true).GetString(payload, 2, payload.Length - 2); }
            catch (DecoderFallbackException) { throw new ProtocolException(1007); }
        }
        private static void SendFrame(NetworkStream stream, int opcode, byte[] payload)
        {
            byte[] header = payload.Length < 126
                ? new byte[] { (byte)(128 | opcode), (byte)payload.Length }
                : new byte[] { (byte)(128 | opcode), 126, (byte)(payload.Length >> 8), (byte)(payload.Length & 255) };
            stream.Write(header, 0, header.Length);
            stream.Write(payload, 0, payload.Length);
        }
        private static void SendState(NetworkStream stream, AwakeSession awake, string error)
        {
            // Error text is fixed by this host, never supplied by a caller.
            string json = "{\"type\":\"state\",\"protocol\":1,\"active\":" + (awake.Active ? "true" : "false") +
                (error == null ? "" : ",\"error\":\"" + error + "\"") + "}";
            SendFrame(stream, 1, Encoding.UTF8.GetBytes(json));
        }
        public void Dispose()
        {
            disposed = true;
            listener.Stop();
            lock (gate) { foreach (TcpClient client in clients) client.Close(); }
        }
    }

    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            bool noBrowser = false;
            string infoPath = null;
            try
            {
                string page = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", "Z Note.html"));
                for (int i = 0; i < args.Length; i++)
                {
                    if (args[i] == "--no-browser") noBrowser = true;
                    else if (args[i] == "--page" && i + 1 < args.Length) page = Path.GetFullPath(args[++i]);
                    else if (args[i] == "--test-info" && i + 1 < args.Length) infoPath = Path.GetFullPath(args[++i]);
                    else throw new ArgumentException("Unknown or incomplete Z Note host option.");
                }
                if (!File.Exists(page)) throw new FileNotFoundException("Z Note.html was not found. Keep the app folder beside Z Note.html.");
                if (infoPath != null && !noBrowser) throw new ArgumentException("--test-info requires --no-browser.");
                if (!noBrowser && CachedHost.Launch(page)) return 0;
                if (!noBrowser) CachedHost.Recover(page);
                string browser = noBrowser ? null : FindBrowser();
                if (!noBrowser && browser == null)
                {
                    MessageBox.Show("Open Z Note with Chrome or Edge to keep the screen awake in the background. Z Note will now open in your default browser.", "Z Note", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    Process.Start(new ProcessStartInfo(page) { UseShellExecute = true });
                    return 0;
                }
                using (Host host = new Host(page, !noBrowser))
                {
                    string query = "?zn-awake-port=" + host.Port.ToString(CultureInfo.InvariantCulture) + "&zn-awake-token=" + host.Token;
                    string url = new Uri(page).AbsoluteUri + query;
                    if (infoPath != null)
                    {
                        // Explicit integration-test mode only. Normal use never stores
                        // this per-launch capability on disk. CreateNew avoids clobbering.
                        string info = "{\"port\":" + host.Port.ToString(CultureInfo.InvariantCulture) + ",\"token\":\"" + host.Token + "\",\"protocol\":1,\"pid\":" + Process.GetCurrentProcess().Id.ToString(CultureInfo.InvariantCulture) + "}";
                        using (FileStream file = new FileStream(infoPath, FileMode.CreateNew, FileAccess.Write, FileShare.Read))
                        {
                            byte[] bytes = Encoding.UTF8.GetBytes(info);
                            file.Write(bytes, 0, bytes.Length);
                        }
                    }
                    if (!noBrowser)
                        Process.Start(new ProcessStartInfo(browser, "--app=\"" + url + "\"") { UseShellExecute = false });
                    host.Run();
                }
                return 0;
            }
            catch (Exception e)
            {
                if (noBrowser) Console.Error.WriteLine(e.Message);
                else MessageBox.Show(e.Message, "Z Note could not open", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
        }
        private static string FindBrowser()
        {
            string[] paths = new string[] {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Google", "Chrome", "Application", "chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Google", "Chrome", "Application", "chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Google", "Chrome", "Application", "chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft", "Edge", "Application", "msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft", "Edge", "Application", "msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Microsoft", "Edge", "Application", "msedge.exe")
            };
            foreach (string path in paths) if (File.Exists(path)) return path;
            return null;
        }
    }
}
