# Account Configuration

本机人工填写文件：`/home/reggie/电商/千川账号配置.json`。按产品填写 `advertiserId`（广告账户 ID）与 `adId`（已有全域投放计划 ID），均须保留双引号，不能填写 Chrome profile ID、抖音号或商品 ID。没有确认的值保持 `""`。热敷贴使用原舒鼻膏的 Chrome profile。

千川链接中 `aavid=` 对应广告账户 ID，`adId=` 对应计划 ID。文件建立时蝴蝶贴按用户提供的链接填写，其余五个产品留空；后续仅根据用户确认或对应 Chrome 的真实页面补充，不根据账户排列顺序推测。

```sh
node scripts/qianchuan-account-config.mjs /home/reggie/电商/千川账号配置.json --check
node scripts/qianchuan-account-config.mjs /home/reggie/电商/千川账号配置.json --open 氨糖膏
```

# Test Boundary

每次执行均重新读取文件。`--check` 只检查配置；`--open` 需要已启动且开启 CDP 的对应 Chrome，以及本机 `chrome-devtools` CLI（已验证接口为 1.7.0）。程序建立独立 CLI session，在新 tab 打开指定账户和已有计划，读取可见账户与计划 ID 核对；不会覆盖原有上传草稿。缺少 ID、配置歧义、账户被关停或页面不能证明匹配时明确失败，没有自动重试。页面尚未加载完时也可能需人工检查后重新运行。

此脚本属于当前 CDP 人工测试工具，不接入简辑制作界面，不上传视频、不点击“确定”、不新建或调整投放计划。上传测试须另外核对对应产品与实际上传列表，停在提交前。原抖音创作者中心 uploader 的生产页面合同继续阻断，不能用本次千川测试证明其可用。

# Verification

配置读取、数字字符串、缺失与重复映射、CDP 地址约束、页面身份和零退出码错误检查：

```sh
node --test tests/qianchuan-account-config.node-test.mjs
npm run typecheck
```

测试中的 CLI 执行使用隔离 stub，不访问真实账户；真实测试结果单独记录，不能把配置测试当作六个账户已上传。

# Live Evidence

2026-09-27：程序实际读取本机配置，通过 9222 的 Chrome 在新 tab 打开蝴蝶贴对应千川账户和已有计划，可见账户 ID 与计划 ID 均匹配，返回 `account_and_plan_visible`。没有在该新 tab 上传或提交。此前人工 CDP 测试已在原 tab 上传一条蝴蝶贴 MP4，文件列表显示准确文件名、“已选择 1/70”及可用“确定”按钮；停在该按钮前，不能据此声称计划已接收、审核通过或素材开始投放。

初次 checkpoint 时氨糖膏与肥皂待选择广告账户；滴耳康打开的账户显示关停；眼贴与热敷贴未开启 CDP。后续用户提供账户链接，并在对应 Chrome 选择账户。实际页面确认氨糖膏 `1876036793517065` / 计划 `1876052012647452`、滴耳康 `1876131703522649` / 计划 `1877122107497536`、肥皂 `1876414814643802` / 计划 `1876591298030592`，各账户仅有一条计划且素材商品与对应产品一致，已写入本机配置；三个账户均通过文件读取程序的真实页面核对。滴耳康之前显示关停的账户 `1876131622331658` 不用于本次测试。

氨糖膏、滴耳康和肥皂分别上传一条对应产品 MP4，SHA-256 与原候选清单一致，上传列表显示精确文件名、已选择一条及可用“确定”按钮，未点击确认。氨糖膏原计划已有同名素材，其旧素材 ID 和审核状态不能证明本次新上传结果。四个产品累计各有一条待确认视频，不代表已提交投放。眼贴与热敷贴的两个账户 ID 尚待用户确认对应关系，两者 CDP 仍不可连接。

最小本机报告为 `/tmp/jianji-qianchuan-six-account-upload-only-report.json`，不保存完整 DOM、网络报文或凭据。当前 repository 没有专用 session-record/capture skill，本文件记录此稳定 checkpoint，未写入全局 memory。
