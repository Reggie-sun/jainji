# Result

用户要求自行实测后，在 `8d32bc3` 上执行真实模型覆盖验证：**仍失败，未导出**。未修改生产代码，未放宽校验或手工补框。本次 `systematic-debugging` 用于核对同帧原响应与实际图像，不把模型返回 `ok` 当作覆盖验收。

# Input And Isolation

- 有效测试素材：`/home/reggie/电商/马油膏布/素材/竞品详情-抖音电商罗盘.mp4`，34.854 秒，SHA-256 `c61168beeb5a42e4476c3276f76a8369bcae1dc8b6a0b311708e087cf57e8c9e`。
- 沿用已保存用户文字 `19.9元2支`，一素材一版本，`coverSticker.enabled=true`、`trackingMode=agent`、装饰 `mode=agent`。
- 保留主应用创作 `gpt-5.6-luna / medium`。按用户此前指定的 Luna，在隔离窗口使用视觉 `gpt-5.6-luna / high`；主应用的 MiniMax-M3 视觉配置未改动。
- 独立 Electron/userData/输出目录；通过 `bwrap --ro-bind` 只读挂载简辑自己的登录文件，没有复制或输出 API Key/OAuth 凭据，也没有读取全局 Codex 登录。没有重启原桌面应用。
- 证据目录：`/home/reggie/jianji-validation/20260916-live-retest/`。`bootstrap.cjs` 只记录角色、模型、档位、响应正文与完成状态，不记录请求头或凭据。

# Live Requests And Failure

有效测试 run：`d720712f-ea37-4bdf-98da-6b4737bf608e`。开始于 12:17:18 UTC，12:19:29 UTC 失败，约 131 秒。

`requests.jsonl` 的 sequence 7–12 属于此 run：2 次创作（初筛、覆盖选款，medium）与 4 次视觉识别（high），六次均收到模型响应。未到达创作样式方案阶段，没有重试或模型回退。

失败提示：`重叠抽帧的目标数量或位置不一致，无法唯一关联全部目标（5.25–7.00 秒）`。

`response-11.txt` 最后一帧与 `response-12.txt` 第一帧均为 5250 ms，均报告四个目标、status=ok，但底角框不一致：

| Target | Previous rectangle x/y/w/h | Next rectangle x/y/w/h | IoU | Intersection / smaller area |
| --- | --- | --- | --- | --- |
| Bottom left | .010/.960/.042/.028 | .007/.967/.050/.033 | .4537 | .7500 |
| Bottom right | .954/.962/.042/.028 | .950/.966/.050/.034 | .5396 | .8571 |

两对框都不满足生产路径的 IoU>=.6 或 near-containment>=.9 条件，因此无法完成唯一匹配。使用保存响应直接调用当前 `detectCoverTrack`（内存编译、模拟 completion 返回已保存正文，无新模型调用），复现同一拒绝错误。

# Frame Check And Acceptance

- `frame-5250.jpg` 按生产 fps=4、round=up、最长边1280的相同抽帧参数获得；`bottom-detail.png` 是底部诊断放大图，不是成片。
- 主线程查看原帧与底部细节：左右底角图案仍存在。前一次左下框终止于源显示坐标 y=1264.64，右下终止于1267.20（1280高）；原图底部仍有图案像素，前次框不能包全其下缘。后一次两个框均延伸至1280。仅放宽匹配不能据此保证其他抽帧、目标边缘或完整素材覆盖合格。
- `state-original-failed.json`：agentRun finished、item failed、queue batches 空；`output/` 为空。没有 FFmpeg 导出进程或最终媒体，故不存在成片 ffprobe、连续播放、全目标白底覆盖或冻结重试验收。
- 配置可用和真实模型响应：通过；完整识别、有效成片和人工画面验收：未通过。此次没有解决截图中的实际故障。

# Preliminary Attempt

最初读取当前 `氨糖膏.jianji-project.json`，其 `(15).mp4` 实际是89.4秒的另一素材（SHA-256 `28ea5fed9ce1a618db1f2949961f1e01f099d6f4bae325bd6936988e29743533`），不是历史记录中34.854秒的失败样本。检查首帧确认没有该组角落贴纸后，主动取消，未将其作为覆盖成功证明。

该尝试是 sequence 1–6：2次创作响应、3次视觉响应，第四次视觉请求发出后取消；最终状态保存于 `state-current-15-cancelled.json`。随后改测用户最初指定的原素材，没有同时运行两个制作任务。另两次错误测试入口调用分别被请求 schema（多余 totalOutputs）和输出目录准入拒绝，发生在模型调用前，不能算模型失败。

# Completion

只提交本报告；隔离实验脚本、模型响应和帧保留在上述证据目录。无关项目文件与 `docs/video-sticker-alternatives.md` 保持原状。无生产代码变更，不重复无关全套测试或 build。当前实证支持继续修正定位/关联问题，但不支持直接解除失败关闭或宣称已经可用。
