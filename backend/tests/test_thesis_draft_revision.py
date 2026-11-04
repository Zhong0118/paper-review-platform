"""Public API contracts against independent requests with real, restricted DB logins."""
from asyncio import gather
from httpx import AsyncClient, ASGITransport
from scripts.acceptance_server import acceptance_environment
from tests.helpers import login, auth, create_draft, attach_files


async def test_conditional_draft_edits_and_submit():
    async with acceptance_environment("empty") as rt, AsyncClient(transport=ASGITransport(app=rt.app), base_url="http://test") as c:
        actor = await login(c, "student.lin", rt.seed_password)
        headers = auth(actor)
        draft = await create_draft(c, actor)
        url = "/api/v1/theses/" + draft["id"]
        def rev(detail):
            return detail["current_version"]["content_revision"]
        def body(detail, title):
            v = detail["current_version"]
            return {**{k:v[k] for k in ("abstract","discipline_code","discipline_name","keywords")},
                    "title":title, "expected_content_revision":rev(detail)}
        a,b = await gather(*(c.patch(url,headers=headers,json=body(draft,t)) for t in ("甲方编辑","乙方编辑")))
        assert sorted([a.status_code,b.status_code]) == [200,409]
        winner,loser = (a,b) if a.is_success else (b,a)
        after = (await c.get(url,headers=headers)).json()["data"]
        assert after["current_version"]["title"] == winner.json()["data"]["current_version"]["title"]
        assert loser.json()["code"] == "VERSION_CONFLICT"
        assert rev(after) != rev(draft) and after["version"] == draft["version"]
        old = body(after,"旧页签"); del old["expected_content_revision"]
        assert (await c.patch(url,headers=headers,json=old)).status_code==422
        await attach_files(c,actor,draft["id"])
        assert (await c.patch(url,headers=headers,json=body(after,"滞后文件"))).status_code==409
        cmd = {"version":draft["version"],"expected_content_revision":rev(after)}
        assert (await c.post(url+":submit",headers=auth(actor,"stale-submit"),json=cmd)).status_code==409
        fresh=(await c.get(url,headers=headers)).json()["data"]
        cmd["expected_content_revision"]=rev(fresh)
        missing=await c.post(url+":submit",headers=headers,json={"version":draft["version"]})
        assert missing.status_code==422
        sent=await c.post(url+":submit",headers=auth(actor,"fresh-submit"),json=cmd)
        assert sent.status_code==200
        back=await c.post(url+":withdraw",headers=headers,json={"version":sent.json()["data"]["version"],"reason":"复核"})
        assert back.status_code==200
        assert rev(back.json()["data"])!=rev(fresh)
        assert (await c.patch(url,headers=headers,json=body(fresh,"旧材料版本"))).status_code==409


async def test_attachment_rejected_before_allocating_upload():
    async with acceptance_environment("empty") as rt, AsyncClient(transport=ASGITransport(app=rt.app), base_url="http://test") as c:
        actor=await login(c,"student.lin",rt.seed_password)
        draft=await create_draft(c,actor)
        r=await c.post("/api/v1/files:prepare-upload",headers=auth(actor),json={
            "thesis_id":draft["id"],"purpose":"attachment","filename":"虚构附件.pdf"})
        assert r.status_code==422
        assert r.json()["code"]=="VALIDATION_FAILED" and "file_id" not in r.json()["data"]


async def test_late_complete_never_acknowledges_other_edits_or_rebinds_material():
    from tests.pdf_samples import pdf_bytes
    async with acceptance_environment("empty") as rt, AsyncClient(transport=ASGITransport(app=rt.app),base_url="http://test") as c:
        actor=await login(c,"student.lin",rt.seed_password)
        headers=auth(actor)
        draft=await create_draft(c,actor)
        url="/api/v1/theses/"+draft["id"]
        base=draft["current_version"]["content_revision"]
        r=await c.post("/api/v1/files:prepare-upload",headers=headers,json={
            "thesis_id":draft["id"],"purpose":"anonymous","filename":"sample.pdf"})
        prepared=r.json()["data"]
        assert (await c.put(prepared["upload_url"],headers=headers,content=pdf_bytes())).status_code==200
        finish=f"/api/v1/files/{prepared['file_id']}:complete"
        acknowledged=await c.post(finish,headers={**headers,"If-Draft-Revision":base})
        assert acknowledged.status_code==200
        v=draft["current_version"]
        data={**{k:v[k] for k in ("title","keywords","discipline_name","discipline_code","abstract")},
              "title":"已经修改","expected_content_revision":acknowledged.json()["data"]["content_revision"]}
        assert (await c.patch(url,headers=headers,json=data)).status_code==200
        assert (await c.post(finish,headers={**headers,"If-Draft-Revision":base})).status_code==409
        detail=(await c.get(url,headers=headers)).json()["data"]["current_version"]
        assert detail["title"]=="已经修改" and [f["file_id"] for f in detail["files"]]==[prepared["file_id"]]


