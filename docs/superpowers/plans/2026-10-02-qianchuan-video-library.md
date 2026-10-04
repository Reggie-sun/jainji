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

## Recovery Delta 2026-10-04

用户明确要求继续删除。原账户授权和暂停上传约束保持；Parent 在已有任务范围内接受下列窄恢复规则，替换“确认后只允许永久阻断”的解释，不允许盲目重放未知批次。

显式清空请求可在账号编辑锁与新的逐账号独占 operation lock 内，只读核对一个尚无 verified/completed 的首批 intent。严格私有读取 gate/start/intent，绑定原 attempt、槽位、advertiser 和当前 configDigest；其他历史形状仍阻断。全量遍历无筛选视频库，检查账户与每页总数、完整数量、唯一 ID、页次及重新载入的第一页稳定。仅当总数精确减少旧批大小且全部旧 ID 在完整库存中消失，才新增带 intentDigest/inventoryDigest 的 reconciled verified 记录，保留原 intent 与 pending，接续删除新的第一页。最终清空才解除原 pending；无法证明则不确认任何新删除。

普通批次确认后最多 30 秒只读等待总数可见性收敛，只有总数仍等于本批起点时继续观察；任何非预期变化阻断。每次确认仍恰好一次。页面避免反复展开已经为 50 条/页的底部控件，并记录阻断阶段和有限错误摘要，便于区别确认与刷新失败。

新增验证覆盖全量分页、旧 ID 在其他页仍存在、丢失响应的首批恢复、独占操作、映射/审计漂移以及延迟可见性。原三轮 native review 已用完；因首批真实失败及可复现底部控件位移，记录最多两个追加 review rounds（总 native 上限五轮），沿同一 Kimi failure fallback，不重置旧轮次或重启 Kimi 循环。真实验收仍先闭合蝴蝶贴清空与两次独立刷新，再继续其余账号。

用户进一步要求只开一个视频库调试，故替换每次新建标签的连接行为：每个 Chrome 复用第一个已存在、仍打开且 origin/route/唯一 aavid 精确匹配的素材库标签；只有没有匹配标签时创建一个。后续核查和删除复用该页，页面层仍核验可见账号与无筛选列表。允许重载这个素材库页，不导航原上传/计划页，不关闭任何原标签。

## Response Readiness And Last-Batch Recovery Delta 2026-10-04

第二批真实确认后再次未获得 verified，原 pending 内现存 start、首批 intent/verified 与末批 intent。Parent 已只读观察总数 1724 到 1674，但首批之外的恢复形状与页面加载误判仍阻断；该观察不是全库 ID 缺席证明。

在本次清空授权内，将恢复限定为完整连续审计链中唯一末批 unresolved intent。逐项核验 start、全部 intent 和此前 verified 的计数、快照衔接、唯一删除 ID、reconciled 摘要；完整当前库存必须精确减少全部已核验及末批数量，全部历史删除 ID 均不再存在。最后 guard 后对原 pending、文件集合和全部审计 digest 做 CAS，再仅新增末批 verified。原记录不可改写、旧确认不可重放；链不完整或漂移一律停止。

页面 open/refresh 先观察这次导航新发出的正常 UI 视频列表 GET 响应，绑定唯一 advertiser、第一页和七项空筛选。HTTP 200、status_code 0、有效 total 与表格总数一致后才承认快照；加载中的空表不证明清空，明确空表还须绑定成功零总数响应。50 条选项先等渲染；普通批次的预期新总数与短暂旧行仅允许在原 30 秒预算内只读观察。

因第二批实际失败及已复现的加载空表和选项竞态，自主封存两轮新的有限 review 预算，总 native 上限七轮，保留已用五轮及原 Kimi 故障记录。新增第六轮 full review，必要语义修复后最多第七轮；预算耗尽、关键 finding 未闭合或末批无法完整核对时停止，不能机械扩展。Self-review：上述变更只修正既有页面快照与末批核对 owner，不扩大删除目标、确认次数、上传权限或每账户资源预算。
