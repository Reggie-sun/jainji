# Qianchuan Real Batch Verification

## Outcome And Scope

用户明确要求继续使用软件真实批量测试。当前开发软件从实际“开始批量制作”按钮启动两轮：先验证蝴蝶贴 10 条分组上传，再验证蝴蝶贴、热敷贴、一条根三个保存模板各 10 条的连续制作。合计 40 条正式导出，其中蝴蝶贴两轮共 20 条真实上传列表 READY。

**三个账号的完整上传验收仍未完成。** 热敷贴、一条根对应的“一根金”专用 Chrome 首次登录尚未完成；软件已打开两个窗口，实际地址仍为 `https://business.oceanengine.com/login`。三模板测试显式关闭这两项上传，只验证它们的制作与导出，不把零上传当作故障或上传通过。用户的原个人 Chrome 登录状态不等于新独立 profile 登录。

本轮没有修改应用源码或更新安装包。保存模板的手动展示文字、手动覆盖及输出设置沿用，本次选择本地随机。没有模型制作授权、旧任务恢复、未知结果重传、千川确认、发布或广告设置操作。

## Runtime And Runs

测试起始源码 checkpoint：`0e66035`；开发 Electron CDP 为 `41867`，renderer 为 `43641`。运行时能力为 H.264 NVENC、6 个导出槽。实际采样发现最多 6 个同时运行的正式 NVENC FFmpeg 进程，并非仅引用能力标签。

| Run | Templates | Formal exports | Real upload rows | Export time |
| --- | --- | --- | --- | --- |
| `06a9719d-c031-4e53-9d93-ef2dcb5fc252` | 蝴蝶贴 | 10/10，失败 0 | 10 READY | 47.486 秒 |
| `07b675da-a9e8-45fc-ab56-6283ac736ad6` | 蝴蝶贴、热敷贴、一条根 | 每项 10/10，合计 30，失败 0 | 仅蝴蝶贴 10 READY；其他两项显式不上传 | 202.892 秒 |

三模板制作从 `2026-10-01T15:16:05.794Z` 到 `2026-10-01T15:19:28.686Z`。两轮全部制作记录 `usesModel=false`；实际 UI 分别打开三个商品作品详情，标题与商品一致，每项显示 `10 / 10 条完成`。蝴蝶贴详情显示上传 10/10；另外两个详情没有串入旧账号上传面板。

## Upload Evidence

两轮均由软件新建生产 tab，冻结账户 `1876024170199244`、计划 `1876036593854788`，保留原上传页面。对应新 target 为 `0B40FB671CE4F88A185EF639A30E0D8F` 和 `CFB9940DEC902885735544C0A7B2E136`。

每轮实际拖放分组均为 `1 + 9`。第一组的 READY 观察时间先于第二组拖放；最大组为 9。每个最终弹窗恰有本轮 10 个文件名，显示“已选择 10/107”。页面可见账号、URL 双 ID、上传任务绑定和 READY evidence 一致。上传记录的 SHA-256 与各正式输出文件字节逐项重算一致，共验证 20 个上传文件。

所有上传记录为 `READY / WAITING_FOR_CONFIRMATION`，每条 `attempt_count=1`、`retry_count=0`，结果未知为 0。被动 DOM 点击审计仅观察到“添加视频”，两轮 `confirmClicks=0`；没有确认、提交或投放。READY 只证明上传列表完成，不代表平台最终接受。

## Output And Evidence Locations

输出目录：

- 首轮蝴蝶贴：`/home/reggie/电商/蝴蝶贴/视频/10.1 23:12`
- 三模板蝴蝶贴：`/home/reggie/电商/蝴蝶贴/视频/10.1 23:16`
- 三模板热敷贴：`/home/reggie/电商/热敷贴/视频/10.1 23:16`
- 三模板一条根：`/home/reggie/电商/一条根/视频/10.1 23:18`

原队列完成状态与非空已验证 outputArtifact 逐项核对。额外使用应用安装的 FFprobe 检查四个输出样本，均有 H.264 视频和音轨，容器时长与对应 outputArtifact 相符。这不是全片人工画面验收。

本地证据目录 `.agent/harness/runs/20261001-real-multi-batch/` 保存两轮原始状态、详情、页面文件列表、分组与点击审计、每两秒观察、软件与平台截图、FFmpeg 并发采样及 `verified-proof.json`。`verify.mjs` 实际通过导出计数、上传计数、绑定、文件名、字节 SHA、分组时序、确认次数与样本探针断言。运行资产不提交。

## Delegation And Governance

按 standing authorization 使用 `external-subagent` 做独立只读 QA。Invocation `5f3c5fdf-17dc-47c1-bbd1-4d7497ccd5f3` 的 canonical receipt 为 `OUTCOME_UNKNOWN`：唯一 wire request 在连接阶段 `TLS_ERROR`，没有实际 Read，未自动重试，未采用其结果。Parent 根据实际软件、浏览器、文件与断言证据独立裁决。

本轮无实现变更，不触发新增实现 reviewer；本报告按现有 AOCI `historical-docs` observe scope 处理，不扩展索引范围或改写 managed 源码基线。未发现 repository 专用 session-record Skill，使用本记录保存真实验收及登录阻断。

AOCI Verify 与 Check 的 `governance_aligned=true`，Check `ok=true`；Guide `stage=aligned / complete=true / next_action=none`。observe informational 变化保留，不扩展维护到无关对象。

## Remaining Work

用户完成热敷贴和一根金专用窗口登录后，继续显式开启三个模板对应账号的新制作批次，核对后两个账号的真实文件列表及多账号接续上传。当前 30 条制作通过不替代这项上传验收；不将本轮未授权上传的 20 条成片自动追溯上传。
