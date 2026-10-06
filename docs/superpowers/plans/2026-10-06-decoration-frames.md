# Decoration Frames Implementation Plan

## Goal And Scope

用户选择 C：支持内置整圈边框和上传透明 PNG 边框，现有用户贴纸继续叠在边框上方。默认无边框；用户在规则模板单独选择。三款原创内置素材离线生成，不调用图像模型。

## Contracts And Invariants

- `DecorationOptions.frameId` 保存选择，不受 manual / random / agent 切换影响；`DecorationCatalog.frames` 与普通贴纸目录分开。
- 复用 `UploadedStickers` 的校验、不可变文件和删除标记；上传边框使用独立 `uploaded-frame-<sha256>` 命名空间及目录，仅 PNG、10 MB、4096 像素以内。解码后的中央半宽/半高区域须完全透明，图像须有可见像素。
- 边框是带 `frame` 元数据的完整画布 `StickerLayer`，一版最多一个，位于普通贴纸、覆盖和展示文字下方。compiler 和 canvas 都将完整边框映射到输出画布，中央透明，边缘可覆盖原视频；不改变源投影、不裁剪或重新定覆盖框。
- 边框全程显示，不占覆盖角落，不参加普通贴纸随机选款；冻结后 retry、append、random append 保留原文件及 fingerprint。
- 复用现有 schema、AssetLibrary 准入、原制作链路、compiler、queue 和预览。不创建第二套导出或批准流程，旧项目缺字段仍可读取。

## Owners And Milestones

1. 素材与准入：`src/shared/frames.ts`、`src/main/builtin-frames.ts` 由 bounded_worker 独占；Parent 扩展 `builtin-stickers.ts` 的现有 PNG encoder，整合 `uploaded-stickers.ts`、`asset-library.ts`、`index.ts`、`preload.ts`。新素材和贴纸池分离，坏文件在制作前拒绝。
2. 冻结模板和导出：Parent 在 `decoration-frame.ts` 生成边框层；`decorations.ts`、`domain.ts`、`agent-provider.ts`、`automatic-corner-layout.ts`、`compiler.ts` 消费同一 marker。保持公共模板格式兼容和旧冻结语义。
3. 用户入口和预览：Parent 新增 `FrameDecorationPicker.tsx`，接入 `CornerDecorationPicker.tsx`；边框选择器直接支持上传/删除边框；`TemplatePreview.tsx` 先画边框再画贴纸。没有选择的旧界面与行为保持原样。
4. 验证与交付：在已注册测试文件增加上传、模板、克隆、角落时段和真实 FFmpeg 像素断言；执行 typecheck、相关 tests、scoped Harness、Chrome MCP 交互及 AOCI 官方维护/Verify/Check/Guide。只提交 owned paths，并 push 核对远端。

## Verification And Acceptance

确认内置三款可选、PNG 上传持久化与删除可恢复、重启/项目保存保留选择、不同制作方式保留边框；不透明/空白图片和错误 ID 拒绝。真实短视频验证四边、中央源内容、贴纸上层、末帧全程、时长及音轨；证据仅表示工程验证，不替代用户整片观看或 Windows 实机验收。

`npm run typecheck`、`npx vitest run tests/builtin-stickers.test.ts tests/uploaded-stickers.test.ts tests/agent-provider.test.ts tests/compiler.test.ts tests/append-production.test.ts tests/four-corner-coverage.test.ts tests/decoration-display.integration.test.ts` 为 focused seams；最终 scope 的完整 check union 由现有 Harness policy 决定。

## Verification Infrastructure

提交本轮正式 AOCI Volume 时，Harness 原来误要求其出现在业务 source manifest。复用 `checkOwnedAoci` 核验官方三项治理事实和本地 Volume 字节，保留缺失、损坏、删除、快照冲突及普通源码未建 Entry 的失败关闭；新增正反测试。补齐正式索引与基线的原 policy 路由，所有必需检查保留。历史形状检查使用已装有 numpy / OpenCV 的 Python 环境及应用 FFmpeg，不安装依赖或修改历史形状算法。

## Self-Review

用户目标全部映射到三个功能 milestone；独立命名空间防止边框被缩成四角贴纸，固定 full-canvas geometry 防止 corner policy 意外改变边框。源投影保持原样，因此不需要调整 source knowledge / shape / cover approval。native writer 与 Parent 的 target files 完全不相交。Kimi mapping 使用只读冻结输入，receipt 核验前 Parent 不改其 frozen set。验证器仅对官方声明的 Volume 核验实际哈希，不扩大普通源码的准入例外。
