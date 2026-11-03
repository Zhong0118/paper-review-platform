from datetime import datetime, timedelta
from httpx import AsyncClient, ASGITransport
from scripts.acceptance_server import acceptance_environment
from tests.helpers import auth, login
from tests.test_expert_operations import dispatch_fixture

PL = '/api/v1/platform-review'
EX = '/api/v1/expert'


async def setup(c, rt):
    platform, thesis, expert = await dispatch_fixture(c, rt)
    school = await login(c, 'school.wang', rt.seed_password)
    who = await login(c, 'expert.zhou', rt.seed_password)
    batch = (await c.get('/api/v1/school-admin/batches', headers=auth(school))).json()['data'][0]
    return platform, thesis, expert, school, who, batch


async def rule(c, school, b, accept, review):
    return await c.put(
        '/api/v1/school-admin/batches/' + b['id'] + '/deadlines',
        headers=auth(school),
        json={'expected_version': b['version'], 'accept_days': accept, 'review_days': review},
    )


async def task(c, platform, thesis, expert):
    r = await c.post(
        PL + '/theses/' + thesis['id'] + ':assign', headers=auth(platform), json={'expert_id': expert['id']}
    )
    assert r.status_code == 200, r.text
    return r.json()['data']['task']['id']


async def rows(c, who):
    r = await c.get(EX + '/tasks', headers=auth(who))
    assert r.status_code == 200, r.text
    return r.json()['data']


async def test_deadlines_snapshot_reassignment_and_scoped_views():
    async with acceptance_environment('operations') as rt:
        async with AsyncClient(transport=ASGITransport(app=rt.app), base_url='http://test') as c:
            p, t, e, s, who, b = await setup(c, rt)
            other = await login(c, 'pilot.school', rt.seed_password)
            assert (await rule(c, other, b, 1, 3)).status_code == 404
            assert (await rule(c, s, b, 0, 3)).status_code == 422
            put = await rule(c, s, b, 2, 5)
            assert put.status_code == 200, put.text
            assert (await rule(c, s, b, 1, 3)).status_code == 409
            tid = await task(c, p, t, e)
            first = (await rows(c, who))[0]
            due = first['deadline']
            assert due['accept_due_at'] and due['review_due_at'] is None and not due['overdue']
            assert datetime.fromisoformat(due['accept_due_at']) - datetime.fromisoformat(
                due['invited_at']
            ) == timedelta(days=2)
            assert (await rule(c, s, put.json()['data'], 3, 9)).status_code == 200
            r = await c.post(EX + '/tasks/' + tid + ':accept', headers=auth(who))
            assert r.status_code == 200
            d = (await rows(c, who))[0]['deadline']
            assert datetime.fromisoformat(d['review_due_at']) - datetime.fromisoformat(
                d['accepted_at']
            ) == timedelta(days=5)
            assert (
                d['original_review_due_at'] == d['review_due_at']
                and d['accept_due_at'] == due['accept_due_at']
            )
            school = (await c.get('/api/v1/school-review/progress', headers=auth(s))).json()['data']
            assert school['items'][0]['tasks'][0]['deadline'] == {
                k: v for k, v in d.items() if k != 'original_review_due_at'
            }
            assert e['id'] not in str(school)
            queue = (await c.get(PL + '/dispatch-queue', headers=auth(p))).json()['data']
            assert queue[0]['tasks'][0]['deadline'] == d
            experts = (await c.get(PL + '/experts', headers=auth(p))).json()['data']
            q = next(x for x in experts if x['username'] == 'expert.qian')
            r = await c.patch(
                PL + '/experts/' + q['id'],
                headers=auth(p),
                json={
                    'version': q['version'],
                    'unit': '虚构单位',
                    'title': '教授',
                    'discipline_codes': ['0812'],
                },
            )
            assert r.status_code == 200
            r = await c.post(
                '/api/v1/expert-tasks/' + tid + ':reassign', headers=auth(p), json={'expert_id': q['id']}
            )
            assert r.status_code == 200, r.text
            d2 = (await rows(c, await login(c, 'expert.qian', rt.seed_password)))[0]['deadline']
            assert datetime.fromisoformat(d2['accept_due_at']) - datetime.fromisoformat(
                d2['invited_at']
            ) == timedelta(days=3)
            assert (await rows(c, who))[0]['status'] == 'CANCELLED'


