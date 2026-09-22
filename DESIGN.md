---
name: 简辑 Jianji
description: 本地批量视频包装工作台 — 印刷工单/价目标牌世界的深青绿印章系统
colors:
  paper: "#f7f8f7"
  surface: "#ffffff"
  ink: "#1a2420"
  ink-secondary: "#45544d"
  ink-tertiary: "#6d7c75"
  line: "#dde3df"
  line-soft: "#e9ede9"
  seal: "#0f7a66"
  seal-hover: "#0b6a58"
  seal-dark: "#12332e"
  mint: "#e3f0ea"
  ok: "#1c7a4d"
  warn: "#9a6b1f"
  bad: "#b3402f"
  rail-text: "#98aca7"
  rail-active-bg: "#214a41"
  rail-active-marker: "#79d7b9"
typography:
  display:
    fontFamily: 'Inter, "Noto Sans CJK SC", "Microsoft YaHei", "Segoe UI", sans-serif'
    fontSize: "22px"
    fontWeight: 650
    lineHeight: 1.5
    letterSpacing: "-0.3px"
  title:
    fontFamily: 'Inter, "Noto Sans CJK SC", "Microsoft YaHei", "Segoe UI", sans-serif'
    fontSize: "14px"
    fontWeight: 650
    lineHeight: 1.4
  control:
    fontFamily: 'Inter, "Noto Sans CJK SC", "Microsoft YaHei", "Segoe UI", sans-serif'
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: 'Inter, "Noto Sans CJK SC", "Microsoft YaHei", "Segoe UI", sans-serif'
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.7
  label:
    fontFamily: 'Inter, "Noto Sans CJK SC", "Microsoft YaHei", "Segoe UI", sans-serif'
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.7
  plaque:
    fontFamily: 'Inter, "Noto Sans CJK SC", "Microsoft YaHei", "Segoe UI", sans-serif'
    fontSize: "26px"
    fontWeight: 650
    lineHeight: 1
    fontFeature: "tabular-nums"
rounded:
  stamp: "3px"
  control: "5px"
  card: "6px"
  tile: "8px"
  menu: "10px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "20px"
  lg: "38px"
components:
  button-primary:
    backgroundColor: "{colors.seal}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    padding: "10px 18px"
    height: "40px"
    typography: "{typography.control}"
  button-primary-hover:
    backgroundColor: "{colors.seal-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.control}"
    padding: "10px 18px"
    height: "40px"
    typography: "{typography.control}"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.card}"
    padding: "16px 20px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "42px"
    typography: "{typography.body}"
  status-stamp:
    backgroundColor: "{colors.line-soft}"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.stamp}"
    padding: "3px 9px"
    typography: "{typography.label}"
  status-stamp-completed:
    backgroundColor: "{colors.seal}"
    textColor: "#ffffff"
  status-stamp-failed:
    backgroundColor: "{colors.bad}"
    textColor: "#ffffff"
  status-stamp-running:
    backgroundColor: "{colors.seal-dark}"
    textColor: "#dff3ec"
---

# Design System: 简辑 Jianji

## Overview

**Creative North Star: "印刷工单与价目标牌" (The Print Work-Ticket & Price Sign)**

简辑是高频批量生产工具,视觉世界取自批发市场价目牌与热敏标签的印刷纪律:纸面、墨色、细线分区。重要信息(价格、条数、进度、统计)享受"价目标牌"待遇——以标牌级字号与自重出现;其余一切退为安静的工单表格。深青绿 (seal) 只作"印章/签字"色,用于主动作与关键确认态,它的稀有正是它的力量。

密度是生产工具的密度:行高紧凑、数字 tabular-nums、卡片靠 1px 细线而不是阴影分区。辨识度不依赖展示字体,而来自三件套:印章色、实心状态印章、标牌数字。方向来源:concept-seed 58ae6557(degraded roll — 无网络环境下掷骰,无 challengers、无 quality-bar boards,grounded 列表第 5 位"印刷工单/价签系统"中选;第 1 位"商家后台工作台"未被骰子选中)。此降级已向用户声明并记录于此。

明确拒绝的类别:AI 工作台营销风(英文 eyebrow + 手绘插画 + 大留白卡片阵)、浅色渐变药丸状态标签、为装饰而存在的英文文案。

