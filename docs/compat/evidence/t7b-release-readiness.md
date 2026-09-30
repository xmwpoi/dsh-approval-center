# T7b 发布就绪评估

日期：2026-09-30。本页记录最新门禁；T6 首轮失败及旧包 SHA 保留在 [T6 原始记录](./windows/t6/T6-results.md) 与 [G1 分轮记录](./g1-automatic-gate.md) 中，不作为当前候选结论。

**结论：Draft PR 首轮 CI 发现跨代码页 Unicode 映射用例失败，当前候选发布阻断。** 正在修复并准备重新打包、复测；此前 G2 结论仅适用于当时的包。未发布、未打 tag、未改生产 profile。

## 门禁与范围

| 门 | 结论 | 证据与边界 |
|---|---|---|
| G0 契约 | PASS | [冻结契约](../contract-017.md)，目标宿主 `0.1.7-rc.2` |
| G1 当前修复树 | **PENDING** | [第 3 轮记录](./g1-automatic-gate.md)的 98/98、21/21 与 19/19 仅针对旧实机包；首轮远端 CI 95/98，修复后须重跑全门。 |
| G2 Windows 实机 | **当前修复树 PENDING** | [C 的 T6 §7 复测](./windows/t6/T6-results.md)对旧 SHA 通过；现正修改映射协议与处理器，需要 C 按新包重新确认中文+空格 StateDir、VBS 主路、PS 回退、ASCII 与强杀清理。V16 完整真实子代理会话仍 PENDING；V08 仅 5+5 受控批次。 |
| G3 包完整性 | **当前修复树 PENDING** | 旧包已做 19 条目、精确 peer、隔离安装；脚本变动后须重打包并重新核验。 |
| G4 隔离升级/卸载及恢复 | PASS（限定范围） | T6 S13：隔离插件卸载后配置中 0 实例；生产 0.3.0 保持原状，生产库仅只读打开并确认 33 行；URI/AUMID 逐字恢复。**没有进行生产升级后回装 0.3.0 演练**；D 的 R1–R5 是故障触发时的执行预案，不应标成已执行。 |
| GitHub Actions 首轮 | **FAIL，发布阻断** | Draft PR #2 的 [run 36704469676](./ci-first-run.md)：`check` 95/98，3 个 Unicode 映射测试失败；`integration` 因依赖关系跳过。修复后须确认两个 job 均 PASS。 |

## 历史候选与版本（当前修复树尚未重打包）

- 已完成 G1/G2 的候选包：`D:\codex\dsh-approval-center-0.3.1-rc.1-t6-issue1.tgz`。
- SHA256：`9F13E71BF14F26D9D4840032DA3C5409CBCE43F93CBA47BA0F61B947E25ECFA8`。
- 构建所据运行代码 commit：`70cb25c`；后续合并的 C 证据提交及 B/D 报告均未修改该候选的入包文件。
- 插件版 `0.3.1-rc.1`；宿主 peer 精确 `@deepseek-ai/dsh: 0.1.7-rc.2`。旧包 `D:\codex\dsh-approval-center-0.3.1-rc.1.tgz`（SHA `7CE7ACAD…F819D`）含 ISSUE-1，**已作废**。
- 0.1.5-rc.1 的 4 项观察用例是独立回归观察，不构成双版本支持声明。
- 包内 README/CHANGELOG 已修正并重打包：`D:\codex\dsh-approval-center-t7b-pack\dsh-approval-center-0.3.1-rc.1.tgz`，SHA256 `9E0E858B40EEE86E477EE15CC9F02A3347584AC97D54FB697186FD113B54D255`。与 C 已验收包相比，**只有这两份文档不同，17/17 个运行文件逐字节一致**；见 [比对记录](./t7b-doc-only-repack.md)。C 对新 SHA 的证据适用性复审尚 PENDING。

以上两个 SHA 均**不含正在修复的 UTF-16 LE 映射协议**，不得用作下一轮发布候选。脚本变化使文案更新包的 17/17 等价结论只具历史意义；新包待远端 CI 与实机复测后再固定。

## 发布前剩余步骤

1. 修复跨代码页映射并重跑 Draft PR 的完整 CI；新包固定 SHA 后，C 必须按新包实测中文+空格 StateDir 的 VBS 主路、PS 回退、ASCII、强杀定向清理及 URI/AUMID 恢复。旧包的 17/17 等价不能替代该复测。
2. 推送适配分支并建 Draft PR，以 PR 触发 `ci.yml`；记录首轮 check/integration 的链接、commit 和结果。失败必须修复后重跑。
3. 发布工作流需防止手动运行直接创建 Release，并验证 tag 与 `package.json` 版本一致；RC 应标记为 prerelease。
4. 用户决定是否发布后，再合并、打 tag、运行发布流程。生产安装须按 [升级、WAL 备份与回滚清单](../drafts/store-and-rollback.md) 执行；生产回装演练未做，不能在发布说明中声称已做。

当前仅可声明：旧候选在本地完成目标版 21/21 集成、98/98 单测与限定范围 Windows 实机测试；首轮远端 CI 95/98，当前修复树待 CI/实机复测。V16 完整真实子代理会话、大批次/生产回装仍有上述证据边界。
