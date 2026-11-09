import {expect} from '@playwright/test';
export async function graphSettings(page, operations=false){
  const button=page.getByRole('button',{name:'图谱选项',exact:true});
  if(await button.getAttribute('aria-expanded')!=='true')await button.click();
  if(operations){const details=page.getByRole('region',{name:'图谱选项',exact:true}).locator('details');if(!await details.getAttribute('open')){if(await details.getAttribute('open')===null)await details.locator('summary').click();}}
}
export async function graphView(page,view){
  await graphSettings(page);await page.getByRole('combobox',{name:'图谱视图',exact:true}).selectOption(view);
  await page.getByRole('button',{name:'关闭图谱选项',exact:true}).click();
  await expect(page.getByRole('button',{name:'图谱选项',exact:true})).toBeFocused();
}
export async function graphExamples(page){
  const details=page.getByRole('complementary',{name:'选中节点',exact:true}).locator('details');
  if(await details.getAttribute('open')===null)await details.locator('summary').click();
}