async def test_concurrent_create_matches_the_winning_thesis_and_submit_races_patch():
    async with acceptance_environment("empty") as rt, AsyncClient(transport=ASGITransport(app=rt.app),base_url="http://test") as c:
        h=auth(await login(c,"student.lin",rt.seed_password))
        data=dict(title="同批并发建稿",abstract="实验",keywords=["实验"],discipline_code="0812",discipline_name="计算机科学与技术")
        replies=await gather(*(c.post("/api/v1/theses",headers=h,json=data) for _ in range(2)))
        assert sorted(r.status_code for r in replies)==[200,409]
        win=next(r.json()["data"] for r in replies if r.is_success)
        assert next(r.json()["data"]["id"] for r in replies if not r.is_success)==win["id"]
        actor=await login(c,"student.lin",rt.seed_password)
        await attach_files(c,actor,win["id"])
        url="/api/v1/theses/"+win["id"]
        def command(d):return dict(version=d["version"], expected_content_revision=d["current_version"]["content_revision"])
        draft=(await c.get(url,headers=h)).json()["data"]
        cmd=command(draft)
        patch,submit=await gather(c.patch(url,headers=h,json={**data,"title":"并发修改","expected_content_revision":cmd["expected_content_revision"]}),
                                  c.post(url+":submit",headers=h,json=cmd))
        assert sorted([patch.status_code,submit.status_code])==[200,409]
        if patch.is_success:
            submit=await c.post(url+":submit",headers=h,json=command(patch.json()["data"]))
        assert submit.status_code==200
        row=submit.json()["data"]
        assert row["current_version"]["title"]==("并发修改" if patch.is_success else "同批并发建稿")
        assert sum(e["action"]=="submit" for e in row["recent_events"])==1


async def test_binding_commands_require_observed_content_revision():
    """Neither a direct upload nor an applied PDF may bind over newer metadata."""
    from tests.pdf_samples import pdf_bytes
    async with acceptance_environment("empty") as rt, AsyncClient(transport=ASGITransport(app=rt.app),base_url="http://test") as c:
        actor = await login(c, "student.lin", rt.seed_password)
        h = auth(actor)
        draft = await create_draft(c, actor)
        path = "/api/v1/theses/" + draft["id"]
        base = draft["current_version"]["content_revision"]

        prepared = (await c.post("/api/v1/files:prepare-upload", headers=h, json={
            "thesis_id":draft["id"], "purpose":"anonymous", "filename":"sample.pdf"})).json()["data"]
        assert (await c.put(prepared["upload_url"], headers=h, content=pdf_bytes())).is_success
        finish = f"/api/v1/files/{prepared['file_id']}:complete"
        for extra in ({}, {"If-Draft-Revision":"invalid"}):
            assert (await c.post(finish,headers={**h,**extra})).status_code == 422
        assert (await c.get(path,headers=h)).json()["data"]["current_version"]["files"] == []
        uploaded = await c.post(finish, headers={**h, "If-Draft-Revision":base})
        assert uploaded.status_code == 200
        before = uploaded.json()["data"]["content_revision"]
        source = prepared["file_id"]
        generated = await c.post(path+"/pdf-transforms",headers=h,json={
            "expected_version":1,"purpose":"anonymous","operation":"EXTRACT","sources":[{"file_id":source,"pages":[1]}]})
        assert generated.status_code == 200
        op = generated.json()["data"]
        apply = f"/api/v1/pdf-transforms/{op['operation_id']}:apply"
        version = {"expected_version":1}
        for extra in ({}, {"If-Draft-Revision":"invalid"}):
            assert (await c.post(apply,headers={**h,**extra},json=version)).status_code == 422
        async def edit(revision, title):
            data = {k:draft["current_version"][k] for k in ("abstract","discipline_code","discipline_name","keywords")}
            r = await c.patch(path,headers=h,json={**data,"title":title,"expected_content_revision":revision})
            assert r.status_code == 200
            return r.json()["data"]["current_version"]["content_revision"]
        current = await edit(before, "另一窗口修改")
        stale = await c.post(apply, headers={**h,"If-Draft-Revision":before},json=version)
        assert stale.status_code == 409 and stale.json()["code"] == "VERSION_CONFLICT"
        assert (await c.get(path,headers=h)).json()["data"]["current_version"]["files"][0]["file_id"] == source
        ok = await c.post(apply,headers={**h,"If-Draft-Revision":current},json=version)
        assert ok.status_code == 200 and ok.json()["data"]["status"] == "APPLIED"
        after = (await c.get(path,headers=h)).json()["data"]["current_version"]
        assert after["files"][0]["file_id"] == op["new_file_id"]
        assert after["content_revision"] == ok.json()["data"]["content_revision"]
        await edit(after["content_revision"], "应用之后又有新修改")
        late = await c.post(apply,headers={**h,"If-Draft-Revision":current},json=version)
        assert late.status_code == 409 and late.json()["code"] == "VERSION_CONFLICT"
        assert (await c.get(path,headers=h)).json()["data"]["current_version"]["title"] == "应用之后又有新修改"


