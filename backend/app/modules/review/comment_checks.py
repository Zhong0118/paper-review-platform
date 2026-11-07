"""Deterministic, advisory-only checks. Offsets refer to unmodified Unicode text."""
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re

from app.core.exceptions import AppError
from app.modules.review.rules import outcome_for_total, validate_rule_snapshot

TEXT_FIELDS = ('recommendation', 'strengths', 'issues', 'revisionAdvice', 'overallComment')
CONCLUSIONS = {'建议通过': 'PASS', '不通过': 'FAIL', '建议修改': 'REVISION_REQUIRED', '修改后通过': 'REVISION_REQUIRED'}
IDENTITY_PATTERNS = (
    ('PHONE_CANDIDATE', r'(?<!\d)1[3-9]\d{9}(?!\d)', '疑似手机号，请核对是否泄露身份或联系方式'),
    ('ID_NUMBER_CANDIDATE', r'(?<![\dA-Za-z])\d{6}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?![\dA-Za-z])', '疑似身份证号格式，请核对是否泄露身份信息'),
)


def canonical_payload(payload):
    from app.modules.review.service import ReviewPayload
    return ReviewPayload.model_validate(payload).model_dump()


def text_fields(payload):
    for field in TEXT_FIELDS:
        yield field, payload.get(field, '')
    for key, value in sorted(payload.get('evaluations', {}).items()):
        yield f'evaluations.{key}', value


def validate_size(payload):
    fields = list(text_fields(payload))
    if any(len(value) > 10000 for _, value in fields) or sum(len(value) for _, value in fields) > 30000:
        raise AppError('VALIDATION_FAILED', 422, '每个评语字段最多10000个字符，合计最多30000个字符')


def load_dictionary():
    try:
        data = json.loads((Path(__file__).resolve().parents[3] / 'data/review-checks-v1.json').read_text())
        if not isinstance(data['version'], str) or not isinstance(data['entries'], list):
            raise ValueError('invalid dictionary')
        return data
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise AppError('CHECK_UNAVAILABLE', 503, '评语检查暂不可用，请稍后重试') from exc


def payload_hash(payload, rule_version):
    data = {'payload': canonical_payload(payload), 'rule_version': rule_version}
    return hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


def check_comment(payload: dict, rule_snapshot: dict, dictionary: dict) -> list[dict]:
    payload = canonical_payload(payload)
    validate_size(payload)
    rule = validate_rule_snapshot(rule_snapshot)
    outcome = outcome_for_total(rule, sum(payload[d['key']] for d in rule['dimensions']))['code']
    findings = []

    def warn(code, field, start, end, message, suggestion=None):
        findings.append(dict(code=code, field=field, start=start, end=end, message=message,
                             suggestion=suggestion, severity='WARN'))

    for field, minimum in (('overallComment', 50), ('issues', 20)):
        value = payload[field]
        if len(re.sub(r'\s', '', value)) < minimum:
            warn('SHORT_OVERALL' if field == 'overallComment' else 'SHORT_ISSUES', field, 0, len(value),
                 f'少于{minimum}个非空白字符，请核对意见是否充分具体')
    seen = set()
    for field, value in text_fields(payload):
        quotations = [(m.start(), m.end()) for m in re.finditer(r'“[^”]*(?:”|$)|「[^」]*(?:」|$)|"[^"]*(?:"|$)', value)]
        for match in re.finditer(r'[^。！？!?；;\n]+', value):
            raw = match.group()
            sentence = raw.strip()
            start = match.start() + len(raw) - len(raw.lstrip())
            if len(sentence) >= 20:
                if sentence in seen:
                    warn('REPEATED_SENTENCE', field, start, start + len(sentence), '同份评语出现重复长句，请核对')
                seen.add(sentence)
            # Only a whole explicit clause; quotes/negation/modifiers are not inferred.
            conclusion = dictionary.get('conclusions', CONCLUSIONS).get(sentence)
            if conclusion and conclusion != outcome and not any(a <= start < b for a, b in quotations):
                warn('EXPLICIT_CONCLUSION_CONFLICT', field, start, start + len(sentence), '明确结论短语与计分档位不同，请核对')
        for code, pattern, message in IDENTITY_PATTERNS:
            for match in re.finditer(pattern, value):
                warn(code, field, match.start(), match.end(), message)
        for entry in dictionary['entries']:
            pattern = entry['pattern']
            if not pattern:
                continue
            exceptions = [(m.start(), m.end()) for phrase in entry.get('exceptions', []) if phrase
                          for m in re.finditer(re.escape(phrase), value)]
            for match in re.finditer(re.escape(pattern), value):
                if not any(start <= match.start() and match.end() <= end for start, end in exceptions):
                    warn(entry['code'], field, match.start(), match.end(), '命中受控词表，请结合上下文核对', entry.get('suggestion'))
    return findings


