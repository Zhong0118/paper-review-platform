"""The single approved pilot rule; existing rounds never consult a new default."""
from copy import deepcopy
import json

from app.core.exceptions import AppError

_RULE = {'version': 'pilot-single-v1',
 'required_experts': 1,
 'mode': 'sum_dimensions',
 'dimensions': [{'key': 'topicValue', 'label': '选题价值', 'max_score': 15},
                {'key': 'literatureTheory', 'label': '文献与理论基础', 'max_score': 15},
                {'key': 'methodology', 'label': '研究方法', 'max_score': 20},
                {'key': 'innovation', 'label': '创新性', 'max_score': 25},
                {'key': 'writingStandards', 'label': '写作与学术规范', 'max_score': 10},
                {'key': 'resultsWorkload', 'label': '研究成果与工作量', 'max_score': 15}],
 'bands': [{'min': 0, 'max': 59, 'code': 'FAIL', 'label': '不通过'},
           {'min': 60, 'max': 79, 'code': 'REVISION_REQUIRED', 'label': '修改后通过'},
           {'min': 80, 'max': 100, 'code': 'PASS', 'label': '通过'}]}


def pilot_rule_snapshot() -> dict:
    return deepcopy(_RULE)


def validate_rule_snapshot(snapshot: dict) -> dict:
    try:
        matches = json.dumps(snapshot, sort_keys=True, allow_nan=False) == json.dumps(_RULE, sort_keys=True)
    except (TypeError, ValueError):
        matches = False
    if not matches:
        raise AppError("STATE_TRANSITION_DENIED", 409, "评审规则快照未知或损坏，需核查")
    return deepcopy(snapshot)


def outcome_for_total(snapshot: dict, total: int) -> dict:
    rule = validate_rule_snapshot(snapshot)
    if type(total) is not int or not 0 <= total <= 100:
        raise AppError("STATE_TRANSITION_DENIED", 409, "汇总分数不符合固定规则")
    band = next(item for item in rule["bands"] if item["min"] <= total <= item["max"])
    return {"code": band["code"], "label": band["label"]}
