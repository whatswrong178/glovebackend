# Hermes' Fat Skills: 标准作业程序 (SOP) 库

## Skill 1: 数据库核心动力学 (Supabase & PostgreSQL)
- **[Trigger 触发条件]**: 涉及权限控制、金钱计算（拔河/佣金）、数据状态流转（离职掉落公海）。
- **[SOP 执行标准]**:
  1. 权限控制强制在底层写 `RLS Policies`（按 Admin/Leader/Sales 隔离视野）。
  2. 复杂的财务计算与主权变更必须写成 `PostgreSQL RPC` 存储过程。
  3. 创建 Invoice 等高并发写入必须使用 `SELECT FOR UPDATE` 悲观锁。
- **[Anti-Pattern 绝对反模式]**: 严禁在前端使用 JS/TS 写 `filter` 充当权限控制；严禁在前端中间件中做高精度的佣金数学计算。

## Skill 2: B2B 工业级前端与可视化 (Refine.dev & Tailwind)
- **[Trigger 触发条件]**: 构建中后台 CRUD、数据看板、组织架构图、发票打印。
- **[SOP 执行标准]**:
  1. 核心框架使用 `@refinedev/core` + `React Query` 处理分页与缓存。
  2. 交互自愈：强制添加骨架屏 (Skeleton)、防抖按钮 (Debounce)、错误 Toast 拦截。
  3. 可视化：使用 `Recharts` 画 PnL 罗盘，用 `react-d3-tree` 画组织架构图。
  4. 打印：使用 Tailwind 的 `print:` 原子类实现 A4 无边距发票排版，调用浏览器原生打印。
- **[Anti-Pattern 绝对反模式]**: 严禁手写冗长的原生 CSS；严禁引入 `jspdf` 等极度拖慢性能的重型生成库；严禁花哨无用的 C 端动画。

## Skill 3: TDD 测试驱动与财务防线 (Vitest)
- **[Trigger 触发条件]**: 开发 `EPIC-06` (佣金计算器、阶梯大奖、怠慢指数) 等任何算钱模块。
- **[SOP 执行标准]**:
  1. 逻辑与 UI 剥离，核心财务函数必须是 Pure Function。
  2. 测试先行：在写 UI 前，强制先写 Vitest 脚本，测试覆盖率必须达到 100%。
  3. 边界穿透：强制写入 GP<0 (亏本)、刚好触达 35k/50k 保底、跨级裂变等极端测试 Case。
- **[Anti-Pattern 绝对反模式]**: 严禁交付没有 `*.test.ts` 伴生的核心财务代码；严禁单纯为了提升覆盖率而写无逻辑校验的无效断言。

## Skill 4: 零成本自动化工作流 (Make.com & Resend)
- **[Trigger 触发条件]**: 自动催款预警、月末数据快照、生日关怀。
- **[SOP 执行标准]**:
  1. 异步任务：在系统中预留并调用带有鉴权 Secret 的 Webhook API 供 Make.com 触发。
  2. 邮件路由：调用 Resend API，结合 Admin 配置的发件身份（finance@, care@）动态发信。邮件内容采用支持变量注入的响应式 HTML。
- **[Anti-Pattern 绝对反模式]**: 严禁在 Vercel 宿主环境中写 `node-cron` 定时任务。

## Skill 5: AI 视觉解析与物理安保 (Gemini & DOM Security)
- **[Trigger 触发条件]**: 报价单解析 (T-03.1)、防泄密拦截、E-POD 电子签收。
- **[SOP 执行标准]**:
  1. 解析与容错：调用 Gemini 1.5 Flash 提取报价单，若 AI 返回置信度低，前端必须高亮提示“需人工复核”。
  2. 安保：利用 Canvas 平铺员工 ID 形成动态水印；监听 `window.onblur` 触发全屏高斯模糊防录屏。
  3. 闭环：E-POD 签收使用 Canvas 捕捉 Base64 签名，强制调用 Geolocation 获取经纬度辅助验证。
- **[Anti-Pattern 绝对反模式]**: 严禁无脑信任 AI 输出而不给用户修改的 fallback 方案；严禁通过屏蔽 CSS 来做虚假的安全防护。