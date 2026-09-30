# T7b 存储审计与回滚清单（Agent D）

日期：2026-09-30。编制：Agent D（只读审计 + 清单交付；本文件是唯一新增文件，无任何数据文件写入）。
用途：供 A 的 T7b 发布收口与 C 的 T6 实机执行引用，与 [store-and-rollback.md](./store-and-rollback.md)（升级/WAL 备份/回滚三清单，2fc4a25 已合入）配套。

## 0. 固定输入与审计范围

| 项 | 值 | 核验方式 |
|---|---|---|
| 候选包 | `D:\codex\dsh-approval-center-0.3.1-rc.1.tgz` | SHA256 实测 `7CE7ACAD…819D` = 交接单一致（2026-09-30 PowerShell Get-FileHash） |
| 候选 commit | `1d7d2a8`（adapt/dsh-017-host，T7a） | t7b-release-readiness.md §2 |
| 主仓库当前 HEAD | `29eac51`（T7b 发布就绪评估；G0/G1/G3 PASS，G2 阻断，G4/CI PENDING） | git log，工作区干净 |
| 门禁现状 | G1 已签发（93/93 单测含 wscript 实执行、21/21 集成）；**T6 未执行，G2/G4 未签收** | g1-automatic-gate.md、t7b-release-readiness.md |
| 审计对象 | tgz 解包 19 条目中的 `lib/store.js`、`lib/index.js`、`package.json`、scripts | 解包至临时目录（已清理），全程只读 |

## 1. 已自动验证（PASS，均含证据）

### 1.1 包内存储实现（对照 contract-017.md §4.4/§4.6）

| 检查项 | 结论 | 证据（包内 lib/store.js 行号） |
|---|---|---|
| 实例锁文件 `approval-center.lock`，`O_EXCL`（`'wx'`） | PASS | L45–46、L94 |
| 锁内容含 identity / hostname / pid / acquiredAt / nonce | PASS | L83–86、L128（owner 诊断串） |
| 死进程锁回收前二次核对锁内容未被抢占 | PASS | 与 src/store.ts 同源（见 1.3 逐字节一致），实现同 T4 测试 03 |
| 跨机 / 损坏锁 / PID 存活不明 → 保守拒绝 + 人工处理指引 | PASS | L129 起三分支 |
| 恢复在取得锁**之后**：pending → `'unavailable'`（非 timeout） | PASS | L171 |
| settle 幂等终态门：`WHERE request_id=? AND status='pending'` | PASS | L191 |
| 非法结算目标 / 未知 requestId → StoreWriteError | PASS | L7 TERMINAL_STATUSES、L187 |
| close 后访问抛 StoreClosedError；close 重复调用 no-op | PASS | L175、L186 |

### 1.2 包内审计失败处理（lib/index.js）

| 检查项 | 结论 | 证据（行号） |
|---|---|---|
| insert 失败 → 告警 + 返回 `'unavailable'`，不弹审批 | PASS | L89–90 |
| 批准结果未落审计 → 改判 `'unavailable'`，不放行 | PASS | L128、L135–136 |
| 降级后回执文案不再含"已批准"（approvalResultLabel 处理 settleFailed） | PASS | L140–141 |
| 关闭顺序：`queue.close()` 等待 worker 结算 → `store.close()` | PASS | L169–170 |
| owner identity 写入实例锁（`'dsh-approval-center'`） | PASS | L52 |
| 审计保存原始 reason，displayReason 不落库 | PASS | 与 G1 集成用例一致（g1-automatic-gate.md） |

### 1.3 包一致性与声明

| 检查项 | 结论 | 证据 |
|---|---|---|
| tgz 内 lib 五模块与仓库 `lib/` 逐字节一致 | PASS | diff -q：store/index/queue/dialog/host-contract 全 IDENTICAL |
| package.json：version `0.3.1-rc.1`、peer 精确 `0.1.7-rc.2`、engines node>=24、os win32 | PASS | 解包核验 |
| 19 个打包条目齐全（lib 五模块+声明、四脚本、cordis.patch.yml、文档） | PASS | tar 条目清单 |
| PS1 脚本 UTF-8 BOM（`ef bb bf`） | PASS | approval-toast.ps1 头三字节 |
| 与 D 三份操作清单（store-and-rollback.md §4/§5/§6）的机制描述一致性 | PASS | 锁行为、恢复语义、备份命令与包内实现逐条对上 |

## 2. 待实机验证（全部以 C 的 T6 证据为前置，未执行前一律 PENDING）

