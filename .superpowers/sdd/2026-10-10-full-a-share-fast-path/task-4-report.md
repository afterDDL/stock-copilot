# Task 4 报告：真实 Smoke、E2E 与交付

日期：2026-10-10（Asia/Shanghai）

## 结果

- E2E 已适配当前 `POST /api/stock-search` 和新提示文案。8/8 通过，覆盖阈值编辑与结果差异、股票证据、冲突/澄清、比较、保存后刷新恢复、无行业有界市场策略、非银行行业条件及过宽候选的简短提示。
- 全量本地验证通过：`npm test` 为 19 个文件/168 项，`npm run typecheck` 退出 0，`npm run build` 成功，`npm run test:e2e -- --workers=1` 为 8/8。
- 通过 Playwright 截图检查 1440×1000 桌面与 390×844 窄屏。桌面主工作区双列，窄屏为对话、策略、结果纵向布局；截图未发现横向溢出。截图仅存于临时目录，未进入仓库。
- 交付文档已更新：`README.md`、`TEST_REPORT.md`、`AI_DEV_LOG.md`、`NEXT_STEPS.md`。

## 真实 iFinD 请求

三个策略都经本地生产服务真实 `POST /api/stock-search` 发出。正常成功路径按设计会向 iFinD `search_stocks` 发送 2 个单指标查询；由于这三次都在 API 层返回 503，且路由没有上游调用计数，本次不能确认失败前实际完成了几个 MCP 调用。

| 策略 | HTTP | 业务状态 | 返回候选行数 | 耗时 | 分类 |
|---|---:|---|---:|---:|---|
| 电子；总市值 ≥ 500 亿元；净利润同比 > 0% | 503 | `data_unavailable` | 0 | 2634 ms | 实时数据服务不可用；API 不暴露底层 iFinD MCP 分类。 |
| 电力设备；总市值 ≥ 500 亿元；净利润同比 > 0% | 503 | `data_unavailable` | 0 | 1751 ms | 实时数据服务不可用；API 不暴露底层 iFinD MCP 分类。 |
| 全市场范围；总市值 ≥ 5000 亿元；净利润同比 > 0% | 503 | `data_unavailable` | 0 | 1734 ms | 实时数据服务不可用；API 不暴露底层 iFinD MCP 分类。 |

这里的 0 行表示响应没有候选快照，不能解读为筛选结果为空。由于 API 只给出通用 `data_unavailable`，没有根据猜测将错误归为授权、网络、超时或限流。故“至少两个非银行行业与一个有界全市场策略返回真实数据”的验收条件未通过，需要先排查上游失败原因再重试。

## 边界

当前交付是 iFinD 条件检索候选快速路径，不是完整全市场快照或穷举扫描。无行业条件只表示请求从全市场范围检索；接口无分页且可能最多返回前 100 行。候选截断、超过 100 行、解析失败或两个指标查询的代码集合不一致时，系统会拒绝整批结果并提示收窄条件。即使未来 smoke 成功且本地解析通过，也只能证明当次返回候选集合可解析，不代表沪深北 A 股没有漏选。

测试中的候选与浏览器结果使用确定性 fixture/mock；它们证明本地交互与引擎行为，不替代真实 iFinD 数据验收。凭证值、Authorization 头和 MCP session 标识未输出或写入仓库。

## 提交

## Review round 1 修复与复测

- 将电子行业 Playwright fixture 从银行股改为语义对应的电子半导体股票华兴源创（688001），断言行业、代码、总市值与归母净利润同比指标；focused E2E 通过。fixture 市值为 2026-10-09 收盘价乘以已披露股数的计算值（非 iFinD 实测）；净利润同比来自 2026 半年报数值。参考：[历史行情](https://cn.investing.com/equities/suzhou-hyc-technology-co-ltd-historical-data)、[上交所股本公告](https://star.sse.com.cn/disclosure/listedinfo/announcement/c/new/2026-05-20/688001_20260520_J73J.pdf)、[半年报数据](https://stock.stockstar.com/notice/SN2026082800052185.shtml)。这只是确定性 UI fixture，不是本轮真实行情验证。
- 修正 iFinD 表格解析对额外列、两个已知指标列、市场总值 `亿/万亿` 后缀的假设，并保留安全的内部失败分类。覆盖性测试用于确保额外字段不会未经 allowlist 进入规范化数据。
- 后续脱敏复现更正了根因：官方 iFinD skill wrapper 对简单 `search_stocks` 返回 HTTP 200，content 明确提示工具请求次数/账号权益上限且没有数据表，确认当前账号搜索调用额度已耗尽。Round 1 将这类失败记录为 `truncated_content` 是错误归因，现以本节更正；未输出或保存凭证、Authorization、session 或原始 MCP payload。
- 本地生产 API 的历史复测为：半导体 HTTP 422 `needs_narrowing` / 560 ms；电力设备 HTTP 503 `data_unavailable` / 716 ms；有界全市场 HTTP 503 `data_unavailable` / 702 ms。均无 snapshot，候选行数 0。以上是 quota classifier 修复前状态，第一条业务码属于误分类；API 对外仍使用通用 `data_unavailable`，不暴露 quota 工程细节。真实候选数据验收仍失败。
- Review 后验证：`npm test` 19 个测试文件、175 项通过；focused 非银行 E2E 1/1；全量 `npm run test:e2e -- --workers=1` 8/8；`npm run typecheck` 通过；`npm run build` 通过。完整 E2E 包含阈值编辑/差异、证据、比较、保存和重开、市场范围及宽查询提示。
- 搜索边界仍是条件候选检索而非穷尽。MCP HTTP 200 不代表数据请求成功；出现截断必须拒绝展示局部候选。即便后续某次无截断通过解析，也不证明整个市场零遗漏。`README.md`、`TEST_REPORT.md`、`AI_DEV_LOG.md`、`NEXT_STEPS.md` 已同步该限制和最新数据。

计划提交：`docs: hand off A-share candidate screening MVP`。

## Review round 2：账号权益额度错误分类

- 未再发真实 iFinD 请求，以免继续消耗已达上限的账号额度。采用 parent 提供的官方 skill wrapper 脱敏证据：简单 `search_stocks` 的 MCP HTTP 为 200，content 是中文“工具请求次数上限/账号权益上限”提示而不是数据表；凭证与鉴权数据没有写入日志或文档。
- 先在 `client.test.ts` 增加真实 `IfindMcpClient` 路径回归：分别用“工具请求次数已达到上限”和“账号权益上限不足”MCP 文本触发 `fetchAshareCandidates`。确认旧实现失败并返回通用 `tool_error`（RED）；修复后稳定返回不可重试的 `IfindError` / `quota_exhausted`（GREEN），不会重试或进入候选解析，因此不会误判 `truncated_content` / `needs_narrowing`。
- 公共 `/api/stock-search` catch-all 保持通用 HTTP 503 / `data_unavailable` 和现有用户文案，不对 UI 暴露额度工程分类。
- `TEST_REPORT.md`、`README.md`、`NEXT_STEPS.md`、`AI_DEV_LOG.md` 更正先前把 smoke 失败归为截断的推断，明确当前真实数据验收因账号 `search_stocks` 权益调用额度耗尽未通过；只有额度恢复后才应再次执行两类非银行行业和一个有界全市场查询。
- 本轮完成后 `npm test` 19 个文件/177 项通过，`npm run typecheck` 通过。全量 E2E 和 build 的最近结果仍为 Round 1 8/8 与通过；本轮只改客户端分类和报告，没有消耗真实额度。
