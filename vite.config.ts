import vinext from "vinext";
import { defineConfig, type Plugin } from "vite";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { sites } from "./build/sites-vite-plugin";

function progressSyncPlugin(): Plugin {
  return {
    name: "progress-sync-plugin",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const rawUrl = req.url || "";
        const pathname = rawUrl.split("?")[0];
        if (pathname !== "/api/progress" && pathname !== "/api/team-tasks") {
          return next();
        }

        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
        res.setHeader("Cache-Control", "no-store, max-age=0");

        if (req.method === "OPTIONS") {
          res.statusCode = 204;
          res.end();
          return;
        }

        const tasksPath = resolve(process.cwd(), "tasks.json");

        if (req.method === "GET") {
          try {
            const raw = await readFile(tasksPath, "utf-8");
            const data = JSON.parse(raw);
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: true, source: "tasks.json", data }));
          } catch (e) {
            const def = { version: 1, updatedAt: new Date().toISOString(), done: {}, notes: {}, cols: [], cells: {} };
            await writeFile(tasksPath, JSON.stringify(def, null, 2) + "\n", "utf-8").catch(() => {});
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: true, source: "tasks.json", data: def }));
          }
          return;
        }

        if (req.method === "POST") {
          const chunks: Buffer[] = [];
          req.on("data", chunk => chunks.push(Buffer.from(chunk)));
          req.on("end", async () => {
            try {
              const bodyStr = Buffer.concat(chunks).toString("utf-8");
              const body = JSON.parse(bodyStr || "{}");
              const cleanData = {
                version: 1,
                updatedAt: new Date().toISOString(),
                done: (typeof body.done === "object" && body.done !== null && !Array.isArray(body.done)) ? body.done : {},
                notes: (typeof body.notes === "object" && body.notes !== null && !Array.isArray(body.notes)) ? body.notes : {},
                cols: Array.isArray(body.cols) ? body.cols.filter((c: unknown) => typeof c === "string" && (c as string).trim()) : [],
                cells: (typeof body.cells === "object" && body.cells !== null && !Array.isArray(body.cells)) ? body.cells : {},
              };
              await writeFile(tasksPath, JSON.stringify(cleanData, null, 2) + "\n", "utf-8");
              res.statusCode = 200;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ ok: true, message: "Đã lưu vào tasks.json", updatedAt: cleanData.updatedAt, data: cleanData }));
            } catch (err) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ ok: false, error: "Dữ liệu JSON không hợp lệ." }));
            }
          });
          return;
        }

        next();
      });
    },
  };
}

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

export default defineConfig(async () => {
  return {
    cacheDir: process.env.NODE_ENV === "production" ? "node_modules/.vite-build" : "node_modules/.vite",
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      progressSyncPlugin(),
      vinext(),
      sites(),
    ],
  };
});
