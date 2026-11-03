"""Render only the whitelisted fields of an authorized, immutable publication."""
from datetime import datetime
from io import BytesIO
from xml.sax.saxutils import escape
from zoneinfo import ZoneInfo

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

from app.modules.review.rules import outcome_for_total, validate_rule_snapshot

FONT = "STSong-Light"
pdfmetrics.registerFont(UnicodeCIDFont(FONT))


def render_publication(snapshot: dict, version: int, published_at: datetime) -> bytes:
    rule = validate_rule_snapshot(snapshot["rule_snapshot"])
    total = snapshot["total"]
    conclusion = outcome_for_total(rule, total)["label"]
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, leftMargin=23*mm, rightMargin=23*mm,
                            topMargin=20*mm, bottomMargin=20*mm,
                            title="匿名评阅书", author="论文盲审平台")
    body = ParagraphStyle("body", fontName=FONT, fontSize=11, leading=17, wordWrap="CJK", spaceAfter=4)
    heading = ParagraphStyle("heading", parent=body, fontSize=14, leading=20,
                             textColor=colors.HexColor("#174a79"), spaceBefore=8, keepWithNext=True)
    story = []

    def line(value, style=body):
        # Never interpret author-supplied comments as ReportLab markup or external assets.
        story.append(Paragraph("<br/>".join(escape(part) for part in str(value).splitlines()), style))

    line("匿名评阅书", heading)
    line("论文编号：" + snapshot["thesis_version_id"][:8])
    line(f"发布版本：{version}")
    line("发布日期：" + published_at.astimezone(ZoneInfo("Asia/Shanghai")).date().isoformat())
    line(f"总分：{total} / 100　　结论：{conclusion}")
    for item in snapshot["items"]:
        line("分项评分", heading)
        for dim in rule["dimensions"]:
            line(f"{dim['label']}：{item['scores'][dim['key']]} / {dim['max_score']}")
        for label, key in (("评审建议", "recommendation"), ("总体评价", "overall_comment"), ("主要问题", "issues")):
            line(label, heading)
            line(item.get(key) or "未填写")
        story.append(Spacer(1, 4*mm))
    doc.build(story)
    return buffer.getvalue()