def review_report(payload, rule_snapshot, *, dictionary=None):
    dictionary = dictionary if dictionary is not None else load_dictionary()
    # Bind the actual configuration as well as the named engine and scoring versions.
    config_hash = hashlib.sha256(json.dumps(dictionary, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]
    version = f"{dictionary['version']}:{rule_snapshot['version']}:{config_hash}"
    return {'payload_hash': payload_hash(payload, version), 'rule_version': version,
            'findings': check_comment(payload, rule_snapshot, dictionary),
            'checked_at': datetime.now(timezone.utc).isoformat(), 'status': 'COMPLETE',
            'coverage': {'dictionary_version': dictionary['version'], 'dictionary_entries': len(dictionary['entries']),
                         'description': dictionary.get('source', '')}}


def confirm_checks(payload, rule_snapshot, ack, actor_id, *, report=None):
    report = report if report is not None else review_report(payload, rule_snapshot)
    counts = Counter(f['code'] for f in report['findings'])
    if (counts and not ack) or (ack is not None and (ack.get('payload_hash') != report['payload_hash']
                   or ack.get('rule_version') != report['rule_version']
                   or set(ack.get('codes', [])) != set(counts))):
        raise AppError('CHECK_ACK_REQUIRED', 409, '请检查当前评语并确认全部提示后再提交')
    summary = {'payload_hash': report['payload_hash'], 'rule_version': report['rule_version'],
            'codes': sorted(counts), 'counts': dict(counts), 'confirmed_by': str(actor_id),
            'confirmed_at': report['checked_at']}
    if 'similarity' in report:
        summary['similarity'] = {key: value for key, value in report['similarity'].items() if key != 'matches'}
    return summary


async def preview_checks(session, user, payload, *, task_id=None, correction_id=None):
    from app.modules.dispatch.service import get_task_for_expert
    from app.modules.dispatch.models import ReviewRound
    from app.modules.review.models import ReviewCorrectionRequest
    from app.modules.review.service import validate_for_submit
    from app.modules.thesis.models import Thesis
    hidden = AppError('RESOURCE_NOT_FOUND', 404, '资源不存在或不可见')
    if correction_id:
        correction = await session.get(ReviewCorrectionRequest, correction_id)
        if correction is None or correction.status != 'APPROVED':
            raise hidden
        task_id = correction.task_id
    task = await get_task_for_expert(session, user, task_id)
    round_ = await session.get(ReviewRound, task.round_id)
    thesis = await session.get(Thesis, task.thesis_id)
    if (round_ is None or thesis is None or round_.thesis_version_id != thesis.current_version_id
        or (correction_id and (task.status != 'SUBMITTED' or thesis.stage not in ('RESULT_PROCESSING', 'COMPLETED')))
        or (not correction_id and (task.status != 'IN_REVIEW' or thesis.stage != 'UNDER_REVIEW' or round_.status != 'ACTIVE'))):
        raise hidden
    validate_for_submit(payload, round_.rule_snapshot)
    from app.modules.review.comment_similarity import checked_report
    return await checked_report(session, user, task.id, payload.model_dump(), round_.rule_snapshot)


def anonymous_summary(summary):
    if summary is None:
        return None
    return {key: summary[key] for key in ('rule_version', 'codes', 'counts', 'confirmed_at')}
