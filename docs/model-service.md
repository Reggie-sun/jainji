# Team Model Service

## Connection

简辑默认使用团队 RTX 5090 机器上的 Qwen3-VL。客户端只需能访问 HTTPS，不需要安装 CUDA、vLLM 或下载模型。

| Field | Value |
| --- | --- |
| Base URL | `https://qwen.reggie-sun.ccwu.cc/v1` |
| Model | `Qwen/Qwen3-VL-8B-Instruct` |
| Protocol | OpenAI Chat Completions |
| Authentication | Bearer，使用分配给个人的 API Key |

新安装打开 API 表单，预填名称、地址和模型，Key 留空。首次填写个人 Key 并保存后激活团队连接。Key 只保存于应用本机私有连接配置，退出输入框后清空，不放进项目、源码或安装包。已有连接继续恢复上次选择；主动断开后，重启不会重新连接。

## Server Boundary

路径为：客户端 HTTPS → 独立 Cloudflare Tunnel → 本机鉴权网关 → 本机 vLLM → RTX 5090。vLLM 仍只监听 `127.0.0.1:8000`；网关只监听 `127.0.0.1:18182`。无需在路由器开放模型端口。

网关源码在 [gateway.ts](../src/model-server/gateway.ts)，启动与私有 Key 文件校验在 [index.ts](../src/model-server/index.ts)。公网只允许个人 Key 访问 `/v1/models` 和 `/v1/chat/completions`；模型内部控制、调试、其他推理接口均不开放。图片输入限于 Base64 数据，不允许借模型服务请求任意网址或本地文件。请求体与生成长度限制由网关定义；推理执行和排队继续由 vLLM 负责。

团队成员同时提交请求，超出 GPU 并行执行槽位时由 vLLM 排队。五人可连接不等于五条推理同时在 GPU 上执行；耗时取决于输入图片、上下文、输出长度与排队情况。服务器需要保持开机，模型服务与 Tunnel 需要运行。

原贴纸覆盖追踪逐窗口返回多帧、多目标 JSON。客户端会传递该步骤的输出预算，网关允许显式请求最多 32,768 tokens，未指定时仍默认 2,048；vLLM 的输出上限也需至少支持该预算，并为输入图片保留上下文空间。长请求仍受既有超时和显存容量限制。团队 Qwen 地址及本机 `:8000/v1` 的相同模型启用 `response_format: {"type":"json_object"}`，其他连接不自动假定支持此格式参数。网关不接受任意 JSON schema。

JSON 格式约束不能证明识别准确。应用仍检查全部抽帧时间、目标 ID、坐标及重叠窗口一致性；不确定、截断或非法结果明确失败，不会补全残缺 JSON、静默重试或伪造无目标结果。

## Deployment

在服务器构建网关：

```bash
npm run build:model-server
```

私有凭据文件必须只有所属用户可读取；`members` 中必须有五个不同、至少 16 字符的 Key，`upstreamKey` 为仅供本机网关连接 vLLM 的 Key。凭据不应提交 Git。

```json
{
  "members": [
    { "name": "member-1", "key": "REPLACE_WITH_RANDOM_MEMBER_1_KEY" },
    { "name": "member-2", "key": "REPLACE_WITH_RANDOM_MEMBER_2_KEY" },
    { "name": "member-3", "key": "REPLACE_WITH_RANDOM_MEMBER_3_KEY" },
    { "name": "member-4", "key": "REPLACE_WITH_RANDOM_MEMBER_4_KEY" },
    { "name": "member-5", "key": "REPLACE_WITH_RANDOM_MEMBER_5_KEY" }
  ],
  "upstreamKey": "REPLACE_WITH_LOCAL_VLLM_KEY"
}
```

将 `MODEL_GATEWAY_KEYS_FILE` 指向该文件，再运行 `node dist-model-server/server.mjs`。Tunnel 的 origin 指向网关，不能直接指向 vLLM。当前机器的部署参数、用户级服务、版本与实际验证记录在服务器私有部署目录中维护，不属于可移植的项目配置。

更换成员 Key 后重启网关，并向对应成员交付新 Key；该成员在 API 连接编辑页填写新 Key 并保存。其他成员的 Key 不必改变。不要公开分享包含 Key 的配置文件。

## Verification

```bash
npm run typecheck
npm test -- tests/model-server.test.ts tests/connection-store.test.ts tests/connection-defaults.test.ts tests/api-transport.test.ts
npm run build
xvfb-run -a node scripts/desktop-smoke.mjs
```

这些检查覆盖网关鉴权、接口限制、输入限制、取消/超时与连接持久化；桌面 smoke 使用模拟模型和真实 Electron。真实 HTTPS 图片请求与五个 Key 的并发检查须单独记录，不能用模拟服务通过代替，也不代表五台远程电脑已完成实机验收。

参考：[vLLM API Key 安全边界](https://docs.vllm.ai/en/latest/usage/security/)、[Cloudflare Tunnel 配置](https://developers.cloudflare.com/tunnel/features/locally-managed-tunnels/configuration-file/)。
