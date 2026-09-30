# T7b 发布就绪评估

日期：2026-09-30。本页记录最新门禁；T6 首轮失败及旧包 SHA 保留在 [T6 原始记录](./windows/t6/T6-results.md) 与 [G1 分轮记录](./g1-automatic-gate.md) 中，不作为当前候选结论。

**结论：适配与本地验收已达到候选状态；文案更新包待 C 确认 G2 证据适用范围，GitHub Actions 首轮仍 PENDING，因此尚未签发发布许可。** 未发布、未打 tag、未改生产 profile。

## 门禁与范围

| 门 | 结论 | 证据与边界 |
|---|---|---|
| G0 契约 | PASS | [冻结契约](../contract-017.md)，目标宿主 `0.1.7-rc.2` |
| G1 本地自动门 | PASS | [第 3 轮记录](./g1-automatic-gate.md)：typecheck/build、98/98 单测、21/21 目标宿主集成、隔离安装后 21/21、包内 19/19 文件逐字节一致 |
| G2 Windows 实机 | PASS（限定范围） | [C 的 T6 §7 复测](./windows/t6/T6-results.md)：新包 ISSUE-1 修复 E6-R、ASCII 回归 R2、强杀定向清理 R3；首轮真实 Toast/URI/超时/并发；宿主级 V01–V08 另见本地 `D:\codex\dsh-approval-center-2\docs\compat\evidence\host-level\V01-V08-host-evidence.md`，C 已复审。V16 完整真实子代理会话仍 PENDING（隔离环境无凭据）；V08 使用 5+5 受控批次，未覆盖 20 路大批次。 |
| G3 包完整性 | PASS | 新包 19 条目、精确 peer、隔离安装与运行入口验证，见 G1 第 3 轮。 |
| G4 隔离升级/卸载及恢复 | PASS（限定范围） | T6 S13：隔离插件卸载后配置中 0 实例；生产 0.3.0 保持原状，生产库仅只读打开并确认 33 行；URI/AUMID 逐字恢复。**没有进行生产升级后回装 0.3.0 演练**；D 的 R1–R5 是故障触发时的执行预案，不应标成已执行。 |
| GitHub Actions 首轮 | **PENDING，发布阻断** | 适配分支未推送；`ci.yml` 只在 `main` push 或 PR 时触发。应推适配分支并建立 Draft PR，确认 check 与 integration 均通过。 |

## 固定候选与版本

- 已完成 G1/G2 的候选包：`D:\codex\dsh-approval-center-0.3.1-rc.1-t6-issue1.tgz`。
- SHA256：`9F13E71BF14F26D9D4840032DA3C5409CBCE43F93CBA47BA0F61B947E25ECFA8`。
- 构建所据运行代码 commit：`70cb25c`；后续合并的 C 证据提交及 B/D 报告均未修改该候选的入包文件。
- 插件版 `0.3.1-rc.1`；宿主 peer 精确 `@deepseek-ai/dsh: 0.1.7-rc.2`。旧包 `D:\codex\dsh-approval-center-0.3.1-rc.1.tgz`（SHA `7CE7ACAD…F819D`）含 ISSUE-1，**已作废**。
- 0.1.5-rc.1 的 4 项观察用例是独立回归观察，不构成双版本支持声明。
- 包内 README/CHANGELOG 已修正并重打包：`D:\codex\dsh-approval-center-t7b-pack\dsh-approval-center-0.3.1-rc.1.tgz`，SHA256 `9E0E858B40EEE86E477EE15CC9F02A3347584AC97D54FB697186FD113B54D255`。与 C 已验收包相比，**只有这两份文档不同，17/17 个运行文件逐字节一致**；见 [比对记录](./t7b-doc-only-repack.md)。C 对新 SHA 的证据适用性复审尚 PENDING。

## 发布前剩余步骤

1. 请 C 审阅 [文案更新包 17/17 运行文件等价记录](./t7b-doc-only-repack.md)，确认 G2 结论是否可用于新 SHA；如要求快速实机烟测，则按 C 的判据补测。确认前，新包不能冒称已经按其 SHA 实机执行。
2. 推送适配分支并建 Draft PR，以 PR 触发 `ci.yml`；记录首轮 check/integration 的链接、commit 和结果。失败必须修复后重跑。
3. 发布工作流需防止手动运行直接创建 Release，并验证 tag 与 `package.json` 版本一致；RC 应标记为 prerelease。
4. 用户决定是否发布后，再合并、打 tag、运行发布流程。生产安装须按 [升级、WAL 备份与回滚清单](../drafts/store-and-rollback.md) 执行；生产回装演练未做，不能在发布说明中声称已做。

允许声明：目标版 21/21 集成、98/98 单测、新包 Windows 实机限定范围通过。必须同时说明 CI 首轮与 V16 完整真实子代理会话尚待验证，及大批次/生产回装的实际边界。
