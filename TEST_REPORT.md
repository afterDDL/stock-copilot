# 测试与验收报告

更新日期：2026-10-10（Asia/Shanghai）

## 当前工作树验证记录

| 项目 | 命令 / 操作 | 结果 | 证据 / 限制 |
|---|---|---|---|
| Vitest 全量 | `npm test` | 通过 | 19 个测试文件，175 项通过。 |
| 类型检查 | `npm run typecheck` | 通过 | `tsc --noEmit` 退出状态 0。 |
| 生产构建 | `npm run build` | 通过 | Next.js 16.4.0；页面和 `/api/intent`、`/api/bank-snapshot`、`/api/stock-search` 路由生成成功。 |
| 浏览器端到端 | `npm run test:e2e -- --workers=1` | 通过 | 8/8；覆盖条件编辑与差异、逐股证据、冲突修正、澄清、比较、保存/刷新恢复、不支持指标、无行业市场策略、非银行行业条件和宽请求提示。接口数据使用确定性 Playwright mock。 |
| 桌面与窄屏视觉 | Playwright 截图检查 | 通过 | 1440×1000 与 390×844；主要内容可见，窄屏按对话/策略/结果纵向排列，未见横向溢出。 |
| 真实 iFinD smoke | 本地生产服务 `POST /api/stock-search` + 脱敏 `fetchAshareCandidates` 探针 | 未通过 | 三类策略均未返回候选。MCP HTTP 可达，但工具返回被解析为 `truncated_content`；API 复测为 `needs_narrowing` / `data_unavailable`。 |
| 云端/Vercel iFinD | 未执行 | 尚未验证 | 本轮没有云端请求证据。 |

## 真实 iFinD smoke 明细

以下 API 数值是 parser 修复后的复测，响应没有 `snapshot`，因此候选行数 0 表示没有可用数据结果，不代表零只符合条件。另用只记录 MCP 阶段 HTTP 状态、耗时和安全错误分类的临时探针直接调用 `fetchAshareCandidates`；它不输出凭证、请求头、session 或原始 MCP 内容。

| 策略 | HTTP | 业务码 | 候选行数 | 耗时 | 错误分类 |
|---|---:|---|---:|---:|---|
| 电子-半导体；总市值 ≥ 200 亿元；归母净利润同比 > 0% | 422 | `needs_narrowing` | 0 | 560 ms | 底层直接探针：MCP initialize / notification / tool_call 均 HTTP 200；业务解析 `AshareSearchError/truncated_content`。 |
| 电力设备；总市值 ≥ 10000 亿元；归母净利润同比 > 0% | 503 | `data_unavailable` | 0 | 716 ms | 底层直接探针同样归类为 `truncated_content`；API 不暴露该 503 的内层分类。 |
| 无行业；总市值 ≥ 50000 亿元；归母净利润同比 > 10%（有界全市场策略） | 503 | `data_unavailable` | 0 | 702 ms | 底层直接探针同样归类为 `truncated_content`；API 不暴露该 503 的内层分类。 |

为确认过滤条件是否能消除截断，另试总市值 ≥ 1000 万亿元且净利润同比 > 1000% 的明显极窄策略；该直接请求仍返回 `truncated_content`（MCP 各阶段 HTTP 200，约 2434 ms）。三类目标策略直接探针也均在 tool_call HTTP 200 后得到 `truncated_content`，耗时约 721、2424、2409 ms。证据指向上游返回内容/查询执行的截断边界，而非 HTTP 不可达；不能据此断言上游筛选条件被忽略，亦不能把它归为授权问题。真实数据验收仍未通过。

三次请求真实到达本地 API，但未产生候选数据；HTTP 业务状态在复测中不一致，MCP 传输阶段为 HTTP 200。只有直接解析层安全分类可确认 `truncated_content`；对于 API 返回的 `data_unavailable`，内层原因仍不可见，不推断为授权、限流或超时。凭证值、Authorization 头和 session 标识未输出或记录。

## 结果边界与覆盖

- 本快速路径不构建完整全市场快照。无行业只表示向 iFinD 发起全市场范围条件检索，不表示本地已穷举所有股票。
- iFinD 表格查询最多返回前 100 行且接口没有分页参数。候选截断、超过 100 行、字段无法严格解析或两个单指标查询的代码集合不一致时，整批结果会被拒绝，不展示部分数据。
- 成功解析只证明本次 MCP 返回的候选集合可被一致合并；不保证整个沪深北 A 股没有遗漏。UI 在“数据详情”中说明此边界。
- 银行历史快照保留为离线回归夹具，不作为正常无行业或非银行检索的回退数据。
- PB、PE、ROE、波动率等指标仍未验证，不可执行。筛选结果不是投资建议或收益预测。
