#!/usr/bin/env python
# 用 PaddleOCR 对整帧做文字检测 + 识别（位置无关，自带 detection）
# 中日双模型合并：ch（中文+英文）为主，叠加 japan 模型补强日文歌名识别。
# 用法：python ocr_songlist.py img1.png [img2.png ...]
# 输出一行：OCR_RESULT_JSON:<json>，其中 json 为「每张图一个 list」的 list
import sys
import os

# Paddle 的 C++ 后端按系统编码打开文件，中文用户名路径会乱码导致找不到模型/临时文件。
# 这里把缓存/临时目录都强制指向纯 ASCII 路径，并显式传入模型目录，彻底绕过该问题。
_ASCII_HOME = os.environ.get("PADDLEOCR_HOME", r"C:\paddlehome")
os.environ["HOME"] = _ASCII_HOME
os.environ["USERPROFILE"] = _ASCII_HOME
_TMP = os.path.join(_ASCII_HOME, "tmp")
os.makedirs(_TMP, exist_ok=True)
os.environ["TMP"] = _TMP
os.environ["TEMP"] = _TMP

# 抑制 paddle 的日志刷屏（推到 stderr）
os.environ.setdefault("GLOG_minloglevel", "3")
os.environ.setdefault("FLAGS_logtostderr", "1")

import json
import numpy as np
from PIL import Image
import io


def _model_dir(sub, name):
    return os.path.join(_ASCII_HOME, ".paddleocr", "whl", sub, "ch", name)


def _jp_rec_dir():
    # 日语识别模型（与 ch 同结构，但放在 rec/japan 下）
    return os.path.join(_ASCII_HOME, ".paddleocr", "whl", "rec", "japan", "japan_PP-OCRv4_rec_infer")


def _has_kana(text):
    for ch in text:
        o = ord(ch)
        # 平假名 0x3040-0x309F / 片假名 0x30A0-0x30FF
        if 0x3040 <= o <= 0x309F or 0x30A0 <= o <= 0x30FF:
            return True
    return False


def _box_iou(a, b):
    def rect(pts):
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        return min(xs), min(ys), max(xs), max(ys)

    ax1, ay1, ax2, ay2 = rect(a)
    bx1, by1, bx2, by2 = rect(b)
    ix = max(0.0, min(ax2, bx2) - max(ax1, bx1))
    iy = max(0.0, min(ay2, by2) - max(ay1, by1))
    inter = ix * iy
    if inter <= 0:
        return 0.0
    area_a = (ax2 - ax1) * (ay2 - ay1)
    area_b = (bx2 - bx1) * (by2 - by1)
    return inter / max(1e-6, min(area_a, area_b))


def _collect(result):
    dets = []
    if result:
        for page in result:
            if not page:
                continue
            for line in page:
                box, (text, score) = line
                dets.append(
                    {
                        "text": text,
                        "score": float(score),
                        "box": [[float(pt[0]), float(pt[1])] for pt in box],
                    }
                )
    return dets


def _merge_dets(ch_dets, jp_dets):
    # 以 ch 检测为基，叠加 japan：同行(重叠)若 japan 含假名或置信更高则取 japan，否则留 ch；
    # japan 独有的行也保留（补 ch 漏检的日文）。
    merged = []
    used = set()
    for c in ch_dets:
        best_i, best_iou = None, 0.0
        for i, j in enumerate(jp_dets):
            if i in used:
                continue
            iou = _box_iou(c["box"], j["box"])
            if iou > best_iou:
                best_iou, best_i = iou, i
        if best_i is not None and best_iou > 0.4:
            used.add(best_i)
            j = jp_dets[best_i]
            # 关键：只在 japan 文本含假名（平/片假名）时取 japan——日文必含假名，可纠正 ch 的形近误读；
            # 无假名的行（中文/英文/纯汉字）一律保留 ch，避免 japan 把中文独有汉字误读（如 炸→灯）。
            if _has_kana(j["text"]):
                merged.append(j)
            else:
                merged.append(c)
        else:
            merged.append(c)
    for i, j in enumerate(jp_dets):
        if i not in used:
            merged.append(j)
    return merged


def ocr_images(paths):
    from paddleocr import PaddleOCR

    det = _model_dir("det", "ch_PP-OCRv4_det_infer")
    rec = _model_dir("rec", "ch_PP-OCRv4_rec_infer")
    cls = _model_dir("cls", "ch_ppocr_mobile_v2.0_cls_infer")
    ch_ocr = PaddleOCR(
        use_angle_cls=True,
        lang="ch",
        use_gpu=False,
        show_log=False,
        det_model_dir=det,
        rec_model_dir=rec,
        cls_model_dir=cls,
    )

    # 日语模型（增强日文歌名识别）：
    #   优先用已下载的 japan rec；否则让 PaddleOCR 自动下载；
    #   若下载/加载失败则回退为仅中文，不影响主流程。
    jp_ocr = None
    jp_rec = _jp_rec_dir()
    try:
        if os.path.exists(jp_rec):
            jp_ocr = PaddleOCR(
                use_angle_cls=True,
                lang="japan",
                use_gpu=False,
                show_log=False,
                det_model_dir=det,
                rec_model_dir=jp_rec,
                cls_model_dir=cls,
            )
        else:
            jp_ocr = PaddleOCR(
                use_angle_cls=True,
                lang="japan",
                use_gpu=False,
                show_log=False,
            )
        sys.stderr.write("OCR_INFO: japan model loaded\n")
    except Exception as e:  # noqa
        jp_ocr = None
        sys.stderr.write("OCR_WARN: japan model unavailable: %s\n" % repr(e))

    all_dets = []
    for p in paths:
        with open(p, "rb") as f:
            data = f.read()
        img = Image.open(io.BytesIO(data)).convert("RGB")
        arr = np.array(img)
        ch_res = ch_ocr.ocr(arr, cls=True)
        dets = _collect(ch_res)
        if jp_ocr is not None:
            try:
                jp_res = jp_ocr.ocr(arr, cls=True)
                jp_dets = _collect(jp_res)
                dets = _merge_dets(dets, jp_dets)
            except Exception as e:  # noqa
                sys.stderr.write("OCR_WARN: japan ocr failed on %s: %s\n" % (p, repr(e)))
        all_dets.append(dets)
    return all_dets


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    paths = sys.argv[1:]
    if not paths:
        data = sys.stdin.buffer.read()
        tmp = os.path.join(_TMP, "ocr_stdin.png")
        with open(tmp, "wb") as f:
            f.write(data)
        paths = [tmp]
    try:
        all_dets = ocr_images(paths)
    except Exception as e:  # noqa
        all_dets = []
        sys.stderr.write("OCR_ERROR: %s\n" % repr(e))
    sys.stdout.write("OCR_RESULT_JSON:" + json.dumps(all_dets, ensure_ascii=False))


if __name__ == "__main__":
    main()
