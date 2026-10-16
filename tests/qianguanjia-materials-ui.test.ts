import {chromium,type Browser} from 'playwright-core';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {resolveChromeExecutable} from './helpers/douyin-cdp-fixture';
import {qianguanjiaMaterialsFixtureScript} from './helpers/qianguanjia-materials-ui-fixture';
import {qianchuanBackendFixtureStyles} from './helpers/qianchuan-backend-ui-fixture';
let browser:Browser;
beforeAll(async()=>{browser=await chromium.launch({executablePath:await resolveChromeExecutable(),headless:true,args:['--no-sandbox']});},30000);
afterAll(async()=>{await browser?.close()});
async function fixture(){const p=await browser.newPage({viewport:{width:1000,height:900}});await p.route('http://127.0.0.1:3000/materials',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<meta charset="utf-8"><div id="root"></div>'}));await p.goto('http://127.0.0.1:3000/materials');await p.addStyleTag({content:qianchuanBackendFixtureStyles()});await p.addScriptTag({content:qianguanjiaMaterialsFixtureScript()});return p;}
it('reads platform materials and links exact accepted uploads without treating unknown as accepted',async()=>{
 const p=await fixture();try{
 expect(await p.evaluate(()=>(window as any).reads)).toEqual([]);
 await p.getByRole('button',{name:'读取本地上传记录'}).click();
 await p.getByRole('cell',{name:/平台已接收/}).waitFor();
 expect(await p.getByRole('cell',{name:/MAY_HAVE_UPLOADED/}).count()).toBe(1);
 await p.getByLabel('素材账户',{exact:true}).selectOption('9007199254740993');
 await p.getByRole('button',{name:'读取平台素材',exact:true}).click();
 await p.getByText(/精确账户与视频 ID 匹配/).waitFor();
 expect(await p.getByText(/精确账户与视频 ID 匹配/).count()).toBe(1);
 await p.getByLabel('本地素材状态').selectOption('unknown');
 expect(await p.getByRole('cell',{name:/MAY_HAVE_UPLOADED/}).count()).toBe(1);
 expect(await p.getByRole('cell',{name:/平台已接收/}).count()).toBe(0);
 await p.getByLabel('素材中心搜索').fill('no-match');await p.getByText('没有匹配的本地上传记录。').waitFor();
 expect(await p.evaluate(()=>(window as any).reads.map((x:any)=>x.kind))).toEqual(['local-materials','materials']);
 }finally{await p.close()}
});
it.each(['cancel','hide','session'])('ignores late platform results after %s',async action=>{
 const p=await fixture();try{await p.getByLabel('素材账户',{exact:true}).selectOption('9007199254740993');await p.evaluate(()=>{(window as any).delay=true});await p.getByRole('button',{name:'读取平台素材',exact:true}).click();await p.waitForFunction(()=>(window as any).pending.length===1);
 if(action==='cancel')await p.getByRole('button',{name:'取消素材查询'}).click();if(action==='hide')await p.evaluate(()=>(window as any).setActive(false));if(action==='session')await p.evaluate(()=>(window as any).setSession('changed'));
 await p.waitForFunction(()=>(window as any).cancelled.length===1);await p.evaluate(()=>(window as any).pending[0]());expect(await p.getByRole('cell',{name:/same-name.mp4/}).count()).toBe(0);
 }finally{await p.close()}
});
it.each(['empty','unavailable','fail'])('distinguishes %s response and suppresses upstream secrets',async mode=>{
 const p=await fixture();try{await p.getByLabel('素材账户',{exact:true}).selectOption('9007199254740993');await p.evaluate(m=>{(window as any)[m]=true},mode);await p.getByRole('button',{name:'读取平台素材',exact:true}).click();
 await p.getByText(mode==='empty'?'供应商为该账户明确返回了空目录。':mode==='unavailable'?'供应商未提供目录数据（total/list 为 null），不能解释为没有素材。':'平台素材读取未完成。请重新连接正常千管家会话后读取；没有自动同步或重试。').waitFor();
 expect(await p.locator('body').innerText()).not.toContain('private-secret');expect(await p.evaluate(()=>(window as any).reads.length)).toBe(1);
 }finally{await p.close()}
});
it('shows a platform filter empty state without treating it as a global empty catalog',async()=>{
 const p=await fixture();try{await p.getByLabel('素材账户',{exact:true}).selectOption('9007199254740993');await p.getByRole('button',{name:'读取平台素材',exact:true}).click();await p.getByRole('cell',{name:/1879999999999999999/}).waitFor();await p.getByLabel('素材中心搜索').fill('no-match');await p.getByText('本页没有匹配的平台素材，请调整搜索或翻页。').waitFor();expect(await p.getByText('供应商为该账户明确返回了空目录。').count()).toBe(0);}finally{await p.close()}
});

it('stops at the catalog page cap and identifies unread remaining materials',async()=>{
 const p=await fixture();try{
  await p.evaluate(()=>{(window as any).largeCatalog=true});
  await p.getByLabel('素材账户',{exact:true}).selectOption('9007199254740993');
  await p.getByRole('button',{name:'读取平台素材',exact:true}).click();
  await p.getByRole('cell',{name:/1879999999999999999/}).waitFor();
  await p.evaluate(async()=>{const next=()=>[...document.querySelectorAll('button')].find(x=>x.textContent==='下一页平台素材');for(let i=1;i<500;i++){while(!next()||next()!.disabled)await new Promise(r=>setTimeout(r,8));next()!.click();while((window as any).reads.length<=i)await new Promise(r=>setTimeout(r,8));await new Promise(r=>setTimeout(r,8));}});
  await p.getByText(/已达到本次目录读取上限/).waitFor();
  expect(await p.getByRole('button',{name:'下一页平台素材'}).isDisabled()).toBe(true);
  expect(await p.evaluate(()=>(window as any).reads.at(-1).page)).toBe(500);
  expect(await p.getByRole('alert').count()).toBe(0);
 }finally{await p.close()}
},30000);
