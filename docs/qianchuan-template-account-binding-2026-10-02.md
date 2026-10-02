# Template Upload Account Binding Delivery

## Goal And Implementation

用户选择 A：每个模板在批量列表选择并记住账号，多个模板可共用账号。实现遵循 [Upload Spec](douyin-auto-upload-spec.md#per-template-account-binding-amendment-2026-10-02) 与 [Implementation Plan](superpowers/plans/2026-10-02-template-upload-account-binding.md)。模板与账号名称不必相同；无显式关联的旧模板兼容唯一同名匹配。

QianchuanAccountSettings 将关联保存在应用私有的 `accounts/template-accounts.json`，复用独占写锁、私有文件读取和原子持久化。关联绑定 registry、实际项目、账号槽及期望 advertiser；主进程独立核对身份和预检变化。项目文件、账号 mapping digest、原 Chrome profile 和已有冻结上传不因保存偏好而改变；关联不授予制作、选文件或确认权限。

## Executed Evidence

- RED：关联解析和持久化接缝缺失时，聚焦测试出现 3 个预期失败；实现后相关 5 个文件的 139 个测试通过。
- `npm run typecheck`、`npm run build` 已执行成功；构建有原有大 bundle 提示。
- 独立真实 Electron 进程使用原 preload / IPC / settings owner，通过 Playwright CDP 选择 `新眼贴模板` 和 `眼贴2` 共用一个测试账号，验证刷新及进程重启保留。最新构建后再次执行通过；项目与 mapping 字节不变，制作调用和平台上传调用均为 0。证据：`.agent/harness/runs/20261002-template-upload-binding/ui-result.json`、`ui.png`、`ui-verify.mjs`、`ui-final.log`。
- 2026-10-02T14:43:14Z 对原 `make frontend` 窗口只读检查：新保存接口已加载，13 个模板均提供实际项目身份，6 个可用账号，0 个已保存关联及 0 个关联读取错误。未代替用户选账号。证据：同目录 `runtime-result.json`。
- 浏览器测试发现扩展后台 worker 会增长；测试改为核对非空、排序的 page target，并按现有 fixture 禁用扩展。临时 PID namespace 使用回收子进程的 init；不关闭或改权限于原账号及其他任务的 Chrome。聚焦的 Harness / browser-manager 37 个测试通过。

## Delegation And Parent Adjudication

受管 Kimi deep 只读 mapping invocation `802cc821-6ef2-4947-a20d-e506ecffc30a`，qualification `4f2d5dc8-4234-4665-b382-e82f1ad6cc00`，sealed contract `e9918d24-163b-4753-b2af-813489c56ddd`。实际报告及 canonical receipt 位于用户本机 router runs；报告的 PARSED 不构成验收。

Parent 采纳既有 settings owner、独占锁及独立偏好文件；拒绝直接写项目字段，因为它会与编辑器内存快照竞争，并把本机账号写进可分享项目。仅存槽位无法拒绝 advertiser 换绑，所以保留期望 advertiser 身份断言。报告未读取全部 consumer，不替代准入测试或最终裁决。

## Verification Gate And Ownership

最初基线为 `9d45b80f78b48ad723d01b2c0c31bb817197675c`；一次中间检查 `.agent/harness/runs/20261002T144024Z-8703d228/receipt.json` 因另一窗口改源码及重叠测试而成为 NOT_EVALUATED，不能代表最终通过。Parent 停止写入重叠文件并请求 ownership；用户选择 A 由本窗口保留双方修改后接手。另一窗口已经把自身两行测试调用及 browser 修复单独提交到 `26382c7`，本轮测试 diff 只剩 page target 核对及 fixture 扩展隔离，没有重复提交对方代码。

最终源码 scope 基线 `26382c76598c7a1fec1e255c48d487c12f01ffd4`、19 路径、SHA256 `977f26796e068dfa099fbf1bf4baf1cc8879d87a88625b49e15e7036726b9e39`。正常宿主环境回执 `.agent/harness/runs/20261002T145349Z-1606428a/receipt.json` 为 **PASS**：typecheck、11 个测试组、documents 与 owned-aoci 均通过，共 1,154 个测试、0 失败、0 skip；19 个 owned AOCI disposition 与官方当前快照一致。最终代码证据不依赖临时 PID namespace。

Completion verify `.agent/harness/runs/20261002T150154Z-22dc5a98/receipt.json` 为 PASS，核对源码、scope、策略、合同和产物字节；不重跑命令或授予平台验收。

本轮 10 个 indexed 源文件由官方完整批次维护；CSS、测试和文档按 scope observe/exclude 处理。最终官方 Verify、Check、Guide 均 exit 0：结构及治理对齐，Check ok，Guide complete、next_action=none。共享索引与 baseline 保留其他任务内容，不整文件提交混合改动；本轮源码、测试、Spec / Plan / record 为提交单位，索引在工作树中已维护。维护不代替行为和 completion gate。

## Implementation Risk Gate

以上稳定 scope / snapshot 及通过的项目检查是本次判据，结果 **KIMI_REVIEW_NOT_REQUIRED**。用户未对本 snapshot 要求 Kimi review。保存入口只写可恢复的私有偏好，不接收路径、PID、URL、配置 digest 或凭据，不执行浏览器或上传动作；没有新增关键级凭据泄露、越权或不可恢复生产数据损坏路径。主进程独立核对 registry / project、账号槽、advertiser 和预检变化；原上传授权、fence、可见页面核验与确认禁令保持原 owner。

错误关联可能影响后续目标，但新增边界已由严格输入、advertiser 换绑、项目替换、私有文件、并发写锁、预检竞态、同账号多模板冻结、独立真实 Electron 刷新和重启验证覆盖，未发现新增语义的重大验证缺口。未评估的 Windows 与平台效果不属于新增路由证明，仍按原准入限制处理；不以 reviewer 替代它们。没有叠加 native reviewer，也不把此前 Kimi mapping 当审查。

## Limits

本轮实际交互只证明账号选择和保存，不发起商业模型、真实上传或确认；Windows 实机、真实平台上传和最终视频观看未评估。原 make frontend 已加载新接口；没有强制中断用户制作或关闭真实账号窗口。
