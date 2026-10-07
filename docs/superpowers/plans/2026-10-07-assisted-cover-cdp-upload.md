# Assisted Cover CDP Upload Integration

## Goal And Scope

补齐人工覆盖/assisted 的最终确认到现有千川 CDP 上传。用户指出缺失，当前入口 `CoverReviewController.approve` 拒绝上传，`App` 也未将选择传入审阅面板。Native Codex 执行；不扩展 batch、不调用真实平台上传，不修改图案匹配。适用 [Accepted Delta](../../semi-automatic-cover-review-spec.md#approved-export-upload-delta)。

## Owners And Contract

- `CoverReviewController` 校验画面批准与只含摘要的上传选择，幂等创建所有版本，登记后启动；`shared/cover-review` 兼容旧批准缺省无上传。
- `CoverReviewPanel` 从 `App` 接收本次上传选择，仅在明确批准时送入现有 IPC，预览输入不含账号信息。确认按钮明确导出及上传意图。
- `DouyinUploadService` / `DouyinUploadStore` 独占账号预检、生产边界和原子 intents。新增薄的 `cover-review-upload` 交接复用这些 API；不持有独立队列、批准或凭据。
- 原 queue 的正式 completed 回调是唯一成片准入；compiler、覆盖冻结字节、UNKNOWN/selection fence 和平台确定按钮保持原样。

## Milestones

1. 更新批准合同并以测试复现预览零 effect、全部登记后才 start、选择更改拒绝与重复批准幂等；实现 renderer/main 交接。
2. 原上传服务支持多导出 batch 的一次原子登记，兼容旧单 batch 调用。薄交接先检查现存 ledger；全部相同则无 effect 返回，部分存在/冲突拒绝。新登记在原 browser admission 和 production boundary 中预检一次。加入真实 FFmpeg 导出接 uploader fake browser 的集成，以及本地 CDP fixture/界面交互证据。
3. typecheck、受影响测试、owned Harness、风险判定、AOCI Verify/Check/Guide 与 completion。仅提交本任务文件/索引条目并 push upstream，核验远端。

## Compatibility And Acceptance

旧批准不携带上传摘要时解释为没有上传，不能通过重复点击给历史输出追加上传。准备/冻结输入不含上传信息；选择摘要仅约束本次明确确认，不能替代主进程账号预检。登记失败保留批准和排队任务，未自动编码/上传；原 store 不确定即阻断。已有 intents 的 replay 不恢复运行权限，也不改变目标，恢复操作交原上传界面。所有版本共享一次数量授权，max-9 流式上传不改变。

## Self-Review And Delegation

CodeGraph 核对 `CoverReviewController.approve` 到原校验和 queue 的接缝；图索引伪 `if` 实体不作为真实调用证据。受管 Kimi deep 仅调查既有 upload admission/store 恢复边界，冻结范围内不编辑；调查不代替最终 review。无新增用户流程批准门，产品原最终预览确认仍必需。原素材效果已在前一任务验证，本任务重新验证上传接缝，不能拿旧 PASS 代替。

## Execution Evidence

受管 Kimi invocation `1367e801-cc10-4286-b684-6587295ebe6b` 完成只读调查（deep，k3/max，三次 wire request）；Parent 核实并采纳原单批 `registerBatch` 吞错、重新 preflight 会更换 pageBatchId 的风险。因此新增严格多批原子登记接口，单批旧行为保留；重复批准先核私有原 ledger，不重新预检。取消审阅接原 `cancelExports`；无上传仍逐版入原队列，不改变旧节奏。

定向验证包括真实 FFmpeg 人工覆盖到原上传服务、正式 artifact 路径、预览零上传、所有版本共享授权、原子登记失败无部分 intent、目标更改拒绝、重复批准幂等及取消。`scripts/assisted-cover-upload-smoke.mjs` 使用隔离 Electron、真实 Chromium/CDP 和原生产 uploader；生产域名只在测试上下文拦截到本机页面，不使用真实账号。实际操作框选、观看动态预览、选择账号/计划、确认导出上传；正式成片达到 `WAITING_FOR_CONFIRMATION`，重复批准不选文件，平台 confirm/settings 点击均为零。测试夹具初始化期间发现并修正 ESM 外部依赖、默认覆盖字段、计划分页和 UTF-8 声明问题；失败记录不算 PASS。

首个联调 PASS：`/tmp/jianji-cover-upload-smoke-0PrGnA/report.json`。最新验证及提交对应回执放在 `.agent/harness/runs/20261007-assisted-cover-cdp-upload/`；工程和隔离 CDP 证明不冒充真实千川账号上传验收或 Windows 实机验收。本任务不新增自动 mask 资格或整批旧贴纸完整性结论。
