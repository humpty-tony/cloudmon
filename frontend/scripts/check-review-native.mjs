import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
// Optional integration gate: the isolated Go review adapter must already hold
// the explicitly synthetic 108-record review fixture. No cloud/capture calls.
const url=process.env.CLOUDMON_REVIEW_URL;if(!url)throw Error('CLOUDMON_REVIEW_URL is required (isolated native review adapter only)');
const out=new URL('../test-results/review-native/',import.meta.url);await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:960}});page.setDefaultTimeout(8000);
const errors=[];page.on('pageerror',error=>errors.push(String(error)));
try{
 await page.goto(url);assert.equal(await page.evaluate(()=>!!window.go?.main?.App),true,'Native adapter required');
 await page.getByRole('button',{name:'Open saved evidence',exact:true}).click();await page.getByRole('region',{name:'Event results',exact:true}).getByText('108 events',{exact:true}).waitFor();
 const rows=page.locator('.workbench-results .row');
 const alice=()=>rows.filter({hasText:'legacy-alice'}).locator('.c-identity');
 await alice().hover();await alice().getByTitle(/^Filter for/).click();await page.getByRole('region',{name:'Event results',exact:true}).getByText('1 events',{exact:true}).waitFor();
 assert.equal(await rows.count(),1);assert.match(await rows.first().innerText(),/legacy-alice/);
 const actorQuery=await page.evaluate(()=>window.reviewCalls.filter(c=>c.method==='QuerySearch').at(-1).args[0]);
 assert.deepEqual(actorQuery.includes,{identityArn:['arn:aws:iam::111122223333:user/legacy-alice']});
 await page.screenshot({path:fileURLToPath(new URL('actor-native.png',out))});
 await page.getByRole('button',{name:'clear',exact:true}).click();await page.getByRole('region',{name:'Event results',exact:true}).getByText('108 events',{exact:true}).waitFor();
 await alice().hover();await alice().getByTitle(/^Filter out/).click();await page.getByRole('region',{name:'Event results',exact:true}).getByText('107 events',{exact:true}).waitFor();
 assert.equal(await rows.filter({hasText:'legacy-alice'}).count(),0);assert.equal(await rows.filter({hasText:'legacy-bob'}).count(),1);
 await page.getByRole('button',{name:'clear',exact:true}).click();await page.getByRole('region',{name:'Event results',exact:true}).getByText('108 events',{exact:true}).waitFor();
 await page.locator('.qbar-input').fill('eventName=DescribeInstances');await page.locator('.qbar-input').press('Enter');await page.getByRole('region',{name:'Event results',exact:true}).getByText('96 events',{exact:true}).waitFor();
 const grid=page.locator('.workbench-results .etbody');await grid.evaluate(e=>e.scrollTop=540);await page.waitForTimeout(120);await rows.nth(8).locator('.c-time').click();
 await page.locator('.qbar-input').fill('eventName=unapplied');
 const before=await grid.evaluate(e=>({scroll:e.scrollTop,seq:e.querySelector('.row--selected')?.getAttribute('data-event-seq')}));
 await page.getByRole('button',{name:'Hunt',exact:true}).click();const hunt=page.getByRole('main',{name:'Hunt workspace'});
 await hunt.getByRole('button',{name:'Paste multiple indicators',exact:true}).click();await hunt.getByLabel('Typed indicators',{exact:true}).fill('ip 198.51.100.44');await hunt.getByRole('button',{name:'Run hunt',exact:true}).click();
 await hunt.getByText('5 matched events · 108 events in scope',{exact:true}).waitFor();
 await hunt.getByRole('listitem').filter({hasText:'GetSecretValue'}).click();await hunt.getByRole('button',{name:'198.51.100.44',exact:true}).click();
 const pivot=page.getByRole('region',{name:'Hunt pivot results',exact:true});await pivot.getByText('5 matching events',{exact:true}).waitFor();
 const pivotQuery=await page.evaluate(()=>window.reviewCalls.filter(c=>c.method==='QuerySearch').at(-1).args[0]);
 assert.deepEqual(pivotQuery.includes,{sourceIPAddress:['198.51.100.44']});assert.equal(pivotQuery.expr,null);
 await pivot.locator('.row').filter({hasText:'GetSecretValue'}).locator('.c-time').click();
 await pivot.getByRole('tab',{name:'Original JSON',exact:true}).click();await pivot.locator('.ei-source').getByText(/soc-denied/).waitFor();
 await page.screenshot({path:fileURLToPath(new URL('hunt-pivot-native.png',out))});
 await pivot.getByRole('button',{name:'Back to Hunt',exact:true}).click();await hunt.getByText('5 matched events · 108 events in scope',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Events',exact:true}).click();await page.getByRole('region',{name:'Event results',exact:true}).getByText('96 events',{exact:true}).waitFor();
 await page.waitForTimeout(120);const after=await grid.evaluate(e=>({scroll:e.scrollTop,seq:e.querySelector('.row--selected')?.getAttribute('data-event-seq')}));
 assert.deepEqual(after,before);assert.equal(await page.locator('.qbar-input').inputValue(),'eventName=unapplied');
 await page.getByRole('button',{name:'Hunt',exact:true}).click();await hunt.getByRole('tab',{name:'Rules',exact:true}).click();
 const rules=hunt.locator('.hw-panel:visible');await rules.getByRole('button',{name:'Edit YAML',exact:true}).click();await rules.locator('.cm-content').fill('title: Review source IP\nlogsource:\n  product: aws\n  service: cloudtrail\ndetection:\n  selection:\n    sourceIPAddress: 198.51.100.44\n  condition: selection\nlevel: medium');
 await rules.getByRole('button',{name:'▶ Run',exact:true}).click();await rules.getByText('✓ Ran · 5 matches',{exact:true}).waitFor();
 await rules.locator('.etbody').focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');assert.equal(await rules.locator('.row--selected').count(),1);
 const first=await rules.locator('.row--selected').getAttribute('data-event-seq');await page.keyboard.press('ArrowDown');assert.notEqual(await rules.locator('.row--selected').getAttribute('data-event-seq'),first);
 await rules.getByRole('button',{name:'Close inspector',exact:true}).click();assert.equal(await rules.locator('.etbody').evaluate(e=>e===document.activeElement),true);await page.keyboard.press('Enter');
 await rules.getByRole('tab',{name:'Original JSON',exact:true}).click();await rules.locator('.ei-source').getByText(/eventID/).waitFor();
 await page.setViewportSize({width:1280,height:800});await page.screenshot({path:fileURLToPath(new URL('rules-native-1280.png',out))});
 const ruleRaw=await rules.locator('.ei-source').textContent();
 await page.getByRole('button',{name:'Events',exact:true}).click();
 await page.locator('.qbar-input').fill('eventName=PutBucketPolicy');await page.locator('.qbar-input').press('Enter');
 await page.getByRole('region',{name:'Event results',exact:true}).getByText('2 events',{exact:true}).waitFor();
 const inspector=page.getByRole('complementary',{name:'Event inspector',exact:true});
 const originals=[];
 for(const [index,id,side] of [[1,'research-a','A'],[0,'research-b','B']]){
  await rows.nth(index).locator('.c-time').click();await inspector.getByRole('tab',{name:'Original JSON',exact:true}).click();
  await inspector.locator('.ei-source').getByText(new RegExp(id)).waitFor();originals.push(await inspector.locator('.source-text').textContent());
  const pin=inspector.getByRole('button',{name:`Pin event ${side}`,exact:true});assert.ok(await pin.isVisible());assert.ok(await pin.isEnabled());
  assert.equal(await pin.evaluate(e=>!!e.closest('details')),false);await pin.click();
 }
 await inspector.getByRole('tab',{name:'Overview',exact:true}).click();await page.screenshot({path:fileURLToPath(new URL('pins-native-1280.png',out))});
 await page.getByRole('button',{name:'Compare events',exact:true}).click();
 const compare=page.getByRole('dialog',{name:'Compare original records',exact:true});
 const action='/requestParameters/policy/Statement/0/Action';
 for(const side of ['B','A']){
  const trigger=compare.getByRole('button',{name:`Inspect ${side} value at ${action}`,exact:true});await trigger.click();
  const value=page.getByRole('dialog',{name:`JSON value · ${side}`,exact:true});await value.locator('.source-text').waitFor();
  assert.deepEqual(JSON.parse(await value.locator('.source-text').textContent()),['s3:GetObject','s3:PutObject']);
  if(side==='B')await page.screenshot({path:fileURLToPath(new URL('comparison-value-native-1280.png',out))});
  await page.keyboard.press('Escape');assert.ok(await trigger.evaluate(e=>e===document.activeElement));
  if(side==='B')await compare.getByRole('button',{name:'Swap A/B',exact:true}).click();
 }
 for(const [side,index] of [['A',1],['B',0]]){
  await compare.getByRole('button',{name:`Open original ${side}`,exact:true}).click();
  const original=page.getByRole('dialog',{name:'Raw JSON',exact:true});await original.locator('.source-text').waitFor();
  assert.equal(await original.locator('.source-text').textContent(),originals[index]);await page.keyboard.press('Escape');
 }
 await page.keyboard.press('Escape');await page.getByRole('button',{name:'Clear comparison',exact:true}).click();
 assert.equal(await rows.count(),2);assert.deepEqual(errors,[]);
 await writeFile(new URL('verification.json',out),JSON.stringify({synthetic:true,nativeBackend:true,actorQuery,pivotQuery,workbenchBefore:before,workbenchAfter:after,ruleRaw,comparison:{path:action,swap:true,originalsUnchanged:true,visiblePins:true},calls:await page.evaluate(()=>window.reviewCalls),errors},null,2));
 console.log('PASS native App/DuckDB: all five review fixes; actor isolation, explicit Hunt scope/browse restoration, Rules keyboard, visible pins, exact comparison path values/swap/originals');
}finally{await browser.close()}
