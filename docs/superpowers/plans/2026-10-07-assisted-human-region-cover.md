# Assisted Human Region Artwork Implementation Plan

## Goal And Authority

用户已明确授权实现上一轮最小接入方案。以 [Assisted Accepted Delta](../../semi-automatic-cover-review-spec.md#human-region-artwork-accepted-delta) 为合同，交付人工定区域、真实图案完整覆盖、冻结预览确认后原队列导出的持久软件能力。原自动掩码修复仍未完成，不以此模式改写其失败。

## Boundaries And Owners

- `src/shared/cover-sticker.ts` 的显式 assisted 策略；`cover-review.ts` 的草稿/冻结展示继续唯一。
- 新 `src/shared/human-region-cover.ts` 保存人工冻结数据，`src/main/human-region-cover.ts` 负责选材与冻结，`human-region-geometry.ts` 负责固定目标投影与不透明像素检查，`human-region-render.ts` 负责字节与输出绑定验证；不拥有批准/项目/队列。
- `shape-cover-hybrid-shape.ts` 的原有有界枚举增加显式 artwork-only 几何选项，默认 Hybrid 行为不变；复用 alpha 和 radius=0 freeze，不能用 contour PASS 代替原 alpha。
- `agent-controller.ts`、`agent-runner.ts`、`agent-template-preparation.ts` 只增加本地准备接缝；`cover-review-controller.ts`/`approval.ts` 继续全部版本批准。
- `domain.ts`/`compiler.ts`/`queue.ts` 扩展人工冻结类型、原尺寸渲染、批准交接和 freshness；旧格式解释不变，旧 reader 严格拒绝未知字段。
- `CoverStickerPanel.tsx`、`CoverReviewPanel.tsx`/CSS、`TemplatePanel.tsx` 与 `App.tsx` 提供显式选择、固定框/时段编辑、目标与实际占用可视化及费用说明。

## Invariants And Compatibility

不修改自动 mask、H2/H4/coverage 阈值或 proof-pinned 文件。不擦除源片、不加白底、不改贴纸文字、无付费覆盖调用、不建立新批准 owner。原 manual/assisted 缺省保持白底。新框修改使旧冻结/批准失效；queue 重启重试只消费持久冻结资产。覆盖优先与普通四角补齐使用实际占位和时段，不能把全画布 PNG 当全画布占位。源争议仍失败关闭。

## Major Milestones

1. **Contract And Pixel Evidence**：共享字段/schema、固定框投影、严格原 alpha 搜索及 PNG freeze；独立透明孔洞/半透明、等比、画布边界、无解与取消回归先红后绿。
2. **Original Production Integration**：原 controller/runner 准备本地图层、持久冻结目录；原 template/compiler/queue 只增加人工类型分派，原审阅 owner 验证目标集合、全部版本和批准绑定；真实 FFmpeg 预览/正式队列/重试/篡改拒绝及零模型回归。
3. **Human Interaction**：显式策略、固定目标/时段、真实图案占用展示及全部版本确认；Chrome MCP 当前连接外部浏览器，无法切换到本应用，使用 Playwright 连接真实 Electron 验证交互，不以静态 UI 断言代替。
4. **Real Media And Completion**：使用指定目录真实视频，保留源文件和历史输出；开发人员通过实际界面建立 TL/TR 目标并逐条预览导出。原先“再核整批”不能把开发人员选框当成用户对全部素材的覆盖意图；此次交付软件能力及真实双素材验证，全批逐素材范围和视觉接受仍由用户在产品中确认。不冒称人工框穷尽、原自动掩码修好或用户已接受画面。typecheck、受影响测试、owned Harness、风险判断及必要 read-only Kimi review、AOCI、completion，提交 owned paths 并 push upstream 核对远端 SHA。

## Verification And Self Review

新增 `tests/human-region-cover.test.ts` 与 `tests/human-region-production.integration.test.ts` 覆盖像素/绑定/批准/导出；同步 policy 注册，保留受影响既有 cover-review、cover-render、controller/runner、Hybrid 回归。有限搜索保留 256 款/5 尺寸/9 平移，失败不改框或阈值；具体总预算与取消由新准备 owner 限定并保留错误。

Native Codex 主线程负责共享契约、生产与最终裁决；只将不相交的 renderer 文件交 bounded worker。上一轮受管 Kimi `c77c5006-b731-4b44-a7d8-b1fbd51fa72f` 是接缝调查，不是实现 review；未采纳直接以 contour 搜索授人工覆盖。最终 Risk Gate 在工程验证后判断。所有里程碑直接映射本 Delta，无新增用户批准步骤；实际产品里的用户预览确认门仍不可绕过。

## Execution Evidence

2026-10-07：真实 Electron 使用隔离配置目录 `/tmp/jianji-human-region-ui/config`，经原应用 IPC、人工编辑界面、冻结播放及确认，两个 29.419 秒、720×1280 视频导出到 `/tmp/jianji-human-region-ui/outputs`。素材文件名分别以 `184100.317_edited.mp4` 和 `184101.596_edited.mp4` 结尾，不把它们冒充历史诊断索引 4/5。TL 为 `(0,0,.16,.07)`，TR 为 `(.84,0,.16,.06)`，全程；raw alpha 覆盖且无新增白矩形。图案在画布边缘被裁切，预览明确显示可见占用范围，是否接受该外观由用户决定。

实际 preview 全程播放、逐版 viewed 和显式确认由开发测试执行，非用户画面验收。media Harness `20261007T121057Z-4cbeee3a` 与 `20261007T121059Z-d6b426d5` 均 PASS，证明各自任务的文件/音轨/时长准入；抽看首、中、尾帧不能证明框外无漏贴纸。早先将 renderer snapshot 当 QueueState 的两次 NOT_EVALUATED 输入错误已保留，随后改用真实持久 JobStore 文件验证。

新增真实 FFmpeg 集成回归覆盖画布边缘和中部、半开时段、零模型、未查看/部分查看拒绝、幂等批准、PNG/源/输出设定过期拒绝、源争议、持久任务恢复重试不重选且不覆盖历史输出，以及本地随机同版不同款、逐版轮换、池不足、取消和明确不覆盖。现有 Hybrid、旧 assisted 和编译队列回归通过对应 Harness 路由继续核验。

仓库未配置独立 session-record/capture skill；本节作为本次持久实现记录，机器回执留在忽略的 `.agent/harness/runs/20261007-assisted-human-region/` 及上述 run 目录。另一个会话的价格花字/精选目录改动不属于本任务；共享 AOCI 的机器完整批次按授权维护，业务文件及对应提交归属仍分开。

## Ownership Resolution

用户随后选择 A，授权本 session 整合并收尾 `agent-controller.ts`、`App.tsx`、`TemplatePanel.tsx`。保留另一会话的新项目 random 默认值、随机方案生成与旧模板折叠入口；覆盖模式仍通过 assisted 草稿、冻结预览及明确批准提交，不借通用开始按钮入队。其他会话已暂存的独立变更保持原样，提交时只收本任务差异或对应整合差异。前次因并发源码变化停止的 Harness 不计 PASS，整合后重新绑定源码验证。