| 项 | 对应 T6/runbook | 依赖证据 |
|---|---|---|
| 从该 SHA 的 tgz 实际安装，dump-config 仅一个实例、无版本豁免 | S1–S2 | T6-results.md 对应行 |
| 真实审批（批准/拒绝/超时/撤回）审计行终态与宿主结果一致；审批后 `approvals.db` 行不残留 pending | S3–S7、V01–V04 | 同上 |
| 运行期 `approval-center.lock` 出现、正常关闭后消失；异常退出后下次启动自动回收 | S8、S14 | 同上 |
| 同 dataDir 第二实例启动被拒（StoreLockError 含 owner 诊断）且首实例数据不变 | 可并入并发/卸载项 | 实机才可验证双实例 |
| 卸载/重载时活动请求审计记 `unavailable`（自动化已覆盖，实机复核） | S11–S12、V14 | 同上 |
| 回滚到 0.3.0 后审计库可读、URI 指向有效安装 | S13、V20、G4 | **G4 唯一前置** |
| 备份命令在真实 dataDir 上演练一次（§5 三件套或 SQLite backup） | 建议并入 S13 | G4 辅助证据 |
| 深层 JSON Schema 投影、GitHub Actions 首轮 | 非 D 范围 | A/B 线 |

## 3. T7b 逐步执行记录表（安装→验证→回滚；执行者填 PASS/FAIL/PENDING + 证据路径）

前置（停机面，**执行者：C 在独占时段开始时**）：

| # | 操作 | 参照 | 记录字段 | 状态 |
|---|---|---|---|---|
| P1 | 记录当前插件版本/安装来源，备份 profile package/lock/patch | store-and-rollback §4 | 备份路径 + 文件清单 | PENDING |
| P2 | 确认无未决审批（通知中心无等待 Toast） | 同上 | 时间点确认 | PENDING |
| P3 | 停旧实例（禁用/卸载 0.3.0；**混跑不受保护，必须先停**） | 同上 | 停用方式 | PENDING |
| P4 | 检查 dataDir 无残留 `approval-center.lock`；有则按 §2.2 排查后删 | 同上 | 锁文件状态 | PENDING |
| P5 | 核对候选 tgz SHA256 = `7CE7ACAD…819D`（不符即终止，找 A） | 本文件 §0 | 实测 SHA | PENDING |
| P6 | （推荐）按 §5 完成升级前备份 | store-and-rollback §5 | 备份方式+路径 | PENDING |

安装与验证（运行面，**执行者：C**）：

| # | 操作 | 记录字段 | 状态 |
|---|---|---|---|
| I1 | 从 tgz 安装（隔离 DSH_HOME + 独立 dataDir） | 安装命令/目录 | PENDING |
| I2 | dump-config：单实例、peer 满足、schema 无错 | 输出摘录 | PENDING |
| I3 | 真实批准 + 拒绝各一条：宿主结果 = 审计终态 | requestId 对照表 | PENDING |
| I4 | `approval-center.lock` 运行期存在、关闭后消失 | 文件观察 | PENDING |
| I5 | 日志无 StoreLockError / StoreWriteError / 审计告警 | 日志路径 | PENDING |
| I6 | 重启宿主：历史终态行原样保留 | 行数/终态分布 | PENDING |

失败回滚（**触发条件任一：安装失败 / 审计终态不一致 / 锁异常无法恢复 / 决定不上线**；执行者：C 或用户，A 记录原因）：

| # | 操作 | 参照 | 记录字段 | 状态 |
|---|---|---|---|---|
| R1 | 停候选实例，等待未决审批结束 | store-and-rollback §6 | 时间点 | — |
| R2 | **先停机备份再回滚**（旧版会把 pending 全标 timeout，备份是唯一保真手段） | §6、§5 | 备份路径 | — |
| R3 | 恢复 0.3.0 profile 与插件包 | §6 | 恢复来源 | — |
| R4 | 验证一条真实批准/拒绝 + URI 指向有效安装 | §6 | 对照记录 | — |
| R5 | 记录回滚原因、时间、候选 tgz SHA256 | §6 | 交接记录 | — |

## 4. 阻断问题与观察项

- **阻断问题：无。** 包内存储实现、审计失败处理与冻结契约及已合入清单完全一致；候选 SHA 与交接单一致。
- 次要观察（不阻塞，归 A）：懒加载下 StoreLockError 首次审批才触发，index 的 warn 文案"审计记录写入失败"措辞不精确（诊断信息已含锁 owner 明细）。可在 T6 后顺手改。
- 本审计为静态只读复核 + 与 G1 自动门结果交叉；不替代 C 的实机证据（§2）。

## 5. 给 A 的结论

存储维度对 T7b 的输入已就绪：**机制层全部自动验证 PASS；执行层全部 PENDING 等 T6**。G4（升级/卸载/回滚）签发前必须有 §3 表 I 系 + R 系的实际执行记录；在此之前维持 t7b-release-readiness.md 的口径——不发布、不打 tag、不改生产 profile。
