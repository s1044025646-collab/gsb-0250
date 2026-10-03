import { test } from "node:test";
import assert from "node:assert/strict";
import { handleEncode, handleDecode } from "../src/api.ts";
import { getReport, listReports } from "../src/db.ts";

test("encode API 成功并保存报告", () => {
  const r = handleEncode({ text: "SOS", unitMs: 100 });
  assert.equal(r.status, 200);
  const body = r.body as { id: number; text: string; segments: unknown[] };
  assert.equal(body.text, "SOS");
  assert.ok(body.id > 0);
  const row = getReport(body.id);
  assert.equal(row?.kind, "encode");
  assert.deepEqual(row?.params, { unitMs: 100 });
});

test("encode API 错误码", () => {
  const r = handleEncode({ text: "ABC!", unitMs: 100 });
  assert.equal(r.status, 400);
  assert.equal((r.body as { error: { code: string } }).error.code, "INVALID_CHARACTER");
});

test("decode API 成功、失败与持久化快照", () => {
  const enc = handleEncode({ text: "M2 K9", unitMs: 100 });
  const segs = (enc.body as { segments: unknown[] }).segments;
  const ok = handleDecode({ segments: segs, unitMs: 100, tolerance: 0.1 });
  assert.equal(ok.status, 200);
  const okBody = ok.body as { id: number; ok: boolean; text: string };
  assert.ok(okBody.ok);
  assert.equal(okBody.text, "M2 K9");

  // 重新分析产生新报告 id
  const again = handleDecode({ segments: segs, unitMs: 100, tolerance: 0.1 });
  const againId = (again.body as { id: number }).id;
  assert.ok(againId > okBody.id);

  // 修改单位时长不影响旧报告
  handleDecode({ segments: segs, unitMs: 200, tolerance: 0.1 });
  const old = getReport(okBody.id);
  assert.deepEqual(old?.params, { unitMs: 100, tolerance: 0.1 });
  assert.equal((old?.result as { text: string }).text, "M2 K9");
  // 原始段完整保存
  assert.equal((old?.input as { segments: unknown[] }).segments.length, segs.length);

  // 超容差：HTTP 200 但报告 ok=false
  const bad = (segs as { state: string; duration: number }[]).map((s) => ({ ...s }));
  bad[0].duration = bad[0].duration * 3;
  const fail = handleDecode({ segments: bad, unitMs: 100, tolerance: 0.1 });
  assert.equal(fail.status, 200);
  assert.equal((fail.body as { ok: boolean }).ok, false);
});

test("decode API 参数错误码", () => {
  const r = handleDecode({ segments: [{ state: "on", duration: 1 }], unitMs: 100, tolerance: 0.5 });
  assert.equal(r.status, 400);
  assert.equal((r.body as { error: { code: string } }).error.code, "INVALID_TOLERANCE");
});

test("报告列表按时间倒序", () => {
  const rows = listReports(5);
  assert.ok(rows.length > 0);
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i - 1].id >= rows[i].id);
  }
});
