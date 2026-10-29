const {createRequire}=require('node:module');
const {chromium}=createRequire('/Users/zhongxu/.npm/_npx/9833c18b2d85bc59/package.json')('playwright');
const fs=require('node:fs/promises'),assert=require('node:assert/strict');
const root='/Users/zhongxu/Desktop/0-Inbox/paper-review-platform';
const scratch=root+'/.superpowers/sdd/2026-10-29-post-commit-acceptance';
const evidence=root+'/docs/reviews/evidence/2026-10-29-post-commit/materials';
let browser,page,step='launch';const results=[];
(async()=>{
 const ctx=JSON.parse(await fs.readFile(scratch+'/browser-context.json','utf8'));
 const password=await fs.readFile(scratch+'/browser-password','utf8');
 await fs.mkdir(evidence,{recursive:true});
 browser=await chromium.launch({channel:'chrome',headless:true});page=await browser.newPage({viewport:{width:1440,height:1050}});page.setDefaultTimeout(20000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5177/login');await page.getByLabel('账号',{exact:true}).fill('student.lin');await page.getByLabel('密码',{exact:true}).fill(password);
 await page.getByRole('button',{name:'登录',exact:true}).click();await page.waitForURL('**/student/dashboard');
 await page.goto('http://127.0.0.1:5177/student/thesis/edit?thesisId='+ctx.thesis_id);
 await page.locator('[data-open-pdf-transform]').waitFor();
 async function detail(){return page.evaluate(async id=>{const api=await import('/src/api/theses.ts');return api.getThesis(id)},ctx.thesis_id)}
 const anonymous=d=>d.current_version.files.find(f=>f.purpose==='anonymous').file_id;
 await page.locator('[data-run-sensitive]').click();await page.getByText('前两页未找到登记标题',{exact:false}).waitFor();
 for(const [op,pages,count] of [['MERGE','2,1',3],['EXTRACT','2,3',2],['DELETE_PAGES','1',1]]){
  step=op;const before=anonymous(await detail());
  await page.locator('[data-open-pdf-transform]').click();await page.locator('dialog[open]').waitFor();
  await page.locator('[data-pdf-operation]').selectOption(op);await page.locator('[data-pages]').first().fill(pages);
  if(op==='MERGE'){
   await page.locator('[data-add-pdf]').setInputFiles(scratch+'/extra.pdf');await page.locator('[data-pages]').nth(1).waitFor();await page.locator('[data-pages]').nth(1).fill('1');
  }
  const generated=page.waitForResponse(r=>r.url().endsWith('/pdf-transforms')&&r.request().method()==='POST');
  await page.locator('[data-generate-pdf]').click();const response=await generated;assert.equal(response.status(),200);const product=(await response.json()).data;
  assert.equal(product.page_count,count);await page.locator('dialog iframe').waitFor();await page.waitForTimeout(1600);
  assert.equal(anonymous(await detail()),before);
  await page.locator('dialog').screenshot({path:evidence+'/'+op.toLowerCase()+'-preview.png',animations:'disabled'});
  if(op==='MERGE'){
   await page.setViewportSize({width:390,height:844});assert.equal(await page.locator('dialog').evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
   await page.locator('dialog').screenshot({path:evidence+'/mobile-preview.png',animations:'disabled'});await page.setViewportSize({width:1440,height:1050});
  }
  await page.locator('[data-apply-pdf]').click();await page.locator('dialog').waitFor({state:'detached'});await page.locator('[data-open-pdf-transform]').waitFor();
  assert.equal(anonymous(await detail()),product.new_file_id);assert.equal((await detail()).anonymization.stale,true);
  results.push({scenario:op+'真实浏览器生成、预览、确认前旧绑定、确认后新绑定、旧检测失效',page_count:count,status:'PASS'});
 }
 step='recheck';await page.locator('[data-run-sensitive]').click();await page.getByText('前两页未找到登记标题',{exact:false}).waitFor();
 const fresh=await detail();assert.equal(fresh.anonymization.stale,false);assert.equal(fresh.anonymization.source_metadata.file_id,anonymous(fresh));
 results.push({scenario:'应用后真实重检绑定新文件',status:'PASS'});
 step='cancel';const before=anonymous(fresh);await page.locator('[data-open-pdf-transform]').click();await page.locator('[data-pages]').fill('1');await page.locator('[data-generate-pdf]').click();await page.locator('dialog iframe').waitFor();await page.getByRole('button',{name:'关闭 PDF 处理'}).click();await page.locator('dialog').waitFor({state:'detached'});assert.equal(anonymous(await detail()),before);
 results.push({scenario:'取消待确认成品保留当前材料；390px对话框无横溢',status:'PASS'});
 assert.deepEqual(errors,[]);await fs.writeFile(evidence+'/browser-results.json',JSON.stringify({browser:await browser.version(),results,page_errors:errors},null,2));console.log(JSON.stringify({status:'PASS',scenarios:results.length}));await browser.close();
})().catch(async e=>{console.error('FAILED',step,e.message);if(page)await page.screenshot({path:scratch+'/browser-failure.png',animations:'disabled'}).catch(()=>{});await fs.writeFile(scratch+'/browser-partial.json',JSON.stringify({step,results,error:e.message},null,2));if(browser)await browser.close();process.exitCode=1;});
