# 部署说明

## 当前状态

本项目当前按本地 MVP 交付。Vercel 云端 MCP 路径**尚未验证**；没有本项目云端部署请求的 HTTP 状态、业务状态或耗时证据。不要把 Phase 0 的本地 iFinD 成功称为 Vercel 已连通。

## 本地运行

```sh
npm install
cp .env.example .env.local
# 在本机编辑 .env.local，填写服务端凭证
npm run dev
```

访问 <http://localhost:3000>。`.env.local` 已由 `.gitignore` 排除，`.env.example` 仅有空值模板。生产构建和启动命令为 `npm run build` 与 `npm run start`；本报告不据此断言本次构建已通过。

## Vercel 验证清单（尚未执行）

1. 使用目标 Vercel 项目配置服务端环境变量 `DEEPSEEK_API_KEY` 与 `IFIND_MCP_AUTH_TOKEN`，仅配置在服务端运行环境，不设置为 `NEXT_PUBLIC_*`。
2. 完成部署后，通过受控方式请求 `/api/bank-snapshot?mode=live`，记录脱敏后的状态、数据模式、指标日期、覆盖数、耗时和错误类别。
3. 验证函数运行环境可以连接 iFinD MCP，检查超时、授权、冷启动和内容层限流；失败时确认历史回退被明确标记。
4. 通过 `/api/intent` 做一次最小 DeepSeek 请求，确认结构校验与安全错误处理。
5. 在任何发布决策前完成测试报告中的单元、类型、构建和浏览器验收项。

当前未完成以上步骤，故部署结论仍为“未验证”。计划明确不把 Vercel 部署列为本轮完成条件。

## 凭证轮换

Phase 0 记载 DeepSeek 临时 Key 曾出现在聊天记录。部署前先撤销该 Key 并创建新的服务端 Key。若 iFinD Token 曾出现在共享记录、shell history 或日志中，也应轮换。不要将凭证放进 Git、日志、截图、浏览器 bundle 或报告。
