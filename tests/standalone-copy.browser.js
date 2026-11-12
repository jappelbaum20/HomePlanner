async page => {
  const openMore = async () => { if (!(await page.locator('#bsMore').evaluate(d => d.open))) await page.locator('#bsMore summary').click(); }, openMenu = async () => { if (await page.locator('#myDesignsMenu').isHidden()) await page.locator('#myDesigns').click(); };
  const origin='http://127.0.0.1:8765';
  await page.goto(origin+'/home');
  await page.evaluate(() => localStorage.setItem('houseplanner.anonymous.v3', JSON.stringify({version:2,name:'Fictional home',rooms:[{id:'fixture',name:'Fixture room',width:420,length:310,height:250,walls:{n:'#112233',s:'#eeeeee',e:'#eeeeee',w:'#eeeeee'},items:[],openings:[],photos:[],photoLabels:{}}],catalog:[]})));
  await page.reload(); await page.getByRole('button',{name:'Bookshelf builder',exact:true}).click();
  await page.locator('[data-bs="width"]').fill('180'); await page.locator('[data-bs="offset"]').fill('25');
  await page.locator('[data-bs-action="save"]').click();
  const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('houseplanner.anonymous.v3')));
  await page.getByRole('button',{name:'Copy to standalone bookshelf'}).click(); await page.waitForURL('**/bookshelf');
  await page.locator('[data-bs="wallWidth"]').waitFor(); await openMore();
  const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('houseplanner.anonymous.v3')));
  if(JSON.stringify(before)!==JSON.stringify(after)) throw Error('source home changed during copy');
  if(await page.locator('[data-bs="wallWidth"]').inputValue()!=='420' || await page.locator('[data-bs="wallHeight"]').inputValue()!=='250' || await page.locator('[data-bs="offset"]').inputValue()!=='25' || await page.locator('[data-bs="width"]').inputValue()!=='180') throw Error('copy lost wall, placement or geometry');
  return ['home copy creates independent wall and geometry', 'home source unchanged by copy'];
}
