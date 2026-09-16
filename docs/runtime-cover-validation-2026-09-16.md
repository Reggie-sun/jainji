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
