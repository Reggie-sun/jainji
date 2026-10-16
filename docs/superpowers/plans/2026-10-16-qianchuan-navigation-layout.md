# Qianchuan Navigation And Layout

## Goal
整理千川信息架构，将千管家移至独立侧栏入口，消除工作台与报表同页、来源混用和重复页头。

## Scope And Owners
Parent 串行负责 App / WorkspaceChrome / workspace-flow 的导航、QianchuanWorkspace 的页面分配、QianchuanOverview 的本地概览、QianchuanBackendPanel 与 qianchuan-console.css 的紧凑报表、QianguanjiaPanel 的独立身份及对应 UI tests。路由、取消与草稿保留紧密相关，统一实现与验证，不委派重复 mapping。

## Contracts
千川默认展示投放概览，只读取已有 DesktopState：账户配置、保存计划和本项目上传状态；不冒充平台实时投放数据。查询和完整报表仅在计划与数据页。千管家独立入口仍复用 QianguanjiaPanel 与既有 API；进入不自动连接，离开取消并清理供应商会话。千管家只保留自己的数据概览与账户管理，移除跳往千川的导航与快捷入口，采用原生页标题和紧凑卡片，不嵌套供应商网站外框。WorkspacePage 保留已访问页面草稿；不改主进程、授权、账户绑定、队列、预算或未知结果规则。

## Milestones
1. 原 App fixture 先证明独立入口、默认概览、查询草稿保留及供应商取消；从旧来源切换 fixture 改为两个独立组件入口。
2. 实现导航与本地概览；去掉查询内嵌大标题/来源选择，缩小空状态、内边距和重复卡片层级。
3. 运行受影响 UI、typecheck、build 与 owned Harness；Chrome MCP 验证宽窄屏和正常运行窗口；维护实际变化对象索引，提交、推送并核对远端。

## Acceptance
侧栏千川与千管家分别选中且互不显示对方标题/导航；千川首页展示真实本地配置而非查询表单；报表表单、历史和操作在普通桌面首屏可辨识；无自动平台查询/写入；导航中查询取消、迟到结果隔离与草稿保留有效。

## Self-Review
只重组已有功能并新增本地只读摘要，不新增平台概览 API 或伪造指标。原金融控制组件保持原 owner。使用既有用户授权 worktree；没有 live 子代理 writer 或同路径未提交改动。
