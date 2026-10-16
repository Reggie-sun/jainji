# Qianguanjia History And Material Center

## Scope And Ownership

千管家的“历史报表”和“素材中心”保留在简辑原生页面内。供应商只读请求仍由 `QianguanjiaQueries`、`QianguanjiaReadonlyAdapter` 和原浏览器 transport 管理；本地历史复用 `QianchuanReportStore` 的既有 IPC，素材记录从已加载的 `DouyinUploadStore` 投影。没有新增持久报表库、上传队列、计划创建、预算、ROI 或启停控制链。

## Data Contracts

| View | Source and scope | Date and identity |
| --- | --- | --- |
| 供应商历史账户报表 | POST `/qianchuan/qcunireport/reportPageByProduct`；`VIDEO_PROM_GOODS`、`ADVERTISER`、汇总模式 | 用户明确日期，北京时间，最多31天；账户必须属于本次正常登录目录；响应账户和日期逐行校验 |
| 供应商计划榜 | POST `/qianchuan/homereport/planReport`；固定 `SMART_BID_CUSTOM` | 用户明确日期；只读取第一页10条以内观察；账户 ID 未返回，不受账户勾选影响，不推测归属 |
| 已保存账户/计划素材报表 | 既有千川快照 owner；来源 `qianchuan-browser` | 保留实际 startTime/endTime、asOf、capturedAt 和 frozen advertiser/ad；账户汇总为商品自选控成本，不能当作计划汇总 |
| 平台视频目录 | POST `/qianchuan/qcremotematerial/searchPage`；`VIDEO` | 指定已授权账户；目录不是日期范围内的投放效果或实时全平台证明；只读，不调用同步 |
| 本地成片与上传记录 | 当前已加载的原上传账本，含跨项目和关闭批次的已登记任务 | 保留 project/batch/export task、SHA-256、冻结账户/计划及原接收证据；不读取私有 snapshotPath/config，不恢复上传权限 |

供应商账户报表仅显示实际返回的消耗、成交订单数、含券成交金额、支付 ROI。字段口径和单位沿供应商返回，未与千川独立对账；缺指标为未知，不填零；支付 ROI 不求和。对比仍保留各自期间和采集时间，缺行不解释为零。分页只声称当前实际读取页面。

计划可按日期读取供应商计划榜并按精确计划 ID 比较两个期间；计划关联账户及全量目录仍未知。完整计划范围内的素材效果以已保存的千川快照提供筛选及兼容范围对比。供应商素材效果报表的正常页面观察为 `total/list=null`，没有把该结构解释成零条，也没有将首页今日汇总当作历史数据。没有本地快照时明确为空；历史报表页不自动采集或写入快照，素材中心可显式采集并保存原千川完整素材快照。现有快照私有权限持久化尚未核验 Windows，读取失败不能当作空库。

目录与本地任务的关联必须同时满足精确账户 ID、有效 `ACCEPTED` 结果和接收回执 `platformVideoId` 等于目录 `outMediaId`。`outMaterialId`、`outMediaId` 和账户 ID 保留字符串，拒绝 rounded Number。名称和供应商 MD5 仅为元数据，不能建立本地身份。相同 SHA-256 标识本地成片字节重复；不会合并不同账户/计划的上传操作。READY 和 MAY_HAVE_UPLOADED 不标已接收。同一视频若关联到不同本地字节，显示冲突。

## Query And Recovery Boundaries

延续原固定 HTTPS host、opaque 会话、身份变化失效、credentials omit、无重定向、20秒单次读取及2MiB响应上限。供应商查询先核对当前授权目录，不接受任意URL或写操作。取消停止当前请求，页面输入、账户、会话或工作区变化均忽略迟到结果；失败不自动重试、同步或重新授权。供应商会话失效后需重新发现，原浏览器与标签页保留。本地记录不要求供应商登录，账本不可用时失败关闭。

## Current Evidence

2026-10-16，使用本轮产品适配器源码连接当前正常千管家页面：目录20个授权账户；查询2026-10-15单日推商品历史账户报表，严格解析1行；同日计划榜1行且未返回账户身份；平台视频目录总数202，本页20行，ID均为精确字符串。同一供应商正常素材页曾在另一个账户返回严格空页。这些为真实只读数据结构和范围证据，不证明供应商归因准确、无延迟、平台审核通过或 Windows 实机验收。

计划榜第一次产品读取因 `total=0` 却有1行而正确拒绝。随后通过正常页面同一日期和配方确认该不一致，调整为显式 bounded observation 契约：保留 `reportedTotal`，全量 total 固定未知、coverage 为 current-page-only，只允许 page=1，最多10行；不接受完整性或翻页资格。没有通过放宽凭据、替换账户或盲重试掩盖失败。调整后同源码真实读取通过。

正式文件不保存账户名称、ID、财务值、客户身份、token 或播放URL。原始脱敏运行摘要、源码身份及本轮验证回执位于 ignored Harness run；交付前的最终测试、Chrome交互、Harness、AOCI和审查结果以对应最终候选证据及 Git 提交为准。


