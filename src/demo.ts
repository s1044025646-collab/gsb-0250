import { encodeText, decodeSegments } from "./morse.ts";
import { getReport } from "./db.ts";

function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

const UNIT = 100;
const TOL = 0.15;

section("1. SOS 正常编码");
const sos = encodeText("SOS", UNIT);
console.log(`文本: ${sos.text}  点划: ${sos.dotDash}  段数: ${sos.segments.length}`);

section("2. 容差内扰动后恢复（含数字的两个单词 M2 K9）");
const enc = encodeText("M2 K9", UNIT);
// 施加 ±10% 内的确定性扰动
const perturbed = enc.segments.map((s, i) => ({
  ...s,
  duration: s.duration * (1 + (i % 2 === 0 ? 0.08 : -0.07)),
}));
const dec = decodeSegments(perturbed, UNIT, TOL);
console.log(`恢复结果: ${dec.ok ? "成功" : "失败"}  文本: "${dec.text}"`);

section("3. 不合法间隔定位（把一个字符间隔改成 5 单位 = 超容差）");
const bad = enc.segments.map((s) => ({ ...s }));
const gapIdx = bad.findIndex((s) => s.state === "off" && Math.abs(s.duration - 3 * UNIT) < 1e-9);
bad[gapIdx].duration = 5 * UNIT; // 既非 3 也非 7（容差 15%）
const decBad = decodeSegments(bad, UNIT, TOL);
console.log(`ok=${decBad.ok}`);
for (const e of decBad.errors) {
  console.log(`  错误 ${e.code}: ${e.message}  期望=${JSON.stringify(e.expected)} 实际=${e.actual}`);
}

section("4. 数据库快照与重启后读取演示");
const { saveReport } = await import("./db.ts");
const id = saveReport("decode", { unitMs: UNIT, tolerance: TOL }, { segments: perturbed }, dec);
console.log(`已保存报告 id=${id}（重新分析会产生新 id，旧报告不受参数修改影响）`);
const row = getReport(id);
console.log(`重新读取: id=${row?.id} kind=${row?.kind} 参数=${JSON.stringify(row?.params)} 文本="${(row?.result as { text: string }).text}"`);
console.log(`原始段数量: ${((row?.input as { segments: unknown[] }).segments ?? []).length}`);
