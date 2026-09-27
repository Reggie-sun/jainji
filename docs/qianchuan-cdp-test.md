# Account Configuration

本机人工填写文件：`/home/reggie/电商/千川账号配置.json`。按产品填写 `advertiserId`（广告账户 ID）与 `adId`（已有全域投放计划 ID），均须保留双引号，不能填写 Chrome profile ID、抖音号或商品 ID。没有确认的值保持 `""`。热敷贴使用原舒鼻膏的 Chrome profile。

千川链接中 `aavid=` 对应广告账户 ID，`adId=` 对应计划 ID。文件建立时蝴蝶贴按用户提供的链接填写，其余五个产品留空；后续仅根据用户确认或对应 Chrome 的真实页面补充，不根据账户排列顺序推测。

```sh
node scripts/qianchuan-account-config.mjs /home/reggie/电商/千川账号配置.json --check
node scripts/qianchuan-account-config.mjs /home/reggie/电商/千川账号配置.json --open 氨糖膏
```

# Test Boundary

每次执行均重新读取文件。`--check` 只检查配置；`--open` 需要已启动且开启 CDP 的对应 Chrome，以及本机 `chrome-devtools` CLI（已验证接口为 1.7.0）。程序建立独立 CLI session，在新 tab 打开指定账户和已有计划，读取可见账户与计划 ID 核对；不会覆盖原有上传草稿。缺少 ID、配置歧义、账户被关停或页面不能证明匹配时明确失败，没有自动重试。页面尚未加载完时也可能需人工检查后重新运行。

此脚本属于当前 CDP 人工测试工具，不接入简辑制作界面，不上传视频、不点击“确定”、不新建或调整投放计划。上传测试须另外核对对应产品与实际上传列表，停在提交前。后续应用接入使用千川 upload-only 合同，生产页面定位仍阻断；本页历史人工证据不能证明应用自动上传可用，见 [接入 checkpoint](qianchuan-upload-integration-2026-09-27.md)。

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

氨糖膏、滴耳康和肥皂分别上传一条对应产品 MP4，SHA-256 与原候选清单一致，上传列表显示精确文件名、已选择一条及可用“确定”按钮，未点击确认。氨糖膏原计划已有同名素材，其旧素材 ID 和审核状态不能证明本次新上传结果。这四个产品的上传结果属于此前 checkpoint；后续 Chrome 连接断开，未重复上传，也未证明旧上传草稿在关闭浏览器后仍然保留。

用户随后明确确认眼贴 `1876294500004864` / 计划 `1876867135606800`、热敷贴 `1876956000684231` / 计划 `1877477842671690`，均已写入本机配置。按用户授权恢复这两个现有 profile 的 Chrome，开启 9225 / 9227；程序重新读取配置并在真实页面核对账户、计划与对应商品。

2026-09-27 21:56 左右，两个上传弹窗从空列表开始，各选择一次对应 MP4；上传后重新读取页面，核对以下文件名、已选择一条、可用“确定”按钮，并确认已无“取消上传”进度。原文件 SHA-256 再次核对一致。未点击“确定”，没有提交素材到计划、创建计划或修改预算、出价。

| Product | File | SHA-256 | Selected |
| --- | --- | --- | --- |
| 眼贴 | `010f59c3485efb05d69e0b3bd74645fd_edited_17.mp4` | `b13ef8e9ba4d7e4ce7ca87bb103f5cb59b27dffadef7186da975f0460e4f0f76` | 1/491 |
| 热敷贴 | `竞品详情-抖音电商罗盘 - 2026-09-23T165735.546_edited_5.mp4` | `b2f27d4529ea8d4a33afc054d5b399442f2ad84743d45ff322df09315829692d` | 1/401 |

累计六个账户各完成一次对应视频的上传测试，均停在确认前。此证据不证明审核通过、正式投放或简辑桌面应用自动上传已接入千川。普通 launcher 再次启动 Chrome 时仍可能没有 CDP；本次开启端口不等于永久修改 launcher。

早期 `/tmp/jianji-qianchuan-six-account-upload-only-report.json` 已不在当前临时目录；本轮最小报告为 `/tmp/jianji-qianchuan-final-two.json`，只记录最后两个账户的文件、校验与页面摘要，不保存完整 DOM、网络报文或凭据。临时报告不能作为持久证据 owner。当前 repository 没有专用 session-record/capture skill，本文件记录此稳定 checkpoint，未写入全局 memory。

# Chrome Port Reopen Verification

2026-09-27 23:55（Asia/Hong_Kong），用户授权开启 Chrome 端口验证。根据当前 profile registry 与 desktop launcher 核对产品映射，复用五个未运行的既有 profile，临时添加 loopback CDP 启动参数；没有改写 launcher、registry 或真实账号配置。热敷贴继续使用舒鼻膏 profile。

