#!/usr/bin/env python3
"""可信的本地 mock 搜索 MCP(stdio · 换行分隔 JSON-RPC)。

仅供 Seeker 的 MCP 客户端做 stdio 冒烟:实现 initialize / tools/list / tools/call。
`web_search` 工具返回几个**真实**公司招聘页 URL(供下游 verify_sources 真连验链)。
**不联网、零依赖、不读环境/文件**——纯本地回放,避免拉不可信的第三方搜索包。

帧格式须与 src/mcp.rs StdioTransport 对齐:每条消息一行 JSON + 换行;通知(无 id)不回。
"""
import sys
import json
import os

# 固定回放的真实招聘页(下游 verify_sources 会真连这些 URL)。
REAL_RESULTS = [
    {"company": "Anthropic", "role": "Engineering", "url": "https://www.anthropic.com/careers"},
    {"company": "Stripe", "role": "Engineering", "url": "https://stripe.com/jobs/search"},
    {"company": "GitLab", "role": "Remote", "url": "https://about.gitlab.com/jobs/all-jobs/"},
]


def respond(mid, result):
    sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": mid, "result": result}) + "\n")
    sys.stdout.flush()  # 关键:逐条 flush,否则 Seeker 的 read_line 会一直阻塞


def main():
    while True:
        line = sys.stdin.readline()  # readline 见到换行即返回(不过度缓冲)
        if not line:
            break  # EOF:Seeker 关闭了连接
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except Exception:
            continue
        method = msg.get("method")
        mid = msg.get("id")
        if mid is None:
            continue  # 通知(如 notifications/initialized)→ 不回
        if method == "initialize":
            respond(mid, {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "serverInfo": {"name": "mock-search", "version": "0.1"},
            })
        elif method == "tools/list":
            respond(mid, {"tools": [
                {
                    "name": "web_search",
                    "description": "搜索网页,返回公司/岗位/URL(mock:固定回放真实招聘页)",
                    "inputSchema": {
                        "type": "object",
                        "properties": {"query": {"type": "string"}},
                        "required": ["query"],
                    },
                    "annotations": {"readOnlyHint": True},
                },
                {
                    # 供 env 注入测试:回显 SEEKER_TEST_ENV(证 Seeker 把配置的密钥变量注入了子进程环境)
                    "name": "env_echo",
                    "description": "回显 SEEKER_TEST_ENV 环境变量(env 注入自测用)",
                    "inputSchema": {"type": "object"},
                    "annotations": {"readOnlyHint": True},
                },
            ]})
        elif method == "tools/call":
            params = msg.get("params") or {}
            tool = params.get("name", "")
            args = params.get("arguments") or {}
            if tool == "env_echo":
                respond(mid, {"content": [{"type": "text", "text": os.environ.get("SEEKER_TEST_ENV", "")}]})
            else:
                query = args.get("query", "")
                out = [f"搜索「{query}」结果(mock 回放):"]
                for r in REAL_RESULTS:
                    out.append(f"- {r['company']} · {r['role']}: {r['url']}")
                respond(mid, {"content": [{"type": "text", "text": "\n".join(out)}]})
        else:
            respond(mid, {})  # 未知方法 → 空 result(不报错)


if __name__ == "__main__":
    main()
