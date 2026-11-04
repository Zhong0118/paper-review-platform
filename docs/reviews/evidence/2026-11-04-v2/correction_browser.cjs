const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { task, thesis, request, password, pdf } = JSON.parse(require('node:fs').readFileSync(0,'utf8'));
const base = 'http://127.0.0.1:15249';
const proof = process.env.CORRECTION_QA_DIR;
const local = '请补充样本规模的对照表';
(async () => {
  const browser = await chromium.launch({channel:'chrome',headless:true});
  const errors = [];
  async function login(name) {
    const p = await browser.newPage({viewport:{width:1360,height:950}});
    p.setDefaultTimeout(12000);
    p.on('pageerror',e => errors.push(e.message));
    await p.goto(base+'/login');
    await p.locator('[autocomplete=username]').fill(name);
    await p.locator('[type=password]').fill(password);
    await p.locator('button[type=submit]').click();
    await p.waitForURL(u => !u.pathname.startsWith('/login'));
    return p;
  }
  try {
    const ex = await login('expert.zhou');
    await ex.goto(base+'/expert/review?task_id='+task);
    const panel = ex.locator('.correction-panel'), save = panel.locator('[data-action=save-review-draft]');
    const field = name => panel.locator('[name="'+name+'"]');
    const localValues = {revisionAdvice:local,topicValue:'13','evaluations.topicValue':'私有分项',
      strengths:'私有优点',mainIssues: '现有实验仍缺少不同样本规模的对照分析，建议补充并说明局限性。',
      overallComment:'本文研究问题明确，采用的方法基本适当，实验结果能够支持主要结论。建议作者进一步补充数据来源说明，并详细讨论研究结论的适用条件。'};
    for (const [name,val] of Object.entries(localValues)) await field(name).fill(val);
    async function retained() {for (const [name,val] of Object.entries(localValues)) assert.equal(await field(name).inputValue(),val)}
    const draftUrl = '**/expert-corrections/'+request+'/draft';
    await ex.route(draftUrl,route=>route.fulfill({status:500,contentType:'application/json',
      body:JSON.stringify({code:'TEST_FAILURE',message:'注入保存失败'})}),{times:1});
    await save.click(); await panel.locator('[role=alert] button').waitFor(); await retained();
    const resp = await ex.evaluate(async ({task,request})=>{
      const headers={Authorization:'Bearer '+sessionStorage.getItem('pr.access_token'),'Content-Type':'application/json'};
      const ctx=(await(await fetch('/api/v1/expert-tasks/'+task+'/corrections',{headers})).json()).data;
      const r=await fetch('/api/v1/expert-corrections/'+request+'/draft',{headers:{...headers,'Idempotency-Key':crypto.randomUUID()},
        method:'PUT',body:JSON.stringify({version:ctx.requests[0].version,payload:{...ctx.current_payload,revisionAdvice:'另一窗口的新建议'}})});
      return r.status;
    },{task,request});
    assert.equal(resp,200);
    const conflict = ex.waitForResponse(r=>r.url().endsWith('/'+request+'/draft') && r.status()===409);
    await save.click(); await conflict;
    await panel.getByText(/服务器：另一窗口的新建议/).waitFor(); await retained();
    if (proof) await panel.locator('[aria-label="更正草稿版本对照"]').screenshot({path:proof+'/correction-compare.png'});
    await panel.locator('[data-action=keep-local-correction]').click();
    await save.click(); await panel.getByText('更正草稿已保存',{exact:true}).waitFor(); await retained();
    console.log('Chrome: injected 500 and real stale 409 retained six inputs; compared version 3; deliberate retry saved.');
    await panel.locator('[data-action=check-comments]').click(); await panel.locator('[data-check-coverage]').waitFor();
    for (const cb of await panel.locator('[data-check-code]').all()) await cb.check();
    await panel.locator('[data-action=submit-final-review]').click();
    await panel.getByRole('button',{name:'确认操作'}).click();
    await panel.getByText('待学校确认',{exact:true}).last().waitFor();
    const school = await login('school.wang'), student = await login('student.lin'), supervisor = await login('supervisor.zhao');
    const studentURL=base+'/student/results?thesisId='+thesis;
    await student.goto(studentURL); await student.locator('[data-result-row]').getByText(/补充对照/).waitFor();
    await school.goto(base+'/school/results?thesis='+thesis+'&correction='+request);
    await school.locator('.correction-panel [data-correction-reason]').fill('虚构学校核对理由');
    await school.locator('.correction-panel').getByRole('button',{name:/确认更正/}).click();
    await school.locator('.correction-panel').getByRole('button',{name:'确认操作'}).click();
    await school.locator('[data-result-row]').getByText(new RegExp(local)).waitFor();
    for (const [p,url] of [[student,studentURL],[supervisor,base+'/supervisor/results']]) {
      await p.goto(url); await p.locator('[data-result-row]').getByText(new RegExp(local)).waitFor();
      assert(!/私有优点|私有分项|虚构的私有申请理由|虚构学校核对理由/.test(await p.locator('body').innerText()));
    }
    if (proof) await student.locator('[data-result-row]').screenshot({path:proof+'/student-publication.png'});
    const download=school.waitForEvent('download');
    await school.locator('[data-export-pdf]').click(); await (await download).saveAs(pdf);
    console.log('Chrome: pending student saw original; confirmation immediately updated school/student/supervisor; PDF downloaded.');
    assert.deepEqual(errors,[]);
  } finally {await browser.close()}
})().catch(e=>{console.error(e.message);process.exitCode=1});
