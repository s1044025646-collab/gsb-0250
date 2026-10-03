import { rmSync } from "node:fs";
import { configureDatabasePath, getDatabase } from "./db.js";
import {
  decodeAndStore,
  encodeAndStore,
  getReportHydrated,
  queryReports,
} from "./service.js";
import type { Segment } from "./morse/types.js";

const DB_PATH = "data/demo.db";

function perturb(segments: Segment[], factor: number[]): Segment[] {
  return segments.map((segment, index) => ({
    state: segment.state,
    duration: segment.duration * (factor[index] ?? 1),
  }));
}

function heading(title: string): void {
  console.log(`\n========== ${title} ==========`);
}

function main(): void {
  rmSync(DB_PATH, { force: true });
  rmSync(`${DB_PATH}-wal`, { force: true });
  rmSync(`${DB_PATH}-shm`, { force: true });
  configureDatabasePath(DB_PATH);
  const unit = 100;

  heading("示例 1: SOS 正常编码与恢复");
  const sos = encodeAndStore("sos", unit);
  console.log(`文本: ${sos.text}，段数: ${sos.segments.length}，报告 id: ${sos.id}`);
  const sosDecoded = decodeAndStore(sos.segments, unit, 0.2);
  console.log(`恢复文字: "${sosDecoded.text}"，状态: ${sosDecoded.status}`);

  heading("示例 2: 含数字的两个单词 AGENT 42");
  const agent42 = encodeAndStore("agent 42", unit);
  console.log(`文本: ${agent42.text}，段数: ${agent42.segments.length}，报告 id: ${agent42.id}`);
  const recovered = decodeAndStore(agent42.segments, unit, 0.2);
  console.log(`恢复文字: "${recovered.text}"，字符数: ${recovered.chars.length}`);

  heading("示例 3: 容差内扰动（时长 +15%/-10% 交替，容差 20%）");
  const factors = agent42.segments.map((_, index) => (index % 2 === 0 ? 1.15 : 0.9));
  const noisy = perturb(agent42.segments, factors);
  const noisyDecoded = decodeAndStore(noisy, unit, 0.2);
  console.log(
    `恢复文字: "${noisyDecoded.text}"，状态: ${noisyDecoded.status}，问题数: ${noisyDecoded.issues.length}`,
  );

  heading("示例 4: 非法间隔定位（词间暗间隔 700ms 改成 500ms，容差 20%）");
  const broken = agent42.segments.map((segment) => ({ ...segment }));
  for (const segment of broken) {
    if (segment.state === "off" && segment.duration === 7 * unit) {
      segment.duration = 5 * unit;
      break;
    }
  }
  const brokenDecoded = decodeAndStore(broken, unit, 0.2);
  console.log(`状态: ${brokenDecoded.status}（不允许标成完整成功）`);
  for (const issue of brokenDecoded.issues) {
    console.log(
      `  - ${issue.code}: ${issue.message}；原始段下标 ${JSON.stringify(issue.sourceIndex)}；区间 ${JSON.stringify(issue.interval)}`,
    );
  }

  heading("示例 5: 模拟重启——重新打开数据库后读取历史报告与诊断");
  getDatabase(DB_PATH).close();
  configureDatabasePath(DB_PATH);
  const summaries = queryReports(10);
  console.log(`历史报告 ${summaries.length} 条（最新在前）:`);
  for (const summary of summaries) {
    console.log(
      `  #${summary.id} [${summary.kind}] status=${summary.status} text=${summary.input_text ?? "-"} unit=${summary.unit}`,
    );
  }
  const reloaded = getReportHydrated(brokenDecoded.id) as {
    status: string;
    result: { issues: unknown[] };
  };
  console.log(
    `重启后读取报告 #${brokenDecoded.id}: status=${reloaded.status}，诊断条数=${reloaded.result.issues.length}`,
  );
  console.log("修改参数重新分析只会产生新报告，旧报告快照保持不变。");

  console.log("\n演示完成。");
}

main();
