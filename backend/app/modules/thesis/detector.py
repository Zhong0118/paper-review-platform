import unicodedata

from app.core.exceptions import AppError
from app.modules.files.pdf import extract_pdf_pages

from app.modules.files.models import FileObject
from app.modules.thesis.models import ThesisVersion
from app.modules.user.models import StudentEligibility
from app.shared.enums import AnonymizationConclusion


def normalized(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKC", text) if not c.isspace() and unicodedata.category(c) != "Cf")


def _scan(text: str, eligibility: StudentEligibility, source: str, page_number=None) -> list[dict]:
    haystack = normalized(text)
    # Map normalized characters back to a bounded excerpt of the original page.
    offsets = []
    for index, char in enumerate(text):
        offsets.extend([index] * len(normalized(char)))
    findings = []
    for field, needle, case_sensitive in (
        ("student_name", eligibility.student_name, True),
        ("student_no", eligibility.student_no, False),
        ("supervisor_name", eligibility.supervisor_name or "", True),
    ):
        if not needle:
            continue
        hay = haystack if case_sensitive else haystack.lower()
        target = normalized(needle)
        target = target if case_sensitive else target.lower()
        at = hay.find(target) if target else -1
        if at >= 0:
            offset = offsets[min(at, len(offsets) - 1)] if offsets else 0
            findings.append({"field": field, "location": "metadata" if source == "thesis_metadata" else source,
                "kind": "IDENTITY", "source": source, "page_number": page_number,
                "matched_text": needle[:64], "context": text[max(0, offset - 30):max(0, offset - 30) + 120], "severity": "BLOCK"})
    return findings


def run_anonymization_check(
    version: ThesisVersion,
    eligibility: StudentEligibility,
    anonymous: FileObject | None,
    body: bytes | None,
    *, inspection=None,
) -> tuple[str, list[dict]]:
    if anonymous is None:
        return AnonymizationConclusion.FAIL, [{"field": "anonymous", "matched_text": "missing", "location": "filename",
            "kind": "MISSING_FILE", "source": "filename", "page_number": None, "context": "", "severity": "BLOCK"}]
    findings = _scan(anonymous.original_filename, eligibility, "filename")
    uncertain = True
    if body:
        try:
            inspection = inspection or extract_pdf_pages(body)
            uncertain = inspection["uncertain"]
            for page in inspection["pages"]:
                findings.extend(_scan(page["text"], eligibility, "body", page["page_number"]))
            # Preserve the former joined-text detection when an identity crosses a page break.
            joined = "\n".join(p["text"] for p in inspection["pages"])
            detected = {f["field"] for f in findings if f["source"] == "body"}
            for finding in _scan(joined, eligibility, "body"):
                if finding["field"] not in detected:
                    target = normalized(finding["matched_text"])
                    at = normalized(joined).lower().find(target.lower())
                    offset = 0
                    for page in inspection["pages"]:
                        offset += len(normalized(page["text"]))
                        if at < offset:
                            finding["page_number"] = page["page_number"]
                            break
                    findings.append(finding)
            findings.extend(_scan(inspection["metadata"], eligibility, "metadata"))
        except AppError:
            pass
    findings.extend(_scan(" ".join([version.title or "", version.abstract or "", *(version.keywords or [])]), eligibility, "thesis_metadata"))
    if findings:
        return AnonymizationConclusion.FAIL, findings
    return (AnonymizationConclusion.REVIEW_REQUIRED if uncertain else AnonymizationConclusion.PASS), []


DETECTOR_VERSION = "v3-sensitive-pages"


def inspection_sources(version, anonymous, inspection):
    return ([{"source": "filename", "page_number": None, "text": anonymous.original_filename},
             {"source": "metadata", "page_number": None, "text": inspection["metadata"]},
             {"source": "thesis_metadata", "page_number": None,
              "text": " ".join([version.title or "", version.abstract or "", *(version.keywords or [])])}]
            + [{"source": "body", "page_number": p["page_number"], "text": p["text"]} for p in inspection["pages"]])


def detect_sensitive(version, eligibility, anonymous, body, inspection, terms):
    conclusion, findings = run_anonymization_check(version, eligibility, anonymous, body, inspection=inspection)
    for source in inspection_sources(version, anonymous, inspection):
        for term in terms:
            at = source["text"].find(term["text"])
            if at < 0:
                continue
            findings.append({"kind": "SCHOOL_TERM", "field": "school_term", "source": source["source"],
                "location": source["source"], "page_number": source["page_number"], "matched_text": term["text"],
                "context": source["text"][max(0, at-30):max(0, at-30)+120], "severity": term["severity"],
                "description": term.get("description", "")})
            if term["severity"] == "BLOCK":
                conclusion = AnonymizationConclusion.FAIL
            elif conclusion != AnonymizationConclusion.FAIL:
                conclusion = AnonymizationConclusion.REVIEW_REQUIRED
    first_pages = inspection["pages"][:2]
    if not normalized(version.title) or not first_pages or any(p["uncertain"] for p in first_pages):
        title_status = "NOT_CHECKED"
    elif normalized(version.title) in normalized("\n".join(p["text"] for p in first_pages)):
        title_status = "FOUND"
    else:
        title_status = "TITLE_NOT_FOUND"
        findings.append({"kind": "TITLE_NOT_FOUND", "field": "title", "source": "title", "location": "title", "page_number": None,
            "matched_text": "", "context": "前两页未找到登记标题的文字，仅供核对，不代表内容不一致", "severity": "WARN"})
    return conclusion, findings, title_status
