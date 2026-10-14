# Qianguanjia Authorized Integration

## Finding

**在用户正常登录和千川账户授权完成后，直接调用千管家中台的只读集成可行，无需 JIANJI 自有官方 API。** 本轮同一产品适配器从真实会话读回 20 个“授权正常”账户，以及当日全域首页汇总四项指标。凭据没有导出，未重做广告账户授权，未执行广告变更。

这是脱离千管家页面按钮和 request helper 的读取，仍依赖其正常浏览器会话、客户权限、试用权益和服务器。不是自有官方服务授权，也不是整个投放管理模块已经接通。

## Evidence

前端架构和完整静态接口索引见 [前轮报告](qianguanjia-reverse-engineering-2026-10-13.md)。本轮 [脱敏真实证据](evidence/qianguanjia-authorized-2026-10-14.json) 补充授权后的观察，前轮空账户及示例数据保留为各自时间点的事实，不再用它们描述当前状态。

| Operation | Fixed request | Result | Boundary |
| --- | --- | --- | --- |
| 账户目录 | POST `https://qc-api.uliangtech.com/mms/qianchuanAdvertiser/listAdvertisers`，`{}` | HTTP 200、code=0、data array；20 行；平台 ID 均为 string；20 个“授权正常” | 一次目录结果；不证明全部账户或账户写权限 |
| 当日全域汇总 | POST `/qianchuan/homereport/uniHomeTop`，startDate/endDate/selectFields | HTTP 200、code=0；ALL/LIVE_PROM_GOODS/VIDEO_PROM_GOODS 的 nowTotalData/oldTotalData 四项完整 | 请求未带单账户 ID，标签为 supplier-home-aggregate；comparison 口径未核对 |
| 首页趋势 | POST `/qianchuan/homereport/dataTrend` | 正常页面加载返回 HTTP 200、code=0、7 日期结构 | LIVE_OBSERVED；未加入适配器 |
| 首页账户报表 | POST `/qianchuan/homereport/advReport` | HTTP 200、code=0；total/list/currentPage/totalPage 为 null | 不能据此声称非空账户报表验证成功 |

主页在试用开通后没有“当前为示例数据”提示，会员文字显示试用；这提高了当前正常数据路径的可信度，但没有独立证明数据实时性、归因准确性或与千川原平台一致。正式证据只记录结构、数量和时间，不公开真实账户名、ID、财务值、客户身份或 token。

直接 replay 已确认请求头 `token`（客户会话）、`Channel: PC`、`appType: qianchuan`，`credentials: omit` 可成功。客户 token 只在原网页内用于固定 API host，不复制成官方 Access-Token，不访问第三方服务端凭据。正常授权曾打开 `business.oceanengine.com`，可以证明官方授权页面参与了流程；无法从浏览器证明中台服务器究竟调用了哪些官方接口、缓存或内部任务。

## Implementation

[QianguanjiaReadonlyAdapter](../src/main/qianchuan-qianguanjia-adapter.ts) 提供 `create(Page)`、`listAdvertisers(signal)`、`todayHomeSummary(signal)`、`dispose()`。主进程调用者传入已正常登录的 Playwright Page；返回值只有字段白名单。原 Document、Vuex store、token、客户和 merchant 身份绑定在浏览器 opaque handle，变化即失效；登录/验证码页面、非 JSON、HTTP/business 失败、错误结构、重复或不精确 ID 均拒绝。20 秒和 2 MiB 有界，支持取消，不重试或跟随重定向，错误不投影上游原文。

本轮是经过真实调用的 main-process provider seam；尚未激活产品 IPC/UI，保留 JIANJI 原有直接千川查询、素材上传和官方查询 owner。原账号服务、入口及 UI 当前由其他会话修改，本轮不侵入它们。后续接线时直接消费这个 provider，不新建账户选择器或上传生命周期。

```ts
const adapter = await QianguanjiaReadonlyAdapter.create(authorizedPage);
try {
  const accounts = await adapter.listAdvertisers(signal);
  const home = await adapter.todayHomeSummary(signal);
  // home.scope 是 supplier-home-aggregate；不能归入任意单账户报表。
} finally {
  await adapter.dispose(); // 不关闭用户的 Chrome 或标签页。
}
```

## Authorization And Recovery

