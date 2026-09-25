import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = fileURLToPath(new URL("../test-results/inspector-dock/", import.meta.url));
const tests = [];
const test = (name, run) => tests.push({name, run});
const update = (page, props) => page.evaluate(props => window.inspectorDock.update(props), props);
const box = locator => locator.boundingBox();

test("dock layout fits and leaves useful context beside details", async page => {
  const inspector = page.getByRole("complementary", {name: "Event inspector"});
  assert.match(await inspector.getAttribute("class"), /event-inspector--dock/, "optional dock layout was ignored");
  for (const viewport of [{width:1440,height:960}, {width:1280,height:800}]) {
    await page.setViewportSize(viewport);
    const pane = await box(inspector), context = await box(inspector.locator(".ei-context"));
    const details = await box(inspector.locator(".ei-details"));
    assert.ok(Math.abs(pane.width - 1060) < 3 && Math.abs(pane.height - 300) < 3, JSON.stringify(pane));
    assert.ok(context.x + context.width <= details.x + 1, "context must sit left of details");
    assert.equal(await inspector.getByRole("tab", {name:"Context", exact:true}).getAttribute("aria-selected"), "true");
    assert.ok(await inspector.getByRole("button", {name:"Around this event", exact:true}).isVisible());
    assert.ok(await inspector.getByText("111122223333", {exact:true}).isVisible());
    assert.ok(await inspector.getByText("Human operator not verified.", {exact:false}).isVisible());
  }
});

test("Around delegates the exact selected event and optional snapshot", async page => {
  await page.getByRole("button", {name:"Around this event",exact:true}).click();
  assert.equal(await page.evaluate(() => window.inspectorDock.calls.length), 1, "Around opened the fallback instead of invoking onInvestigate");
  const call = await page.evaluate(() => window.inspectorDock.calls[0]);
  assert.equal(call.event.eventID, "synthetic-selected-event");
  assert.deepEqual(call.snapshot, {generation:"dock-fixture",maxSeq:30,capturedAt:"2026-09-24T10:00:00Z"});
  assert.equal(await page.getByRole("dialog").count(), 0);
  await update(page, {snapshot:undefined});
  assert.ok(await page.getByRole("button", {name:"Around this event",exact:true}).isEnabled(), "callback is allowed without a snapshot");
  await page.getByRole("button", {name:"Around this event",exact:true}).click();
  assert.equal(await page.evaluate(() => window.inspectorDock.calls[1].snapshot), undefined);
});

test("observed chain discloses exact node details without pivoting or inventing links", async page => {
  assert.equal(await page.getByRole("button", {name:/Inspect observed caller/}).count(), 2, "compact chain has no keyboard-operable caller nodes");
  assert.equal(await page.getByRole("region", {name:"Focused credential"}).count(), 0);
  const first = page.getByRole("button", {name:"Inspect observed caller 1: maya.chen",exact:true});
  const second = page.getByRole("button", {name:"Inspect observed caller 2: SecurityAudit",exact:true});
  const current = page.getByRole("button", {name:"Inspect selected-event identity: ProdDeploy",exact:true});
  const a = await box(first), b = await box(second), c = await box(current);
  assert.ok(a.x < b.x && b.x < c.x && Math.abs(a.y-c.y) < 2, "origin-first chain must be horizontal");
  await second.focus(); await page.keyboard.press("Enter");
  assert.equal(await second.getAttribute("aria-expanded"), "true");
  const detail = page.getByRole("region", {name:"Focused credential"});
  assert.ok(await detail.getByText("arn:aws:iam::444455556666:role/security/SecurityAudit", {exact:true}).isVisible());
  assert.ok(await detail.getByText("Exact returned access-key match; recorded lifetime checked", {exact:true}).isVisible());
  assert.ok(await detail.getByText("2026-09-24T09:41:32Z", {exact:true}).isVisible());
  assert.ok(await detail.getByText("Issued next credential", {exact:true}).isVisible(), "viaSeq is issuance performed BY the focused caller, not issuance TO that caller");
  assert.equal(await page.evaluate(() => window.inspectorDock.pivots.length), 0);
  await detail.getByRole("button", {name:"Filter focused principal",exact:true}).click();
  assert.deepEqual(await page.evaluate(() => window.inspectorDock.pivots[0]), ["identityArn", "arn:aws:sts::444455556666:assumed-role/SecurityAudit/maya-session", "include"]);
  await page.getByRole("button", {name:"Close credential details",exact:true}).click();
  assert.ok(await second.evaluate(el => el === document.activeElement), "closing details must return focus to the caller node");
  await page.getByRole("button", {name:"Expand selected-event lineage",exact:true}).click();
  assert.deepEqual(await page.evaluate(() => window.inspectorDock.calls[0]), {fullLineage:30});
});

