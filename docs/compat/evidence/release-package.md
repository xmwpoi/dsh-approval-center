# v0.3.1-rc.1 发布文档包核验

用户已授权在文案完成后发布 GitHub prerelease。日期：2026-09-30。

- 运行验收基线：Unicode 候选 SHA256 `7002324BF8B19749BAC058FB18306711FC76F0DB3FE7A6C1EAF4BCEC0F6ACB4A`，C G2 限定范围通过。
- 文档构建提交：`c7f81e0`；仅修改 README、CHANGELOG、Release 文案与发布草稿流程，未改变运行源码/脚本/配置。
- 最终附件：`D:\codex\dsh-approval-center-release-0.3.1-rc.1\dsh-approval-center-0.3.1-rc.1.tgz`。
- SHA256：`22340c50276672e94a3821079f1521f5f17f88eeeb0af4fcc766fbaf303a3821`。
- npm pack/prepare 构建通过，19 项清单与实机候选相同；逐项 SHA256 对比，仅 `README.md`、`CHANGELOG.md` 不同，**17/17 个其余文件逐字节相同**。
- 检验包含全部 lib JS/声明、四个脚本、package.json、patch、LICENSE；不以 Git diff 代替归档字节比对。
- SHA256SUMS.txt 与附件同时提供；公开前应从 Draft Release 下载附件复算 SHA，确认只有一个目标 tgz，再公开为 prerelease。

发布工作流先创建 Draft，并重跑类型/构建/98 单测/21 集成。Runner checkout 换行策略可能令重新 pack 的 SHA 不同，草稿附件必须与本记录固定附件核验；本次公开以此固定 tgz 为准，不直接公开未经比对的重打包产物。

本文关闭因发布文案而重打包的字节等价核验，不扩展 G2/G4 范围。V16 完整真实子代理会话、大批次实机与生产升级后回装仍未验证。生产 profile 未改动。
