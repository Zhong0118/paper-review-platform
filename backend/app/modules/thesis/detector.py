import unicodedata

from app.core.exceptions import AppError
from app.modules.files.pdf import inspect_pdf

from app.modules.files.models import FileObject
from app.modules.thesis.models import ThesisVersion
from app.modules.user.models import StudentEligibility
from app.shared.enums import AnonymizationConclusion


def _scan(text: str, eligibility: StudentEligibility) -> list[dict]:
    text = "".join(c for c in unicodedata.normalize("NFKC", text) if not c.isspace() and unicodedata.category(c) != "Cf")
    findings: list[dict] = []
    probes = [
        ("student_name", eligibility.student_name, True),
        ("student_no", eligibility.student_no, False),
        ("supervisor_name", eligibility.supervisor_name or "", True),
    ]
    for field, needle, case_sensitive in probes:
        if not needle:
            continue
        hay = text if case_sensitive else text.lower()
        target = "".join(c for c in unicodedata.normalize("NFKC", needle) if not c.isspace() and unicodedata.category(c) != "Cf")
        target = target if case_sensitive else target.lower()
        if target and target in hay:
            findings.append({"field": field, "matched_text": needle[:32], "location": "pending"})
    return findings


def run_anonymization_check(
    version: ThesisVersion,
    eligibility: StudentEligibility,
    anonymous: FileObject | None,
    body: bytes | None,
) -> tuple[str, list[dict]]:
    findings: list[dict] = []
    if anonymous is None:
        return AnonymizationConclusion.FAIL, [
            {"field": "anonymous", "matched_text": "missing", "location": "filename"}
        ]
    name_hits = _scan(anonymous.original_filename, eligibility)
    for item in name_hits:
        item["location"] = "filename"
        findings.append(item)
    uncertain = True
    text, metadata = "", ""
    if body:
        try:
            text, metadata, uncertain = inspect_pdf(body)
        except AppError:
            pass
    metadata += " " + " ".join([version.title or "", version.abstract or "", *(version.keywords or [])])
    for location, value in (("body", text), ("metadata", metadata)):
        for item in _scan(value, eligibility):
            item["location"] = location
            findings.append(item)
    if findings:
        return AnonymizationConclusion.FAIL, findings
    if uncertain:
        return AnonymizationConclusion.REVIEW_REQUIRED, []
    return AnonymizationConclusion.PASS, []
