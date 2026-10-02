#!/usr/bin/env python3
"""听歌识曲（Shazam）：输入 wav 音频文件，stdout 输出 SHAZAM_JSON:{...}
用法：python audio_id.py <file.wav>
依赖：pip install shazamio（项目 .venv 已装）
"""
import asyncio
import json
import sys


async def main() -> None:
    path = sys.argv[1]
    from shazamio import Shazam

    shazam = Shazam()
    try:
        out = await shazam.recognize(path)
    except Exception as e:  # 网络异常等
        print("SHAZAM_JSON:" + json.dumps({"ok": False, "error": str(e)[:200]}, ensure_ascii=False))
        return
    track = out.get("track")
    if not track:
        print("SHAZAM_JSON:" + json.dumps({"ok": False, "error": "no_match"}, ensure_ascii=False))
        return
    title = track.get("title") or ""
    artist = track.get("subtitle") or ""
    key = track.get("key") or ""
    # 匹配置信度：shazam 返回的 sections 里可能有 metadata；这里用是否存在 track 即视为命中
    print(
        "SHAZAM_JSON:"
        + json.dumps(
            {"ok": True, "title": title, "artist": artist, "key": str(key)},
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    asyncio.run(main())
