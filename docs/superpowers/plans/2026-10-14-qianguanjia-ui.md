# Qianguanjia UI Integration Plan

## Goal

把已验证的千管家只读适配器接入“千川 → 计划与数据”，复用用户已登录授权的正常 Chrome 页面。

## Scope And Contracts

新增独立供应商来源，默认仍为原千川查询。共享严格请求只接受 UUID、固定查询类型和不透明会话 ID；main 注册可信 IPC，preload 只暴露固定方法。浏览器端 token、用户私有身份、CDP URL 和原始响应不进入 renderer 或持久存储。

浏览器连接复用现有进程元数据发现、loopback 中继与定向 attach；不导航、关闭用户页面或 Chrome，不触发 OAuth 或重复授权。会话绑定原浏览器 GUID、target、Document 和供应商身份，变动时停止并清空观察。供应商首页汇总无 advertiser 过滤，不映射为 JIANJI 单账户或上传目标。

## Current And Target Behavior

现有库只有两个可复现读取方法，无产品调用。目标界面可发现已有千管家业务标签页、选择连接、读取账户表和北京时间当日三类汇总；显示范围、读取时间、空目录、失败与取消。切换来源或离开页面取消请求、释放连接、隔离迟到结果。原查询草稿保持。

## Ownership And Milestones

Parent 独占新增 shared DTO、供应商浏览器连接与只读查询 controller、供应商 panel；修改干净的 QianchuanBackendPanel、对应 UI fixture/test 和必要的取消白名单。`src/main/index.ts`、`src/main/preload.ts` 已有其他窗口改动，用户决定写入顺序之前不修改。正式 AOCI 资产仅按官方完整批次/CAS 维护并保留共享结果。

1. 建立严格固定 IPC 契约与可取消的浏览器连接；Kimi 对现有 transport/discovery/adapter 进行只读调查，冻结其源码期间不编辑。
2. 接入来源选择和只读表格、汇总；在用户解决两个入口文件 ownership 后完成 main/preload 接线及停止清理。
3. 执行类型检查、相关浏览器与 controller 测试、实际 UI 只读查询；按 policy 路由运行 Harness、风险 gate、必要 AOCI 维护；仅提交并推送本轮变更。

## Acceptance And Verification

严格拒绝任意 endpoint/headers/写类型及其他 sender 的会话或取消；同会话的目录和汇总读取必须共享身份固定 handle。取消、隐藏、来源切换、登录变动均不让旧结果覆盖当前界面。用隔离 Chrome fixture 验证控件、账户 ID 精度、统计范围、迟到响应、错误去敏与窄屏布局；用已授权用户会话只读验证目录和汇总，不在测试中消费平台写权限。

运行 `npm run typecheck`、`npx vitest run tests/qianchuan-backend-ui.test.ts tests/qianchuan-backend-adapter.test.ts` 与 policy 为具体 owned 路径选出的必要检查。工程测试与正常平台读取证据分开记录；Windows 浏览器自动发现没有资格时明确说明，不假称跨平台通过。

## Out Of Scope And Self Review

不上传、删除、调整 ROI/预算、创建或启动广告，不购买会员、不重新授权，不新增队列或改保存账号映射。Parent self-review：包含用户“接入界面”要求、固定接口与身份/取消边界；账户级明细和全套投放管理仍没有真实非空证明，不展示为可用功能。
