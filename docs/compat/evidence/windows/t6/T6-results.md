# T6 验收结果矩阵

> ⚠️ **声明**：本模板填写完成前不构成任何"实机通过"证据；PENDING 不得被标成 PASS。

> **✅ G2 收口结论（2026-09-30 14:45，Agent C）**：见文末 §7 复测轮。
> **结论：G2 Windows 实机验收 PASS**——基于新包
> `dsh-approval-center-0.3.1-rc.1-t6-issue1.tgz`（SHA256 `9F13E71BF14F26D9D4840032DA3C5409CBCE43F93CBA47BA0F61B947E25ECFA8`），
> T6 首轮的唯一 FAIL（ISSUE-1 中文 StateDir）已实机复测通过；残留 PENDING（V16 真实子代理会话、CI 首轮）
> 均不阻断核心审批/取消/并发/重载语义，须在 README/发布说明中如实声明。

## 头部字段（执行时填写）

| 字段 | 值 |
| --- | --- |
| 被测插件 commit | 候选包由 A 自 `adapt/dsh-017-host@1d7d2a867850cf43306458acc46c83e14cf8258a` 构建（包内 package.json 0.3.1-rc.1；C 未重算 commit 映射，见交接单 BUG-3） |
| 候选 tgz SHA256 | `7CE7ACAD984B1FF642D30D3CA6112BD5C6A3AA24CFA98E46B554F7A9FACF819D`（实测一致 ✓） |
| 宿主精确版本与 integrity | @deepseek-ai/dsh **0.1.7-rc.2**，sha512-SQFhriLvza8GnFApnC5/32AgpcyKxrWnYXhvwDOLJdgWpkCX2EexyR9c8kCkMITJXnFLEN3Qb2CEh0W36vkLyw==（与 T0 契约一致，实测 `dsh --version`=0.1.7-rc.2） |
| Windows 版本 | Build 26100（OS 10.0.26200 x64） |
| Node 版本 | v24.20.0 |
| PowerShell 版本 | 5.1.26100.9168（System32；无 pwsh） |
| 隔离 DSH_HOME 路径 | `D:\codex\dsh-approval-center-c-t6\dsh-home` |
| 执行时段 | 2026-09-30 12:59 – 13:30（进入时 URI/AUMID 即时备份：`backup\*entry-20260930-125924.reg`） |

## 结果矩阵（对应 runbook §3）

| 步骤 ID | 用例 V 编号 | 说明 | 预期 | 实际 | 结论 | 证据文件路径 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S1 | V18 | 安装 | tgz 安装成功、dump-config 单实例 | 0.3.1-rc.1 装入隔离 profile；`- id: approval-center` 恰 1 个 | **PASS** | logs/、会话记录 | SHA 核对一致后安装 |
| S2 | V19 | 配置 | 局部/完整 override 投影正确、非法值拒绝 | 局部+完整投影逐字段正确；`queueMode: bogus-value` → 挂载时 `ValidationError: $.queueMode expected "serial"\|"parallel"`，插件不激活、宿主告警；dump-config-schema 含 approval-center/timeoutSec/queueMode 枚举 | **PASS** | logs/boot-web-bogus.log | T0 遗留的"深层 JSON Schema 投影"PENDING 在此关闭 |
| S3 | V01/V02 | 批准/拒绝 | 宿主 allowed-once/rejected | 真实 toast 可见（tag=token, group=dsh-approval）；协议激活 approve→exit 0（E1b 显式）；reject→exit 1（E2）；结算后通知移除、状态文件自清 | **PASS**（宿主 asked/decided 配对未核，见 PENDING-1） | logs/e1-approve.log、logs/e2.log | 直连脚本层测试（未走真实宿主 turn） |
| S4 | V03 | 超时 | exit 2、通知移除 | 5 次运行：1 次 exit 2（E3b）；4 次 exit 0（真人桌面点击批准干扰，见 §5.3） | **PASS（附异常说明）** | logs/e3b-debug.log | 超时语义已证明；干扰为环境因素非插件缺陷 |
| S5 | V04 | timeoutAction=approve | 仅真实 timeout 自动批准 | **未执行**（脚本层直接运行未带该参数；宿主层需真实 turn） | **PENDING** | — | 自动层 V04 已由 T5 mock 覆盖 |
| S6 | V06 | 撤回与定向清理 | kill 后 .pending+toast 双残留 → -CleanupToken 双清、幂等 | 0.6s 击杀 → `.pending`+toast 双残留 ✓ → `-CleanupToken` → PENDING_GONE+TOAST_REMOVED_BY_CLEANUP、exit 0；重复调用幂等 exit 0 | **PASS** | 会话记录 | token 定向清理的实机证据（本轮适配新增能力） |
| S7 | V08 | 并发小批次 | 多路独立结算、无串号 | 3 路并发（approve/reject/任选）→ exit 0/1/0，全部自清、无串号 | **PASS** | 会话记录 | 第 3 路为真人点击批准（桌面有人） |
| S8 | V09/V10 | Web 共存 | next 一次/本插件优先 | **未执行**（需真实宿主 turn + 浏览器应答者） | **PENDING** | — | T5 集成层已覆盖；实机需真实会话 |
| S9 | V11 | never 策略 | 无 Toast、宿主 rejected | **未执行**（需真实宿主 turn） | **PENDING** | — | T0 已核实 never 在宿主短路（插件收不到请求） |
| S10 | V14 | 禁用/卸载/HMR | 终止与结算、重挂载单实例 | 卸载路径已验（S13 dump-config=0）；禁用/HMR 时有活动请求的结算未实机执行 | **部分 PASS** | 会话记录 | 活动请求终止的宿主层由 T5 21/21 覆盖 |
| S11 | V16 | 子代理通知 | 按 stopReason 文案、同 run 不重复 | **未执行**（需真实子代理会话） | **PENDING** | — | — |
| S12 | V17 | VBS/回退/中文路径 | 主路/回退均有效 | VBS 主路 exit 0（E1b/E6 前置）✓；PS 回退 exit 0（E7，临时注册 PS 变体）✓；**中文 StateDir 映射 FAIL**（见 BUG-1）；空格 ASCII 路径正常 | **部分 PASS + 1 FAIL** | logs/e6-handler-debug.log、logs/ascii-map-debug.log | BUG-1 为基线既有，非本轮引入 |
| S13 | V20 | 回滚与恢复 | 卸载干净、生产完好、旧库可读 | `plugin remove` 后 dump-config=0；生产 0.3.0 完好；生产 approvals.db 只读打开 33 行（WAL） | **PASS** | 会话记录 | 生产库只读访问 |
| S14 | V05/V15 | 故障抽查 | fail-closed | 非法 token → exit 4（CL-03 自动层）；DB 故障由 T5 覆盖 | **PASS**（自动层） | test/dialog.cleanup.test.js | — |

