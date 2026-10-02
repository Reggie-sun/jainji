# Qianchuan Original Accounts Live Checkpoint

## Result And Scope

用户正常重启原账号 Chrome 后，在当前 `make frontend` 软件界面重新执行三个模板各 10 条。新批次 `dc1557f7-1e85-42d6-84cb-3fa7612bae67` 实际生成 30 条，三个原账号上传列表均为 10 READY；每文件一次选择、零重试、零确定点击。三个上传弹窗保留，等待用户检查后确认。READY 只证明上传列表完成，不代表平台确认、发布或视频内容质量通过。

本轮只处理这次新生成的文件，未清除或重传历史文件、UNKNOWN 或永久 fence。软件直接连接原账号的常规 loopback CDP，没有另开账号登录目录或再次等待远程调试许可；软件连接不依赖 Codex MCP 配置。

## Original Accounts And Actual Upload

| 模板 | 账号 / 计划 ID | 成片 / READY | 实际组大小 |
| --- | --- | --- | --- |
| 蝴蝶贴 | `1876024170199244` / `1876036593854788` | 10 / 10 | 1、9 |
| 热敷贴 | `1876956000684231` / `1877477842671690` | 10 / 10 | 9、1 |
| 一条根 | `1876131703522649` / `1877582409449488` | 10 / 10 | 9、1 |

一条根沿用用户原配置的稳定账号槽 `滴耳康`，有效商品名为 `一根金`；页面可见账号和计划双 ID 与冻结目标一致。没有改写账号设置以匹配模板标题。

Chrome MCP 实际点击批量开始与三个“查看作品”入口。作品页分别显示蝴蝶贴、热敷贴、一条根，上传名称分别为蝴蝶贴、热敷贴、一根金，均显示 10 / 10；平台各有十个就绪文件行，截图及快照保留。每组全部 READY 后才进入下一组，组间时序与任务 readyEvidence 核对一致。实际 DOM 行为审计只有添加视频，确定及发布点击为零。

## Production And Timing

- 三个 job 均为本地随机，`usesModel=false`；不调用制作模型，保留模板内用户文字及手动覆盖设置。
- 30 条全部导出耗时 114.255 秒；从开始到全部上传 READY 为 174.796 秒。
- 每两秒进程采样观察到最多 5 路 `h264_nvenc` 同时渲染。设备公布队列容量为 6，本次证据只报告实际观察的 5 路。
- 逐项核对 30 个文件的非空字节、SHA-256、FFprobe 视频/音频流、尺寸与时长；文件摘要与上传记录匹配。文件校验不能替代播放确认。

## Reproduced Failure And Repair

前一批 `c952c0c6-2800-43b5-a898-12d171901ce0` 的蝴蝶贴和一条根各十条完成，热敷贴在制作及选文件前被浏览器绑定校验拒绝。该批部分成功和失败记录均保留，未把它作为三个账号全部成功的证据，也未重传那二十条。修复后重新从软件启动上述独立的三十条批次。

热敷贴的原 `user-data-dir` 为当前用户拥有的规范真实目录，权限 0700；直接子目录 `Profile 1` 权限 0775。原 `verifyOriginalProfile` 对内外两层都要求无 group/world 权限，误拒绝了 Chrome 内层常规权限。修正只保留外层私有要求，内外层仍核对所属用户、真实目录与规范路径，拒绝符号链接及别名。外层私有目录阻止其他用户遍历内层；软件不 chmod，不读取登录文件，不改绑定、历史上传或选文件授权。

合同及责任见 [Spec](douyin-auto-upload-spec.md) 和 [Plan](superpowers/plans/2026-10-02-qianchuan-original-profile-reuse.md)。

## Executable Verification

- RED：内层 0755、0775 的两个回归用例在修正前失败；外层 0775 拒绝用例通过。
- GREEN：browser manager 与 discovery 42 项通过，包含上述回归与已有目录别名拒绝、真实隔离 Chrome detach / 同目录重启测试。
- `npm run typecheck` 通过；当前上传 policy 的 11 个测试文件、261 项全部通过，无 skip，耗时 71.99 秒。
- 开发主进程实际重建并加载当前修正；真实软件批次及最终只读验收绑定的九个相关源码 SHA 在运行前后及收尾核对一致。

