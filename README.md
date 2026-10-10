# 选股 coPilot

一个本地运行的沪深北 A 股研究工作台：将中文筛选意图转成可编辑策略，通过 iFinD 条件检索获取候选，再用确定性规则逐只复核、排序并展示依据。

## 本地启动

需要 Node.js 与 npm。首次启动前：

```sh
npm install
cp .env.example .env.local
```

在本机 `.env.local` 中填写服务端凭证：

- `DEEPSEEK_API_KEY`：自然语言意图解析使用。
- `IFIND_MCP_AUTH_TOKEN`：实时 iFinD 候选检索使用。

凭证不要填入前端代码、提交记录、截图或报告。没有 iFinD 凭证或实时服务不可用时，选股请求会显示“数据暂时不可用，请稍后重试。”正常全市场流程不会回退到银行历史快照。`.env.local` 已被 Git 忽略。

启动开发服务器：

```sh
npm run dev
```

浏览器访问 <http://localhost:3000>。停止服务按 `Ctrl+C`。

可用脚本：

| 命令 | 用途 |
|---|---|
| `npm run dev` | 本地开发服务器 |
| `npm run build` | Next.js 生产构建 |
| `npm run start` | 启动已构建的应用 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm test` | Vitest 单元与组件测试 |
| `npm run test:e2e -- --workers=1` | Playwright 浏览器测试 |

当前 `package.json` 未定义 lint 脚本。

## 当前范围与数据边界

产品入口面向沪深北 A 股。行业条件可选，也可以明确写任意行业；没有行业条件时会从全市场范围发起条件检索。当前可执行字段为所属行业、总市值，以及 2026 年中报归母净利润同比增长率。PB、PE、ROE、波动率等尚未验证，不可用于执行。

服务端按策略生成两个单指标 iFinD 查询（总市值、归母净利润同比），按股票代码合并后严格检查返回行、字段、日期和跨查询候选一致性。返回候选由确定性 TypeScript 代码逐只复核并展示证据，LLM 不决定入选。

这是条件检索候选，不是完整全市场逐股扫描。iFinD 查询没有分页参数且结果可能截断；出现截断、超过 100 行、字段解析失败或两次查询候选不一致时，系统会丢弃整批结果并提示“结果较多，请补充行业或提高筛选门槛。”没有截断只说明本次候选返回通过解析，不代表沪深北 A 股绝对无漏选。筛选与排序用于研究，不代表投资建议或收益预测。

## 架构与职责

- 浏览器工作台负责输入、策略编辑、结果、证据和比较；保存策略使用浏览器本地 `localStorage`。
- `/api/intent` 在服务端调用 DeepSeek 并校验结构化输出；本地 Mapping Resolver 再校正可执行策略。
- `/api/stock-search` 接收 `POST` 结构化策略，服务端调用 iFinD 并返回经过校验的候选与采集证据。
- `src/lib/engine` 负责冲突检测、逐只条件判定、排序、证据解释和结果差异；`src/lib/research` 负责样本分布和研究辅助。

最近真实 smoke 未通过：iFinD MCP HTTP 可达（HTTP 200），但官方 skill wrapper 的 `search_stocks` 返回中文工具请求次数/账号权益上限提示，而非数据表，说明当前账号的搜索权益额度已耗尽。服务端将其分类为 `quota_exhausted`；公共 API 仍只返回通用“数据暂时不可用”，不向主 UI 暴露工程错误。额度恢复前不重复消耗请求。云端连通性仍未验证。自动化测试与真实 smoke 记录见 [TEST_REPORT.md](./TEST_REPORT.md)；完整 Task 4 记录见 `.superpowers/sdd/2026-10-10-full-a-share-fast-path/task-4-report.md`。

## 凭证

Phase 0 报告记载 DeepSeek 临时 API Key 曾出现在聊天记录中。上线或继续共享运行前应撤销并轮换该 Key；若 iFinD 凭证也曾在共享日志、命令历史或聊天中暴露，同样应轮换。密钥值不得写入仓库文档或测试产物。