## E 系列补充证据（脚本层端到端，安装包真实脚本）

| 用例 | 操作 | 结果 |
| --- | --- | --- |
| E1/E1b | 真实 toast（-RequestToken）→ 协议激活 approve | toast 可见 ✓；E1b exit 0 ✓ |
| E2 | reject 激活 | exit 1 ✓ |
| E3/E3b/E3C/E3D/E3E | 无人应答超时 | E3b exit 2 ✓；其余 4 次被真人点击批准（见 §5.3） |
| E4b | 0.6s 强杀 → 残留 → -CleanupToken | 双残留 ✓ → 双清 ✓ → 幂等 ✓ |
| E5 | 3 路并发 | 0/1/0 独立结算、全部自清 ✓ |
| E6 | 中文+空格 StateDir | **FAIL**（BUG-1）→ exit 2 超时；回落默认目录（fail-closed） |
| E7 | PS 回退处理器（临时注册） | exit 0 ✓ |
| E8 | 无 token 随机 GUID 兼容路径 | exit 0 ✓（History diff 定位随机 tag） |

## 5. 异常与发现

### 5.1 BUG-1（基线既有，建议修复）：映射文件编码不匹配
脚本写 `<默认目录>\<id>.dir` 用 UTF-8（无 BOM），VBS/PS 处理器按 ANSI（CP936）读取；非 ASCII StateDir 路径 → 处理器解析出乱码路径 → 回落默认目录 → 等待方（私有 StateDir）永远看不到结果 → 超时（fail-closed，不误批准）。**影响面**：仅手动私有 -StateDir 且路径含非 ASCII 的用法；插件默认流程 StateDir 恒为 ASCII 默认目录，不受影响。证据：`logs/e6-handler-debug.log`（target 回落）vs `logs/ascii-map-debug.log`（ASCII 正常）。修复建议（任选其一，改动均在 C 独占文件内）：处理器读取后同时尝试 UTF-8 解码；或脚本改写 ANSI（System.Text.Encoding.Default）。

### 5.2 URI 全局注册漂移（流程风险）
进入时段时值已被其他 agent 从生产路径（09-29 探针）改到 `D:\codex\dsh-approval-center-B\scripts\...`（B 的 worktree）。本次按用户指令以"进入时值"为恢复目标并已逐字恢复。**建议：全员约定非独占时段禁止改 HKCU URI 注册。**

### 5.3 桌面真人交互干扰
测试期间桌面存在真人，多次在 toast 弹出后数秒内点击"批准"（E3 系列 4 次 exit 0、E4 首次击杀前已被结算、E5 第 3 路批准）。这本身证明真实点击路径工作正常，但使"无人应答"用例难以稳定复现。**后续无人值守自动测试需独立 Windows 用户/VM。**

