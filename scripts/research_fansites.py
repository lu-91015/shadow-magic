#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
夜间研究脚本：抓取若干粉丝站 / VTuber 官网，提取可用于本站的 UI/UX 经验，
输出到 research/fansite_notes.md（Markdown 表格 + 观察要点）。
纯标准库实现（urllib + html.parser），无需 pip 安装。

用法：
    python scripts/research_fansites.py

可编辑下方 TARGETS 列表，把你想借鉴的站点 URL 填进去
（建议放：B站个人空间、其他 VUP 粉丝站、二次元社团站、官方商品站等）。
"""
import os
import urllib.request
import urllib.error
from datetime import datetime
from html.parser import HTMLParser

# ---- 在这里添加你想研究的粉丝站 URL（示例为自家 B站空间，请按需替换/扩充）----
TARGETS = [
    "https://space.bilibili.com/1703797642",  # 李豆沙 B站空间（自家，可看布局）
    # "https://www.example-vtuber-fansite.com",
]
# ---------------------------------------------------------------------------

OUT_DIR = "research"
OUT = os.path.join(OUT_DIR, "fansite_notes.md")

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)


class SiteScan(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.title = ""
        self._in_title = False
        self.meta_desc = ""
        self.counts = {
            "a": 0,
            "img": 0,
            "h1": 0,
            "h2": 0,
            "nav": 0,
            "section": 0,
            "video": 0,
            "button": 0,
        }

    def handle_starttag(self, tag, attrs):
        d = dict(attrs)
        if tag == "title":
            self._in_title = True
        if tag == "meta" and d.get("name", "").lower() == "description":
            self.meta_desc = d.get("content", "")
        if tag in self.counts:
            self.counts[tag] += 1

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False

    def handle_data(self, data):
        if self._in_title:
            self.title += data


def fetch(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        charset = r.headers.get_content_charset() or "utf-8"
        return r.read().decode(charset, errors="replace")


def scan(url: str):
    try:
        html = fetch(url)
    except Exception as e:  # noqa: BLE001
        return {"url": url, "error": str(e)}
    p = SiteScan()
    p.feed(html)
    return {
        "url": url,
        "title": p.title.strip()[:80],
        "meta_desc": p.meta_desc.strip()[:160],
        "counts": p.counts,
        "bytes": len(html),
    }


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    results = [scan(u) for u in TARGETS]
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    lines = [
        f"# 粉丝站 / VUP 站点研究笔记",
        "",
        f"> 生成时间：{now}　|　共抓取 {len(TARGETS)} 个站点",
        "",
        "## 概览",
        "",
        "| 站点 | 标题 | 字节 | a | img | h1 | h2 | nav | section | video | button |",
        "|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for r in results:
        if "error" in r:
            lines.append(f"| {r['url']} | ❌ {r['error']} | - | - | - | - | - | - | - | - | - |")
            continue
        c = r["counts"]
        lines.append(
            f"| {r['url']} | {r['title']} | {r['bytes']} | {c['a']} | {c['img']} | "
            f"{c['h1']} | {c['h2']} | {c['nav']} | {c['section']} | {c['video']} | {c['button']} |"
        )
    lines += [
        "",
        "## 逐站观察（手动补充）",
        "",
    ]
    for r in results:
        lines.append(f"### {r.get('url')}")
        if "error" in r:
            lines.append(f"- 抓取失败：{r['error']}")
        else:
            lines.append(f"- 标题：{r['title']}")
            lines.append(f"- 描述：{r['meta_desc']}")
            lines.append("- UI/UX 可借鉴点（待人工填写，例如：导航结构、首屏构图、配色、卡片、动效、响应式、暗色处理）：")
            lines.append("  - ")
        lines.append("")

    with open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"[research] 已写入 {OUT}（{len(results)} 个站点）")


if __name__ == "__main__":
    main()
