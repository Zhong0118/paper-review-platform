"""Deterministic metadata/tag ranking, independent of assignment permissions."""
import unicodedata


def normalize(value: str) -> str:
    return unicodedata.normalize('NFKC',value).strip().lower()


def rank_candidate(metadata: dict, expert: dict) -> dict:
    texts=[normalize(metadata.get(field) or '') for field in ('title','abstract')]
    directions=sorted({normalize(tag) for tag in expert.get('research_directions') or [] if normalize(tag)})
    keywords={normalize(tag) for tag in metadata.get('keywords') or [] if normalize(tag)}
    matched_keywords=sorted(keywords & {normalize(tag) for tag in expert.get('keywords') or [] if normalize(tag)})
    # Only credited tags are returned, so the explanation always sums to the score.
    matched_directions=[tag for tag in directions if any(tag in text for text in texts)][:5]
    reasons=[{'kind':'research_direction','tag':tag,'points':3} for tag in matched_directions]
    reasons += [{'kind':'keyword','tag':tag,'points':2} for tag in matched_keywords[:5]]
    return {'match_score':sum(item['points'] for item in reasons),
            'match_rule_version':'expert-rank-v1','match_reasons':reasons}
