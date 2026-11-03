from tests.helpers import auth, create_draft, login


async def test_closeout_scopes_work_to_requested_school_batch(client, seed):
    student = await login(client, "student.lin", seed.password)
    other = await login(client, "other.student", seed.password)
    school = await login(client, "school.wang", seed.password)
    mine = await create_draft(client, student)
    foreign = await create_draft(client, other)
    def url(draft):
        return f"/api/v1/school-admin/batches/{draft['review_batch']['id']}/closeout"
    response = await client.get(url(mine), headers=auth(school))
    assert response.status_code == 200
    groups = response.json()["data"]
    assert [r["thesis_id"] for r in groups["unpublished"]] == [mine["id"]]
    assert groups["objections"] == groups["corrections"] == []
    assert (await client.get(url(foreign), headers=auth(school))).status_code == 404
    assert (await client.get(url(mine), headers=auth(student))).status_code == 403

    pdf_url = f"/api/v1/school-review/theses/{foreign['id']}/published-review.pdf"
    assert (await client.get(pdf_url, headers=auth(school))).status_code == 404
    stopped = await client.post(f"/api/v1/school-review/theses/{mine['id']}:terminate",
                                headers=auth(school, "closeout-terminate"),
                                json={"version":mine["version"], "reason":"虚构批次终止"})
    assert stopped.status_code == 200
    assert (await client.get(url(mine), headers=auth(school))).json()["data"]["unpublished"] == []
