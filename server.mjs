import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";

const PORT = 3300;
const ROOT = process.cwd();

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store, max-age=0");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/api/progress" || url.pathname === "/api/team-tasks") {
    const tasksFile = path.join(ROOT, "tasks.json");
    if (req.method === "GET") {
      try {
        const raw = fs.readFileSync(tasksFile, "utf-8");
        const data = JSON.parse(raw);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, source: "tasks.json", data }));
      } catch (e) {
        const def = { version: 1, updatedAt: new Date().toISOString(), done: {}, notes: {}, cols: [], cells: {} };
        fs.writeFileSync(tasksFile, JSON.stringify(def, null, 2) + "\n", "utf-8");
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, source: "tasks.json", data: def }));
      }
      return;
    }
    if (req.method === "POST") {
      let body = "";
      req.on("data", chunk => { body += chunk; });
      req.on("end", () => {
        try {
          const parsed = JSON.parse(body || "{}");
          const clean = {
            version: 1,
            updatedAt: new Date().toISOString(),
            done: parsed.done || {},
            notes: parsed.notes || {},
            cols: Array.isArray(parsed.cols) ? parsed.cols : [],
            cells: parsed.cells || {}
          };
          fs.writeFileSync(tasksFile, JSON.stringify(clean, null, 2) + "\n", "utf-8");
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: true, message: "Đã lưu vào tasks.json", updatedAt: clean.updatedAt, data: clean }));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: false, error: "JSON không hợp lệ" }));
        }
      });
      return;
    }
  }

  // Phục vụ trực tiếp progress.html
  const htmlFile = path.join(ROOT, "progress.html");
  if (fs.existsSync(htmlFile)) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(fs.readFileSync(htmlFile));
    return;
  }

  res.writeHead(404);
  res.end("Not Found");
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Bảng theo dõi tiến độ Tào Phớ 88 đã sẵn sàng!`);
  console.log(`🌐 Mở trình duyệt tại: http://localhost:${PORT}`);
  console.log(`📂 Dữ liệu tự động lưu vào: ${path.join(ROOT, "tasks.json")}`);
  console.log(`======================================================\n`);
  const openCmd = process.platform === "win32" ? `start http://localhost:${PORT}` : `open http://localhost:${PORT}`;
  exec(openCmd, () => {});
});
