from copy import deepcopy
import pytest
from app.modules.review.rules import pilot_rule_snapshot
from tests.test_review import VALID_DRAFT as BASE_DRAFT

# Keep an explicitly short fixture to exercise warnings regardless of the shared happy path.
VALID_DRAFT = {**BASE_DRAFT, "overallComment": "达到硕士答辩要求。", "issues": "实验偏少"}


def check(payload, dictionary=None):
    from app.modules.review.comment_checks import check_comment
    return check_comment(payload, pilot_rule_snapshot(), dictionary or {'version': 'test-v1', 'entries': []})


def long_payload():
    return {**VALID_DRAFT, 'overallComment': '本文研究问题明确，采用的方法基本适当，实验结果能够支持主要结论。建议作者进一步补充数据来源说明，并详细讨论研究结论的适用条件。',
            'issues': '现有实验仍缺少不同样本规模的对照分析，建议补充并说明局限性。'}


def test_short_comments_warn_without_changing_input():
    payload = deepcopy(VALID_DRAFT)
    original = deepcopy(payload)
    findings = check(payload)
    assert {f['code'] for f in findings} == {'SHORT_OVERALL', 'SHORT_ISSUES'}
    assert all(f['severity'] == 'WARN' for f in findings)
    assert payload == original


def test_normal_academic_criticism_and_empty_dictionary_do_not_warn():
    payload = long_payload()
    assert check(payload) == []
    assert check(payload) == check(dict(reversed(list(payload.items()))))


def test_unicode_offsets_and_dictionary_exceptions():
    payload = {**long_payload(), 'revisionAdvice': '😀甲测试错词乙。'}
    dictionary = {'version': 'test-v1', 'entries': [{'code': 'TEST_TYPO', 'category': 'typo',
        'pattern': '测试错词', 'suggestion': '测试正确词', 'exceptions': ['引用测试错词'], 'source': 'test only'}]}
    finding = next(f for f in check(payload, dictionary) if f['code'] == 'TEST_TYPO')
    assert (finding['field'], finding['start'], finding['end']) == ('revisionAdvice', 2, 6)
    assert payload['revisionAdvice'][finding['start']:finding['end']] == '测试错词'
    assert not check({**payload, 'revisionAdvice': '引用测试错词'}, dictionary)


def test_repetition_marks_second_sentence_at_original_offset():
    sentence = '该研究需要增加独立样本验证并补充统计检验的详细过程'
    payload = {**long_payload(), 'revisionAdvice': '😀。' + sentence + '。' + sentence + '。'}
    repeated = [f for f in check(payload) if f['code'] == 'REPEATED_SENTENCE']
    assert len(repeated) == 1
    assert payload['revisionAdvice'][repeated[0]['start']:repeated[0]['end']] == sentence


@pytest.mark.parametrize('text', ['不建议通过。', '并非不通过。', '引用：“不通过”。', '不能认定为不通过。'])
def test_negation_and_quotation_are_not_inferred_as_conclusion(text):
    assert not any(f['code'] == 'EXPLICIT_CONCLUSION_CONFLICT'
                   for f in check({**long_payload(), 'revisionAdvice': text}))


def test_standalone_explicit_conclusion_and_identity_candidates():
    payload = {**long_payload(), 'revisionAdvice': '不通过。请联系13800138000。'}
    codes = {f['code'] for f in check(payload)}
    assert codes == {'EXPLICIT_CONCLUSION_CONFLICT', 'PHONE_CANDIDATE'}


def test_hash_excludes_transport_ack_but_binds_scores_and_rule_version():
    from app.modules.review.comment_checks import payload_hash
    payload = long_payload()
    digest = payload_hash(payload, 'v1')
    assert payload_hash({**payload, 'check_ack': {'codes': ['FAKE']}}, 'v1') == digest
    assert payload_hash(dict(reversed(list(payload.items()))), 'v1') == digest
    assert payload_hash({**payload, 'topicValue': 13}, 'v1') != digest
    assert payload_hash(payload, 'v2') != digest


