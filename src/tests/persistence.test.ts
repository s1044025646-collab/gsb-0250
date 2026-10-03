import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { configureDatabasePath, getDatabase } from "../db.js";
import { decodeAndStore, encodeAndStore, getReportHydrated, queryReports } from "../service.js";

const DB_PATH = join("data", `test-${process.pid}.db`);

afterEach(() => {
  try {
    getDatabase(DB_PATH).close();
  } catch {
    // 已关闭
  }
  rmSync(DB_PATH, { force: true });
  rmSync(`${DB_PATH}-wal`, { force: true });
  rmSync(`${DB_PATH}-shm`, { force: true });
});

test("相同参数重复分析结果一致；修改单位时长产生新报告且旧快照不变", () => {
  configureDatabasePath(DB_PATH);
  const first = decodeAndStore(encodeAndStore("SOS 42", 100).segments, 100, 0.2);
  const second = decodeAndStore(
    getReportHydrated(first.id)!.rawSegments,
    100,
    0.2,
  );

  assert.deepEqual(
    JSON.parse(JSON.stringify(first, (key, value) => (key === "id" ? 0 : value))),
    JSON.parse(JSON.stringify(second, (key, value) => (key === "id" ? 0 : value))),
  );

  const changedUnit = decodeAndStore(
    getReportHydrated(first.id)!.rawSegments,
    50,
    0.2,
  );
  assert.equal(changedUnit.status, "failed");

  const old = getReportHydrated(first.id)! as {
    unit: number;
    result: { status: string; text: string };
  };
  assert.equal(old.unit, 100);
  assert.equal(old.result.status, "ok");
  assert.equal(old.result.text, "SOS 42");

  const reports = queryReports();
  assert.ok(reports.length >= 3);
});

test("重新打开数据库（模拟重启）后仍可读取原始段与诊断", () => {
  configureDatabasePath(DB_PATH);
  const segments = encodeAndStore("SOS", 100).segments;
  for (const segment of segments as Array<{ state: string; duration: number }>) {
    if (segment.state === "off" && segment.duration === 300) {
      segment.duration = 500;
      break;
    }
  }
  const failed = decodeAndStore(segments, 100, 0.2);
  const id = failed.id;

  getDatabase(DB_PATH).close();
  configureDatabasePath(DB_PATH);

  const reloaded = getReportHydrated(id)! as {
    rawSegments: unknown[];
    result: { status: string; issues: unknown[] };
  };
  assert.equal(reloaded.rawSegments.length, segments.length);
  assert.equal(reloaded.result.status, "failed");
  assert.ok(reloaded.result.issues.length >= 1);
});
