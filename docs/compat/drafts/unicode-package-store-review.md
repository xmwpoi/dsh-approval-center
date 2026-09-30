# Unicode 新包（7002…）存储代码比对与 G4 回滚证据范围复核（Agent D，只读）

日期：2026-09-30。依据派发单 §Agent D：解包新 SHA 比对存储代码、审阅最新 T7b 与 D 清单注记的 G4 范围。全程只读（临时解包已清理），未触碰生产写路径、未运行通知脚本、未改 package/lib/workflow。

## 0. 固定输入（全部实测核验）

| 项 | 值 | 核验 |
|---|---|---|
| 新候选包 | `D:\codex\dsh-approval-center-unicode-candidate\dsh-approval-center-0.3.1-rc.1.tgz` | SHA256 实测 `7002324BF8B19749BAC058FB18306711FC76F0DB3FE7A6C1EAF4BCEC0F6ACB4A` = 派发单一致 |
| 包内容 | 19 文件；version `0.3.1-rc.1`；peer 精确 `@deepseek-ai/dsh: 0.1.7-rc.2` | 解包核验 |
| 主仓 HEAD | `d642c22`（仅补证据，入包文件不变）；构建 commit `77cd166`、修复 commit `637163f` | git log |
| 比对基准 | 首轮已审计旧包 `7CE7ACAD…F819D`（D 2026-09-30 逐行存储审计的载体） | 同机留存 tgz |
| 已作废链 | `9F13…`（ISSUE-1 修复轮）、`9E0E…`（doc-only 重打包）均不参与本轮结论 | 主仓 T7b 注记 |

## 1. 存储代码比对结论：机制未变，既有审计继续有效

| 比对 | 结果 |
|---|---|
| `lib/store.js` 新包(7002) vs 首轮已审计包(7CE7) | **逐字节 IDENTICAL** |
| `lib/index.js` 同上 | **逐字节 IDENTICAL** |
| `lib/queue.js` / `lib/dialog.js` / `lib/host-contract.js` 同上 | **逐字节 IDENTICAL** |
| 新包 lib 五模块 vs 主仓 HEAD `lib/`（构建树） | **逐字节 IDENTICAL** |
| scripts 差异 | 仅 `approval-toast.ps1`（12 diff 行）、`approval-uri-handler.ps1`（4）、`approval-uri-handler.vbs`（18）三个脚本不同——正是 `637163f` 跨代码页映射修复的改动面；`toast.ps1` 相同 |

**结论：跨代码页修复只动了脚本层，存储运行代码（实例锁、恢复 pending→unavailable、settle 幂等终态门、StoreClosedError、index 的审计失败处理与批准降级）与 D 首轮逐行审计的包完全一致，审计结论原样适用于当前候选包，无需重审。** 首轮审计报告（t7b-store-audit-and-rollback-checklist.md §1）对本 SHA 继续生效。

## 2. G4 回滚证据范围复核：与 T7b 注记一致，口径未被夸大

对照 `T6-results.md` S13 与最新 `t7b-release-readiness.md`：

**G4 已做（PASS，限定范围）**：
- 隔离安装的 `plugin remove` 后 dump-config 0 实例；
- 生产 0.3.0 保持原状未被替换；生产 `approvals.db` 仅**只读**打开（33 行，WAL）；
- URI/AUMID 逐值恢复。

**G4 未做（不得宣称）**：
- **生产升级后回装 0.3.0 未演练**；
- 我清单中的 R1–R5 是故障触发预案，当前状态"不适用，未触发"，**不能勾 PASS**；
- S10 禁用/HMR 时有活动请求的结算未实机（宿主层由 T5 21/21 覆盖，标"部分 PASS"属实）；
- V16 完整真实子代理会话、大批次并发（V08 仅 5+5）、生产回装均 PENDING。

**结论：A 在 D 清单文首的 T7b 注记和最新 T7b 评估对 G4 范围的表述与底层证据一致，没有把预案写成已执行，没有把只读访问写成生产升级演练。** 新 SHA 的 G2 尚未签收，发布阻断状态判断正确。

## 3. 对执行清单的两个使用提示

1. **P5 步骤的 SHA 必须用当前值**：`7002324BF8B19749BAC058FB18306711FC76F0DB3FE7A6C1EAF4BCEC0F6ACB4A`；清单历史正文里的 `7CE7…` 已作废（A 注记已声明），后续如出四轮包，以 A 通知的最新 SHA 为准。
2. §2"待实机验证"表对当前新包整体适用，其中脚本相关项（中文+空格 StateDir、VBS 主路、PS 回退、强杀定向清理命中中文映射目录）由 C 按派发单 1–5 执行；存储相关项（审计终态对照、锁生命周期、双实例拒绝、回滚库可读）不受脚本修复影响，但**实机证据仍须以新 SHA 产生**。

## 4. 阻断与观察

- **阻断问题：无。**
- 既有次要观察不变（归 A，不阻塞）：懒加载下 StoreLockError 的 warn 文案"审计记录写入失败"措辞不精确。
- 发布前置不变：C 按新 SHA 完成 1–5 复测签 G2 → A 收口 G4 限定范围结论 → 用户发布决定；决定前不合 main、不打 tag、不建 Release、不改生产 profile。
