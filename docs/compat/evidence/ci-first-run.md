# GitHub Actions 首轮记录

日期：2026-09-30。Draft PR [#2](https://github.com/xmwpoi/dsh-approval-center/pull/2)，首轮 [Actions run 36704469676](https://github.com/xmwpoi/dsh-approval-center/actions/runs/36704469676)，commit `760e5b419b1bc541dd41ccd429a175cfc6cfc265`。

| job | 结果 | 证据 |
|---|---|---|
| `check` | **FAIL** | typecheck/build 通过；`test:unit` 98 项中 95 PASS、3 FAIL、0 skip。失败均在 `test/dialog.unicode-mapping.test.js`：VBS 中文映射、PS 回退中文映射、旧 UTF-8 对照。见 [check job](https://github.com/xmwpoi/dsh-approval-center/actions/runs/36704469676/job/109851338428)。 |
| `integration` | **SKIPPED** | `needs: check`，强制目标版 21 项未在首轮 CI 执行。见 [integration job](https://github.com/xmwpoi/dsh-approval-center/actions/runs/36704469676/job/109851947250)。 |

初步定位：ISSUE-1 的首轮修复把 `<id>.dir` 映射写成系统 ANSI。中文本机代码页可表示中文路径，英文 Windows runner 的 ANSI 代码页可能无法表示；此时映射在写入时已损失字符，处理器不可能找回原目录。正在改用不依赖代码页的统一 Unicode 格式并复测。此结论仍需下轮 CI 验证；首轮不得标成 G1/CI PASS。
