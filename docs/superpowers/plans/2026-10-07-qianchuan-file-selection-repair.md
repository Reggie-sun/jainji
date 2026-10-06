# Qianchuan File Selection Repair Implementation Plan

## Goal

修复同一上传窗口追加分组时，原生拖拽未形成文件行而导致半批停止的软件路径；改用已核实的千川“点击上传”原生 file chooser，并保持所有 unknown outcome 安全边界。

## Evidence And Decision

一根金原页仅有前 9 条成功行，账本有 18 个 fence；肥皂原页有前 18 条成功行，账本有 27 个 fence。后续整组未出现在原页。准确的事故瞬间事件未留存，不能断言平台已接收缺行文件。当前代码以三次 CDP 拖拽事件、滚动后的区域中心及一次 hit test 投递；fixture 只覆盖无条件接收的静态 drop 区域。

当前平台公开组件以 `disabled || loading` 阻止 click/drop；点击创建 detached、multiple、accept MP4/MOV 的原生 input。2026-10-07 在独立新建的空诊断页核实了 file chooser，未调用 setFiles、未确认，原有 tabs 全保留。选择此官方用户入口作为唯一生产文件动作，消除手工拖拽坐标路径，并在选文件前有界等待入口 loading 消失。原页诊断与隔离 fixture 不构成真实上传验收。

## Scope And Ownership

Parent 串行负责以下文件；已有 Hybrid、renderer 和清理工作保留。

- `src/main/qianchuan-page-contract.ts`：入口状态、唯一 chooser 归属和组文件动作；沿用同一 session/guard/observe。
- `tests/fixtures/qianchuan-production-page.html`、`tests/helpers/douyin-cdp-fixture.ts`：以独立实现模拟平台动态 chooser、loading 和静默缺行；保留失败/身份/完成观察接缝。
- `tests/douyin-cdp-uploader.test.ts`：30 条 9+9+9+3 连续上传、原页焦点/滚动、全部新增行缺失及永久 fence。
- `tests/qianchuan-page-contract.test.ts`、`tests/qianchuan-plan-target.test.ts`、`tests/qianchuan-upload-diagnostics.test.ts`：适配实际文件动作断言，验证 busy/chooser/identity/cancel 和删除计划边界。
- `docs/douyin-auto-upload-spec.md`：当前生产入口窄修订；本文和 incident record 保存实施及证据，AOCI indexed owner 在稳定后维护。

## Contracts And Invariants

最多 9 条，有多少传多少；上一组仍 processing 时可继续追加，入口 loading 只代表当前控件暂不可操作，不以上一组 READY 为新增准入条件。每组全部 fence 同步成功后才能调用一次 chooser.setFiles；一次控件 click 失败不重放、不使用 drag 或直接网络 fallback。

chooser 必须来自本页主 frame、原 modal 内唯一入口的单次 click，符合已核实 input 的 type/multiple/accept/empty 特征。设文件之前再次核对账号、计划、原 modal、入口及已选行；任何不确定保留 fence，停止。chooser/控件等待可取消且有界，不产生遗留第二文件动作。

列表接收与 READY 仍分开；全窗口精确名称、计数、成功标记、无取消上传及确定可用才原子保存 READY。NOT_SELECTED/MAY_HAVE_UPLOADED/READY、ledger、task identity、fence、read-only recovery 均保持。历史缺行批次不会被自动重传或改写为成功；不点击确定、不改计划、不清理素材、不重启浏览器。

## Milestones And Acceptance

1. 先加入能复现忙碌入口忽略追加、动态 chooser 和坐标依赖的回归。旧实现须在至少一个有意义用例失败；修复后 30 个文件精确一次进入同一 modal，分组 9+9+9+3，之前 processing 不阻断后组，零 drop/confirm/settings。
2. 在原 page owner 实现一次 chooser 选择及 loading 准入，覆盖不匹配/缺失 chooser、身份改变、取消和整组缺行。缺行时所有未持久 READY 的已 fenced 成员 UNKNOWN，后续未选成员保持 NOT_SELECTED，恢复零文件动作。
3. 运行 typecheck、受影响测试与 owned-scope Harness；stable final candidate 再按 `SUBAGENTS.md` Review Risk Gate 裁决，维护本轮 indexed Entry/baseline并运行官方 Verify/Check/Guide。只提交本任务文件或明确 owned hunks，push 当前 upstream 并核远端 SHA。

## Self-Review And Limits

此修订在“排查并修复上传问题”授权内，复用唯一 page/store/service，不增加重传、确认或第二任务生命周期。已核实的真实 chooser 未接收文件，因此工程完成必须明确真实 30 条平台上传未评估；两批历史未知结果仍需原页人工核查。Kimi read-only explorer 的 receipt 绑定旧源码，提供拖拽送达与 fixture 盲区分析；parent 核查并裁决，不把 PARSED 当验收。
