"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface LogEntry {
  id: number;
  time: string;
  type: "error" | "warn" | "log" | "info";
  message: string;
}

let nextId = 0;

export function DebugConsole() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "error" | "warn" | "log">("all");
  const bottomRef = useRef<HTMLDivElement>(null);

  const addLog = useCallback((type: LogEntry["type"], message: string) => {
    const time = new Date().toLocaleTimeString("tr-TR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
    });
    setLogs((prev) => [...prev.slice(-200), { id: nextId++, time, type, message }]);
  }, []);

  // Check admin status
  useEffect(() => {
    if (!document.cookie.includes("session")) return;
    fetch("/api/auth/me")
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json();
          if (data.user?.isAdmin) {
            setIsAdmin(true);
          }
        }
      })
      .catch(() => {});
  }, []);

  // Intercept all console methods + global errors
  useEffect(() => {
    if (!isAdmin) return;

    const origLog = console.log;
    const origInfo = console.info;
    const origWarn = console.warn;
    const origError = console.error;

    const stringify = (args: unknown[]) =>
      args
        .map((a) => {
          if (a instanceof Error) return `${a.message}\n${a.stack || ""}`;
          if (typeof a === "object" && a !== null) {
            try { return JSON.stringify(a, null, 2); } catch { return String(a); }
          }
          return String(a);
        })
        .join(" ");

    console.log = (...args: unknown[]) => {
      addLog("log", stringify(args));
      origLog.apply(console, args);
    };
    console.info = (...args: unknown[]) => {
      addLog("info", stringify(args));
      origInfo.apply(console, args);
    };
    console.warn = (...args: unknown[]) => {
      addLog("warn", stringify(args));
      origWarn.apply(console, args);
    };
    console.error = (...args: unknown[]) => {
      addLog("error", stringify(args));
      origError.apply(console, args);
    };

    const handleError = (e: ErrorEvent) => {
      addLog("error", `${e.message}\n  at ${e.filename}:${e.lineno}:${e.colno}`);
    };
    const handleRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason;
      const msg = reason instanceof Error ? `${reason.message}\n${reason.stack || ""}` : String(reason);
      addLog("error", `Unhandled Promise: ${msg}`);
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);

    addLog("info", "Console active");

    return () => {
      console.log = origLog;
      console.info = origInfo;
      console.warn = origWarn;
      console.error = origError;
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, [isAdmin, addLog]);

  // Auto-scroll
  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, open]);

  if (!isAdmin) return null;

  const errorCount = logs.filter((l) => l.type === "error").length;
  const warnCount = logs.filter((l) => l.type === "warn").length;
  const filtered = filter === "all" ? logs : logs.filter((l) => l.type === filter);

  const typeColor = (type: LogEntry["type"]) => {
    switch (type) {
      case "error": return "text-red-400";
      case "warn": return "text-yellow-400";
      case "info": return "text-blue-400";
      default: return "text-gray-300";
    }
  };

  const typeBg = (type: LogEntry["type"]) => {
    switch (type) {
      case "error": return "border-l-red-500/50";
      case "warn": return "border-l-yellow-500/50";
      case "info": return "border-l-blue-500/50";
      default: return "border-l-gray-600/50";
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-[9999] h-11 px-3 rounded-full flex items-center gap-2 shadow-lg border border-gray-700"
        style={{ background: "#1a1a2e", fontSize: "12px", fontFamily: "monospace" }}
      >
        <span style={{ color: "#4ade80" }}>&gt;_</span>
        {errorCount > 0 && (
          <span className="bg-red-500 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
            {errorCount}
          </span>
        )}
        {warnCount > 0 && errorCount === 0 && (
          <span className="bg-yellow-500 text-black text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
            {warnCount}
          </span>
        )}
        {errorCount === 0 && warnCount === 0 && (
          <span style={{ color: "#9ca3af" }}>{logs.length}</span>
        )}
      </button>
    );
  }

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[9999] flex flex-col"
      style={{
        height: "45vh",
        background: "#0d1117",
        borderTop: "1px solid #30363d",
        fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
        fontSize: "12px",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 shrink-0"
        style={{ height: "36px", background: "#161b22", borderBottom: "1px solid #30363d" }}
      >
        <div className="flex items-center gap-3">
          <span style={{ color: "#4ade80", fontWeight: 700 }}>CONSOLE</span>
          <div className="flex gap-1">
            {(["all", "error", "warn", "log"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className="px-2 py-0.5 rounded text-[10px] uppercase"
                style={{
                  background: filter === f ? "#30363d" : "transparent",
                  color: filter === f ? "#e6edf3" : "#8b949e",
                }}
              >
                {f}
                {f === "error" && errorCount > 0 && (
                  <span className="ml-1 text-red-400">{errorCount}</span>
                )}
                {f === "warn" && warnCount > 0 && (
                  <span className="ml-1 text-yellow-400">{warnCount}</span>
                )}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setLogs([])} style={{ color: "#8b949e" }} className="hover:text-white px-2">
            Clear
          </button>
          <button onClick={() => setOpen(false)} style={{ color: "#8b949e" }} className="hover:text-white px-2">
            ✕
          </button>
        </div>
      </div>

      {/* Log entries */}
      <div className="flex-1 overflow-auto p-1" style={{ WebkitOverflowScrolling: "touch" }}>
        {filtered.length === 0 && (
          <p className="text-center py-8" style={{ color: "#484f58" }}>
            {filter === "all" ? "No logs yet..." : `No ${filter} logs`}
          </p>
        )}
        {filtered.map((log) => (
          <div
            key={log.id}
            className={`border-l-2 ${typeBg(log.type)} pl-2 py-1 mx-1 hover:bg-white/[0.02]`}
            style={{ borderBottom: "1px solid #21262d" }}
          >
            <span style={{ color: "#484f58" }}>{log.time}</span>{" "}
            <span className={typeColor(log.type)} style={{ fontWeight: 600 }}>
              {log.type === "info" ? "INF" : log.type.toUpperCase().slice(0, 3)}
            </span>{" "}
            <span className="whitespace-pre-wrap break-all" style={{ color: "#e6edf3" }}>
              {log.message}
            </span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
