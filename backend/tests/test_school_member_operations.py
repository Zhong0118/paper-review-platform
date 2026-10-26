import pytest
from sqlalchemy import func, select

from app.modules.user.models import StudentEligibility, TenantUserMembership, User

from tests.helpers import auth, login


@pytest.mark.asyncio
@pytest.mark.parametrize("username", [123, None, [], {}])
async def test_school_member_invalid_username_is_422_without_writes(client, db_session, username):
    school = await login(client, "school.wang")
    before_users = await db_session.scalar(select(func.count()).select_from(User))
    before_members = await db_session.scalar(select(func.count()).select_from(TenantUserMembership))
    response = await client.post(
        "/api/v1/school-admin/members", headers=auth(school, "invalid-username"),
        json={
            "membership_type": "STUDENT", "username": username,
            "display_name": "非法用户名", "external_id": "invalid-username",
            "password": "new-student-pass",
        },
    )
    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_FAILED"
    assert await db_session.scalar(select(func.count()).select_from(User)) == before_users
    assert await db_session.scalar(select(func.count()).select_from(TenantUserMembership)) == before_members


@pytest.mark.asyncio
async def test_school_reviewer_creates_and_updates_student_member(client):
    school = await login(client, "school.wang")
    payload = {"membership_type": "STUDENT", "username": "student.new", "display_name": "新学生", "external_id": "2027-01", "password": "new-student-pass"}
    created = await client.post("/api/v1/school-admin/members", headers=auth(school, "create-student-new"), json=payload)
    assert created.status_code == 200, created.text
    member = created.json()["data"]
    assert member["membership_type"] == "STUDENT" and member["username"] == "student.new"
    assert "password" not in created.text
    logged_in = await login(client, "student.new", "new-student-pass")
    assert logged_in["user"]["role"] == "student"
    listed = await client.get("/api/v1/school-admin/members?membership_type=STUDENT", headers=auth(school))
    assert any(row["membership_id"] == member["membership_id"] for row in listed.json()["data"])
    edited = await client.patch(
        f"/api/v1/school-admin/members/{member['membership_id']}", headers=auth(school),
        json={"display_name": "新名字", "contact_email": "new@example.org", "expected_updated_at": member["updated_at"]},
    )
    assert edited.status_code == 200, edited.text
    stale = await client.patch(
        f"/api/v1/school-admin/members/{member['membership_id']}", headers=auth(school),
        json={"display_name": "旧写入", "expected_updated_at": member["updated_at"]},
    )
    assert stale.status_code == 409 and stale.json()["code"] == "VERSION_CONFLICT"


@pytest.mark.asyncio
async def test_member_input_rejects_role_tenant_and_foreign_member_is_hidden(client):
    school = await login(client, "school.wang")
    payload = {"membership_type": "STUDENT", "username": "student.bad", "display_name": "坏输入", "external_id": "bad-1", "password": "new-student-pass"}
    for field in ("role", "tenant_id"):
        response = await client.post("/api/v1/school-admin/members", headers=auth(school, "bad-" + field), json={**payload, field: "system_admin"})
        assert response.status_code == 422
    other = await login(client, "other.student")
    other_school = await client.get("/api/v1/school-admin/members", headers=auth(other))
    assert other_school.status_code == 403


@pytest.mark.asyncio
async def test_foreign_member_commands_are_hidden_and_snapshot_does_not_drift(client, db_session):
    school = await login(client, "school.wang")
    foreign_user = (await db_session.execute(select(User).where(User.username == "other.student"))).scalar_one()
    foreign_member = (await db_session.execute(select(TenantUserMembership).where(
        TenantUserMembership.user_id == foreign_user.id,
    ))).scalar_one()
    foreign_id = str(foreign_member.id)
    for method, suffix, body in (
        ("patch", "", {"display_name": "越权", "expected_updated_at": foreign_member.updated_at.isoformat()}),
        ("post", ":disable", None),
        ("post", ":enable", None),
        ("post", ":reset-password", {"password": "replacement-pass-1"}),
    ):
        response = await getattr(client, method)(
            f"/api/v1/school-admin/members/{foreign_id}{suffix}",
            headers=auth(school, f"foreign{suffix}"), json=body,
        )
        assert response.status_code == 404

    members = (await client.get(
        "/api/v1/school-admin/members?membership_type=STUDENT", headers=auth(school),
    )).json()["data"]
    student = next(row for row in members if row["username"] == "student.lin")
    before = (await db_session.execute(select(StudentEligibility).where(
        StudentEligibility.student_membership_id == student["membership_id"],
    ))).scalar_one()
    original_name = before.student_name
    changed = await client.patch(
        f"/api/v1/school-admin/members/{student['membership_id']}", headers=auth(school),
        json={"display_name": "更名后学生", "expected_updated_at": student["updated_at"]},
    )
    assert changed.status_code == 200, changed.text
    await db_session.refresh(before)
    assert before.student_name == original_name


@pytest.mark.asyncio
async def test_disable_and_reset_member_revoke_old_credentials(client):
    school = await login(client, "school.wang")
    created = await client.post(
        "/api/v1/school-admin/members", headers=auth(school, "create-student-state"),
        json={"membership_type": "STUDENT", "username": "student.state", "display_name": "状态学生", "external_id": "state-1", "password": "original-pass-1"},
    )
    assert created.status_code == 200
    member_id = created.json()["data"]["membership_id"]
    student = await login(client, "student.state", "original-pass-1")
    disabled = await client.post(f"/api/v1/school-admin/members/{member_id}:disable", headers=auth(school, "disable-state"))
    assert disabled.status_code == 200
    assert (await client.get("/api/v1/me", headers=auth(student))).status_code == 401
    assert (await client.post("/api/v1/auth/refresh", json={"refresh_token": student["refresh_token"]})).status_code == 401
    enabled = await client.post(f"/api/v1/school-admin/members/{member_id}:enable", headers=auth(school, "enable-state"))
    assert enabled.status_code == 200
    reset = await client.post(f"/api/v1/school-admin/members/{member_id}:reset-password", headers=auth(school, "reset-state"), json={"password": "replacement-pass-1"})
    assert reset.status_code == 200
    assert "replacement-pass-1" not in reset.text
    assert (await client.post("/api/v1/auth/login", json={"username": "student.state", "password": "original-pass-1"})).status_code == 401
    assert (await login(client, "student.state", "replacement-pass-1"))["user"]["role"] == "student"
