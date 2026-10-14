# Qianguanjia Read-only Session Adapter

## Goal

复用用户正常千管家会话，向固定中台接口读取账户目录及当日全域首页汇总。用户已明确授权研究、账户接入及最小实现；不需要自有官方 API。当前能力仍依赖供应商正常登录、试用权益及后台服务。

## Scope And Ownership

Parent 单 writer 新建 `src/main/qianchuan-qianguanjia-adapter.ts`，在已有 owned `tests/qianchuan-backend-adapter.test.ts` 添加浏览器 fixture 验证，新建本计划、脱敏证据和授权验证报告。其他会话拥有账号配置、扩展、原服务、`index.ts`、`preload.ts` 和 UI，均不改动；保持现有直接千川查询和官方素材接口。

CodeGraph 已核查 `QianchuanBackendAdapter` 及直接调用者，沿用 main-process Page/JSHandle seam，不新增凭据 store、账户选择器、上传队列或广告变更生命周期。新 provider 为可调用库接口，本轮不激活产品 IPC/UI。

## Contract

- `create(Page)` 仅接受正常 `https://qc.uliangtech.com/dist/` 会话，冻结 Document、Vuex store、客户 ID、merchantId 和客户登录 token，所有私密字段留在浏览器的 opaque handle。
- `listAdvertisers(signal)` 固定 POST `/mms/qianchuanAdvertiser/listAdvertisers`，body `{}`。返回账户 ID、名称、原授权状态和采集时间；不声明名单完整性或把状态转换成写权限。
- `todayHomeSummary(signal)` 固定 POST `/qianchuan/homereport/uniHomeTop`，使用中国日期及四个已观察指标。分组保留 ALL/LIVE_PROM_GOODS/VIDEO_PROM_GOODS；首页未传单账户过滤，明确为 `supplier-home-aggregate`，不绑定为某个 JIANJI 广告账户。comparison 口径未独立验证。
- 两种请求都只允许固定 `qc-api.uliangtech.com`，凭据不跨 CDP 输出；只返回字段白名单，校验 exact string IDs、完整有限指标及重复身份，不把缺值当零。
- 请求前后核原 Document、origin、store、token、user/merchant 身份；变化关闭本实例。20 秒、2 MiB、取消及 dispose 有界；不跟随重定向，不重试，不向错误投影原请求/响应或凭据。
- 用户提供试用一次授权限制；任何失败只提示检查正常登录/试用权限，不发 OAuth/重新授权/付费请求，不修改广告花费、ROI、预算、状态或上传素材。

## Acceptance And Verification

先运行新增 fixture 测试证明 RED，再实现并运行 GREEN、typecheck 及 owned Harness 路由检查。测试覆盖固定 endpoint/headers/body、名单和汇总投影、跨客户和同 token 身份变化、Document 替换、失效登录、HTTP/business/非 JSON/过大响应、错误脱敏及取消/dispose 后禁止请求。

使用同一实现连接已授权正常浏览器，采集脱敏真实回执：目录行数、状态计数、指标字段完整性；不保存账户 ID/名称、实际金额、token、OAuth code 或第三方源码。服务器 code=0 及无示例 banner 不证明归因口径与官方一致。

完成适用 verification 后按 SUBAGENTS.md 判断 implementation review 风险，不以 mapping 代替审查。AOCI indexed 对象按官方批次维护并与共享资产保留其他会话结果；最终只提交推送本轮 owned bytes。独立完整数据中台、广告写能力、单账户及素材报表均为后续需要另行实测的扩展。

## Self Review

范围与用户直接中台接入目标一致；最小两个只读端点均已有真实调用观察。普通登录恢复与广告账户一次授权区分清楚。供应商汇总不会混作账户级数据，不侵入并发 writer 文件，不复用官方 API token，不改变投放参数。
