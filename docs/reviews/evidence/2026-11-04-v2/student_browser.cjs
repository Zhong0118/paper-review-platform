const {chromium}=require('playwright'), assert=require('node:assert/strict'), fs=require('fs')
const cfg=JSON.parse(fs.readFileSync(0,'utf8')), base='http://127.0.0.1:5198'
;(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true})
 try {
  const crash=[]
  async function login(name,dest){
   const ctx=await browser.newContext(); const p=await ctx.newPage();p.setDefaultTimeout(10000)
   p.on('pageerror',e=>crash.push(e.name))
   await p.goto(base+'/login');await p.locator('[autocomplete=username]').fill(name)
   await p.locator('[type=password]').fill(cfg.password)
   await p.locator('button[type=submit]').click(); await p.waitForURL('**/'+dest)
   return p
  }
  for(const [name,code] of [['pilot.student','0007'],['student.lin','0835']]){
   const p=await login(name,'student/dashboard')
   const posts=[];p.on('request',r=>{if(r.method()==='POST' && r.url().endsWith('/api/v1/theses'))posts.push(r.postDataJSON())})
   await p.locator('[data-action=create-thesis]').click()
   await p.locator('[data-create-title]').fill('隔离浏览器验收')
   await p.locator('[data-create-keywords]').fill('权限，校验')
   assert.equal(posts.length,0)
   await p.locator('[data-action=open-discipline]').click()
   await p.locator('[data-discipline="'+code+'"]').click()
   const response=p.waitForResponse(r=>r.request().method()==='POST' && r.url().endsWith('/api/v1/theses'))
   await p.locator('[data-action=create-selected-draft]').click()
   const created=await response; assert.equal(created.status(),200)
   const data=(await created.json()).data, v=data.current_version
   assert.equal(v.title,'隔离浏览器验收');assert.deepEqual(v.keywords,['权限','校验'])
   assert.equal(v.discipline_code,code==='0007'?'0812':'0835')
   if(code==='0007')assert.equal(posts[0].program.code,code)
   await p.waitForURL('**/*thesisId='+data.id);await p.locator('input[name=title]').waitFor()
   const b=await p.context().newPage(); await b.goto(base+'/login')
   // Session storage is tab scoped; sign into the second tab if the guard redirects.
   {
    await b.locator('[autocomplete=username]').fill(name);await b.locator('[type=password]').fill(cfg.password)
    await b.locator('button[type=submit]').click();await b.waitForURL(u=>!u.pathname.endsWith('/login'));await b.goto(p.url())
   }
   await b.locator('input[name=title]').fill('另一个页签的独立文本')
   await p.locator('input[name=title]').fill('已经落盘的文本')
   await p.locator('[data-action=save-draft]').click();await p.getByText(/已保存 ·/).waitFor()
   const losing=b.waitForResponse(r=>r.request().method()==='PATCH')
   await b.locator('[data-action=save-draft]').click();assert.equal((await losing).status(),409)
   await b.getByRole('button',{name:'查看服务器版本'}).click()
   await b.getByText('已经落盘的文本',{exact:false}).first().waitFor()
   assert.equal(await b.locator('input[name=title]').inputValue(),'另一个页签的独立文本')
   await p.reload();assert.equal(await p.locator('input[name=title]').inputValue(),'已经落盘的文本')
   console.log(JSON.stringify({create:created.status(),school_program:v.school_program?.code??null,discipline_code:v.discipline_code,keywords:v.keywords,revision_length:v.content_revision.length,stale_write:409,local_copy_preserved:true}))
   if(code==='0007'){
    await p.locator('textarea[name=abstract]').fill('仅用于隔离验收的实验摘要')
    for(const [purpose,file] of [['SCHOOL_ARCHIVE','original.pdf'],['EXPERT_REVIEW','anonymous.pdf']]){
     await p.locator('[data-file-purpose="'+purpose+'"] input[type=file]').setInputFiles({name:file,mimeType:'application/pdf',buffer:Buffer.from(cfg.pdf,'base64')})
     await p.locator('[data-file-purpose="'+purpose+'"]').getByText(file,{exact:true}).waitFor()
    }
    // Both real upload bindings carry the version observed by the editing page.
    const bindings=[]
    p.on('request',r=>{if(r.url().endsWith(':complete'))bindings.push(r.headers()['if-draft-revision'])})
    const detail=()=>p.evaluate(async id=>(await import('/src/api/theses.ts')).getThesis(id),data.id)
    const anonymous=d=>d.current_version.files.find(f=>f.purpose==='anonymous').file_id
    async function preview(){
     await p.locator('[data-open-pdf-transform]').click();await p.locator('[data-pages]').fill('1')
     await p.locator('[data-generate-pdf]').click();await p.locator('dialog iframe').waitFor()
    }
    async function apply(){
     const reply=p.waitForResponse(r=>r.url().includes('/pdf-transforms/') && r.url().endsWith(':apply'))
     await p.locator('[data-apply-pdf]').click();return await reply
    }
    await preview()
    assert.equal(bindings.length,2);assert.ok(bindings.every(h=>/^[0-9a-f]{64}$/.test(h)))
    const initial=await detail(), applied=await apply()
    assert.equal(applied.status(),200);assert.equal(applied.request().headers()['if-draft-revision'],initial.current_version.content_revision)
    await p.locator('dialog').waitFor({state:'detached'});const bound=await detail()
    assert.notEqual(anonymous(bound),anonymous(initial));assert.equal((await applied.json()).data.content_revision,bound.current_version.content_revision)
    await preview();await b.reload();await b.locator('input[name=title]').fill('另一窗口在转换预览后修改')
    const patch=b.waitForResponse(r=>r.request().method()==='PATCH');await b.locator('[data-action=save-draft]').click();assert.equal((await patch).status(),200)
    const rejected=await apply();assert.equal(rejected.status(),409)
    assert.equal((await rejected.json()).code,'VERSION_CONFLICT');await p.locator('dialog [role=alert]').waitFor()
    const actual=await detail();assert.equal(anonymous(actual),anonymous(bound));assert.equal(actual.current_version.title,'另一窗口在转换预览后修改')
    await p.getByRole('button',{name:'关闭 PDF 处理'}).click();await p.locator('dialog').waitFor({state:'detached'})
    await p.reload();await p.locator('input[name=title]').waitFor()
    console.log(JSON.stringify({v21:'material-bindings',conditional_uploads:2,pdf_apply:200,stale_apply:409,preserved_binding:true}))
    await p.locator('[data-action=open-submit-confirmation]').click()
    const sent=p.waitForResponse(r=>r.url().endsWith(':submit') && r.request().method()==='POST')
    await p.locator('[data-action=confirm-submit]').click(); const submitted=await sent
    assert.equal(submitted.status(),200)
    assert.equal(submitted.request().postDataJSON().expected_content_revision.length,64)
    const record=(await submitted.json()).data
    assert.equal(record.stage,'PREPARING');assert.equal(record.current_version.files.length,2)
    await p.waitForURL('**/student/dashboard')
    console.log(JSON.stringify({submit:200,stage:record.stage,confirmed_materials:2}))
   }
   await p.context().close()
  }
  const s=await login('school.wang','school/preparation')
  await s.getByRole('heading',{name:'本校论文'}).waitFor()
  assert.doesNotMatch(await s.locator('main').innerText(),/学校单篇代传|学校可直接提交|批量导入论文/)
  await s.route('**/api/v1/school-review/theses*',route=>route.fulfill({status:500,json:{message:'隔离故障'}}))
  await s.reload();await s.locator('[data-action=reload-preparation]').waitFor()
  await s.unrouteAll();await s.locator('[data-action=reload-preparation]').click()
  await s.getByRole('heading',{name:'本校论文'}).waitFor()
  assert.deepEqual(crash,[]);console.log('PASS school real-mode copy and failed-list retry; Chrome page errors: 0')
 } finally {await browser.close()}
})().catch(e=>{console.error(e.message);process.exitCode=1})
