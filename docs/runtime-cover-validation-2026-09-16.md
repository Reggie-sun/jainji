# Runtime Integration Validation

## Result

2026-09-16 在 `0ce45b0`（包含 `f92860a`）上完成一次真实素材自动覆盖尝试。连接恢复与独立模型界面验证通过；真实视觉请求收到响应，但跨窗口目标一致性校验失败，未导出。不能宣称成片验收或通用识别准确率通过。

## Isolation

- Worktree：`/home/reggie/vscode_folder/jianji-runtime-validation`，分支 `validation/real-automatic-cover`。
- 使用该工作区独立构建的 Electron 主进程和 renderer；CDP 仅监听 `127.0.0.1:19336`。
- 独立 userData、队列与输出：`/home/reggie/jianji-validation/20260916-cover/`。
- 使用 `bwrap` 将原连接目录和应用自己的 `codex/auth.json` 只读挂载到新 userData；没有复制、打印 API Key，没有读取全局 Codex 登录状态。未更改原应用连接，未重启或关闭原应用。
- 已有视觉选择为 `MiniMax-M3`、Responses、服务商默认档位；保持此选择。创作保持 ChatGPT `gpt-5.6-luna / medium`。
- Chrome MCP 因已有 profile 占用无法连接，使用独立 Electron CDP 验证并保存截图；没有关闭其他浏览器。

## Input

- 原素材：`/home/reggie/电商/马油膏布/素材/竞品详情-抖音电商罗盘.mp4`。
- ffprobe：34.854 秒、720×1280、30 fps，存在音频流。
- 展示文字：`19.9元2支`，直接沿用 `氨糖膏.jianji-project.json` 最新已保存批次的 `templateSnapshot.productPrice`，未由模型生成或改写。
- 单素材、单版本，`clean`，装饰 `mode=agent`；显式设置 `coverSticker.enabled=true`、`trackingMode=agent`。空手动候选，由自动规则选内置素材。
- 未导入其他项目或原实例任务。新实例使用 CPU 单路；本次没有进入媒体导出。

## Live Evidence

证据目录：`/home/reggie/jianji-validation/20260916-cover/`。

| Evidence | Observation |
| --- | --- |
| `connections.png` | 界面同时显示创作和视觉连接、各自模型与档位 |
| `requests.jsonl` | 两次请求均为视觉识别、模型 `MiniMax-M3`；09:05:58.654Z 与 09:06:07.845Z 发出，均收到 HTTP 200 |
| `state.json` | run `b3c0798b-9f08-48ad-98a2-314fffd10204`，唯一 item 为 `failed`，导出 queue 无 batch |
| `result.png` | 作品页显示分析失败及跨窗口关联错误 |
| 独立 `userData/codex/logs_2.sqlite` | 两个创作 turn 均使用 `gpt-5.6-luna / medium`，09:05:52Z、09:05:57Z 记录 sampling token usage |

创作 turn IDs：`01a0a977-03ca-78c1-b5c7-668cc546feb4`、`01a0a977-21f5-73e2-8e4e-e8bc01dafab6`。结合 `agent-runner.ts` 的执行顺序，创作选覆盖贴纸先完成，随后进入视觉识别。样式方案位于识别之后，因此本次未执行，不能声称已真实验证完整样式调用链。

最终错误：

> 模型返回的覆盖追踪结果不合格：重叠抽帧的目标数量或位置不一致，无法唯一关联全部目标。本条未导出，可检查模型后重新生成。

未静默重试、未换模型、未回退创作识别、手动画框或固定方案。请求记录只保存角色、模型、档位、HTTP 状态，不保存请求头、Key 或图片数据。没有保留模型完整坐标响应，因此不能据本次证据进一步区分模型观察差异与匹配阈值问题，也没有据此修改生产代码。

## Verification And Limits

- 独立工作区 `npm run build` 通过（含 `npm run typecheck`）；存在原有 bundle 大小 warning。
- `npx vitest run tests/vision-connection.test.ts tests/connection-store.test.ts` 实际匹配并执行 `connection-store.test.ts`，11/11 通过；没有名为 `vision-connection.test.ts` 的测试被执行。
- 真实视觉服务返回响应不等于识别结果合格；此次正确停在本地一致性检查。
- 输出目录 `output/` 为空。没有成片路径，没有本次导出 FFmpeg exit、成片 ffprobe、成片抽帧或人工播放验收。
- 白色底板、多目标最终覆盖、轨迹冻结、导出重试不重新识别或换款，本次均未到达验证阶段；之前模拟 smoke 不能替代真实成功成片证据。
- 尚无可归因的代码缺陷，不修改生产代码、不扩展架构。后续需人工决定是否再次运行或显式更换视觉模型；不能将本次失败自动转为另一模型的成功尝试。
- 仓库未声明专用 session-record skill；本报告保留本次 runtime integration 结果。

## Main Fix Follow-up

用户报告 `(16).mp4` 的 JSON 格式失败与 `(17).mp4` 的跨窗口关联失败后，授权直接在 main 修复并允许重启。之前合并的 `61539a2` 只有本报告，没有程序源码变化。检查 `蝴蝶贴.json` 的 538 个已保存批次均未含覆盖图层，最近成功批次不能作为自动覆盖路径此前通过的证据。

新的真实诊断响应保存在 `/home/reggie/jianji-validation/20260916-fix/`，没有复制 Key；仅在进程内读取现有视觉配置。原素材 1.75 秒的两次响应均识别左右角标，但框高分别为 `0.08/0.09` 与 `0.04/0.05`；检查原抽帧确认该画面只有这两个角标。原 IoU 阈值误拒绝这组有限包含框。另一个单测证明原逐目标算法会拒绝“局部候选不唯一、整体一一对应唯一”的情况。

修复内容：保留 IoU 规则，补充近包含且宽高比例各不低于 1/2 的候选；只接受全局唯一的完整匹配。数量不一致、无匹配或多个完整匹配仍失败。重叠帧保存两次框的并集，采样聚合保留合并结果，避免丢弃任一观察到的范围。真实响应离线回放已从失败变为通过，不调用模型或重试。

`(16).mp4` 的另一真实响应对底部 emoji 同时产生明显位移，仍正确拒绝；新增该反例防止把“修复”扩大为无条件接受。JSON 错误未在此次 7 个真实诊断窗口中复现，原失败响应也未留存，故尚未确定并修复该错误的根因。错误提示新增时间窗口，JSON 失败额外显示响应字符数；不泄露模型原文，不猜补 JSON，不自动重试。

Verification：62 项相关测试通过；`npm run build`（含 typecheck）通过。真实 FFmpeg 集成覆盖合并范围保留与输出媒体；隔离 Electron/IPC/FFmpeg 视觉连接 smoke 通过，产物为 `/tmp/jianji-vision-smoke-u3fRgY/output/source_edited.mp4`（模拟服务，不是用户素材）。尚无修复后的真实完整素材成片或人工验收，不能声称两类问题均已解决。

独立 `reviewer_xhigh` 结论为 `accept with concerns`：无 blocking issue；确认唯一匹配与记录响应回放，保留 JSON 根因及完整实片验收未完成的限制。最终 diff 由主线程复核。
