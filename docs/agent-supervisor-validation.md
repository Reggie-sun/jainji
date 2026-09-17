# Automatic Supervisor Validation

## Scope

2026-09-17，将自动贴纸路径改为执行 Agent 提议、主管依据原图纠正、检查实际渲染样片、修订后重渲染的闭环。创作、识别、主管继续使用既有模型连接，可共享 API，也可分别配置。未改变显式半自动模式的人工批准流程。

主管只能请求有界补帧/局部放大、修正原贴纸轨迹和自动候补贴纸尺寸/旋转。每个识别窗口最多 3 轮主管调用，每条样片最多 5 轮检查、2 次有效修订；服务错误不自动重试。无效修订不能清除已报告的问题，后续直接 `pass` 也不会放行。前 3 秒模式的轨迹边界只限制新增图层，不表示原贴纸消失。

## Executable Evidence

| 检查 | 结果 |
| --- | --- |
| `npm test -- --maxWorkers=2 --minWorkers=2` | 93 个测试文件通过、1 个跳过；740 项通过、2 项跳过。日志 `/tmp/jianji-supervisor-tests-bounded.log` |
| 最后时段上下文修改后的相关测试 | `supervised-preview.test.ts` 和 `supervised-agent.integration.test.ts` 共 11 项通过，含真实 FFmpeg |
| `npm run build` | 最终修改后通过，包含 TypeScript 检查；保留已有 bundle 体积警告 |
| 独立代码审查 | 阻塞问题已修复并复核；最终短视频提示语建议已采纳 |
| Electron 桌面专项 smoke | 最终构建通过；主管进度可见，制作期间历史重试被拒绝，覆盖开启/关闭均走实际渲染；无运行时异常 |

桌面验证命令：

```bash
JIANJI_SMOKE_SCOPE=supervisor \
JIANJI_FFMPEG_PATH=/home/reggie/miniconda3/bin/ffmpeg \
JIANJI_FFPROBE_PATH=/home/reggie/miniconda3/bin/ffprobe \
xvfb-run -a node scripts/desktop-smoke.mjs
```

桌面报告及截图：`/tmp/jianji-desktop-smoke-tdQG3G/supervisor-report.json`、`supervisor-progress.png`、`08-supervisor-completed.png`。使用隔离 Electron/CDP；Chrome MCP 因已有浏览器占用未使用。此 smoke 使用模拟模型服务，不是商业模型质量证明。完整桌面脚本早先在后续无关的删除贴纸默认选择断言处失败，因此这里只声明主管专项通过。

## Real Provider Runs

使用用户现有三条蝴蝶贴素材和冻结的手动文字 `19.9元30贴`，自动装饰、关闭覆盖、仅前 3 秒显示、720p。识别为 MiniMax-M3，创作与主管为 ChatGPT 登录的 gpt-5.6-luna。测试状态、输出与登录副本隔离，临时登录副本已清理，未修改正式连接设置。以下真实调用没有人工填写或修正贴纸坐标。

| 运行 | 结果与限制 |
| --- | --- |
| 首轮三条 | 三条导出，但抽帧检查仅前两条符合目标；第三条误认左下原贴纸，导致缺角。不能把模型通过等同画面通过 |
| 第三条复测一 | 无效修订保护拦住错误方案，0 条正式导出；主管误解 3 秒轨迹边界，产生误拒绝 |
| 第三条复测二 | 明确轨迹作用时段后完成导出；核对原图及 2.5、2.75、3.1 秒成片，左下补齐、右下原贴纸保留，无重复新增；新增文字与贴纸渐隐后消失 |

首轮证据根目录：`/home/reggie/电商/验证-主管修正闭环-20260917-1789646749040`。
误拒绝证据根目录：`/home/reggie/电商/验证-主管无效修正保护-20260917-1789647559068`。
最终复测证据根目录：`/home/reggie/电商/验证-主管时段复核-20260917-1789647911884`。
各目录保留 `detections.json`、`result.json` 和样片；最终目录的 `verified-samples.json` 记录以下三条成片的源文件 SHA 校验与 ffprobe 结果。

## Playable Samples

- [素材一成片](/home/reggie/电商/验证-主管修正闭环-20260917-1789646749040/output/7c0016d745b60bc8d91d3aaa7f7cee29_edited.mp4)
- [素材二成片](/home/reggie/电商/验证-主管修正闭环-20260917-1789646749040/output/07e26362f48a38da2af9d6701e7823e7_edited.mp4)
- [素材三最终复测成片](/home/reggie/电商/验证-主管时段复核-20260917-1789647911884/output/10703ae15bb5de311818b1d43e6b99cc_edited.mp4)

三条均为 720×1280、30fps，保留音轨，源文件 SHA 未改变；容器时长差分别为 33ms、14ms、0ms。未验证音频逐采样一致性：第二条输出音轨时长比源音轨短约 116ms，不能据此声称音频完全等同。首轮第三条旧成片属于失败证据，不是交付样片。

## Limits

这是两条首轮样片加一条最终复测样片，未以最终代码重新跑完整三条批次。只检查了选定帧，未逐帧或人工完整播放验收；没有验证 Windows 实机。严格主管门禁可能误拒绝，复杂运动和短暂出现仍可能漏检。本轮未重跑全 MiniMax 质量对比，同一 API 多角色的支持不代表不同模型组合效果相同。
