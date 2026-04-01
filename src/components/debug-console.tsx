"use client";

import { useEffect } from "react";

/**
 * Debug console that survives React crashes.
 * Mounts a vanilla DOM element outside React's tree so it persists
 * even when Next.js replaces the page with an error boundary.
 */
export function DebugConsole() {
  useEffect(() => {
    // Only init once
    if (document.getElementById("__debug_console")) return;

    fetch("/api/auth/me")
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json();
        const email = data.user?.email?.toLowerCase();
        if (data.user?.isAdmin || email === "muhammedtarikucar@gmail.com") {
          mountConsole();
        }
      })
      .catch(() => {});
  }, []);

  return null;
}

function mountConsole() {
  // Create root element OUTSIDE React root, directly on <body>
  const root = document.createElement("div");
  root.id = "__debug_console";
  root.style.cssText = "position:fixed;bottom:0;right:0;z-index:99999;font-family:'JetBrains Mono','SF Mono','Fira Code',monospace;font-size:12px;";
  document.body.appendChild(root);

  let logs: { id: number; time: string; type: string; msg: string }[] = [];
  let nextId = 0;
  let isOpen = false;
  let filter = "all";

  function addLog(type: string, msg: string) {
    const time = new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    logs.push({ id: nextId++, time, type, msg });
    if (logs.length > 300) logs = logs.slice(-300);
    render();
  }

  // Intercept console
  const orig = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };

  function stringify(args: unknown[]) {
    return args.map((a) => {
      if (a instanceof Error) return `${a.message}\n${a.stack || ""}`;
      if (typeof a === "object" && a !== null) {
        try { return JSON.stringify(a, null, 2); } catch { return String(a); }
      }
      return String(a);
    }).join(" ");
  }

  console.log = (...args: unknown[]) => { addLog("log", stringify(args)); orig.log(...args); };
  console.info = (...args: unknown[]) => { addLog("info", stringify(args)); orig.info(...args); };
  console.warn = (...args: unknown[]) => { addLog("warn", stringify(args)); orig.warn(...args); };
  console.error = (...args: unknown[]) => { addLog("error", stringify(args)); orig.error(...args); };

  window.addEventListener("error", (e) => {
    addLog("error", `${e.message}\n  at ${e.filename}:${e.lineno}:${e.colno}`);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    addLog("error", `Unhandled: ${r instanceof Error ? `${r.message}\n${r.stack}` : String(r)}`);
  });

  const C = {
    bg: "#0d1117",
    headerBg: "#161b22",
    border: "#30363d",
    text: "#e6edf3",
    muted: "#484f58",
    dimmed: "#8b949e",
    green: "#4ade80",
    red: "#f87171",
    yellow: "#fbbf24",
    blue: "#60a5fa",
  };

  function typeColor(t: string) {
    if (t === "error") return C.red;
    if (t === "warn") return C.yellow;
    if (t === "info") return C.blue;
    return "#d1d5db";
  }

  function typeBorder(t: string) {
    if (t === "error") return C.red;
    if (t === "warn") return C.yellow;
    if (t === "info") return C.blue;
    return "#4b5563";
  }

  function render() {
    const errCount = logs.filter((l) => l.type === "error").length;
    const warnCount = logs.filter((l) => l.type === "warn").length;
    const filtered = filter === "all" ? logs : logs.filter((l) => l.type === filter);

    if (!isOpen) {
      // Minimized button
      let badge = `<span style="color:${C.dimmed}">${logs.length}</span>`;
      if (errCount > 0) badge = `<span style="background:${C.red};color:#fff;border-radius:50%;width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:700">${errCount}</span>`;
      else if (warnCount > 0) badge = `<span style="background:${C.yellow};color:#000;border-radius:50%;width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:700">${warnCount}</span>`;

      root.style.cssText = "position:fixed;bottom:16px;right:16px;z-index:99999;font-family:'JetBrains Mono','SF Mono',monospace;font-size:12px;";
      root.innerHTML = `<button id="__dc_open" style="background:${C.bg};border:1px solid ${C.border};border-radius:9999px;height:44px;padding:0 12px;display:flex;align-items:center;gap:8px;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,0.4)">
        <span style="color:${C.green}">&gt;_</span>${badge}
      </button>`;
      document.getElementById("__dc_open")!.onclick = () => { isOpen = true; render(); };
      return;
    }

    // Full console
    const filterBtn = (f: string, label: string, count?: number) => {
      const active = filter === f;
      const countHtml = count ? `<span style="color:${f === "error" ? C.red : C.yellow};margin-left:4px">${count}</span>` : "";
      return `<button class="__dc_filter" data-f="${f}" style="padding:2px 8px;border-radius:4px;border:none;cursor:pointer;font-size:10px;text-transform:uppercase;font-family:inherit;background:${active ? C.border : "transparent"};color:${active ? C.text : C.dimmed}">${label}${countHtml}</button>`;
    };

    let logsHtml = "";
    if (filtered.length === 0) {
      logsHtml = `<p style="text-align:center;padding:32px;color:${C.muted}">${filter === "all" ? "No logs yet..." : `No ${filter} logs`}</p>`;
    } else {
      for (const log of filtered) {
        const label = log.type === "info" ? "INF" : log.type.toUpperCase().slice(0, 3);
        logsHtml += `<div style="border-left:2px solid ${typeBorder(log.type)};padding:4px 0 4px 8px;margin:0 4px;border-bottom:1px solid #21262d">
          <span style="color:${C.muted}">${log.time}</span>
          <span style="color:${typeColor(log.type)};font-weight:600"> ${label}</span>
          <span style="color:${C.text};white-space:pre-wrap;word-break:break-all"> ${escapeHtml(log.msg)}</span>
        </div>`;
      }
    }

    root.style.cssText = "position:fixed;inset:0 0 0 0;z-index:99999;font-family:'JetBrains Mono','SF Mono',monospace;font-size:12px;display:flex;flex-direction:column;pointer-events:none;";
    root.innerHTML = `
      <div style="flex:1" id="__dc_overlay"></div>
      <div style="height:45vh;min-height:200px;background:${C.bg};border-top:1px solid ${C.border};display:flex;flex-direction:column;pointer-events:auto">
        <div style="height:36px;background:${C.headerBg};border-bottom:1px solid ${C.border};display:flex;align-items:center;justify-content:space-between;padding:0 12px;flex-shrink:0">
          <div style="display:flex;align-items:center;gap:12px">
            <span style="color:${C.green};font-weight:700">CONSOLE</span>
            <div style="display:flex;gap:4px">
              ${filterBtn("all", "All")}
              ${filterBtn("error", "Err", errCount || undefined)}
              ${filterBtn("warn", "Wrn", warnCount || undefined)}
              ${filterBtn("log", "Log")}
            </div>
          </div>
          <div style="display:flex;gap:4px">
            <button id="__dc_clear" style="color:${C.dimmed};background:none;border:none;cursor:pointer;padding:4px 8px;font-family:inherit;font-size:12px">Clear</button>
            <button id="__dc_close" style="color:${C.dimmed};background:none;border:none;cursor:pointer;padding:4px 8px;font-size:14px">✕</button>
          </div>
        </div>
        <div id="__dc_logs" style="flex:1;overflow:auto;padding:4px 0;-webkit-overflow-scrolling:touch">${logsHtml}</div>
      </div>`;

    // Event listeners
    document.getElementById("__dc_close")!.onclick = () => { isOpen = false; render(); };
    document.getElementById("__dc_clear")!.onclick = () => { logs = []; render(); };
    document.getElementById("__dc_overlay")!.onclick = () => { isOpen = false; render(); };
    document.querySelectorAll(".__dc_filter").forEach((btn) => {
      (btn as HTMLElement).onclick = () => { filter = (btn as HTMLElement).dataset.f!; render(); };
    });

    // Auto-scroll to bottom
    const logsEl = document.getElementById("__dc_logs")!;
    logsEl.scrollTop = logsEl.scrollHeight;
  }

  function escapeHtml(s: string) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  addLog("info", "Debug console active");
}
