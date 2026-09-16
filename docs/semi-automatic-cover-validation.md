# Semi-Automatic Cover Validation

## Scope And Status

2026-09-17：按 [实施计划](superpowers/plans/2026-09-16-semi-automatic-cover-review.md) 实现 M1–M5 的半自动编辑、冻结预览及批准流程，以及 M6 默认关闭的单轮独立复核试点。M7 **未开启**：缺少无复核／有复核的配对人工质量和操作耗时记录，也没有用户明确启用修正的选择。没有执行真实商业模型请求。本次桌面验证使用隔离 profile；现有项目中由其他 Agent 执行的验证改动保持原样。

## Implementation

- `cover-review.ts/session/controller` 定义持久草稿、原始算法观察、人工决定、修订和运行状态。编辑失效旧预览；退出保留草稿，显式停止与退出分开。预算在请求前落盘，重启不自动发起请求。
- `cover-review-evidence/candidates/input` 保存带 PTS 和时间基准的原分辨率证据；原帧导航保留实际时间，旋转按显示坐标处理。抽样观察不自动变成可执行轨迹，未观察时段保持未知。派生局部图使用受控临时文件。
- `agent-template-preparation` 复用原选材、模板和四角补齐逻辑；`ExportQueue.renderPreview` 复用原编译器、FFmpeg 资源及文件验证，不创建正式 job。所有版本查看后才接受批准。
- 批准意图、稳定提交键、模板摘要与 job 回执持久化；队列串行处理重复提交，保存回执失败后仍可找回原 job。任务重试沿用冻结快照。
- 项目／job／batch v2 与模板 v1 分开。已知 v1 迁移先写独立旧副本；未来格式和不可用存储不会被当成损坏文件回退或覆盖。
- M6 从现有连接库明确选择模型，凭据只留在连接 owner。每轮先完成并保存全部盲检，再核对候选；一轮、零自动修正、失败计数、无重试和服务切换。问题和中断必须人工处置，复核无权批准导出。

## Executable Evidence

最终静态与测试检查：`npm run typecheck` 通过；`npm test` 为 **640 passed / 2 skipped**（81 files，80 passed / 1 skipped）。跳过项受本机 GPU／资源集成环境限制。独立 `reviewer_xhigh` 对持久化、退出、取消、批准、复核顺序与局部图进行只读复核，结论为 `accept with concerns`，保留意见是缺少 M6 配对人工收益证据。

`npm run build` 通过，包含 3,144 个本地贴纸及许可证校验；存在既有前端 bundle 大小提示。最后的复核 prompt 补充目标语义后，provider 聚焦测试 6 项再次通过并重新构建。

验证分层，不将模拟服务等同于模型质量验收：

| Layer | Evidence |
| --- | --- |
| Schema / lifecycle / migration | 新增 schema、commands、migration、approval、budget 测试；覆盖 future schema、取消并发、退出恢复、存储失败、job／回执间故障、重复批准、路径别名和摘要校验 |
| Actual FFmpeg | 临时动态预览保留音频且不建 job；真实 VFR 七帧时间戳与不连续覆盖区间逐帧检查；90° display matrix 转正后抽帧；证据和 crop 临时文件清理 |
| Isolated desktop | `scripts/assisted-cover-smoke.mjs` 使用独立临时 userData、模拟连接及生成素材，验证候选失败、人工补框、两版预览、批准和真实导出；`vision-connection-smoke.mjs` 检查旧严格模式路由及拒绝行为 |
| Evaluation tool | 合成 development/holdout 清单封存并运行 `assisted-cover-evaluate.mjs`，配对人工记录为 0 时报告 `insufficient evidence`，不推导模型收益 |

离线评测工具证据：`/home/reggie/jianji-validation/assisted-cover-evaluation-fixture-1789576618/assisted-cover-evaluation.json`。该清单是程序验证用合成视频，不是 REQ-22 的真实质量数据集。

最终桌面 smoke：`/home/reggie/jianji-validation/assisted-cover-smoke-1789577413865/report.json`，截图 `review-manual-edit.png` / `approved-output.png` 已查看。实际 DOM 勾选复核、选择连接并点击执行；两版预览均 canplay/play/pause，批准重放没有新增任务。总模拟请求 9 次（识别 1、复核 2、创作 2、选材 4）。主动删除**隔离测试项目**的一条已完成输出后，重载得到 `failed/artifact_missing`，冻结摘要保持一致，重试后全部请求增量为 **0**。

两个最终产物位于 `/tmp/jianji-assisted-smoke-Nq4Log/output/source_edited.mp4` 与 `source_edited_1.mp4`；独立 ffprobe 确认为 H.264 1280×720、AAC 音轨、时长 1.042 秒。临时目录可能由系统清理。旧严格路由 `vision-connection-smoke.mjs` 在 `/tmp/jianji-vision-smoke-2mdzHT` 通过，`runtimeExceptions=[]`。Chrome MCP 因既有 profile 占用未接管当前浏览器，采用隔离 Electron/CDP 驱动；未把该证据称为 Chrome MCP 或 Windows 实机验收。

保留源帧率导出现在显式使用 FFmpeg `-vsync vfr`，避免默认同步在 VFR 输入上增删帧；该编译设置作用于所有保留源帧率的模式，指定 30fps 的设置不变。已用真实 VFR 与现有渲染回归测试验证，未声称所有编码器／Windows 都已验收。

## Evaluation Contract

清单 `cases` 至少分别包含 development 和 holdout，源文件 SHA-256 必须匹配且不能跨组泄漏。每项配对人工记录格式：

```json
{
  "baseline": { "humanOperationMs": 10000, "waitMs": 0, "finalQualityAccepted": true, "knownSevereHidden": false, "requestsUsed": 0, "maxRequests": 0 },
  "review": { "humanOperationMs": 8000, "waitMs": 3000, "finalQualityAccepted": true, "knownSevereHidden": false, "requestsUsed": 2, "maxRequests": 2 }
}
```

以上只是字段示例，**不是本次实测结果**。所有封存案例都需要配对记录；严重问题隐藏、质量不合格、预算越界或人工耗时中位数未下降均不能晋级。脚本不读取 GT 交给模型，也不发送任何请求。真实 5.25 秒故障段、出现／消失、切镜、小动画及商品／字幕负样本的人工 GT 与配对评测仍待提供；合成测试只验证程序合同。

## Remaining Acceptance

- 未验证真实服务商的复核准确率、费用或商业 API 兼容；须另行明确授权连接、抽帧和请求上限。
- 未完成 Windows 实机交互、媒体播放和性能验收。
- 自动 smoke 能证明播放与导出链路，不能代替用户逐片观看后的质量确认。
- M7 保持关闭，不用模型一致或问题列表变短代替质量和成本收益。

## Concurrent Workspace Ownership

用户确认 `蝴蝶贴.json` 的格式迁移及历史任务核验由另一位已授权 Agent 执行。本任务不恢复、修改或提交该项目及其备份；这些状态不作为本功能的验收证据。本次 smoke 使用临时项目、临时 cwd 和 recent registry，避免发现仓库真实项目。
