/** User-facing navigation shared by native UI checks. */
export async function chooseWorkspace(page, workspaceId) {
  await page.getByRole('button', { name: '切换工作区', exact: true }).click();
  await page.getByRole('menuitem').filter({ has: page.locator(`[data-workspace-option="${workspaceId}"]`) }).click();
}
export async function openLibrary(page) {
  await page.getByRole('tablist', { name: '工作区栏目' }).getByRole('tab', { name: '资料', exact: true }).click();
  await page.getByRole('button', { name: '资料库总览', exact: true }).click();
}
export async function chooseBaseView(page, name) {
  await page.getByRole('button', { name:'切换保存的视图', exact:true }).click();
  await page.getByRole('menuitem', { name, exact:true }).click();
}
export async function openDocumentSource(page, scope=page) {
  await scope.getByRole('button',{name:'查看源码',exact:true}).click();
}
export async function refreshDocument(page,scope=page) {
  const direct=scope.getByRole('button',{name:'刷新当前资料',exact:true});
  if(await direct.isVisible()){await direct.click();return;}
  await scope.getByRole('button',{name:'文档选项',exact:true}).click();
  await page.getByRole('menuitem',{name:'刷新当前资料',exact:true}).click();
}
export async function baseAction(page,scope,name){
  const direct=scope.getByRole('button',{name,exact:true});
  if(await direct.isVisible()){await direct.click();return;}
  await scope.getByRole('button',{name:'资料库操作',exact:true}).click();
  await page.getByRole('menuitem',{name,exact:true}).click();
}
export async function graphAction(page,scope,options){
  const action=scope.getByRole('button',options),trigger=scope.getByRole('button',{name:'图谱选项',exact:true});
  if(!await action.isVisible())await trigger.click();
  await action.click();
  if(await trigger.getAttribute('aria-expanded')==='true'&&!await page.getByRole('dialog').isVisible())await trigger.click();
}
export async function graphSelect(page,scope,label,value){
  const field=scope.getByLabel(label,{exact:true}),trigger=scope.getByRole('button',{name:'图谱选项',exact:true});
  if(!await field.isVisible())await trigger.click();
  await field.selectOption(value);
  if(await trigger.getAttribute('aria-expanded')==='true')await trigger.click();
}
export async function blurDocumentEditor(page,scope=page) {
  await scope.getByRole('button',{name:'文档选项',exact:true}).click();
  await page.keyboard.press('Escape');
}
export async function openGraph(page) {
  const existing=page.locator('.nv-doc-tab-chip').filter({hasText:/^知识图谱$/});
  if(await existing.count()){await existing.click();return;}
  await page.getByRole('tablist',{name:'工作区栏目'}).getByRole('tab',{name:'资料',exact:true}).click();
  await page.locator('.nv-left-files-body').getByRole('button',{name:'知识图谱',exact:true}).click();
}
export async function focusLibrary(page) {await page.locator('.nv-doc-tab-chip').filter({hasText:/^资料库$/}).click();}
export async function openPluginManager(page) {
  // rc.4 moved Settings from the sidebar footer into the account menu.
  await page.getByRole('button', { name: /^(Account menu|账号菜单)$/ }).click();
  await page.getByRole('menuitem', { name: /^(Settings|设置)/ }).click();
  const manage = page.getByRole('button', { name: '管理插件', exact: true });
  if (!await manage.isVisible()) await page.getByRole('button', { name: /^(通用设置|General|General settings)$/ }).click();
  await manage.click();
  await page.getByRole('heading', { name: /^(Plugins|插件)$/ }).waitFor();
}
