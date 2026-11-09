import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {mkdir,writeFile} from 'node:fs/promises';import {join} from 'node:path';import {chromium} from '@playwright/test';import {workspaceRoot} from '../scripts/native-runtime.mjs';
test('offscreen math export completes when a background tab does not receive animation frames',{timeout:20000},async()=>{
  const out=join(workspaceRoot,'outputs/jsxgraph-20261028');await mkdir(out,{recursive:true});
  await build({entryPoints:[join(workspaceRoot,'tests/fixtures/math-background.jsx')],bundle:true,outfile:join(out,'background.js'),format:'iife',platform:'browser',jsx:'automatic',logLevel:'warning',alias:{'@deepseek-ai/dsh-client-ui-primitives':join(workspaceRoot,'tests/fixtures/modal.jsx')}});
  await writeFile(join(out,'background.html'),'<!doctype html><html><meta charset="utf-8"><script src="background.js"></script>');const browser=await chromium.launch({headless:true}),page=await browser.newPage();
  try{await page.goto('file://'+join(out,'background.html'));const file=await page.evaluate(()=>window.renderWithoutAnimationFrames());assert.ok(file.dataURL.startsWith('data:image/svg+xml;base64,'));assert.equal(await page.locator('.nv-math-surface').count(),0);}finally{await browser.close();}
});
