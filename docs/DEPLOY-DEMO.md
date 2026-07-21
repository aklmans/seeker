# Web 演示版自托管部署 · DEPLOY-DEMO

> 把「探索者」Web 演示部署到你自己的服务器,并用**最小 AI 代理**让演示真能对话。
> 单文件零依赖(`server/demo-proxy.mjs`,Node ≥ 18):静态站 + `/api/chat` SSE 转发。

## 安全模型(为什么这样设计)

- **上游 API key 只存服务器环境文件**,浏览器永远见不到、响应不回显、日志不打印;
- 浏览器只持**访问码**(发给朋友的门票,低价值、可随时更换),存 localStorage;
- **三道闸**:访问码 → 每 IP 每分钟限速 → 全局每日请求封顶(兵损可控);
- 系统提示服务端自持,客户端提交的 `system` 轮直接 400(白名单投影只收 user/assistant);
- **不记录对话内容**(日志仅 时间/路由/状态/计数);
- **fail-closed**:`ACCESS_CODES` 为空拒绝启动 —— 忘配门禁不会变成全网免费站。

## 部署步骤(约 10 分钟)

```bash
# 1) 服务器上(需 Node ≥ 18;Debian/Ubuntu 可 apt install nodejs 或用 nvm)
git clone https://github.com/aklmans/seeker.git /opt/seeker
cd /opt/seeker

# 2) 配置(★UPSTREAM_KEY 请你本人填写;此文件不入 git、权限收紧)
sudo tee /etc/seeker-demo.env >/dev/null <<'ENV'
PORT=8787
UPSTREAM_BASE=https://api.deepseek.com
UPSTREAM_KEY=<你的上游 key,自己填>
MODEL=deepseek-chat
ACCESS_CODES=seeker-xxxx,seeker-yyyy
RATE_PER_MIN=6
DAILY_REQ_CAP=300
ENV
sudo chmod 600 /etc/seeker-demo.env

# 3) systemd 托管
sudo tee /etc/systemd/system/seeker-demo.service >/dev/null <<'UNIT'
[Unit]
Description=Seeker web demo (static + AI proxy)
After=network.target

[Service]
EnvironmentFile=/etc/seeker-demo.env
ExecStart=/usr/bin/node /opt/seeker/server/demo-proxy.mjs
Restart=on-failure
User=www-data
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload && sudo systemctl enable --now seeker-demo
curl -s http://127.0.0.1:8787/api/health   # → {"ok":true}
```

### nginx 反代(建议;终止 TLS + 转发 SSE)

```nginx
server {
  server_name demo.example.com;            # 换你的域名;TLS 用 certbot 常规配
  location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header X-Forwarded-For $remote_addr;   # 限速按真实 IP
    proxy_buffering off;                              # SSE 逐 token 到端
    proxy_read_timeout 120s;
  }
}
```

## 更新与运维

- **更新**:`cd /opt/seeker && git pull && sudo systemctl restart seeker-demo`(静态直接生效,重启只为代理代码);
- **换访问码 / 调额度**:改 `/etc/seeker-demo.env` → `systemctl restart seeker-demo`;
- 限额计数在进程内存(重启清零)—— 演示场景足够,无需数据库;
- 上游推荐:DeepSeek / Kimi 等 OpenAI 兼容端点(朋友级流量月成本一般在几元内)。

## 行为对照

| 环境 | 顶栏标注 | Agent |
|---|---|---|
| GitHub Pages(无代理) | 演示版 + 下载链接 | 本地降级回复(canned) |
| 自托管 · 未填访问码 | 演示版 + **「输入访问码」入口** | canned |
| 自托管 · 已填码 | **已接真模型(限量额度)** | 真流式对话(纯聊天;工具/记忆仍桌面端) |
