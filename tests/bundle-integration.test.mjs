import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {request,chromium,expect} from '@playwright/test';
import {startNativeRuntime} from '../scripts/native-runtime.mjs';
test('native bundle discovers seven plugins, supports whole group and leaf UI toggles',{timeout:90000},async()=>{
  const runtime=await startNativeRuntime({bundle:true,testModel:true}),origin=new URL(runtime.authUrl).origin,api=await request.newContext({baseURL:origin,extraHTTPHeaders:{origin}}),browser=await chromium.launch({headless:true}),page=await browser.newPage();
  try{
    await api.get(runtime.authUrl);
    async function raw(method,args={}){const response=await api.post(`/api/${method}`,{data:{type:'client-request',rpcId:randomUUID(),method,payload:{args}}});return response.status()===404?{ok:false}: (await response.json()).result;}
    async function call(method,args){const result=await raw(method,args);assert.equal(result.ok,true,JSON.stringify(result));return result.value;}
    const groups=await call('pluginManager/listBundles',{}),group=groups.find(row=>row.name==='@oh-my-student/dsh-bundle');assert.ok(group,JSON.stringify(groups));assert.equal(group.rows.length,7);
    await expect.poll(async()=>Boolean((await raw('notaraVault/query',{input:{}})).ok)).toBe(true);
    await page.goto(runtime.authUrl);await page.getByRole('button',{name:/^(Continue|继续)$/}).click();await expect(page.getByRole('button',{name:'插件',exact:true})).toBeVisible();await expect(page.locator('.nv-vault-sidebar')).toBeVisible();
    const leaf=group.rows.find(row=>row.rowId==='notara-home-recommend');assert.ok(leaf?.entryId);
    await call('pluginManager/setPluginEnabled',{id:leaf.entryId,enabled:false});await expect(page.locator('.nr-home')).toHaveCount(0);assert.equal((await raw('notaraVault/query',{input:{}})).ok,true);
    await call('pluginManager/setPluginEnabled',{id:leaf.entryId,enabled:true});await expect(page.locator('.nr-home')).toHaveCount(0);await expect(page.locator('[data-composer-input]:visible')).toBeVisible();
    await call('pluginManager/setBundleEnabled',{name:'@oh-my-student/dsh-bundle',enabled:false});await expect.poll(async()=>Boolean((await raw('notaraVault/query',{input:{}})).ok)).toBe(false);await expect(page.getByRole('button',{name:'插件',exact:true})).toHaveCount(0);
    await call('pluginManager/setBundleEnabled',{name:'@oh-my-student/dsh-bundle',enabled:true});await expect.poll(async()=>Boolean((await raw('notaraVault/query',{input:{}})).ok)).toBe(true);await expect(page.getByRole('button',{name:'插件',exact:true})).toBeVisible();
  }finally{await api.dispose();await browser.close();await runtime.stop();}
});