## Real Account Effects

素材中心的“投放效果”从跨项目本地有效 ACCEPTED 回执枚举冻结的原槽位、账户和计划，不由供应商目录决定目标是否显示。供应商目录的已列出、未列出和尚未读取分别展示；列出不证明实时权限或效果覆盖。当前保存槽位须仍可用且广告主 ID 与回执一致才能采集；保存计划变化不迁移历史计划，也不阻止同账户原历史计划的读取。槽位重绑后，已有历史快照仍按原冻结身份查看。

用户选择明确目标和最多31天的北京时间日期后，调用原 `QianchuanIntegration.capture`，共用上传协调器账户租约、固定只读 recipe、完整分页采集和 `QianchuanReportStore`。单次上限2000条、180秒；所有页传递 `browserAccess: "existing-only"`，只调用原 `prepareCatalog(product,false)`，不启动、重启或自动切换账户浏览器；缺失时失败关闭。原普通千川入口未指定该参数时保持已有行为。失败不自动重试；取消保持 busy 至原 Promise 清理结束，忽略迟到结果；已原子发布的完整快照不回滚。

原效果 join 和 CSV exporter 按精确账户、计划、回执视频 ID 归因。同账户同视频若跨计划或项目出现不同本地 SHA-256，显示冲突且相关记录不参与归因。保留每个视频对应多条平台素材；CSV 每素材指标只导出一组，本地引用去重，不累计 ROI，不把未匹配行填为零。本地项目、批次筛选只改变记录列表，CSV 仍包含此完整快照全部精确关联项。平台指标原值、显示值、来源、统计区间、截止和采集时间以及原单位口径均保留。采集的快照可在原历史报表页按账户、计划、素材筛选和比较。

本轮真实账本核对证明供应商目录不能覆盖全部实际已接收账户；因此产品提供冻结目标直读而不代替供应商授权。工程模拟、Chrome 交互、真实平台读取及最终治理结果分别保存在本轮 ignored Harness 证据中；模拟值不成为产品历史或真实效果证据。


完整性仅指原 recipe 固定条件、冻结计划与统计窗口内的分页集合，不表示全账户视频上传库。当前 `site_promotion_product_post_data_video` 的固定条件为 `query_type=all`、`roi2_material_type_v3=1001`、`marketing_goal=1`、`roi2_material_status=1`、`roi2_material_video_type=11` 和所选 `ad_id`。枚举业务含义未独立确认，不把这些值解释为“全库”“审核通过”或“投放中”；效果集合未观察到视频不否定原上传接收证据。历史快照匹配要求用户结束日期不晚于该快照北京时间 asOf 日期，并核对窗口顺序，旧的日内快照不能冒充延长后的期间。

## Cross Account Reports

历史报表默认使用“千川跨账户报表”，覆盖所有已保存的非空账户 ID，不以供应商目录是否列出为准。供应商目录仍只是覆盖对照；当前会话未列出其他主体的原因未知，不把接口逆向成功等同于全部账户授权或数据覆盖。

用户显式选择账户及北京时间日期后，可串行调用原 `captureQianchuanReport(kind=report,browserAccess=existing-only)`，逐账户保存完整快照；也可显式读取原 `listQianchuanReports` 的匹配历史。每账户保留完整、失败、不可读取、缺失或取消状态，失败不补零、不自动重试或切换来源。取消阻止剩余账户，等待当前原 Promise 清理后才释放忙碌；本地历史 IPC 只能停止显示和停止后续账户。没有新的主进程队列、授权、浏览器生命周期或存储 owner。

口径沿原 `product_roi2_promotion` 商品自选控成本配方；不是全账户所有投放模式。逐账户展示实际窗口、asOf、采集时间和来源，当日各账户可能不同截止。原 provenance 的金额单位及定义仍为 unknown，不创造金额总计或跨账户 ROI。CSV 同样保留每个选中账户及缺失状态。期间对比按相同 slot 和 advertiser ID 精确连接；差值为当前减基准，不折算期间长度。旧日内快照不能覆盖超出其 asOf 日期的新范围。

配置不可读取不阻止原账户已有历史快照展示；实时采集仍遵守原账号配置、浏览器、出口、任务互斥与身份核验。不启动、重启或切换浏览器，不调用供应商重新授权。

## Existing Session Reads

进入千管家时自动发现并读取已有正常登录页面，不要求用户点击技术性的连接按钮；仅有一个页面时串行读取账户与今日汇总，多页面必须显式选择数据来源，不按名称或枚举顺序猜测。失败与无页面均不后台重试，刷新由用户显式触发；切走与取消隔离迟到结果，下一次读取须等待原取消和断开清理结束，不恢复任何平台写入权限。

已真实观察到今日汇总在HTTP 200、业务code=0时返回精确空对象 `{}`。此形状投影为 `availability=not-provided`，全部指标为null且显示未知，保留已读取账户目录；不把它说成登录或试用失效，也不冒充零消耗。非空但缺组、缺指标、非法数值及其他不合格结构仍拒绝，原会话身份、请求范围与凭据边界不变。
