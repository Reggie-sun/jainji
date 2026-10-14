# Qianguanjia Console UI Plan

## Goal

按正常授权千管家首页的实际业务布局，在 JIANJI 增加明显可见的投放工作台，而不是仅提供接口查询按钮。

## Scope And Ownership

Parent 在既有隔离工作目录独占 `QianguanjiaPanel.tsx`、`QianchuanBackendPanel.tsx`、`QianchuanWorkspace.tsx`、`qianchuan-backend.css`、对应 UI fixture/test 与本计划及交付记录。复用原固定只读 controller/adapter 和 trusted IPC，不修改共享目录中其他窗口的 main/preload、自动化和制作文件。布局与状态属于同一 renderer 单元，Parent 串行完成；没有需要独立委派的实现边界。

## Evidence And Target Behavior

2026-10-14 实际正常登录首页包含深色业务导航、全域/标准推广入口、四个浅色指标卡、趋势区、分类推广数据和右侧快捷入口。首版按该结构自主实现布局，使用 JIANJI 自有名称、图形和样式，不复制专有源码或品牌资源。账户页读取的是已验证授权目录；此前打开额外账户研究页未获得可验证布局，不声称账户页逐像素相同。

新增“千川 → 投放工作台”一级子页，同时保留“计划与数据”的来源选择兼容入口。两者共享一个 backend panel 实例和供应商连接 owner。工作台提供首页/账户导航、四项真实指标、三类推广数据、账户名称/ID 搜索、原授权状态筛选、分页与连接/刷新/断开。单击连接仅在发现唯一正常业务页时串行读取目录和今日汇总；多个页面须明确选择。快捷入口跳转原计划查询、素材管理和上传任务。

## Invariants And Compatibility

供应商汇总始终明确属于当前供应商用户，不能按本地账户选择伪装为单账户数据；未读取以破折号展示，缺指标不填零。没有已适配时间序列，不生成示例趋势、跨日数据或对比涨幅。正常页面授权沿用，不触发 OAuth 或重复授权。所有 source/tab/hide/cancel 继续隔离迟到结果；串行连接取消后禁止启动下一次读取。登录凭据和 CDP 地址不进入 renderer、项目或记录。

原千川预算/ROI 查询、素材和上传由原 owner 执行；导航不授予写入、删除或实际广告花费。既有草稿、上传目标、生产任务和旧批次保持原解释。

## Acceptance And Verification

桌面首屏可见顶部导航、四项数据卡和快捷入口；账户可搜索精确长 ID、按原授权状态筛选并分页。360px/820px/1440px 不产生整页横向溢出，表格自身可横向滚动。旧来源入口可用，唯一页面一键连接可读目录与汇总；多页不自动选择；任一阶段取消不发后续请求，隐藏与来源切换拒绝晚到结果。

运行相关浏览器交互测试、typecheck、build 与 owned policy Harness、completion；用 Chrome MCP 验证隔离本地 UI，再在完整 Electron 应用使用已授权用户会话只读验证。实际截图保留本机私有目录；可公开截图使用显式测试数据。按当前官方 AOCI 完整批次维护本轮 indexed 语义对象并完成 Verify/Check/Guide。风险 gate 在稳定验证候选上判断。

## Milestones And Self Review

1. 保存当前授权首页布局证据，建立独立入口和工作台布局，接入账户搜索/筛选/分页。
2. 实现可取消的单击连接和原功能快捷跳转，保留旧来源选择及单连接 owner。
3. 做相关 UI 与完整应用验证、索引维护、记录限制，提交推送。

Parent self-review：请求是复刻对应前端，界面结构与真实数据同时交付；未验证的趋势、投放创建和参数修改不伪装可用，不扩大到服务端凭据或写接口。
