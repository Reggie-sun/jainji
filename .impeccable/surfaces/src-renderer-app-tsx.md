---
version: 1
slug: "src-renderer-app-tsx"
primary_target: "src/renderer/App.tsx"
related_targets: []
---

# Surface Brief — 简辑工作台(renderer 全部表面)

Scope: src/renderer 全部页面与组件(素材/包装/覆盖/输出/作品/贴纸库/连接/模型抽屉/审阅)。Mode: **Operate**。Audience: 自己/团队,每日高频批量出片的熟练电商运营。Job: 一次设置批量出片,过程可预期。Constraints: 只改呈现层;保留五步操作顺序与准入、IPC 契约、冻结重试语义;窗口 760–1600px;去营销腔。Direction: concept-seed 58ae6557(degraded roll)指派 candidate 5。

## Direction contract

THESIS: 这是一件批量生产工具,重要信息享受"价目标牌"待遇——价格、条数、进度、统计以印刷标牌级的字号与自重出现,其余一切退为安静的工单表格。拒绝的类别默认:AI 工作台营销风(英文 eyebrow + 手绘插画 + 大留白卡片阵)。

OWN-WORLD: 批发市场价目牌与热敏标签的印刷纪律。纸面白(#fafbfa)与墨色文字(#1a2420),细线分区代替卡片阴影,teal(#0f7a66)只作"印章/签字"色用于主动作与关键确认态。数字全部 tabular-nums,关键数字 20–28px;正文/控件 ≥13px,辅助 ≥12px。状态标签如印刷印章:实心小色块+文字,不用浅色渐变药丸。

STORY: 用户进入即知:现在在哪一步、缺什么、下一步点哪里。开始制作是页面上唯一的主动作。进行中的任务与进度始终可见。

FIRST VIEWPORT(素材步):顶部一行 = 项目名 + 保存/打开 + 引擎状态;其下一行轻量步骤指示(素材→包装→输出→作品,非导航层)。主体双栏:左侧拖放区 + 素材清单表(行高紧凑、勾选、状态印章),右侧原片预览。底部固定操作条:已选 N 条 + 下一步主按钮。无 eyebrow、无插画、无营销文案。

FORM: 印刷工单/价签系统,自建 grounded 列表第 5 位(第 1 位为商家后台工作台,本次未由骰子选中);seed key 58ae6557;degraded roll(无 challengers、无 quality-bar boards),已向用户声明。

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
