const {createRequire}=require('node:module');
const {chromium}=createRequire('/Users/zhongxu/.npm/_npx/9833c18b2d85bc59/package.json')('playwright');
const fs=require('node:fs/promises'), assert=require('node:assert/strict');
const root='/Users/zhongxu/Desktop/0-Inbox/paper-review-platform';
const scratch=root+'/.superpowers/sdd/2026-10-29-post-commit-acceptance';
const evidence=root+'/docs/reviews/evidence/2026-10-29-post-commit/columns';
let step='launch', browser, page;
const results=[];
(async()=>{
  const ctx=JSON.parse(await fs.readFile(scratch+'/browser-context.json','utf8'));
  const password=await fs.readFile(scratch+'/browser-password','utf8');
  await fs.mkdir(evidence,{recursive:true});
  browser=await chromium.launch({channel:'chrome',headless:true});
  page=await browser.newPage({viewport:{width:1440,height:1050}});
  page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  async function login(name,path){
    step=name+':login';await page.goto('http://127.0.0.1:5177/login');
    await page.evaluate(()=>sessionStorage.clear());await page.reload();
    await page.getByLabel('账号',{exact:true}).fill(name);await page.getByLabel('密码',{exact:true}).fill(password);
    await page.getByRole('button',{name:'登录',exact:true}).click();await page.waitForURL(u=>!u.pathname.includes('login'));
    await page.goto('http://127.0.0.1:5177'+path);
  }
  async function shot(name,locator=page){await locator.screenshot({animations:'disabled',path:evidence+'/'+name+'.png'});}
  async function count(key,value){await page.waitForFunction(({key,value})=>document.querySelector(`[data-dashboard-card="${key}"] strong`)?.textContent===String(value),{key,value});}
  async function columnCase(name,scrollSelector,afterReload=async()=>{}){
    step=name+':columns';await page.locator('[data-column-cell="discipline"]').first().waitFor();
    await page.locator('[data-column-settings]').click();
    const initial=await page.locator('[data-column-header]').evaluateAll(els=>els.map(x=>x.dataset.columnHeader));
    await page.locator('[data-column-toggle="discipline"]').uncheck();
    await page.waitForFunction(()=>!document.querySelector('[data-column-header="discipline"]'));
    assert.equal(await page.locator('[data-column-cell="discipline"]').count(),0);
    const id=initial[initial.length-2], target=initial[0];
    await page.locator('.column-panel').scrollIntoViewIfNeeded();
    await page.locator('.column-panel').evaluate(async el=>{await Promise.all(el.getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{})))});
    const from=await page.locator(`[data-column-drag="${id}"]`).boundingBox(), to=await page.locator(`[data-column-option="${target}"]`).boundingBox();
    await page.mouse.move(from.x+2,from.y+from.height/2);await page.mouse.down();
    await page.mouse.move(from.x+12,from.y+from.height/2,{steps:4});
    await page.mouse.move(to.x+25,to.y+to.height/2,{steps:12});await page.mouse.up();
    await page.waitForFunction(id=>document.querySelector('[data-column-header]')?.getAttribute('data-column-header')===id,id);
    await page.locator(`[data-column-option="${id}"]`).press('ArrowDown');
    assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('data-column-option')),id);
    const order=await page.locator('[data-column-header]').evaluateAll(els=>els.map(x=>x.dataset.columnHeader));
    assert.equal(order.at(-1),'actions');
    await shot(name+'-settings',page.locator('.column-preferences'));
    await page.locator(`[data-column-option="${id}"]`).press('Escape');
    assert(await page.evaluate(()=>document.activeElement?.hasAttribute('data-column-settings')));
    await page.reload();await afterReload();await page.locator('[data-column-header]').first().waitFor();
    assert.deepEqual(await page.locator('[data-column-header]').evaluateAll(els=>els.map(x=>x.dataset.columnHeader)),order);
    const saved=await page.evaluate(()=>Object.entries(localStorage).filter(([k])=>k.startsWith('columns:v1:')).map(([k,v])=>({key:k,data:JSON.parse(v)})));
    assert(saved.length>0);for(const item of saved)assert.deepEqual(Object.keys(item.data).sort(),['order','schemaVersion','visibleIds']);
    await page.locator('[data-column-settings]').click();await page.locator('[data-reset-columns]').click();
    await page.waitForFunction(()=>!!document.querySelector('[data-column-header="discipline"]'));
    await page.locator('[data-column-panel]').press('Escape');
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert(await page.locator(scrollSelector).evaluate(el=>el.scrollWidth>el.clientWidth));
    await page.locator(scrollSelector).evaluate(el=>el.scrollLeft=el.scrollWidth);
    await page.locator(scrollSelector).scrollIntoViewIfNeeded();
    await shot(name+'-mobile');
    assert(await page.locator('[data-column-header="actions"]').isVisible());
    await page.setViewportSize({width:1440,height:1050});
    results.push({scenario:name+': real table hide/drag/keyboard/focus/refresh/reset/mobile scroll',status:'PASS'});
  }
  await login('school.wang','/school/preparation');
  await columnCase('school','.school-table-wrap');
  await login('expert.zhou','/expert/tasks');
  await columnCase('expert','.task-table');
  assert.equal(await page.locator('[data-column-header="fee"]').count(),0);
  await login('platform.chen','/platform/dispatch');
  async function chooseCandidate(){await page.locator('[data-thesis-id="'+ctx.ranking_thesis_id+'"]').click();await page.locator('[data-expert-id]').first().waitFor();}
  await chooseCandidate();
  await columnCase('candidate','.candidate-table-wrap',chooseCandidate);
  assert.deepEqual(errors,[]);
  await fs.writeFile(evidence+'/browser-results.json',JSON.stringify({browser:await browser.version(),results,page_errors:errors},null,2));
  console.log(JSON.stringify({status:'PASS',scenarios:results.length}));
})().catch(async e=>{console.error('FAILED',step,e.message);if(page)await page.screenshot({path:scratch+'/columns-failure.png'}).catch(()=>{});process.exitCode=1;}).finally(async()=>{if(browser)await browser.close()});
