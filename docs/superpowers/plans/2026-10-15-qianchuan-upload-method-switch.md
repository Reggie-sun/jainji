# Qianchuan Upload Method Switch Implementation Plan

## Goal And Scope

用户在账号页选择上传方式并保存即可应用；后端计算同主体成员、检查任务保护、正常关闭旧浏览器并一次保存配置。前端不再要求勾选整组或手动关闭浏览器；技术连接字段折叠，错误在操作附近展示。

## Contracts And Invariants

复用 `QianchuanAccountSettings.savePlan/save`、原写锁、`DouyinUploadService.saveAccount/guardEgressChange` 和 `QianchuanBrowserManager.control/assertClosed`。同出口 A/B 切换由后端计算成员；现有 `egressGroupChange` 可继续携带旧路由及完整名单用于 stale 检查。不得迁移主体或 IP、改旧批次目标、复制登录数据、自动确认、自动重传或强杀。保存成功不等于连接或平台上传成功。

普通账号保存显式授予空闲旧窗口正常关闭；导入与启动恢复继续只检查闭窗，不自动关闭。任何绑定写入或关窗前只读解析整组实际浏览器，保护原账号、该槽位的子账户和共享浏览器任务；任一成员被保护时不开始关闭。逐次关窗前仍重新解析并核查；关闭中失败可保留已关闭窗口，但配置整体不写入，原账本及屏障保留；所有关闭结束后再核保护和闭窗，写后未知仍锁存。

## Owners And Milestones

1. `src/main/qianchuan-account-settings.ts` 负责组切换与关闭顺序；`src/main/douyin-upload-service.ts` 负责上传资源保护。按用户已确认的顺序，本窗口先完成 browser-manager、index、preload 的必要修改并保留其他窗口 hunks；automation files 不修改。Browser manager 在关闭前安全发现并绑定导入的原窗口，实际 endpoint 保护检查先于绑定写入。现有 `tests/qianchuan-egress-settings.test.ts`、`tests/douyin-upload-service.test.ts` 覆盖自动闭窗、组原子保存、子账户及共享浏览器保护、失败和未知结果。
2. 三个现有账号设置 renderer owners 删除手动整组步骤、折叠高级字段、保留原 API，并提供就近进度及失败反馈。`tests/task-pages.test.ts` 与 `tests/qianchuan-egress-ui.test.ts` 验证默认简单界面、失败保留草稿、组更新、忙碌状态和无上传副作用。
3. 更新两份 VPS 操作说明；在稳定源码后执行 typecheck、项目 owned Harness、隔离 Chrome MCP smoke、必要 AOCI 维护及 Risk Gate 判断。只提交本任务文件/托管资产 owned hunks，push 当前 upstream 并核远端 SHA。
4. 账号页显示所有项目未结束批次的只读投影，按原槽位、账号及待切换主体过滤；错误移除 IPC 包装并只展示一次。明确确认后经独立 account-page closure 入口校验 project/task/expected batch 三项身份，复用原 closeBatch/store owner，保持现有当前项目任务入口限制。不自动结束、恢复、确认或重传旧批次，不切换当前项目。此项源于用户实际旧项目阻塞截图；共享文件顺序已获确认。

## Acceptance And Verification

- 已设置 VPS 的 A/B 切换无需 checkbox、手动闭窗或重新填写技术字段；保存后所有同主体卡片一致。
- 受保护任务（含子账户/同进程）拒绝切换，不关窗、不写配置、不改历史屏障；槽位调整和重启端口变化后仍按冻结 VPS 路由保护原主体；关闭失败不部分保存。
- 账号操作的真实错误显示在账号编辑区，失败保留所选方式及输入。
- 旧项目批次在账号页可见；后端复用出口保护匹配规则投影共享浏览器关联，槽位或广告主不同的阻塞批次仍可见。运行中真实浏览器保护触发的关联只作界面提示，不授关闭或重传权限。查看与取消不触发写入，确认只结束冻结引用的单批本地上传，原结果与防重传屏障保留。
- 运行 `npm run typecheck`、相关四个测试文件及 policy 路由的 owned Harness；隔离 bridge 的 Chrome smoke 不使用真实账号或额度。

## Self Review

范围只简化既有切换，不新增队列或自动重试。组名单及旧出口检查不因取消 checkbox 而取消；任务保护覆盖浏览器锚点与实际子账户。当前共享 dirty state 仅作测试参与输入，归属独立核对。真实 VPS/平台与 Windows 行为不以隔离证据冒充验收。
