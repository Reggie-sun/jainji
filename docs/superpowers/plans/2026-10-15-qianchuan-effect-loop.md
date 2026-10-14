# Qianchuan Production And Effect Loop

## Goal And Scope

在已有制作队列、千川上传接收账本和固定只读查询之上，交付可操作的素材效果闭环页面：用户沿原制作入口明确选账户/计划并制作上传，再按冻结目标采集素材效果，逐成片显示真实接受状态和精确关联指标。复用既有生命周期，不另建上传、投放或导出队列。

## Evidence And Contract

2026-10-15 正常千川页面有一条正在投放的商品计划，素材页面显示229条。固定只读 material/list-required 配方返回非空十行；正常页面请求含 roi2_material_video_play_info，JSON字符串的 VideoId 是独立字符串字段。它与 materialId 不互换，也不凭文件名归因。浏览器只投影VideoId，不把预览链接和其他播放信息传入renderer。

共享素材结果新增可选videoId，旧无此字段仍能查询，但不能逐视频关联。可选asOf冻结跨页截止时刻；main拒绝未来或早于查询起点的截止时刻。采集限2000行、180秒，计数漂移、重复素材、错广告主/计划/时间窗拒绝整次观察；取消、隐藏及账户配置变化撤销读取并丢弃迟到结果，不重试未知请求。

关联只消费schema合法的ACCEPTED及acceptedEvidence，同项目/批次/导出任务身份和冻结广告主/计划，匹配平台videoId。一个video对应多material时保留全部行，不任取一条，也不把非可加ROI累加。素材目录缺席不能证明上传失败或未投放；READY/MAY_HAVE_UPLOADED/UNKNOWN保持原状态。目标槽位重绑后禁读旧目标，不用新账户覆盖旧批次。

## Ownership And Compatibility

Parent拥有 qianchuan-backend.ts、qianchuan-backend-adapter.ts、QianchuanEffectLoop.tsx、QianchuanWorkspace.tsx、QianguanjiaPanel.tsx、qianchuan-backend.css、对应adapter/UI测试、计划与记录。独立bounded worker仅拥有src/shared/qianchuan-effect.ts及tests/qianchuan-effect.test.ts的纯观察关联逻辑。所有写入在已有用户授权worktree，保留共享目录的main/preload/上传/自动化在途改动。旧计划查询和来源选择保持兼容。

## Invariants And Limits

默认只采集数据，不上传真实文件、创建广告、改ROI/预算或扩大花费。原制作与上传入口仍由原owner校验明确账户/计划及本次授权。接受不代表审核通过或带来成交；支付ROI不冒充净成交ROI。没有真实接受回执时明确等待，不用演示回执或汇总冒充逐片归因。自有官方API仍未授权；本闭环使用正常千川会话，可以独立于千管家中台读取效果。

## Milestones And Verification

1. 添加严格的videoId投影与冻结查询时刻，先RED再GREEN验证精确ID、无播放链接泄漏、非法播放数据和时刻拒绝、旧调用兼容。
2. 纯关联模块按冻结身份连接接受回执与素材行，覆盖跨账户、未知上传、同名异片、一视频多素材、重复及身份漂移。
3. 增加“制作与效果”子页、工作台入口，展示原状态、绑定目标、分页采集和逐片效果，连接原上传与制作导航；测试取消、旧槽位拒绝、迟到响应、三个屏宽及无生产副作用。
4. 用实际授权页面对同一产品adapter核验非空素材和VideoId，Chrome MCP测试隔离交互，完成typecheck/build、原policy owned Harness及completion、必要AOCI维护和风险裁决，提交push并核main远端。

## Self Review

这次交付补齐已有计划的制作上传与效果回读路径。新计划创建及ROI/预算真实写入不是只读闭环的隐含权限；未取得具体投放对象、上限和授权前不伪装为可执行写能力。真实平台整条生产上传验收须有本轮选择及实际回执，fixture只证明工程行为。
