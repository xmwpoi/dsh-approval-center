# 最终发布评估：dsh-approval-center 0.3.1-rc.1 × DSH 0.1.7-rc.2（Agent A，2026-09-30）

收口对象：Unicode 修复轮候选。本文件是 T7b 终稿，取代 [t7b-release-readiness.md](./t7b-release-readiness.md)（其中旧 SHA `7CE7…`、`9F13…`、`9E0E…` 均已作废，仅作历史记录）。

## 结论

**发布候选技术就绪：G0–G3 全部 PASS，G2/G4 以限定范围 PASS。待用户作正式发布决定；决定前不合 main、不打 tag、不建 Release、不改生产 profile。**

## 唯一有效候选

| 项 | 值 |
|---|---|
| 包 | `D:\codex\dsh-approval-center-unicode-candidate\dsh-approval-center-0.3.1-rc.1.tgz` |
| SHA256 | `7002324BF8B19749BAC058FB18306711FC76F0DB3FE7A6C1EAF4BCEC0F6ACB4A`（A 实测 = 派发单 = C/D 复核） |
| 构建 / 修复 commit | `77cd166`（包）/ `637163f`（跨代码页修复，仅动 3 个脚本） |
| 版本 / peer | `0.3.1-rc.1` / 精确 `@deepseek-ai/dsh: 0.1.7-rc.2` |
| 主仓 HEAD | `1f35128`（仅证据合并，入包文件不变；lib 与 `1f35128` 构建树逐字节一致——A 解包复验） |

## 门禁汇总

| 门 | 结论 | 证据 |
|---|---|---|
| G0 契约冻结 | PASS | docs/compat/contract-017.md |
| G1 自动门 | **PASS** | 远端 CI 两轮双 job success：run 36707444272（@637163f，98/98 单测+21/21 集成）、36708669093（@d642c22）——A 用 gh 独立抽查与 B 的 gh API 复核（`t5-ci-independent-review.md`）一致；首轮失败（760e5b4，跨代码页缺陷）如实保留在运行历史。fixture 精确 0.1.7-rc.2 为强制门（逐包漂移断言），0.1.5-rc.1 仅观察（continue-on-error + 独立 legacy-015-observe 用例不入门禁） |
| G2 Windows 实机 | **PASS（限定范围）** | C 的 Unicode 新包复测 **5/5 PASS**（`windows/t6/unicode-retest-g2.md`，cbb225b）：中文+空格 StateDir VBS 主路 approve/reject（映射 `FF FE` UTF-16 LE BOM）、PS 回退同路径、ASCII 回归、强杀→定向双清+幂等（中文映射目录命中）、URI/AUMID 逐值恢复（SELF-CHECK+独立 reg query，通知中心总数 11 与进入时一致、本人 6 token 零残留、测试安装已卸载）。真人干扰（首跑被抢先点击）已如实记录并以 1.5s 快速激活重跑取得干净 reject |
| G3 包完整性 | **PASS** | 19/19 条目与构建树/隔离安装逐字节一致、入口可加载（`unicode-candidate.md`）；A 复验：version/peer 正确、lib 五模块=主仓 HEAD、跨代码页修复在位（toast.ps1:319 写 UTF-16 映射、双处理器 `Encoding.Unicode` 读、VBS Unicode 打开）、编码门合规（ps1 UTF-8 BOM、vbs 纯 ASCII） |
| G4 升级/回滚 | **PASS（限定范围）** | 隔离卸载后 dump-config 0 实例、生产 0.3.0 原状未替换、生产库仅只读打开（33 行 WAL）、URI/AUMID 逐值恢复。D 复核（`unicode-package-store-review.md`，88ba2fb）：新包 lib 与首轮已审计包逐字节一致，存储审计结论沿用；回滚证据口径与 T7b 注记一致、未夸大 |

## 发布前必须知情的事项（PENDING，不阻断候选、阻断"完美宣称"）

1. **V16 真实子代理会话**：无凭据未测——README 不得声称子代理通知已实机验证（自动层用例已过）。
2. **大批次实机**（V08 大批次）：仅小批次与 20 请求 mock/集成层覆盖。
3. **生产升级后回装 0.3.0 演练**：未执行；R1–R5 仍是故障预案（"不适用，未触发"），生产升级前按 store-and-rollback.md 备份并逐项记录。
4. **0.1.5-rc.1**：仅观察不承诺；不得宣称双版本支持。
5. **B 非阻断备忘**：release.yml 未重复 ci.yml 的字节级编码门（由 test:unit 运行时校验覆盖，严格度略低）；PR 合并前 CI 必绿即可覆盖；若未来允许 release 脱离 CI 单独触发，应同步该门。
6. release.yml 发布时会重新 pack——发布时需记录实际 Release 附件 SHA 并核对等于本文件 SHA。

## 用户发布决定项

- **A. 合并 PR #2 → 打 tag `v0.3.1-rc.1`**：release workflow 将重跑全套自动门后自动发布 GitHub Release（自动标 prerelease；npm publish 保持注释未启用）。
- **B. 保持 Draft**：候选维持现状，待上述 PENDING 项补齐再定。
- 无论 A/B：生产实例升级仍需单独按升级清单执行（停旧实例→备份→安装→验证→回滚预案），与本发布动作分离。
