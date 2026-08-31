from pathlib import Path

from app.modules.files.models import FileObject
from app.modules.thesis.models import ThesisVersion
from app.modules.user.models import StudentEligibility
from app.shared.enums import AnonymizationConclusion


def _scan(text: str, eligibility: StudentEligibility) -> list[dict]:
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
        target = needle if case_sensitive else needle.lower()
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
    text = ""
    if body:
        try:
            text = body.decode("utf-8", errors="ignore")
        except Exception:
            text = ""
        if not text:
            text = body.decode("latin-1", errors="ignore")
    body_hits = _scan(text, eligibility)
    for item in body_hits:
        item["location"] = "body"
        findings.append(item)
    if findings:
        return AnonymizationConclusion.FAIL, findings
    if body is None:
        return AnonymizationConclusion.REVIEW_REQUIRED, []
    return AnonymizationConclusion.PASS, []