def test_deadline_boundary_does_not_mark_terminal_or_missing_dates():
    from app.modules.dispatch.deadlines import deadline_view
    from datetime import timezone

    due = datetime(2026, 11, 4, 1, tzinfo=timezone.utc)
    for delta, late in [(-1, False), (0, True), (1, True)]:
        assert (
            deadline_view('INVITED', None, None, due, None, None, due + timedelta(seconds=delta))['overdue']
            is late
        )
    assert not deadline_view('SUBMITTED', None, None, None, due, None, due)['overdue']
    assert not deadline_view('INVITED', None, None, None, None, None, due)['overdue']


async def test_platform_load_invitation_accept_reassign_and_completion():
    from tests.test_review import VALID_DRAFT

    async with acceptance_environment('empty') as rt:
        async with AsyncClient(transport=ASGITransport(app=rt.app), base_url='http://test') as c:
            p, t, e, s, who, b = await setup(c, rt)
            url = PL + '/dispatch-candidates?thesis_id=' + t['id']

            async def loads():
                r = await c.get(url, headers=auth(p))
                assert r.status_code == 200
                return {i['expert_id']: i['workload'] for i in r.json()['data']}

            def count(inv, rev):
                return {'invited': inv, 'in_review': rev, 'total': inv + rev}

            assert (await loads())[e['id']] == count(0, 0)
            tid = await task(c, p, t, e)
            assert (await loads())[e['id']] == count(1, 0)
            assert (await c.post(EX + '/tasks/' + tid + ':accept', headers=auth(who))).status_code == 200
            assert (await loads())[e['id']] == count(0, 1)
            q = next(
                i
                for i in (await c.get(PL + '/experts', headers=auth(p))).json()['data']
                if i['username'] == 'expert.qian'
            )
            assert (
                await c.patch(
                    PL + '/experts/' + q['id'],
                    headers=auth(p),
                    json={
                        'version': q['version'],
                        'unit': '虚构单位',
                        'title': '教授',
                        'discipline_codes': ['0812'],
                    },
                )
            ).status_code == 200
            r = await c.post(
                '/api/v1/expert-tasks/' + tid + ':reassign', headers=auth(p), json={'expert_id': q['id']}
            )
            assert r.status_code == 200
            counts = await loads()
            assert counts[e['id']] == count(0, 0) and counts[q['id']] == count(1, 0)
            qtoken = await login(c, 'expert.qian', rt.seed_password)
            new = (await rows(c, qtoken))[0]['id']
            assert (await c.post(EX + '/tasks/' + new + ':accept', headers=auth(qtoken))).status_code == 200
            assert (
                await c.post(EX + '/tasks/' + new + ':submit-final', headers=auth(qtoken), json=VALID_DRAFT)
            ).status_code == 200
            assert (await loads())[q['id']] == count(0, 0)
            for account in (s, who):
                assert (await c.get(url, headers=auth(account))).status_code == 403


