# 审计存储单实例约束与回滚说明（T4 文档素材草案）

编制：Agent D（T4）。日期：2026-09-29；2026-09-30 合并后复核并补齐操作清单。基线：插件 `f608abd`（v0.3.0），目标宿主 DSH 0.1.7-rc.2。
本文是**草案**，供 Agent A 在 T7 整合进正式 README/CHANGELOG；冻结签名见 [contract-017.md](../contract-017.md) §4.4。

## 0. 合并后存储调用复核结论（2026-09-30）

对合并树 `adapt/dsh-017-host@352b2da` 的存储调用点逐项复核：

| 调用点 | 复核结论 |
|---|---|
| 懒加载建 store，`owner: { identity: 'dsh-approval-center' }` | ✓ 符合契约 §4.4 |
| insert 失败（含 StoreLockError）→ 告警 + 返回 `'unavailable'`，不弹审批 | ✓ 符合计划 §3.4 |
| settle 失败 → 告警；批准结果未落审计时改判 `'unavailable'`，不放行 | ✓ 符合计划 §3.4（reject/timeout 无需降级，本就 fail-closed） |
| close 后 settle 抛 `StoreClosedError` → 被 index 捕获只告警 | ✓ 符合契约 §4.6 步骤 4 |
| 关闭顺序：`queue.close()` 等活动 worker 结算 → `store.close()` | ✓ 符合修订版 §4.6（5af1091 修订后无需额外 pending 扫尾） |
| 审计保存原始 `reason`，displayReason 只进展示层 | ✓ 符合契约 §2.2 |
| `src/store.ts` 自合并以来零改动 | ✓ diff `adapt/dsh-017-store..HEAD` 为空 |
| 合并树全量测试 | ✓ 89/89 PASS，`tsc --noEmit` PASS |

**无具体失败，未修改存储代码。** 一条不阻塞的观察（A 可酌情处理，属 index.ts 文案）：StoreLockError 在懒加载下于首次审批时才触发，warn 文案为"审计记录写入失败"，诊断信息里已含锁 owner 明细，可定位但措辞不精确。

## 1. 同 dataDir 单活跃实例约束

### 1.1 为什么必须单实例

插件数据库目录（默认 `$DSH_HOME/approval-center`，可用 config 的 `dataDir` 覆盖）中只有一份 `approvals.db`。SQLite WAL 模式本身允许多连接读写，但插件在**打开数据库时会执行启动恢复**（把残留 pending 批量改写终态）。若两个插件实例共享同一 dataDir，第二实例的恢复会把第一实例**仍在等待用户点击的审批**误改状态——这不是理论风险，已用旧版代码复现：

> 复现证据（2026-09-29，Node v24.20.0，Windows，隔离临时目录）：
> 旧版（`f608abd`）实例 1 insert 一条 pending 审批后，实例 2 仅构造（不做任何操作），该行 status 即从 `pending` 变为 `timeout`。复现脚本：`.t4-tmp/repro-multi-instance.mjs`（基线 `f608abd:src/store.ts`）。

### 1.2 本轮方案：dataDir 内锁文件（不做分布式租约）

- 打开数据库**之前**，在 dataDir 内创建 `approval-center.lock`（`O_EXCL`，天然防并发抢占）。
- 锁内容（JSON）：`schema`、`identity`（owner 身份）、`hostname`、`pid`、`acquiredAt`、`nonce`（随机，防止误删他人锁）。
- 锁被占用时：新实例抛 `StoreLockError`（错误信息含对方 owner 诊断），**不打开、不改写任何数据**。
- `close()` 时按 nonce 匹配删除自己的锁文件。

### 1.3 用户须知

**同一 dataDir 只允许一个活跃插件实例。多个 DSH 实例/多个 agent 需要各自审批审计时，为每个实例配置独立的 `dataDir`。** 锁冲突时插件启动失败并给出 owner 诊断，不会静默共享。

## 2. 锁生命周期与异常排查手册

### 2.1 正常生命周期

| 阶段 | 行为 |
|---|---|
| 首次审批触发懒加载打开 | 创建锁文件（失败=冲突，进入 2.2 判定） |
| 运行 | 锁文件保持存在 |
| 正常关闭/卸载 | 删除自己的锁文件（nonce 匹配才删） |

### 2.2 异常场景与处理

| 场景 | 现象（StoreLockError message 特征） | 自动处理 | 人工处理 |
|---|---|---|---|
| 已有活跃实例 | `同 dataDir 已有活跃实例 … owner: identity=… pid=…` | 无（这是正确行为） | 确认是否本应有第二实例；是→改独立 dataDir |
| 异常退出残留（进程已死） | 无报错 | **自动回收**（先核对锁内容未被抢占，再删除重建） | 无需干预 |
| 跨机共享目录 | `实例锁由其他主机持有，无法验证存活，保守拒绝` | 无 | 到锁内 owner 所在主机确认实例已停后，删除锁文件 |
| PID 重用/存活无法判定 | `pid=… 存活状态无法判定（可能 PID 重用），保守拒绝` | 无 | 核实锁内 pid 对应进程身份；确认无活跃实例后删除锁文件 |
| 锁文件损坏（非 JSON） | `实例锁内容损坏 … 原始内容: …` | 无 | 确认无活跃实例后删除锁文件 |
| 读取/删除锁时权限错误 | `保守拒绝 …: EPERM/EACCES …` | 无 | 检查目录权限后重试 |

