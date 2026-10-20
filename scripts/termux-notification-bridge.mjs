import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const RUNTIME_FILE = ".rafiq-termux-reminders.json";
const MAX_BODY = 256 * 1024;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY) reject(new Error("body-too-large"));
    });
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error("invalid-json")); }
    });
    req.on("error", reject);
  });
}

function runNotification({ id, title, content }) {
  return new Promise((resolve, reject) => {
    // No shell: user/session text is passed as argv, not interpreted as commands.
    const child = spawn("termux-notification", [
      "--id", String(id),
      "--title", String(title),
      "--content", String(content),
      "--priority", "high",
      "--sound",
      "--vibrate", "250,120,250",
    ], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => { err += String(d); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(err.trim() || `termux-notification exited ${code}`)));
  });
}

function safeReminder(x) {
  if (!x || typeof x !== "object") return null;
  const at = Number(x.at);
  if (!Number.isFinite(at)) return null;
  return {
    id: String(x.id ?? "").slice(0, 160),
    at,
    title: String(x.title ?? "رفيق البكالوريا").slice(0, 160),
    content: String(x.content ?? "حان وقت الدراسة").slice(0, 600),
  };
}

export function termuxNotificationBridgePlugin() {
  let root = process.cwd();
  let file = join(root, RUNTIME_FILE);
  let state = { reminders: [], sent: [], updatedAt: null };
  let timer;
  let running = false;

  const load = () => {
    try {
      if (existsSync(file)) {
        const parsed = JSON.parse(readFileSync(file, "utf8"));
        state = {
          reminders: Array.isArray(parsed.reminders) ? parsed.reminders.map(safeReminder).filter(Boolean) : [],
          sent: Array.isArray(parsed.sent) ? parsed.sent.map(String).slice(-500) : [],
          updatedAt: parsed.updatedAt ?? null,
        };
      }
    } catch (e) { console.warn("[rafiq-termux] failed to load reminders", e); }
  };
  const save = () => {
    try { writeFileSync(file, JSON.stringify(state, null, 2), "utf8"); } catch (e) { console.warn("[rafiq-termux] failed to save reminders", e); }
  };
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const now = Date.now();
      const sent = new Set(state.sent);
      let changed = false;
      for (const r of state.reminders) {
        if (sent.has(r.id)) continue;
        // Send when due; tolerate up to 12h of Termux/server sleep, then discard stale reminders.
        if (r.at <= now && now - r.at <= 12 * 60 * 60 * 1000) {
          try {
            await runNotification(r);
            sent.add(r.id); changed = true;
            console.log(`[rafiq-termux] sent ${r.id}`);
          } catch (e) { console.warn(`[rafiq-termux] notification failed: ${e instanceof Error ? e.message : e}`); }
        } else if (now - r.at > 12 * 60 * 60 * 1000) { sent.add(r.id); changed = true; }
      }
      if (changed) { state.sent = [...sent].slice(-500); save(); }
    } finally { running = false; }
  };

  return {
    name: "rafiq:termux-notification-bridge",
    apply: "serve",
    configResolved(config) { root = config.root; file = join(root, RUNTIME_FILE); load(); },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = (req.url ?? "").split("?", 1)[0];
        if (!path.startsWith("/__rafiq/termux-notifications")) return next();
        try {
          if (path.endsWith("/status") && req.method === "GET") {
            return json(res, 200, { ok: true, bridge: true, reminders: state.reminders.length, sent: state.sent.length });
          }
          if (path.endsWith("/test") && req.method === "POST") {
            await runNotification({ id: `rafiq-test-${Date.now()}`, title: "رفيق البكالوريا", content: "اختبار الإشعار الخارجي من داخل رفيق ✅" });
            return json(res, 200, { ok: true });
          }
          if (path.endsWith("/sync") && req.method === "POST") {
            const body = await readBody(req);
            const reminders = Array.isArray(body.reminders) ? body.reminders.map(safeReminder).filter(Boolean) : [];
            state.reminders = reminders.slice(0, 500);
            state.updatedAt = new Date().toISOString();
            save();
            await tick();
            return json(res, 200, { ok: true, reminders: state.reminders.length });
          }
          return json(res, 404, { ok: false, error: "not-found" });
        } catch (e) {
          return json(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
        }
      });
      timer = setInterval(() => void tick(), 15000);
      timer.unref?.();
      void tick();
      server.httpServer?.once("close", () => { if (timer) clearInterval(timer); });
    },
  };
}