test("issuance opens each exact linked record in the selected snapshot", async page => {
  await page.getByRole("button", {name:"Inspect observed caller 1: maya.chen",exact:true}).click();
  const original = page.getByRole("button", {name:"Original issuance #11",exact:true});
  assert.equal(await original.count(), 1, "linked cross-account observation has no original-record action");
  await original.click();
  const modal = page.getByRole("dialog", {name:"Lineage event",exact:true});
  await modal.waitFor();
  assert.deepEqual(await page.evaluate(() => window.inspectorDock.rawCalls), [{seq:11,snapshot:{generation:"dock-fixture",maxSeq:30,capturedAt:"2026-09-24T10:00:00Z"}}]);
  await modal.getByRole("button", {name:"Original JSON",exact:true}).click();
  assert.ok(await page.getByRole("dialog", {name:"Raw JSON"}).getByText('9007199254740993', {exact:false}).isVisible());
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  assert.ok(await original.evaluate(el => el === document.activeElement));
  await page.getByRole("button", {name:"Sources for issuance #10",exact:true}).click();
  await page.getByRole("dialog", {name:"Source evidence",exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(() => window.inspectorDock.evidenceCalls[0]), {seq:10,offset:0,snapshot:{generation:"dock-fixture",maxSeq:30,capturedAt:"2026-09-24T10:00:00Z"}});
  await page.keyboard.press("Escape");
  assert.ok(await page.getByRole("button", {name:"Sources for issuance #10",exact:true}).evaluate(el => el === document.activeElement));
  assert.equal(await page.evaluate(() => window.inspectorDock.calls.length), 0, "viewing issuance must not replace the Around anchor");
  await page.evaluate(() => { window.inspectorDock.failRaw = true; });
  await page.getByRole("button", {name:"Original issuance #10",exact:true}).click();
  await page.getByRole("alert").filter({hasText:"Issuance storage unavailable"}).waitFor();
  await page.evaluate(() => { window.inspectorDock.failRaw = false; });
  await page.getByRole("button", {name:"Retry issuance #10",exact:true}).click();
  await page.getByRole("dialog", {name:"Lineage event",exact:true}).waitFor();
  await page.keyboard.press("Escape");
  await update(page, {snapshot:undefined});
  await page.getByRole("button", {name:"Inspect observed caller 1: maya.chen",exact:true}).click();
  assert.ok(await page.getByRole("button", {name:"Original issuance #10",exact:true}).isDisabled(), "cannot load issuance from an unpinned dataset");
});

test("detail tabs lazily start one bounded field worker and retain local context", async page => {
  assert.equal(await page.evaluate(() => window.inspectorDock.workerLoads), 0, "default Context must not parse large raw records in a hidden field worker");
  await page.getByRole("button", {name:"Inspect observed caller 1: maya.chen",exact:true}).click();
  await page.getByRole("tab", {name:"Context",exact:true}).focus();
  await page.keyboard.press("ArrowRight");
  const fields = page.getByRole("region", {name:"Event fields",exact:true});
  await fields.getByText("9007199254740993", {exact:true}).waitFor();
  assert.ok(await fields.getByText("0.123456789012345678901", {exact:true}).isVisible());
  await fields.getByRole("button", {name:/items/}).click();
  await fields.getByTitle("items.0", {exact:true}).waitFor();
  assert.ok(await fields.locator(".ft-row").count() < 30, "20,000 items must not mount unbounded rows");
  await page.getByRole("tab", {name:"Fields",exact:true}).focus();
  await page.keyboard.press("End");
  assert.equal(await page.getByRole("tab", {name:"Original JSON",exact:true}).getAttribute("aria-selected"), "true");
  assert.ok((await page.locator(".ei-source").textContent()).includes("9007199254740993"));
  await page.getByRole("button", {name:"Open full JSON",exact:true}).click();
  await page.getByRole("dialog", {name:"Raw JSON",exact:true}).waitFor();
  await page.keyboard.press("Escape");
  assert.ok(await page.getByRole("button", {name:"Open full JSON",exact:true}).evaluate(el => el === document.activeElement));
  await page.getByRole("tab", {name:"Fields",exact:true}).click();
  assert.equal(await fields.getByRole("button", {name:/items/}).getAttribute("aria-expanded"), "true");
  assert.equal(await page.evaluate(() => window.inspectorDock.workerLoads), 1, "switching modes reparsed the same event");
  await page.getByRole("tab", {name:"Context",exact:true}).click();
  assert.equal(await page.getByRole("button", {name:"Inspect observed caller 1: maya.chen",exact:true}).getAttribute("aria-expanded"), "true", "switching modes discarded the focused credential");
});

test("detail mode follows browsing selection without keeping old evidence", async page => {
  await page.getByRole("tab",{name:"Fields",exact:true}).click();
  await page.getByRole("region",{name:"Event fields",exact:true}).getByText("9007199254740993",{exact:true}).waitFor();
  await page.evaluate(async()=>{
    const {event}=await import("/scripts/fixtures/inspector-dock.tsx");
    window.inspectorDock.update({event:{...event,seq:29,eventID:"next-event"},rawJSON:'{"eventID":"next-event"}'});
  });
  assert.equal(await page.getByRole("tab",{name:"Fields",exact:true}).getAttribute("aria-selected"),"true","Changing the selected event reset the chosen inspector mode");
  await page.getByRole("region",{name:"Event fields",exact:true}).getByText("next-event",{exact:true}).waitFor();
  assert.equal(await page.getByText("9007199254740993",{exact:true}).count(),0,"Previous-event fields survived a new selection");
  await page.getByRole("tab",{name:"Original JSON",exact:true}).click();
  await page.evaluate(async()=>{
    const {event}=await import("/scripts/fixtures/inspector-dock.tsx");
    window.inspectorDock.update({event:{...event,seq:28,eventID:"third-event"},rawJSON:'{"eventID":"third-event"}'});
  });
  assert.equal(await page.getByRole("tab",{name:"Original JSON",exact:true}).getAttribute("aria-selected"),"true");
  assert.equal(JSON.parse(await page.locator(".ei-source").textContent()).eventID,"third-event");
});

// Resolve only when the test chooses; drain React commits, not a timing guess.
const settleIssuance = async page => page.evaluate(async () => {
  window.inspectorDock.resolveRaw();
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
});
const startDelayedIssuance = async page => {
  await page.evaluate(() => { window.inspectorDock.delayRaw = true; });
  const caller = page.getByRole("button", {name:"Inspect observed caller 1: maya.chen",exact:true});
  if (await caller.getAttribute("aria-expanded") !== "true") await caller.click();
  await page.getByRole("button", {name:"Original issuance #10",exact:true}).click();
  await page.getByRole("status").filter({hasText:"Loading issuance #10"}).waitFor();
  assert.equal(await page.evaluate(() => typeof window.inspectorDock.resolveRaw), "function");
};
const assertUsableFocus = async page => assert.ok(await page.evaluate(() => {
  const active = document.activeElement;
  return active instanceof HTMLElement && active.isConnected && !active.closest('[hidden],[inert]') && active.getClientRects().length > 0;
}), "focus returned to a hidden, inert or detached control");

for (const mode of ["Fields", "Original JSON"]) {
  for (const returnFirst of [false, true]) {
    test(`issuance lifecycle: Context to ${mode}${returnFirst ? " and back before resolution" : " before resolution"}`, async page => {
      await startDelayedIssuance(page);
      await page.getByRole("tab", {name:mode,exact:true}).click();
      if (mode === "Fields") await page.getByRole("region", {name:"Event fields",exact:true}).getByText("9007199254740993", {exact:true}).waitFor();
      if (returnFirst) await page.getByRole("tab", {name:"Context",exact:true}).click();
      await settleIssuance(page);
      assert.equal(await page.getByRole("dialog").count(), 0, `obsolete issuance opened after Context → ${mode}${returnFirst ? " → Context" : ""}`);
      await assertUsableFocus(page);
      await page.getByRole("tab", {name:"Context",exact:true}).click();
      assert.equal(await page.getByRole("button", {name:"Inspect observed caller 1: maya.chen",exact:true}).getAttribute("aria-expanded"), "true", "mode invalidation discarded local expansion");
      assert.equal(await page.getByText("Loading issuance #10…", {exact:true}).count(), 0, "obsolete request was restarted on return");
      assert.equal(await page.evaluate(() => window.inspectorDock.rawCalls.length), 1, "return must require a fresh deliberate issuance click");
      // A new click works even if its sequence is identical to the cancelled request.
      await page.evaluate(() => { window.inspectorDock.delayRaw = false; });
      await page.getByRole("button", {name:"Original issuance #10",exact:true}).click();
      await page.getByRole("dialog", {name:"Lineage event",exact:true}).waitFor();
      await page.keyboard.press("Escape");
      assert.ok(await page.getByRole("button", {name:"Original issuance #10",exact:true}).evaluate(el => el === document.activeElement));
      if (mode === "Fields") {
        await page.getByRole("tab", {name:"Fields",exact:true}).click();
        assert.equal(await page.evaluate(() => window.inspectorDock.workerLoads), 2, "field worker was recreated (one selected record plus one new issuance)");
      }
    });
  }
}

for (const returnFirst of [false,true]) {
  test(`workspace deactivation retires issuance${returnFirst ? " even after return" : " while hidden"}`, async page => {
    await startDelayedIssuance(page);
    await page.getByRole("button",{name:"Other workspace",exact:true}).click();
    if (returnFirst) await page.getByRole("button",{name:"Return to review",exact:true}).click();
    await settleIssuance(page);
    assert.equal(await page.getByRole("dialog").count(),0,"obsolete issuance escaped its workspace lifetime");
    if (!returnFirst) await page.getByRole("button",{name:"Return to review",exact:true}).click();
    assert.equal(await page.getByRole("dialog").count(),0,"return resurrected retired evidence");
    assert.equal(await page.getByText("Loading issuance #10…",{exact:true}).count(),0);
    assert.equal(await page.getByRole("button",{name:"Inspect observed caller 1: maya.chen",exact:true}).getAttribute("aria-expanded"),"true");
    assert.equal(await page.evaluate(()=>window.inspectorDock.rawCalls.length),1);
    await assertUsableFocus(page);
  });
}

for (const action of ["Sources & hashes", "Sources for issuance #10", "Open full JSON", "Around this event"]) {
  for (const closeFirst of [false, true]) {
    test(`issuance ownership: ${action}${closeFirst ? " closed before resolution" : " open during resolution"}`, async page => {
      if (action === "Around this event") await update(page, {onInvestigate:undefined});
      await startDelayedIssuance(page);
      if (action === "Open full JSON") await page.getByRole("tab", {name:"Original JSON",exact:true}).click();
      const opener = page.getByRole("button", {name:action,exact:true});
      await opener.click();
      const name = action === "Open full JSON" ? "Raw JSON" : action === "Around this event" ? "Event investigation" : "Source evidence";
      const modal = page.getByRole("dialog", {name,exact:true});
      await modal.waitFor();
      if (closeFirst) await page.keyboard.press("Escape");
      await settleIssuance(page);
      assert.equal(await page.getByRole("dialog").count(), closeFirst ? 0 : 1, "late issuance competed with the chosen modal owner");
      assert.equal(await page.getByRole("dialog", {name:"Lineage event",exact:true}).count(), 0, "chosen dialog did not supersede the pending issuance");
      if (!closeFirst) {
        assert.ok(await modal.evaluate(el => el.contains(document.activeElement)), "late completion stole modal focus");
        await page.keyboard.press("Escape");
      }
      assert.equal(await page.getByRole("dialog").count(), 0, "Escape left a competing dialog/handler behind");
      assert.ok(await opener.evaluate(el => el === document.activeElement), "closing the chosen owner lost its original opener");
      await assertUsableFocus(page);
      await page.getByRole("tab", {name:"Context",exact:true}).click();
      assert.equal(await page.getByRole("button", {name:"Inspect observed caller 1: maya.chen",exact:true}).getAttribute("aria-expanded"), "true");
      assert.equal(await page.getByText("Loading issuance #10…", {exact:true}).count(), 0);
      assert.equal(await page.evaluate(() => window.inspectorDock.rawCalls.length), 1);
    });
  }
}

for (const action of ["Around this event", "Expand selected-event lineage"]) {
  test(`issuance handoff: ${action} retires pending evidence without losing disclosure`, async page => {
    await startDelayedIssuance(page);
    await page.getByRole("button", {name:action,exact:true}).click();
    await settleIssuance(page);
    assert.equal(await page.getByRole("dialog").count(), 0, "late issuance reopened over a delegated view");
    const calls = await page.evaluate(() => window.inspectorDock.calls);
    assert.equal(calls.length, 1);
    if (action === "Around this event") {
      assert.equal(calls[0].event.eventID, "synthetic-selected-event");
      assert.deepEqual(calls[0].snapshot, {generation:"dock-fixture",maxSeq:30,capturedAt:"2026-09-24T10:00:00Z"});
    } else assert.deepEqual(calls[0], {fullLineage:30});
    assert.equal(await page.getByRole("button", {name:"Inspect observed caller 1: maya.chen",exact:true}).getAttribute("aria-expanded"), "true");
    assert.ok(await page.getByRole("button", {name:action,exact:true}).evaluate(el => el === document.activeElement));
    await assertUsableFocus(page);
    await page.evaluate(() => { window.inspectorDock.delayRaw = false; });
    await page.getByRole("button", {name:"Original issuance #10",exact:true}).click();
    await page.getByRole("dialog", {name:"Lineage event",exact:true}).waitFor();
    await page.keyboard.press("Escape");
  });
}

test("lineage uncertainty and original-record states remain explicit", async page => {
  for (const [status,reason] of [
    ["missing", "No successful supported STS issuance for this key is present."],
    ["ambiguous", "Multiple independent matching issuances; no source was chosen."],
    ["limit", "The 12-link limit was reached."],
    ["ambiguous", "Candidate lookup exceeded 64 observations."],
    ["ambiguous", "Different source versions of the selected event stop the walk."],
  ]) {
    await update(page, {lineage:{applicable:true,complete:false,status,reason,sourceIdentity:"",nodes:[]}});
    await page.getByText(reason, {exact:false}).waitFor();
    assert.equal(await page.getByRole("button", {name:/Inspect observed caller/}).count(), 0, "a name or session must never create an ancestor");
    assert.equal(await page.getByRole("button", {name:/Inspect selected-event identity/}).count(), 1);
    assert.equal(await page.locator(".ls-link").count(), 0);
    assert.equal(await page.getByText("Principal observed", {exact:true}).count(), 0);
  }
  await update(page, {lineage:null,lineageLoading:true});
  await page.getByRole("status").filter({hasText:"Tracing credential lineage"}).waitFor();
  await update(page, {lineageLoading:false,lineageError:"Lineage storage unavailable"});
  await page.getByRole("alert").filter({hasText:"Lineage storage unavailable"}).waitFor();
  await page.getByRole("button", {name:"Retry lineage",exact:true}).click();
  assert.equal(await page.evaluate(() => window.inspectorDock.retries), 1);
  await update(page, {lineageError:false,lineage:{applicable:false,complete:false,reason:"No temporary credential was recorded.",sourceIdentity:"",nodes:[]}});
  await page.getByText("Credential lineage is not applicable", {exact:true}).waitFor();
  await page.getByRole("tab", {name:"Fields",exact:true}).click();
  await update(page, {rawJSON:"",rawLoading:true});
  await page.getByRole("status").filter({hasText:"Loading original event"}).waitFor();
  assert.ok(await page.getByRole("button", {name:"Pin comparison",exact:true}).isDisabled());
  await update(page, {rawLoading:false,rawError:"Original storage unavailable"});
  await page.getByRole("alert").filter({hasText:"Original storage unavailable"}).waitFor();
  await page.getByRole("button", {name:"Retry event",exact:true}).click();
  assert.equal(await page.evaluate(() => window.inspectorDock.retries), 2);
});

test("pins keep exact selected source copies across snapshot replacement", async page => {
  await page.getByRole("button", {name:"Pin event A",exact:true}).click();
  await update(page, {rawJSON:'{ "exact": 9007199254740992 }',snapshot:{generation:"replacement",maxSeq:30,capturedAt:"2026-09-24T11:00:00Z"}});
  await page.getByRole("button", {name:"Pin event B",exact:true}).click();
  await page.getByRole("button", {name:"Compare events",exact:true}).click();
  const comparison = page.getByRole("dialog", {name:"Compare original records",exact:true});
  await comparison.getByRole("status").filter({hasText:"field difference"}).waitFor();
  await comparison.getByRole("button", {name:"Open original A",exact:true}).click();
  assert.ok((await page.locator(".rawmodal-body").textContent()).includes("9007199254740993"), "pin A was replaced by new source evidence");
  await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
  await page.getByRole("button", {name:"Sources & hashes",exact:true}).click();
  const source = page.getByRole("dialog", {name:"Source evidence",exact:true});
  await source.getByText("2 observations · 2 distinct source hashes", {exact:true}).waitFor();
  await source.getByRole("button", {name:"View source #2",exact:true}).click();
  await source.getByRole("region", {name:"Original source record",exact:true}).waitFor();
  assert.ok((await source.textContent()).includes('9007199254740993'));
  assert.deepEqual(await page.evaluate(() => window.inspectorDock.observationCalls[0]), {id:2,snapshot:{generation:"replacement",maxSeq:30,capturedAt:"2026-09-24T11:00:00Z"}});
  const actions = source.locator('button:not(:disabled)');
  await page.keyboard.press("Tab");
  assert.ok(await source.evaluate(el => el.contains(document.activeElement)), "Tab from the loaded source body escaped its modal");
  await actions.first().focus(); await page.keyboard.press("Shift+Tab");
  assert.ok(await actions.last().evaluate(el => el === document.activeElement));
  await page.keyboard.press("Tab");
  assert.ok(await actions.first().evaluate(el => el === document.activeElement));
  await page.keyboard.press("Escape");
  assert.ok(await page.getByRole("button", {name:"Sources & hashes",exact:true}).evaluate(el => el === document.activeElement));
});

test("obsolete issuance cannot reopen after generation or selection changes", async page => {
  await page.evaluate(() => { window.inspectorDock.delayRaw = true; });
  await page.getByRole("button", {name:"Inspect observed caller 1: maya.chen",exact:true}).click();
  await page.getByRole("button", {name:"Original issuance #10",exact:true}).click();
  await page.getByRole("status").filter({hasText:"Loading issuance #10"}).waitFor();
  await update(page, {snapshot:{generation:"replaced",maxSeq:30,capturedAt:"2026-09-24T11:00:00Z"}});
  await page.evaluate(() => { window.inspectorDock.resolveRaw(); });
  await page.waitForTimeout(100);
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(await page.getByRole("region", {name:"Focused credential"}).count(), 0);
  await update(page, {event:null});
  await page.getByRole("heading", {name:"Select an event",exact:true}).waitFor();
  assert.equal(await page.getByRole("button", {name:/Inspect observed caller/}).count(), 0);
});

test("side compatibility retains Fields default and InvestigationView fallback", async page => {
  await update(page, {layout:undefined,onInvestigate:undefined,event:null});
  await page.getByRole("heading", {name:"Select an event",exact:true}).waitFor();
  await page.evaluate(async () => {
    const {event} = await import("/scripts/fixtures/inspector-dock.tsx");
    window.inspectorDock.update({event});
  });
  assert.match(await page.getByRole("complementary", {name:"Event inspector"}).getAttribute("class"), /event-inspector--side/);
  assert.equal(await page.getByRole("tab", {name:"Fields",exact:true}).getAttribute("aria-selected"), "true");
  await page.getByRole("button", {name:"Investigate",exact:true}).click();
  await page.getByText("Synthetic fixture: investigation engine not running", {exact:false}).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", {name:"Lineage",exact:true}).click();
  assert.ok(await page.locator(".lg").isVisible());
});

test("visual dock review at desktop sizes and long identifiers", async page => {
  const observations = [];
  const measure = async () => page.evaluate(() => {
    const selectors = [".event-inspector", ".ei-head", ".ei-context", ".ei-details", ".ei-panel-lineage", ".ls-chain", ".ei-lineage-note"];
    return selectors.map(selector => {
      const el = document.querySelector(selector), r = el.getBoundingClientRect();
      return {selector,x:r.x,y:r.y,width:r.width,height:r.height,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight};
    });
  });
  for (const viewport of [{width:1440,height:960}, {width:1280,height:800}]) {
    await page.setViewportSize(viewport);
    await page.getByRole("tab", {name:"Context",exact:true}).click();
    const sizes = await measure();
    assert.ok(await page.locator(".ls-link").first().evaluate(el => parseFloat(getComputedStyle(el).fontSize) >= 11), "issuance labels fall below the readable 11px floor");
    assert.ok(sizes.every(s => s.x >= 0 && s.y >= 0 && s.x+s.width <= viewport.width+1 && s.y+s.height <= viewport.height+1));
    assert.ok(sizes.filter(s => s.selector !== ".ls-chain").every(s => s.scrollWidth <= s.clientWidth+1), "essential dock controls overflow horizontally");
    assert.ok(sizes.find(s => s.selector === ".ei-context").scrollHeight <= sizes.find(s => s.selector === ".ei-context").clientHeight+1, "normal selected-event context requires scrolling");
    assert.ok(sizes.find(s => s.selector === ".ls-chain").scrollWidth <= sizes.find(s => s.selector === ".ls-chain").clientWidth+1, "three-node chain does not fit the dock");
    await page.screenshot({path:out+`dock-${viewport.width}.png`});
    observations.push({viewport, state:"default",sizes});
    await page.getByRole("button", {name:"Inspect observed caller 2: SecurityAudit",exact:true}).click();
    const panel = await box(page.locator(".ei-panel-lineage"));
    const detail = await box(page.locator(".ls-detail > header"));
    assert.ok(detail.y >= panel.y && detail.y+detail.height <= panel.y+panel.height, "focused credential heading is clipped outside the visible detail pane");
    await page.screenshot({path:out+`dock-expanded-${viewport.width}.png`});
    await page.getByRole("button", {name:"Close credential details",exact:true}).click();
  }
  await page.evaluate(async () => {
    const {event,lineage} = await import("/scripts/fixtures/inspector-dock.tsx");
    const long = "LongRecordedIdentifier_".repeat(20);
    window.inspectorDock.update({event:{...event,eventName:long,errorCode:long,errorMessage:long,eventSource:long,sourceIPAddress:long,userIdentity:{...event.userIdentity,arn:"arn:aws-us-gov:sts::111122223333:assumed-role/"+long+"/recorded-session",userName:long}},lineage:{...lineage,complete:false,status:"limit",reason:"The 12-link limit was reached.",sourceIdentity:long,nodes:Array.from({length:12},(_,i)=>({...lineage.nodes[i%2],userName:long,viaSeq:i+1}))}});
  });
  const sizes = await measure();
  assert.ok(sizes.filter(s => s.selector !== ".ls-chain").every(s => s.scrollWidth <= s.clientWidth+1), "long identifiers overflow dock boundaries");
  assert.equal(await page.getByRole("button", {name:/Inspect observed caller/}).count(), 12);
  const last = page.getByRole("button", {name:/Inspect selected-event identity/});
  await last.focus();
  const pane = await box(page.locator(".ei-panel-lineage")), target = await box(last);
  assert.ok(target.x >= pane.x && target.x+target.width <= pane.x+pane.width, "last chain node cannot be reached by keyboard scrolling");
  await page.screenshot({path:out+"dock-adversarial-1280.png"});
  observations.push({viewport:{width:1280,height:800},state:"long-identifiers-12-links",sizes});
  await writeFile(out+"layout.json",JSON.stringify(observations,null,2));
});

test("focused caller exposes original issuance actions without extra scrolling", async page => {
  await page.getByRole("button", {name:"Inspect observed caller 2: SecurityAudit",exact:true}).click();
  const pane = await box(page.locator(".ei-panel-lineage"));
  const action = await box(page.getByRole("button", {name:"Original issuance #20",exact:true}));
  assert.ok(action.y >= pane.y && action.y+action.height <= pane.y+pane.height, "original issuance action is buried below technical fields");
});

const server = await createServer({root, cacheDir:"node_modules/.vite-vector-inspector", server:{host:"127.0.0.1",port:5193,strictPort:true}});
await server.listen();
const browser = await chromium.launch({headless:true});
try {
  await mkdir(out, {recursive:true});
  let passed = 0;
  for (const {name, run} of tests) {
    if (process.argv[2] && !name.includes(process.argv[2])) continue;
    const page = await browser.newPage({viewport:{width:1440,height:960}});
    const errors = [];
    page.on("pageerror", error => errors.push(String(error)));
    await page.goto("http://127.0.0.1:5193/scripts/fixtures/inspector-dock.html");
    await page.getByRole("heading", {name:"GetSecretValue",exact:true}).waitFor();
    try { await run(page); assert.deepEqual(errors, [], "browser errors"); passed++; console.log(`PASS ${name}`); }
    catch (error) { await page.screenshot({path:out+"failure.png"}); throw error; }
    finally { await page.close(); }
  }
  assert.ok(passed, "no matching inspector-dock tests ran");
  await writeFile(out+"result.json", JSON.stringify({passed}, null, 2));
  console.log(`Inspector dock: ${passed} checks passed.`);
} finally { await browser.close(); await server.close(); }
