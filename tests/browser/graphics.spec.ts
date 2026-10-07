import {test,expect} from '@playwright/test';
import {start,scene,state} from './helpers';

test('graphics quality changes resolution without losing progress, survives reload and resizes',async({page})=>{
 test.setTimeout(90000);const errors:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await start(page);const before=await state(page);const s=await scene(page);
 expect(s.quality).toBe('high');expect(s.canvas.width).toBe(2160);expect(s.shadowsEnabled).toBe(true);expect(s.contactOcclusion).toBe(true);
 const radius=s.depthOfField.maxRadiusCssPixels;const picker=page.getByRole('combobox',{name:'Graphics quality'});
 await page.locator('[data-action=menu]').click();await picker.selectOption('cinematic');
 expect((await scene(page)).quality).toBe('cinematic');expect((await scene(page)).canvas.width).toBe(2880);
 const cinema=await scene(page);expect(cinema.depthOfField.maxRadiusPixels/cinema.pixelRatio).toBeCloseTo(radius,4);
 await picker.selectOption('balanced');expect((await scene(page)).quality).toBe('balanced');
 expect((await scene(page)).canvas.width).toBe(1440);expect((await state(page)).chapter).toEqual(before.chapter);expect((await state(page)).brief).toEqual(before.brief);
 const balanced=await scene(page);expect(balanced.depthOfField.maxRadiusPixels/balanced.pixelRatio).toBeCloseTo(radius,4);
 expect(balanced.contactOcclusion).toBe(false);expect(balanced.shadow.size).toEqual([2048,2048]);
 await picker.selectOption('low');const low=await scene(page);
 expect(low.quality).toBe('low');expect(low.filmFinish).toBe(false);expect(low.contactOcclusion).toBe(false);expect(low.shadowsEnabled).toBe(false);expect(low.depthOfField).toBeNull();expect(low.fogFar).toBe(1000);
 await expect.poll(async()=>(await scene(page)).drawCalls).toBeLessThan(s.drawCalls);
 await picker.selectOption('balanced');
 await page.reload();await page.locator('[data-action=resume]').click();expect((await scene(page)).quality).toBe('balanced');
 await page.setViewportSize({width:1920,height:1080});await expect.poll(async()=>(await scene(page)).canvas.width).toBe(1920);
 await page.locator('[data-action=menu]').click();await picker.selectOption('cinematic');
 await expect.poll(async()=>(await scene(page)).canvas.width).toBe(2880);
 await page.getByRole('button',{name:'Close dialog',exact:true}).click();
 await page.locator('[data-action=map]').click();await page.locator('[data-place=riverside-mural]').click();
 expect((await scene(page)).staticContacts.pip).toEqual([]);expect(errors).toEqual([]);
});

test('the opening screen offers the graphics tier before play begins',async({page})=>{
 await page.goto(`${process.env.GAME_PATH||'/'}?debug`);
 await page.getByRole('combobox',{name:'Graphics quality'}).selectOption('low');
 expect((await scene(page)).quality).toBe('low');await page.locator('[data-action="start"]').click();
 expect((await scene(page)).quality).toBe('low');
});

test('mural texture retains both outer sections and covers the full wall while Pip passes it',async({page})=>{
 test.setTimeout(60000);await start(page);
 const dimensions=await page.evaluate(async()=>{const image=new Image();image.src='/materials/video/river-of-life.webp';await image.decode();return [image.naturalWidth,image.naturalHeight];});
 expect(dimensions).toEqual([6144,1400]);
 await page.locator('[data-action=map]').click();await page.locator('[data-place=riverside-mural]').click();
 // Two continuous keyboard walks cover both ends from the central viewpoint.
 for(const key of ['a','d']){
  await page.locator('[data-action=map]').click();await page.locator('[data-place=riverside-mural]').click();
  await page.keyboard.down(key);
  if(key==='a')await expect.poll(async()=>(await scene(page)).position.x,{timeout:16000}).toBeGreaterThan(61.3);
  else await expect.poll(async()=>(await scene(page)).position.x,{timeout:16000}).toBeLessThan(36.2);
  await page.keyboard.up(key);const s=await scene(page);
  expect(s.staticContacts.pip).toEqual([]);expect(s.position.z).toBeLessThan(-6.5);expect(s.position.z).toBeGreaterThan(-9.4);
 }
});