@pytest.mark.parametrize('payload', [
    {**VALID_DRAFT, 'overallComment': '😀' * 10001},
    {**VALID_DRAFT, 'overallComment': '甲' * 10000, 'issues': '乙' * 10000, 'strengths': '丙' * 10000, 'evaluations': {'innovation': '丁'}},
])
def test_size_limit_rejects_before_checking(payload):
    from app.core.exceptions import AppError
    with pytest.raises(AppError) as caught:
        check(payload)
    assert caught.value.http_status == 422


@pytest.mark.asyncio
async def test_preview_ack_submission_and_private_summary_with_real_rls():
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy import text
    from app.db.rls_context import bind_candidate_identity, verified_access_claims
    from scripts.acceptance_server import acceptance_environment
    from tests.helpers import login, auth
    from uuid import UUID

    async with acceptance_environment('accepted') as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app), base_url='http://test') as client:
            expert = await login(client, 'expert.zhou', runtime.seed_password)
            other = await login(client, 'expert.qian', runtime.seed_password)
            school = await login(client, 'school.wang', runtime.seed_password)
            url = f'/api/v1/expert-tasks/{runtime.task_id}/review-checks'
            preview = await client.post(url, headers=auth(expert), json={'payload': VALID_DRAFT})
            assert preview.status_code == 200, preview.text
            report = preview.json()['data']
            assert report['status'] == 'COMPLETE'
            assert report['coverage']['dictionary_entries'] == 0
            assert {f['code'] for f in report['findings']} == {'SHORT_OVERALL', 'SHORT_ISSUES'}
            assert (await client.post(url, headers=auth(other), json={'payload': VALID_DRAFT})).status_code == 404
            submit = f'/api/v1/expert/tasks/{runtime.task_id}:submit-final'
            missing = await client.post(submit, headers=auth(expert), json=VALID_DRAFT)
            assert missing.status_code == 409
            assert missing.json()['code'] == 'CHECK_ACK_REQUIRED'
            ack = {key: report[key] for key in ('payload_hash', 'rule_version')}
            ack['codes'] = sorted({f['code'] for f in report['findings']})
            changed = await client.post(submit, headers=auth(expert), json={**VALID_DRAFT, 'topicValue': 13, 'check_ack': ack})
            assert changed.status_code == 409
            submitted_body = {**VALID_DRAFT, 'check_ack': ack}
            headers = {**auth(expert), 'Idempotency-Key': 'checked-final'}
            submitted = await client.post(submit, headers=headers, json=submitted_body)
            assert submitted.status_code == 200, submitted.text
            replay = await client.post(submit, headers=headers, json=submitted_body)
            assert replay.status_code == 200
            assert replay.json()['data'] == submitted.json()['data']
            assert (await client.post(url, headers=auth(expert), json={'payload': VALID_DRAFT})).status_code == 404
            async with runtime.session_factory() as session:
                await bind_candidate_identity(session, verified_access_claims(expert['access_token']))
                row = (await session.execute(text('SELECT check_summary,comments FROM review_result_versions'))).one()
                assert row.check_summary['counts'] == {'SHORT_OVERALL': 1, 'SHORT_ISSUES': 1}
                assert row.check_summary['confirmed_by'] == expert['user']['id']
                assert 'check_ack' not in row.comments
                assert '达到硕士' not in str(row.check_summary)
            result = await client.get(f'/api/v1/school-review/theses/{runtime.thesis_id}/results', headers=auth(school))
            assert result.json()['data']['items'][0]['check_summary']['counts']['SHORT_OVERALL'] == 1
            assert expert['user']['id'] not in result.text
            assert 'confirmed_by' not in result.text
            async with runtime.session_factory() as session:
                await bind_candidate_identity(session, verified_access_claims(school['access_token']))
                result_id = await session.scalar(text('SELECT id FROM review_result_versions'))
            # Even the owner cannot alter an already stored check summary.
            from sqlalchemy.exc import DBAPIError
            from sqlalchemy import create_engine
            from tests.conftest import _test_url
            engine = create_engine(_test_url().replace('+asyncpg', '+psycopg'),
                connect_args={'options': f'-c search_path={runtime.schema}'})
            try:
                with engine.begin() as conn:
                    with pytest.raises(DBAPIError):
                        conn.execute(text("UPDATE review_result_versions SET check_summary='{}' WHERE id=:id"), {'id': result_id})
                from tests.test_rule_snapshot_migration import migrate
                down = migrate(runtime.schema, 'downgrade', '0022_review_corrections')
                assert down.returncode != 0 and 'would discard check receipts' in down.stderr
                with engine.connect() as conn:
                    assert conn.scalar(text('SELECT version_num FROM alembic_version')) == '0024_expert_task_time_scope'
                    assert conn.scalar(text("SELECT bool_and(relforcerowsecurity) FROM pg_class WHERE relnamespace=to_regnamespace(current_schema()) AND relname IN ('review_result_versions','review_result_revisions')")) is True
            finally:
                engine.dispose()


