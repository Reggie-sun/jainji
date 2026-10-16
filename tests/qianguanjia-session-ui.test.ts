import { readFileSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright-core';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { resolveChromeExecutable } from './helpers/douyin-cdp-fixture';
import { qianguanjiaSessionFixtureScript } from './helpers/qianguanjia-session-ui-fixture';
let browser:Browser;
beforeAll(async()=>{browser=await chromium.launch({executablePath:await resolveChromeExecutable(),headless:true,args:['--no-sandbox']});},30000);
afterAll(async()=>{await browser?.close();});
async function fixture(mode='single', initialActive=false){const p=await browser.newPage();p.setDefaultTimeout(2500);await p.route('http://127.0.0.1:3000/qgj-session',r=>r.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));await p.goto('http://127.0.0.1:3000/qgj-session');await p.addStyleTag({content:['src/renderer/qianchuan-backend.css','src/renderer/qianchuan-console.css'].map(path=>readFileSync(path,'utf8')).join('\n')});await p.addScriptTag({content:qianguanjiaSessionFixtureScript(initialActive)});if(!initialActive)await p.evaluate(mode=>{(window as any).supplier.mode=mode},mode);return p;}
const reads=(p:Page)=>p.evaluate(()=>(window as any).supplier.reads.map((x:any)=>x.kind));
it('automatically discovers and reads one existing session once, without a connect button',async()=>{const p=await fixture();try{await p.getByText('显示千管家',{exact:true}).click();await p.getByTestId('qianguanjia-home').waitFor();expect(await reads(p)).toEqual(['discover','accounts','home']);expect(await p.getByRole('button',{name:'连接已授权账户',exact:true}).count()).toBe(0);await p.getByRole('button',{name:'刷新数据',exact:true}).click();await p.waitForFunction(()=>(window as any).supplier.reads.length===4);expect(await reads(p)).toEqual(['discover','accounts','home','home']);}finally{await p.close()}});
it('does not duplicate initial reads under StrictMode',async()=>{const p=await fixture('single',true);try{await p.getByTestId('qianguanjia-home').waitFor();expect(await reads(p)).toEqual(['discover','accounts','home']);}finally{await p.close()}});
it('keeps empty summary metrics unknown and preserves the authorized directory',async()=>{const p=await fixture();try{await p.evaluate(()=>{(window as any).supplier.homeEmpty=true});await p.getByText('显示千管家',{exact:true}).click();await p.getByText('所选日期汇总暂未提供',{exact:true}).waitFor();expect(await p.locator('.qianguanjia-kpi dd').allTextContents()).toEqual(['—','—','—','—']);await p.getByRole('navigation',{name:'千管家页面'}).getByRole('button',{name:'账户管理',exact:true}).click();await p.getByRole('cell',{name:'已授权账户',exact:false}).waitFor();expect(await p.getByRole('alert').count()).toBe(0);}finally{await p.close()}});
it('requires explicit selection for multiple pages without guessing an identity',async()=>{const p=await fixture('multiple');try{await p.getByText('显示千管家',{exact:true}).click();await p.getByRole('combobox',{name:'千管家页面',exact:true}).waitFor();expect(await reads(p)).toEqual(['discover']);await p.getByRole('combobox',{name:'千管家页面',exact:true}).selectOption('11111111-1111-4111-8111-111111111112');await p.getByTestId('qianguanjia-home').waitFor();expect(await p.evaluate(()=>(window as any).supplier.reads.slice(1).every((x:any)=>x.sessionId.endsWith('2')))).toBe(true);}finally{await p.close()}});
it('shows absence without retrying or disabling local history navigation',async()=>{const p=await fixture('empty');try{await p.getByText('显示千管家',{exact:true}).click();await p.getByText(/没有发现可读取的千管家页面/).waitFor();expect(await reads(p)).toEqual(['discover']);await p.getByRole('navigation',{name:'千管家页面'}).getByRole('button',{name:'历史报表',exact:true}).click();await p.getByRole('heading',{name:'历史报表',exact:true}).waitFor();expect(await reads(p)).toEqual(['discover']);}finally{await p.close()}});
it('reports a read failure honestly without trial claims, secrets or automatic retries',async()=>{const p=await fixture('fail');try{await p.getByText('显示千管家',{exact:true}).click();await p.getByRole('alert').waitFor();expect(await p.getByRole('alert').innerText()).not.toMatch(/试用|secret/);expect(await reads(p)).toEqual(['discover']);await p.evaluate(()=>{(window as any).supplier.mode='single'});await p.getByRole('button',{name:'刷新数据',exact:true}).click();await p.getByTestId('qianguanjia-home').waitFor();expect(await reads(p)).toEqual(['discover','discover','accounts','home']);}finally{await p.close()}});
it('cancels pending discovery and prevents late account or summary dispatch',async()=>{const p=await fixture();try{await p.evaluate(()=>{(window as any).supplier.delay='discover'});await p.getByText('显示千管家',{exact:true}).click();await p.getByRole('button',{name:'取消千管家查询',exact:true}).click();await p.evaluate(()=>{(window as any).supplier.pending.shift()()});await p.getByText(/本次读取已取消/).waitFor();expect(await reads(p)).toEqual(['discover']);expect(await p.getByTestId('qianguanjia-home').count()).toBe(0);}finally{await p.close()}});
it('waits for disconnect cleanup before re-entry and ignores a late old result',async()=>{const p=await fixture();try{await p.evaluate(()=>{const f=(window as any).supplier;f.delay='accounts';f.blockCleanup=true});await p.getByText('显示千管家',{exact:true}).click();await p.waitForFunction(()=>(window as any).supplier.pending.length===1);await p.getByText('隐藏千管家',{exact:true}).click();await p.getByText('显示千管家',{exact:true}).click();expect(await reads(p)).toEqual(['discover','accounts']);await p.evaluate(()=>{const f=(window as any).supplier;f.delay='';f.blockCleanup=false;f.pending.shift()();f.cleanup.splice(0).forEach((x:any)=>x())});await p.getByTestId('qianguanjia-home').waitFor();expect(await reads(p)).toEqual(['discover','accounts','discover','accounts','home']);}finally{await p.close()}});
it('queries a selected completed day, clears old values on date edits and preserves the actual observation time',async()=>{const p=await fixture();try{
 await p.getByText('显示千管家',{exact:true}).click();await p.getByTestId('qianguanjia-home').waitFor();
 const selected=await p.getByLabel('汇总日期（北京时间）',{exact:true}).inputValue();
 const yesterday=new Date(Date.now()+8*3600000-86400000).toISOString().slice(0,10);expect(selected).toBe(yesterday);
 expect(await p.evaluate(()=>(window as any).supplier.reads.find((q:any)=>q.kind==='home').date)).toBe(selected);
 await p.getByLabel('汇总日期（北京时间）',{exact:true}).fill('2026-10-12');expect(await p.getByTestId('qianguanjia-home').count()).toBe(0);
 expect(await p.locator('.qianguanjia-kpi dd').allTextContents()).toEqual(['—','—','—','—']);
 await p.getByRole('button',{name:'刷新数据',exact:true}).click();await p.getByTestId('qianguanjia-home').waitFor();
 expect(await p.evaluate(()=>(window as any).supplier.reads.at(-1).date)).toBe('2026-10-12');
 expect(await p.getByTestId('qianguanjia-home').innerText()).toContain('2026-10-12');
}finally{await p.close()}});
it('exposes all six saved accounts on the overview independently of the supplier directory',async()=>{const p=await fixture();try{
 await p.getByText('显示千管家',{exact:true}).click();await p.getByTestId('qianguanjia-home').waitFor();
 const own=p.getByRole('region',{name:'千川跨账户报表',exact:true});expect(await own.isVisible()).toBe(true);
 expect(await own.getByRole('group',{name:'跨账户报表账户'}).getByRole('checkbox').count()).toBe(7);
 expect(await p.evaluate(()=>(window as any).supplier.captures)).toEqual([]);
 await own.getByRole('button',{name:'读取并保存所选账户报表',exact:true}).click();
 await p.waitForFunction(()=>(window as any).supplier.captures.length===6);
 expect(await p.evaluate(()=>(window as any).supplier.captures.every((q:any)=>q.browserAccess==='existing-only'&&q.startDate===q.endDate))).toBe(true);
 await p.getByRole('navigation',{name:'千管家页面'}).getByRole('button',{name:'账户管理',exact:true}).click();
 const saved=p.getByRole('region',{name:'我的千川账户',exact:true});expect(await saved.locator('tbody tr').count()).toBe(6);
 expect(await saved.innerText()).toContain('供应商目录未列出');
 await p.setViewportSize({width:360,height:900});expect(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
}finally{await p.close()}});
it('rejects a summary for a different day instead of relabelling its metrics',async()=>{const p=await fixture();try{
 await p.evaluate(()=>{(window as any).supplier.replyDate='2000-01-01'});
 await p.getByText('显示千管家',{exact:true}).click();await p.getByRole('alert').waitFor();
 expect(await p.getByTestId('qianguanjia-home').count()).toBe(0);expect(await p.locator('.qianguanjia-kpi dd').allTextContents()).toEqual(['—','—','—','—']);
 expect(await reads(p)).toEqual(['discover','accounts','home']);
}finally{await p.close()}});
it('does not query future or empty dates and leaves the account navigation usable',async()=>{const p=await fixture();try{
 await p.getByText('显示千管家',{exact:true}).click();await p.getByTestId('qianguanjia-home').waitFor();
 await p.getByLabel('汇总日期（北京时间）',{exact:true}).fill('2099-01-01');expect(await p.getByRole('button',{name:'刷新数据',exact:true}).isDisabled()).toBe(true);
 await p.getByLabel('汇总日期（北京时间）',{exact:true}).fill('');expect(await p.getByRole('button',{name:'刷新数据',exact:true}).isDisabled()).toBe(true);
 expect(await reads(p)).toEqual(['discover','accounts','home']);
 await p.getByRole('navigation',{name:'千管家页面'}).getByRole('button',{name:'账户管理',exact:true}).click();expect(await p.getByRole('region',{name:'我的千川账户',exact:true}).locator('tbody tr').count()).toBe(6);
}finally{await p.close()}});
it('refreshes the authorized account directory even when the summary date is empty',async()=>{const p=await fixture();try{
 await p.getByText('显示千管家',{exact:true}).click();await p.getByTestId('qianguanjia-home').waitFor();await p.getByLabel('汇总日期（北京时间）',{exact:true}).fill('');
 await p.getByRole('navigation',{name:'千管家页面'}).getByRole('button',{name:'账户管理',exact:true}).click();
 expect(await p.getByRole('button',{name:'刷新数据',exact:true}).isEnabled()).toBe(true);
 await p.getByRole('button',{name:'刷新数据',exact:true}).click();await p.getByRole('cell',{name:'已授权账户',exact:false}).waitFor();
 expect(await reads(p)).toEqual(['discover','accounts','home','accounts']);expect(await p.getByRole('alert').count()).toBe(0);
}finally{await p.close()}});
it('keeps a chosen page directory when the home date is invalid, without sending an invalid home query',async()=>{const p=await fixture('multiple');try{
 await p.getByText('显示千管家',{exact:true}).click();await p.getByRole('combobox',{name:'千管家页面',exact:true}).waitFor();
 await p.getByLabel('汇总日期（北京时间）',{exact:true}).fill('');await p.getByRole('combobox',{name:'千管家页面',exact:true}).selectOption('11111111-1111-4111-8111-111111111112');
 await p.waitForFunction(()=>(window as any).supplier.reads.length===2);await p.getByRole('navigation',{name:'千管家页面'}).getByRole('button',{name:'账户管理',exact:true}).click();
 await p.getByRole('cell',{name:'已授权账户',exact:false}).waitFor();expect(await reads(p)).toEqual(['discover','accounts']);expect(await p.getByRole('alert').count()).toBe(0);
}finally{await p.close()}});