async def test_preview_cannot_be_applied_after_other_purpose_is_rebound():
    from tests.test_file_lifecycle import pending
    async with acceptance_environment("empty") as rt, AsyncClient(transport=ASGITransport(app=rt.app),base_url="http://test") as c:
        actor = await login(c, "student.lin", rt.seed_password)
        h = auth(actor)
        draft = await create_draft(c, actor)
        path = "/api/v1/theses/" + draft["id"]
        await attach_files(c, actor, draft["id"])
        v = (await c.get(path,headers=h)).json()["data"]["current_version"]
        before = {**h,"If-Draft-Revision":v["content_revision"]}
        original = next(f["file_id"] for f in v["files"] if f["purpose"]=="original")
        product = await c.post(path+"/pdf-transforms",headers=h,json={
            "purpose":"original","operation":"EXTRACT","expected_version":1,"sources":[{"file_id":original,"pages":[1]}]})
        assert product.status_code == 200
        newer = await pending(c,actor,draft["id"])
        assert (await c.post(f"/api/v1/files/{newer}:complete",headers=before)).status_code == 200
        apply = "/api/v1/pdf-transforms/"+product.json()["data"]["operation_id"]+":apply"
        rejected = await c.post(apply,headers=before,json={"expected_version":1})
        assert rejected.status_code == 409 and rejected.json()["code"] == "VERSION_CONFLICT"
        files = (await c.get(path,headers=h)).json()["data"]["current_version"]["files"]
        assert {f["purpose"]:f["file_id"] for f in files} == {"original":original,"anonymous":newer}


async def test_two_pending_bindings_cannot_both_claim_the_same_draft_revision():
    from tests.test_file_lifecycle import pending
    async with acceptance_environment("empty") as rt, AsyncClient(transport=ASGITransport(app=rt.app),base_url="http://test") as c:
        actor = await login(c,"student.lin",rt.seed_password)
        h = auth(actor)
        draft = await create_draft(c,actor)
        path = "/api/v1/theses/"+draft["id"]
        ids = [await pending(c,actor,draft["id"]) for _ in range(2)]
        async def bind(file,revision):
            return await c.post(f"/api/v1/files/{file}:complete",headers={**h,"If-Draft-Revision":revision})
        old = draft["current_version"]["content_revision"]
        replies = await gather(*(bind(file,old) for file in ids))
        assert sorted(r.status_code for r in replies) == [200,409]
        i = next(i for i,r in enumerate(replies) if r.is_success)
        next_rev = replies[i].json()["data"]["content_revision"]
        assert (await c.get(path,headers=h)).json()["data"]["current_version"]["files"][0]["file_id"] == ids[i]
        # The failed pending file can bind only after explicitly adopting the winning version.
        replacement = await bind(ids[1-i],next_rev)
        assert replacement.status_code == 200
        late = await bind(ids[i],old)
        assert late.status_code == 409 and late.json()["code"] == "VERSION_CONFLICT"
        state = (await c.get(path,headers=h)).json()["data"]["current_version"]
        assert (state["content_revision"],state["files"][0]["file_id"]) == (replacement.json()["data"]["content_revision"],ids[1-i])
