# Current Batch Account Pause and Local Random Admission

## Scope

用户反馈跨模板本地随机仍要求模型，且后两个商品没有上传。按当前要求只修改源码、测试和对应 AOCI；不安装、更新、重启软件，不新建真实制作、不操作平台文件选择或确定按钮。其他任务的制作源码及未提交改动保留。

## Observed Runtime

2026-10-01 08:37 UTC 只读连接现有应用，运行包仍为 `export-capacity-20261001-29b36c25`。批量记录 `74b4df7e-73b8-4c17-96a3-7f11b0c497f2` 的冻结设置与原上传成员核对如下；后续单项目热敷贴的上传不计入该批次。

| Job | Frozen Mode | Export | Original Upload |
| --- | --- | --- | --- |
| 晚安油 | random / manual cover | 30 / 30 | 12 READY、9 UNKNOWN、9 PENDING |
| 热敷贴 | random / manual cover | 30 / 30 | 30 PENDING / NOT_SELECTED |
| 蝴蝶贴 | random / Agent cover | 0 / 30 | 无成片、无上传记录；制作报“请先接入模型。” |

蝴蝶贴的错误发生在模型连接准入，不能把该提示当成已发生成功模型请求的证明。批量入口保留模板覆盖方式，因此“本地随机”和旧 Agent 覆盖同时存在。后两项的零上传原因不同：热敷贴被服务全局暂停阻断；蝴蝶贴没有生成可上传成片。

## Change

- `BatchProductionController.freeze` 从实际模板读取覆盖方式，本地随机与 Agent 覆盖冲突在上传预检及制作会话前明确拒绝；共享提示也用于批量页面。用户可设置并保存手动覆盖框，或明确关闭本项覆盖。程序不虚构框、不自动关闭覆盖，也不通过接入模型跑通本地随机。
- 原 `DouyinUploadService` 保留唯一调度权。可信 `beginProduction` 后，上传失败按冻结 advertiser 隔离暂停，其他已授权的本轮账号继续；同账号跨项目、跨批次保持阻断。未进入可信本轮范围的旧恢复路径仍需显式继续。
- 每组最多 9 条，同批次下一组仍等待全组 READY。UNKNOWN 的结果、失败、fence 不改写或重选。历史同目标字节防重传、closed 成员及停止失败全局锁存保持。
- 取消时先排空当前组，结束取消等待后才调度其他账号，避免把后者长时间上传算成取消排空失败。

## Evidence

证据保存于 `.agent/harness/runs/20261001-random-and-upload-diagnosis/`。先运行失败的跨账号、迟到成片、随机覆盖准入测试，再修复；另补取消排空及旧恢复删除后的暂停复现。

`systematic-debugging`、`verification-before-completion` 和隔离 Chrome MCP 用于调查与验证。`external-subagent` 的只读 Kimi deep/max 调查 invocation 为 `241d6380-c70c-4b83-bb00-54ce00b1478a`，canonical receipt 为 PARSED，3 次请求 IDENTITY_VERIFIED，5 个封存文件完整读取、无重试。该证据只证明受管调查；Parent 核对实际 source、冻结事实与测试，并拒绝其把模板覆盖校验放入无模板上下文请求 Schema 的建议。

最终 native Harness `20261001T085807Z-d4fa2696` 的 typecheck 和 24 个相关测试文件通过：338 tests、0 failed、0 skipped；运行前后 source identity 相同。`npm run typecheck`、`npm run build` 成功。`scripts/batch-random-mode-smoke.mjs` 及 Chrome MCP 在隔离页面验证旧 Agent 覆盖阻止本地随机、显式关闭覆盖后可开始、切回随机重新校验，真实制作次数为 0。四个受管理源码的 AOCI 基线逐项匹配，Verify、Check、Guide 均对齐，Guide complete=true / next_action=none。

最终 candidate 的 Review Risk Gate 为 `KIMI_REVIEW_NOT_REQUIRED`：无本轮明确 review 要求；未改账号目标绑定、可信范围、fence、重传、closed 或持久格式准入，未发现关键级越权或持久损坏路径。跨账号暂停、同账号隔离、迟到成片、取消排空、旧恢复处置均有可执行证据；新包真实平台验收仍未执行，独立文本审查不能代替该证据。该判断绑定最终源码与 fresh Harness，不把 Kimi 调查当作实施审查。

## Completion Boundary

最终验证和 Review Risk Gate 的机器证据由同目录的 Harness receipt、源码摘要及 `final-proof.json` 绑定。本记录不把离线验证或隔离 UI 认定为新包真实平台验收。软件继续使用原运行包；原 9 条 UNKNOWN 未重传，旧批次未恢复，真实补传和安装尚未执行。

仓库未提供专用 session-record/capture Skill，本次有复现及跨模块修复的 durable value，采用本记录保存事实，未调用或写入 Codex Memory。
