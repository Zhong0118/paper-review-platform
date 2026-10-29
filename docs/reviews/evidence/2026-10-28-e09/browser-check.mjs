import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
const require = createRequire('/Users/zhongxu/.npm/_npx/9833c18b2d85bc59/package.json');
const {chromium} = require('playwright');
// Run from the repository root after starting the self-owned acceptance server.
const scratch=path.resolve('.superpowers/sdd/2026-10-12-e09-expert-profile-import');
const evidence=path.resolve(scratch,'../../../docs/reviews/evidence/2026-10-28-e09');
await mkdir(evidence,{recursive:true});
const password=(await readFile(path.join(scratch,'browser-password'),'utf8')).trim();
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1100},reducedMotion:'reduce'});
const page=await context.newPage(); const cases=[], errors=[]; let sourceRequests=0;
context.on('request',r=>{if(r.url().startsWith('https://example.edu.cn/'))sourceRequests++});
page.on('pageerror',e=>errors.push(e.message));
async function login(p,user){
 await p.goto('http://127.0.0.1:5177/login');
 await p.getByLabel('账号',{exact:true}).fill(user);
 await p.getByLabel('密码',{exact:true}).fill(password);
 await p.getByRole('button',{name:'登录',exact:true}).click();
 await p.waitForURL(u=>u.pathname!='/login');
}
async function listReady(p=page){await p.locator('.real-experts__card').first().waitFor();}
async function upload(raw){
 await page.getByRole('button',{name:'导入专家资料',exact:true}).click();
 await page.locator('input[type=file]').setInputFiles({name:'synthetic-experts.csv',mimeType:'text/csv',buffer:Buffer.from(raw)});
 await page.getByRole('button',{name:'生成预览',exact:true}).click();
 await page.locator('[data-action=apply-import]').waitFor();
}
async function apply(){await page.getByRole('button',{name:'确认导入',exact:true}).click(); await page.getByRole('dialog').waitFor({state:'hidden'});await listReady();}
try {
 await login(page,'platform.chen'); await page.goto('http://127.0.0.1:5177/platform/experts');await listReady();
 assert.equal(await page.locator('.real-experts__card').count(),2);
 assert((await page.locator('.real-experts__card').first().innerText()).includes('博导：未知'));
 await page.getByRole('button',{name:'导入专家资料',exact:true}).click();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载 CSV 模板',exact:true}).click();
 const template=await readFile(await (await download).path(),'utf8');
 const columns='username,unit,title,discipline_codes,province_name,doctoral_supervisor,masters_supervisor,research_directions,keywords,source_url,source_note';
 assert.equal(template.trim(),columns);
 await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();
 const csv=template+'expert.zhou,浏览器虚构大学,教授,0812,北京市,false,,自然语言处理,机器学习;知识图谱,https://example.edu.cn/profile,人工导入验收资料\r\n';
 await upload(csv);assert((await page.getByRole('dialog').innerText()).includes('未知 → 否'));
 const box=await page.getByRole('dialog').boundingBox(); assert(box && Math.abs(box.x + box.width / 2 - 720) < 2);
 await page.screenshot({path:path.join(evidence,'import-preview.png')});
 await apply(); assert((await page.locator('.real-experts__list').innerText()).includes('浏览器虚构大学'));
 cases.push({case:'下载真实模板→上传CSV→预览差异→确认更新',status:'PASS'});
 await page.reload();await listReady();
 for(const [value,expected] of [['false','expert.zhou'],['unknown','expert.qian']]){
  await page.locator('[data-filter=doctoral_supervisor]').selectOption(value);
  await page.getByRole('button',{name:'筛选',exact:true}).click();
  await page.waitForFunction(name=>{const rows=document.querySelectorAll('.real-experts__card');return rows.length===1&&rows[0].textContent.includes(name)},expected);
 }
 await page.locator('[data-filter=doctoral_supervisor]').selectOption('true');await page.getByRole('button',{name:'筛选',exact:true}).click();
 await page.getByText('暂无专家',{exact:true}).waitFor();
 await page.getByRole('button',{name:'重置',exact:true}).click();await listReady();
 await page.screenshot({path:path.join(evidence,'profiles.png')});
 cases.push({case:'刷新持久化/否与未知分别筛选/是的空态',status:'PASS'});
 await upload(csv+csv.split('\n').slice(1).join('\n'));
 assert(await page.getByRole('button',{name:'确认导入',exact:true}).isDisabled());
 assert((await page.getByRole('dialog').innerText()).includes('重复出现'));
 await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();
 cases.push({case:'重复用户名逐行报错且禁止确认',status:'PASS'});
 await upload(csv);assert((await page.getByRole('dialog').innerText()).includes('无变化 将跳过更新'));await apply();
 assert((await page.getByRole('status').innerText()).includes('已更新 0 位'));
 cases.push({case:'同一资料重复导入不发生无意义更新',status:'PASS'});
 const clear=template+'expert.zhou,浏览器虚构大学,教授,0812,,,,,,,\r\n';
 await upload(clear);assert((await page.getByRole('dialog').innerText()).includes('北京市 → 清空'));
 await apply();
 let zhou=page.locator('.real-experts__card').filter({hasText:'expert.zhou'});
 assert((await zhou.innerText()).includes('省份：未填写 · 博导：未知 · 硕导：未知'));
 cases.push({case:'空字段预览明确清空并持久化未知',status:'PASS'});
 await upload(csv);
 const other=await context.newPage();await login(other,'platform.chen');await other.goto('http://127.0.0.1:5177/platform/experts');await listReady(other);
 await other.locator('.real-experts__card').filter({hasText:'expert.zhou'}).getByRole('button',{name:'编辑资料',exact:true}).click();
 await other.getByRole('dialog').getByLabel('单位',{exact:true}).fill('并发人工维护大学');
 await other.getByRole('button',{name:'确认保存',exact:true}).click();await other.getByRole('dialog').waitFor({state:'hidden'});await other.close();
 await page.getByRole('button',{name:'确认导入',exact:true}).click();
 await page.getByRole('dialog').getByText('预览失效或档案已变更 整批未更新 请重新预览',{exact:true}).waitFor();
 await page.locator('[data-action=apply-import]').waitFor({state:'detached'});
 assert.equal(await page.locator('[data-action=apply-import]').count(),0);
 await page.screenshot({path:path.join(evidence,'version-conflict.png')});
 await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();await page.reload();await listReady();
 assert((await page.locator('.real-experts__list').innerText()).includes('并发人工维护大学'));
 cases.push({case:'双页面并发编辑使预览409失效/不覆盖新资料',status:'PASS'});
 const school=await context.newPage();await login(school,'school.wang');await school.goto('http://127.0.0.1:5177/platform/experts');
 await school.waitForTimeout(500);
 assert.equal(await school.locator('.real-experts__card').count(),0);
 assert(!(await school.locator('body').innerText()).includes('expert.zhou'));await school.close();
 cases.push({case:'学校页面不能进入平台专家库或读取身份',status:'PASS'});
 assert.equal(sourceRequests,0);assert.deepEqual(errors,[]);
 await page.setViewportSize({width:390,height:844});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:path.join(evidence,'mobile.png'),fullPage:true});
 cases.push({case:'390px无整页横向溢出/来源链接无自动请求/无浏览器异常',status:'PASS'});
 await writeFile(path.join(evidence,'browser-results.json'),JSON.stringify({browser:browser.version(),cases,sourceRequests,pageErrors:errors},null,2));
 console.log(JSON.stringify({browser:browser.version(),passed:cases.length,pageErrors:errors}));
} finally {await browser.close();}
