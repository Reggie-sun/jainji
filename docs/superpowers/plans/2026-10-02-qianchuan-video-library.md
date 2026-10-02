# Qianchuan Video Library Clearing Implementation Plan

## Goal And Authorization

用户选择 `B、A`：在软件加入视频库清空功能，并实际清空每个已配置 Chrome 各自绑定广告账户的视频库。授权不以示例链接的账户覆盖其他绑定。删除不影响平台正在使用这些视频的创意和计划，依据本轮真实删除弹窗；源码与运行核验仍独立执行。

## Scope And Owners

- `DouyinUploadService` 复用 `managingBrowser` 与现有制作/上传互斥，提供清空操作入口。
- `QianchuanAccountSettings` 在原账号写锁内解析保存槽位、预期 advertiserId 和私有配置身份；原 `QianchuanBrowserManager` 验证并提供对应绑定连接。
- 新共享 `qianchuan-video-library.ts` 只定义清空请求和结果；新 main library 模块拥有删除审计/永久未知屏障，新 page/browser 模块只实现经真实 DOM 核对的操作与安全 CDP transport。
- 原 trusted IPC / preload 接入；账号设置中提供逐账号及全部已配置账号的明确删除确认，展示账户与结果。

## Invariants And Recovery

在独立新标签打开 `/tools/creative-management/video-library?aavid=<bound-id>`，不关闭、导航或确认原上传页面。每次动作前核对 origin/route、唯一 aavid、可见 header 账户 ID、无搜索或类别筛选、第一页和列表总数。选中当前完整页，核对每行 ID、选中数量及精确删除警告后，先同步私有批次 intent，再点击该删除弹窗内的“确认”。既有上传“停在确定前”保持；新增许可只适用于素材库删除弹窗。

每个账户独占持久 gate。删除后须重新加载同一新标签，确认总数精确下降且所选 ID 不再出现；继续删除新的第一页，直到零总数及空列表。任一未知、部分结果、页面变化、取消、异常或预算耗尽停止该账户，保留 gate 和审计，重启不自动重试。尚未点击删除确认的拒绝可解除 gate；已有任何确认但未获得完整终态则保留。其他账户顺序继续并逐项报告，失败不能汇总为全部成功。

每账户上限 30 分钟、初始最多 20000 视频、最多 1000 个批次，单页最多 100 视频；这些是任务内有限资源，不授无限重试。完成需要本次冻结起始数量全部得到逐批证据和独立刷新后的空库证据。不清本地素材、登录数据、上传 ledger 或历史 fence；没有后台定时清空、恢复删除或模型调用。

## Milestones

1. 实现共享请求校验、精确页面合同、安全连接、durable gate 与有界清空，并通过 fixture 验证跨页下降、空库、账户错配、确认前持久化失败、确认后未知与重启拒绝。
2. 复用现有 service/account 互斥与 trusted IPC，接入账号设置逐项/全部清空确认与结果；运行 typecheck、受影响测试、隔离实际界面交互以及 scoped Harness。
3. 稳定候选后进行 Risk Gate 判断。本功能可跨六账户永久删除素材，触发受管 Kimi deep read-only implementation review；parent 调查裁决及必要修复后重验。随后从软件真实入口执行本次用户已授权的六账号清空，并保存每账户实际结果；实际阻断保留，不猜测成功。
4. 核对最终 diff、owned AOCI role 和官方 Verify/Check/Guide，记录工程与平台证据的区分，提交本任务文件。

## Verification And Completion

新增测试登记 `.agent/harness/policy.json` 的上传检查与路径路由。执行 `npm run typecheck`、`npx vitest run` 的受影响集合及 `npm run harness -- code --scope <owned-scope>`；使用 Chrome MCP 验证实际 renderer 交互，fixture 不授平台验收。真实执行使用同一产品 service/IPC，核对六个保存账户、原浏览器绑定和当前源码身份。结果未知或 required review/维护不可用时如实报告对应 blocker，不声称全部完成。

## Self-Review

原页保持及平台删除警告使旧 READY/UNKNOWN 上传记录无需改变；互斥只阻止正在制作/上传或新准入，历史屏障仍阻止重传。删除 authority 不扩散到上传确认或广告设置。账号写锁和 expectedAdvertiserId 防止界面旧绑定清错账户；逐批 durable gate 防止断电后盲重试。计划在本次已授权 scope 内，无新增用户批准 gate，无 worktree。
