async page => {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/three.min.js',r=>r.abort());await page.route('**/three@0.128.0/**',r=>r.abort());
  await page.reload();await page.getByRole('button',{name:'Bookshelf builder',exact:true}).click();
  const message=await page.locator('#bs3d').innerText(), drawing=await page.locator('#bsDrawing svg').count();
  await page.getByRole('textbox',{name:'Design name',exact:true}).fill('Fallback drawing design');
  await page.getByRole('button',{name:'Save design',exact:true}).click();await page.reload();
  await page.getByRole('button',{name:'Bookshelf builder',exact:true}).click();
  const persisted=await page.getByRole('textbox',{name:'Design name',exact:true}).inputValue();
  const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download cut list',exact:true}).click();const download=await event;
  await download.saveAs('output/playwright/fallback-cut-list.csv');
  const result={messageExplains3D:message.includes('3D needs'),drawingAvailable:drawing===1,savedWithout3D:persisted==='Fallback drawing design',downloaded:!!download.suggestedFilename(),errors};
  if(!result.messageExplains3D||!result.drawingAvailable||!result.savedWithout3D||!result.downloaded||errors.length)throw new Error(JSON.stringify(result));
  return result;
}
