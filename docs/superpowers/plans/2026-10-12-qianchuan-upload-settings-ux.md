# Qianchuan Upload Settings UX Implementation Plan

## Goal And Scope

让“千川 → 账号与计划”首屏直接显示各账号的上传方式，用户点选账号后就能设置“本机上传”“本机上传 · VPS 出口”或“VPS 上传”。消除原“管理账号设置 → 固定出口复选框 → A/B 浏览器位置”的隐藏路径。

## Contract Surfaces And Invariants

沿用 `QianchuanAccountSettings` 的账号编辑状态与 `saveQianchuanAccount` / `openQianchuanAccountBrowser` / `controlQianchuanAccountBrowser`，全局启用仍使用 `saveDouyinUploadConfig`。不新增配置源、队列或上传授权。直接上传保持 `egress: null`；本机浏览器经 VPS 保持不含 `mode` 的旧字节语义；VPS 浏览器使用 `mode: remote-browser`。主体复用必须复制完整已保存设置，不能静默转换同组模式。

选择方式或切页只修改草稿；保存、连接、上传分别由原显式动作及主进程准入完成。保存失败保留草稿。活动编辑账号重复点选不得清空草稿；换到另一账号读取该账号自身保存配置，不继承前一账号。原广告主 ID、恢复任务限制、浏览器关闭二次确认、未知结果屏障及旧冻结任务目标不变。配置标签只描述已保存方式，不声称已连接或已上传。VPS 上传仍需本地简辑运行；首次登录与验证码在 VPS 桌面处理。

草稿继续驻留原组件，沿 `WorkspacePage` 的隐藏保留机制跨千川子页与工作区导航恢复；项目切换及显式恢复任务的 `planEdit.sequence` 沿原重挂载边界读取新上下文。账号草稿和全局配置分别显示未保存提示。复用完整主体后再改方式，复用共享 `validateEgressGroups` 就地提示已保存主体冲突并禁用保存/打开浏览器，保留草稿；主进程仍独立执行同一校验，不自动解除或迁移同组账号。

## Owners And Compatibility

修改 `src/renderer/QianchuanAccountSettings.tsx`（可见账号卡片和编辑入口）、`QianchuanEgressSettings.tsx`（三种方式及原非秘密字段）、`QianchuanSettingsPage.tsx`（就近全局启用与保存）、`douyin-upload.css`（响应式布局）。相关既有 UI / 页面测试适配被移除的折叠入口，并增加上传方式与副作用边界验证。操作文档只更新对应入口说明。共享 schema、IPC、后端和真实账号配置不修改；无需数据迁移。回滚 UI 不改变已有持久配置。

## Major Milestones

### 1. Visible Account Overview And Direct Editing

账号卡片显示名称、完整账户 ID、计划 ID、已保存上传方式和设置入口。未配置账号明确显示“未设置”。选中编辑器就近出现并正确定位；全局开关和保存按钮相邻，未保存状态清楚。窄屏不横向溢出。

### 2. Explicit Upload Method Choices

用可访问的三种单选卡片替换复选框与 A/B 下拉。A/B 往返保留当前主体、SSH、IP 和端口；本机直连明确移除出口。复用已有主体后显示完整复制配置所对应方式。沿用原 schema 校验、保存失败、忙碌禁用与浏览器保护行为。

### 3. Verification And Delivery

运行 `npm run typecheck`、受影响 UI / 页面测试、`npm run build` 及 policy 为 owned scope 路由的 Harness checks。用 Chrome MCP 对当前 App 与隔离 bridge 验证首屏、三种方式、主体复用、账号切换、跨页草稿、忙碌禁用及宽窄布局；禁止真实上传、清理、登录或修改用户账号。稳定候选按 Review Risk Gate 判断适用审查；维护本轮 AOCI 对象并执行官方 Verify / Check / Guide。审查 owned diff，提交并 push 当前 upstream，核对远端 HEAD。

## Acceptance Criteria

首屏能看出每个已配置账号使用本机或 VPS 上传，进入设置无隐藏展开步骤；三种方式与保存结果一一对应。方式切换不触发保存、连接或上传；跨页、重复点当前账号及外部名称更新保留草稿。换账号不泄漏前账号设置。未填写 VPS 字段、错误恢复广告主或 busy 时仍拒绝对应动作。宽屏利用有效宽度，窄屏单列且控件可用。界面证据与真实 VPS / 平台验收分别报告。

## References And Self-Review

依据用户本轮易用性要求、[Fixed VPS Egress](../../qianchuan-vps-egress.md)、[VPS Remote Browser](../../qianchuan-remote-browser.md)、[Harness Contract](../../video-validation-harness-spec.md)。已核对当前 JSX 与 CodeGraph；本计划只改善既有设置操作，不扩大平台权限或远端自治范围。源文档入口描述随新 UI 同步更新，旧冻结任务解释继续由原 owner 独占。

受管 Kimi 调查 `233a8c8e-0d43-4a35-b951-e2c2b18223ba` 实际读取四个必需 source，route 为 `api.kimi.ai / k3 / max / deep`，sealed 源码未漂移，报告协议 `PARSED`。Parent 核对并采纳重复点选 guard、账号草稿提示、同主体方式冲突和 B 模式本机运行提示。其“跨页需提升状态”的疑问已由现有 `WorkspacePage` 源码澄清：隐藏保留 owner 足够，不新建共享草稿源。该调查是实现前 mapping，不能代替最终候选审查或项目验证。

## Implementation And Interaction Evidence

已实现三个入口方式、可见账号卡片、就近全局保存、草稿提示及响应式设置表单。新页面路由测试先在原界面失败，修改后 5 个相关测试文件共 52 项通过；`npm run typecheck` 与最终样式后的 `npm run build` 均成功。

Chrome MCP 对当前 App 与隔离 bridge 验证已保存 VPS 方式可见、A/B 往返字段保留、同主体冲突阻断、账号切换隔离、缺少 VPS 字段禁保存、跨页未保存草稿保留和保存失败保留。延迟隔离保存期间，账号按钮及三种方式全部禁用。1440px 首屏账号三列，760px 表单单列，两者无横向溢出。模拟 bridge 未收到制作、批量制作或平台操作调用；本轮未连接、登录或上传真实账号。截图和执行日志保存于本机任务证据目录，不能替代真实 VPS 或平台验收。

本轮主动评估 session-record：仓库没有声明专用 capture skill；实现决策保留在本计划，机器回执及交互证据保留在本机任务目录。没有将操作记录写入规则或制造 bug-memory。最终 Harness、Risk Gate、AOCI 和 Git 交付结果由同一任务的完成回执绑定，不以本段断言代替检查。
