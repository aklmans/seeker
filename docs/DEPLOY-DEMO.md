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

## 方式一(推荐)· GitHub Actions 自动部署:push 即上线

流水线:[.github/workflows/deploy-demo.yml](../.github/workflows/deploy-demo.yml) —— push main(web/ 或 server/ 变更)自动 rsync 到服务器、写 env、装/重启 systemd、健康检查。**所有值经 GitHub Secrets,仓库与日志不见明文**;未配 `DEPLOY_HOST` 时安静跳过。

### 1)生成专用部署密钥(本机跑,别复用日常 key)

```bash
ssh-keygen -t ed25519 -f ~/.ssh/seeker_deploy -N "" -C "seeker-deploy"
ssh-copy-id -i ~/.ssh/seeker_deploy.pub root@<服务器IP>   # 公钥进服务器
cat ~/.ssh/seeker_deploy                                   # 私钥全文 → 填进 DEPLOY_SSH_KEY
```

### 2)填 Secrets(仓库 → Settings → Secrets and variables → Actions → New repository secret)

| Secret | 必填 | 示例 / 说明 |
|---|---|---|
| `DEPLOY_SSH_KEY` | ✅ | 上面生成的**私钥全文**(含 BEGIN/END 行) |
| `DEPLOY_HOST` | ✅ | 服务器 IP 或域名 |
| `UPSTREAM_KEY` | ✅ | Kimi(Moonshot 开放平台 platform.moonshot.cn)创建的 API key |
| `ACCESS_CODES` | ✅ | 逗号分隔访问码,如 `seeker-mz7kq4,seeker-xh92pd,seeker-qw48vn` |
| `DEPLOY_USER` | 可选 | 默认 `root` |
| `DEPLOY_PATH` | 可选 | 默认 `/opt/seeker-demo` |
| `UPSTREAM_BASE` | 可选 | 默认 `https://api.moonshot.cn/v1`(Kimi) |
| `MODEL` | 可选 | 默认 `moonshot-v1-8k`(便宜;可换 128k 或 kimi 新款) |
| `RATE_PER_MIN` / `DAILY_REQ_CAP` / `PORT` | 可选 | 默认 6 / 300 / 8787 |

### 3)触发

填完 Secrets → 仓库 Actions 页手动跑一次 `deploy-demo`(workflow_dispatch),或随下一次 push 自动跑。绿了 = 服务器 `127.0.0.1:8787` 健康检查已过。

### 4)宝塔配域名 + HTTPS(一次性,面板点选)

1. **网站 → 添加站点**:填你的域名(如 `demo.你的域名.com`),纯静态、不建数据库;
2. 站点 **设置 → 反向代理 → 添加反向代理**:目标 URL `http://127.0.0.1:8787`,发送域名 `$host`;
3. 站点 **设置 → SSL → Let's Encrypt** 申请证书,开「强制 HTTPS」;
4. SSE 流式无需额外配置(应用响应带 `X-Accel-Buffering: no`,nginx 按响应关闭缓冲)。

> 服务器前置要求:Node ≥ 18(宝塔:软件商店 → Node.js 版本管理器装一个;流水线会自动找 `/www/server/nodejs` 下最新版)+ rsync(一般自带,缺则 `apt/yum install rsync`)。

## 方式二 · 手动部署(约 10 分钟)

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
