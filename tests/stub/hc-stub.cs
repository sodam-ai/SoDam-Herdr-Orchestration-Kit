// hc-stub.cs - a FAKE `hc` for tests/functions.test.mjs. It never touches Herdr.
// Every call is appended to %FAKE_HC_DIR%\calls.log (one line = the arguments). It answers from canned files in that folder:
//   ls ...        -> ls.json            get <addr> ... -> get-<addr>.json      read <addr> ... -> read-<addr>.txt
//   keys ...      -> prints nothing, exit 0 (only recorded)
//   events ...    -> waits 20 s, prints nothing (so a watcher sees a quiet event stream)
//   anything else (send, kill, run, label, server, ...) -> recorded as "UNSUPPORTED ..." and exit 4. Nothing is ever sent anywhere.
// Built by the test with the .NET Framework compiler that ships with Windows (csc.exe) - no packages.
using System;
using System.IO;
using System.Threading;

class HcStub
{
    static int Main(string[] a)
    {
        string dir = Environment.GetEnvironmentVariable("FAKE_HC_DIR");
        if (string.IsNullOrEmpty(dir)) { Console.Error.WriteLine("hc-stub: FAKE_HC_DIR is not set"); return 3; }
        Directory.CreateDirectory(dir);
        string cmd = a.Length > 0 ? a[0] : "";
        bool known = cmd == "ls" || cmd == "get" || cmd == "read" || cmd == "keys" || cmd == "events";
        Log(dir, (known ? "" : "UNSUPPORTED ") + string.Join(" ", a));
        if (cmd == "ls") return Send(dir, "ls.json");
        if (cmd == "get" && a.Length >= 2) return Send(dir, "get-" + a[1] + ".json");
        if (cmd == "read" && a.Length >= 2) return Send(dir, "read-" + a[1] + ".txt");
        if (cmd == "keys") return 0;
        if (cmd == "events") { Thread.Sleep(20000); return 0; }
        return 4;
    }

    static void Log(string dir, string line)
    {
        string f = Path.Combine(dir, "calls.log");
        for (int i = 0; i < 5; i++)
        {
            try { File.AppendAllText(f, line + "\n"); return; } catch (IOException) { Thread.Sleep(20); }
        }
    }

    static int Send(string dir, string name)
    {
        string f = Path.Combine(dir, name);
        if (!File.Exists(f)) { Console.Error.WriteLine("hc-stub: no canned answer " + name); return 1; }
        byte[] b = File.ReadAllBytes(f);
        using (Stream o = Console.OpenStandardOutput()) { o.Write(b, 0, b.Length); o.Flush(); }
        return 0;
    }
}