@pytest.mark.asyncio
async def test_zero_findings_needs_no_ack_and_check_failure_never_submits(monkeypatch):
    from httpx import ASGITransport, AsyncClient
    from scripts.acceptance_server import acceptance_environment
    from tests.helpers import login, auth
    from app.modules.review import comment_checks
    from app.core.exceptions import AppError

    async with acceptance_environment('accepted') as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app), base_url='http://test') as client:
            expert = await login(client, 'expert.zhou', runtime.seed_password)
            url = f'/api/v1/expert/tasks/{runtime.task_id}:submit-final'
            loader = comment_checks.load_dictionary
            def failed():
                raise AppError('CHECK_UNAVAILABLE', 503, '检查暂不可用')
            monkeypatch.setattr(comment_checks, 'load_dictionary', failed)
            unavailable = await client.post(url, headers=auth(expert), json=long_payload())
            assert unavailable.status_code == 503
            monkeypatch.setattr(comment_checks, 'load_dictionary', loader)
            submitted = await client.post(url, headers=auth(expert), json=long_payload())
            assert submitted.status_code == 200, submitted.text


@pytest.mark.asyncio
async def test_correction_checks_only_approved_owner_and_binds_revision():
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy import text
    from app.db.rls_context import bind_candidate_identity, verified_access_claims
    from scripts.acceptance_server import acceptance_environment
    from tests.helpers import login, auth

    async with acceptance_environment('accepted') as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app), base_url='http://test') as client:
            expert = await login(client, 'expert.zhou', runtime.seed_password)
            platform = await login(client, 'platform.chen', runtime.seed_password)
            original = await client.post(f'/api/v1/expert/tasks/{runtime.task_id}:submit-final', headers=auth(expert), json=long_payload())
            assert original.status_code == 200, original.text
            context = (await client.get(f'/api/v1/expert-tasks/{runtime.task_id}/corrections', headers=auth(expert))).json()['data']
            row = (await client.post(f'/api/v1/expert-tasks/{runtime.task_id}/corrections', headers=auth(expert, 'check-request'),
                json={'base_result_id': context['base_result_id'], 'reason': '核对更正'})).json()['data']
            url = f"/api/v1/expert-corrections/{row['id']}/review-checks"
            assert (await client.post(url, headers=auth(expert), json={'payload': VALID_DRAFT})).status_code == 404
            approved = await client.post(f"/api/v1/platform-review/corrections/{row['id']}:decide", headers=auth(platform, 'check-approve'),
                json={'version': row['version'], 'decision': 'APPROVE', 'reason': '允许核对'})
            assert approved.status_code == 200, approved.text
            version = approved.json()['data']['version']
            report = await client.post(url, headers=auth(expert), json={'payload': VALID_DRAFT})
            assert report.status_code == 200, report.text
            report = report.json()['data']
            submit = f"/api/v1/expert-corrections/{row['id']}:submit"
            body = {'version': version, 'payload': VALID_DRAFT}
            refused = await client.post(submit, headers=auth(expert, 'check-submit'), json=body)
            assert refused.status_code == 409
            assert refused.json()['code'] == 'CHECK_ACK_REQUIRED'
            ack = {key: report[key] for key in ('payload_hash', 'rule_version')}
            ack['codes'] = sorted({f['code'] for f in report['findings']})
            accepted = await client.post(submit, headers=auth(expert, 'check-submit'), json={**body, 'check_ack': ack})
            assert accepted.status_code == 200, accepted.text
            async with runtime.session_factory() as session:
                await bind_candidate_identity(session, verified_access_claims(expert['access_token']))
                summary = await session.scalar(text('SELECT check_summary FROM review_result_revisions'))
                assert summary['payload_hash'] == report['payload_hash']
                assert summary['codes'] == ['SHORT_ISSUES', 'SHORT_OVERALL']
            assert (await client.post(url, headers=auth(expert), json={'payload': VALID_DRAFT})).status_code == 404