### 5.4 测试方法说明
S3–S12 的 E 系列通过**协议激活**（`explorer.exe "dshapproval:approve/<token>"`）替代人工点击按钮——这是 Windows 处理 toast 按钮点击的同一激活路径（ShellExecute 协议激活），toast、注册表、处理器、状态文件全部为真实组件；与真实点击的差异仅在"是否由人手触发"。宿主 asked/decided 配对、工具是否执行等 turn 级证据需真实会话，见 PENDING。

## 恢复自检记录

- uri-after 查询值：`"C:\Windows\System32\wscript.exe" //B //Nologo "D:\codex\dsh-approval-center-B\scripts\approval-uri-handler.vbs" "%1"`（= 进入时值，SELF-CHECK PASS，逐字一致）
- 通知中心 after 计数：**3**（与进入时基线完全相同，均为 B 的 dsh-result 回执；本会话 toast 全部结算移除，无 dsh-approval 组残留）
- data-dir 残留检查：两个测试 StateDir 均**空**；默认目录中本会话产生的 3 个孤儿文件（b2c3/e8f9/f9a0）已按 token 清除；B 的 6253841dfa394b3282b85736dec376af.pending/.result（12:01 遗留）非本会话产生，保留待 B 处理
- 调试环境变量：`DSH_APPROVAL_DEBUG`/`DSH_APPROVAL_DEBUG_LOG`（HKCU\Environment）已删除
- 独占时段：**已释放**（2026-09-30 13:30 后其他 agent 可恢复真实 Toast 测试）

## 遗留 PENDING 清单

- PENDING-1：V01–V04/V06/V08 的**宿主级**证据（asked/decided 配对、工具是否执行、宿主返回值）——需真实 LLM turn 或受控测试工具驱动真实宿主；建议由 A/B 在 CI 或有凭据环境补齐
- PENDING-2：V04 timeoutAction=approve 实机、V08 大批次、V14 HMR/禁用时活动请求实机、V16 子代理通知实机——需真实会话
- PENDING-3：GitHub Actions CI 首轮结果（A 跟踪）
- 详见 `D:\codex\dsh-approval-center-017-agent-handoff-C-issues.md`（多 agent 协同交接单）

## 签名

- 执行人：Agent C
- 时段：2026-09-30 12:59–13:30（独占）

## 7. 复测轮（2026-09-30 14:34–14:45，新包，独占时段）

| 项 | 值 |
|---|---|
| 新包 | `D:\codex\dsh-approval-center-0.3.1-rc.1-t6-issue1.tgz` |
| SHA256 | `9F13E71BF14F26D9D4840032DA3C5409CBCE43F93CBA47BA0F61B947E25ECFA8`（实测一致 ✓，由 Agent 3 构建，merge commit c86c66a/70cb25c，HEAD 11f55c2） |
| 包内容核验 | 19 条目；包内 approval-toast.ps1:322 已是 `[System.Text.Encoding]::Default`（UTF8Encoding 仅剩日志/PID 两个无害行）；BOM EF BB BF 完好 |
| 桌面复审 | test:unit 含全部 8 个 test 文件（Agent 3 修复的接线缺口确认：unicode-mapping 已纳入，98 项口径成立） |

| 用例 | 操作 | 结果 |
| --- | --- | --- |
| **E6-R（T6 唯一 FAIL 项）** | 新包 + 中文+空格 StateDir 端到端：真实 toast → 协议激活 approve | **exit 0 ✓**；映射目录内结果自清；默认目录无孤儿——**ISSUE-1 修复实机生效** |
| R2 | ASCII StateDir reject | exit 1 ✓ |
| R3 | 0.6s 强杀 → .pending+result 双残留 → -CleanupToken | 双清 exit 0 ✓，residual=0 |

- 恢复：URI/AUMID 逐字恢复进入时值（本轮=生产路径 `C:\Users\A\.dsh\profiles\web\...`，SELF-CHECK PASS + 独立 reg query 佐证）。
  restore-uri.ps1 自检已改为"从 .reg 备份提取期望值+归一化比对"（硬编码期望值过期误报的教训已写入脚本头注释）。
- 通知中心：dsh-approval 组残留 0；总数 11（3 条进入时基线 + 8 条无法归属的 dsh-result，维持保留）。
- 测试 StateDir 全空；测试安装已卸载（隔离 profile 恢复空插件状态）。
- **独占时段已释放（14:45）**。

### G2 结论明细
- 通道层：T6 首轮 E 系列 + 本轮 E6-R/R2/R3 全 PASS。
- 宿主层：Agent 2 宿主级证据（PASS 8）经 C 复审通过；V16 真实子代理会话 PENDING（无测试凭据）。
- 自动层：G1 第 3 轮 PASS（98/98 unit + 21/21 integration + 19 条目三方全等，Agent 3）。
- 未阻断但须声明的 PENDING：V16 真实会话、CI 首轮（需 PR 或推 main 触发）、V04/V08 大批次仅受控小批次覆盖。
