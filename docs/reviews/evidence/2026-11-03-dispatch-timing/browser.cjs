const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { password,expert } = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
const base='http://127.0.0.1:15237';
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true}), errors=[];
  async function login(name){
    const p=await browser.newPage({viewport:{width:1800,height:1280},reducedMotion:'reduce'});
    p.setDefaultTimeout(12000);p.on('pageerror', e=>errors.push(e.message));
    await p.goto(base+'/login');await p.locator('[autocomplete=username]').fill(name);
    await p.locator('[type=password]').fill(password);await p.locator('button[type=submit]').click();
    await p.waitForURL(url=>!url.pathname.startsWith('/login')); return p;
  }
  try {
    const school=await login('school.wang'),p=await login('platform.chen'),who=await login('expert.zhou')
    const evidence='docs/reviews/evidence/2026-11-03-dispatch-timing/'
    await school.goto(base+'/school/batch-rules')
    await school.getByRole('button',{name:'设置期限'}).first().click()
    const form=school.locator('[data-batch-deadlines]')
    await form.getByLabel('接单自然日数').fill('2');await form.getByLabel('评阅自然日数').fill('5')
    await form.screenshot({animations:'disabled',path:evidence+'01-batch.png'})
    const saved=school.waitForResponse(r=>r.url().endsWith('/deadlines')&&r.request().method()==='PUT')
    await form.getByText('保存期限').click();assert.equal((await saved).status(),200)
    await p.goto(base+'/platform/dispatch')
    const row=p.locator('[data-expert-id="'+expert+'"]'), load=row.locator('[data-column-cell=workload]')
    await load.waitFor();assert.match(await load.innerText(),/待接单 0 · 评阅中 0 · 合计 0/)
    await row.locator('input').check();await p.locator('[data-action=assign-experts]').click()
    const assigned=p.waitForResponse(r=>r.url().endsWith(':assign')&&r.request().method()==='POST')
    await p.locator('[data-action=confirm-assign]').click();assert.equal((await assigned).status(),200)
    await who.goto(base+'/expert/tasks')
    const task=who.locator('[data-expert-task]').first();await task.waitFor()
    assert.match(await task.locator('[data-column-cell=acceptBy]').innerText(),/20[0-9]{2}/)
    await task.locator('[data-action=accept-task]').click();await who.locator('[data-action=confirm-accept-task]').click()
    await who.waitForURL(u=>u.pathname==='/expert/review');await who.locator('[data-review-deadline]').waitFor()
    await who.goto(base+'/expert/tasks');await who.getByRole('button',{name:'评阅延期',exact:true}).click()
    const panel=who.locator('[data-extension-panel]'), target=new Date(Date.now()+12*86400e3).toISOString().slice(0,16)
    await panel.getByLabel('申请截止（北京时间）').fill(target);await panel.getByLabel('延期理由').fill('虚构验收：申请延长评阅')
    await panel.getByText('提交延期申请').click();await panel.locator('[data-extension-status=PENDING]').waitFor()
    await p.reload();await p.locator('[data-toggle-unavailable]').click();await load.waitFor()
    assert.match(await load.innerText(),/待接单 0 · 评阅中 1 · 合计 1/)
    assert.equal(await row.locator('[data-column-cell=conflict]').innerText(),'不可派 · 当前任务专家');
    await p.locator('.candidate-table').scrollIntoViewIfNeeded(); await p.locator('.candidate-table').screenshot({animations:'disabled',path:evidence+'02-load.png'})
    await p.getByRole('button',{name:'评阅延期审批',exact:true}).click()
    const review=p.locator('[data-extension-panel]');await review.getByLabel('审批理由').fill('虚构验收：批准本次延期')
    await review.getByRole('button',{name:'批准延期'}).click()
    await review.locator('[data-extension-status=APPROVED]').waitFor()
    await review.screenshot({animations:'disabled',path:evidence+'03-approved.png'})
    await panel.getByText('刷新记录').click();await panel.locator('[data-extension-status=APPROVED]').waitFor()
    assert.equal(await panel.getByText('提交延期申请').count(),0)
    await who.reload();const finalDue=await who.locator('[data-expert-task] [data-column-cell=dueAt]').innerText()
    await school.goto(base+'/school/progress');await school.getByText('评阅截止：',{exact:false}).first().waitFor()
    const progress=await school.locator('main').innerText()
    await school.locator('.task-aliases').scrollIntoViewIfNeeded(); await school.locator('.task-aliases').screenshot({animations:'disabled',path:evidence+'04-school.png'});assert(progress.includes(finalDue));assert(!progress.includes('批准本次延期')&&!progress.includes('申请延长评阅'))
    assert.deepEqual(errors,[])
    console.log('PASS Chrome: batch 2/5 → dispatch (0/0) → accept (0/1) → request → approve once → school anonymous and expert effective deadlines agree; no page errors')
  } finally {await browser.close()}
})().catch(e=>{console.error(e.message);process.exitCode=1});
