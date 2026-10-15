# Wide Frames Implementation Plan

## Goal And Scope

按用户选择 A，新增十二款明显包边的厚款与整批/逐素材“必须使用宽边框（随机款式）”。保留原自动、全部随机、固定及关闭设置。

用户补充要求适合电商、有装饰层次，单纯粗色条不足：四款改为奶油相纸叠层、曜石流金、雾蓝玻璃及鼠尾草礼盒，加入纸/织物肌理、细金线、玻璃反光与角部点缀。先交付静态款；用户允许动态，但本次未扩展冻结/渲染的动画合同。

用户要求增加款数，扩至十二款：新增珍珠贝光、玫瑰缎带、香槟扇纹、牛皮纸缝线、冰银切面、陶土拱纹、浅紫流线及深蓝星芒。每款分别使用珠饰、缎带折角、扇形刻线、缝线、金属切面、拱纹、波纹及星芒装饰；前四款图案保持，新增款沿同一目录及宽池准入，不增加渲染生命周期。

## Contracts And Invariants

`FrameSettingsSchema` 的 `random` 增加可选 `pool: "wide"`，缺省沿用全部内置/上传池。厚款四边各占对应画布边长约 8%–10%，中央半宽半高透明。新 ID 不改十三款旧图。冻结层保存宽池来源，重试保留字节，新随机追加仍仅宽款；空池、漂移及错误冻结 ID 拒绝。沿原 workspace、resolver、compiler 和 queue，不改视频规格、音轨及覆盖规则。上传不猜测厚薄分类。

## Ownership And Milestones

Parent 串行负责 `src/shared/frames.ts`、`src/main/builtin-frames.ts`、`src/main/decoration-frame.ts`、`src/main/agent-provider.ts`、`src/main/domain.ts`、`src/main/queue.ts`、`src/main/index.ts`、`src/renderer/FrameDecorationPicker.tsx`、`src/renderer/DisplayTextEditor.tsx`，以及相关既有测试、Decoration Contract 和本计划。契约紧密，拆分无明显独立增益，不委派实现。不建第二流程，不移除旧路径。

1. 先在既有测试中证明宽池限制、逐素材覆盖和追加保持，再实现 schema、PNG、准入及冻结来源。
2. 新增入口和宽框预览示意，同步原合同。实际验证点击、逐素材继承及保存恢复；合成 FFmpeg 检查横竖四边。
3. 运行 typecheck、受影响测试及 owned Harness/verify；稳定候选按 Risk Gate 判断 review，必要 AOCI 维护后只提交 owned 增量、push 并核远端。用户已授权共享 AOCI 通过官方完整批次合并维护，保留他人成果且仅提交本轮增量；上传及清理业务文件不修改或 stage。

## Acceptance And Verification

宽池每次有框、无细款/上传混入；空池和宽图损坏拒绝，无关细图损坏不阻断宽池。旧格式/旧图/固定/无框及重试保留。宽框覆盖约 30%–36% 画布且中心透明。验证入口：`npm run typecheck`、`npx vitest run tests/agent-provider.test.ts tests/builtin-stickers.test.ts tests/append-production.test.ts`、policy 路由的 `npm run harness -- code --scope <scope>` 和 `verify`，Chrome DevTools 交互及 FFmpeg fixture。工程证据不替代真实成片人工或 Windows 验收。

## Self-Review

已覆盖用户 A、兼容、池隔离、预览、逐素材、追加和重试区别、失败关闭及无模型制作；不扩展上传或识别范围。
