# Offline Administrator Login

## Goal

用户指定的本机管理员使用帐号密码直接登录、永久使用，不请求公网会员服务。当前任务授权该明确例外；Google/普通会员继续沿原在线合同。

## Scope And Ownership

`MembershipSession` 仍独占登录、恢复、退出、心跳和制作准入。新 `membership-offline-admin.ts` 只维护本机加密的密码 verifier 与会话验证。公开 schema / preload / MembershipGate 增加可选密码输入与本机入口，不把凭据或授权开关放进公开配置、renderer 存储或源码。用户已批准保留 `preload.ts`、`aoci.code.txt`、`.aoci/baseline.json` 的外部改动，仅交付本任务 hunks。其余 dirty files 不修改、不提交。

## Contract

- 默认无本机授权；只由当前 OS 用户在私有 userData 中显式配置单一本机管理员。文件使用安全 `safeStorage` 加密，密码只存随机盐的 scrypt verifier；不启用 basic_text。
- 可选 `membership.login({username,password})` 只做本机核验，不回退浏览器、OAuth 或公网密码提交；无参数保留原 Google 登录。
- 本机会话只在主进程产生，绑定私有授权文件；恢复、每次准入及心跳仅核验本机文件。删除、损坏或改变授权令旧会话失效。无期限不等于接受错误密码或缓存的展示状态。
- 退出仍清空原加密会话并停止工作；代际保护阻止退出后的异步结果恢复权限。公网响应不能赋予本机管理员权限。本机 token 不进入续费或管理后台请求。
- 本机权限不代表 Google/Casdoor 身份或公网管理权限，不改变视频制作、上传确认和数据安全 gates。

## Milestones

1. 在现有会员测试中先验证缺失本机 route 的失败；实现私有授权文件与唯一会话 owner 集成，覆盖错误密码、伪造会话、失效、恢复、退出及云端身份隔离。
2. 更新现有 UI / preload，在可用时显示帐号密码表单和永久权限；实际浏览器交互及真实 Electron 加密/重启验证，网络禁止时仍可登录和准入。
3. 为用户当前 `/home/reggie/.config/jianji` 配置帐号（密码仅经 stdin）；维护本任务 AOCI 条目，执行 owned Harness / completion，提交本任务文件或 hunks并 push / 核远端。

## Verification

`npm run typecheck`；policy 原 `account-membership` 测试集合；`tests/knowledge-startup.test.ts`；Chrome MCP 本机密码表单；真实 Electron 独立进程、native safeStorage、零公网请求的登录/恢复/退出/准入；对应 owned Harness 与 AOCI Verify / Check / Guide。

## Self Review

无新支付、云端密码接口、账号库或业务生命周期；本机授权由用户明确要求，不能被远端失败隐式启用。真实密码不进入测试、文档、记录、索引或 Git。旧 Kimi receipt 因 HTTP403 credentials/entitlement 拒绝不可采用；原生只读架构调查独立核对边界，最终 Risk Gate 按验证后的具体后果与缺口判断。
