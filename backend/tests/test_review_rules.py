import pytest

from app.core.exceptions import AppError
from app.modules.review.rules import pilot_rule_snapshot, validate_rule_snapshot, outcome_for_total


@pytest.mark.parametrize('total,code',[(0,'FAIL'),(59,'FAIL'),(60,'REVISION_REQUIRED'),(79,'REVISION_REQUIRED'),(80,'PASS'),(100,'PASS')])
def test_fixed_bands(total,code):
    assert outcome_for_total(pilot_rule_snapshot(),total)['code']==code


@pytest.mark.parametrize('total',[-1,101,True,60.0,'60',None])
def test_non_integer_or_out_of_range_total_refused(total):
    with pytest.raises(AppError) as caught:
        outcome_for_total(pilot_rule_snapshot(),total)
    assert caught.value.http_status==409


def test_snapshot_copies_are_independent():
    rule=pilot_rule_snapshot()
    copy=validate_rule_snapshot(rule)
    copy['dimensions'][0]['max_score']=999
    assert rule==pilot_rule_snapshot()
    assert sum(x['max_score'] for x in rule['dimensions'])==100


@pytest.mark.parametrize('damage',['version','extra','bool','float','dimension','band'])
def test_unknown_or_damaged_rule_is_not_replaced(damage):
    rule=pilot_rule_snapshot()
    if damage=='version': rule['version']='unknown-v2'
    elif damage=='extra': rule['extra']=True
    elif damage=='bool': rule['required_experts']=True
    elif damage=='float': rule['required_experts']=1.0
    elif damage=='dimension': rule['dimensions'][0]['max_score']=16
    else: rule['bands'][1]['min']=59
    with pytest.raises(AppError) as caught:
        validate_rule_snapshot(rule)
    assert caught.value.http_status==409
