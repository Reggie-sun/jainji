# Windows 0.1.5 安装版验证记录

日期：2026-09-24。代码基线：`origin/main` 的 `fce917d` 加本分支的 Windows 修复、GPU 回退提示修正和安装版验收脚本。安装包：`jianji-setup-0.1.5.exe`，469,737,407 字节，SHA-256 `bdbc0291bb3d579588aed95139308b3f9c902071f15a0606a06da73b34340309`。安装包未签名，使用默认 Electron 图标。

设备：Windows 11 专业版 x64，build 10.0.26200；AMD Ryzen 5 5600H（6 核 / 12 线程），约 15.9 GiB 内存；NVIDIA GeForce RTX 3050 Ti Laptop GPU，驱动 546.30。用户数据、输入和输出测试文件放在独立目录，未使用真实模型账号、API Key 或用户业务视频。

| 检查 | 本次证据 |
| --- | --- |
| 构建与代码 | `npm run typecheck`、`npm run package:win` 通过；贴纸校验 3,144 个 Fluent + 70 个自定义文件；相关测试 42 项通过、7 项跳过。0.1.4 基线的完整测试 1,034 项通过、20 项跳过，不能代替本次版本的全量测试 |
| U 盘升级 | 从 `G:\简辑\jianji-setup-0.1.5.exe /S` 升级已有 0.1.4 安装，进程退出码 0；安装目录 `resources/app.asar` 已更新。安装包的本机与 U 盘 SHA-256 一致 |
| 安装版环境 | 从 `%LOCALAPPDATA%\Programs\jianji` 启动；内置 FFmpeg、ffprobe、Noto CJK 字体可用；正常退出释放隔离用户目录的知识库 `owner.lock` |
| 实际本地制作 | 不配置模型连接，使用 4 秒横屏带音频、竖屏无音频素材各出 1 条。输出分别为 1280×720/24 fps、720×1280/30 fps，时长均为 4 秒；AAC 音轨有无与源一致。两条成片完整解码，原片 SHA-256 未变，渲染异常 0 |
| 输入拒绝 | 安装版把损坏 MP4 标为不可用；空白、纯空格、三行、单行 13 字展示文字均在 IPC 制作入口被拒绝，未创建导出批次 |
| 画面抽样 | 各成片抽取约每秒一帧检查：中文展示文字清晰，四角贴纸可见，原测试图动态内容保留；这不等于全程人工观看 |

0.1.4 的首次 U 盘静默升级曾以 `0xc0000005` 在 NSIS 临时 `System.dll` 中异常终止，未更新安装目录；随后从本机同哈希安装包安装成功，从 U 盘同一 0.1.4 文件重试成功。本次 0.1.5 从 U 盘首次升级成功。首次异常原因未证实，因此不能据本次结果保证所有电脑的安装过程无故障；交互式双击安装、卸载与其他 Windows 版本仍未测。

本机内置 FFmpeg 的 `h264_nvenc` 1 秒试编码失败，明确报出所需 NVENC API 13.1、当前驱动提供 12.1，以及需 610.00 或更新驱动。应用按设计回退 CPU 编码（1 路），两条成片均完成。原界面将任何硬件探测失败写为“GPU 被占用”，现已改为“GPU 编码不可用”并提示可能的驱动或资源原因；本机 GPU 加速未通过，不应标为已验收。

安装版自动化证据保存在本机 `C:\Users\27451\Documents\Codex\2026-09-14\ba\work\windows-installed-acceptance-0.1.5\run-JLPCrR`，包含 `report.json`、输入及输出视频和抽样帧图。真实模型、三角色连接、用户账号、长视频、不同导出规格、完整播放、界面缩放与交互式安装仍按 [Windows 验收清单](windows-acceptance-spec.md) 单独执行；未测项不计为通过。自动化末尾的 CDP 截图接口曾超时，移除截图步骤后相同安装版完整导出与正常退出通过；该超时没有显示成片或应用 IPC 失败。

复测命令（PowerShell，在项目根目录执行）：

```powershell
node scripts/installed-acceptance-smoke.mjs "$env:LOCALAPPDATA\Programs\jianji" "C:\Users\27451\Documents\Codex\2026-09-14\ba\work\windows-installed-acceptance-0.1.5"
```
