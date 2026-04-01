"use client";

import { useState, useEffect, useCallback } from "react";

interface LogEntry {
  time: string;
  type: "error" | "warn" | "log";
  message: string;
}

export function DebugConsole() {
  const [visible, setVisible] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [minimized, setMinimized] = useState(true);

  const addLog = useCallback((type: LogEntry["type"], message: string) => {
    const time = new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setLogs((prev) => [...prev.slice(-50), { time, type, message }]);
  }, []);

  useEffect(() => {
    // Only check if a session cookie exists (avoids API call for anonymous visitors)
    if (!document.cookie.includes("session")) return;
    fetch("/api/auth/me")
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json();
          if (data.user?.isAdmin) {
            setIsAdmin(true);
            setVisible(true);
          }
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!isAdmin) return;

    const origError = console.error;
    const origWarn = console.warn;

    console.error = (...args: unknown[]) => {
      addLog("error", args.map((a) => (typeof a === "object" ? JSON.stringify(a, null, 2) : String(a))).join(" "));
      origError.apply(console, args);
    };

    console.warn = (...args: unknown[]) => {
      addLog("warn", args.map((a) => (typeof a === "object" ? JSON.stringify(a, null, 2) : String(a))).join(" "));
      origWarn.apply(console, args);
    };

    const handleError = (event: ErrorEvent) => {
      addLog("error", `${event.message}\n  at ${event.filename}:${event.lineno}:${event.colno}`);
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const msg = reason instanceof Error
        ? `${reason.message}\n${reason.stack || ""}`
        : String(reason);
      addLog("error", `Unhandled Promise: ${msg}`);
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    addLog("log", "Debug console active");

    return () => {
      console.error = origError;
      console.warn = origWarn;
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, [isAdmin, addLog]);

  if (!visible) return null;

  if (minimized) {
    return (
      <button
        onClick={() => setMinimized(false)}
        className="fixed bottom-4 right-4 z-[9999] w-10 h-10 rounded-full bg-red-600 text-white text-xs font-bold flex items-center justify-center shadow-lg"
        style={{ fontSize: "10px" }}
      >
        {logs.filter((l) => l.type === "error").length || "0"}
      </button>
    );
  }

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-[9999] bg-black/95 text-white font-mono text-xs"
      style={{ maxHeight: "50vh", display: "flex", flexDirection: "column" }}
    >
      <div className="flex items-center justify-between px-3 py-2 bg-gray-900 border-b border-gray-700 shrink-0">
        <span className="text-green-400 font-bold">DEBUG CONSOLE</span>
        <div className="flex gap-2">
          <button onClick={() => setLogs([])} className="text-gray-400 hover:text-white px-2">Clear</button>
          <button onClick={() => setMinimized(true)} className="text-gray-400 hover:text-white px-2">_</button>
          <button onClick={() => setVisible(false)} className="text-gray-400 hover:text-white px-2">X</button>
        </div>
      </div>
      <div className="overflow-auto flex-1 p-2 space-y-1" style={{ WebkitOverflowScrolling: "touch" }}>
        {logs.length === 0 && <p className="text-gray-500">No logs yet...</p>}
        {logs.map((log, i) => (
          <div
            key={i}
            className={`whitespace-pre-wrap break-all leading-snug py-0.5 border-b border-gray-800 ${
              log.type === "error" ? "text-red-400" : log.type === "warn" ? "text-yellow-400" : "text-gray-300"
            }`}
          >
            <span className="text-gray-600">{log.time}</span>{" "}
            <span className={log.type === "error" ? "text-red-500" : log.type === "warn" ? "text-yellow-500" : "text-blue-400"}>
              [{log.type.toUpperCase()}]
            </span>{" "}
            {log.message}
          </div>
        ))}
      </div>
    </div>
  );
}