**铁律：锁文件只能在没有活跃实例运行时手工删除。不确定时，先停掉所有 DSH 实例再处理。** 绝不为了"让插件能启动"而绕过锁去改别人的 pending 数据。

## 3. 崩溃恢复语义：pending → unavailable

打开数据库**并取得锁之后**，把历史残留 pending 一律结算为 `unavailable`：

- 含义：上一个实例**崩溃或被关闭**时，这些审批没有完成人工决策。宿主侧对应 `unavailable`（fail-closed，模型收到拒绝语义）。
- 与其他状态的区别（对应契约 §4.5）：
  - `timeout`：**只在真实展示超时**（窗口内无人应答）时由 dialog 结算，不再用于崩溃恢复——不把崩溃伪装成超时；
  - `cancelled`：宿主/用户主动撤回；
  - `unavailable`（恢复产生）：插件自身未能完成决策。
- 审计用途：升级后可据 `unavailable` 行排查"该请求当时是否实际执行了工具"，避免把失控执行误读为正常审批流。

## 4. 升级清单（0.3.0 → 候选版，目标宿主 0.1.7-rc.2）

前置（停机面）：

- [ ] 记录当前插件版本与安装来源（commit/tgz SHA256），备份 profile 的 package/lock/patch 与兼容记录
- [ ] 确认无未决审批：通知中心没有等待中的审批 Toast（等不到就先处理或接受 §3 的恢复语义）
- [ ] **停旧实例**：禁用/卸载 0.3.0（旧版无锁，新旧混跑不受保护，必须先停）
- [ ] 检查 dataDir 无残留锁：`approval-center.lock` 不存在；存在→按 §2.2 排查（先确认无活跃进程，再手工删除）
- [ ] （推荐）按 §5 完成升级前备份

安装与验证（运行面）：

- [ ] 安装候选 tgz（记录 SHA256）；先用独立 DSH_HOME + 独立 dataDir 的测试环境完整走一遍
- [ ] dump-config 确认：仅一个 approval-center 实例、peer 满足 0.1.7-rc.2、无版本豁免、schema 无错误
- [ ] 触发真实审批各一条：批准、拒绝——宿主结果与审计行终态一致
- [ ] 确认 dataDir 出现 `approval-center.lock` 且运行期间存在、正常关闭后消失
- [ ] 启动/运行日志无 `StoreLockError` / `StoreWriteError` / 审计告警
- [ ] 重启宿主一次：已终态历史记录原样保留，无误改

## 5. WAL 一致性备份清单

- [ ] **首选停机备份**：停插件实例后完整复制 `approvals.db` + `approvals.db-wal` + `approvals.db-shm` 三件套
- [ ] **运行中备份必须走 SQLite backup 通道**，两种等价方式（本机 Node v24.20.0 实测可用）：
  - Node 自带 API：`node -e "const {DatabaseSync,backup}=require('node:sqlite');(async()=>{const db=new DatabaseSync('<dataDir>/approvals.db');await backup(db,'<backup>/approvals-<日期>.db');db.close()})()"`
  - sqlite3 CLI：`sqlite3 <dataDir>/approvals.db "VACUUM INTO '<backup>/approvals-<日期>.db'"`
- [ ] **禁止只复制 `approvals.db` 主文件**：WAL 下最近结算可能还在 `-wal` 里，得到失真旧快照
- [ ] 恢复演练：在隔离目录用备份文件启动新实例，核对记录数、终态分布、无残留 pending（有则按 §3 语义变 unavailable）
- [ ] 备份标签记录：插件 commit、宿主版本、DSH_HOME/dataDir、备份时间

## 6. 回滚清单（候选版 → 0.3.0）

- [ ] 停候选实例，等待未决审批结束（来不及就先备份再停——旧版会把 pending 全标 timeout，见下）
- [ ] **停机备份当前库**（§5 三件套）：回滚后旧版打开即把所有 pending 全量改写为 `timeout`（含 §1.1 的多实例误伤行为），备份是唯一保真手段
- [ ] 恢复备份的 profile package/lock/patch（0.3.0）
- [ ] 重启后验证一条真实批准/拒绝走通
- [ ] 确认 URI 注册指向当前有效安装，不指向已删除的测试目录
- [ ] 核对审计库可读（表结构与状态词汇两版一致，旧版可读候选版写入的库；反向读取见 §7 PENDING）
- [ ] 记录回滚原因与时间，关联候选 tgz SHA256

## 7. PENDING（未验证项，不冒称已验证）

| 项 | 状态 |
|---|---|
| 新旧版本实际混跑行为 | PENDING（本轮明确不承诺兼容，未测） |
| 真实 kill -9 崩溃后的锁回收（非模拟死 pid） | PENDING（测试用已退出子进程模拟死 pid） |
| 备份恢复的实际演练 | PENDING（备份命令本身已实测可用，见 §5） |
| 旧版读取候选版写入的库 | PENDING（结构/词汇不变，理论可读；未实测） |
| Windows 多用户场景下锁文件权限行为 | PENDING |