def test_multiline_quote_is_not_an_explicit_conclusion():
    payload = {**long_payload(), 'revisionAdvice': '引用前次意见：“\n不通过。\n” 本次已核对。'}
    assert not any(f['code'] == 'EXPLICIT_CONCLUSION_CONFLICT' for f in check(payload))


def test_provided_stale_ack_is_invalid_even_after_all_warnings_are_removed():
    from app.modules.review.comment_checks import review_report, confirm_checks
    from app.core.exceptions import AppError
    report = review_report(VALID_DRAFT, pilot_rule_snapshot())
    ack = {key: report[key] for key in ('payload_hash', 'rule_version')}
    ack['codes'] = ['SHORT_ISSUES', 'SHORT_OVERALL']
    with pytest.raises(AppError) as caught:
        confirm_checks(long_payload(), pilot_rule_snapshot(), ack, 'test-user')
    assert caught.value.code == 'CHECK_ACK_REQUIRED'


@pytest.mark.asyncio
async def test_historical_results_remain_unchecked_across_migration_roundtrip():
    from sqlalchemy import create_engine, text
    from tests.conftest import _test_url
    from tests.legacy_rls_fixture import legacy_accepted_0015
    from tests.test_rule_snapshot_migration import migrate, legacy_result

    async with legacy_accepted_0015() as old:
        engine = create_engine(_test_url().replace('+asyncpg', '+psycopg'),
            connect_args={'options': f'-c search_path={old.schema}'})
        try:
            with engine.begin() as conn:
                legacy_result(conn, old.task_id)
            result = migrate(old.schema, 'upgrade', '0022_review_corrections', old.roles)
            assert result.returncode == 0, result.stderr
            with engine.connect() as conn:
                before = conn.scalar(text('SELECT to_jsonb(t) FROM review_result_versions t'))
            for direction, revision in [('upgrade', '0023_review_check_summaries'),
                                        ('downgrade', '0022_review_corrections'),
                                        ('upgrade', '0023_review_check_summaries')]:
                result = migrate(old.schema, direction, revision, old.roles)
                assert result.returncode == 0, result.stderr
                with engine.connect() as conn:
                    after = conn.scalar(text('SELECT to_jsonb(t) FROM review_result_versions t'))
                    assert after == ({**before, 'check_summary': None} if direction == 'upgrade' else before)
                    assert conn.scalar(text("SELECT bool_and(relforcerowsecurity) FROM pg_class WHERE relnamespace=to_regnamespace(current_schema()) AND relname IN ('review_result_versions','review_result_revisions')")) is True
        finally:
            engine.dispose()
