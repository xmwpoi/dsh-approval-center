# R5 真实 agent-loop 证据（Agent D）

日期：2026-10-01。产出人：Agent D。基线 `c90a1a50cbadf75d5560a305988388da95fac023`。
对应派发书 `dsh-notification-round5-approval-layout-fix.md` §54-§58（R5-D）。

---

## 0. 结论

| 项 | 结论 |
|---|---|
| **真实 agent-loop 可在隔离 fixture 中驱动** | ✅ 已实现并验证（`helpers/deterministic-loop.mjs` + `agent-loop.test.js`） |
| **turn/end 由真实 loop 产出** | ✅ 事件序列真实，**无任何手工 `session.append('turn/end')` 冒充** |
| **确定性 adapter 走真实 LLM 路由** | ✅ `LlmRuntime.prepareCall` → `pc.stream` → adapter.stream |
| 三条终态路径 | ✅ completed / error / aborted 全部真实产出 |
| 插件事件路径 | ✅ 真实 loop → 真实 `session/event` → 插件监听 → mock sender |
| **证据层级** | **真实 loop**（非手工事件注入，非通道级） |
| **不等于** | 生产模型/外部服务体验已验；子代理真实 loop 已验 |

---

## 1. 装配（最小真实宿主）

`test/integration/helpers/deterministic-loop.mjs`：

| 服务 | 来源 | 说明 |
|---|---|---|
| `sessions` | `new SessionStore(ctx)` | 真实会话存储 |
| `agents` | `new AgentRegistry(ctx)` | 真实 agent 注册表 |
| `llm` | `new LlmRuntime(ctx)` + `registerAdapter([PROVIDER], adapter)` | 真实 LLM 路由 |
| `systemPrompt` | `new SystemPrompt(ctx, {})` | 真实提示词装配 |
| `tools` | `new ToolRuntime(ctx, {})` | 真实工具运行时 |
| `sessionProjections` | `new SessionProjectionRegistry(ctx)` | 真实投影 |
| **插件** | `ctx.plugin(pluginMod, cfg)` | 被测插件（真实接线） |
| **loop** | `ctx.plugin(AgentLoop, {agents:[], maxParallelToolCalls:1})` | **真实 agent-loop** |

**装配顺序约束（实测）**：`SystemPrompt` 必须先于 `ToolRuntime`——后者在构造期读取 `ctx.systemPrompt`。

**确定性 adapter**：实现真实 `LlmAdapter` 抽象类的最小子集
（`providerInfo`/`providerRetryPolicy`/`imageRequestPricing`/`listModels`/`resolveModel`/`prepareCall`/`stream`），
**经真实 `ctx.llm.registerAdapter([PROVIDER], adapter)` 注册**。
`resolveModel` 必须返回 `LlmModelInfo` 形状（`provider`/`id`/`name`），否则路由抛 `INVALID_MODEL_INFO`。

**关键教训（调试中发现，供后来者）**：
1. `LlmProviderInfo` 需要 `name`（不是 `label`），且 `id` 必须等于 provider——否则 `INVALID_ADAPTER`。
2. `LlmResolvedModelInfo extends LlmModelInfo`：必须 `id`/`name`，`context: { contextWindow }`；
   写成 `{ provider, model, contextWindow }` 会 `INVALID_MODEL_INFO`。
3. `createUserMessage` 需要 `content: [{type:'text',text}]` + `source:{kind:'user'}`——
   传 `{ text }` 会在 loop 侧 `content is not iterable`。
4. 提交输入用 `agent.followup(msg)`（= `send(msg,'next-turn',true)`）；inbox 的 target 是**连字符** `next-turn`，不是驼峰。

## 2. 真实事件序列（实测）

一轮真实完成（`agent-loop.test.js` L-1）：

