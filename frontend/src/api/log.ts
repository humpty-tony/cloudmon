// Persistent logger. A WebView2 renderer crash goes blank and takes the console
// with it, so we forward breadcrumbs to the Go backend, which appends them to
// cloudmon.log (next to the exe). In the browser preview the sink is a no-op and
// everything still lands in the devtools console.

type Level = "info" | "warn" | "error";

interface WailsApp {
  go?: { main?: { App?: { Log?: (level: string, msg: string) => Promise<void> } } };
}

function sink(level: Level, msg: string) {
  const fn = (window as unknown as WailsApp).go?.main?.App?.Log;
  if (fn) {
    try {
      void fn(level, msg);
    } catch {
      /* logging must never throw */
    }
  }
}

export function logInfo(msg: string) {
  console.info("[cm]", msg);
  sink("info", msg);
}
export function logWarn(msg: string) {
  console.warn("[cm]", msg);
  sink("warn", msg);
}
export function logError(msg: string) {
  console.error("[cm]", msg);
  sink("error", msg);
}

let installed = false;
/** Route uncaught errors + rejections to the on-disk log. Call once at startup. */
export function installCrashLogging() {
  if (installed) return;
  installed = true;
  window.addEventListener("error", (e) => {
    logError(`window.onerror: ${e.message} @ ${e.filename}:${e.lineno}:${e.colno}\n${e.error?.stack || ""}`);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason as { stack?: string; message?: string } | undefined;
    logError(`unhandledrejection: ${r?.stack || r?.message || String(r)}`);
  });
  logInfo(`crash logging installed · ua=${navigator.userAgent}`);
}
