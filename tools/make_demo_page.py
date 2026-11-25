# -*- coding: utf-8 -*-
"""从 atlas.html 派生本地演示版 atlas-demo.html（不上线）。

线上版的图鉴页已取消「演示模式」：不再有跳过答题的开关，且老存档里的
demo=true 会在载入时被退回正式进度。答辩/讲解需要"全解锁 + 跳过答题 +
全图鉴预览"时，用本脚本生成一份演示版放在站点根目录：

    python tools/make_demo_page.py

生成物 atlas-demo.html 已被 .gitignore 排除，也不会进 build_offline.py 的
dist 白名单，因此不会出现在线上。图鉴数据或页面改动后重跑一次即可，
演示版内容永远跟随 atlas.html，不需要手工同步两套代码。
"""
import io
import os
import re

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(BASE, "atlas.html")
OUT = os.path.join(BASE, "atlas-demo.html")

SWITCH = re.compile(r"/\* DEMO-SWITCH-START \*/.*?/\* DEMO-SWITCH-END \*/", re.S)

DEMO_BODY = (
    "/* DEMO-SWITCH-START */\r\n"
    "  try {\r\n"
    "    state = L.setDemo(store, state, true);\r\n"
    "  } catch (e) {}\r\n"
    "  /* DEMO-SWITCH-END */"
)

BANNER = (
    "<!-- 本地演示版：由 tools/make_demo_page.py 从 atlas.html 生成，不随站点部署。\r\n"
    "     此文件打开即为演示态（四区全解锁、跳过答题、图鉴全预览）。请勿手工修改。 -->\r\n"
)


def main():
    with io.open(SRC, encoding="utf-8", newline="") as f:
        html = f.read()

    if not SWITCH.search(html):
        raise SystemExit("未找到 DEMO-SWITCH 标记，atlas.html 结构可能已变，请检查后重试。")

    out = SWITCH.sub(lambda m: DEMO_BODY, html, count=1)
    # 标记放在 <!DOCTYPE> 之后，避免破坏文档类型声明
    out = re.sub(r"(<!DOCTYPE html>\r\n)", r"\1" + BANNER.replace("\\", "\\\\"), out, count=1)

    with io.open(OUT, "w", encoding="utf-8", newline="") as f:
        f.write(out)

    print("已生成 %s（%d KB）" % (os.path.basename(OUT), len(out.encode("utf-8")) // 1024))
    print("直接用浏览器打开该文件即可演示；它不在 dist 白名单里，不会上线。")


if __name__ == "__main__":
    main()