async def test_extension_overdue_reject_retry_approve_and_visibility():
    import asyncio
    from datetime import timezone

    async with acceptance_environment('operations') as rt:
        async with AsyncClient(transport=ASGITransport(app=rt.app), base_url='http://test') as c:
            p, t, e, s, who, b = await setup(c, rt)
            assert (await rule(c, s, b, None, 1)).status_code == 200
            tid = await task(c, p, t, e)
            assert (await c.post(EX + '/tasks/' + tid + ':accept', headers=auth(who))).status_code == 200
            # Age only our synthetic fixture, simulating three days passing without a production clock override.
            from sqlalchemy import create_engine, text
            from tests.conftest import _test_url

            engine = create_engine(
                _test_url().replace('+asyncpg', '+psycopg'),
                connect_args={'options': f'-c search_path={rt.schema}'},
            )
            try:
                with engine.begin() as conn:
                    conn.execute(text('ALTER TABLE expert_tasks DISABLE TRIGGER freeze_task_clocks'))
                    conn.execute(
                        text(
                            """UPDATE expert_tasks SET invited_at=invited_at-interval '3 days',
                    decided_at=decided_at-interval '3 days',original_review_due_at=original_review_due_at-interval '3 days'
                    WHERE id=:tid"""
                        ),
                        {'tid': tid},
                    )
                    conn.execute(text('ALTER TABLE expert_tasks ENABLE TRIGGER freeze_task_clocks'))
            finally:
                engine.dispose()
            clock = (await rows(c, who))[0]['deadline']
            assert clock['overdue']
            async def overdue_count(actor, portal):
                result = await c.get('/api/v1/'+portal+'/dashboard', headers=auth(actor))
                assert result.status_code == 200
                return result.json()['data']['cards']['overdue_tasks']
            assert await overdue_count(s, 'school-review') == 1
            assert await overdue_count(p, 'platform-review') == 1
            url = EX + '/tasks/' + tid + '/extensions'
            goal = datetime.now(timezone.utc) + timedelta(days=7)
            body = {'requested_due_at': goal.isoformat(), 'reason': '虚构申请理由'}
            outsider = await login(c, 'expert.qian', rt.seed_password)
            assert (await c.post(url, headers=auth(outsider), json=body)).status_code == 404
            assert (
                await c.post(
                    url, headers=auth(who), json={**body, 'requested_due_at': clock['original_review_due_at']}
                )
            ).status_code == 422

            async def create(key):
                return await c.post(url, headers=auth(who, key), json=body)

            created = await asyncio.gather(create('one'), create('two'))
            assert sorted(r.status_code for r in created) == [200, 409]
            first = next(r for r in created if r.status_code == 200).json()['data']

            async def decide(eid, actor, status, key):
                return await c.post(
                    PL + '/task-extensions/' + eid + ':decide',
                    headers=auth(actor, key),
                    json={'status': status, 'reason': '虚构审批意见'},
                )

            assert (await decide(first['id'], s, 'APPROVED', 's')).status_code == 403
            assert (await decide(first['id'], p, 'REJECTED', 'reject')).status_code == 200
            assert (await rows(c, who))[0]['deadline'] == clock
            second = (await create('repeat')).json()['data']
            assert (await create('repeat')).json()['data'] == second
            decision = await decide(second['id'], p, 'APPROVED', 'yes')
            assert decision.status_code == 200, decision.text
            assert (await decide(second['id'], p, 'APPROVED', 'yes')).json()['data'] == decision.json()[
                'data'
            ]
            assert (await create('third')).status_code == 409
            history = (await c.get(url, headers=auth(who))).json()['data']
            assert {x['status'] for x in history} == {'APPROVED', 'REJECTED'}
            assert all(
                x['reason'] == body['reason'] and x['decision_reason'] == '虚构审批意见' for x in history
            )
            updated = (await rows(c, who))[0]['deadline']
            assert (
                not updated['overdue']
                and updated['original_review_due_at'] == clock['original_review_due_at']
            )
            assert datetime.fromisoformat(updated['review_due_at']) == goal
            school = (await c.get('/api/v1/school-review/progress', headers=auth(s))).json()['data']
            assert school['items'][0]['tasks'][0]['deadline'] == {
                k: v for k, v in updated.items() if k != 'original_review_due_at'
            }
            assert body['reason'] not in str(school)
            detail = await c.get('/api/v1/school-review/theses/'+t['id']+'/progress',headers=auth(s))
            assert detail.json()['data']['tasks'][0]['deadline'] == school['items'][0]['tasks'][0]['deadline']
            assert await overdue_count(s, 'school-review') == 0
            assert await overdue_count(p, 'platform-review') == 0
            assert (await c.get(PL + '/task-extensions', headers=auth(s))).status_code == 403
            assert (await c.get(url, headers=auth(outsider))).status_code == 404