用户提供的试用说明明确：每个千川账户只能授权一次，重复授权可能被限制。本模块不实现、调用或自动恢复 OAuth 授权；登录失效只停止读取，要求恢复供应商普通登录后重新连接。试用过期或权限拒绝只报告读取失败，不自动购买、变更会员或重复授权。

## Capability Status

| Capability | Current status |
| --- | --- |
| 客户已授权账户目录 | LIVE_VERIFIED_BY_ADAPTER；可独立于页面按钮复现 |
| 当日全域首页汇总 | LIVE_VERIFIED_BY_ADAPTER；供应商汇总范围，未做平台对账 |
| 账户/计划/素材明细及历史报表 | STATIC_ONLY 或结构观察；没有非空真实明细验收 |
| 视频上传与素材管理 | 已找到第三方接口事实；未实调第三方上传或素材修改 |
| 商品全域创建、预算与 ROI 修改 | STATIC_ONLY；广告花费或参数修改默认不执行，须明确对象、预算上限和操作审计 |
| 多店铺映射 | 20 个广告账户不是 20 店铺证明；店铺关系与权限待验证 |
| 中台脱离供应商长期运行 | 当前路线不具备；供应商停服/试用或会话到期会阻断 |
| 自有官方 API | 尚无用户自有应用授权；前轮只读素材 provider 留作后续选择 |

## Verification And Next Steps

isolated Chrome fixture 测试覆盖现有千川/官方能力及新增供应商目录、汇总、身份变化、错误脱敏和取消。新增 19 项最初 RED，最终另补两项登录/泄漏测试；当前 60 项通过。真实验证由同一源码经已有 esbuild 去除 TypeScript 类型执行，不是另外手写的替代请求。

受管 Kimi `deep/max` 只读 mapping 已核验封存源、Docker containment、实际 Read 与 api.kimi.ai/k3 两次请求；其建议由 Parent 按本轮真实头、Cookie-independent 请求、行 schema 与范围裁决，不把 PARSED 当验收。最终 verification、AOCI 与 review risk gate 结果见机器证据。

第一次 Harness `20261014T090450Z-af35b5c8`：typecheck、41 文件 858 项千川回归（零失败、零 skip）、关联合同文档检查分别 PASS；总体 NOT_EVALUATED，保留为并发期间的记录。当时官方 Verify/Check/Guide 返回不同事实，新增 source 尚缺 Entry。本窗口完整读取并作者化/裁决本对象语义，共享 writer 随官方完整 20+1 CAS 批次落入 IN8S Entry 与对应 source leaf；Parent 再核对本对象，没有截断批次或重复写已对齐记录。

最终验证在 4397 文件的冻结副本完成（没有 `.git`，不是开发 worktree；Git shim 仅只读访问原对象库），四项必需检查全部 PASS：`20261014T092215Z-798515c0`；completion `20261014T094124Z-1bbc097d` PASS。源码及测试与当前 owned bytes、真实调用 hash 一致，直接依赖与基线 commit 一致。当前共享工作树仍有其他窗口的手动覆盖修改，不声明全库当前验收或其 AOCI 已对齐。

稳定候选上的 Parent Risk Gate 为 KIMI_REVIEW_NOT_REQUIRED：没有用户指定 final review；固定两项只读配方没有新增凭据导出/store、任意 endpoint、广告写入、持久状态修改或 IPC 激活路径；真实调用及 browser guards/cancellation/反射测试覆盖当前准入，没有“重大后果且仍有实质缺口”的证据。此前 Kimi mapping 不代替 final review，供应商归因及 UI 激活仍明确未验收。

提交范围仅为本轮 source/test/report/plan/evidence 和一个自有 Entry/leaf，保留其他窗口暂存内容；commit/push 身份见 Git 历史和交付消息。仓库未声明专用 session capture Skill，本报告、计划和机器证据记录本次 live proof、冻结验证及范围限制。

优先下一步核对单账户真实报表和素材关联，以 video_id/material_id/advertiserId 保留 exact string，并把供应商指标与原千川查询对账。随后沿既有制作和上传 owner 联接素材效果。写接口在只读前值和产品授权/预算/审计契约完成后再实现。长期独立性需要迁移至千川正常浏览器会话或自有官方授权；第三方中台适合作为当前可替换 provider，不能成为 JIANJI 的唯一业务 owner。
