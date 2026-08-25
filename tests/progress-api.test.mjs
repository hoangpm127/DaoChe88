import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { GET, POST, OPTIONS } from "../app/api/progress/route.ts";

test("progress API integration test", async (t) => {
  const tasksPath = resolve(process.cwd(), "tasks.json");
  const originalBackup = await readFile(tasksPath, "utf-8").catch(() => null);

  t.after(async () => {
    if (originalBackup !== null) {
      await writeFile(tasksPath, originalBackup, "utf-8");
    }
  });

  await t.test("OPTIONS returns 204 with CORS headers", async () => {
    const res = await OPTIONS();
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    assert.ok(res.headers.get("access-control-allow-methods")?.includes("GET"));
    assert.ok(res.headers.get("access-control-allow-methods")?.includes("POST"));
  });

  await t.test("GET returns tasks.json content successfully", async () => {
    const res = await GET();
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.ok(body.data);
    assert.equal(typeof body.data.done, "object");
  });

  await t.test("POST updates tasks.json on disk", async () => {
    const payload = {
      done: { M0: "2026-08-16" },
      notes: { M0: "Đang triển khai module 0" },
      cols: ["Người phụ trách", "Ghi chú thêm"],
      cells: { "M0::Người phụ trách": "Dev A" },
    };

    const req = new Request("http://localhost:3000/api/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const res = await POST(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.data.done.M0, "2026-08-16");

    // Verify on disk
    const diskContent = JSON.parse(await readFile(tasksPath, "utf-8"));
    assert.equal(diskContent.done.M0, "2026-08-16");
    assert.equal(diskContent.notes.M0, "Đang triển khai module 0");
    assert.deepEqual(diskContent.cols, ["Người phụ trách", "Ghi chú thêm"]);
    assert.equal(diskContent.cells["M0::Người phụ trách"], "Dev A");
  });
});
