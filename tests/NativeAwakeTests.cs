using System;
using System.Collections.Generic;
using System.Threading;
using ZNote.NativeHost;

internal static class NativeAwakeTests
{
    private static int count;
    private static void Check(bool value, string description)
    {
        if (!value) throw new Exception(description);
        count++;
    }
    private static int Main()
    {
        try
        {
            List<uint> calls = new List<uint>();
            bool fail = false;
            using (AwakeSession session = new AwakeSession(delegate(uint flags) {
                calls.Add(flags); return fail ? 0 : Native.Continuous;
            }))
            {
                Check(!session.Active, "Initially off");
                fail = true;
                Check(!session.Start() && !session.Active, "Failed acquisition remains off");
                fail = false;
                Check(session.Start() && session.Active, "Start enables request");
                int before = calls.Count;
                Check(session.Start() && calls.Count == before, "Repeated start is idempotent");
                Check(calls[calls.Count - 1] == 0x80000003, "Exact display/system continuous flags");
                fail = true;
                Check(!session.Stop() && session.Active, "Failed release remains active");
                fail = false;
                Check(session.Stop() && !session.Active, "Successful release disables request");
                Check(calls[calls.Count - 1] == 0x80000000, "Release clears only this thread's request");
                before = calls.Count;
                Check(session.Stop() && calls.Count == before, "Repeated stop is idempotent");
                bool rejected = false;
                Thread other = new Thread(delegate() {
                    try { session.Start(); } catch (InvalidOperationException) { rejected = true; }
                });
                other.Start(); other.Join();
                Check(rejected, "Cross-thread power operations are rejected");
            }
            Exception nativeError = null;
            Thread owner = new Thread(delegate() {
                try
                {
                    Native.SetThreadExecutionState(Native.Continuous);
                    using (AwakeSession session = new AwakeSession())
                    {
                        Check(session.Start(), "Real Windows acquisition succeeds");
                        uint previous = Native.SetThreadExecutionState(Native.Required);
                        Check((previous & 3) == 3, "Windows retained display and system requests");
                        Check(session.Stop(), "Real Windows release succeeds");
                        previous = Native.SetThreadExecutionState(Native.Continuous);
                        Check((previous & 3) == 0, "Windows request flags are cleared");
                    }
                }
                catch (Exception e) { nativeError = e; }
                finally { Native.SetThreadExecutionState(Native.Continuous); }
            });
            owner.Start(); owner.Join();
            if (nativeError != null) throw nativeError;
            Console.WriteLine("Passed " + count + " native power/lifecycle assertions.");
            return 0;
        }
        catch (Exception e) { Console.Error.WriteLine(e); return 1; }
    }
}
