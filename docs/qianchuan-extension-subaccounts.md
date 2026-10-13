# Qianchuan Extension Subaccounts

## Behavior

普通制作与批量制作的子账户目录、显式切换和当前账户计划读取使用同一 Chrome 扩展协议。本机、代理以及 VPS 均从保存账号的原 Chrome 资料目录解析连接；当前网页子账户独立于保存锚点，新增账户无需登记代码中的 ID。子账户选择只影响下一轮，历史批次保持原账号与计划。

界面按保存账号、子账户、上传计划的顺序操作。先独立读取子账户目录并确认当前身份，再读取该子账户的计划；计划读取失败后仍可刷新目录或选择其他子账户。目录失败时禁用计划选择，显式刷新恢复目录后再读取计划，避免两者互相等待。

目录使用 REA 确认的 `GET /ad/api/v1/account/user-list` 和 `GET /ad/api/v1/account/user/info`，完整核对分页及当前身份。选中后原网页至多导航一次，再核对新文档的姓名与 ID。计划由扩展新建后台只读页获取；完成或取消先清理该自有页再返回。该流程不使用 CDP；原文件上传、清理及确认继续使用既有 owner 和安全边界。

## Installation

扩展资源在开发目录 `resources/qianchuan-extension/`，安装版随应用资源提供相同目录。Chrome 的 `chrome://extensions` 页面开启开发者模式后，使用“加载已解压的扩展程序”选择该目录。每个用于千川的独立 Chrome 资料都需启用该扩展；不同资料的启用状态相互独立。保留既有登录，只加载扩展，不复制登录资料。Chrome 官方版已经移除 `--load-extension`，产品不依赖该 flag 自动安装。

简辑在读取对应账户时，自动于实际 user-data-dir 的 `NativeMessagingHosts` 注册固定 `com.jianji.qianchuan` host。注册仅写应用自己的 manifest 和私有 helper/config，不读取或改写 Cookies、Preferences 的内容；账户隔离检查只核目录及文件元数据。扩展尚未连接时等待重连后刷新；保持原千川网页打开。代理旧窗口若由 `--disable-extensions` 启动，需在原任务允许关闭后正常重启；应用不擅自关窗或恢复旧任务。

VPS 使用现有远端 worker 目录中的 `qianchuan-extension/` 加载扩展。worker 构建将资源一起输出；远端必须安装本轮 worker 才能识别新增固定 RPC。原 SSH 主机指纹、非交互鉴权和主体绑定保持；通信只通过 SSH 转发到 loopback，不开放公网监听。本机简辑保持在线。新增 VPS 账户首次读取时自动注册其原资料目录；扩展启用仍需由该资料的 Chrome 完成。

## Safety And Recovery

平台 Cookie 和 CSRF 仅在 Chrome 使用；简辑只收到账户与计划投影。每条命令绑定已核对的原进程、资料目录、tab 和 document。重复连接、分页缺失、ID 精度丢失、账户漂移或未知导航结果拒绝，不自动重发切换或回切。待确认和结果未知的原上传任务继续阻止切换原浏览器。

子账户目录可以在未开启调试连接时读取。实际上传授权还要求 OS 元数据证明调试监听端口属于同一 Chrome 进程；配置里的旧端口不能作为该证明。Linux native messaging 无法区分同一进程中的多个 Chrome profile，检测到共用资料根目录的其他 profile 时拒绝连接，请使用各账户原有的独立资料目录。显式恢复 VPS 连接会撤销自有扩展隧道，下次读取重新建立；不会自动继续旧任务。

## Verification Boundary

协议与隔离 Chrome fixture 只证明软件接线，不等于真实账户权限、VPS 安装状态或平台上传成功。本轮实际运行、剩余阻断以及远端提交身份需以交付记录为准。