```
agent/inbox/spliced  ← followup 提交（真实 inbox splice）
turn/start           ← 真实 loop 开启
agent/inbox/spliced  ← inbox 消费
step/start           ← 真实 loop 开启 step
system/message       ← 真实系统提示词落盘
user/message         ← 真实用户消息落盘
request/header       ← 真实请求头（provider/model 路由）
request/context      ← 真实请求上下文
assistant/message    ← 确定性 adapter 的产出被真实组装为助手消息
step/end
turn/end             ← reason.kind = completed（loop 产出）
```

**没有任何手工 append**。`turn/end` 的 `reason.kind === 'completed'` 是 loop 在
模型流正常结束后写入的。

## 3. 三条终态路径（真实 loop 产出）

| 路径 | 触发方式 | 实测结果 | 插件行为 |
|---|---|---|---|
| **completed** | adapter 正常返回 | `turn/end` `reason.kind='completed'`，`adapter.callCount===1` | 成功通知（title `本轮回复已完成`、silent、`dsh-task`、16hex tag） |
| **error** | adapter **throw** | `turn/end` `reason.kind='error'` 且携带 LlmFailure（loop 产出） | 错误通知（title `本轮执行出错`；**原始错误信息不进正文**） |
| **aborted** | `agent.cancel({kind:'user'})` | `turn/end` `reason.kind='aborted'` | **静默**，零 powershell 进程 |

## 4. 插件事件路径（真实 loop → 通知）

插件在同一 `ctx` 上以 profile 根监听 `session/event`；真实 loop 产出的
`turn/end`（completed，且该轮有 step/start）被插件观察到并发通知。
`agent-loop.test.js` L-1 断言了 title/Group/tag/sound 全部字段。

## 5. 回归

| 项 | 结果 |
|---|---|
| 审批在同一宿主照常工作（L-4） | ✅ 认领 + `allowed-once` + 审计 `approved` |
| 审批后真实 loop 仍可完成一轮 | ✅ |
| `c90a1a5` + D 的 9+9 测试合入后全量 | ✅ **integration 79/79、unit 250/250** |
| 身份门/child 静默 | ✅ T-7、T3-3/T3-4 全过 |

## 6. 边界与诚实声明

1. **模型是确定性的**：adapter 返回固定文本。这证明**路径**真实（loop→事件→插件），
   **不证明**生产模型/外部服务的体验、延迟、流式行为或错误分布。
2. **sender 仍为 mock**：自动层不投递。若 C 在静音独占窗口把本夹具的确定性模型
   换成**最终包的真实 sender**，即形成"确定性模型真实 loop + Windows 通知"的端到端证据；
   即便如此，**仍不等于生产模型体验已验**。
3. **子代理真实 loop 未覆盖**：需要真实 `@deepseek-ai/dsh-subagent` 执行路径
   （委派/子会话装配）——按派发书 §56"若装配过重先交最小入口和障碍"。
   **障碍记录**：子代理路径需 `AgentLoop` 的子代理驱动与 `dsh-subagent` 的委派入口协同，
   当前 fixture 未装配该层；R5-D 的主会话证据**不外推**到子代理。
4. **无外呼、无生产 key**：adapter 完全本地。
5. helper 依赖限定在 `test/integration/**`（`dsh-agent-loop`/`dsh-tools`/`dsh-system-prompt`/
   `dsh-session-projection` 为 fixture 测试依赖，**不是插件运行时依赖**）；
   是否纳入 `test:integration` 清单与 CI 由 A 决定（R5-A）。

## 7. 给 C 的可执行 runner

```powershell
# 在 c90a1a5+ 树上（D 的测试已合入或 D 分支 637d798…）：
$env:DSH_PLUGIN_ENTRY = "<最终包安装路径>\lib\index.js"   # 或省略用本树构建产物
cd <repo>\test\integration
node --import ./hooks/register.mjs ../integration/agent-loop.test.js
# 期望 4/4：L-1 completed→通知；L-2 error→通知；L-3 aborted→静默；L-4 审批回归
```

C 在静音独占窗口用**最终包**替换 `DSH_PLUGIN_ENTRY` 后重跑，
即可获得"确定性模型真实 loop + Windows"端到端证据；每例如实标注层级。
