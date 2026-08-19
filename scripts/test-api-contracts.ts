import assert from "node:assert";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Static contract check between the client and the App Router API.
 *
 * A `fetch("/api/…", { method: "POST" })` against a route.ts that only exports
 * PATCH does not fail at build time or under `tsc` — it fails in the browser
 * with a 405 the first time a real user clicks the button. This walks every
 * literal fetch call in the app and asserts the target route actually exports
 * the method being used.
 *
 * Dynamic URLs (`/api/painter/orders/${id}/accept`) are supported: an
 * interpolated segment matches a `[param]` directory.
 */

const ROOT = join(import.meta.dirname, "..");
const API_ROOT = join(ROOT, "src/app/api");
const SCAN_DIRS = [join(ROOT, "src/app"), join(ROOT, "src/components")];
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

interface Call {
  file: string;
  line: number;
  url: string;
  method: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Collect `fetch("/api/…", { method })` calls. The method is read from the
 * init object that follows the URL, bounded by the next `fetch(` so a
 * neighbouring call's method is never attributed to this one.
 */
function collectCalls(file: string): Call[] {
  const src = readFileSync(file, "utf8");
  const calls: Call[] = [];
  const re = /fetch\(\s*[`"'](\/api\/[^`"']*)[`"']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const rest = src.slice(m.index + m[0].length);
    const nextFetch = rest.indexOf("fetch(");
    const window = rest.slice(0, nextFetch === -1 ? 600 : Math.min(nextFetch, 600));
    const methodMatch = window.match(/method:\s*["'](\w+)["']/);
    calls.push({
      file: relative(ROOT, file),
      line: src.slice(0, m.index).split("\n").length,
      url: m[1],
      method: (methodMatch?.[1] ?? "GET").toUpperCase(),
    });
  }
  return calls;
}

function subdirs(dir: string): string[] {
  try {
    return readdirSync(dir).filter((e) => statSync(join(dir, e)).isDirectory());
  } catch {
    return [];
  }
}

function routeFileIn(dir: string): string | null {
  const route = join(dir, "route.ts");
  try {
    statSync(route);
    return route;
  } catch {
    return null;
  }
}

/**
 * Resolve a URL path to every route.ts it could hit. An interpolated segment
 * standing in for an id (`${order.id}`) resolves to the `[param]` dir; one
 * standing in for a verb (`.../${action}`) fans out to every literal sibling,
 * and the caller treats that as unverifiable rather than guessing.
 */
function resolveRoutes(urlPath: string): string[] {
  const q = urlPath.indexOf("?");
  const segments = (q === -1 ? urlPath : urlPath.slice(0, q))
    .split("/")
    .filter(Boolean)
    .slice(1); // drop the leading "api"

  let dirs = [API_ROOT];
  for (const segment of segments) {
    const next: string[] = [];
    for (const dir of dirs) {
      const entries = subdirs(dir);
      if (segment.includes("${")) {
        // Could be an id (matches `[param]`) or a verb (matches a literal dir).
        for (const e of entries) next.push(join(dir, e));
      } else {
        const literal = entries.find((e) => e === segment);
        const param = entries.find((e) => e.startsWith("[") && e.endsWith("]"));
        const hit = literal ?? param;
        if (hit) next.push(join(dir, hit));
      }
    }
    dirs = next;
    if (dirs.length === 0) return [];
  }

  return dirs.map(routeFileIn).filter((r): r is string => r !== null);
}

function exportedMethods(routeFile: string): string[] {
  const src = readFileSync(routeFile, "utf8");
  return HTTP_METHODS.filter((verb) =>
    new RegExp(`export\\s+(async\\s+function|function|const)\\s+${verb}\\b`).test(src)
  );
}

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const files = SCAN_DIRS.flatMap((d) => walk(d));
const calls = files.flatMap(collectCalls);

check("found API calls to check", () => {
  assert.ok(calls.length > 50, `only found ${calls.length} fetch calls — the scanner is broken`);
});

const unresolved: Call[] = [];
const ambiguous: Call[] = [];
const mismatched: (Call & { exports: string[] })[] = [];

for (const call of calls) {
  const routeFiles = resolveRoutes(call.url);
  if (routeFiles.length === 0) {
    unresolved.push(call);
    continue;
  }
  if (routeFiles.length > 1) {
    // A `/${action}` tail — which sibling route runs depends on a runtime value.
    ambiguous.push(call);
    continue;
  }
  const methods = exportedMethods(routeFiles[0]);
  if (!methods.includes(call.method)) {
    mismatched.push({ ...call, exports: methods });
  }
}

check("every fetched /api path has a route.ts", () => {
  const detail = unresolved
    .map((c) => `    ${c.file}:${c.line} → ${c.method} ${c.url}`)
    .join("\n");
  assert.strictEqual(unresolved.length, 0, `\n  Unroutable API calls (404):\n${detail}\n`);
});

check("every fetch method is exported by its route handler", () => {
  const detail = mismatched
    .map(
      (c) =>
        `    ${c.file}:${c.line} → ${c.method} ${c.url}  (route exports: ${
          c.exports.join(", ") || "nothing"
        })`
    )
    .join("\n");
  assert.strictEqual(mismatched.length, 0, `\n  Method mismatches (405):\n${detail}\n`);
});

console.log(
  `\n✅ api-contracts: ${passed} checks passed ` +
    `(${calls.length - ambiguous.length} fetch calls verified, ` +
    `${ambiguous.length} skipped — runtime-chosen route segment)`
);
