import { test, expect, type TestInfo, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const screenshotPath = (testInfo: TestInfo, name: string) => process.env.R1_SCREENSHOTS ? resolve(process.env.R1_SCREENSHOTS, name) : testInfo.outputPath(name);
/** Native range value setter, not Playwright fill() (which does not support range). */
async function seekRange(page: Page, seconds: number) {
  const range = page.getByLabel('Timeline seek');
  await range.evaluate((element, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!setter) throw new Error('Native slider setter unavailable');
    setter.call(element, String(value));
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, seconds);
  await expect(range).toHaveValue(String(seconds));
}
const pages = [['Thiết lập project','/'],['Tổng quan','/overview'],['External ChatGPT','/external'],['Kịch bản','/script'],['Voice & Captions','/voice'],['Storyboard & Image','/storyboard'],['Video Editor','/editor'],['Render & Export','/render'],['Cài đặt & chẩn đoán','/settings']];
for (const [name,path] of pages) test(`${name} renders`, async({page})=>{await page.goto(`#${path}`);await expect(page.getByRole('link',{name:new RegExp(name),current:'page'})).toBeVisible();});
test('editor timeline, inspector, modes and splitter stay synchronized', async({page})=>{await page.setViewportSize({width:1280,height:720});await page.goto('#/editor');const preview=page.locator('.portrait-preview');await page.getByLabel('Layer name').fill('hero_a');await expect(page.locator('.inspector .badge',{hasText:'EDITED'})).toBeVisible();await page.getByText('S01-B',{exact:true}).first().click();await expect(preview).toHaveAttribute('data-preview-shot','S01-B');await expect(page.getByLabel('Layer name')).toHaveValue('stickman_02');await page.getByLabel('Layer name').fill('hero_b');await page.getByText('S01-A',{exact:true}).first().click();await expect(page.getByLabel('Layer name')).toHaveValue('hero_a');await page.getByRole('tab',{name:'motion'}).click();await expect(page.locator('[data-inspector-content="motion"]')).toBeVisible();await page.getByRole('tab',{name:'style'}).click();await expect(page.locator('[data-inspector-content="style"]')).toBeVisible();await page.getByRole('tab',{name:'layer'}).click();await page.getByRole('button',{name:/Reset S01-A edits/}).click();await expect(page.getByLabel('Layer name')).toHaveValue('stickman_01');await expect(page.locator('.inspector .badge',{hasText:'EDITED'})).toHaveCount(0);await seekRange(page,9.25);await expect(preview).toHaveAttribute('data-preview-shot','S02-A');await page.getByLabel('Previous shot').click();await expect(preview).toHaveAttribute('data-preview-shot','S01-B');await page.getByLabel('Next shot').click();await expect(preview).toHaveAttribute('data-preview-shot','S02-A');await page.getByLabel('SFX clip Tick').click();await expect(preview).toHaveAttribute('data-preview-shot','S02-A');await seekRange(page,3.75);await page.getByRole('button',{name:/Play demo/}).click();await expect(preview).toHaveAttribute('data-preview-shot','S01-B',{timeout:1500});await page.getByRole('button',{name:/Pause/}).click();await seekRange(page,29.75);await page.getByRole('button',{name:/Play demo/}).click();await expect(page.getByRole('button',{name:/Play demo/})).toBeVisible({timeout:1500});await page.getByRole('tab',{name:/Native Preview/}).click();await expect(page.getByText('NO ACTUAL MP4')).toBeVisible();await page.getByRole('button',{name:'QA Details'}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.getByLabel('Close QA Details').click();for(const track of ['Scenes','Layers','Captions','Narration','SFX','Ambience'])await expect(page.locator(`[data-track="${track}"]`)).toBeInViewport();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1)).toBeTruthy();const sep=page.getByRole('separator');await sep.focus();await sep.press('ArrowUp');await expect(sep).toHaveAttribute('aria-valuenow','254');await sep.press('Home');await expect(sep).toHaveAttribute('aria-valuenow','244');});
test('captures V3 parity evidence in same editor state and viewport', async ({ page }, testInfo) => {
  const mockup = pathToFileURL(resolve('..', 'docs', 'ui', 'mockups', 'v3', 'vertical-stickman-ui-mockup-v3.html')).href;
  const sizes = [{width:1280,height:720},{width:1440,height:800},{width:1600,height:900},{width:1656,height:790}];
  const report: Array<{viewport:string;app:Record<string, unknown>;reference:Record<string, unknown>;findings:string[]}> = [];
  const baseDir = dirname(screenshotPath(testInfo, 'app-editor-1280x720.png'));
  await mkdir(baseDir, { recursive: true });
  const geometry = async (selector: string) => {
    const node = page.locator(selector).first();
    const rect = await node.boundingBox();
    return rect ? { x:Math.round(rect.x), y:Math.round(rect.y), width:Math.round(rect.width), height:Math.round(rect.height) } : null;
  };
  for (const size of sizes) {
    await page.setViewportSize(size);
    await page.goto('http://127.0.0.1:4173/#/editor');
    await page.evaluate(() => document.fonts.ready);
    for (const track of ['Scenes','Layers','Captions','Narration','SFX','Ambience']) await expect(page.locator(`[data-track="${track}"]`)).toBeInViewport();
    await expect(page.locator('.portrait-preview')).toBeInViewport();
    await expect(page.locator('.preview-controls')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight+1 && document.documentElement.scrollWidth <= innerWidth+1)).toBe(true);
    const appMeasurements = {
      left:await geometry('.scenes-panel'), center:await geometry('.portrait-preview'),
      right:await geometry('.inspector'), toolbar:await geometry('.editor-toolbar'),
      timeline:await geometry('.editor-timeline'), trackCount:await page.locator('.timeline-track').count(),
      font:await page.locator('.editor-page').evaluate(el => getComputedStyle(el).fontFamily),
      leftSurface:await page.locator('.scenes-panel').evaluate(el => ({ background:getComputedStyle(el).backgroundImage, padding:getComputedStyle(el).padding, color:getComputedStyle(el).color })),
      previewText:await page.locator('.portrait-preview header small').innerText()
    };
    const appImage = await page.screenshot({path:screenshotPath(testInfo,`app-editor-${size.width}x${size.height}.png`)});
    await page.goto(mockup);
    await page.locator('[data-page="motion"]').first().click();
    await page.evaluate(() => {
      (window as typeof window & { editorSeek: (t: number) => void }).editorSeek(0);
      return document.fonts.ready;
    });
    await expect(page.locator('.ed-stage')).toBeVisible();
    const referenceMeasurements = {
      left:await geometry('.ed-library'), center:await geometry('.ed-stage'),
      right:await geometry('.ed-inspector'), toolbar:await geometry('.ed-modebar'),
      timeline:await geometry('.ed-timeline-card'), trackCount:await page.locator('.ed-track-row').count(),
      font:await page.locator('.ed-root').evaluate(el => getComputedStyle(el).fontFamily),
      leftSurface:await page.locator('.ed-library').evaluate(el => ({ background:getComputedStyle(el).backgroundImage, padding:getComputedStyle(el).padding, color:getComputedStyle(el).color })),
      previewText:await page.locator('.ed-stage-top .tiny-label').innerText()
    };
    const referenceImage=await page.screenshot({path:screenshotPath(testInfo,`reference-v3-editor-${size.width}x${size.height}.png`)});
    const findings:string[]=[];
    for(const key of ['left','center','right','timeline'] as const) {
      const a = appMeasurements[key], b = referenceMeasurements[key];
      if(a && b) findings.push(`${key}: app ${a.width}×${a.height}px vs locked V3 ${b.width}×${b.height}px (width Δ ${a.width-b.width}px, height Δ ${a.height-b.height}px)`);
      else findings.push(`${key}: missing geometry, investigate the corresponding selector`);
    }
    findings.push(`tracks: app ${appMeasurements.trackCount} vs locked V3 ${referenceMeasurements.trackCount}; all six tracks must be visible`);
    findings.push(`toolbar: app ${appMeasurements.toolbar?.height ?? 'missing'}px vs locked V3 ${referenceMeasurements.toolbar?.height ?? 'missing'}px`);
    findings.push(`surface color/gradient: app ${JSON.stringify(appMeasurements.leftSurface)} vs locked V3 ${JSON.stringify(referenceMeasurements.leftSurface)}`);
    findings.push(`typography: app ${appMeasurements.font} vs reference ${referenceMeasurements.font}`);
    findings.push(`preview overlay labels: app "${appMeasurements.previewText}" vs locked V3 "${referenceMeasurements.previewText}"; differing artwork remains intentionally illustrative`);
    report.push({viewport:`${size.width}x${size.height}`,app:appMeasurements,reference:referenceMeasurements,findings});
    // Exact same viewport, fonts loaded and playhead at zero; capture an actual side-by-side PNG.
    await page.setViewportSize({width:size.width*2,height:size.height+40});
    await page.setContent(`<html><head><style>*{box-sizing:border-box}body{margin:0;background:#091625;color:#fff;font:14px Arial}main{display:flex}figure{margin:0;width:${size.width}px}figcaption{height:40px;padding:12px}img{display:block;width:${size.width}px;height:${size.height}px}</style></head><body><main><figure><figcaption>React R1 · ${size.width}×${size.height}</figcaption><img src="data:image/png;base64,${appImage.toString('base64')}"></figure><figure><figcaption>Locked V3 reference · ${size.width}×${size.height}</figcaption><img src="data:image/png;base64,${referenceImage.toString('base64')}"></figure></main></body></html>`);
    await page.locator('img').last().evaluate(img => (img as HTMLImageElement).decode());
    await page.screenshot({path:screenshotPath(testInfo,`side-by-side-${size.width}x${size.height}.png`)});
  }
  const outputRoot=process.env.R1_SCREENSHOTS ? resolve(process.env.R1_SCREENSHOTS,'..') : baseDir;
  await mkdir(outputRoot,{recursive:true});
  await writeFile(join(outputRoot,'visual-parity-report.json'),JSON.stringify({status:'PENDING_OWNER_VISUAL_REVIEW',head:process.env.R1_HEAD_SHA||'LOCAL_HEAD',report},null,2));
  const markdown = ['# R1 UI V3 visual parity · human review required','',
    'This report compares the **same viewport and first-shot/time-0 editor state** after fonts load. Screenshots alone are not proof of pixel-perfect parity.',
    'The React demo uses illustrative fixture art that intentionally differs from the locked HTML. Review column proportions, preview size, toolbar, six tracks, scrolling, colors and typography before accepting R1.',
    '',...report.flatMap(item => [`## ${item.viewport}`,'',...item.findings.map(v=>'- '+v),'',`Side-by-side: screenshots/side-by-side-${item.viewport}.png`,'']),
    '**Verdict: PENDING_OWNER_VISUAL_REVIEW**. No visual PASS is asserted automatically.'];
  await writeFile(join(outputRoot,'visual-parity-report.md'),markdown.join('\n'));
});
test('narrow layouts do not overflow horizontally', async({page})=>{for(const size of [{width:1050,height:850},{width:390,height:844}]){await page.setViewportSize(size);await page.goto('#/editor');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();}});
test('external prompts copy and export exactly the active prompt',async({page})=>{await page.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{value:{writeText:async(text:string)=>{(window as typeof window&{__copied?:string}).__copied=text}}})});await page.goto('#/external');await page.getByText('Storyboard',{exact:true}).click();const displayed=await page.locator('[data-active-prompt="Storyboard"]').innerText();await page.getByRole('button',{name:'Copy prompt'}).click();expect(await page.evaluate(()=>(window as typeof window&{__copied?:string}).__copied)).toBe(displayed);const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Export .md'}).click();const download=await downloadPromise;const path=await download.path();expect(path&&await readFile(path,'utf8')).toBe(displayed);await page.getByLabel('Import JSON').fill('{bad');await page.getByText('Validate syntax demo').click();await expect(page.getByRole('alert')).toBeVisible();await page.getByLabel('Import JSON').fill('{"demo":true}');await page.getByText('Validate syntax demo').click();await expect(page.getByText(/No artifact was imported or accepted/)).toBeVisible();});
test('script drafts stay isolated by section',async({page})=>{await page.goto('#/script');const editor=page.getByLabel('Script draft');await editor.fill('First section local edit');await page.getByText(/02 · Motivation follows action/).click();await expect(editor).not.toHaveValue('First section local edit');await editor.fill('Second section local edit');await page.getByText(/01 · The invisible loop/).click();await expect(editor).toHaveValue('First section local edit');await page.getByRole('button',{name:'Keep demo draft'}).click();await expect(page.getByText('SAVED DEMO DRAFT')).toBeVisible();await page.getByRole('button',{name:'Reset selected section'}).click();await expect(editor).not.toHaveValue('First section local edit');await page.getByText(/02 · Motivation follows action/).click();await expect(editor).toHaveValue('Second section local edit');});
test('storyboard selection remains interactive',async({page})=>{await page.goto('#/storyboard');await page.getByText(/S02-A · First small action/).click();await expect(page.getByText(/S02-A · First small action/).last()).toBeVisible();});

test('route navigation retains Script, External and Editor demo session fields', async ({page}) => {
  await page.goto('#/script');
  const draft=page.getByLabel('Script draft');
  await draft.fill('Persistent first section draft');
  await page.getByRole('button',{name:'Keep demo draft'}).click();
  await page.getByText(/02 · Motivation follows action/).click();
  await draft.fill('Unsaved second section');
  await page.getByRole('link',{name:/Tổng quan/}).click();
  await page.getByRole('link',{name:/Kịch bản/}).click();
  await expect(draft).toHaveValue('Unsaved second section');
  await page.getByText(/01 · The invisible loop/).click();
  await expect(draft).toHaveValue('Persistent first section draft');
  await page.getByRole('button',{name:'Reset selected section'}).click();
  await page.getByText(/02 · Motivation follows action/).click();
  await expect(draft).toHaveValue('Unsaved second section');
  await page.getByRole('link',{name:/External ChatGPT/}).click();
  await page.getByRole('button',{name:'Storyboard',exact:true}).click();
  await page.getByLabel('Import JSON').fill('{"session":true}');
  await page.getByRole('button',{name:'Validate syntax demo'}).click();
  await expect(page.getByText(/No artifact was imported or accepted/)).toBeVisible();
  await page.getByRole('link',{name:/Kịch bản/}).click();
  await page.getByRole('link',{name:/External ChatGPT/}).click();
  await expect(page.locator('[data-active-prompt="Storyboard"]')).toBeVisible();
  await expect(page.getByLabel('Import JSON')).toHaveValue('{"session":true}');
  await expect(page.getByText(/No artifact was imported or accepted/)).toBeVisible();
  await page.getByLabel('Import JSON').fill('{"changed":true}');
  await expect(page.getByText(/No artifact was imported or accepted/)).toHaveCount(0);
  await page.getByRole('link',{name:/Video Editor/}).click();
  await seekRange(page,9.25);
  await page.getByLabel('Layer name').fill('session_hero');
  await page.getByRole('tab',{name:'motion'}).click();
  const separator=page.getByRole('separator');
  await separator.focus();await separator.press('ArrowUp');
  await expect(separator).toHaveAttribute('aria-valuenow','254');
  await page.getByRole('link',{name:/Tổng quan/}).click();
  await page.getByRole('link',{name:/Video Editor/}).click();
  await expect(page.locator('.portrait-preview')).toHaveAttribute('data-preview-shot','S02-A');
  await expect(page.locator('[data-inspector-content="motion"]')).toBeVisible();
  await page.getByRole('tab',{name:'layer'}).click();
  await expect(page.getByLabel('Layer name')).toHaveValue('session_hero');
  await expect(page.getByRole('separator')).toHaveAttribute('aria-valuenow','254');
  await page.getByRole('button',{name:/Play demo/}).click();
  await page.getByRole('link',{name:/Tổng quan/}).click();
  await page.getByRole('link',{name:/Video Editor/}).click();
  await expect(page.getByRole('button',{name:/Play demo/})).toBeVisible();
});
test('B1–B4 style ID updates Project, Editor, External and Overview',async({page})=>{
  await page.goto('#/');
  for(const style of ['B3 · Retro TV','B2 · Colorful Hand-Drawn','B1 · Minimal Hand-Drawn','B4 · Survival Thriller']) {
    await page.getByRole('button',{name:new RegExp(style.split(' · ')[0]+' ·')}).click();
    await expect(page.locator('.project-chip')).toContainText(style);
    await page.getByRole('link',{name:/Video Editor/}).click();
    await expect(page.locator('.portrait-preview header small')).toContainText(style);
    await page.getByRole('tab',{name:'style'}).click();
    await expect(page.locator('.style-swatch')).toContainText(style);
    await page.getByRole('link',{name:/External ChatGPT/}).click();
    await page.getByRole('button',{name:'Storyboard',exact:true}).click();
    await expect(page.locator('[data-active-prompt="Storyboard"]')).toContainText(style);
    await page.getByRole('link',{name:/Tổng quan/}).click();
    await expect(page.locator('.stats').first()).toContainText(style);
    await page.getByRole('link',{name:/Thiết lập project/}).click();
  }
});
test('scene clip geometry and playhead use one time scale',async({page})=>{
  await page.goto('#/editor');
  const scene=page.locator('[data-track="Scenes"] .track-lane button');
  const clips=await scene.evaluateAll(elements=>elements.map(el=>{
    const node=el as HTMLElement;const rect=node.getBoundingClientRect();
    return {start:Number(node.dataset.start),duration:Number(node.dataset.duration),x:rect.x,width:rect.width};
  }));
  expect(clips.map(c=>[c.start,c.duration])).toEqual([[0,4],[4,5],[9,4],[13,6],[19,5],[24,6]]);
  for(let i=0;i<clips.length-1;i++)expect(Math.abs(clips[i].x+clips[i].width-clips[i+1].x)).toBeLessThan(1.1);
  for(const [time,shot] of [[4,'S01-B'],[9,'S02-A'],[30,'S03-B']] as const){
    await seekRange(page,time);
    await expect(page.locator('.portrait-preview')).toHaveAttribute('data-preview-shot',shot);
    const playhead=await page.locator('.playhead').boundingBox();
    const lane=await page.locator('[data-track="Scenes"] .track-lane').boundingBox();
    expect(playhead&&lane&&Math.abs(playhead.x - (lane.x + time*26))).toBeLessThan(1.1);
  }
  await page.getByLabel('SFX clip Tick').click();
  await expect(page.locator('.portrait-preview')).toHaveAttribute('data-preview-shot','S03-B');
});
