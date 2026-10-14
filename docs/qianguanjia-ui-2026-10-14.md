# Qianguanjia UI Integration Record

## Delivery

“千川 → 计划与数据 → 数据来源：千管家”提供发现原浏览器页面、读取授权账户、读取今日汇总、取消与断开。原千川计划/素材/报表查询仍为默认来源，切换保留其查询草稿。

用户在本轮明确允许 worktree；实现位于独立分支 `feat/qianguanjia-readonly-ui`。共享目录中 `index.ts`、`preload.ts` 的自动化改动尚未提交，本轮没有覆盖或合并这些在途改动。界面实测使用独立开发实例和私有应用数据目录，没有复用生产任务账本或全局模型凭据。

## Usage

保持已正常登录的千管家首页或账户管理页打开，且 Chrome 已允许本地调试连接。选择千管家来源，点击“发现已登录页面”，选择页面后读取账户或今日汇总；唯一页面会自动选中。退出、切换来源、读取失败或取消后重新发现。已有广告主授权沿用，不点击或自动触发重复授权。

当前浏览器自动发现复用 Linux 进程元数据能力。Windows 自动发现尚未验证；没有可连接页面时不启动另一个浏览器、不读取登录文件或复制 Cookies。

## Data Boundary

账户目录展示供应商返回的名称、字符串广告主 ID 与授权状态。目录不修改 JIANJI 的已保存上传账号、计划或历史批次。

首页接口没有 advertiser 过滤，结果明确为 `supplier-home-aggregate`。界面显示全部、直播、短视频三组的当前消耗、成交订单、含优惠券成交金额与支付 ROI，原值展示且不借用千川预算单位换算。供应商比较区间未确认，UI 不展示比较值。该汇总不代表任何单账户或计划的效果。

请求限定 `discover`、`accounts`、`home`，IPC 拒绝任意 URL/headers/投放写类型。会话目录只向 renderer 返回 UUID 和固定页面标签。浏览器 GUID、targetId、token 和用户私有会话绑定留在 main/原浏览器。选择页面只定向 attach，不导航、关闭原页面或 Chrome；账号切换及 Document/store/token 变化由原适配器拒绝。

## Verification Evidence

在完整 Electron 应用中，通过真正的 renderer → preload → trusted IPC → 新 controller → 原浏览器适配器链路读取到 20 个授权账户与 3 组今日汇总。最终 UI 观察时间为 `2026-10-14T12:18:39.034Z`。截图包含用户账户资料，仅在本机私有验证目录保存，不提交。

目标检查 `tests/qianguanjia-queries.test.ts`、`tests/qianchuan-backend-ui.test.ts`、`tests/qianchuan-backend-adapter.test.ts` 共 74 个案例通过：固定请求、sender/session/UUID、同连接复用、取消、来源切换、隐藏、迟到结果、空目录、错误去敏、精确 ID 与窄屏。类型检查通过。最终 owned Harness `20261014T123726Z-c112e911` 的 18 项必需检查全部 PASS；扩展回归 107 文件、996 案例 PASS、零跳过。首次回执 `20261014T121404Z-586caa79` 保留 FAIL：默认 Python 缺 numpy 导致 19 个既有覆盖测试失败，使用现有 Miniconda PATH 后在相同业务字节上完整复验通过。官方 AOCI 完整批次原子维护 10 个对象，Verify、Check、Guide 均对齐；非本轮 baseline 叶保留。

Chrome MCP 当前连接的是其他正常浏览器，不能操作本次 Electron；实际 UI 使用 Playwright CDP 驱动独立开发窗口。关闭测试连接使用 loopback relay 的 detach，原千管家页面保留。没有真实上传、删除、预算/ROI 修改、广告创建或花费。

受管 Kimi 只读调查 invocation `206ffdad-ce14-433f-9ef2-3a36a030d1d9` 在第一次上游请求被 HTTP 403 拒绝，未读取项目源码，不当作独立调查或审查通过证据。Parent 直接完成接线与验证；最终风险 gate 与回归结论分开记录。

## Limits

这条来源仍依赖千管家后端、正常登录与试用/会员权限。接入界面证明两个已验证读取能力可用，不证明素材上传、计划级明细、预算或 ROI 调整已经复现。完整独立于第三方的投放模块仍需原千川浏览器路线或 JIANJI 自有官方应用授权。

## Review Risk Gate

Parent 在原生检查通过后裁决 `KIMI_REVIEW_NOT_REQUIRED`。用户未要求本快照的 Kimi review；没有新的任意网络/凭据出口、投放写入或持久生产状态修改，固定只读 IPC 的可信发送方、会话与取消均有测试及完整 Electron 实测。已接受的 Linux 只读范围没有重大剩余运行缺口，Windows 发现保持未验收。基线 `da27b23b86fb92e6cfa98598929e7ff2d3c7f841`；业务与测试 owned 字节聚合 SHA-256 `bef2d6e979cfe73c7a7e354e6717e0c61714a7bc1d315c388319f690935d4b4d`。Kimi 调查拒绝不作为审查证据，裁决属于 Parent。
