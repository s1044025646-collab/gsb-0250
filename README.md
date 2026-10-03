# 摩尔斯脉冲时序编解码与间隔诊断后端

离线摩尔斯电码时序处理服务：把英文 A–Z、数字 0–9 和单词间空格编码为明暗脉冲段列表，并从带轻微时长偏差的段列表还原文字。只做 API 与 CLI，不采集麦克风、不播放音频、不接收无线信号，也不计算信道误码率。

## 环境要求

- Windows 本地，Node.js ≥ 22.5（使用内置 `node:sqlite`，无需 Docker / WSL / 外部服务）
- 开发依赖仅 `typescript` 与 `@types/node`（`npm install`）

## 快速开始

```powershell
npm install
npm test          # 运行全部测试
npm run build     # TypeScript 编译到 dist/
npm run demo      # 运行演示（SOS、扰动恢复、非法间隔定位、重启读取）
node src/cli.ts serve --port=0   # 启动 API（0 = 自动选择空闲端口，默认）
```

## 时序规则

| 段 | 标准时长 |
|---|---|
| 亮 1 单位 | 点 `.` |
| 亮 3 单位 | 划 `-` |
| 暗 1 单位 | 字符内符号间隔 |
| 暗 3 单位 | 字符间隔 |
| 暗 7 单位 | 单词间隔 |

- 用户必须显式提供 `unitMs`（正有限数）与 `tolerance`（0–0.2，即不超过 20%）。
- 逐段匹配最近的标准时长，相对偏差超过容差即报错定位，不会暗中改猜另一个单位。
- 相邻同状态段先合并并记录来源下标；首尾静默被剥离并记录，不产生空的前后单词。
- 零、负数、非有限时长、超过 100000 段的序列会被拒绝；空文本报错，全静默返回空文本。

## CLI

```powershell
node src/cli.ts encode --text="SOS" --unit=100
node src/cli.ts decode --file=segments.json --unit=100 --tolerance=0.1
node src/cli.ts reports --limit=20
node src/cli.ts report 3
node src/cli.ts export 3 --out=report.json
node src/cli.ts examples
node src/cli.ts serve --port=8080
```

## HTTP API

启动：`node src/cli.ts serve --port=0`（默认选择空闲端口并打印实际端口）。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查 |
| POST | `/api/encode` | `{text, unitMs}` → 段列表，保存报告 |
| POST | `/api/decode` | `{segments, unitMs, tolerance}` → 诊断报告，保存报告 |
| GET | `/api/examples` | 内置 SOS 与含数字两词示例 |
| GET | `/api/reports?limit=&offset=` | 报告列表（新→旧） |
| GET | `/api/reports/:id` | 报告详情（含原始段与参数快照） |
| GET | `/api/export/:id` | 下载报告 JSON |

错误统一为 `{ "error": { "code", "message" } }`，HTTP 400。错误码：
`INVALID_TEXT`、`EMPTY_TEXT`、`INVALID_CHARACTER`、`INVALID_UNIT`、`INVALID_TOLERANCE`、
`INVALID_SEGMENTS`、`INVALID_SEGMENT`、`SEQUENCE_TOO_LONG`、`NOT_FOUND`；
解码报告内的段级错误码：`DURATION_OUT_OF_TOLERANCE`、`UNKNOWN_PATTERN`。

## 解码报告字段

- `ok`：整段是否成功（任何段超容差或未知点划组合都会使整体失败，不会把部分可读文字标为成功）
- `text` / `dotDash`：恢复文字与点划串（词间以 `/` 分隔）
- `normalized`：规范化段（合并来源下标 `sourceIndices`、单位数、相对偏差）
- `chars`：每个字符的原始段下标区间与毫秒时间区间
- `leadingSilence` / `trailingSilence`：被剥离的首尾静默段下标
- `errors`：定位到原始段下标的错误列表

## 数据存储

SQLite 数据库位于项目内 `data/morse.db`。每次编码/解码分析都插入新报告（原始输入、参数、结果快照、时间戳），重复分析产生新行；修改单位时长不影响旧报告。删除 `data/` 即可重置。

## 项目结构

```
src/morse.ts   码表、编码、解码与诊断核心
src/api.ts     业务处理与错误码
src/db.ts      SQLite 存储（node:sqlite）
src/server.ts  HTTP API
src/cli.ts     命令行入口
src/demo.ts    演示脚本
tests/         node:test 测试
```

## 已知限制

- 仅支持 A–Z、0–9 与空格，不支持标点。
- 文本编码输出不自动生成首尾静默段；解码端能正确处理输入自带的首尾静默。
- 时长比较使用 1e-9 级相对 epsilon，整数与有限小数均可稳定比较；超大时长（>1e12ms）拒绝。