本机证据位于 Git 忽略目录 `.agent/harness/runs/20261002-original-accounts-live/`：`1790936333136-verified-proof.json` 为最终断言结果，包含全部三十个文件和九个源码身份；对应 `details/state/platform`、行为审计、NVENC 采样、上传测试输出，以及三个作品页的 `works-*.txt/png` 保留。平台证明来自实际账号页面，未使用 fixture 代替真实上传。

## Independent Investigation And Parent Decision

受管 Kimi deep 只读调查使用修正前绑定代码、manager、RED 测试和目录元数据的冻结快照，不读取登录内容。第一 invocation `30989f5a-8e30-441e-8341-c192cc00439b` 在第二次请求 RESPONSE_BODY 出现 CONNECTION_ERROR，结果 OUTCOME_UNKNOWN，未消费部分输出。核查回执后进行一次有界恢复。

恢复 invocation `69caf169-4d9d-4858-bbd7-247c4c380abc` 的两个 authenticated `k3/max` 请求、四份完整 Read、seal `3fa51c234915fb2c983945fef37c22b021d3a72d1f9b4d5fa524ca43937f8898`、读取与产物摘要均核对一致，无截断。它是源码调查，不是最终 implementation review 或验收。

Parent 接受外层私有保护内层的诊断，保留内层 0775 兼容要求。外层 chmod 后的重新打开仍经过同一 `verifyOriginalProfile`；调查建议增加该场景的单独测试不改变本次修复结论，已有外层拒绝与每次打开校验覆盖必要行为。外层目录在两次打开之间被用户改权限的风险原本存在，本次不添加监视器或修改用户目录。

## Implementation Review Risk Gate

稳定候选：`qianchuan-browser-bindings.ts` SHA `648c2fd88fc84bda52c937a0a4c459559a9882983250778c982072af258a9754`；测试 SHA `56bb66eb66509ab216611d6483a027a634ae1b35a8d56d5584e93b2e1f115dc2`；Spec SHA `a47f9a324990fec19a5a85b4205c2bfbc6c37497f990ab455cfe627e2aa3aab5`；Plan SHA `a536b81093cb252c85956dee81e8bfbce3fb9bf4eae215401d865e436a3bb520`。结果 `KIMI_REVIEW_NOT_REQUIRED`。

用户未要求该候选的 Kimi review；私有外层、两层归属与规范路径门保持，没有新增凭据读取、renderer 路径或跨账号上传 authority，也未改变 durable ledger/fence。具体误拒绝已有 RED/GREEN、261 项上传验证及原账号三十条实际运行证据，没有需源码 adversarial reviewer 填补的重大语义缺口。调查与测试不替代用户确认或内容观看。

## AOCI And Completion Boundary

用户已允许维护本轮绑定条目及另一任务已提交的三个源文件条目。首次完整四条 Apply 因 `code_candidate_plan_stale` 停止，`applied=0 / formal_writes_started=false`；没有覆盖其他 session 的索引结果。重新领取时，另一 session 新增和修改了覆盖贴纸源码，当前完整批次扩展为九条，其中五条属于仍在编辑的业务文件，不能拆分或用未稳定源码宣称维护完成。

当前尚未维护的授权四项为 `qianchuan-browser-bindings.ts`、`shape-cover-stationary-discovery.ts`、`source-fact-census.ts`、`source-fact-discovery-evidence.ts`。剩余工作是在其他 session 源码稳定后重新领取完整机器批次，维护并完成 Verify、Check、Guide；不编辑其他 session 的业务文件。真实批量证据与本轮代码保持可复核，AOCI 收尾另行报告阻断。

重新领取的批次为 `ce6dfa13f283707b7fbaaa0135e4961dec6ff444ac00180099e8cb47a779103b`；额外五项为 `source-mask-auto-extraction.ts`、`source-mask-auto-qualification.ts`、`source-mask-static-extraction.ts`、`source-mask-static-qualification.ts`、`source-mask-static-target.ts`。最终 Verify 与 Check 均返回治理未对齐，Guide 为 `complete=false / authoring_required`；无 pending transaction、无待恢复写入。本轮没有把这些检查执行过等同于维护完成。

仓库没有专用 session-record/capture skill。本文件保存本轮真实运行、权限恢复、工程证明、调查裁决及维护阻碍；不写全局 memory。
