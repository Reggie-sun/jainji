# Qianchuan Production And Effect Loop

## Delivery

入口“千川 → 制作与效果”，千管家式工作台也有此入口。沿原输出确认页明确选择本轮账户、计划并启用上传，原队列验证成片、原上传owner保存平台接收回执；新页面按冻结广告主/计划采集效果并关联到本地成片身份。查看上传、返回制作配置及ROI/预算查询只导航，不启动生产或平台变更。

效果关联严格使用回执platformVideoId与报表VideoId，不按文件名或materialId猜测。素材ID与视频ID分别保留字符串，同视频的多个素材保留全部行，ROI不累加。READY、MAY_HAVE_UPLOADED和需要人工核查状态不升级为接受；未找到指标不推断上传失败或没有投放。原账本和已关闭批次为记录来源，没有第二套任务、上传账本或恢复权限。

## Live Evidence

2026-10-15北京时间02:14，正常已登录千川页面的真实商品计划含229条素材。当前QianchuanBackendAdapter和collectMaterialEffects直接执行固定只读配方，共三页、同一asOf，229行均提供独立VideoId和精确materialId，两者不同。播放信息在浏览器内裁成VideoId，最终投影没有URL。该账户不依赖千管家中台或官方应用Token。

只读核对原本机上传账本，所选冻结账户/计划有10条ACCEPTED；当前关联模块验证它们的原结果schema后，10/10精确匹配，坏接受证据0。这是已存在回执的效果回读证据，本轮没有重新制作、上传、创建广告、改预算/ROI或消费模型额度。账本原字节、浏览器与平台保持原样。正式记录只保存数量、类型与源码身份；账户、文件名、视频ID、财务值和截图留本机私有目录，不提交。

## Verification And Limits

素材adapter新增VideoId与asOf测试先RED，当前65项通过；纯关联8项、跨页采集8项、浏览器交互8项通过；原查询与整页导航33项通过，typecheck和build通过。交互包括第二页匹配、未知记录不归因、跨账户拒绝、取消/隐藏/重绑后的晚到数据隔离和360/820/1440px布局。首次about:blank测试缺secure-context UUID，改为原有loopback测试模式；异步React状态测试等待真实取消应答后再交付晚到响应，保留原失败日志，不放宽产品门。

采集单次最多2000行、180秒，计数/身份/时窗/重复素材漂移拒绝整次，不保存部分观察或盲重试；主进程拒绝未来及早于统计起点的asOf。支付ROI明确标注，不能冒充当前计划的净成交ROI。界面观察不授予投放权限；预算/ROI真实写入和新广告创建仍须具体对象、上限、明确授权及可验证结果，本轮没有实现或执行这些写操作，不能把现有计划素材闭环声称为完整无人值守投放系统。

本轮在用户授权worktree实现并交付main；共享目录的自动化、上传方式切换、账户缓存等并发改动保持原样。新增测试加入原千川domain检查，原检查没有删除或改为可选。最终owned Harness、completion、AOCI三项官方事实和风险裁决绑定本轮稳定字节；fixture、真实只读及历史真实回执证据分别报告。Windows当前新页面与发现路径未实机验收。

首次scope发现App.tsx原有路由仅为baseline，严格验证器拒绝为Unmapped behavioral source，保留NOT_EVALUATED回执。新增该入口的显式fallback，要求整页导航和原extended-regressions完整组，不把入口改动缩成仅新测试通过。
