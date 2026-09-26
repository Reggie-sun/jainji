# Windows 0.1.6 验证记录

日期：2026-09-26。基于 `main fce917d` 及 Windows 验收分支，范围为 NVIDIA 591.74 驱动要求兼容、不同电脑的 CPU/GPU 自动识别与并发，以及两条无需模型的本地制作路径。

## 本次修改

- Windows 引擎固定为 Gyan FFmpeg 8.0.1 essentials，发布包、`ffmpeg.exe` 与 `ffprobe.exe` 分别校验 SHA-256。构建 README 标记 `ffnvcodec n13.0.19.0`；本机试编码明确要求 NVENC API 13.0、NVIDIA 驱动 570 或更新。591.74 满足版本门槛，依据 [NVIDIA SDK 13.0 系统要求](https://docs.nvidia.com/video-technologies/video-codec-sdk/13.0/read-me/index.html#system-requirements)，但这不是 591.74 实机出片验收。
- CPU 不再固定单路。启动时每约 4 个可用逻辑核估算一路 CPU 导出，GPU 每约 3 核估算一路；两者最高 6 路，再按总内存、启动时可用内存和桌面保留预算降低上限。CPU 使用动态 720p 本地画面及队列实际线程分配验证同时存活的编码会话，失败逐级降路数；一路也失败则锁定导出。
- 保留 NVIDIA NVENC → AMD AMF → Intel QSV 的实际试编码选择，硬件路线均未通过时检测 CPU。CPU 与 GPU 任务统一按实际准入槽位均分线程，逐个到达的任务不会占满后续任务预算。低资源电脑仍可能自动准入 1 路，并发准入不等于全素材测速或绝对最快。

## 验证证据

| 检查 | 结果 |
| --- | --- |
| 代码与打包 | `npm run typecheck`、`npm run package:win` 通过；内置 FFmpeg 8.0.1、ffprobe、中文字体、Electron/Node.js 与 Codex |
| 自动能力与队列 | 相关 79 项通过、8 项平台用例跳过；模拟不同核心/内存、三类硬件编码器、并发失败降级及 CPU 完全失败拒绝。实际 FFmpeg 在受控 2 路配置下完成两个 CPU 输出并验证产物；该配置证明队列多路可执行，不代表当前低内存环境自动准入 2 路 |
| 全量回归 | 最终运行 1,046 项通过、21 项按平台条件跳过；124 个测试文件通过、2 个跳过。使用本次 FFmpeg 8.0.1，以单个测试 worker 运行，日志见本机 `C:\Users\27451\Documents\Codex\2026-09-14\ba\work\windows-0.1.6-full-tests-final.log` |
| U 盘升级 | 从 `G:\简辑\jianji-setup-0.1.6.exe /S` 升级已有 0.1.5，退出码 0；已安装 `resources/app.asar` 与构建产物哈希一致，已安装 FFmpeg 的哈希为 `5AF82A0D4FE2B9EAE211B967332EA97EDFC51C6B328CA35B827E73EAC560DC0D`；本机与 U 盘安装包及离线引擎包哈希一致 |
| 安装版本地路径 | 未配置模型连接，以“本地随机”和“自己设置”分别完成横屏带音频、竖屏无音频各一条 4 秒视频，共 4 条。输出为 1280×720/24 fps 与 720×1280/30 fps，均完整解码，音轨有无与原素材一致，原素材哈希未变，渲染异常 0；损坏 MP4 和四类非法展示文字被拒绝；正常退出释放知识库锁 |
| 本机自动容量及耗时 | 12 个可用逻辑核、约 15.9 GiB 总内存；测试启动前可用内存约 3.5 GiB，保留桌面预算后自动准入 CPU 1 路，实际观测峰值 1 路。随机双样片约 3,896 ms，自己设置双样片约 3,679 ms（包括制作提交、队列与输出校验，不能外推长视频速度） |
| 画面抽样 | 每秒约一帧检查中文文字与贴纸；自己设置的左上心形、右上箭头、右下星光可见，左下未新增贴纸。使用动态测试图素材，未全程人工播放 |

首次全量运行 1,045 项通过、21 项跳过，长视频抽帧用例在默认 5 秒预算下超时；保持原断言并单独增加运行预算后，新引擎完整执行约 16.7 秒、旧 9.0.1 引擎约 7.6 秒均通过。两个时点系统负载不同，不能用此对照推定引擎速度差异。本次只为该真实媒体测试设定 60 秒预算，与同文件既有真实媒体用例一致，不放宽内容或安全断言。

安装包 `jianji-setup-0.1.6.exe`：466,761,833 字节，SHA-256 `2152A8F33045C43D9450FB22C8AE3959D99E6E8B5F652CED73CB85C0AAB36D15`。离线 FFmpeg 包 `ffmpeg-8.0.1-essentials_build.zip` 的 SHA-256 为 `E2AAEAA0FDBC397D4794828086424D4AAA2102CEF1FB6874F6FFD29C0B88B673`。

当前验证主机仍为 NVIDIA RTX 3050 Ti 4 GB、驱动 546.30，低于新版引擎的 570 要求。目标 591.74、Windows AMD/Intel GPU、交互式安装、长视频制作速度与全程人工观看仍需按 [Windows 验收清单](windows-acceptance-spec.md) 在相应设备执行，未测项不计为通过。两条本地路径不配置模型连接，不使用用户账号或真实模型额度。

本机安装版证据目录为 `C:\Users\27451\Documents\Codex\2026-09-14\ba\work\windows-installed-acceptance-0.1.6\run-6JOMOp`（随机）和 `C:\Users\27451\Documents\Codex\2026-09-14\ba\work\windows-installed-acceptance-0.1.6-manual\run-jE7aJ9`（自己设置），含报告、原始测试素材、成片及抽帧图。U 盘 `验收样片-0.1.6` 保存成片、报告与抽帧图，手动模式在其 `自己设置` 子目录。

仓库指定的 `verification-before-completion` skill 在当前 runtime 不可用，已执行等价门禁：当前代码的类型检查、受影响测试、全量测试、Windows 打包、U 盘安装、真实安装版制作、成片解码、源文件/交付文件哈希、退出释放锁及最终 diff 检查。AOCI/CodeGraph 的 Windows 工具与 Guide 也未提供；本次手动更新受影响索引条目，并核对其源码路径与职责，没有声称工具级索引校验通过。

复测安装版（PowerShell，在项目根目录）：

```powershell
node scripts/installed-acceptance-smoke.mjs "$env:LOCALAPPDATA\Programs\jianji" "C:\Users\27451\Documents\Codex\2026-09-14\ba\work\windows-installed-acceptance-0.1.6"
node scripts/installed-acceptance-smoke.mjs "$env:LOCALAPPDATA\Programs\jianji" "C:\Users\27451\Documents\Codex\2026-09-14\ba\work\windows-installed-acceptance-0.1.6-manual" manual
```
