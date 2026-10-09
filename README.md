# 选股 coPilot

一个本地运行的 A 股银行研究工作台：把中文筛选意图转成可编辑策略，读取带日期的股票快照，再用确定性规则筛选、排序并展示逐股依据。

## 本地启动

需要 Node.js 与 npm。首次启动前：

```sh
npm install
cp .env.example .env.local
```

在本机 `.env.local` 中填写服务端凭证：

- `DEEPSEEK_API_KEY`：自然语言意图解析使用。
- `IFIND_MCP_AUTH_TOKEN`：实时 iFinD MCP 银行快照使用。

凭证不要填入前端代码、提交记录、截图或报告。没有 iFinD 凭证时，数据接口会回退到仓库中的历史快照并标记“历史快照”；没有 DeepSeek 凭证时，自然语言解析接口会返回未配置状态。`.env.local` 已被 Git 忽略。

启动开发服务器：

```sh
npm run dev
```

浏览器访问 <http://localhost:3000>。停止服务器按 `Ctrl+C`。

可用脚本：

| 命令 | 用途 |
|---|---|
| `npm run dev` | 本地开发服务器 |
| `npm run build` | Next.js 生产构建 |
| `npm run start` | 启动已构建的应用 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm test` | Vitest 单元与组件测试 |
| `npm run test:e2e` | Playwright 浏览器测试 |

当前 `package.json` 未定义 lint 脚本。

## 当前范围

P0 只支持 A 股银行股，以及三个可执行字段：银行行业、总市值、2026 年中报归母净利润同比增长率。市值阈值和利润条件由确定性 TypeScript 代码处理；缺失数据归为“无法判定”。在当前带日期快照上，规格中的示例为市值不低于 1000 亿元且利润同比大于 0%，并按利润同比降序展示。

系统不会把筛选或排序结果表达为投资价值判断，不提供收益预测、交易下单、用户账户或其他行业的可执行筛选。PB、PE、ROE 等虽列入候选注册表，目前未验证且不可执行。

## 架构与职责

- 浏览器工作台负责输入、策略编辑、证据和研究结果展示；保存策略使用浏览器 `localStorage`。
- `/api/intent` 在服务端调用 DeepSeek 并校验结构化输出。模型负责解析意图，不决定股票是否入选。
- `/api/bank-snapshot` 在服务端用两个受控 iFinD 单指标查询获取市值和利润指标，按股票代码合并并严格检查覆盖与日期。实时请求失败时提供带明确来源和采集时间的历史快照。
- `src/lib/mapping` 约束金融概念到已验证字段的映射；`src/lib/engine` 负责冲突检测、逐股判定、排序、证据解释和结果差异；`src/lib/research` 计算快照分布与边界提示。

真实快照的指标日期为 2026-10-09（总市值）和 2026-06-30（归母净利润同比）。42 只股票指当前 iFinD 行业查询快照覆盖，不等于经独立来源证明的全市场绝对完整名录。详细验证状态见 [PHASE0_REPORT.md](./PHASE0_REPORT.md) 与 [TEST_REPORT.md](./TEST_REPORT.md)。

## 凭证

Phase 0 报告记载 DeepSeek 临时 API Key 曾出现在聊天记录中。上线或继续共享运行前应撤销并轮换该 Key；若 iFinD 凭证也曾在共享日志、命令历史或聊天中暴露，同样应轮换。报告与仓库文档不包含密钥值。