async def test_workload_spans_schools_and_drops_rejected_invitation():
    from tests.helpers import create_draft, attach_files

    async with acceptance_environment('operations') as rt:
        async with AsyncClient(transport=ASGITransport(app=rt.app), base_url='http://test') as c:
            p, t, e, s, who, b = await setup(c, rt)
            tid = await task(c, p, t, e)
            assert (await c.post(EX + '/tasks/' + tid + ':accept', headers=auth(who))).status_code == 200
            other = await login(c, 'pilot.school', rt.seed_password)
            student = await login(c, 'pilot.student', rt.seed_password)
            draft = await create_draft(c, student)
            path = '/api/v1/school-review/theses/' + draft['id']
            await attach_files(c, student, draft['id'])
            res = await c.post(
                '/api/v1/theses/' + draft['id'] + ':submit',
                headers=auth(student),
                json={'version': draft['version']},
            )
            for action, extra in [
                (':confirm-anonymization', {'decision': 'PASS'}),
                (':confirm-dispatch', {}),
            ]:
                assert res.status_code == 200, res.text
                res = await c.post(
                    path + action,
                    headers=auth(other),
                    json={'version': res.json()['data']['version'], **extra},
                )
            assert res.status_code == 200, res.text
            tid2 = await task(c, p, draft, e)

            async def workload():
                data = (
                    await c.get(PL + '/dispatch-candidates', params={'thesis_id': t['id']}, headers=auth(p))
                ).json()['data']
                return next(i['workload'] for i in data if i['expert_id'] == e['id'])

            assert await workload() == {'invited': 1, 'in_review': 1, 'total': 2}
            assert (
                await c.post(
                    EX + '/tasks/' + tid2 + ':reject', headers=auth(who), json={'reason': '虚构拒绝'}
                )
            ).status_code == 200
            assert await workload() == {'invited': 0, 'in_review': 1, 'total': 1}


async def test_pending_extension_cannot_survive_terminal_command_as_actionable():
    import asyncio
    from datetime import timezone
    from tests.test_review import VALID_DRAFT

    async with acceptance_environment('empty') as rt:
        async with AsyncClient(transport=ASGITransport(app=rt.app), base_url='http://test') as c:
            p, t, e, s, who, b = await setup(c, rt)
            assert (await rule(c, s, b, None, 1)).status_code == 200
            tid = await task(c, p, t, e)
            url = EX + '/tasks/' + tid
            body = {
                'requested_due_at': (datetime.now(timezone.utc) + timedelta(days=4)).isoformat(),
                'reason': '并发验收',
            }
            assert (await c.post(url + '/extensions', headers=auth(who), json=body)).status_code == 409
            assert (await c.post(url + ':accept', headers=auth(who))).status_code == 200
            rec = (await c.post(url + '/extensions', headers=auth(who, 'req'), json=body)).json()['data']

            async def approve(key):
                return await c.post(
                    PL + '/task-extensions/' + rec['id'] + ':decide',
                    headers=auth(p, key),
                    json={'status': 'APPROVED', 'reason': '核对'},
                )

            final, decision = await asyncio.wait_for(
                asyncio.gather(
                    c.post(url + ':submit-final', headers=auth(who), json=VALID_DRAFT), approve('approve')
                ),
                10,
            )
            assert final.status_code == 200, final.text
            assert decision.status_code in (200, 409), decision.text
            assert (await approve('again')).status_code == 409
            latest = (await c.get(PL + '/task-extensions', headers=auth(p))).json()['data'][0]
            assert not latest['actionable'] and latest['status'] == (
                'APPROVED' if decision.status_code == 200 else 'PENDING'
            )


