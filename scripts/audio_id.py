#!/usr/bin/env python3
"""听歌识曲：输入 wav 音频文件，stdout 输出 SHAZAM_JSON:{...}
用法：
  python audio_id.py <file.wav>            # 默认 Shazam
  python audio_id.py <file.wav> audd       # 追加 audd.io（需 AUDD_TOKEN 环境变量）
依赖：pip install shazamio（项目 .venv 已装）；audd 需 requests + AUDD_TOKEN
"""
import asyncio
import json
import os
import sys


async def shazam_recognize(path: str) -> dict:
    from shazamio import Shazam

    shazam = Shazam()
    last_err = ""
    for _ in range(3):  # 网络抖动/限流重试
        try:
            out = await shazam.recognize(path)
            break
        except Exception as e:  # 网络异常等
            last_err = str(e)[:200]
            await asyncio.sleep(2)
    else:
        return {"ok": False, "error": last_err or "shazam_fail"}
    track = out.get("track")
    if not track:
        return {"ok": False, "error": "no_match"}
    title = track.get("title") or ""
    artist = track.get("subtitle") or ""
    return {"ok": True, "title": title, "artist": artist, "provider": "shazam"}


def audd_recognize(path: str) -> dict:
    import requests

    token = os.environ.get("AUDD_TOKEN")
    if not token:
        return {"ok": False, "error": "no_token"}
    try:
        with open(path, "rb") as f:
            resp = requests.post(
                "https://api.audd.io/",
                data={"api_token": token, "return": "apple_music,spotify"},
                files={"file": f},
                timeout=20,
            )
        j = resp.json()
        if j.get("status") != "success" or not j.get("result"):
            return {"ok": False, "error": "no_match"}
        r = j["result"]
        title = r.get("title") or ""
        artist = (r.get("artist") or "").replace(", ", " ")
        return {"ok": True, "title": title, "artist": artist, "provider": "audd"}
    except Exception as e:
        return {"ok": False, "error": str(e)[:200]}


async def main() -> None:
    path = sys.argv[1]
    provider = sys.argv[2] if len(sys.argv) > 2 else "shazam"
    if provider == "audd":
        res = audd_recognize(path)
    else:
        res = await shazam_recognize(path)
    # 显式以 UTF-8 写出，避免 Windows/非 UTF-8 locale 下 print 把中文/日文歌名替换成乱码
    sys.stdout.buffer.write(
        ("SHAZAM_JSON:" + json.dumps(res, ensure_ascii=False)).encode("utf-8")
    )
    sys.stdout.buffer.write(b"\n")
    sys.stdout.buffer.flush()


if __name__ == "__main__":
    asyncio.run(main())
