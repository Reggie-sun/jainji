# Video Library Result Timeout Repair

## Scope

修复账号原视频库清空在尾页、空库及删除结果列表滞留时的 `page.waitForFunction: Timeout 30000ms exceeded`。唯一业务改动 owner 为 [QianchuanVideoLibraryPage](../src/main/qianchuan-video-library-page.ts)，回归位于 [page tests](../tests/qianchuan-video-library-page.test.ts)。[clear lifecycle](../src/main/qianchuan-video-library.ts)、定时触发账本、删除授权及历史审计解释保持既有合同。

## Evidence And Correction

截图显示楚风生活（广告主 `1876956000684231`）清空暂停，上次列表剩余 2 条，其他五个账号报告空库。仅凭截图无法确定两个 30 秒 predicate 中哪一个超时，也无法重建当时 DOM。

源码和隔离浏览器复现确认：旧实现对已完整呈现的尾页/空库仍切换每页数量；空库移除分页控件后 predicate 等不到总数。删除结果 predicate 还读取所有表格的行，隐藏旧表会阻止当前空表被识别。列表滞留时也没有只读核对机会。

修复后的行为：

- 已校验并完整显示的最多 50 条尾页（包括空库）直接使用当前列表，避免无必要的异步容量切换。
- 容量切换允许既有准入条件下的显式空库；删除结果只消费唯一可见表，空库选择器与 `read()` 对齐。
- 仅删除结果 predicate 的 `TimeoutError` 进入恢复。先重新核对当前账号、空筛选和同一 Document；仍无进展才至多刷新一次，并校验新导航的绑定账号、未筛选首页响应和当前 DOM。新列表仍无进展或响应非法则暂停。
- 恢复不重新勾选、不重新弹窗、不重发确认、不重跑 `beforeConfirm`。账号/筛选/Document 漂移或取消阻止刷新；其他异常按原路径停止。
- 确认弹窗、待核查标记、原账号锁和执行预算仍由原 owners 管理。不会重放历史未知删除。

## Verification

四项新增回归在旧源码上均实际失败，再在修复候选上通过。最终 `npm test -- tests/qianchuan-video-library-page.test.ts tests/qianchuan-video-library.test.ts` 为 2 files / 47 tests PASS，无 skip；`npm run typecheck` exit 0。

新增浏览器 fixture 覆盖空库保留容量控件、删除后容量重置、切换期间空库、隐藏旧表、列表滞留、刷新仍不变、刷新响应失败，以及账号/筛选/Document/取消漂移；直接核对只发一次确认、最多一次刷新。fixture 将等待缩短至 500ms，生产预算仍为 30 秒。

本次 task 的 owned scope、project Harness、completion 与最终 Risk Gate 回执保存在忽略目录 `.agent/harness/runs/20261012-library-timeout/`。本记录不代替这些实际回执。相邻会话的业务改动不属于本次提交；共享 AOCI 的机器完整批次按 CAS 维护，提交仅携带本任务对应资产变更。

## Read-only Platform Observation

通过原账号 Chrome 绑定和 canonical `connectVideoLibrary` 只执行 `open()` / `read()`，得到 `{ "total": 0, "ids": [] }`。没有勾选、确认删除或重写历史状态；旧 pending 标记 SHA-256 为 `73c2d4ee14441b95d58ed81bb4c6155073277d410b4fc4f780a5e727da1329f3`。

当前空库不证明新代码经历了真实平台删除。截图旧错误属于历史记录，不能因当前只读结果而改写为成功。未执行新的真实账号清空，也未做 Windows 实机验收。

## Delegated Investigation

受管 Kimi `deep` 只读调查使用 sealed contract `84f7af4e-90d8-4d8e-9808-f48b81b84387`，invocation `438347ab-090e-4087-8bf2-04c569275e7b`，实际 route 为 `k3` / `max`，receipt 为 PARSED / exit 0，未截断。调查基于修改前精确源码，仅属诊断，不作为最终 implementation review。

Parent 接纳“隐藏旧表行影响空库判定”及“空库判定与 canonical read 不一致”的可复现证据，并补充容量与只读恢复回归；不把其最可能原因推断当作截图事故的已证实根因，也不引入第二套列表 owner。
