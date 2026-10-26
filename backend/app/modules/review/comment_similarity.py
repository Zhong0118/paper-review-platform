"""Bounded comparison of an expert's own comments; never a plagiarism verdict."""
from difflib import SequenceMatcher
import unicodedata



def normalize(text):
    """NFKC clusters retain original codepoint spans, including expansions/composition."""
    clusters = []
    start = 0
    for index, char in enumerate(text):
        if index and not unicodedata.combining(char):
            previous = text[start:index]
            if unicodedata.normalize('NFKC', previous + char) == unicodedata.normalize('NFKC', previous) + unicodedata.normalize('NFKC', char):
                clusters.append((start, index))
                start = index
    if text:
        clusters.append((start, len(text)))
    values, offsets = [], []
    for start, end in clusters:
        for char in unicodedata.normalize('NFKC', text[start:end]):
            if not char.isspace() and not unicodedata.category(char).startswith('P'):
                values.append(char)
                offsets.append((start, end))
    return ''.join(values), offsets


def without_templates(text, templates):
    value, offsets = normalize(text)
    for template in sorted(templates, key=len, reverse=True):
        phrase = normalize(template)[0]
        if not phrase:
            continue
        start = value.find(phrase)
        while start >= 0:
            value = value[:start] + value[start + len(phrase):]
            offsets = offsets[:start] + offsets[start + len(phrase):]
            start = value.find(phrase)
    return value, offsets


def compare_comments(current: str, history: list[dict], *, config=None) -> dict:
    # Defaults are the existing conclusion labels; service calls inject the versioned configuration.
    config = config if config is not None else {'version': 'own-history-v1',
        'templates': ('建议通过', '建议修改', '不通过', '修改后通过')}
    templates = config['templates']
    current_normal, offsets = without_templates(current, templates)
    report = {'status': 'NO_HISTORY' if not history else 'COMPLETE', 'hit_count': 0,
              'max_similarity': 0.0, 'matches': [], 'metric': 'character_3gram_jaccard',
              'threshold': .85, 'rule_version': config['version']}
    if not history:
        return report
    if len(current_normal) < 20:
        report['status'] = 'INSUFFICIENT_TEXT'
        return report
    grams = {current_normal[i:i + 3] for i in range(len(current_normal) - 2)}
    for row in history:
        candidate, _ = without_templates(row['text'], templates)
        if len(candidate) < 20:
            continue
        exact = current_normal == candidate
        other = {candidate[i:i + 3] for i in range(len(candidate) - 2)}
        score = len(grams & other) / len(grams | other)
        report['max_similarity'] = max(report['max_similarity'], score)
        if not exact and (min(len(current_normal), len(candidate)) < 40 or score < .85):
            continue
        blocks = [(0, len(current_normal))] if exact else [
            (block.a, block.size) for block in SequenceMatcher(None, current_normal, candidate).get_matching_blocks() if block.size >= 3]
        fragments = []
        for start, size in blocks:
            left, right = offsets[start][0], offsets[start + size - 1][1]
            fragments.append({'start': left, 'end': right, 'text': current[left:right]})
        report['matches'].append({'kind': 'EXACT' if exact else 'SIMILAR', 'similarity': score, 'fragments': fragments})
    report['hit_count'] = len(report['matches'])
    return report


async def own_history(session, user, task_id):
    """One SELECT gives one MVCC corpus snapshot, under the caller's existing RLS."""
    from sqlalchemy import select, func, text
    from app.modules.dispatch.models import ExpertTask, ReviewRound
    from app.modules.expert.models import Expert
    from app.modules.thesis.models import Thesis
    from app.modules.review.models import ReviewResultVersion as Result, ReviewResultRevision as Revision, ReviewCorrectionRequest as Correction

    effective_id = (select(Revision.id).join(Correction, Correction.id == Revision.request_id)
        .where(Revision.task_id == Result.task_id, Correction.status == 'ACTIVATED')
        .order_by(Revision.revision_no.desc()).limit(1).correlate(Result).scalar_subquery())
    created = func.coalesce(Revision.created_at, Result.created_at)
    identity = func.coalesce(Revision.id, Result.id)
    query = (select(identity.label('id'), func.coalesce(Revision.comments, Result.comments).label('comments'))
        .select_from(Result).join(ExpertTask, ExpertTask.id == Result.task_id)
        .join(Expert, Expert.id == ExpertTask.expert_id)
        .join(ReviewRound, ReviewRound.id == ExpertTask.round_id)
        .join(Thesis, Thesis.id == ExpertTask.thesis_id)
        .outerjoin(Revision, Revision.id == effective_id)
        .where(Expert.user_id == user.id, ExpertTask.id != task_id, ExpertTask.status == 'SUBMITTED',
               Result.is_current.is_(True), Thesis.current_version_id == ReviewRound.thesis_version_id,
               Thesis.stage.in_(('RESULT_PROCESSING', 'COMPLETED')),
               ReviewRound.status.in_(('RESULT_READY', 'COMPLETED')),
               created >= func.statement_timestamp() - text("INTERVAL '365 days'"))
        .order_by(created.desc(), identity.desc()).limit(201))
    rows = (await session.execute(query)).mappings().all()
    return rows[:200], {'window_days': 365, 'limit': 200, 'examined': min(len(rows), 200), 'truncated': len(rows) > 200}


def comment_text(payload):
    from app.modules.review.comment_checks import text_fields
    parts, spans, offset = [], [], 0
    for field, value in text_fields(payload):
        parts.append(value)
        spans.append((field, offset, offset + len(value)))
        offset += len(value) + 1
    return '\n'.join(parts), spans


async def checked_report(session, user, task_id, payload, rule_snapshot):
    import hashlib
    import json
    from app.modules.review.comment_checks import review_report, payload_hash, load_dictionary
    dictionary = load_dictionary()
    report = review_report(payload, rule_snapshot, dictionary=dictionary)
    rows, coverage = await own_history(session, user, task_id)
    current, spans = comment_text(payload)
    similarity = compare_comments(current, [{'text': comment_text(row['comments'])[0]} for row in rows],
                                  config=dictionary['similarity'])
    fingerprint = hashlib.sha256(json.dumps({'ids': sorted(str(row['id']) for row in rows),
        'rule_version': report['rule_version'], 'similarity_version': similarity['rule_version'],
        'truncated': coverage['truncated']}, sort_keys=True).encode()).hexdigest()
    similarity.update(coverage=coverage, fingerprint=fingerprint)
    # Collapse identical current-text snippets; neither candidate IDs nor text leave the service.
    unique = {json.dumps(match, sort_keys=True): match for match in similarity['matches']}
    similarity['matches'] = list(unique.values())
    seen = set()
    for match in similarity['matches']:
        for fragment in match['fragments']:
            for field, start, end in spans:
                left, right = max(start, fragment['start']), min(end, fragment['end'])
                if left >= right:
                    continue
                key = (field, left - start, right - start)
                if key in seen:
                    continue
                seen.add(key)
                report['findings'].append({'code': 'OWN_HISTORY_SIMILARITY', 'field': field,
                    'start': left - start, 'end': right - start, 'severity': 'WARN',
                    'message': '与本人历史评语存在相同或相似片段，请结合本次论文核对；不是抄袭认定', 'suggestion': None})
    report['similarity'] = similarity
    report['rule_version'] += ':' + fingerprint
    report['payload_hash'] = payload_hash(payload, report['rule_version'])
    return report
