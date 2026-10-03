# 摩尔斯脉冲时序编解码与间隔诊断后端

离线、纯本地运行的摩尔斯电码时序处理服务。把英文 `A–Z`、数字 `0–9` 与单词间空格编码成“亮/暗”脉冲序列，并能从带轻微时长偏差的序列还原文字、逐字符输出诊断报告。

- **只做后端**：HTTP API + CLI，没有界面、不采集麦克风、不播放音频、不接收无线信号，也不计算信道误码率。
- **完全离线**：不调用任何在线摩尔斯服务或外部 API；编解码与分段逻辑全部自行实现。
- **技术栈**：TypeScript + Node.js（建议 Node 22+，开发环境为 Node 25）+ 内置 `node:sqlite`（无需原生编译、无需 Docker/WSL）。

## 时序规则

用户提供单位时长 `unit`（毫秒或任意时间单位，默认 1）与相对误差 `tolerance`（默认且最大 `0.2`，即 20%）。

| 段类型 | 标准时长 | 含义 |
| --- | --- | --- |
| 亮 | `1 × unit` | 点 `.` |
| 亮 | `3 × unit` | 划 `-` |
| 暗 | `1 × unit` | 同一字符内符号间隔 |
| 暗 | `3 × unit` | 字符间隔 |
| 暗 | `7 × unit` | 单词间隔 |

- 输入为 JSON 段列表：`{ "state": "on" | "off", "duration": number }`，时长必须为正的有限数。
- 相邻同状态段会先合并，合并后段记录全部来源下标 `sourceIndex`。
- 首尾暗段视为静默并单独记录（`leadingSilence` / `trailingSilence`），不会产生空的前后单词。
- 匹配规则：在容差内选取相对误差最小的标准时长；失败即报 `UNKNOWN_DURATION`，**不会**悄悄猜另一个单位。20% 容差下，1/3/7 三档的可接受区间互不重叠，不存在歧义。
- 不存在的点划组合报 `UNKNOWN_CODE`。出现任何问题时整段 `status: "failed"`、`text: null`，不会把部分可读内容标成成功。
- 空文本编码报错 `EMPTY_TEXT`；全静默序列解码语义为 `status: "ok"`、`text: ""`、`allSilence: true`。
- 编码前文本统一转大写，连续空白（空格/制表/换行）折叠为一个单词间隔并去除首尾空白。

解码报告包含：规范化段（含来源下标与全局时间区间）、点划串 `charCodes`、恢复文字，以及每个字符对应的 `segmentIndex`、`sourceIndex`、`[start, end]` 时间区间与字符/单词前间隔。

## 快速开始

```powershell
npm install
npm run build      # 编译到 dist/
npm test           # 编译测试版并运行全部 21 个测试
npm run demo       # 内置演示：SOS、含数字双词、扰动恢复、非法间隔定位、重启读取
npm start          # 启动 HTTP 服务（默认自动选择空闲端口）
```

指定端口或数据文件：

```powershell
npm start -- --port 8765
$env:PORT="8765"; npm start
$env:MORSE_DB_PATH="data/custom.db"; npm start
```

SQLite 数据默认存放在项目内 `data/morse.db`（自动创建，WAL 模式）。

## CLI

```powershell
# 文本编码（编译后）
node --disable-warning=ExperimentalWarning dist/cli/index.js encode --text "SOS" --unit 100

# 从 JSON 文件导入段并解码（文件可以是段数组，或 { segments, unit, tolerance }）
node dist/cli/index.js decode --file segments.json --unit 100 --tolerance 0.2
node dist/cli/index.js import --file segments.json        # decode 的别名

# 诊断查询与导出
node dist/cli/index.js reports --kind decode --limit 20
node dist/cli/index.js report --id 3
node dist/cli/index.js export --id 3 --out report.json

# 自定义数据库
node dist/cli/index.js reports --db data/custom.db
```

`npm link` 后也可直接使用 `morse` 命令。

## HTTP API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/health` | 健康检查 |
| `POST` | `/api/encode` | `{ "text": "SOS", "unit": 100 }` |
| `POST` | `/api/decode` | `{ "segments": [...], "unit": 100, "tolerance": 0.2 }` |
| `GET` | `/api/reports?kind=decode&limit=20` | 报告列表 |
| `GET` | `/api/reports/:id` | 报告详情（原始段 + 参数 + 结果快照） |
| `GET` | `/api/reports/:id/export` | 下载 JSON 导出 |

错误统一返回 `400`（或 `404`）与 JSON：`{ "code": "ERROR_CODE", "message": "...", "details": {} }`。

### 错误码

| code | 含义 |
| --- | --- |
| `EMPTY_TEXT` | 待编码文本为空/非字符串 |
| `INVALID_CHARACTER` | 含 A–Z、0–9、空白以外的字符 |
| `INVALID_SEGMENTS` | 段列表不是非空数组 / JSON 非法 |
| `INVALID_SEGMENT_STATE` | 段状态不是 `on`/`off` |
| `INVALID_DURATION` | 时长为零、负数或非有限数 |
| `DURATION_OUT_OF_RANGE` | 时长或总时长超过上限（单段 ≤ 1,000,000） |
| `SEQUENCE_TOO_LARGE` | 段数超过 100,000 |
| `INVALID_UNIT` | 单位时长非正或非有限 |
| `INVALID_TOLERANCE` | 容差不在 `0…0.2` |
| `UNKNOWN_DURATION` | 某段时长超出容差（附段下标与时间区间） |
| `UNKNOWN_CODE` | 点划组合不存在（附字符区间） |

## 持久化与重新分析

- 每次编码/解码都新增一行报告，保存**原始段、参数（unit/tolerance）与结果 JSON 快照**，只追加、不覆盖。
- 相同参数重复分析得到相同结果；修改 `unit` 后重新分析会产生**新报告**，旧报告快照保持不变。
- 重启进程后可通过 API/CLI 读取历史原始段与诊断（见演示示例 5 与持久化测试）。

## 项目结构

```
src/
  morse/        # 码表 table、校验 validate、编码 encode、段合并/首尾静默 normalize、解码 decode
  api/server.ts # HTTP 服务（默认空闲端口）
  cli/index.ts  # CLI
  db.ts         # node:sqlite 持久化
  service.ts    # 编解码 + 存储编排
  demo.ts       # 内置演示
  tests/        # node:test 测试（码表、往返、间隔、边界、持久化、API）
data/           # SQLite 数据目录（运行时生成）
```

## 开发模式

无需 watch 构建即可直接运行 TS（Node 原生类型擦除）：

```powershell
node --disable-warning=ExperimentalWarning --experimental-strip-types src/api/server.ts
```

## 限制与假设

- 仅支持 `A–Z`、`0–9` 与单词空格；标点符号、小写以外的变音字符不支持（输入即报 `INVALID_CHARACTER`）。
- 不做信号去噪/自适应单位估计：`unit` 必须由调用方提供；5 单位这类不合规暗间隔会被诊断为错误而不是猜测。
- 时长按普通浮点数比较（整数与有限小数稳定）；段数上限 100,000、单段时长上限 1,000,000，防止异常输入拖垮服务。
- 本地单机使用，未加入鉴权、HTTPS 与并发写优化。
