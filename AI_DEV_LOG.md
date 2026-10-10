# AI 开发记录

更新日期：2026-10-10

## 交付范围

本轮将原银行限定工作台扩展为沪深北 A 股条件候选检索：行业条件可选，显式行业可为非银行行业；总市值和 2026 年中报归母净利润同比为当前可执行数值指标。候选由 iFinD 两个受控单指标查询取得，本地按代码合并，并由确定性规则复核条件、排序和证据。LLM 不决定入选名单。

完整全市场快照仍是后续方向，不阻塞快速路径。候选检索不是全市场穷举；截断、候选集合不一致或字段不完整时会拒绝整批结果，不展示部分结果。UI 将非穷尽边界放在“数据详情”。

## Task 4 适配与验证

- Playwright 拦截接口从旧银行快照 GET 更新为 `POST /api/stock-search`，增加无行业有界策略、明确电子行业策略、阈值编辑与结果差异、证据、比较、策略保存/重开及宽查询提示覆盖。
- E2E 返回数据为确定性 mock；没有以 mock 结果代替真实 iFinD 证明。
- 当前验证：Vitest 19 个文件/177 项、TypeScript、生产构建和 Playwright E2E 8/8 均通过。桌面 1440×1000、窄屏 390×844 截图检查通过。
- Task 4 review 修复了实际 schema 宽列、双指标响应、市场总值单位后缀及 safe reason 分类，并将电子行业 E2E fixture 改为电子半导体上市公司华兴源创（688001）。后续脱敏复现更正了真实 smoke 根因：官方 iFinD skill wrapper 对简单 `search_stocks` 返回 HTTP 200，但内容是工具请求次数/账号权益上限提示而非数据表。真实验收因此被当前账号搜索额度耗尽阻塞；此前 `truncated_content` 不是可靠根因。客户端现映射至内部 `quota_exhausted`，公共 API 保持通用错误文案，额度恢复前不继续发请求。详情见 `TEST_REPORT.md` 和 Task 4 报告。

## 数据与验证纪律

- `/api/stock-search` 在 iFinD 不可用时返回简短错误，不回退到银行快照作为全市场结果。
- `data/bank-snapshot.json` 仅作为历史回归夹具，不能据此声称其他行业或全市场真实查询成功。
- 自动化结果只证明本地代码路径与测试夹具行为，不证明服务凭证、iFinD 连通性或全市场覆盖。
- 凭证值、Authorization 头和 session 标识不得进入日志、截图、报告或 Git。

## Review round 2：额度错误分类

- 官方 skill wrapper 的脱敏证据显示 MCP HTTP 200 但 `search_stocks` 返回工具请求次数/账号权益上限提示，没有数据表。客户端现返回内部 `IfindError/quota_exhausted`，不重试；API 对用户仍为通用不可用提示。额度恢复前不再发起真实查询。
- 回归测试覆盖两种中文额度提示，并经 `fetchAshareCandidates` 验证不进入候选解析：`npm test` 19 文件/177 项通过，`npm run typecheck` 通过。