**Key Characteristics:**
- 印章式主动作:实心 seal 色按钮,反馈不换布局
- 细线分区代替阴影:卡片 1px hairline,阴影只属于浮层(菜单/抽屉/对话框)
- 状态印章:实心小色块 + 文字,radius 3px,印刷章式
- 标牌数字:关键统计 26px、650 自重、tabular-nums
- 字号地板:正文/控件 13px,辅助 12px,绝不更小

## Colors

单一强调色系统:seal 是唯一的品牌动作色,其余全是纸、墨与细线的中性层。

### Primary
- **印章青 (Seal)** (#0f7a66): 主动作按钮、选中态(selection ring、focus outline、checkbox accent、progress 值)、文本按钮、`::selection` 与光标色。它是"签字确认"的颜色,只在用户要点头的地方出现。
- **印章青-深 (Seal Hover)** (#0b6a58): 主动作 hover 态,仅比印章略暗,不引入第二种绿。
- **松烟墨 (Pine / Seal Dark)** (#12332e): 固定左侧 rail 底色、运行/分析中状态印章、源片预览底色、模态遮罩(#12332e99)。深色 chrome 全部用它,不用纯黑。

### Secondary
- **薄荷纸 (Mint)** (#e3f0ea): hover 反馈底色(icon-button、secondary hover)、活动横幅、完成态步骤号底色。它是 seal 的"水印"形态,只做背景,不做文字。

### Neutral
- **纸面 (Paper)** (#f7f8f7): 应用画布底色、输入框底色、预览占位底。
- **工单白 (Surface)** (#ffffff): 卡片、sticky header/subnav、菜单与对话框表面。
- **墨色 (Ink)** (#1a2420): 一级文字、标牌数字。
- **墨色-二 (Ink Secondary)** (#45544d): 卡片正文、辅助说明。
- **墨色-三 (Ink Tertiary)** (#6d7c75): 辅助标签、单位、页脚文字(最小对比使用,12px 起)。
- **细线 (Line)** (#dde3df) / **细线-软 (Line Soft)** (#e9ede9): 卡片与分区 hairline、行分隔、默认状态印章底色。所有分区靠它们,不靠阴影。

### Semantic
- **Ok 青绿** (#1c7a4d): 成功文字与成功横幅(#e9f4ec 底 + #cfe4d4 边)。
- **Warn 赭** (#9a6b1f): 能力降级横幅(#faf3e3 底)与脏状态文字。
- **Bad 印泥红** (#b3402f): 失败/中断状态印章、错误横幅(#f9ebe6 底)、`role=alert` 文字。

### Named Rules
**The One Seal Rule.** 任何屏幕上 seal 实心色只出现在主动作与确认态上;同一视图里第二处大面积 seal 就是违规。mint 是它的唯一合法稀释形态。
**The Paper-First Rule.** 新表面默认取 paper 或 surface + 细线;想加新颜色时先问"能不能用墨色层级或细线解决"。

## Typography

**Display/Body Font:** 同一栈 `Inter → "Noto Sans CJK SC" → "Microsoft YaHei" → "Segoe UI"`,无独立展示字体。
**Character:** 中文优先的生产界面;Inter 只负责拉丁字母与数字的成形。自重 650(非 700)是全系统的"重音",650/400 两档承担几乎全部层级。

**Accepted deviation(已确认并记录):** 该字体栈会被 overused-font 检测器标记。这是有意决定:中文 UI 下展示字体收益低且加载代价高,系统辨识度由印章色 + 实心状态印章 + 标牌数字承担,不由字族承担。后续 surface 不得借"独特字体"之名引入第二字族。

### Hierarchy
- **Display** (650, 22px, lh 1.5, -0.3px): 页面级标题(`.section-heading h1`)。无 eyebrow/kicker,标题自身承担层级;≤1000px 视口降为 20px。
- **Title** (650, 14px): 卡片头标题;h2 内的数量徽记用 12px + line-soft 底 + tabular-nums。
- **Control** (600, 13px): 按钮、导航项、选项卡文字。
- **Body** (400, 13px, lh 1.7): 表单、正文、说明;长说明限宽 75ch。
- **Label** (400, 12px, lh 1.7): 辅助标签、单位、元信息、状态印章文字(印章内 600)。
- **Plaque** (650, 26px, lh 1, tabular-nums): 作品页统计行数字,价目标牌待遇;单位用 12px 墨色-三紧随其后。

### Named Rules
**The 13px Floor Rule.** 正文与控件不低于 13px,辅助文字不低于 12px;没有第三档更小的字号,也没有"micro" 文本。
**The Plaque Numeral Rule.** 凡用户要核对的数字(条数、进度、统计)一律 tabular-nums;关键统计升至 26px/650,其余数字保持 13px 安静呈现。
**The No-Eyebrow Rule.** 标题上方不放任何 kicker/eyebrow 行;层级由字号与自重表达,不由装饰性小字表达。

## Layout

桌面工作台,窗口 760–1600px(body min-width 760px),无移动端场景。

- **左侧固定 rail**:宽 94px(≤1120px 收至 80px),松烟墨底,含品牌、五步主导航、底部工具与引擎状态;内容区 `margin-left` 让位。
- **Sticky header**:白底不透明,一行 = 项目切换器 + 保存/打开动作 + 引擎状态(min-height 72px)。
- **Workflow steps**:素材 → 包装 → 覆盖贴纸 → 输出 → 作品,五个步骤是唯一的顶层流程导航;每步带 27px 圆形步骤号,active 步骤号实心 seal + 底部 2px 指示条,complete 步骤号 mint 底。
- **Subnav**:只放页内锚点(模板/显示时段/四角贴纸),不得与五步骤重复;active 用 inset 2px 下划线。sticky 于 header 之下。
- **内容区**:流式全宽(不设 max-width——宽屏下队列与列表必须吃满可用宽度),padding 30–38px(≥1600px 视口顶距 38px);栅格用 12px gap(模板卡)与 20–22px gap(双栏)。
- **Step footer**:sticky 底部操作条,paper 底不透明 + 顶部细线;左侧"已选 N 条"摘要(tabular-nums),右侧下一步主按钮——开始制作是页面上唯一的主动作。
- **双栏节奏**:素材步 1.55fr / 0.72fr(左清单右预览);≤1000px 折为单栏并隐藏预览卡。

### Named Rules
**The Opaque Chrome Rule.** 一切 sticky 层(header、subnav、step-footer)必须完全不透明;半透明 sticky chrome 是已修复过的缺陷,不得回归。
**The Five-Step Rule.** 顶层流程导航有且只有五个步骤;新能力进卡片、进 subnav 锚点或进 rail 工具区,不新增第六步。

## Elevation & Depth

系统是平面的:深度靠"纸面 vs 工单白"的色阶与 1px 细线表达,卡片与按钮静止时一律无阴影。阴影只授予真正浮起的内容。

### Shadow Vocabulary
- **选中环** (`box-shadow: 0 0 0 1px var(--seal)`): template-card 选中态,是描边不是深度。
- **焦点环** (`box-shadow: 0 0 0 2px #0f7a6622` + seal 边框): 输入框 focus;`focus-visible` 另用 2px seal outline + 2px offset。
- **浮层阴影** (`0 18px 45px #15362b1c` 项目菜单、`0 12px 28px #20372e24` 集合菜单、`-20px 0 55px #0c2b2230` 模型抽屉、`0 24px 90px #182c3540` 对话框): 仅菜单、抽屉、对话框可用,淡墨色透明阴影,不用灰色硬阴影。

### Named Rules
**The Hairline-Not-Shadow Rule.** 分区靠细线,不靠阴影;给静止卡片加阴影即违规。阴影是"我浮在你之上"的声明,只有浮层有资格声明。

## Shapes

小圆角印刷表单语言:圆角档位即语义。

- **3px (stamp)**: 状态印章、徽记、标签 chip——越像印刷品角越小。
- **5px (control)**: 按钮、输入框、下拉、通知条。
- **6px (card)**: 卡片、横幅、素材集合容器。
- **8px (tile)**: 图标底托(40×40 icon-tile)、drop-zone、provider 选项卡。
- **9–10px (menu)**: 浮起表面(项目切换器、菜单、模型抽屉内卡片、rail 按钮)。
- **圆形**: 仅步骤号(27px)、selection-ring(22px)、状态点(6px)、活动 orb(32px)。

输入框为直角矩形;虚线边框(#b9cbc1, 1.5px)只用于"待填充"区域(drop-zone、目录选择器)。

## Components

### Buttons
- **Shape:** 微圆角 (5px),min-height 40px(compact 变体 34px),padding 10px 18px,600/13px。
- **Primary:** 实心印章青底白字;hover 仅加深为 seal-hover,不位移、不放大、不换布局。无 sparkle 等装饰图标。
- **Secondary:** 工单白底 + 细线边 + 墨色-二文字;hover 换 mint 底、边框转 #bcd4c9、文字转 seal-dark。
- **Icon / Text 变体:** icon-button 透明底墨色-三,hover mint 底;text-button 12px seal 色 600,hover 下划线。
- **Feedback:** `transition: background/border-color/color .15s`;反馈永远不改变几何,disabled 用 opacity .48。

### Cards / Containers
- **Corner Style:** 微圆角 (6px);背景工单白,1px 细线边,无阴影。
- **Card header:** 16px 20px padding,底部 line-soft 分隔;标题 14px/650,数量徽记 12px line-soft 底 3px 圆角 tabular-nums。
- **Template card(选项卡):** hairline 选项卡,hover 边框转 #a9c4b8;选中 = seal 边框 + 1px seal 选中环 + 右上角 22px selection-ring 实心 seal。无语境插画。
- **Hover-reveal 操作:** 贴纸库删除等破坏性操作默认 `opacity: 0`,`:hover`/`:focus-within` 时 `opacity: 1`(.15s);键盘焦点同样可见,不做"仅鼠标可见"的隐藏。

### Status Stamps(签名组件)
印刷印章式状态标签:实心小色块 + 12px/600 文字,radius 3px,tabular-nums。completed = seal 底白字;failed/interrupted = bad 底白字;running/analyzing = seal-dark 底 #dff3ec 字;默认 = line-soft 底墨色-二字。禁止浅色渐变药丸。

### Stat Plaque(签名组件)
作品页统计行:四等分栅格,工单白卡内 18px 0 padding,列间 line-soft 竖线分隔;标签 12px 墨色-三在上,26px/650 tabular-nums 数字在下,单位 12px 墨色-三紧随其后。盈亏语义用 green-text/red-text 辅助,不改变字号。

### Inputs / Fields
- **Style:** 42px 高,paper 底 + 细线边 + 5px 圆角,13px;placeholder #9aa6a0。
- **Focus:** 边框转 seal + 2px seal 淡环(#0f7a6622);`caret-color: seal`。
- **Checkbox:** `accent-color: seal`,16px。

### Navigation
- **Rail:** 松烟墨底,导航项 60px 高、12px 文字 #98aca7;hover/active 换 #214a41 底 + #d9fff1 字;active 另有 3px #79d7b9 左缘竖条(仅 rail 允许,页内 tab 禁止侧边竖条)。
- **Workflow steps / Subnav:** 见 Layout;active 指示均为 2px seal 横条(步骤在底部,subnav inset 下划线)。

### Overlays
模型抽屉右起 465px、#f8faf9 底、左侧细线 + 淡墨阴影;对话框遮罩 #12332e99。浮层是阴影与 >6px 圆角的唯一合法场所。

### Browser-Surface Theming(全局)
`::selection` seal 底白字;滚动条 10px、thumb #c4cec8 带 2px paper 描边、hover #a8b5ad;`caret-color: seal`;`focus-visible` 2px seal outline;`prefers-reduced-motion` 下全部动画与过渡关闭。

## Do's and Don'ts

### Do:
- **Do** 用细线 (1px #dde3df) 分区,用纸面/工单白色阶表达层级。
- **Do** 让数字 tabular-nums;关键统计用 26px/650 标牌待遇。
- **Do** 让 seal 只出现在主动作、选中态与确认态;稀释需求用 mint。
- **Do** 保持字号地板:正文/控件 13px,辅助 12px。
- **Do** 状态用实心印章色块(completed seal / failed bad / running seal-dark,3px 圆角)。
- **Do** sticky chrome 保持完全不透明。
- **Do** hover/focus 反馈只改颜色(.15s),不改几何;破坏性操作用 hover/focus-within 显现且键盘可达。
- **Do** 尊重 `prefers-reduced-motion`,保留 focus-visible 的 seal 焦点环。

### Don't:
- **Don't** 加 eyebrow/kicker 小字行;标题自身承担层级。
- **Don't** 放英文装饰性营销文案;界面文案即工单语言。
- **Don't** 在 UI chrome 中使用 CSS-art 插画或营销插图。
- **Don't** 给主动作按钮加 sparkle 等装饰图标。
- **Don't** 给页内 tab 加侧边竖条强调(3px 左缘竖条仅属 rail active 态)。
- **Don't** 给静止卡片加阴影;阴影只属于浮层(菜单/抽屉/对话框)。
- **Don't** 用浅色渐变药丸做状态标签。
- **Don't** 引入第二字族或展示字体(含系统展示面孔);辨识度来自印章色、实心印章与标牌数字。