async def test_extension_private_rows_and_dates_survive_real_restore():
    from datetime import timezone
    from pathlib import Path
    from tempfile import TemporaryDirectory
    from sqlalchemy import text
    from app.db.rls_context import bind_candidate_identity, verified_access_claims
    from scripts.recovery_drill import OwnedResources, backup_owned_resources, restore_owned_resources
    from tests.test_rule_snapshot_migration import migrate

    owned = None

    def guard(stage):
        if owned:
            owned.assert_cleanup_stage(stage)

    async with acceptance_environment('operations', cleanup_guard=guard, strict_cleanup=True) as rt:
        owned = OwnedResources.capture(rt)
        async with AsyncClient(transport=ASGITransport(app=rt.app), base_url='http://test') as c:
            p, t, e, s, who, b = await setup(c, rt)
            assert (await rule(c, s, b, 1, 2)).status_code == 200
            tid = await task(c, p, t, e)
            assert (await c.post(EX + '/tasks/' + tid + ':accept', headers=auth(who))).status_code == 200
            goal = datetime.now(timezone.utc) + timedelta(days=6)
            url = EX + '/tasks/' + tid + '/extensions'
            res = await c.post(
                url,
                headers=auth(who),
                json={'requested_due_at': goal.isoformat(), 'reason': '仅审批人和申请人可见'},
            )
            assert res.status_code == 200, res.text
            eid = res.json()['data']['id']
            decision = await c.post(
                PL + '/task-extensions/' + eid + ':decide',
                headers=auth(p),
                json={'status': 'APPROVED', 'reason': '批准延期'},
            )
            assert decision.status_code == 200
            denied = migrate(rt.schema, 'downgrade', '0030_task_clocks')
            assert denied.returncode != 0 and 'would discard extension history' in denied.stderr

            async def check():
                for username, expected_due, count in [
                    ('school.wang', goal, 0),
                    ('pilot.school', None, 0),
                    ('expert.qian', None, 0),
                    ('student.lin', None, 0),
                    ('expert.zhou', goal, 1),
                    ('platform.chen', goal, 1),
                ]:
                    actor = await login(c, username, rt.seed_password)
                    async with rt.session_factory() as session:
                        await bind_candidate_identity(session, verified_access_claims(actor['access_token']))
                        assert await session.scalar(text('SELECT count(*) FROM task_extensions')) == count
                        assert (
                            await session.scalar(text('SELECT approved_extension_due(:id)'), {'id': tid})
                            == expected_due
                        )
                        assert not await session.scalar(
                            text(
                                "SELECT has_column_privilege(current_user,'task_extensions','reason','UPDATE')"
                            )
                        )
                hist = (
                    await c.get(url, headers=auth(await login(c, 'expert.zhou', rt.seed_password)))
                ).json()['data']
                assert hist == [decision.json()['data']]

            await check()
            with TemporaryDirectory(prefix='deadline-recovery-') as tmp:
                archive = Path(tmp)
                manifest = backup_owned_resources(owned, archive)
                for table in ('expert_tasks', 'batch_deadline_rules', 'task_extensions'):
                    assert manifest['tables'][table]['count'] and manifest['tables'][table]['content_sha256']
                await rt.engine.dispose()
                await rt.auth_engine.dispose()
                restore_owned_resources(owned, manifest, archive)
                assert owned.schema_oid != manifest['schema_oid']
                await check()


import pytest


