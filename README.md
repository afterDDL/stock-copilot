# 选股 coPilot

用中文描述想找的股票，检查并编辑筛选条件，再查看入选名单、逐股依据、股票比较和筛选变化。面向沪深北 A 股，行业可以不填；目前支持所属行业、总市值和 2026 年中报归母净利润同比增长率。策略可保存在当前浏览器中。

在线体验：https://stock-copilot-one.vercel.app

iFinD 账号调用额度已用完，当前无法获取实时数据。

## 本地启动

需要 Node.js 与 npm。首次运行：

```sh
npm install
cp .env.example .env.local
```

在 `.env.local` 填入 `DEEPSEEK_API_KEY` 和 `IFIND_MCP_AUTH_TOKEN`，再运行：

```sh
npm run dev
```

打开 <http://localhost:3000>；按 `Ctrl+C` 停止。凭证仅存本机，不随项目分享；共享使用前更换曾公开的凭证。

## 使用提示

| 遇到什么 | 怎么做 | 是否影响使用 |
|---|---|---|
| 结果较多，或返回数据无法完整核对 | 补充行业或提高筛选门槛 | 本次不展示部分结果，已有结果仍可查看 |
| 数据暂时不可用 | 稍后重试 | 已有结果和保存的策略保留 |
| 请求了尚未支持的指标 | 改用行业、总市值或利润同比 | 可继续编辑策略 |
| 已修改条件，尚未取得新结果 | 运行筛选 | 页面会说明仍显示上次成功查询的结果 |

本次候选可能未覆盖所有符合条件的股票，范围说明在“数据详情”。结果用于研究，不提供收益预测。当前数据日期为 2026-10-09（总市值）和 2026-06-30（利润同比）。

验证结果见 [TEST_REPORT.md](./TEST_REPORT.md)，后续事项见 [NEXT_STEPS.md](./NEXT_STEPS.md)。常用命令：`npm test`、`npm run typecheck`、`npm run build`、`npm run test:e2e -- --workers=1`；生产构建后用 `npm run start` 启动。
