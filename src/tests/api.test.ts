import { after, test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { getDatabase } from "../db.js";
import { createApp } from "../api/server.js";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const DB_PATH = join("data", `api-test-${process.pid}.db`);
process.env.MORSE_DB_PATH = DB_PATH;

const server: Server = createApp();
await new Promise<void>((resolveReady) => server.listen(0, "127.0.0.1", resolveReady));
const port = (server.address() as AddressInfo).port;
const base = `http://127.0.0.1:${port}`;

after(async () => {
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  getDatabase(DB_PATH).close();
  rmSync(DB_PATH, { force: true });
  rmSync(`${DB_PATH}-wal`, { force: true });
  rmSync(`${DB_PATH}-shm`, { force: true });
});

test("HTTP: 健康检查、编码、解码、查询与导出闭环", async () => {
  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);

  const encoded = (await fetch(`${base}/api/encode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "SOS", unit: 100 }),
  }).then((response) => response.json())) as { text: string; segments: unknown[]; id: number };
  assert.equal(encoded.text, "SOS");

  const decoded = (await fetch(`${base}/api/decode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ segments: encoded.segments, unit: 100, tolerance: 0.2 }),
  }).then((response) => response.json())) as { status: string; text: string; id: number };
  assert.equal(decoded.status, "ok");
  assert.equal(decoded.text, "SOS");

  const list = (await fetch(`${base}/api/reports?kind=decode`).then((response) =>
    response.json(),
  )) as { reports: unknown[] };
  assert.ok(list.reports.length >= 1);

  const detail = (await fetch(`${base}/api/reports/${decoded.id}`).then((response) =>
    response.json(),
  )) as { result: { text: string } };
  assert.equal(detail.result.text, "SOS");

  const exported = await fetch(`${base}/api/reports/${decoded.id}/export`);
  assert.match(exported.headers.get("Content-Type") ?? "", /application\/json/);
  const exportedBody = JSON.parse(await exported.text()) as { id: number };
  assert.equal(exportedBody.id, decoded.id);
});

test("HTTP: 参数错误返回 400 与错误码", async () => {
  const response = await fetch(`${base}/api/encode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "", unit: 100 }),
  });
  assert.equal(response.status, 400);
  const body = (await response.json()) as { code: string };
  assert.equal(body.code, "EMPTY_TEXT");
});