| Product | Port | Current evidence |
| --- | --- | --- |
| 蝴蝶贴 | 9222 | `/json/version` 可达，账户和计划可见 ID 与配置一致 |
| 氨糖膏 | 9223 | `/json/version` 可达，账户和计划可见 ID 与配置一致 |
| 滴耳康 | 9224 | `/json/version` 可达，账户和计划可见 ID 与配置一致 |
| 眼贴 | 9225 | `/json/version` 可达，账户和计划可见 ID 与配置一致 |
| 肥皂 | 9226 | 既有 profile 正在运行但没有 CDP；保留窗口，重启决定待用户回复 |
| 热敷贴 | 9227 | `/json/version` 可达，账户和计划可见 ID 与配置一致 |

`ss -ltnp` 核对五个监听均为 `127.0.0.1`，浏览器报告 `Chrome/149.0.7827.53`。五次项目诊断 CLI `--open` 均返回 `account_and_plan_visible/submitted:false`；各自使用独立 CLI session 和新 tab，没有覆盖原页面。肥皂 profile 重启可能丢失未确认的上传弹窗，因此未终止其进程，已向用户请求单独决定。

在蝴蝶贴的诊断 tab，按真实 snapshot 依次打开“素材”“添加视频”“上传视频”，只检查空面板。它显示 `已选择 0/64：`，独立“确定”按钮禁用。观察到以下 fixture 与真实结构差异：素材/上传视频为无 button role 的 tab；添加面板是另一层 `.ovui-drawer`；数量文案含尾部中文冒号；当前空上传面板及已检查 frame 没有 `input[type=file]`，只有“点击上传”入口。未点击该选文件入口，未选择新视频、未点击确定、未修改广告设置。

这些观察只证明端口、目标身份和空面板可访问，不能证明上传后 row、processing、ready 或生产 adapter 已适配。`PRODUCTION_QIANCHUAN_CONTRACT` 继续为空，不能把 fixture 定位直接写成生产合同。后续必须适配真实控件和文件选择协议，并验证 ready 证据后才可解除生产阻断。临时最小端口报告为 `/tmp/jianji-qianchuan-port-verification.json`；本节保存持久结论，不以临时文件作为 acceptance owner。

# Butterfly Single Video Upload

2026-09-28 00:14（Asia/Hong_Kong），用户明确授权用蝴蝶贴上传一条以前的视频，仍停在确定前。使用现有 9222 的诊断 tab，重新核对配置对应账户 `1876024170199244`、已有计划 `1876036593854788` 及可见 ID；上传面板起始为 `已选择 0/64：`。

选择本地成片 `/home/reggie/电商/蝴蝶贴/视频/9.27 23:12 (2)/2651703a55fd63d114819104666a3315_edited_2.mp4`。ffprobe 显示 H.264/AAC、720×1280、37.105011 秒、10,235,070 bytes。复制为权限 `0400` 的临时快照，保留原文件名；原件和快照 SHA-256 均为 `b63b4717466870ac45b73497e008bcabac10eca03533679573e6ec6dc37c01d7`，完成后再次核对一致。

CLI `upload_file` 对“点击上传”文字入口返回没有触发 file chooser；随后只读检查确认面板仍为 0 条，没有所选文件。改用页面明确支持的拖拽入口 `[data-e2e="oc_emptyKey_uni-prom__createMaterialUploadVideo"]`；核对归属、空列表及可见区域，在私有临时记录中保存并同步 selection fence 和原 targetId 后，通过当前 Chrome 协议的 `Input.dispatchDragEvent` 仅放入一个文件、一次 drop。之后只读观察，无再次选择或重传。

观察到文件进入“取消上传”处理进度，随后变为精确文件名可见、`已选择 1/64：`、无“取消上传”、唯一“确定”按钮可用且无上传错误。后续独立 snapshot 与 DOM 读取再次确认账户/计划、文件名、数量及按钮状态。保留原 Chrome/tab/弹窗，没有点击确定，没有提交素材到计划、修改预算或其他广告设置。

本次是用户授权的浏览器辅助上传，未走简辑自动 upload service，不证明桌面自动上传已经启用、平台审核通过或开始投放。真实拖拽入口及 `.oc-upload-table-name-text` 文件名区域提供了后续生产合同适配线索，`PRODUCTION_QIANCHUAN_CONTRACT` 继续为空。临时最小结果位于 `/tmp/jianji-butterfly-upload-one-zz_3xbk0/result.json`；本节保存持久结论，不依赖该临时路径长期存在。Repository 无专用 capture skill，本节作为本次 live proof 记录，未写全局 memory。