@pytest.mark.parametrize('end', ['terminate', 'reassign'])
async def test_approval_waits_for_terminal_paper_lock_and_preserves_history(monkeypatch, end):
    import asyncio
    from datetime import timezone
    from app.modules.thesis import service as thesis_service
    from app.modules.dispatch import service as dispatch_service

    async with acceptance_environment('empty') as rt:
        async with AsyncClient(transport=ASGITransport(app=rt.app), base_url='http://test') as c:
            p, t, e, s, who, b = await setup(c, rt)
            assert (await rule(c, s, b, None, 1)).status_code == 200
            tid = await task(c, p, t, e)
            path = EX + '/tasks/' + tid
            assert (await c.post(path + ':accept', headers=auth(who))).status_code == 200
            r = await c.post(
                path + '/extensions',
                headers=auth(who),
                json={
                    'requested_due_at': (datetime.now(timezone.utc) + timedelta(days=4)).isoformat(),
                    'reason': '测试',
                },
            )
            assert r.status_code == 200
            eid = r.json()['data']['id']
            if end == 'terminate':
                url = '/api/v1/school-review/theses/' + t['id']
                paper = (await c.get(url, headers=auth(s))).json()['data']
                end_url, header, body = (
                    url + ':terminate',
                    auth(s),
                    {'version': paper['version'], 'reason': '虚构终止'},
                )
            else:
                q = next(
                    x
                    for x in (await c.get(PL + '/experts', headers=auth(p))).json()['data']
                    if x['username'] == 'expert.qian'
                )
                assert (
                    await c.patch(
                        PL + '/experts/' + q['id'],
                        headers=auth(p),
                        json={
                            'version': q['version'],
                            'unit': '虚构单位',
                            'title': '教授',
                            'discipline_codes': ['0812'],
                        },
                    )
                ).status_code == 200
                end_url, header, body = (
                    '/api/v1/expert-tasks/' + tid + ':reassign',
                    auth(p),
                    {'expert_id': q['id']},
                )
            reached, release, attempt = asyncio.Event(), asyncio.Event(), asyncio.Event()
            original_dispatch = dispatch_service.lock_task_thesis
            original_school = thesis_service.get_school_thesis

            async def locked_dispatch(*args, **kwargs):
                if reached.is_set():
                    attempt.set()
                row = await original_dispatch(*args, **kwargs)
                if end == 'reassign' and not reached.is_set():
                    reached.set()
                    await asyncio.wait_for(release.wait(), 10)
                return row

            async def locked_school(*args, **kwargs):
                row = await original_school(*args, **kwargs)
                if kwargs.get('for_update') and end == 'terminate' and not reached.is_set():
                    reached.set()
                    await asyncio.wait_for(release.wait(), 10)
                return row

            with monkeypatch.context() as m:
                m.setattr(dispatch_service, 'lock_task_thesis', locked_dispatch)
                m.setattr(thesis_service, 'get_school_thesis', locked_school)
                terminal = asyncio.create_task(c.post(end_url, headers=header, json=body))
                approval = None
                try:
                    await asyncio.wait_for(reached.wait(), 10)
                    approval = asyncio.create_task(
                        c.post(
                            PL + '/task-extensions/' + eid + ':decide',
                            headers=auth(p),
                            json={'status': 'APPROVED', 'reason': '并发审批'},
                        )
                    )
                    await asyncio.wait_for(attempt.wait(), 10)
                    assert not approval.done()
                finally:
                    release.set()
                    ended = await terminal
                    decided = await approval if approval else None
            assert ended.status_code == 200, ended.text
            assert decided.status_code == 409, decided.text
            for token, where in ((who, path + '/extensions'), (p, PL + '/task-extensions')):
                history = (await c.get(where, headers=auth(token))).json()['data']
                assert (
                    len(history) == 1 and history[0]['status'] == 'PENDING' and not history[0]['actionable']
                )
                assert history[0]['decided_at'] is None


async def test_unconfigured_existing_invitation_never_acquires_a_later_batch_deadline():
    from datetime import timezone

    async with acceptance_environment('empty') as rt:
        async with AsyncClient(transport=ASGITransport(app=rt.app), base_url='http://test') as c:
            p, t, e, s, who, b = await setup(c, rt)
            tid = await task(c, p, t, e)
            assert 'deadline' not in (await rows(c, who))[0]
            assert (await rule(c, s, b, 2, 4)).status_code == 200
            assert (await c.post(EX + '/tasks/' + tid + ':accept', headers=auth(who))).status_code == 200
            assert 'deadline' not in (await rows(c, who))[0]
            denied = await c.post(
                EX + '/tasks/' + tid + '/extensions',
                headers=auth(who),
                json={
                    'requested_due_at': (datetime.now(timezone.utc) + timedelta(days=10)).isoformat(),
                    'reason': '无原期限',
                },
            )
            assert denied.status_code == 409
            assert (await c.get(PL + '/task-extensions', headers=auth(p))).json()['data'] == []
