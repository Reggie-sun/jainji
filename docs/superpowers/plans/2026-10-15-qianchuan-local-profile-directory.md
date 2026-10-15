# Local Profile Directory Reading

## Goal And Scope

修复本地已绑定 Chrome 因资料根中存在额外 profile 而无法读取子账户的问题。复用原进程、socket、目录会话和查询页 owner；不增加展示缓存或账号来源。

## Contract

本地 CDP 在 PID/starttime、绑定根及启动 profile、ActivePort、监听 socket 与 browserPath 全部核对后，在本次自有后台 `chrome://version/` 页核对 Chrome 的实际 profile 路径和默认 context。只为该实证 context 允许其他隔离 context 存在；每次账户操作仍须核对同一默认 context、真实 target、文档及账户。无法获得或不一致时拒绝，不猜选其他 profile。内部页只读路径和实际 context，不读登录文件、Cookie 或原网页内容；完成、取消和失败均清理自有页。

native messaging 及远端原进程校验继续拒绝多 profile；新的 CDP 进程校验模式只由本地 CDP owner 固定选择，并必须配合实际 profile/context 证明。历史任务、上传连接及 frozen target 不迁移；不自动切换账号、重传、结束批次或启动浏览器。

## Owners And Milestones

1. `qianchuan-extension-process.ts` 保留默认 strict 校验，复用 OS 验证实现，为本地 CDP 明确区分多 profile 的进程元数据读取；既有 native 调用不变。
2. 新建 `qianchuan-cdp-profile.ts`，复用 `withQianchuanQueryPage` 读取自有内部页，返回已证实的默认 context。`qianchuan-browser-accounts.ts` 组合 OS 与 profile 证明；`qianchuan-cdp-account-session.ts` 绑定该 context。查询页只连接与清理其自有 target。
3. 更新原行为文档和 Harness 路由；添加隔离 Chrome 集成回归。Parent 串行修改，无并发 writer；native mapper 只读。

## Acceptance And Verification

- 同根的额外历史 profile 和隔离 context 不妨碍读取已证明的默认 profile；既有用户页保留。
- 错误 profile 路径、默认 context 漂移及非默认目标在账户请求前拒绝；native 多 profile 拒绝断言保持。
- `npm run typecheck`、受影响的进程/目录/CDP/查询页测试、policy 路由的 owned Harness 和 completion verify；仅内部 metadata 与授权目录观察用于真实窗口核对，不执行生产任务或账户切换。

## Self Review

当前 `verifyExtensionProcess` 的多 profile 门属于 native 归属防护，不能直接删除。Chrome 内部页实测能够返回绑定 Profile 路径及默认 context；只读后台自有页提供替代实证。保持原浏览器目录，不清理用户 profile，不用注入的 fixture 证明真实账号成功。该任务内兼容性修订已按用户的软件修复目标授权；不新增用户批准步骤。
