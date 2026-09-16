# Scope

用户选择：仅新生成的自动装饰要求四角都有贴纸；保留独立覆盖开关。开启覆盖时，已有贴纸由覆盖层占位，其余角落及空档补齐。手动设置、手动展示文字、历史冻结任务和失败关闭规则不变。

# Implementation

- `AgentProvider.validatePlan` 要求四个不同角落各一项；空初筛、缺角、非法几何明确失败，不用固定款式补救。
- `automatic-corner-layout.ts` 是覆盖占位与补齐时段的唯一 owner。使用既有安全布局的最大贴纸区域，按覆盖矩形交集计算所有被占角落；跨角大框可占多个角。沿线性轨迹精确切分区域边界，合并覆盖时段，冻结普通贴纸的 `activeRanges`。
- `AgentRunner` 只对本次自动制作执行该计算。`TemplateCompiler` 消费冻结时段；历史无此字段的模板仍保持原效果，重试不重新识别或选款。
- 覆盖关闭时不识别原贴纸；开启但识别不确定时仍失败且不导出。创作连接、视觉连接的选择和用户凭据未改变。

# Verification

- 按 TDD 先增加行为测试：最初 9 项失败、3 项通过；实现后通过。独立审查发现高底角框和横跨双角框的占位缺陷，追加回归在旧逻辑得到 3 项失败、13 项通过，然后修正。
- `npm test`：586 passed、2 skipped；69 个测试文件中 68 passed、1 skipped。日志：`/tmp/jianji-four-corner-full-tests.log`。
- `npm run build`：通过，包含 `npm run typecheck`；3144 个打包贴纸校验通过。日志：`/tmp/jianji-four-corner-build.log`。
- `node scripts/vision-connection-smoke.mjs`：PASS。真实 Electron/IPC/FFmpeg，两个本地模拟连接；验证创作/视觉请求分工、进行中不可切换、不确定识别不导出、缺视觉连接在请求前拒绝及凭据不回传。证据目录：`/tmp/jianji-vision-smoke-6VPSVc`。
- `node scripts/desktop-smoke.mjs`：PASS，3 次包装、3 次初筛、3 个识别窗口；真实交互、IPC、导出、冻结重试/取消与跨集合手动文字隔离通过，runtime exceptions 为空。证据目录：`/tmp/jianji-desktop-smoke-Sxwhay`。仅 fixture 迁移了过时的共用框字段、自动开启覆盖假设和新集合文字继承假设；保留并加强相应断言，未改变产品实现。bootstrap 使用明确的素材资源路径，同时保留临时项目目录隔离。
- 独立 `reviewer_xhigh`：最终 `accept`，无 blocking issues；核心原反例与 100 组多轨迹、40000 次时段对比一致。桌面 fixture 的资源路径问题已修正并重跑通过。
- 跳过项：`gpu-export.integration.test.ts` 与 `asset-library.integration.test.ts`，不计作本轮 GPU 或素材库外部下载验收。
- 最终日志副本：`/home/reggie/jianji-validation/20260916-four-corners/` 下的 `full-tests.log`、`build.log`、`desktop-smoke.log`、`vision-smoke.log`。

# Media Evidence

这是合成素材的真实 FFmpeg 验证，不是真实商业模型或用户竞品素材的识别验收。

- 成片：`/home/reggie/jianji-validation/20260916-four-corners/four-corners.mp4`。
- 抽帧：`/home/reggie/jianji-validation/20260916-four-corners/gap-frames.png`，依次为 0.1、0.4、0.8 秒。
- FFmpeg exit 0；ffprobe：320×240、10 fps、视频与音频流均存在，容器时长 1.024 秒（1 秒视频及音频编码尾部）。
- 像素断言：左上普通蓝色贴纸在覆盖前后显示，在 200–600 ms 覆盖时段退让；白色底板填满覆盖框；其余角保持蓝色贴纸。已查看拼图，符合上述切换；未进行用户真实素材的连续播放验收。
- JSON 冻结模板重新编译，FFmpeg 参数及辅助文件内容完全一致，不经过模型或识别。

# Limits

本次是四角布局规则变更，不是视觉识别准确率修复。未调用真实模型，未将 SAM 接入生产，不能宣称此前氨糖膏/蝴蝶贴的真实识别失败已经解决。现有识别仍为抽帧加插值；真实素材、Windows 实机及用户最终观看验收未在本次完成。所有无关项目文件及 `docs/video-sticker-alternatives.md` 保持原状。
