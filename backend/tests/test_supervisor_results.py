from uuid import UUID, uuid4
from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.core.security import create_access_token
from app.modules.thesis.models import Thesis
from app.modules.user.models import StudentEligibility, TenantUserMembership, User
from tests.helpers import accepted_task, published_thesis, login, auth
from tests.test_review import VALID_DRAFT

LIST = "/api/v1/supervisor/theses/published"


@pytest.mark.asyncio
async def test_only_published_results_are_listed_and_non_supervisor_denied(client, seed):
    expert, student, task_id = await accepted_task(client, seed)
    supervisor = await login(client, "supervisor.zhao")
    school = await login(client, "school.wang")
    thesis = (await client.get("/api/v1/theses", headers=auth(student))).json()["data"][0]
    response = await client.get(LIST, headers=auth(supervisor))
    assert response.status_code == 200
    assert response.json()["data"] == []
    assert (await client.get(LIST, headers=auth(student))).status_code == 403
    assert (await client.get(f"/api/v1/my/theses/{thesis['id']}/published-result", headers=auth(supervisor))).status_code == 404
    final = {**VALID_DRAFT, "recommendation": "不通过"}
    preview = await client.post(f"/api/v1/expert-tasks/{task_id}/review-checks", headers=auth(expert), json={"payload": final})
    assert preview.status_code == 200
    report = preview.json()["data"]
    ack = {key: report[key] for key in ("payload_hash", "rule_version")}
    ack["codes"] = sorted({item["code"] for item in report["findings"]})
    assert (await client.post(f"/api/v1/expert/tasks/{task_id}:submit-final", headers=auth(expert), json={**final, "check_ack": ack})).status_code == 200
    assert (await client.get(LIST, headers=auth(supervisor))).json()["data"] == []
    thesis = (await client.get("/api/v1/theses", headers=auth(student))).json()["data"][0]
    assert (await client.post(f"/api/v1/school-review/theses/{thesis['id']}:publish", headers=auth(school), json={"version": thesis["version"]})).status_code == 200
    rows = (await client.get(LIST, headers=auth(supervisor))).json()["data"]
    assert rows == [{"id": thesis["id"], "title": thesis["current_version"]["title"], "student_name": "林知远"}]
    result = await client.get(f"/api/v1/my/theses/{thesis['id']}/published-result", headers=auth(supervisor))
    assert result.json()["data"]["items"][0]["recommendation"] == "不通过"
    assert "expert_id" not in result.text and "周明远" not in result.text


@pytest.mark.asyncio
@pytest.mark.parametrize("loss", ["inactive", "unrelated"])
async def test_revoked_supervisor_relation_hides_list_and_detail(client, seed, db_session, loss):
    _, _, thesis_id = await published_thesis(client, seed)
    supervisor = await login(client, "supervisor.zhao")
    thesis = await db_session.get(Thesis, UUID(thesis_id))
    eligibility = (await db_session.execute(select(StudentEligibility).where(
        StudentEligibility.student_membership_id == thesis.student_membership_id,
        StudentEligibility.review_batch_id == thesis.review_batch_id,
    ))).scalar_one()
    if loss == "inactive":
        membership = await db_session.get(TenantUserMembership, eligibility.supervisor_membership_id)
        membership.is_active = False
    else:
        eligibility.supervisor_membership_id = None
    # Rejected identity requests roll back their own transaction; keep this setup in the outer test transaction.
    await db_session.commit()
    detail = await client.get(f"/api/v1/my/theses/{thesis_id}/published-result", headers=auth(supervisor))
    listed = await client.get(LIST, headers=auth(supervisor))
    if loss == "inactive":
        assert detail.status_code == 401
        assert detail.json()["code"] == "AUTH_REQUIRED"
        assert listed.status_code == 401
        assert listed.json()["code"] == "AUTH_REQUIRED"
    else:
        assert detail.status_code == 404
        assert listed.status_code == 200 and listed.json()["data"] == []


@pytest.mark.asyncio
async def test_supervisor_authorization_uses_thesis_batch(client, seed, db_session):
    from app.modules.tenant.models import ReviewBatch
    _, _, thesis_id = await published_thesis(client, seed)
    supervisor = await login(client, "supervisor.zhao")
    thesis = await db_session.get(Thesis, UUID(thesis_id))
    existing = (await db_session.execute(select(StudentEligibility).where(
        StudentEligibility.student_membership_id == thesis.student_membership_id
    ))).scalar_one()
    batch = ReviewBatch(id=uuid4(), tenant_id=thesis.tenant_id, code="next-batch", name="下批", status="OPEN")
    db_session.add(batch)
    await db_session.flush()
    db_session.add(StudentEligibility(
        tenant_id=thesis.tenant_id, student_membership_id=thesis.student_membership_id,
        review_batch_id=batch.id, supervisor_membership_id=None,
        student_name=existing.student_name, student_no=existing.student_no,
        source_version="test", source_updated_at=datetime.now(timezone.utc),
    ))
    await db_session.flush()
    detail = await client.get(f"/api/v1/my/theses/{thesis_id}/published-result", headers=auth(supervisor))
    assert detail.status_code == 200
    assert len((await client.get(LIST, headers=auth(supervisor))).json()["data"]) == 1


@pytest.mark.asyncio
async def test_multiple_tenant_memberships_do_not_leak_results(client, seed, db_session):
    _, _, thesis_id = await published_thesis(client, seed)
    supervisor = await login(client, "supervisor.zhao")
    supervisor_id = UUID(supervisor["user"]["id"])
    other = await login(client, "other.student")
    other_membership = (await db_session.execute(select(TenantUserMembership).where(
        TenantUserMembership.user_id == UUID(other["user"]["id"])
    ))).scalar_one()
    db_session.add(TenantUserMembership(
        tenant_id=other_membership.tenant_id, user_id=supervisor_id,
        organization_id=other_membership.organization_id, membership_type="SUPERVISOR",
        external_id="test-other-supervisor", external_source="test", is_active=True,
    ))
    await db_session.flush()
    assert (await client.get(f"/api/v1/my/theses/{thesis_id}/published-result", headers=auth(supervisor))).status_code == 200
    supervisor_user = await db_session.get(User, supervisor_id)
    token = create_access_token(user_id=supervisor_id, role="supervisor", tenant_id=other_membership.tenant_id, auth_version=supervisor_user.auth_version, data_scope={})
    headers = auth({"access_token": token})
    detail = await client.get(f"/api/v1/my/theses/{thesis_id}/published-result", headers=headers)
    listed = await client.get(LIST, headers=headers)
    assert detail.status_code == 401 and detail.json()["code"] == "AUTH_REQUIRED"
    assert listed.status_code == 401 and listed.json()["code"] == "AUTH_REQUIRED"
