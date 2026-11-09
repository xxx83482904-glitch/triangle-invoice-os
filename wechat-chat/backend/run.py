import os

import uvicorn

if __name__ == "__main__":
    # Explicit localhost-only default. No forwarded client IP is trusted.
    uvicorn.run("app.main:create_app", factory=True, host="127.0.0.1", port=int(os.getenv("WECHAT_PORT", "8765")), workers=1, access_log=False, proxy_headers=False, log_level="warning", limit_concurrency=64, timeout_keep_alive=5, ws_max_size=4096, ws_max_queue=16)
