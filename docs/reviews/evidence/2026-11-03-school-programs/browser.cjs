const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const cfg=JSON.parse(fs.readFileSync(0,'utf8')), base='http://127.0.0.1:15237',dir='docs/reviews/evidence/2026-11-03-school-programs/';
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});const errors=[];
try{async function login(username,dest){const p=await browser.newPage({viewport:{width:1320,height:950}});p.setDefaultTimeout(12000);p.on('pageerror',e=>errors.push(e.message));await p.goto(base+'/login');await p.locator('[autocomplete=username]').fill(username);await p.locator('[type=password]').fill(cfg.password);await p.locator('button[type=submit]').click();await p.waitForURL('**/'+dest);return p}
for (const [i,school,student,name] of [[1,'school.wang','student.lin','虚构甲校计算方向'],[2,'pilot.school','pilot.student','虚构乙校计算方向']]){
const s=await login(school,'school/preparation');
await s.goto(base+'/school/disciplines');const panel=s.locator('.program-import');await panel.getByLabel('目录年度').fill('2026');await panel.getByLabel('校方出处').fill('虚构验收用培养目录.csv');await panel.getByLabel('来源版本').fill('虚构样例 V1');
const file=(data)=>({name:'虚构验收.csv',mimeType:'text/csv',buffer:Buffer.from('校内代码,校内名称,官方代码,状态\n'+data)});
await panel.locator('input[type=file]').setInputFiles(file('0007,重复,0812,启用\n0007,歧义,0812,启用'));await panel.getByRole('button',{name:'预览校内目录'}).click();await panel.getByText(/重复校码/).waitFor();assert.equal(await panel.getByRole('button',{name:'确认发布该版本'}).count(),0);
await panel.locator('input[type=file]').setInputFiles(file('0007,'+name+',0812,启用\n0011,虚构停用方向,0812,停用'));await panel.getByRole('button',{name:'预览校内目录'}).click();await panel.getByRole('button',{name:'确认发布该版本'}).waitFor();if(i===1)await panel.screenshot({path:dir+'01-preview.png'});await panel.getByRole('button',{name:'确认发布该版本'}).click();await panel.getByText(/已发布 2026 年第 1 版/).waitFor();console.log('PASS school '+i+' invalid CSV rejected, valid preview published');
await s.goto(base+'/school/batch-rules');const row=s.locator('.batch-list article').first();await row.getByRole('button',{name:'设置校内目录'}).click();await row.locator('select option').nth(1).waitFor({state:'attached'});await row.locator('select').selectOption({index:1});await row.getByRole('button',{name:'确认固定本批目录'}).click();await row.getByText(/已固定：2026 年第 1 版/).waitFor();if(i===1)await row.screenshot({path:dir+'02-pinned.png'});console.log('PASS school '+i+' batch version pinned');
const t=await login(student,'student/dashboard');await t.goto(base+'/student/thesis/edit?thesisId=new');const select=t.locator('[data-action=open-discipline]');await select.click();await t.getByRole('searchbox').fill('0812');assert.equal(await t.getByRole('option').count(),1);assert((await t.getByRole('option').innerText()).includes(name));await t.getByRole('searchbox').fill('0007');await t.locator('[data-discipline="0007"]').click();await t.locator('[data-action=create-selected-draft]').click();await t.locator('[data-submit-checklist]').waitFor();await t.locator('input[name=title]').fill('虚构论文 '+i);await t.locator('textarea[name=abstract]').fill('虚构摘要。');await t.locator('[data-action=save-draft]').click();await t.getByText(/已保存 ·/).waitFor();await t.reload();await t.locator('[data-action=open-discipline]').getByText(new RegExp(name)).waitFor();if(i===2)await t.locator('.material-editor__section').first().screenshot({path:dir+'03-student.png'});console.log('PASS student '+i+' official and local search, same local code isolated, create and reload');
await s.goto(base+'/school/preparation');await s.getByText(new RegExp(name)).first().waitFor();console.log('PASS school '+i+' sees local and official codes on its thesis');
if(i===2){
  const edit=t.url(), tid=new URL(edit).searchParams.get('thesisId');
  const material=(name)=>({name,mimeType:'application/pdf',buffer:Buffer.from(cfg.pdf,'base64')});
  for(const [purpose,label] of [['SCHOOL_ARCHIVE','original.pdf'],['EXPERT_REVIEW','anonymous.pdf']]){
    await t.locator('[data-file-purpose="'+purpose+'"] input[type=file]').setInputFiles(material(label));
    await t.locator('[data-file-purpose="'+purpose+'"]').getByText(label,{exact:true}).waitFor();
  }
  await t.locator('[data-action=open-submit-confirmation]').click();
  const submission=t.waitForResponse(r=>r.url().endsWith('/theses/'+tid+':submit') && r.request().method()==='POST');
  await t.locator('[data-action=confirm-submit]').click();
  const sent=await submission;assert.equal(sent.status(),200);
  const original=(await sent.json()).data;assert.equal(original.stage,'PREPARING');
  await t.waitForURL('**/student/dashboard');
  await s.goto(base+'/school/preparation?thesis='+tid);
  await s.getByPlaceholder(/人工核验、退回或终止理由/).fill('请核对虚构验收材料');
  const response=s.waitForResponse(r=>r.url().includes(':confirm-anonymization') && r.request().method()==='POST');
  await s.getByRole('button',{name:'退回草稿'}).click();
  const result=await response;assert.equal(result.status(),200);const returned=(await result.json()).data;
  assert.equal(returned.stage,'DRAFT');assert.notEqual(returned.current_version.id,original.current_version.id);
  assert.deepEqual(returned.current_version.school_program,original.current_version.school_program);
  const links=v=>v.files.map(f=>[f.purpose,f.file_id]).sort();
  assert.deepEqual(links(returned.current_version),links(original.current_version));
  await s.locator('.review-actions').getByText('DRAFT',{exact:true}).waitFor();
  console.log('PASS school manual return creates one editable copy with the original file references and program');
  await t.goto(edit);
  await t.locator('[data-action=open-discipline]').getByText(new RegExp(name)).waitFor();
  for(const file of ['original.pdf','anonymous.pdf'])await t.getByText(file,{exact:true}).first().waitFor();
  assert.equal(await t.locator('input[name=title]').inputValue(),'虚构论文 2');
  await t.locator('input[name=title]').fill('学生在退回后修改题目');
  await t.locator('[data-action=save-draft]').click();await t.getByText(/已保存 ·/).waitFor();
  await t.reload();await t.locator('[data-action=open-discipline]').getByText(new RegExp(name)).waitFor();
  assert.equal(await t.locator('input[name=title]').inputValue(),'学生在退回后修改题目');
  await t.locator('.material-editor__section').first().screenshot({path:dir+'04-returned-draft.png'});
  console.log('PASS student reopens the returned draft with both original filenames and same program, edits, saves and reloads');
}
await t.close();await s.close()}
assert.deepEqual(errors,[]);console.log('PASS no uncaught browser errors');
}finally{await browser.close()}})().catch(e=>{console.error(e.message);process.exitCode=1})
