# T7b 发布文案重打包核验

日期：2026-09-30。目的：README/CHANGELOG 更新 T6 结论后，确认重打包未改变 C 已实机验证的运行内容。

| 项 | 值 |
|---|---|
| C 已验收包 | `D:\codex\dsh-approval-center-0.3.1-rc.1-t6-issue1.tgz` |
| C 已验收包 SHA256 | `9F13E71BF14F26D9D4840032DA3C5409CBCE43F93CBA47BA0F61B947E25ECFA8` |
| 文案更新包 | `D:\codex\dsh-approval-center-t7b-pack\dsh-approval-center-0.3.1-rc.1.tgz` |
| 文案更新包 SHA256 | `9E0E858B40EEE86E477EE15CC9F02A3347584AC97D54FB697186FD113B54D255` |
| 生成 | `npm pack --pack-destination D:\codex\dsh-approval-center-t7b-pack --cache D:\codex\dsh-approval-center-t7b-pack\npm-cache --json`；prepare/tsc PASS；19 条目 |
| 比对 | 两包分别解包，文件清单相同；逐文件 SHA256 比较，**仅 `README.md` 与 `CHANGELOG.md` 不同，其余 17/17 文件逐字节相同**，含全部 `lib/`、脚本、patch、package.json |
| 静态检查 | `npm run typecheck` PASS、`git diff --check` PASS；运行逻辑未改 |

这项比对证明运行文件和 C 实机验收包相同，**不把新 SHA 冒称为 C 已经独立实机执行过的 SHA**。建议 C 审阅本记录和 17/17 比对结论，书面确认 G2 对文案更新包的适用范围；若 C 要求按新 SHA 再做快速实机烟测，以其结论为准。CI 首轮仍需由 PR 触发并取得 PASS。
