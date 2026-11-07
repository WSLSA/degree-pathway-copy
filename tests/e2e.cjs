#!/usr/bin/env node
/* End-to-end checks for dist/wslsa-pathway-explorer.html.

   node tests/e2e.cjs            # behaviour checks across all 48 pathways
   node tests/e2e.cjs --pdf      # also renders every pathway to PDF (needs pdfinfo/pdftotext from poppler)
   node tests/e2e.cjs --samples  # also writes the sample PDFs in samples/
   node tests/e2e.cjs --import   # also imports generated results PDFs, one as text and one as a picture
                                 # (loads the PDF reader and text recogniser from jsDelivr, so needs internet)

   Requires Playwright with Chromium (npm i -D playwright && npx playwright install chromium). */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const APP = 'file://' + path.join(ROOT, 'dist', 'wslsa-pathway-explorer.html');
const args = new Set(process.argv.slice(2));
const FIXED = ['2848', '2785', '2843', '2769', '2767', '2766', '2800', '2758'];
const TBC_CORE = ['LAWS 3099', 'LAWS 3101', 'LAWS 3102', 'LAWS 3103'];

let failures = 0;
let passes = 0;
function check(cond, msg) {
  if (cond) passes++;
  else { failures++; console.log('FAIL', msg); }
}

async function newPage(browser, opts) {
  // reduced motion by default: updates are then instant, so checks can read the page straight after a click
  const page = await browser.newPage(Object.assign({ viewport: { width: 1360, height: 900 }, reducedMotion: 'reduce' }, opts || {}));
  // a returning student: no tour prompt, and the Law Enquiry box as a pill. The tour and box checks set up their own pages.
  await page.addInitScript(() => { try { localStorage.setItem('wslsa-2027-tour-dismissed', '1'); if (!localStorage.getItem('wslsa-2027-enquiry')) localStorage.setItem('wslsa-2027-enquiry', 'min'); } catch (e) { /* about:blank */ } });
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') page.errors.push(m.text()); });
  return page;
}

function hasPoppler() {
  try { execSync('pdfinfo -v', { stdio: 'ignore' }); execSync('pdftotext -v', { stdio: 'ignore' }); return true; } catch (e) { return false; }
}

async function renderPdf(page, key, mode, orient, file) {
  await page.evaluate(([k, m, o]) => { WSLSA.select(k); WSLSA.preparePrint({ mode: m, orient: o }); }, [key, mode, orient]);
  await page.emulateMedia({ media: 'print' });
  await page.pdf({ path: file, preferCSSPageSize: true, printBackground: true });
  await page.emulateMedia({ media: 'screen' });
}

(async () => {
  const browser = await chromium.launch();
  const page = await newPage(browser);
  await page.goto(APP);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  // ---------------------------------------------------------------- every pathway renders correctly
  const info = await page.evaluate(() => WSLSA.keys().map(k => {
    WSLSA.select(k);
    const ctx = WSLSA.context();
    return {
      key: k, degree: ctx.deg.code, cp: ctx.deg.cp, totalCP: ctx.totalCP, slots: ctx.slots.length,
      domSlots: document.querySelectorAll('#grid .subj').length,
      gridText: document.getElementById('grid').textContent + document.getElementById('advisory').textContent + document.getElementById('hero-meta').textContent + document.getElementById('facts').textContent,
      majorOptions: Array.from(document.querySelectorAll('#sel-major option')).map(o => o.value),
      locked: !!document.getElementById('major-locked'),
      degOptions: ctx.deg.options,
      tbc: ctx.risks.tbc.map(s => s.code),
      advisor: ctx.risks.advisor.map(a => ({ applies: a.applies, subject: a.note.subject, hint: a.hint })),
      badge: document.querySelector('.pbadge').textContent,
      group: ctx.opt.groupLetter,
      ptYears: ctx.deg.ptYears,
    };
  }));
  check(info.length === 48, `expected 48 pathways, got ${info.length}`);
  for (const p of info) {
    check(p.totalCP === p.cp, `${p.key}: pathway sums to ${p.totalCP}, degree requires ${p.cp}`);
    check(p.domSlots === p.slots, `${p.key}: ${p.domSlots} slot cards for ${p.slots} slots`);
    check(!/undefined|null|NaN|\[object/.test(p.gridText), `${p.key}: placeholder text leaked into the page`);
    if (FIXED.includes(p.degree)) check(p.locked && p.majorOptions.length === 0, `${p.key}: major selector should be locked`);
    else check(!p.locked && JSON.stringify(p.majorOptions) === JSON.stringify(p.degOptions), `${p.key}: major dropdown must list only this degree's majors/minors`);
    for (const c of TBC_CORE) check(p.tbc.includes(c), `${p.key}: ${c} missing from TBC warnings`);
    check(p.group ? p.badge === 'Pathway ' + p.group : p.badge === 'Single pathway', `${p.key}: badge ${p.badge}`);
  }

  // ---------------------------------------------------------------- advisor notes are scoped to the selection
  const adv = Object.fromEntries(info.map(p => [p.key, p.advisor]));
  const applies = k => adv[k].filter(a => a.applies).map(a => a.subject).sort().join(',');
  check(applies('2788|T046') === 'ACCT 3001,ACCT 3011', '2788|T046 should carry both ACCT notes');
  check(adv['2788|T165'].length === 0, '2788|T165 should carry no notes');
  check(applies('2766|BASE') === 'CULT 3013,CULT 3018', '2766 should carry both CULT notes');
  check(applies('2768|0325') === 'INFO 3015', '2768|0325 should carry the INFO 3015 note');
  check(adv['2768|0128'].length === 0, '2768|0128 should carry no notes');
  check(applies('2743|T185') === 'NATS 3055', '2743|T185 should carry the NATS 3055 note');
  check(adv['2743|T164'].length === 1 && !adv['2743|T164'][0].applies && /NATS 3044 is one of the options/.test(adv['2743|T164'][0].hint),
    '2743|T164 should show the NATS 3055 note as related, with the NATS 3044 option hint');

  // ---------------------------------------------------------------- part-time view matches Overview durations
  await page.click('[data-action="load"][data-load="PT"]');
  for (const p of info) {
    const years = await page.evaluate(k => { WSLSA.select(k); return document.querySelectorAll('#grid .year').length; }, p.key);
    check(years === Math.ceil(p.ptYears), `${p.key}: part-time view runs ${years} years, Overview says ${p.ptYears}`);
  }
  await page.click('[data-action="load"][data-load="FT"]');

  // ---------------------------------------------------------------- LLB picker is filtered by session
  await page.evaluate(() => WSLSA.select('2848|BASE'));
  for (const slot of ['2S2', '3A2']) {
    await page.click(`#slot-${slot} [data-action="picker-open"]`);
    const listed = await page.$$eval('#pick-results .pick-section:first-child .pick', els => els.map(e => e.dataset.code));
    const bad = await page.evaluate(([codes, s]) => {
      const deg = WSLSA.context().deg;
      const col = s[1] === 'A' ? 'autumn' : 'spring';
      return codes.filter(c => { const v = deg.byCode[c][col]; return !v || v === '—' || v === 'TBC'; });
    }, [listed, slot]);
    check(listed.length > 5 && bad.length === 0, `2848 ${slot}: picker lists subjects not offered that session: ${bad}`);
    await page.keyboard.press('Escape');
  }
  await page.click('#slot-2S2 [data-action="picker-open"]');
  await page.click('#pick-results .pick[data-code="LAWS 3067"]');
  await page.click('#slot-3A2 [data-action="picker-open"]');
  check(!(await page.$('#pick-results .pick[data-code="LAWS 3067"]')), 'Spring-only LAWS 3067 must not appear for an Autumn slot');
  await page.click('#pick-results .pick[data-code="LAWS 4008"]');
  await page.click('#slot-3S3 [data-action="picker-open"]');
  check(await page.$eval('#pick-results .pick[data-code="LAWS 3067"]', b => b.disabled), 'a subject already in the plan must be disabled in other slots');
  await page.keyboard.press('Escape');

  // custom elective: a code in neither the workbook nor the subject list is stored as typed
  await page.click('#slot-1A4 [data-action="picker-open"]');
  await page.fill('#cu-code', 'test 1001');
  await page.fill('#cu-title', 'Unlisted Subject');
  await page.click('#custom-form button[type=submit]');
  const el = await page.evaluate(() => { const s = WSLSA.context().byId['1A4']; return [s.code, s.custom]; });
  check(el[0] === 'TEST 1001' && el[1] === true, 'custom elective should be stored and upper-cased');
  // a workbook subject from another degree typed by hand resolves to the real subject, not a custom one
  await page.click('#slot-1A4 [data-action="picker-open"]');
  await page.fill('#cu-code', 'humn1052');
  await page.fill('#cu-title', 'my own title');
  await page.click('#custom-form button[type=submit]');
  const known = await page.evaluate(() => { const s = WSLSA.context().byId['1A4']; return [s.code, !!s.custom, s.title]; });
  check(known[0] === 'HUMN 1052' && !known[1] && known[2] !== 'my own title', 'a typed workbook code should resolve to the 2027 Handbook subject and title');

  // ---------------------------------------------------------------- inline choices and duplicate prevention
  const dupe = await page.evaluate(() => {
    for (const k of WSLSA.keys()) {
      WSLSA.select(k);
      const inl = WSLSA.context().slots.filter(s => s.kind === 'inline' && s.raw.options.length > 1);
      for (let i = 0; i < inl.length; i++) for (let j = i + 1; j < inl.length; j++) {
        const shared = inl[i].raw.options.map(o => o.code).find(c => inl[j].raw.options.some(o => o.code === c));
        if (shared) return { key: k, a: inl[i].id, b: inl[j].id, code: shared };
      }
    }
    return null;
  });
  if (dupe) {
    await page.evaluate(k => WSLSA.select(k), dupe.key);
    await page.click(`#slot-${dupe.a} .inline-opt[data-code="${dupe.code}"]`);
    const picked = await page.evaluate(id => WSLSA.context().byId[id].code, dupe.a);
    check(picked === dupe.code, `${dupe.key}: inline choice should lock in ${dupe.code}`);
    check(await page.$eval(`#slot-${dupe.b} .inline-opt[data-code="${dupe.code}"]`, b => b.disabled), `${dupe.key}: ${dupe.code} should be disabled in ${dupe.b}`);
  }

  // NATS 3044 chosen before NATS 3055 resolves the related note hint
  await page.evaluate(() => WSLSA.select('2743|T164'));
  await page.click('#slot-2S4 .inline-opt[data-code="NATS 3044"]');
  check(await page.evaluate(() => WSLSA.context().risks.advisor[0].resolvedByChoice), 'picking NATS 3044 should be recognised as placing the prerequisite first');

  // ---------------------------------------------------------------- major option swap
  await page.evaluate(() => WSLSA.select('2538|0045'));
  await page.click('#slot-1S4 [data-action="picker-open"]');
  await page.click('#pick-results .pick[data-code="WELF 2001"]');
  check(await page.evaluate(() => WSLSA.context().byId['1S4'].code) === 'WELF 2001', '2538|0045 option swap should apply');

  // ---------------------------------------------------------------- progress tracking
  await page.evaluate(() => WSLSA.select('2788|T046'));
  await page.click('#grid [data-action="session-done"]');
  check(/^40 \/ 400/.test((await page.textContent('#progress-num')).trim()), 'marking a full session should show 40 / 400 CP');

  // ---------------------------------------------------------------- campus filter
  await page.selectOption('#sel-campus', 'CA');
  const campus = await page.evaluate(() => WSLSA.context().risks.campus.map(s => s.code));
  check(campus.length > 0 && campus.every(c => c !== 'LAWS 1003'), '2788|T046 at Campbelltown should flag PC-only subjects but not LAWS 1003');

  // ---------------------------------------------------------------- plan link round trip
  await page.evaluate(() => WSLSA.select('2848|BASE'));
  const url = await page.evaluate(() => WSLSA.planUrl());
  const fresh = await browser.newContext();
  const p2 = await fresh.newPage();
  await p2.goto(url);
  const restored = await p2.evaluate(() => { const c = WSLSA.context(); return [c.key, c.byId['2S2'].code, c.byId['3A2'].code, c.byId['1A4'].code]; });
  check(JSON.stringify(restored) === JSON.stringify(['2848|BASE', 'LAWS 3067', 'LAWS 4008', 'HUMN 1052']), `plan link should restore choices, got ${restored}`);
  await p2.goto(APP + '#plan=not-valid-base64!!');
  check(await p2.evaluate(() => !!WSLSA.context().key), 'a malformed plan link should fall back gracefully');
  await fresh.close();

  // ---------------------------------------------------------------- share codes
  // the address bar stays clean while planning, and links carry only what differs from the pathway
  check(await page.evaluate(() => location.hash) === '', 'the address bar should not carry the plan while planning');
  // a shared link is a scrambled code holding only what differs from the pathway
  const code = new URL(url).hash.slice(1);
  check(/^[A-Za-z0-9_-]{14,}$/.test(code) && !/LAWS|2848/.test(code), `a shared link should be an opaque code, got ${code}`);
  check(/^2848\/p=1A4:HUMN1052,2S2:LAWS3067,3A2:LAWS4008(\/|$)/.test(await page.evaluate(c => WSLSA.unscramble(c), code)), 'the code should hold only the 2848 choices');
  // a fresh code on every share, never repeated, even for the same plan
  const codes = await page.evaluate(() => Array.from({ length: 2000 }, () => WSLSA.planUrl().split('#')[1]));
  check(new Set(codes).size === codes.length, 'every share should produce a different code');
  check((await page.evaluate(cs => new Set(cs.map(c => WSLSA.unscramble(c))).size, codes)) === 1, 'every code for the same plan should open that plan');
  const links = await browser.newContext();
  const lp = await links.newPage();
  lp.errors = [];
  lp.on('pageerror', e => lp.errors.push(e.message));
  await lp.goto(APP);
  await lp.evaluate(() => { localStorage.clear(); WSLSA.select('2848|BASE'); });
  check(await lp.evaluate(() => WSLSA.linkText()) === '2848', 'an untouched pathway should carry only its key');
  check((await lp.evaluate(() => WSLSA.planUrl())).split('#')[1].length <= 20, 'an untouched pathway should share as a short code');
  // a typed elective keeps its title; ticks, campus and part-time survive a round trip
  await lp.click('#slot-1A4 [data-action="picker-open"]');
  await lp.fill('#cu-code', 'TEST 1001');
  await lp.fill('#cu-title', 'Moot (Advanced): A/B, 50%');
  await lp.click('#custom-form button[type=submit]');
  await lp.click('#slot-1A1 .tick');
  await lp.selectOption('#sel-campus', 'CA');
  await lp.click('[data-action="load"][data-load="PT"]');
  const plan = () => { const s = WSLSA.state(); const k = WSLSA.context().key; return JSON.stringify([k, s.picks[k]['1A4'], Object.keys(s.done[k]), s.campus, s.load]); };
  const guideBefore = await lp.evaluate(plan);
  const guideLink = await lp.evaluate(() => WSLSA.planUrl());
  const lp2 = await links.newPage();
  await lp2.goto(guideLink);
  check(await lp2.evaluate(plan) === guideBefore, `a pathway link should restore the typed elective, tick, campus and load, got ${await lp2.evaluate(plan)}`);
  check(await lp2.evaluate(() => location.hash) === '', 'opening a link should clear it from the address bar');
  // a custom copy of a pathway links as ranges of untouched template slots
  await lp.click('[data-action="load"][data-load="FT"]');
  await lp.evaluate(() => WSLSA.select('2788|T046'));
  await lp.click('[data-action="summer-add"][data-y="1"]');
  await lp.click('button[type=submit][form=setup-form]');
  await lp.click(`#slot-${await lp.evaluate(() => WSLSA.context().slots.find(s => s.session === 'Summer').id)} [data-action="picker-open"]`);
  await lp.click('[data-action="cbring"]');
  const customLinkUrl = await lp.evaluate(() => WSLSA.planUrl());
  const customText = await lp.evaluate(() => WSLSA.linkText());
  check(/^my\/tp=2788-T046\/s=[\d,:\-AUS]+/.test(customText) && customText.length < 80, `a custom copy should link by template ranges, got ${customText}`);
  const customBefore = await lp.evaluate(() => JSON.stringify(WSLSA.custom()));
  const lp3 = await links.newPage();
  await lp3.goto(customLinkUrl);
  check(await lp3.evaluate(() => JSON.stringify(WSLSA.custom())) === customBefore, 'a custom plan link should restore the plan exactly');
  // links shared or printed before the short format still open
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const lp4 = await links.newPage();
  lp4.errors = [];
  lp4.on('pageerror', e => lp4.errors.push(e.message));
  await lp4.goto(APP + '#plan=' + b64({ v: 1, k: '2848|BASE', c: 'CA', l: 'PT', t: 0, p: { '2S2': { code: 'LAWS 3067', title: 'Health Law' } }, d: ['1A1'] }));
  check(await lp4.evaluate(() => { const c = WSLSA.context(); return c.key === '2848|BASE' && c.byId['2S2'].code === 'LAWS 3067' && c.byId['1A1'].done && WSLSA.state().load === 'PT'; }), 'an older #plan= pathway link should still open');
  // the same tab: a link opened where the explorer is already showing changes only the hash
  await lp4.goto(APP + '#plan=' + b64({ v: 1, m: 'c', c: '', l: 'FT', t: 0, x: { n: 'Old plan', k: '', p: 80, tp: '', s: [[1, 0, 'LAWS 1003', 10, 1], [1, 1, '', 10]] } }));
  await lp4.waitForTimeout(100);
  check(await lp4.evaluate(() => { const c = WSLSA.custom(); return WSLSA.context().custom && c.name === 'Old plan' && c.slots.length === 2 && c.slots[0].done && location.hash === ''; }), 'an older #plan= custom link should open in a tab already showing the explorer');
  for (const bad of ['#9999-ZZZZ/p=1A1:LAWS1003', '#my/tp=1234/s=0-9', '#my/s=%E0%A4%A,1A:%ZZ/d=***']) {
    const lp5 = await links.newPage();
    lp5.errors = [];
    lp5.on('pageerror', e => lp5.errors.push(e.message));
    await lp5.goto(APP + bad);
    check(await lp5.evaluate(() => !!WSLSA.context().key) && lp5.errors.length === 0, `a damaged link (${bad}) should fall back gracefully: ${lp5.errors.join('; ')}`);
    await lp4.goto(APP + bad);
  }
  // a code cut short by a messaging app is caught by its check byte, and readable links from before codes still open
  const lp6 = await links.newPage();
  await lp6.goto(customLinkUrl.slice(0, -3));
  await lp6.waitForTimeout(100);
  check(/incomplete or damaged/.test(await lp6.textContent('#toast')), 'a code cut short should say the link is damaged');
  await lp6.goto(APP + '#2848/p=1A4:HUMN1052,2S2:LAWS3067/c=CA');
  await lp6.waitForTimeout(100);
  check(await lp6.evaluate(() => { const c = WSLSA.context(); return c.key === '2848|BASE' && c.byId['1A4'].code === 'HUMN 1052' && WSLSA.state().campus === 'CA'; }), 'a readable link from before codes should still open');
  check(lp.errors.length === 0 && lp4.errors.length === 0, 'share link console errors: ' + lp.errors.concat(lp4.errors).join('; '));
  await links.close();

  // ---------------------------------------------------------------- WSU subject list and ranked elective search
  check(await page.evaluate(() => WSLSA.extraCount()) === 3407, 'all 3,407 new subjects from the subject list should be loaded');
  await page.evaluate(() => WSLSA.select('2848|BASE'));
  await page.click('#slot-2S2 [data-action="picker-open"]');
  check(!/Any WSU subject/.test(await page.textContent('#pick-results')), 'LLB Alternate slots must not offer the any-subject list');
  await page.keyboard.press('Escape');
  await page.click('#slot-1S4 [data-action="picker-open"]');
  const useBtn = await page.$eval('#custom-form button[type=submit]', b => [getComputedStyle(b).backgroundColor, getComputedStyle(b).color]);
  check(useBtn[0] !== useBtn[1] && useBtn[0] !== 'rgb(255, 255, 255)', '"Use subject" must render as a filled primary button, not white on white');
  for (const q of ['ACCT2004', 'acct 2004', 'ACCT 2004']) {
    await page.fill('#pick-q', q);
    check(/Exact match/.test(await page.textContent('.pick-best')) && /ACCT 2004/.test(await page.textContent('.pick-best')), `"${q}" should pin ACCT 2004 as the exact match`);
  }
  for (const q of ['intermediate financial', 'financial intermediate', 'intermidiate financial']) {
    await page.fill('#pick-q', q);
    const best = await page.$('.pick-best');
    check(best && /ACCT 2004/.test(await best.textContent()), `"${q}" should rank ACCT 2004 Intermediate Financial Accounting first`);
  }
  await page.fill('#pick-q', 'Revenue Law');
  check(/LAWS 4008/.test(await page.textContent('.pick-best')) && /runs only in Autumn/.test(await page.textContent('.pick-best')) && await page.$eval('.pick-best .pick', b => b.disabled),
    '"Revenue Law" in a Spring slot should surface LAWS 4008 as an exact match that runs only in Autumn');
  await page.fill('#pick-q', 'ACCT1007');
  check(/ACCT 1007/.test(await page.textContent('.pick-best')) && /PC|BC|CA/.test(await page.textContent('.pick-best')), 'workbook subjects from other degrees (ACCT 1007) should be searchable as electives, with their sessions');
  await page.fill('#pick-q', 'psychology');
  check(!(await page.$('.pick-best')) && (await page.$$('#pick-results .pick[data-src="list"]')).length > 5, 'a broad search should list ranked results without forcing a best match');
  await page.fill('#pick-q', 'acct2004');
  await page.click('.pick-best .pick');
  const listPick = await page.evaluate(() => { const s = WSLSA.context().byId['1S4']; return [s.code, s.listSubject, s.offer]; });
  check(listPick[0] === 'ACCT 2004' && listPick[1] === true && listPick[2] === null, 'choosing from the subject list should store a subject-list elective');
  check(/Check Handbook/.test(await page.textContent('#slot-1S4')), 'subject-list electives should point students to the Handbook for sessions');
  const listUrl = await page.evaluate(() => WSLSA.planUrl());
  const ctx2 = await browser.newContext();
  const p3 = await ctx2.newPage();
  await p3.goto(listUrl);
  check(await p3.evaluate(() => { const s = WSLSA.context().byId['1S4']; return s.code === 'ACCT 2004' && s.listSubject; }), 'plan links should keep subject-list electives');
  await ctx2.close();
  await page.click('#slot-2S3 [data-action="picker-open"]');
  await page.fill('#cu-code', 'hlth1006');
  check(await page.inputValue('#cu-title') === 'Movement and Skill Development', 'typing a known code in the manual form should fill the title');
  await page.keyboard.press('Escape');
  await page.click('#tab-catalogue');
  await page.selectOption('#cat-comp', '__extra__');
  await page.fill('#cat-q', 'intermediate financial');
  check(/ACCT 2004/.test(await page.textContent('#cat-results')), 'catalogue should search the WSU subject list');
  await page.selectOption('#cat-comp', '');
  await page.fill('#cat-q', 'Revenue');
  const revenueRows = await page.$$eval('#cat-results tbody tr', trs => trs.filter(tr => tr.querySelector('.c-code').textContent === 'LAWS 4008').length);
  check(revenueRows === 1, `LAWS 4008 should appear once in a combined search, appeared ${revenueRows} times`);
  await page.fill('#cat-q', '');
  await page.click('#tab-structure');

  // ---------------------------------------------------------------- redesign: roman numerals, advisory, tabs, checkbox
  await page.evaluate(() => WSLSA.select('2843|BASE'));
  const romans = await page.$$eval('#grid .year-seal', els => els.map(e => e.textContent));
  check(JSON.stringify(romans) === JSON.stringify(['I', 'II', 'III', 'IV', 'V', 'VI']), `2843 year seals should read I to VI, got ${romans}`);
  await page.evaluate(() => WSLSA.select('2788|T046'));
  check(await page.$eval('#advisory-box', d => !d.open), 'advisory starts collapsed');
  await page.click('#grid .flag-warn[data-action="open-advisory"]');
  check(await page.$eval('#advisory-box', d => d.open), 'Check prerequisite flag should open the advisory');
  check(/2 prerequisite notes/.test(await page.textContent('#advisory-box summary')), 'advisory summary should count the 2 ACCT notes');
  await page.click('#tab-admission');
  check(/Exit awards/.test(await page.textContent('#details')), 'admission tab should show exit awards');
  await page.click('#tab-catalogue');
  await page.fill('#cat-q', 'Revenue');
  check(/LAWS 4008/.test(await page.textContent('#cat-results')), 'catalogue search should find LAWS 4008');
  await page.click('#tab-structure');
  const before = await page.evaluate(() => WSLSA.context().doneCP);
  await page.click('#slot-3S1 .tick');
  check(await page.evaluate(() => WSLSA.context().doneCP) === before + 10, 'ticking a subject should add 10 CP');
  check(await page.$eval('#slot-3S1', el => el.classList.contains('is-done')), 'ticked subject should be marked done');
  await page.click('#slot-3S1 .tick');
  check(await page.evaluate(() => WSLSA.context().doneCP) === before, 'unticking should remove the CP again');
  const planDoc = await page.evaluate(() => WSLSA.buildPrintDoc({ mode: 'A', orient: 'portrait' }));
  check(/pd-plan">[^<]*#[A-Za-z0-9_-]{14,}</.test(planDoc) && /Est\. 1996/.test(planDoc), 'PDF masthead should carry the plan link and Est. 1996 line');

  // ---------------------------------------------------------------- export modal and print document
  await page.click('[data-action="export-open"]');
  await page.waitForTimeout(300);
  check(/Estimated length: [12] A4 page/.test(await page.textContent('#preview-pages')), 'Mode A preview should estimate 1-2 pages');
  await page.keyboard.press('Escape');
  const docB = await page.evaluate(() => WSLSA.buildPrintDoc({ mode: 'B', orient: 'portrait' }));
  check(docB.includes('LLB Alternate Subjects') && docB.includes('pd-page-break'), 'Mode B should append the LLB Alternate table after a page break');

  // ---------------------------------------------------------------- School of Law notice and Law Enquiry contact
  const LAW_ENQUIRY = 'lawenquiry@westernsydney.edu.au';
  check(await page.$eval('#enquiry-box a[href="mailto:' + LAW_ENQUIRY + '"]', a => a.textContent.trim()) === LAW_ENQUIRY, 'the Law Enquiry box should link the Law Enquiry Team email');
  check(/2026 Handbook/.test(await page.textContent('#notice')), 'the notice should point current students to the 2026 Handbook');
  check(docB.includes(LAW_ENQUIRY), 'the PDF disclaimer should carry the Law Enquiry email');
  const notEndorsed = /not endorsed by the School of Law of Western Sydney University/i;
  const stuck = /If you get stuck, contact .*lawenquiry@westernsydney\.edu\.au.* or your Academic Program Advisor/;
  check(notEndorsed.test(docB) && stuck.test(docB), 'every PDF should say it is not endorsed, and where to go when stuck');
  check(notEndorsed.test(await page.textContent('.hero-note')) && stuck.test(await page.textContent('.hero-note')) && await page.isVisible('.hero-note'), 'the first screen should say it is not endorsed, and where to go when stuck');
  check(notEndorsed.test(await page.textContent('#site-foot')) && stuck.test(await page.textContent('#site-foot')), 'the footer should say it is not endorsed, and where to go when stuck');
  check(notEndorsed.test(await page.textContent('#enquiry-box')) && stuck.test(await page.textContent('#enquiry-box')), 'the Law Enquiry box should say it is not endorsed, and where to go when stuck');
  const phased = await page.textContent('#enquiry-box .phase-grid');
  check(['LAWS 2004', 'LAWS 1009', 'LAWS 2015', 'LAWS 2001', 'LAWS 4004', 'LAWS 4013'].every(c => phased.includes(c)), 'the notice should list all six subjects being phased out');
  check(!!(await page.$('#site-foot a[href="mailto:' + LAW_ENQUIRY + '"]')), 'the footer should link the Law Enquiry Team');

  // ---------------------------------------------------------------- Summer sessions
  const sp = await newPage(browser);
  await sp.goto(APP);
  await sp.evaluate(() => { localStorage.clear(); WSLSA.select('2788|T046'); });
  check((await sp.$$('[data-action="summer-add"]')).length === 5, '2788 should offer + Add Summer on each of its five years');
  // from a WSLSA pathway, Summer opens the setup for an editable copy, then adds the session
  await sp.click('[data-action="summer-add"][data-y="1"]');
  await sp.waitForSelector('#setup-form');
  check(/Summer is planned in your own copy/.test(await sp.textContent('#setup-form')), 'Summer from a pathway should explain the editable copy');
  await sp.click('button[type=submit][form=setup-form]');
  await sp.waitForTimeout(200);
  let sc = await sp.evaluate(() => { const c = WSLSA.context(); const s = c.slots.find(x => x.session === 'Summer'); return { custom: c.custom, total: c.totalCP, id: s && s.id, year: s && s.year, pending: s && s.pending }; });
  check(sc.custom && sc.year === 1 && sc.pending && sc.total === 410, `Summer should add one open 10 CP slot to Year 1 of a custom copy, got ${JSON.stringify(sc)}`);
  check((await sp.$$('#year-1 .session-summer')).length === 1 && !(await sp.$('#year-1 [data-action="summer-add"]')), 'Year 1 should show its Summer session and drop the add button');
  // bringing a later subject forward fills the Summer slot and keeps the plan's credit points
  await sp.click(`#slot-${sc.id} [data-action="picker-open"]`);
  await sp.waitForSelector('#pick-results');
  check(!(await sp.$('.chip[data-action="pick-off"]')), 'a Summer slot should not offer the not-offered-this-session filter');
  check((await sp.$$eval('#cp-move option', os => os.filter(o => /Summer/.test(o.textContent)).length)) >= 5, 'Move to should list a Summer session for each year');
  const from = await sp.$eval('[data-action="cbring"]', b => b.dataset.from);
  const fromCode = await sp.evaluate(id => WSLSA.context().byId[id].code, from);
  await sp.click('[data-action="cbring"]');
  await sp.waitForTimeout(200);
  sc = await sp.evaluate(() => { const c = WSLSA.context(); const s = c.slots.find(x => x.session === 'Summer'); return { total: c.totalCP, placed: c.placedCP, code: s.code, offer: s.offer, risks: c.risks.summer.length }; });
  check(sc.code === fromCode && sc.total === 400 && sc.offer === null && sc.risks === 1, `bringing ${fromCode} forward should move it into Summer at 400 CP, got ${JSON.stringify(sc)}`);
  check(/1 in Summer to check/.test(await sp.textContent('#advisory-box summary')) && /lawenquiry@westernsydney\.edu\.au/.test(await sp.textContent('#advisory')), 'the advisory should flag the Summer subject and give the Law Enquiry contact');
  check(/Check Handbook/.test(await sp.textContent('#grid .session-summer')), 'Summer subjects should point to the Handbook instead of campus pills');
  // plan links keep Summer, and Summer survives the part-time view and the PDF
  const summerUrl = await sp.evaluate(() => WSLSA.planUrl());
  const sp2 = await newPage(browser);
  await sp2.goto(summerUrl);
  check(await sp2.evaluate(c => WSLSA.custom().slots.some(x => x.s === 'Summer' && x.y === 1 && x.code === c), fromCode), 'a plan link should restore the Summer subject');
  await sp.click('[data-action="load"][data-load="PT"]');
  check(!/undefined|null|NaN|\[object/.test(await sp.textContent('#grid')) && (await sp.$$('.session-summer')).length === 1, 'the part-time view should keep the Summer session');
  await sp.click('[data-action="load"][data-load="FT"]');
  const summerDoc = await sp.evaluate(() => WSLSA.buildPrintDoc({ mode: 'A', orient: 'portrait' }));
  check(summerDoc.includes('pd-t-summer') && /<b>Summer:<\/b>/.test(summerDoc), 'the PDF should print the Summer table and its check');
  // adding Summer inside a custom plan needs no setup step; open slots never land in Summer
  await sp.click('[data-action="summer-add"][data-y="3"]');
  check(await sp.evaluate(() => WSLSA.custom().slots.filter(x => x.s === 'Summer').length) === 2 && !(await sp.$('#setup-form')), 'Summer in a custom plan should add the session straight away');
  await sp.evaluate(() => { WSLSA.select('2848|BASE'); });
  check(await sp.evaluate(() => !WSLSA.context().custom && !WSLSA.context().slots.some(s => s.session === 'Summer')), 'WSLSA pathways should stay free of Summer slots');
  check(sp.errors.length === 0 && sp2.errors.length === 0, 'Summer console errors: ' + sp.errors.concat(sp2.errors).join('; '));
  await sp.close();
  await sp2.close();

  // ---------------------------------------------------------------- progress tools: finish date, next to enrol, tick off from results
  const pp = await newPage(browser);
  await pp.goto(APP);
  await pp.evaluate(() => { localStorage.clear(); WSLSA.select('2848|BASE'); });
  check(/Spring 2030/.test(await pp.textContent('#facts')), '2848 full-time should finish in Spring 2030');
  check(JSON.stringify(await pp.$$eval('.year-bar h2 small', s => s.map(x => x.textContent))) === JSON.stringify(['2027', '2028', '2029', '2030']), 'year bars should show calendar years from 2027');
  await pp.click('[data-action="load"][data-load="PT"]');
  check(/Spring 2034/.test(await pp.textContent('#facts')), '2848 part-time should finish in Spring 2034');
  await pp.click('[data-action="load"][data-load="FT"]');
  // next to enrol: the first session with anything left, codes ready to copy
  const y1a = await pp.evaluate(() => WSLSA.context().slots.filter(s => s.year === 1 && s.session === 'Autumn' && !s.pending).map(s => s.code).join(', '));
  check(/Your first session/.test(await pp.textContent('#next')) && /Autumn 2027/.test(await pp.textContent('#next')), 'a fresh plan should point to Autumn 2027 first');
  check(await pp.$eval('[data-action="copy-codes"]', b => b.dataset.codes) === y1a, `Copy subject codes should hold the Year 1 Autumn codes, got ${await pp.$eval('[data-action="copy-codes"]', b => b.dataset.codes)}`);
  await pp.click('[data-action="copy-codes"]');
  await pp.waitForTimeout(100);
  check(/Copied LAWS 1003/.test(await pp.textContent('#toast')), 'copying codes should confirm what was copied');
  await pp.click('#year-1 section[aria-label="Year 1 Autumn session"] [data-action="session-done"]');
  check(/Next to enrol/.test(await pp.textContent('#next')) && /Spring 2027/.test(await pp.textContent('#next')), 'ticking Year 1 Autumn should move Next to enrol to Spring 2027');
  // tick off from results: codes in any format, fails left unticked, other text ignored
  await pp.click('[data-action="import-open"]');
  await pp.fill('#import-text', 'Academic record\nYear 2027 Autumn\nlaws2018 Criminal Law and Procedure  D 74\nLAWS 2013 Torts Law  F 41\nACCT 1007 Financial Accounting Applications C');
  await pp.waitForTimeout(100);
  const rows = await pp.$$eval('.import-row', rs => rs.map(r => [r.querySelector('code').textContent, r.querySelector('input').checked]));
  check(JSON.stringify(rows) === JSON.stringify([['LAWS 2018', true], ['LAWS 2013', false]]), `results should match plan subjects and leave fails unticked, got ${JSON.stringify(rows)}`);
  check(/ACCT 1007/.test(await pp.textContent('#import-results')) && !/YEAR 2027/.test(await pp.textContent('#import-results')), 'subjects outside the plan should be listed and plain text like "Year 2027" ignored');
  await pp.click('#import-apply');
  const ticked = await pp.evaluate(() => { const c = WSLSA.context(); return [c.slots.find(s => s.code === 'LAWS 2018').done, c.slots.find(s => s.code === 'LAWS 2013').done]; });
  check(ticked[0] && !ticked[1], 'applying results should tick LAWS 2018 but not the failed LAWS 2013');
  // emptying the last session in a custom plan brings the finish forward
  await pp.click('[data-action="custom-from-current"]');
  await pp.click('button[type=submit][form=setup-form]');
  for (let guard = 0; guard < 8; guard++) {
    const id = await pp.evaluate(() => { const s = WSLSA.context().slots.find(x => x.year === 4 && x.session === 'Spring'); return s ? s.id : null; });
    if (!id) break;
    await pp.click(`#slot-${id} [data-action="picker-open"]`);
    await pp.click('.modal [data-action="cremove"]');
  }
  check(/Autumn 2030/.test(await pp.textContent('#facts')), 'removing Year 4 Spring should bring the finish forward to Autumn 2030');
  check(pp.errors.length === 0, 'progress tools console errors: ' + pp.errors.join('; '));
  await pp.close();

  // ---------------------------------------------------------------- import my progress (lines as the PDF reader gives them)
  // The date is fixed at 1 November 2026, during Spring 2026, so which sessions have begun does not depend on when this runs.
  const NOW = '2026-11-01T10:00:00';
  const ip = await newPage(browser);
  await ip.goto(APP);
  const planOf = () => ip.evaluate(() => {
    const c = WSLSA.context();
    return { start: WSLSA.custom().start, cp: c.plan.cp, total: c.totalCP, slots: c.slots.map(s => ({ code: s.pending ? '' : s.code, y: s.year, s: s.session, done: s.done, kind: s.typeLabel, replaced: s.replaced ? s.replaced.code : '' })) };
  });
  const at = (plan, code) => plan.slots.find(x => x.code === code) || {};
  await ip.evaluate(() => { localStorage.clear(); WSLSA.select('2848|BASE'); });
  await ip.click('[data-action="progress-open"]');
  check(!!(await ip.$('#progress-file[accept*="pdf"]')) && await ip.isDisabled('#progress-apply'), 'Import my progress should offer a PDF upload and wait for one');
  await ip.setInputFiles('#progress-file', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('LAWS 1003') });
  check(/not a PDF/.test(await ip.textContent('#progress-status')) && await ip.isDisabled('#progress-apply'), 'a file that is not a PDF should be refused');
  // a Degree Works audit for 2785, started Autumn 2025: history in its real sessions, the rest from its Still needed lists
  await ip.evaluate(([lines, now]) => WSLSA.importPdfLines(lines, now), [[
    'Western Sydney University Audit', 'Student, Sample - 10000000',
    'Level Undergraduate Major No Major Program B Accounting/B Laws (2785) School Law Campus PS_2785 Catalogue Term 202530',
    'Accounting and Laws Program Requirements INCOMPLETE', 'Credit points required: 400 Credit points applied: 60 Catalogue Term: 2025 AUTUMN',
    'Fundamentals of Australian Law LAWS 1003 Fundamentals of Australian Law D 10 2025 Autumn, SC 1,', 'WSTC T1',
    'Alternate Subject MATH 1030 Statistics for Business C 10 2025 Autumn, SC 1,', 'WSTC T1',
    'Corporate Finance (UG) ECON 2002 Corporate Financial Management H 10 2025 Spring',
    'Legal Analysis and Critique LAWS 1009 Legal Analysis and Critique D 10 2025 Spring',
    'Torts Law LAWS 2013 Torts Law F 0 2025 Spring',
    'Laws Alternate Pool Subject List LAWS 2012 Regulatory Risk and Compliance P 10 2025 Summer',
    'Government and Public Law LAWS 2008 Government and Public Law NA (10) 2026 Spring',
    'Equity & Trusts Still needed: 10 Credit Points in LAWS 3018',
    'Professional Responsibility and Legal Ethics Still needed: 10 Credit Points in LAWS 2015',
    'Torts Law Still needed: 10 Credit Points in LAWS 2013',
    'Still needed: 20 Credit Points in JUST 2013 or 3008 or LAWS 2005 or 2007 or', '3001 or 3002',
    'Accounting and Law Core Still needed: See Accounting and Laws Core section',
    'Not Currently Applied NOAW 0004 Academic Integrity Module S 0 2025 Autumn, SC 1, WSTC T1',
    'Ellucian Degree Works - Copyright 1995-2026 Ellucian Company L.P.',
  ], NOW]);
  check(/Degree Works audit/.test(await ip.textContent('#progress-status')) && await ip.isEnabled('#progress-apply'), `the audit should be read, got "${await ip.textContent('#progress-status')}"`);
  const preview = await ip.innerText('#progress-results');
  check(/2785 Bachelor of Accounting\/Bachelor of Laws/.test(preview) && /Started Autumn 2025/.test(preview) && /5\s*Completed/.test(preview) && /1\s*Studying now/.test(preview), `the preview should name the degree, start and counts, got ${preview.replace(/\n+/g, ' | ').slice(0, 240)}`);
  check(/LAWS 2013 looks like a fail/.test(preview) && /follows that degree/.test(preview) && /Still needed lists in your audit/.test(preview) && /laid out from Autumn 2027/.test(preview), 'the preview should explain the fail, the degree change and where the rest comes from');
  check(!/\b(D|H|C|P|NA)\b \(?10\)?|2025 Autumn, SC|\(10\)/.test(preview), 'the preview should show no grades, credit point columns or raw terms');
  await ip.click('#progress-apply');
  const dw = await planOf();
  await ip.click('#section-tools [data-action="undo"]');
  check(await ip.evaluate(() => !WSLSA.context().custom) && /Undid: imported your progress/.test(await ip.textContent('#toast')), 'an import should be undoable');
  await ip.click('#section-tools [data-action="redo"]');
  check(JSON.stringify(await planOf()) === JSON.stringify(dw), 'redo should bring the imported plan back');
  check(dw.start === 2025 && dw.cp === 400 && dw.total === 400, `the plan should start in 2025 and hold 400 CP, got start ${dw.start}, ${dw.total}/${dw.cp}`);
  const where = c => { const x = at(dw, c); return x.y + x.s + (x.done ? '+' : '-'); };
  check(['LAWS 1003', 'MATH 1030', 'ECON 2002', 'LAWS 1009', 'LAWS 2012', 'LAWS 2008'].map(where).join(' ') === '1Autumn+ 1Autumn+ 1Spring+ 1Spring+ 1Summer+ 2Spring-',
    `history should sit in its real sessions, passes ticked and subjects in progress not, got ${['LAWS 1003', 'MATH 1030', 'ECON 2002', 'LAWS 1009', 'LAWS 2012', 'LAWS 2008'].map(where).join(' ')}`);
  check(at(dw, 'ECON 2002').replaced === 'FINC 2003' && at(dw, 'MATH 1030').kind === 'Choice' && at(dw, 'LAWS 2012').kind === 'LLB Alternate', 'history should be tied to the pathway slots it fills');
  check(where('LAWS 2015') === '3Autumn-' && where('LAWS 3018') === '3Autumn-' && where('LAWS 2013') === '3Spring-', `what is still needed should start in Autumn 2027, phase-out subjects first and each in its session, got ${['LAWS 2015', 'LAWS 3018', 'LAWS 2013'].map(where).join(' ')}`);
  check(dw.slots.filter(x => !x.code && x.kind === 'LLB Alternate').length === 2 && !dw.slots.some(x => ['LAWS 3001', 'JUST 2013', 'NOAW 0004', 'FINC 2003'].indexOf(x.code) >= 0), 'a list to choose from should become open LLB Alternate slots, with no listed code placed');
  check(JSON.stringify(await ip.$$eval('.year-bar h2 small', s => s.slice(0, 3).map(x => x.textContent))) === JSON.stringify(['2025', '2026', '2027']) && /started 2025/i.test(await ip.textContent('#facts')), 'year bars and facts should show the real calendar years');
  check(/Next to enrol/.test(await ip.textContent('#next')) && /Autumn 2027/.test(await ip.textContent('#next')), `Next to enrol should pass over sessions that have begun, got ${(await ip.textContent('#next')).slice(0, 80)}`);
  check(!/TBC|2026 data|Summer/.test(await ip.textContent('#advisory summary')), 'completed subjects should raise no session or Summer warnings');
  const finishedFolded = await ip.$$eval('#grid .year', ys => ys.filter(y => { const c = y.querySelectorAll('.subj'); return c.length && Array.from(c).every(x => x.classList.contains('is-done')); }).map(y => y.classList.contains('is-folded')));
  check(finishedFolded.length > 0 && finishedFolded.every(Boolean) && !!(await ip.$('#dmap .dm-s.is-next[data-y="3"][data-s="Autumn"]')), `an imported plan should open with finished years folded and the map on the next session, got ${JSON.stringify(finishedFolded)}`);
  await ip.click('[data-action="load"][data-load="PT"]');
  const ptYears = await ip.$$eval('.year', ys => ys.map(y => y.querySelector('h2 small').textContent.slice(0, 4) + ':' + y.querySelectorAll('.subj').length));
  check(ptYears[0] === '2025:5' && ptYears[1] === '2026:1' && ptYears.length > 4, `part-time should keep sessions that have begun and spread the rest, got ${ptYears.join(' ')}`);
  await ip.click('[data-action="load"][data-load="FT"]');
  // the plan and its start year travel in a share link
  const sharedLink = await ip.evaluate(() => WSLSA.planUrl());
  const ip2 = await newPage(browser);
  await ip2.goto(sharedLink);
  const reopened = await ip2.evaluate(() => { const c = WSLSA.custom(); return c.start + ':' + c.slots.filter(x => x.done).length + ':' + c.slots.length; });
  check(reopened === '2025:5:' + dw.slots.length, `a share link should reopen the imported plan with its start year, got ${reopened}`);
  await ip2.close();
  // Year you started in the plan setup keeps past years for a plan built by hand too
  await ip.click('[data-action="custom-setup"]');
  check(await ip.$eval('#cs-year', s => s.value) === '2025', 'the setup should show the year the plan started');
  await ip.selectOption('#cs-year', '2023');
  await ip.click('button[type=submit][form=setup-form]');
  check(await ip.evaluate(() => WSLSA.custom().start) === 2023 && (await ip.$$eval('.year-bar h2 small', s => s[0].textContent)) === '2023', 'changing the year you started should relabel the plan');
  // the 2027 WSLSA pathways stay as they are
  await ip.evaluate(() => WSLSA.select('2785|BASE'));
  check(await ip.$$eval('.year-bar h2 small', s => s[0].textContent) === '2027' && await ip.evaluate(() => !WSLSA.context().custom && !WSLSA.context().slots.some(s => s.done)), 'the 2027 pathway should still start in 2027 with nothing ticked');
  // the Subject Results page, read from printed pages: OCR slips are tolerated, and without Still needed lists the rest follows the pathway
  await ip.click('[data-action="progress-open"]');
  await ip.evaluate(([lines, now]) => WSLSA.importPdfLines(lines, now), [[
    'Subject Results', '2785 - Bachelor of Accounting/Bachelor of Laws',
    'TERM SUBJECT CODE SUBJECT TITLE GRADE MARK CREDIT COUNTED in REASON', 'POINTS GPA PROVIDED (if no',
    '2026 ACCT3007 Corporate D 76 10', 'Autumn Accounting v',
    '2025 LAWS2O03 Contracts Cc 75 10', 'Autumn',
    '2025 ACCT2005 Techs in Finan (¢} 71 10', 'Autumn Acctg', 'https://example.edu/results 1/2', '01/11/2026, 20:50 Banner Page Builder',
    '2025 ACCT1007 Financial 44 10', 'Spring Accounting',
    '2025 NOAWO0004 Academic Integrity S 100 0', 'Autumn Module',
    'Total Credit Points Required 400',
    'View your DegreeWorks audit (https://dw-prod.example/worksheets/WEB31) to',
  ], NOW]);
  const srText = await ip.innerText('#progress-results');
  check(/Subject Results page/.test(await ip.textContent('#progress-status')) && /3\s*Completed/.test(srText) && /does not list what you still need/.test(srText) && /ACCT 1007 looks like a fail/.test(srText), `the results page should give 3 passes, the fail and a note on the rest, got ${srText.replace(/\n+/g, ' | ').slice(0, 240)}`);
  await ip.click('#progress-apply');
  const sr = await planOf();
  const srAt = c => { const x = at(sr, c); return x.y + x.s + (x.done ? '+' : '-'); };
  check(sr.start === 2025 && ['LAWS 2003', 'ACCT 2005', 'ACCT 3007', 'ACCT 1007'].map(srAt).join(' ') === '1Autumn+ 1Autumn+ 2Autumn+ 3Spring-' && sr.total === 400,
    `results should place passes in their sessions and the rest of the pathway from 2027, got start ${sr.start} ${['LAWS 2003', 'ACCT 2005', 'ACCT 3007', 'ACCT 1007'].map(srAt).join(' ')} ${sr.total} CP`);
  check(ip.errors.length === 0, 'Import my progress console errors: ' + ip.errors.join('; '));
  await ip.close();

  // ---------------------------------------------------------------- import real PDF files (loads the PDF reader and text recogniser from jsDelivr)
  if (args.has('--import')) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wslsa-import-'));
    const maker = await newPage(browser, { viewport: { width: 820, height: 600 }, deviceScaleFactor: 2 });
    const rows = [['2024 Autumn', 'LAWS1003', 'Fundamentals of Australian Law', 'D', '77', '10'], ['2024 Spring', 'LAWS2013', 'Torts Law', 'F', '31', '0'],
      ['2025 Autumn', 'LAWS2003', 'Contracts', 'C', '68', '10'], ['2025 Spring', 'LAWS2012', 'Regulatory Risk and Compliance', 'P', '55', '10']];
    // cells are top-aligned, as on the real page, so each subject's grade, mark and credit points share its code's line
    const table = '<style>td,th{vertical-align:top}</style><h1>Subject Results</h1><p style="font:16px Arial">2848 - Bachelor of Laws</p><table style="font:16px Arial;border-spacing:22px 14px"><tr><th>TERM</th><th>SUBJECT CODE</th><th>SUBJECT TITLE</th><th>GRADE</th><th>MARK</th><th>CREDIT POINTS</th></tr>' +
      rows.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</table>';
    await maker.setContent(table);
    await maker.pdf({ path: path.join(tmp, 'results-text.pdf'), format: 'A4' });
    // the same page as a picture, as Print to PDF can save it: there is no text to read, so it goes through OCR
    const shot = await maker.screenshot({ fullPage: true, type: 'png' });
    await maker.setContent(`<img src="data:image/png;base64,${shot.toString('base64')}" style="width:100%">`);
    await maker.pdf({ path: path.join(tmp, 'results-image.pdf'), format: 'A4' });
    await maker.close();
    for (const [file, label] of [['results-text.pdf', 'text'], ['results-image.pdf', 'image']]) {
      const up = await newPage(browser);
      await up.goto(APP);
      await up.evaluate(() => { localStorage.clear(); WSLSA.select('2848|BASE'); });
      await up.click('[data-action="progress-open"]');
      await up.setInputFiles('#progress-file', path.join(tmp, file));
      await up.waitForSelector('#progress-status.is-ok, #progress-status.is-error', { timeout: 180000 });
      const status = await up.textContent('#progress-status');
      if (await up.isEnabled('#progress-apply')) await up.click('#progress-apply');
      const got = await up.evaluate(() => { const c = WSLSA.custom(); return c ? c.start + ' ' + c.slots.filter(x => x.done).map(x => x.code + '@' + x.y + x.s).join(',') : ''; });
      check(got === '2024 LAWS 1003@1Autumn,LAWS 2003@2Autumn,LAWS 2012@2Spring', `a ${label} PDF should place the passed subjects in their sessions and leave out the fail, got "${got}" (${status})`);
      check(up.errors.length === 0, `${label} PDF import console errors: ` + up.errors.join('; '));
      await up.close();
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // ---------------------------------------------------------------- ticking in place
  {
  const ux = await newPage(browser);
  await ux.goto(APP);
  await ux.evaluate(() => { localStorage.clear(); WSLSA.select('2785|BASE'); });
  const slotOf = (pg, code) => pg.evaluate(c => { const s = WSLSA.context().slots.find(x => x.code === c); return s ? s.id : null; }, code);
  const first = await slotOf(ux, 'LAWS 1003');
  await ux.evaluate(id => { document.getElementById('slot-' + id).dataset.mark = 'kept'; }, first);
  await ux.click(`#slot-${first} .tick`);
  const ticked = await ux.evaluate(id => {
    const el = document.getElementById('slot-' + id);
    return { kept: el.dataset.mark, done: el.classList.contains('is-done'), flag: /Completed/.test(el.textContent), saved: !!WSLSA.state().done['2785|BASE'][id], year: document.querySelector('#year-1 .year-cp .done').textContent, mini: document.getElementById('mini-num').textContent, meta: document.getElementById('progress-meta').textContent, aria: document.querySelector('#dock .bar').getAttribute('aria-valuenow') };
  }, first);
  check(ticked.kept === 'kept' && ticked.done && ticked.flag && ticked.saved, `ticking should change the card in place and save it, got ${JSON.stringify(ticked)}`);
  check(/^10 \/ 400/.test((await ux.textContent('#progress-num')).trim()) && ticked.mini === '10 / 400 CP' && ticked.aria === '10' && ticked.year === '10 / 80 CP completed' && /390 CP to go/.test(ticked.meta), `ticking should update every counter, got ${JSON.stringify(ticked)}`);
  await ux.click(`#slot-${first} .tick`);
  check(!(await ux.$(`#slot-${first}.is-done`)) && /^0 \/ 400/.test((await ux.textContent('#progress-num')).trim()), 'unticking should reverse it in place');
  await ux.click('#year-1 .session[data-s="Autumn"] [data-action="session-done"]');
  check(/^40 \/ 400/.test((await ux.textContent('#progress-num')).trim()) && await ux.textContent('#year-1 .session[data-s="Autumn"] [data-action="session-done"]') === 'Unmark all' && /Spring 2027/.test(await ux.textContent('#next')), 'marking a session should update its button, the counters and Next to enrol in place');
  await ux.click('#year-1 .session[data-s="Autumn"] [data-action="session-done"]');

  // ---------------------------------------------------------------- prerequisite chain: sourced rules, and a labelled general order
  const property = await slotOf(ux, 'LAWS 3082');
  const contracts = await slotOf(ux, 'LAWS 2003');
  const torts = await slotOf(ux, 'LAWS 2013');
  const consult = await slotOf(ux, 'ACCT 1005');
  // a hover that scrolls the page first counts only once the pointer moves again, as it would for a person
  const rest = async sel => { await ux.$eval(sel, e => e.scrollIntoView({ block: 'center' })); await ux.waitForTimeout(280); await ux.hover(sel); };
  await rest(`#slot-${property} .subj-title`);
  await ux.waitForTimeout(320);
  const up = await ux.evaluate(([a, b, c]) => [a, b, c].map(i => document.getElementById('slot-' + i).getAttribute('data-xray')), [first, contracts, consult]);
  check(up[0] === 'Prerequisite' && up[1] === 'Prerequisite' && up[2] === null, `hovering LAWS 3082 should mark LAWS 1003 and LAWS 2003 as prerequisites and leave others, got ${JSON.stringify(up)}`);
  check(/2027 Handbook/.test(await ux.textContent('#xray-note')) && await ux.$eval(`#slot-${consult}`, e => getComputedStyle(e).opacity) === '0.34', 'the chain should name its source and dim unrelated cards');
  await rest(`#slot-${first} .subj-title`);
  await ux.waitForTimeout(320);
  const down = await ux.evaluate(([a, b]) => [a, b].map(i => document.getElementById('slot-' + i).getAttribute('data-xray')), [property, torts]);
  check(down[0] === 'Unlocks' && down[1] === 'Usually after', `hovering LAWS 1003 should show Unlocks for a rule and Usually after for the general order, got ${JSON.stringify(down)}`);
  check(/not a Handbook rule/.test(await ux.textContent('#xray-note')), 'the general order should say it is not a Handbook rule');
  await ux.hover('#hero-title');
  await ux.waitForTimeout(160);
  check(!(await ux.$('#grid.is-xray')) && await ux.isHidden('#xray-note'), 'moving away should clear the chain');
  check(!(await ux.$(`#slot-${consult} .chain-btn`)) && !!(await ux.$(`#slot-${torts} .chain-btn`)), 'only subjects with a chain should offer the Chain button');
  await ux.click(`#slot-${torts} .chain-btn`);
  await ux.hover('#hero-title');
  await ux.waitForTimeout(160);
  check(await ux.$eval(`#slot-${first}`, e => e.getAttribute('data-xray')) === 'Usually first' && await ux.$eval(`#slot-${torts} .chain-btn`, e => e.getAttribute('aria-pressed')) === 'true', 'a Chain button should pin the view through pointer moves');
  await ux.keyboard.press('Escape');
  check(!(await ux.$('#grid.is-xray')) && await ux.$eval(`#slot-${torts} .chain-btn`, e => e.getAttribute('aria-pressed')) === 'false', 'Esc should clear a pinned chain');

  // ---------------------------------------------------------------- commute check
  const commute = lists => ux.evaluate(l => WSLSA.commute(l).replace(/<[^>]+>/g, ''), lists);
  check(await commute([['CA'], ['PS']]) === '2 Campuses: CA + PS' || await commute([['CA'], ['PS']]) === '2 Campuses: PS + CA', `two far campuses should be flagged, got "${await commute([['CA'], ['PS']])}"`);
  check(await commute([['PS'], ['PC']]) === '', 'the Parramatta campuses count as one place');
  check(await commute([['PS', 'CA'], ['CA']]) === '', 'subjects that can share a campus should not be flagged');
  check(await commute([['ON', 'CA'], ['PS']]) === '', 'a subject with an online offering should not force a trip');
  check(/^3 Campuses/.test(await commute([['HA'], ['CA'], ['PS']])), 'three far campuses should say three');

  // ---------------------------------------------------------------- auto-suggest open slots, with one-click undo
  await ux.evaluate(() => { localStorage.clear(); WSLSA.select('2848|BASE'); });
  await ux.selectOption('#sel-campus', 'PS');
  const openNow = () => ux.evaluate(() => WSLSA.context().slots.filter(s => s.pending).length);
  const openBefore = await openNow();
  await ux.click('[data-action="suggest"]');
  const sug = await ux.evaluate(() => {
    const c = WSLSA.context();
    const chosen = c.slots.filter(s => s.chosen && s.offer);
    const codes = c.slots.filter(s => !s.pending).map(s => s.code);
    return { n: chosen.length, bad: chosen.filter(s => s.offer.tbc || s.offer.none || (s.offer.codes.indexOf('PS') < 0 && s.offer.codes.indexOf('ON') < 0)).map(s => s.code), dupes: codes.length - new Set(codes).size };
  });
  check(await openNow() < openBefore && sug.n > 0 && !sug.bad.length && sug.dupes === 0, `suggestions should run in that session at the campus or online, with no repeats, got ${JSON.stringify(sug)}`);
  check(/Suggested/.test(await ux.textContent('#toast')) && !!(await ux.$('#toast [data-action="undo"]')), 'suggesting should offer an undo');
  await ux.click('#section-tools [data-action="undo"]');
  check(await openNow() === openBefore, 'undo should restore the open slots');
  await ux.selectOption('#sel-campus', '');

  // ---------------------------------------------------------------- drag between sessions in a custom plan
  await ux.evaluate(() => { localStorage.clear(); WSLSA.select('2785|BASE'); });
  check((await ux.$$('.subj[draggable="true"]')).length === 0, 'a WSLSA pathway should not be draggable');
  await ux.click('[data-action="custom-from-current"]');
  await ux.click('button[type=submit][form=setup-form]');
  const dragged = await slotOf(ux, 'LAWS 1003');
  const from = await (await ux.$(`#slot-${dragged} .subj-title`)).boundingBox();
  await ux.mouse.move(from.x + 10, from.y + 5);
  await ux.mouse.down();
  await ux.mouse.move(from.x + 40, from.y + 30, { steps: 4 });
  await ux.waitForTimeout(120);
  const target = await (await ux.$('#year-1 .session[data-s="Spring"] .session-head')).boundingBox();
  await ux.mouse.move(target.x + 30, target.y + 8, { steps: 6 });
  await ux.mouse.move(target.x + 34, target.y + 9); // the browser sends dragover on the move after entering
  await ux.waitForTimeout(80);
  const zones = await ux.evaluate(() => ({ warn: document.querySelector('#year-1 .session[data-s="Spring"]').className, badge: (document.querySelector('#year-1 .session[data-s="Spring"] .drop-badge') || {}).textContent, home: !!document.querySelector('#year-1 .session[data-s="Autumn"].drop-home') }));
  check(/drop-warn/.test(zones.warn) && /drop-over/.test(zones.warn) && /over the 40 CP load/.test(zones.badge || '') && zones.home, `dragging onto a full session should warn about the load, got ${JSON.stringify(zones)}`);
  await ux.mouse.up();
  const moved = await ux.evaluate(() => { const c = WSLSA.custom().slots.find(x => x.code === 'LAWS 1003'); return c.y + c.s; });
  check(moved === '1Spring' && /moved to Year 1 Spring/.test(await ux.textContent('#toast')) && !(await ux.$('.drop-badge, .drop-warn, .drop-ok')), `dropping should move the subject and clear the highlights, got ${moved}`);
  await ux.click('[data-action="load"][data-load="PT"]');
  check((await ux.$$('.subj[draggable="true"]')).length === 0, 'the part-time view should not be draggable');
  await ux.click('[data-action="load"][data-load="FT"]');

  // ---------------------------------------------------------------- windows: focus trap, inert page, focus returns, Esc
  await ux.evaluate(() => { localStorage.clear(); WSLSA.select('2848|BASE'); });
  const opener = await ux.$('[data-action="picker-open"]');
  await opener.focus();
  await ux.keyboard.press('Enter');
  check(await ux.evaluate(() => document.getElementById('app').inert) && await ux.evaluate(() => !!document.activeElement.closest('.modal')), 'a window should make the page inert and take focus');
  let escaped = false;
  for (let i = 0; i < 90; i++) {
    await ux.keyboard.press('Tab');
    if (!(await ux.evaluate(() => !!document.activeElement.closest('.modal')))) escaped = true;
  }
  check(!escaped, 'Tab should stay inside a window');
  await ux.fill('#pick-q', 'zzzzqqqq');
  check(!!(await ux.$('.pick-empty [data-action="pick-reset"]')), 'an empty picker search should offer Clear filters');
  await ux.click('.pick-empty [data-action="pick-reset"]');
  check(await ux.inputValue('#pick-q') === '' && (await ux.$$('.pick')).length > 0, 'Clear filters should bring the subjects back');
  check(/Esc/.test(await ux.textContent('.modal-tools')), 'the picker should show its keyboard hints');
  await ux.keyboard.press('Escape');
  await ux.waitForTimeout(40);
  check(!(await ux.$('.modal')) && await ux.evaluate(() => !document.getElementById('app').inert) && await ux.evaluate(() => document.activeElement.dataset.action === 'picker-open'), 'Esc should close the window and return focus to what opened it');

  // ---------------------------------------------------------------- catalogue search states
  await ux.evaluate(() => { document.activeElement.blur(); });
  await ux.keyboard.press('/');
  check(await ux.evaluate(() => document.activeElement.id === 'grid-q'), '/ should go to the filter on the plan');
  await ux.keyboard.press('Escape');
  await ux.click('[data-action="tab"][data-tab="catalogue"]');
  await ux.evaluate(() => { document.activeElement.blur(); document.getElementById('cat-q').scrollIntoView({ block: 'center' }); });
  await ux.keyboard.press('/');
  check(await ux.evaluate(() => document.activeElement.id === 'cat-q'), '/ should go to the catalogue search when the catalogue is on screen');
  await ux.fill('#cat-q', 'zzzzqqqq');
  check(!!(await ux.$('#cat-results .pick-empty [data-action="cat-reset"]')), 'an empty catalogue search should offer Clear filters');
  await ux.click('[data-action="cat-reset"]');
  check((await ux.$$('#cat-results tbody tr')).length > 0 && await ux.inputValue('#cat-q') === '', 'Clear filters should bring the catalogue back');
  await ux.fill('#cat-q', 'torts');
  await ux.keyboard.press('Escape');
  check(await ux.inputValue('#cat-q') === '', 'Esc should clear the catalogue search');
  check(ux.errors.length === 0, 'mapping and accessibility console errors: ' + ux.errors.join('; '));
  await ux.close();

  // ---------------------------------------------------------------- with animations on
  const mo = await newPage(browser, { reducedMotion: 'no-preference' });
  await mo.goto(APP);
  await mo.evaluate(() => { localStorage.clear(); WSLSA.select('2785|BASE'); });
  await mo.click('[data-action="load"][data-load="PT"]');
  check(await mo.evaluate(() => document.documentElement.classList.contains('vt-cards')), 'changing the load should run a view transition with gliding cards');
  await mo.waitForFunction(() => /part-time/.test(document.querySelector('.year-bar h2 small').textContent));
  await mo.waitForTimeout(500);
  await mo.click('[data-action="load"][data-load="FT"]');
  await mo.waitForFunction(() => !/part-time/.test(document.querySelector('.year-bar h2 small').textContent));
  await mo.waitForFunction(() => !document.documentElement.classList.contains('vt-cards'));
  await mo.selectOption('#sel-degree', '2848');
  check(!!(await mo.$('#grid.is-entering')), 'choosing a degree should settle the cards in');
  await mo.waitForTimeout(1100);
  check(!(await mo.$('#grid.is-entering')), 'the entrance should tidy up after itself');
  // the advisory glides open rather than snapping
  const glides = await mo.evaluate(async () => {
    const box = document.getElementById('advisory-box');
    const closed = box.offsetHeight;
    box.open = true;
    await new Promise(r => setTimeout(r, 90));
    const during = box.offsetHeight;
    await new Promise(r => setTimeout(r, 450));
    const open = box.offsetHeight;
    box.open = false;
    return { closed, during, open };
  });
  check(glides.during > glides.closed && glides.during < glides.open, `the advisory should pass through a height between closed and open, got ${JSON.stringify(glides)}`);
  await mo.waitForTimeout(400);
  // a full year completed: the counter lands on the true number and the bars glow
  for (const s of ['Autumn', 'Spring']) await mo.click(`#year-1 .session[data-s="${s}"] [data-action="session-done"]`);
  check(!!(await mo.$('#year-1 .year-bar.year-glow')) && !!(await mo.$('#dock .bar.glow')), 'completing a year should pulse its bar and the progress bar');
  await mo.waitForFunction(() => /^80 \/ 320/.test(document.getElementById('progress-num').textContent.trim()));
  check(await mo.evaluate(() => document.querySelector('#dock .bar > span').style.width) === '25%', 'the progress bar should land on the true width');
  // a window fades out before it leaves the page, and reopening during that keeps the new one
  await mo.click('[data-action="import-open"]');
  await mo.keyboard.press('Escape');
  check(!!(await mo.$('#modal-root.closing .modal')), 'a closing window should stay for its fade');
  await mo.waitForFunction(() => !document.querySelector('#modal-root .modal'));
  check(!(await mo.$('#modal-root.closing')), 'the fade should tidy up');
  await mo.click('[data-action="import-open"]');
  await mo.keyboard.press('Escape');
  await mo.click('[data-action="progress-open"]', { force: true }).catch(() => {});
  await mo.waitForTimeout(220);
  check(!(await mo.$('#modal-root.closing')), 'opening straight after closing should not leave the old fade running');
  await mo.evaluate(() => { const b = document.querySelector('#modal-root .modal-x'); if (b) b.click(); });
  await mo.waitForTimeout(220);
  // a subject glides to its new session in a custom plan
  await mo.click('[data-action="custom-from-current"]');
  await mo.click('button[type=submit][form=setup-form]');
  await mo.waitForTimeout(1100);
  const glide = await mo.evaluate(() => { const c = WSLSA.context().slots.find(s => !s.pending && !s.done); return c.id; });
  await mo.click(`#slot-${glide} [data-action="clear"]`);
  await mo.waitForFunction(() => !document.documentElement.classList.contains('vt-cards'));
  check(await mo.evaluate(id => !!document.querySelector('#slot-' + id + '.is-pending'), glide), 'a change inside a view transition should still land');
  await mo.click('[data-action="grid-view"][data-view="action"]');
  await mo.waitForFunction(() => !document.documentElement.classList.contains('vt-cards') && document.getElementById('grid').classList.contains('view-action'));
  check(await mo.$$eval('#grid .subj', c => c.filter(x => x.getClientRects().length).every(x => x.classList.contains('is-action'))), 'changing the view inside a view transition should still land');
  await mo.click('[data-action="grid-view"][data-view="all"]');
  await mo.waitForFunction(() => !document.documentElement.classList.contains('vt-cards') && !document.getElementById('grid').classList.contains('view-action'));
  await mo.click('#section-tools [data-action="undo"]');
  await mo.waitForFunction(() => !document.documentElement.classList.contains('vt-cards') && /Undid/.test(document.getElementById('toast').textContent));
  await mo.click('#section-tools [data-action="redo"]');
  await mo.waitForFunction(() => !document.documentElement.classList.contains('vt-cards') && /Redid/.test(document.getElementById('toast').textContent));
  await mo.click('#year-2 [data-action="year-toggle"]');
  await mo.waitForFunction(() => !document.documentElement.classList.contains('vt-cards') && document.getElementById('year-2').classList.contains('is-folded'));
  check(await mo.isHidden('#year-2-body'), 'folding a year inside a view transition should still land');
  await mo.click('#year-2 [data-action="year-toggle"]');
  await mo.waitForFunction(() => !document.documentElement.classList.contains('vt-cards') && !document.getElementById('year-2').classList.contains('is-folded'));
  check(mo.errors.length === 0, 'animation console errors: ' + mo.errors.join('; '));
  await mo.close();
  }

  // ---------------------------------------------------------------- planning tools: tick sync, hover intent, areas, load, defer, compare, calendar
  {
    const pt = await newPage(browser);
    await pt.goto(APP);
    const idOf = (code) => pt.evaluate(c => { const s = WSLSA.context().slots.find(x => x.code === c); return s ? s.id : null; }, code);
    await pt.evaluate(() => { localStorage.clear(); WSLSA.select('2785|BASE'); });

    // ticking keeps the details panel in sync without rebuilding it
    const a1 = await idOf('LAWS 1003');
    await pt.evaluate(() => { document.querySelector('#details .tab-panel').dataset.mark = 'kept'; });
    check((await pt.textContent('#details [data-done-row] .cpv')).trim() === '0 / 400 CP', 'the details panel should show completed credit points');
    await pt.click(`#slot-${a1} .tick`);
    check((await pt.textContent('#details [data-done-row] .cpv')).trim() === '10 / 400 CP' && await pt.$eval('#details [data-done-row] .sbar span', e => e.style.width) === '3%' && await pt.$eval('#details .tab-panel', e => e.dataset.mark) === 'kept', 'ticking should update the details bar in place');
    await pt.click(`#slot-${a1} .tick`);

    // hover intent: nothing dims until the pointer has rested, and the Chain button responds at once
    const prop = await idOf('LAWS 3082');
    const stray = await idOf('ACCT 1005');
    await pt.evaluate(i => document.getElementById('slot-' + i).scrollIntoView({ block: 'center' }), prop);
    await pt.waitForTimeout(300);
    await pt.hover(`#slot-${prop} .subj-title`);
    await pt.waitForTimeout(90);
    check(!(await pt.$('#grid.is-xray')), 'passing over a card should not dim anything');
    await pt.waitForTimeout(240);
    check(!!(await pt.$('#grid.is-xray')), 'resting on a card should show its chain');
    await pt.hover('#hero-title', { force: true }).catch(() => {});
    await pt.mouse.move(2, 2);
    await pt.waitForTimeout(120);
    check(!(await pt.$('#grid.is-xray')), 'leaving should clear the chain');
    await pt.hover(`#slot-${prop} .subj-title`);
    await pt.mouse.wheel(0, 300);
    await pt.waitForTimeout(340);
    check(!(await pt.$('#grid.is-xray')), 'scrolling should cancel a pending chain');
    const under = await pt.evaluate(() => { const c = document.querySelector('#grid .chain-btn').closest('.subj'); c.scrollIntoView({ block: 'center' }); return c.dataset.slot; });
    await pt.waitForTimeout(300);
    const ub = await (await pt.$(`#slot-${under} .subj-title`)).boundingBox();
    await pt.mouse.move(ub.x + 5, ub.y + 5);
    await pt.mouse.move(ub.x + 12, ub.y + 7);
    await pt.waitForTimeout(320);
    check(!!(await pt.$('#grid.is-xray')), 'moving the pointer on a card after scrolling should bring up its chain');
    await pt.mouse.move(2, 2);
    await pt.waitForTimeout(120);
    await pt.evaluate(i => document.getElementById('slot-' + i).scrollIntoView({ block: 'center' }), prop);
    await pt.waitForTimeout(300);
    await pt.hover(`#slot-${prop} .chain-btn`);
    await pt.waitForTimeout(70);
    check(!!(await pt.$('#grid.is-xray')), 'the Chain button should respond at once');
    await pt.mouse.move(2, 2);
    await pt.waitForTimeout(120);

    // practice areas in the catalogue and picker
    const areas = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'practice-areas.json'), 'utf8'));
    const store = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'wslsa-2027.json'), 'utf8'));
    const llb = new Set();
    store.degrees.forEach(d => d.catalogue.filter(c => c.component.startsWith('LLB Alternate')).forEach(c => llb.add(c.code)));
    const untagged = [...llb].filter(c => !areas.subjects[c]);
    check(llb.size === 60 && JSON.stringify(untagged) === JSON.stringify(['LAWS 4016']), `every LLB Alternate should have an area except LAWS 4016, got ${JSON.stringify(untagged)}`);
    await pt.evaluate(() => { WSLSA.select('2848|BASE'); });
    await pt.click('[data-action="tab"][data-tab="catalogue"]');
    check((await pt.$$('[data-action="cat-area"]')).length === 7 && /WSLSA groupings/.test(await pt.textContent('#details .tab-panel')), 'the catalogue should offer All Areas and six areas, and say what they are');
    await pt.click('[data-action="cat-area"][data-area="clinics"]');
    const clinicRows = await pt.$$eval('#cat-results tbody td.c-code', t => t.map(x => x.textContent).sort());
    check(JSON.stringify(clinicRows) === JSON.stringify(['LAWS 3053', 'LAWS 3074', 'LAWS 3077', 'LAWS 4012', 'LAWS 4017']), `Clinics & Internships should list the five subjects, got ${JSON.stringify(clinicRows)}`);
    check((await pt.$$('#cat-results .area-tag')).length >= 5, 'matching rows should show their area');
    await pt.click('[data-action="cat-area"][data-area=""]');
    check((await pt.$$('#cat-results tbody tr')).length > 60, 'All Areas should bring everything back');
    await pt.click('[data-action="tab"][data-tab="structure"]');
    const llbSlot = await pt.evaluate(() => WSLSA.context().slots.find(s => s.kind === 'llb' && s.session === 'Autumn').id);
    await pt.click(`#slot-${llbSlot} [data-action="picker-open"]`);
    await pt.click('[data-action="pick-area"][data-area="tech"]');
    const techRows = await pt.$$eval('#pick-results .pick', r => r.map(x => x.querySelector('.p-code').textContent));
    check(techRows.length > 0 && techRows.every(c => (areas.subjects[c] || []).includes('tech')) && (await pt.$$('#pick-results .area-tag')).length >= techRows.length, `an area chip should filter the picker and tag its rows, got ${JSON.stringify(techRows)}`);
    await pt.keyboard.press('Escape');

    // heavy load pill, with the mix in its tooltip, and none once a session is finished
    await pt.evaluate(() => { WSLSA.select('2785|BASE'); });
    const pills = await pt.$$eval('.load-pill', p => p.map(x => ({ t: x.textContent, tip: x.title, s: x.closest('.session').dataset.y + x.closest('.session').dataset.s })));
    const heavyByHand = await pt.evaluate(() => {
      const by = {};
      WSLSA.context().slots.forEach(s => { if (!s.pending) { const k = s.year + s.session; by[k] = (by[k] || 0) + (/^LAWS [34]/.test(s.code) ? 1 : 0); } });
      return Object.keys(by).filter(k => by[k] >= 3).sort();
    });
    check(JSON.stringify(pills.map(p => p.s).sort()) === JSON.stringify(heavyByHand) && pills.length > 0 && pills[0].t === 'Heavy L3/4 Load' && /Mix: \d+ Law, \d+ non-Law; Level 1: \d/.test(pills[0].tip), `load pills should mark sessions with three or more Level 3 or 4 Law subjects, got ${JSON.stringify(pills)} vs ${JSON.stringify(heavyByHand)}`);
    const hy = pills[0].s.match(/^(\d+)(\w+)$/);
    const heavySection = `#year-${hy[1]} .session[data-s="${hy[2]}"]`;
    await pt.click(`${heavySection} [data-action="session-done"]`);
    check(!(await pt.$(`${heavySection} .load-pill`)), 'a finished session should lose its pill');
    await pt.click(`${heavySection} [data-action="session-done"]`);

    // defer from a WSLSA pathway makes the student's own copy, and undo restores all of it
    await pt.evaluate(() => { localStorage.clear(); WSLSA.select('2785|BASE'); });
    const place = code => pt.evaluate(c => { const s = WSLSA.context().slots.find(x => x.code === c); return { y: s.year, s: s.session, i: (s.year - 1) * 3 + ['Autumn', 'Spring', 'Summer'].indexOf(s.session), none: !!(s.offer && s.offer.none) }; }, code);
    const prereq = await place('ACCT 2001');
    const dependent = await place('ACCT 3011');
    check(prereq.i < dependent.i, 'the 2785 pathway should place ACCT 2001 before ACCT 3011');
    await pt.click(`#slot-${await idOf('ACCT 2001')} [data-action="defer"]`);
    const afterPre = await place('ACCT 2001');
    const afterDep = await place('ACCT 3011');
    check(await pt.evaluate(() => WSLSA.context().custom && WSLSA.custom().tpl === '2785|BASE'), 'deferring from a pathway should make an editable copy');
    check(afterPre.i > prereq.i && !afterPre.none && afterDep.i > afterPre.i && !afterDep.none, `deferring should move the subject to an offered session and cascade what needs it, got ${JSON.stringify({ afterPre, afterDep })}`);
    check(/Deferred ACCT 2001 to .*moved ACCT 3011/.test(await pt.textContent('#toast')) && !!(await pt.$('#toast [data-action="undo"]')), `the toast should sum up the moves and offer Undo, got "${await pt.textContent('#toast')}"`);
    await pt.click('#toast [data-action="undo"]');
    check(await pt.evaluate(() => !WSLSA.context().custom && WSLSA.custom() === null) && (await place('ACCT 2001')).i === prereq.i, 'Undo should go back to the pathway as it was');
    // a subject with unpublished sessions still moves, and says to check; a passed one and the part-time view have no button
    await pt.click(`#slot-${await idOf('LAWS 3099')} [data-action="defer"]`);
    check(/unpublished/.test(await pt.textContent('#toast')), 'deferring a subject with unpublished sessions should say so');
    const c1 = await idOf('LAWS 1003');
    await pt.click(`#slot-${c1} .tick`);
    check(!(await pt.$(`#slot-${c1} [data-action="defer"]`)), 'a passed subject should not offer Defer');
    await pt.click('[data-action="load"][data-load="PT"]');
    check(!(await pt.$('[data-action="defer"]')), 'the part-time view should not offer Defer');
    await pt.click('[data-action="load"][data-load="FT"]');
    // the Move window offers it too
    const c2 = await idOf('ACCT 1005');
    const before2 = await place('ACCT 1005');
    await pt.click(`#slot-${c2} [data-action="picker-open"]`);
    await pt.click('.modal [data-action="defer"]');
    check(!(await pt.$('.modal')) && (await place('ACCT 1005')).i > before2.i, 'the Move window should defer and close');
    // replacing an existing custom plan asks first, and declining changes nothing
    await pt.evaluate(() => { WSLSA.select('2848|BASE'); });
    const planBefore = await pt.evaluate(() => JSON.stringify(WSLSA.custom()));
    pt.once('dialog', d => d.dismiss());
    await pt.click(`#slot-${await idOf('LAWS 1003')} [data-action="defer"]`);
    check(await pt.evaluate(() => JSON.stringify(WSLSA.custom())) === planBefore && await pt.evaluate(() => !WSLSA.context().custom), 'declining should keep the custom plan and stay on the pathway');

    // pin a snapshot, change things, compare; it survives a reload
    await pt.evaluate(() => { localStorage.clear(); WSLSA.select('2788|T046'); });
    check(!(await pt.$('[data-action="compare"]')), 'there should be nothing to compare before pinning');
    await pt.click('#section-tools [data-action="pin"]');
    check(!!(await pt.$('[data-action="compare"]')) && /Snapshot pinned/.test(await pt.textContent('#toast')), 'pinning should offer Compare');
    await pt.click('[data-action="load"][data-load="PT"]');
    await pt.click('[data-action="compare"]');
    const rowsPT = await pt.$$eval('.compare-table tbody tr', r => r.map(x => [x.querySelector('th').textContent, x.classList.contains('is-diff')]));
    const labels = rowsPT.map(r => r[0]);
    check(['Final completion session', 'Total sessions', 'Summer sessions used', 'Multi-campus commute sessions', 'Heavy L3/4 load sessions'].every(l => labels.includes(l)) && rowsPT.find(r => r[0] === 'Final completion session')[1], `the comparison should show its measures and mark a changed finish, got ${JSON.stringify(rowsPT)}`);
    await pt.click('.modal-foot [data-action="modal-close"]');
    await pt.click('[data-action="load"][data-load="FT"]');
    await pt.selectOption('#sel-major', '2788|T039');
    await pt.click('[data-action="compare"]');
    const diff = await pt.$$eval('.modal .pick-section', s => s.map(x => [x.querySelector('h3 span').textContent, x.querySelectorAll('.chipbtn').length]));
    check(diff.find(d => d[0] === 'Subjects added')[1] > 0 && diff.find(d => d[0] === 'Subjects removed')[1] > 0, `changing major should list subjects added and removed, got ${JSON.stringify(diff)}`);
    check((await pt.$$eval('.compare-table tr.is-diff th', t => t.map(x => x.textContent))).includes('Plan'), 'the comparison should show the plan changed');
    await pt.click('.modal-foot [data-action="modal-close"]');
    await pt.reload();
    check(!!(await pt.$('[data-action="compare"]')), 'a pinned snapshot should survive a reload');
    await pt.click('[data-action="compare"]');
    await pt.click('[data-action="pin-clear"]');
    check(!(await pt.$('[data-action="compare"]')) && await pt.evaluate(k => localStorage.getItem(k), 'wslsa-2027-pathway-explorer:v1:pin') === null, 'Remove pin should clear the snapshot');

    // Copy Codes holds codes and titles; Export .ics saves a valid calendar file
    await pt.evaluate(() => { localStorage.clear(); WSLSA.select('2848|BASE'); });
    const copyText = await pt.$eval('[data-action="copy-codes"]', b => b.dataset.copy);
    check(copyText.split('\n').length === await pt.evaluate(() => WSLSA.context().slots.filter(s => s.year === 1 && s.session === 'Autumn' && !s.pending).length) && copyText.startsWith('LAWS 1003 Fundamentals of Australian Law') && await pt.textContent('[data-action="copy-codes"]') === 'Copy Codes', `Copy Codes should hold each code and title, got ${JSON.stringify(copyText)}`);
    const [dl] = await Promise.all([pt.waitForEvent('download'), pt.click('[data-action="ics"]')]);
    const ics = fs.readFileSync(await dl.path(), 'utf8');
    const unfolded = ics.replace(/\r\n /g, '');
    check(dl.suggestedFilename() === 'wslsa-autumn-2027.ics' && /^BEGIN:VCALENDAR\r\n/.test(ics) && /END:VCALENDAR\r\n$/.test(ics), `the calendar file should be well formed, got ${dl.suggestedFilename()}`);
    check(/DTSTART;VALUE=DATE:20270301\r\n/.test(ics) && /DTEND;VALUE=DATE:20270302\r\n/.test(ics) && /TRIGGER:-P14D/.test(ics) && unfolded.includes('LAWS 1003 Fundamentals of Australian Law (') && unfolded.includes('estimate'), 'the calendar file should hold the session, subjects, campuses and say the date is an estimate');
    check(ics.split('\r\n').every(l => Buffer.byteLength(l) <= 75) && !/[^\r]\n/.test(ics), 'calendar lines should be folded and end in CRLF');
    check(pt.errors.length === 0, 'planning tools console errors: ' + pt.errors.join('; '));
    await pt.close();

    // with animations on, Next to enrol only animates when its session changes
    const an = await newPage(browser, { reducedMotion: 'no-preference' });
    await an.goto(APP);
    await an.evaluate(() => { localStorage.clear(); WSLSA.select('2848|BASE'); });
    await an.waitForTimeout(100);
    const ids = await an.evaluate(() => WSLSA.context().slots.filter(s => s.year === 1 && s.session === 'Autumn').map(s => s.id));
    await an.click(`#slot-${ids[0]} .tick`);
    check(!(await an.$('#next.is-changed')) && !/LAWS 1003/.test(await an.textContent('#next .chiplist')), 'ticking within the same session should update Next to enrol without animating it');
    for (const i of ids.slice(1)) await an.click(`#slot-${i} .tick`);
    check(!!(await an.$('#next.is-changed')) && /Spring 2027/.test(await an.textContent('#next')), 'finishing the session should animate Next to enrol to the new one');
    check(an.errors.length === 0, 'next to enrol animation console errors: ' + an.errors.join('; '));
    await an.close();
  }

  // ---------------------------------------------------------------- layout, degree map and folding years
  const pageTop = (p, s) => p.evaluate(x => Math.round(document.querySelector(x).getBoundingClientRect().top + window.scrollY), s);
  const headingSkips = (p, root) => p.evaluate(r => {
    const out = [];
    let prev = 0;
    document.querySelectorAll(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map(h => r + ' ' + h).join(',')).forEach(h => {
      if (!h.getClientRects().length || h.closest('#preview-stage')) return;
      const level = +h.tagName[1];
      if (prev && level > prev + 1) out.push(h.tagName + ' ' + h.textContent.trim().slice(0, 40));
      prev = level;
    });
    return out;
  }, root);
  // 24 px is the WCAG 2.2 minimum; links inside a sentence are exempt, and a checkbox's target is its label
  const smallTargets = p => p.evaluate(() => {
    const out = new Set();
    document.querySelectorAll('#app a[href], #app button, #app select, #app summary, #app label.tick, #app [role="button"], #modal-root a[href], #modal-root button, #modal-root select').forEach(el => {
      if (!el.getClientRects().length || el.matches('p a, li a') || el.closest('#preview-stage')) return;
      const r = el.getBoundingClientRect();
      if (r.width < 24 || r.height < 24) out.add((el.className || el.tagName) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    });
    return Array.from(out);
  });
  const lay = await newPage(browser, { viewport: { width: 1440, height: 900 } });
  lay.on('dialog', d => d.accept());
  await lay.goto(APP);
  await lay.evaluate(() => { localStorage.clear(); WSLSA.select('2785|BASE'); });
  await lay.evaluate(() => document.fonts.ready);
  check(await pageTop(lay, '#dmap') < 850 && await pageTop(lay, '#grid .year') < 900 && await pageTop(lay, '#grid .subj') < 1000, `the plan should start on a laptop's first screen, map at ${await pageTop(lay, '#dmap')}, first subject at ${await pageTop(lay, '#grid .subj')}`);
  check((await headingSkips(lay, '#app')).length === 0, 'headings should not skip a level: ' + (await headingSkips(lay, '#app')).join('; '));
  check((await smallTargets(lay)).length === 0, 'controls should be at least 24 px: ' + (await smallTargets(lay)).join('; '));
  const landmarks = await lay.$$eval('#grid section[aria-label]', s => s.map(x => x.getAttribute('aria-label')));
  check(landmarks.length === 10 && new Set(landmarks).size === 10, 'each session landmark should have its own name');
  check(await lay.evaluate(() => { const b = document.createElement('button'); b.className = 'btn'; b.disabled = true; document.body.appendChild(b); const o = getComputedStyle(b).opacity; b.remove(); return o; }) === '0.5', 'a disabled button should look disabled');
  // the skip link
  await lay.evaluate(() => { document.activeElement.blur(); window.scrollTo(0, 0); });
  await lay.keyboard.press('Tab');
  check(await lay.evaluate(() => document.activeElement.classList.contains('skip-link') && document.activeElement.getBoundingClientRect().top >= 0), 'the first Tab should show the skip link');
  await lay.keyboard.press('Enter');
  check(await lay.evaluate(() => document.activeElement.id === 'plan-heading' && !location.hash), 'the skip link should move focus to the plan, without changing the address');
  await lay.evaluate(() => window.scrollTo(0, 0));
  // the School of Law advice stays in view, and its detail opens from it
  check(/2026 Handbook/.test(await lay.textContent('.notice-lead')) && await lay.isVisible('.notice-lead') && await lay.isHidden('#enquiry-box .phase-grid'), 'the notice should show its advice with the detail closed');
  await lay.click('.notice-cta');
  await lay.click('.enq-more > summary');
  check(await lay.isVisible('#enquiry-box .phase-grid') && await lay.isVisible('#enquiry-box .enq-to a'), 'the notice should open the box, with the phase-out subjects and contact');
  await lay.click('.enq-pill');
  // the legend keeps its colours in view, and stays open across a re-render once opened
  check(await lay.isHidden('#legend .lg-body') && await lay.isVisible('#legend .lg-sw'), 'the legend should start closed with its colours showing');
  await lay.click('#legend-box > summary');
  await lay.evaluate(() => WSLSA.select('2785|BASE'));
  check(await lay.isVisible('#legend .lg-body'), 'an open legend should stay open across a re-render');
  await lay.click('#legend-box > summary');
  // the catalogue table no longer inherits a subject label's tracked capitals
  await lay.click('[data-action="tab"][data-tab="catalogue"]');
  check(await lay.$eval('#cat-results tbody td:nth-child(2)', td => getComputedStyle(td).textTransform) === 'none', 'catalogue rows should read in ordinary case');
  check(await lay.$eval('#cat-results .table-scroll', t => t.tabIndex === 0 && t.getAttribute('role') === 'region' && !!t.getAttribute('aria-label')), 'the catalogue table should scroll from the keyboard');
  check((await smallTargets(lay)).length === 0, 'catalogue controls should be at least 24 px: ' + (await smallTargets(lay)).join('; '));
  await lay.click('[data-action="tab"][data-tab="structure"]');
  // windows keep their headings in order too
  const windowSlot = await lay.evaluate(() => WSLSA.context().slots.find(s => s.kind === 'llb').id);
  await lay.click(`#slot-${windowSlot} [data-action="picker-open"]`);
  check((await headingSkips(lay, '#modal-root')).length === 0 && !(await lay.$('#modal-root h4')), 'picker headings should not skip a level');
  check(/WSLSA groupings/.test(await lay.textContent('.modal-tools .area-note')), 'the picker should say what practice areas are');
  await lay.keyboard.press('Escape');
  await lay.click('[data-action="export-open"]');
  check((await headingSkips(lay, '#modal-root')).length === 0 && await lay.$eval('#preview-stage', s => s.inert) && await lay.$eval('#export-preview', b => b.tabIndex === 0), 'the A4 preview should be out of the way of a screen reader, with its box scrollable');
  await lay.keyboard.press('Escape');
  // per-card tools wait until the card is in use
  const quiet = await lay.evaluate(() => { const b = document.querySelector('#grid .defer-btn'); b.closest('.subj').scrollIntoView({ block: 'center' }); return b.dataset.slot; });
  const toolOpacity = () => lay.$eval(`#slot-${quiet} .defer-btn`, b => getComputedStyle(b).opacity);
  await lay.mouse.move(0, 0);
  check(await toolOpacity() === '0', 'a card at rest should not show its tools');
  await lay.hover(`#slot-${quiet} .subj-title`);
  check(await toolOpacity() === '1', 'hovering a card should show its tools');
  await lay.mouse.move(0, 0);
  await lay.focus(`#slot-${quiet} .defer-btn`);
  check(await toolOpacity() === '1', 'keyboard focus should show a card\'s tools');
  await lay.evaluate(() => { document.activeElement.blur(); window.scrollTo(0, 0); });
  // the degree map
  const segments = (y, s) => lay.$$eval(`#dmap .dm-s[data-y="${y}"][data-s="${s}"] .dm-seg i`, is => is.map(i => i.className || 'todo').join(' '));
  check((await lay.$$('#dmap .dm-year')).length === 5 && (await lay.$$('#dmap .dm-s')).length === 10, 'the map should show every year and session');
  check(await segments(1, 'Autumn') === 'todo todo todo todo' && /open/.test(await segments(1, 'Spring')), `the map should show a square per subject, open choices marked, got ${await segments(1, 'Spring')}`);
  check(!!(await lay.$('#dmap .dm-s.is-next[data-y="1"][data-s="Autumn"]')), 'the map should mark the next session');
  await lay.click(`#slot-${await lay.evaluate(() => WSLSA.context().slots.find(s => s.year === 1 && s.session === 'Autumn').id)} .tick`);
  check((await segments(1, 'Autumn')).split(' ').filter(c => c === 'on').length === 1, 'ticking should fill a square on the map');
  check(/1 of 4 subjects done/.test(await lay.getAttribute('#dmap .dm-s[data-y="1"][data-s="Autumn"]', 'aria-label')), 'the map should say how far a session has got');
  await lay.click('#year-1 .session[data-s="Autumn"] [data-action="session-done"]');
  check(!!(await lay.$('#dmap .dm-s.is-next[data-y="1"][data-s="Spring"]')) && !(await lay.$('#dmap .dm-s.is-next[data-y="1"][data-s="Autumn"]')), 'the next session on the map should move on');
  await lay.click('#dmap .dm-s[data-y="3"][data-s="Spring"]');
  const landed = await lay.evaluate(() => {
    const s = document.querySelector('#year-3 .session[data-s="Spring"]');
    const map = document.getElementById('dmap').getBoundingClientRect();
    return { focused: document.activeElement === s, top: Math.round(s.getBoundingClientRect().top), mapTop: Math.round(map.top), mapBottom: Math.round(map.bottom), dockBottom: Math.round(document.getElementById('dock-wrap').getBoundingClientRect().bottom) };
  });
  check(landed.focused && landed.top >= landed.mapBottom && landed.top < landed.mapBottom + 40 && Math.abs(landed.mapTop - landed.dockBottom) <= 2, `a session on the map should land just under the sticky dock and map, got ${JSON.stringify(landed)}`);
  await lay.waitForFunction(() => !!document.querySelector('#dmap .dm-year.is-here[data-y="3"]'));
  check(await lay.getAttribute('#dmap .dm-y[data-y="3"]', 'aria-current') === 'true' && (await lay.$$('#dmap .is-here')).length === 1, 'the map should mark the year on screen');
  await lay.evaluate(() => window.scrollTo(0, 0));
  await lay.waitForFunction(() => !document.querySelector('#dmap .is-here'));
  // a part-time plan has ten years, and they still fit
  await lay.click('[data-action="load"][data-load="PT"]');
  check(await lay.$eval('#dmap', b => b.scrollWidth <= b.clientWidth) && !!(await lay.$('#dmap .dm-many')) && (await lay.$$('#dmap .dm-year')).length === 10, 'ten years should fit on the map at laptop width');
  await lay.click('[data-action="load"][data-load="FT"]');
  // folding years
  await lay.click('#year-2 [data-action="year-toggle"]');
  check(await lay.isHidden('#year-2-body') && await lay.getAttribute('#year-2 [data-action="year-toggle"]', 'aria-expanded') === 'false' && await lay.getAttribute('#year-2 [data-action="year-toggle"]', 'aria-label') === 'Show Year 2 subjects', 'a year should fold, and say so');
  await lay.evaluate(() => WSLSA.select('2785|BASE'));
  check(await lay.isHidden('#year-2-body'), 'a folded year should stay folded across a re-render');
  await lay.click('#dmap .dm-y[data-y="2"]');
  check(await lay.isVisible('#year-2-body') && await lay.getAttribute('#year-2 [data-action="year-toggle"]', 'aria-expanded') === 'true', 'jumping from the map should open a folded year');
  await lay.click('#year-1 [data-action="year-toggle"]');
  await lay.click('#next .chipbtn');
  check(await lay.isVisible('#year-1-body'), 'jumping to a subject should open its folded year');
  await lay.evaluate(() => window.scrollTo(0, 0));
  await lay.click('#year-1 .session[data-s="Spring"] [data-action="session-done"]');
  check(!(await lay.$('#year-1.is-folded')), 'finishing a year should not fold it under the student');
  const doneCard = await lay.$eval('#year-1 .subj.is-done', c => ({ opacity: getComputedStyle(c).opacity, tick: getComputedStyle(c.querySelector('.tick-box')).backgroundColor, title: getComputedStyle(c.querySelector('.subj-title')).color }));
  check(doneCard.opacity === '1' && doneCard.tick === 'rgb(21, 128, 61)' && doneCard.title === 'rgb(98, 93, 96)', `a done card should stay readable with a coloured tick, got ${JSON.stringify(doneCard)}`);
  await lay.reload();
  await lay.evaluate(() => document.fonts.ready);
  check(!!(await lay.$('#year-1.is-folded')) && await lay.isHidden('#year-1-body') && !!(await lay.$('#dmap .dm-year.is-done[data-y="1"]')) && !(await lay.$('#year-2.is-folded')), 'a finished year should start folded the next time the plan opens');
  check((await lay.$$('#year-1 .subj')).length === 8 && /^80 \/ 400/.test((await lay.textContent('#progress-num')).trim()), 'folding should not change the plan or its progress');
  await lay.click('#dmap .dm-s[data-y="1"][data-s="Spring"]');
  check(await lay.isVisible('#year-1-body'), 'a session on the map should open its folded year');
  await lay.click('#year-1 [data-action="year-toggle"]');
  await lay.evaluate(() => window.scrollTo(0, 0));
  await lay.click('[data-action="reset"]');
  check(!(await lay.$('#grid .is-folded')) && await lay.isVisible('#year-1-body'), 'resetting a plan should open its years');
  check(lay.errors.length === 0, 'layout console errors: ' + lay.errors.join('; '));
  await lay.close();

  // real scrollbars, as on Windows: opening a window must not move the page
  const barBrowser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
  const bar = await newPage(barBrowser);
  await bar.goto(APP);
  await bar.evaluate(() => { localStorage.clear(); WSLSA.select('2785|BASE'); });
  const cardBox = () => bar.$eval('.dock-card', c => { const r = c.getBoundingClientRect(); return r.left + ':' + r.width; });
  const beforeWindow = await cardBox();
  await bar.click('[data-action="export-open"]');
  const duringWindow = await cardBox();
  await bar.keyboard.press('Escape');
  check(beforeWindow === duringWindow && beforeWindow === await cardBox(), `opening a window should not move the page, got ${beforeWindow} then ${duringWindow}`);
  check(await bar.evaluate(() => !document.getElementById('app').style.paddingRight && !document.body.style.overflow), 'closing a window should leave no scroll lock behind');
  await barBrowser.close();

  // the phone's first screens
  const ph = await newPage(browser, { viewport: { width: 390, height: 844 } });
  await ph.goto(APP);
  await ph.evaluate(() => { localStorage.clear(); WSLSA.select('2785|BASE'); });
  await ph.evaluate(() => document.fonts.ready);
  check(await pageTop(ph, '#grid .subj') < 1500, `the plan should start within two phone screens, first subject at ${await pageTop(ph, '#grid .subj')}`);
  check(await pageTop(ph, '#facts') > await pageTop(ph, '#grid') && await pageTop(ph, '#facts') < await pageTop(ph, '#details'), 'degree facts should follow the plan on a phone');
  check((await smallTargets(ph)).length === 0, 'phone controls should be at least 24 px: ' + (await smallTargets(ph)).join('; '));
  check(await ph.isHidden('[data-action="print"]') && await ph.isVisible('[data-action="top-menu"]'), 'the masthead actions should sit in a menu on a phone');
  await ph.click('[data-action="top-menu"]');
  check(await ph.isVisible('[data-action="print"]') && await ph.isVisible('.top-actions .top-link') && await ph.getAttribute('[data-action="top-menu"]', 'aria-expanded') === 'true', 'the menu should open');
  await ph.keyboard.press('Escape');
  check(await ph.isHidden('[data-action="print"]') && await ph.evaluate(() => document.activeElement.dataset.action === 'top-menu'), 'Esc should close the menu and return to its button');
  await ph.click('[data-action="top-menu"]');
  await ph.mouse.click(6, 700);
  check(await ph.isHidden('[data-action="print"]'), 'pressing elsewhere should close the menu');
  await ph.click('[data-action="top-menu"]');
  await ph.click('[data-action="export-open"]');
  check(await ph.isHidden('.top-actions .tbtn-primary') && !!(await ph.$('.modal')), 'a menu item should run and close the menu');
  await ph.keyboard.press('Escape');
  check(await ph.evaluate(() => document.activeElement.dataset.action === 'top-menu'), 'closing a window opened from the menu should return to the menu button');
  await ph.click('.enq-pill');
  check(await ph.evaluate(() => document.documentElement.scrollWidth <= 390), 'the open Law Enquiry box should not cause sideways scrolling');
  await ph.click('.enq-pill');
  check(await ph.isHidden('#dmap .dm-s[data-y="1"][data-s="Autumn"]') && await ph.isVisible('#dmap .dm-y[data-y="5"]') && await ph.evaluate(() => { const b = document.getElementById('dmap'); return b.scrollWidth <= b.clientWidth; }), 'the phone map should show each year as one tile, all in view');
  await ph.click('#dmap .dm-y[data-y="3"]');
  const phoneJump = await ph.evaluate(() => ({ map: Math.round(document.getElementById('dmap').getBoundingClientRect().top), year: Math.round(document.getElementById('year-3').getBoundingClientRect().top), bottom: Math.round(document.getElementById('dmap').getBoundingClientRect().bottom) }));
  check(phoneJump.map === 0 && phoneJump.year >= phoneJump.bottom && phoneJump.year < phoneJump.bottom + 40, `a year on the phone map should land under the map stuck to the top, got ${JSON.stringify(phoneJump)}`);
  check(ph.errors.length === 0, 'phone console errors: ' + ph.errors.join('; '));
  await ph.close();

  // ---------------------------------------------------------------- undo and redo
  const hi = await newPage(browser, { viewport: { width: 1440, height: 900 } });
  hi.on('dialog', d => d.accept());
  await hi.goto(APP);
  await hi.evaluate(() => { localStorage.clear(); WSLSA.select('2785|BASE'); });
  const hist = () => hi.evaluate(() => WSLSA.history());
  const undoBtn = '#section-tools [data-action="undo"]';
  const redoBtn = '#section-tools [data-action="redo"]';
  const codeSlot = (p, code) => p.evaluate(c => WSLSA.context().slots.find(s => s.code === c).id, code);
  const slotDone = id => hi.evaluate(i => WSLSA.context().byId[i].done, id);
  check(await hi.isDisabled(undoBtn) && await hi.isDisabled(redoBtn), 'Undo and Redo should start disabled');
  await hi.click('[data-action="load"][data-load="PT"]');
  await hi.click('[data-action="load"][data-load="FT"]');
  await hi.selectOption('#sel-campus', 'PS');
  await hi.selectOption('#sel-campus', '');
  await hi.click('[data-action="tab"][data-tab="admission"]');
  await hi.click('[data-action="tab"][data-tab="structure"]');
  await hi.selectOption('#sel-degree', '2848');
  await hi.selectOption('#sel-degree', '2785');
  await hi.click('[data-action="grid-view"][data-view="action"]');
  await hi.click('[data-action="grid-view"][data-view="all"]');
  check((await hist()).undo === 0, 'changing what is on screen should not count as a change to the plan');
  // from a tick, which is an input but not for typing
  const firstTick = await codeSlot(hi, 'LAWS 1003');
  await hi.click(`#slot-${firstTick} .tick`);
  check(await slotDone(firstTick) && await hi.isEnabled(undoBtn) && /ticked LAWS 1003/.test(await hi.getAttribute(undoBtn, 'title')), 'ticking should enable Undo and name the change');
  await hi.keyboard.press('Control+z');
  check(!(await slotDone(firstTick)) && /Undid: ticked LAWS 1003/.test(await hi.textContent('#toast')) && !!(await hi.$('#toast [data-action="redo"]')), `Ctrl+Z should undo from a tick and say what it undid, got "${await hi.textContent('#toast')}"`);
  check(await hi.evaluate(i => document.activeElement.dataset.action === 'done' && document.activeElement.dataset.slot === i, firstTick) && await hi.isDisabled(undoBtn) && await hi.isEnabled(redoBtn), 'focus should stay on the tick, with Redo now available');
  await hi.keyboard.press('Control+y');
  check(await slotDone(firstTick) && /Redid: ticked LAWS 1003/.test(await hi.textContent('#toast')), 'Ctrl+Y should redo');
  await hi.keyboard.press('Control+z');
  await hi.keyboard.press('Control+Shift+Z');
  check(await slotDone(firstTick), 'Ctrl+Shift+Z should redo');
  await hi.keyboard.press('Meta+z');
  check(!(await slotDone(firstTick)), 'Cmd+Z should undo');
  await hi.keyboard.press('Meta+Shift+Z');
  check(await slotDone(firstTick), 'Cmd+Shift+Z should redo');
  await hi.click(`#slot-${firstTick} .tick`);
  // a session in one step
  const beforeSession = (await hist()).undo;
  await hi.click('#year-1 .session[data-s="Autumn"] [data-action="session-done"]');
  check((await hist()).undo === beforeSession + 1 && /marked Year 1 Autumn done/.test((await hist()).undoLabel), 'marking a session done should be one step');
  await hi.click(undoBtn);
  check(/^0 \/ 400/.test((await hi.textContent('#progress-num')).trim()), 'Undo should unmark the whole session');
  check(await hi.evaluate(() => document.activeElement.dataset.action === 'undo' || document.activeElement.dataset.action === 'redo'), 'focus should stay on the undo controls');
  // a new change clears what could be redone
  check((await hist()).redo === 1, 'Undo should make the change redoable');
  await hi.click(`#slot-${firstTick} .tick`);
  check((await hist()).redo === 0 && await hi.isDisabled(redoBtn), 'a new change should clear Redo');
  // typing and windows keep the keys to themselves
  const typingBefore = (await hist()).undo;
  await hi.click('#grid-q');
  await hi.keyboard.type('x');
  await hi.keyboard.press('Control+z');
  check((await hist()).undo === typingBefore && await slotDone(firstTick), 'Ctrl+Z in a text box should not undo the plan');
  await hi.fill('#grid-q', '');
  await hi.keyboard.press('Escape');
  await hi.click('[data-action="export-open"]');
  await hi.keyboard.press('Control+z');
  check((await hist()).undo === typingBefore && await slotDone(firstTick), 'Ctrl+Z with a window open should not undo the plan');
  await hi.keyboard.press('Escape');
  // choosing, and a reset that takes everything with it
  const openAlt = await hi.evaluate(() => WSLSA.context().slots.find(s => s.kind === 'llb' && s.pending).id);
  await hi.click(`#slot-${openAlt} [data-action="picker-open"]`);
  await hi.click('#pick-results .pick:not([disabled])');
  const chosenAlt = await hi.evaluate(i => WSLSA.context().byId[i].code, openAlt);
  check(new RegExp('chose ' + chosenAlt).test((await hist()).undoLabel), 'choosing a subject should be named in the history');
  await hi.click('[data-action="reset"]');
  check(await hi.evaluate(i => WSLSA.context().byId[i].pending, openAlt) && !(await slotDone(firstTick)) && /reset this pathway/.test((await hist()).undoLabel), 'Reset should clear the plan and be named in the history');
  await hi.click(undoBtn);
  check(await hi.evaluate(i => WSLSA.context().byId[i].code, openAlt) === chosenAlt && await slotDone(firstTick), 'undoing Reset should bring back choices and ticks');
  // an undo shows the plan it changed
  await hi.selectOption('#sel-degree', '2848');
  await hi.click(undoBtn);
  check(await hi.evaluate(() => WSLSA.state().degree) === '2785' && await hi.evaluate(i => WSLSA.context().byId[i].pending, openAlt), 'undo should go back to the plan the change was made in');
  // thirty steps at most
  await hi.evaluate(() => { const box = document.querySelector('#grid .tick input'); for (let i = 0; i < 35; i++) box.click(); });
  check((await hist()).undo === 30, `the history should hold 30 steps, got ${(await hist()).undo}`);
  // custom plans: making one, slots, and a name typed letter by letter
  await hi.evaluate(() => { localStorage.clear(); WSLSA.select('2848|BASE'); });
  await hi.click('[data-action="custom-from-current"]');
  await hi.click('button[type=submit][form=setup-form]');
  check(await hi.evaluate(() => WSLSA.context().custom) && /started a new custom plan/.test((await hist()).undoLabel), 'making a custom plan should be in the history');
  await hi.click(undoBtn);
  check(await hi.evaluate(() => !WSLSA.context().custom && WSLSA.custom() === null), 'undoing it should go back to the pathway');
  await hi.click(redoBtn);
  check(await hi.evaluate(() => WSLSA.context().custom && WSLSA.custom().slots.length === 32), 'redoing it should bring the custom plan back');
  const slotCount = () => hi.evaluate(() => WSLSA.custom().slots.length);
  await hi.click('#year-1 .session[data-s="Autumn"] [data-action="cadd"]');
  check(await slotCount() === 33 && /added a slot to Year 1 Autumn/.test((await hist()).undoLabel), 'adding a slot should be in the history');
  await hi.click(undoBtn);
  check(await slotCount() === 32, 'undo should remove the added slot');
  const nameBefore = (await hist()).undo;
  await hi.click('#custom-name');
  await hi.keyboard.type('abc');
  check((await hist()).undo === nameBefore + 1, 'typing a plan name should count as one change');
  await hi.keyboard.press('Control+z');
  check((await hist()).undo === nameBefore + 1, 'Ctrl+Z in the name box should stay with the text');
  await hi.click(undoBtn);
  check(await hi.evaluate(() => !/abc/.test(WSLSA.custom().name)), 'Undo should restore the plan name');
  check(hi.errors.length === 0, 'undo console errors: ' + hi.errors.join('; '));
  await hi.close();

  // ---------------------------------------------------------------- assign from the catalogue
  const as = await newPage(browser, { viewport: { width: 1440, height: 900 } });
  await as.goto(APP);
  await as.evaluate(() => { localStorage.clear(); WSLSA.select('2848|BASE'); });
  await as.click('[data-action="tab"][data-tab="catalogue"]');
  const catRow = code => `#cat-results tbody tr:has(td.c-code:text-is("${code}"))`;
  check(await as.$$eval('#cat-results tbody tr', rs => rs.every(r => r.querySelector('td.c-plan .plan-badge, td.c-plan .assign-btn'))), 'every catalogue row should have a plan action');
  check(await as.textContent(catRow('LAWS 1003') + ' .plan-badge') === 'In Plan (Y1A) ↗', `a subject in the plan should say where, got "${await as.textContent(catRow('LAWS 1003') + ' .plan-badge')}"`);
  await as.$eval(catRow('LAWS 1003'), r => r.scrollIntoView({ block: 'center' }));
  await as.click(catRow('LAWS 1003') + ' .plan-badge');
  const inPlanSlot = await codeSlot(as, 'LAWS 1003');
  check(await as.$eval(`#slot-${inPlanSlot}`, e => { const r = e.getBoundingClientRect(); return e.classList.contains('flash') && r.top >= 0 && r.bottom <= innerHeight; }), 'the badge should scroll to and flash the card');
  check(/is in Year 1 Autumn/.test(await as.textContent('#toast')), 'the toast should say where it is');
  await as.click('#toast [data-action="cat-back"]');
  check(await as.evaluate(() => document.activeElement.classList.contains('plan-badge') && document.activeElement.dataset.code === 'LAWS 1003'), 'Back to catalogue should return to the row');
  // an alternate that runs in only one of the two sessions, with open slots in both
  const alt = await as.evaluate(() => {
    const c = WSLSA.context();
    const has = s => c.slots.some(x => x.kind === 'llb' && x.pending && x.session === s);
    const none = v => !v || v === '—';
    const e = c.deg.byComp[c.deg.llbComponent].find(x => !c.used[x.code] && !none(x.autumn) && x.autumn !== 'TBC' && none(x.spring)) || null;
    return { code: e && e.code, both: has('Autumn') && has('Spring') };
  });
  check(!!alt.code && alt.both, 'the check needs an alternate offered in Autumn only');
  await as.$eval(catRow(alt.code), r => r.scrollIntoView({ block: 'center' }));
  const tableTop = await as.$eval('#cat-results .table-scroll', t => t.scrollTop);
  await as.click(catRow(alt.code) + ' .assign-btn');
  const assignRows = await as.$$eval('.modal .assign-slot', rs => rs.map(r => ({ id: r.dataset.slot, flag: r.querySelector('.flag').textContent, ok: r.querySelector('.flag').classList.contains('flag-done') })));
  const openLlb = await as.evaluate(() => { const seen = {}; let all = 0; WSLSA.context().slots.forEach(s => { if (s.pending && (s.kind === 'llb' || s.kind === 'elective')) { seen[s.year + s.session + s.title] = 1; all++; } }); return { rows: Object.keys(seen).length, all }; });
  check(assignRows.length === openLlb.rows && await as.$eval('.modal .pick-section h3 span:last-child', c => +c.textContent) === openLlb.all && /\d open/.test(await as.textContent('.modal .pick-list')), `the window should list every open slot that can take it, identical ones as one row, got ${assignRows.length} rows for ${JSON.stringify(openLlb)}`);
  check(assignRows.some(r => r.ok && /^Offered in Autumn: /.test(r.flag)) && assignRows.some(r => !r.ok && r.flag === 'Not offered in Spring'), `each slot should say whether its session runs the subject, got ${JSON.stringify(assignRows.slice(0, 4))}`);
  const firstBad = assignRows.findIndex(r => !r.ok);
  check(firstBad > 0 && assignRows.slice(firstBad).every(r => !r.ok), 'slots in a session it runs in should come first');
  check((await headingSkips(as, '#modal-root')).length === 0, 'the window headings should not skip a level');
  await as.click(`.modal .assign-slot[data-slot="${assignRows[0].id}"]`);
  check(await as.evaluate(i => WSLSA.context().byId[i].code, assignRows[0].id) === alt.code && !(await as.$('.modal')), 'choosing a slot should put the subject there and close the window');
  check(/^In Plan \(Y\d[AS]u?\) ↗$/.test(await as.textContent(catRow(alt.code) + ' .plan-badge')) && await as.evaluate(c => document.activeElement.dataset && document.activeElement.dataset.code === c, alt.code), 'the row should change to In Plan, with focus still on it');
  check(await as.$eval('#cat-results .table-scroll', t => t.scrollTop) === tableTop, 'assigning should leave the catalogue list where it was');
  check(/assigned to Year/.test(await as.textContent('#toast')) && !!(await as.$('#toast [data-action="undo"]')), 'the toast should confirm and offer Undo');
  await as.click('#toast [data-action="undo"]');
  check(await as.evaluate(i => WSLSA.context().byId[i].pending, assignRows[0].id) && !!(await as.$(catRow(alt.code) + ' .assign-btn')), 'Undo should take the subject back out');
  // a subject from the WSU list can only fill an elective
  await as.selectOption('#cat-comp', '__extra__');
  const extraCode = await as.textContent('#cat-results tr.extra td.c-code');
  await as.click('#cat-results tr.extra .assign-btn');
  const extraRows = await as.$$eval('.modal .assign-slot', rs => rs.map(r => r.dataset.slot));
  check(extraRows.length > 0 && await as.evaluate(ids => ids.every(i => WSLSA.context().byId[i].kind === 'elective'), extraRows), 'a WSU list subject should be offered only the elective slots');
  check(/No session data/.test(await as.textContent('.modal .assign-slot .flag')), 'a subject with no session data should say so');
  await as.click(`.modal .assign-slot[data-slot="${extraRows[0]}"]`);
  check(await as.evaluate(i => WSLSA.context().byId[i].listSubject, extraRows[0]) && await as.evaluate(i => WSLSA.context().byId[i].code, extraRows[0]) === extraCode, 'it should go in as a WSU list subject');
  await as.selectOption('#cat-comp', '');
  // a pathway with nowhere to put it says so, and offers a way forward
  const noElective = await as.evaluate(keys => keys.find(k => { WSLSA.select(k); return !WSLSA.context().slots.some(s => s.kind === 'elective'); }), await as.evaluate(() => WSLSA.keys()));
  await as.evaluate(k => WSLSA.select(k), noElective);
  await as.selectOption('#cat-comp', '__extra__');
  await as.click('#cat-results tr.extra .assign-btn');
  check(!(await as.$('.modal .assign-slot')) && /No open slot/.test(await as.textContent('.modal .pick-empty')) && !!(await as.$('.modal [data-action="custom-from-current"]')), 'a pathway with no slot for it should say so and offer its own copy');
  await as.keyboard.press('Escape');
  await as.selectOption('#cat-comp', '');
  // a custom plan takes anything, says which slots list it, and can make room
  await as.evaluate(() => { WSLSA.select('2848|BASE'); });
  await as.click('[data-action="custom-from-current"]');
  await as.click('button[type=submit][form=setup-form]');
  await as.click('[data-action="tab"][data-tab="catalogue"]');
  const customAlt = await as.evaluate(() => { const c = WSLSA.context(); return c.tdeg.byComp[c.tdeg.llbComponent].find(x => !c.used[x.code]).code; });
  await as.click(catRow(customAlt) + ' .assign-btn');
  const heads = await as.$$eval('.modal .pick-section h3', h => h.map(x => x.textContent));
  check(/Open slots that list this subject/.test(heads[0]) && heads.some(h => /Or make room for it/.test(h)), `a custom plan should separate the slots, got ${JSON.stringify(heads)}`);
  const customSlots = await as.evaluate(() => WSLSA.custom().slots.length);
  await as.click('.modal [data-action="assign-new"]');
  check(await as.evaluate(() => WSLSA.custom().slots.length) === customSlots + 1 && await as.evaluate(c => WSLSA.custom().slots[WSLSA.custom().slots.length - 1].code === c, customAlt), 'making room should add a slot with the subject in it');
  check((await smallTargets(as)).length === 0, 'catalogue actions should be at least 24 px: ' + (await smallTargets(as)).join('; '));
  check(as.errors.length === 0, 'assign console errors: ' + as.errors.join('; '));
  await as.close();

  // ---------------------------------------------------------------- drag to swap and reorder
  const sw = await newPage(browser, { viewport: { width: 1440, height: 1500 } });
  await sw.goto(APP);
  await sw.evaluate(() => { localStorage.clear(); WSLSA.select('2785|BASE'); });
  await sw.click('[data-action="custom-from-current"]');
  await sw.click('button[type=submit][form=setup-form]');
  await sw.evaluate(() => { const t = document.getElementById('year-1').getBoundingClientRect().top + scrollY; window.scrollTo(0, t - 150); });
  const dragOver = async (fromSel, toSel, part) => {
    const f = await (await sw.$(fromSel)).boundingBox();
    await sw.mouse.move(f.x + 10, f.y + 5);
    await sw.mouse.down();
    await sw.mouse.move(f.x + 40, f.y + 30, { steps: 4 });
    await sw.waitForTimeout(120);
    const box = await (await sw.$(toSel)).boundingBox();
    const y = box.y + box.height * (part == null ? 0.5 : part);
    await sw.mouse.move(box.x + box.width / 2, y, { steps: 6 });
    await sw.mouse.move(box.x + box.width / 2 + 2, y + 1);
    await sw.waitForTimeout(80);
  };
  const y1 = await sw.evaluate(() => {
    const c = WSLSA.context();
    const off = v => v && v !== '—' && v !== 'TBC';
    const both = x => { const e = c.deg.byCode[x.code]; return !x.pending && e && off(e.autumn) && off(e.spring); };
    const a = c.slots.filter(s => s.year === 1 && s.session === 'Autumn');
    const b = c.slots.filter(s => s.year === 1 && s.session === 'Spring');
    return { a: a.filter(both)[0], b: b.filter(both)[0], warn: b.find(x => { const e = c.deg.byCode[x.code]; return !x.pending && e && !off(e.autumn); }), list: a.map(s => s.id) };
  });
  check(!!y1.a && !!y1.b && !!y1.warn, 'the check needs subjects that run in both sessions, and one that does not');
  const placeOf = code => sw.evaluate(c => { const x = WSLSA.custom().slots.find(s => s.code === c); return x.y + x.s; }, code);
  const sessionCP = (y, s) => sw.evaluate(([yy, ss]) => WSLSA.custom().slots.filter(x => x.y === yy && x.s === ss).reduce((n, x) => n + x.cp, 0), [y, s]);
  // both offered in each other's sessions
  await dragOver(`#slot-${y1.a.id} .subj-title`, `#slot-${y1.b.id} .subj-title`);
  const okBadge = await sw.$eval(`#slot-${y1.b.id}`, c => ({ cls: c.className, text: (c.querySelector('.swap-badge') || {}).textContent, over: !!document.querySelector('.drop-over') }));
  check(/swap-ok/.test(okBadge.cls) && okBadge.text === `Swap with ${y1.b.code}: keeps both sessions at 40 CP` && !okBadge.over, `a swap both ways should say so, got ${JSON.stringify(okBadge)}`);
  await sw.mouse.up();
  check(await placeOf(y1.a.code) === '1Spring' && await placeOf(y1.b.code) === '1Autumn', 'dropping on a card should swap the two sessions');
  check(await sessionCP(1, 'Autumn') === 40 && await sessionCP(1, 'Spring') === 40, 'a swap should keep both sessions at 40 CP');
  check(/Swapped/.test(await sw.textContent('#toast')) && !(await sw.$('.swap-badge, .swap-ok, .swap-warn, .has-swap, .drop-ok, .drop-warn')), 'the toast should confirm and the highlights should clear');
  check(await sw.evaluate(() => /swapped/.test(WSLSA.history().undoLabel)), 'a swap should be one step in the history');
  await sw.click('#toast [data-action="undo"]');
  check(await placeOf(y1.a.code) === '1Autumn' && await placeOf(y1.b.code) === '1Spring', 'Undo should swap them back');
  // one of them is not offered there
  const warnFrom = await sw.evaluate(() => WSLSA.context().slots.find(s => s.year === 1 && s.session === 'Autumn' && !s.pending).id);
  await dragOver(`#slot-${warnFrom} .subj-title`, `#slot-${y1.warn.id} .subj-title`);
  const warnBadge = await sw.$eval(`#slot-${y1.warn.id}`, c => ({ cls: c.className, text: (c.querySelector('.swap-badge') || {}).textContent }));
  check(/swap-warn/.test(warnBadge.cls) && warnBadge.text === `Swap with ${y1.warn.code}: ${y1.warn.code} is not offered in Autumn`, `an offering problem should warn, got ${JSON.stringify(warnBadge)}`);
  // leaving the card goes back to a plain move
  const head = await (await sw.$('#year-1 .session[data-s="Spring"] .session-head')).boundingBox();
  await sw.mouse.move(head.x + 30, head.y + 8, { steps: 4 });
  await sw.mouse.move(head.x + 34, head.y + 9);
  await sw.waitForTimeout(80);
  check(!(await sw.$('.swap-badge')) && !!(await sw.$('#year-1 .session[data-s="Spring"].drop-over')), 'over the session itself it should be a plain move');
  await sw.keyboard.press('Escape');
  await sw.mouse.up();
  await sw.evaluate(() => { const u = WSLSA.history(); return u; });
  if (await sw.evaluate(() => /moved/.test(WSLSA.history().undoLabel))) await sw.click('#section-tools [data-action="undo"]');
  // within a session
  const order = () => sw.evaluate(() => { const c = WSLSA.context(); return c.slots.filter(s => s.year === 1 && s.session === 'Autumn').map(s => s.code); });
  const startOrder = await order();
  const orderIds = await sw.evaluate(() => WSLSA.context().slots.filter(s => s.year === 1 && s.session === 'Autumn').map(s => s.id));
  await dragOver(`#slot-${orderIds[0]} .subj-title`, `#slot-${orderIds[2]}`, 0.8);
  check(!!(await sw.$(`#slot-${orderIds[2]}.reorder-after`)) && !(await sw.$('.swap-badge')), 'over a card in its own session it should show where it would land');
  await sw.mouse.up();
  const newOrder = await order();
  check(JSON.stringify(newOrder) === JSON.stringify([startOrder[1], startOrder[2], startOrder[0], startOrder[3]]), `dropping should reorder the session, got ${newOrder.join(', ')}`);
  check(await sw.$$eval('#year-1 .session[data-s="Autumn"] .subj .code-pill', p => p.map(x => x.textContent)).then(t => JSON.stringify(t) === JSON.stringify(newOrder)), 'the page should show the new order');
  check(!(await sw.$('.reorder-after, .reorder-before')), 'the marker should clear');
  await sw.click('#toast [data-action="undo"]');
  check(JSON.stringify(await order()) === JSON.stringify(startOrder), 'Undo should restore the order');
  await dragOver(`#slot-${orderIds[3]} .subj-title`, `#slot-${orderIds[0]}`, 0.2);
  check(!!(await sw.$(`#slot-${orderIds[0]}.reorder-before`)), 'the top half of a card should mean before it');
  await sw.mouse.up();
  check((await order())[0] === startOrder[3], 'dropping before the first card should put it first');
  // without dragging, as a keyboard or a phone must
  await sw.click(`#slot-${await codeSlot(sw, startOrder[1])} [data-action="picker-open"]`);
  check(await sw.isDisabled('[data-action="creorder"][data-dir="-1"]') === false, 'Change or move should offer the order');
  await sw.click('[data-action="creorder"][data-dir="-1"]');
  check((await order()).indexOf(startOrder[1]) < newOrder.length && !(await sw.$('.modal')), 'the order buttons should work without dragging');
  const swapPair = await sw.evaluate(() => { const c = WSLSA.context(); return { a: c.slots.find(s => s.year === 2 && s.session === 'Autumn' && !s.pending), b: c.slots.find(s => s.year === 2 && s.session === 'Spring' && !s.pending) }; });
  await sw.click(`#slot-${swapPair.a.id} [data-action="picker-open"]`);
  await sw.selectOption('#cp-swap', swapPair.b.id);
  check(await placeOf(swapPair.a.code) === '2Spring' && await placeOf(swapPair.b.code) === '2Autumn' && !(await sw.$('.modal')), 'Swap with should work without dragging');
  // order and swaps survive a share link
  const planAll = p => p.evaluate(() => WSLSA.custom().slots.map(x => x.y + x.s + x.code + (x.done ? '+' : '')));
  const swapLink = await sw.evaluate(() => WSLSA.planUrl());
  const swOpen = await newPage(browser);
  await swOpen.goto(swapLink);
  check(JSON.stringify(await planAll(swOpen)) === JSON.stringify(await planAll(sw)), 'a share link should keep the order and swaps');
  await swOpen.close();
  check(sw.errors.length === 0, 'swap console errors: ' + sw.errors.join('; '));
  await sw.close();

  // ---------------------------------------------------------------- grid view and quick filter
  const fi = await newPage(browser, { viewport: { width: 1440, height: 900 } });
  await fi.goto(APP);
  await fi.evaluate(() => { localStorage.clear(); WSLSA.select('2785|BASE'); });
  await fi.evaluate(() => document.fonts.ready);
  const pressed = () => fi.$eval('.view-modes [aria-pressed="true"]', b => b.dataset.view);
  const shownCards = () => fi.$$eval('#grid .subj', cs => cs.filter(c => c.getClientRects().length).map(c => c.dataset.slot));
  check(await pageTop(fi, '#gridbar') < await pageTop(fi, '#dmap') && await pressed() === 'all', 'the bar should sit above the map, on All');
  check(await pageTop(fi, '#grid .subj') < 1000, `the bar should not push the plan down, first subject at ${await pageTop(fi, '#grid .subj')}`);
  check(await fi.textContent('#gv-remaining') === '40' && +await fi.textContent('#gv-action') > 0, 'the views should show their counts');
  for (const [y, s] of [[1, 'Autumn'], [1, 'Spring'], [2, 'Autumn']]) await fi.click(`#year-${y} .session[data-s="${s}"] [data-action="session-done"]`);
  check(await fi.textContent('#gv-remaining') === '28', 'ticking should update the count');
  check(!(await fi.$('#year-1.is-folded')), 'on All, ticking should fold nothing');
  // remaining only
  await fi.click('[data-action="grid-view"][data-view="remaining"]');
  check(await pressed() === 'remaining' && !!(await fi.$('#year-1.is-folded')) && await fi.isHidden('#year-1-body'), 'Remaining only should fold a finished year');
  const remainingCards = await shownCards();
  check(remainingCards.length === 28 && await fi.evaluate(ids => ids.every(i => !WSLSA.context().byId[i].done), remainingCards), `Remaining only should hide finished subjects, got ${remainingCards.length}`);
  check(/Everything in this session is done/.test(await fi.textContent('#year-2 .session[data-s="Autumn"] .session-clear')) && await fi.isVisible('#year-2 .session[data-s="Autumn"] .session-clear') && await fi.isVisible('#year-2 .session[data-s="Spring"] .subj'), 'a finished session should say so beside the one still to do');
  await fi.click('#year-1 [data-action="year-toggle"]');
  check(await fi.isVisible('#year-1-body') && await fi.isVisible('#year-1 .subj.is-done'), 'opening a finished year should show its subjects');
  await fi.click('#year-1 [data-action="year-toggle"]');
  check(await fi.isHidden('#year-1-body'), 'it should close again');
  // ticking in this view leaves the card, and the year, where they are until the page next changes
  const tickNow = await fi.evaluate(() => WSLSA.context().slots.find(s => s.year === 2 && s.session === 'Spring').id);
  await fi.click(`#slot-${tickNow} .tick`);
  check(await fi.isVisible(`#slot-${tickNow}`) && await fi.textContent('#gv-remaining') === '27', 'a card just ticked should stay in view');
  await fi.click('#year-2 .session[data-s="Spring"] [data-action="session-done"]');
  check(!(await fi.$('#year-2.is-folded')) && await fi.isVisible(`#slot-${tickNow}`), 'finishing a year should not fold it under the student');
  await fi.evaluate(() => WSLSA.select('2785|BASE'));
  check(await fi.isHidden(`#slot-${tickNow}`) && !!(await fi.$('#year-2.is-folded')), 'the next change to the page should tidy them away');
  await fi.reload();
  await fi.evaluate(() => document.fonts.ready);
  check(await pressed() === 'remaining' && !!(await fi.$('#grid.view-remaining')), 'the view should survive a reload');
  // what a view opened in one plan does not carry over to another
  await fi.click('#year-1 [data-action="year-toggle"]');
  check(await fi.isVisible('#year-1-body'), 'a finished year should open in this view');
  await fi.selectOption('#sel-degree', '2848');
  await fi.selectOption('#sel-degree', '2785');
  check(await fi.isHidden('#year-1-body'), 'going to another plan and back should forget what the view had opened');
  // a jump to something this view hides goes back to everything
  await fi.click('[data-action="tab"][data-tab="catalogue"]');
  const doneInCat = 'LAWS 1003';
  await fi.$eval(`#cat-results tbody tr:has(td.c-code:text-is("${doneInCat}"))`, r => r.scrollIntoView({ block: 'center' }));
  await fi.click(`#cat-results tbody tr:has(td.c-code:text-is("${doneInCat}")) .plan-badge`);
  const doneSlot = await codeSlot(fi, doneInCat);
  check(await pressed() === 'all' && await fi.isVisible(`#slot-${doneSlot}`), 'jumping to a hidden card should show everything');
  await fi.click('[data-action="tab"][data-tab="structure"]');
  // action needed
  await fi.click('[data-action="grid-view"][data-view="action"]');
  const actionCards = await shownCards();
  const actionNow = +await fi.textContent('#gv-action');
  check(actionCards.length === actionNow && actionNow > 0 && await fi.$$eval('#grid .subj', cs => cs.filter(c => c.getClientRects().length).every(c => c.classList.contains('is-action'))), `Action needed should show exactly the flagged cards, got ${actionCards.length} of ${actionNow}`);
  check((await fi.$$('#dmap .dm-seg i.hit')).length === actionNow && !!(await fi.$('#dmap .dm-s.has-hit')), 'the map should mark where they are');
  check(await fi.evaluate(ids => { const c = WSLSA.context(); return ids.every(i => { const s = c.byId[i]; return !s.done && (s.pending || c.risks.tbc.indexOf(s) >= 0 || c.risks.advisor.some(a => a.flagSlot && a.flagSlot.id === i)); }); }, actionCards), 'they should be open choices, unpublished sessions or prerequisite notes');
  await fi.selectOption('#sel-campus', 'PS');
  check(+await fi.textContent('#gv-action') > actionNow, 'a campus adds its mismatches to Action needed');
  await fi.selectOption('#sel-campus', '');
  check(await fi.isHidden('#year-1'), 'a year with nothing to do should leave the view');
  await fi.click('#dmap .dm-s[data-y="1"][data-s="Autumn"]');
  check(await pressed() === 'all' && await fi.isVisible('#year-1 .session[data-s="Autumn"]'), 'pressing a hidden year on the map should show everything');
  // nothing left
  await fi.evaluate(() => document.querySelectorAll('#grid [data-action="session-done"]').forEach(b => { if (b.textContent !== 'Unmark all') b.click(); }));
  await fi.click('[data-action="grid-view"][data-view="action"]');
  check(await fi.isVisible('#grid-empty') && /Nothing in this plan needs action/.test(await fi.textContent('#grid-empty')), 'an empty view should say so');
  await fi.click('#grid-empty [data-action="grid-view"]');
  check(await pressed() === 'all' && await fi.isHidden('#grid-empty'), 'it should offer the way back');
  await fi.evaluate(() => { localStorage.clear(); });
  await fi.click('[data-action="reset"]').catch(() => {});
  // the quick filter
  const fi2 = await newPage(browser, { viewport: { width: 1440, height: 900 } });
  await fi2.goto(APP);
  await fi2.evaluate(() => { localStorage.clear(); WSLSA.select('2785|BASE'); });
  await fi2.evaluate(() => document.fonts.ready);
  await fi2.evaluate(() => document.activeElement.blur());
  await fi2.keyboard.press('/');
  check(await fi2.evaluate(() => document.activeElement.id === 'grid-q') && await fi2.getAttribute('#grid-q', 'placeholder') === 'Press / to filter grid', '/ should go to the filter');
  await fi2.keyboard.type('torts');
  const tortsSlot = await codeSlot(fi2, 'LAWS 2013');
  check(!!(await fi2.$(`#slot-${tortsSlot}.is-match`)) && (await fi2.$$('#grid .subj.is-match')).length === 1 && /Torts/i.test(await fi2.textContent(`#slot-${tortsSlot} .subj-title mark`)), 'typing should highlight the matching card and words');
  check(await fi2.$eval('#grid .subj:not(.is-match)', c => getComputedStyle(c).opacity) === '0.38', 'other cards should step back');
  check((await fi2.$$('#dmap .dm-seg i.hit')).length === 1 && !!(await fi2.$('#dmap .dm-s.has-hit[data-y="1"][data-s="Spring"]')) && !!(await fi2.$('#dmap .dm-y.has-hit[data-y="1"]')), 'the map should mark its year and session');
  check(/^1 match/.test(await fi2.textContent('#grid-status')), 'the count should say how many');
  await fi2.fill('#grid-q', 'laws1003');
  check(await fi2.textContent(`#slot-${await codeSlot(fi2, 'LAWS 1003')} .code-pill mark`) === 'LAWS 1003', 'a code should match without its space');
  await fi2.fill('#grid-q', 'zzzz');
  check(/No match/.test(await fi2.textContent('#grid-status')) && !(await fi2.$('#grid.is-filtering')), 'no match should leave the cards alone and say so');
  await fi2.fill('#grid-q', 'financial');
  const hits = await fi2.$$eval('#grid .subj.is-match', c => c.map(x => x.dataset.slot));
  check(hits.length > 1, 'the check needs more than one match');
  await fi2.keyboard.press('Enter');
  check(await fi2.$eval(`#slot-${hits[0]}`, c => c.classList.contains('flash')) && /^1 of /.test(await fi2.textContent('#grid-status')) && await fi2.evaluate(() => document.activeElement.id === 'grid-q'), 'Enter should go to the first match and keep typing focus');
  await fi2.keyboard.press('Enter');
  check(await fi2.$eval(`#slot-${hits[1]}`, c => c.classList.contains('flash')), 'Enter again should go to the next');
  await fi2.keyboard.press('Shift+Enter');
  check(/^1 of /.test(await fi2.textContent('#grid-status')), 'Shift+Enter should go back');
  // it stays on screen while in use, without moving the page
  const stack = () => fi2.evaluate(() => { const r = id => document.getElementById(id).getBoundingClientRect(); return { dock: Math.round(r('dock-wrap').bottom), barTop: Math.round(r('gridbar').top), barBottom: Math.round(r('gridbar').bottom), mapTop: Math.round(r('dmap').top), y: Math.round(scrollY) }; });
  await fi2.evaluate(() => window.scrollTo(0, document.getElementById('year-4').getBoundingClientRect().top + scrollY));
  await fi2.waitForTimeout(100);
  const deep = await stack();
  check(Math.abs(deep.barTop - deep.dock) <= 2 && Math.abs(deep.mapTop - deep.barBottom) <= 2, `the bar should stick under the dock and the map under it, got ${JSON.stringify(deep)}`);
  await fi2.keyboard.press('Escape');
  check(await fi2.inputValue('#grid-q') === '' && !(await fi2.$('#grid .subj.is-match')) && !(await fi2.$('#grid.is-filtering')) && !(await fi2.$('#dmap i.hit')) && !(await fi2.$('.subj-title mark')), 'Esc should clear the filter and every mark');
  await fi2.keyboard.press('Escape');
  check(await fi2.evaluate(() => document.activeElement.id !== 'grid-q') && !(await fi2.$('#gridbar.is-searching')), 'Esc again should leave the box, and the bar should stop sticking');
  const beforeKey = await fi2.evaluate(() => Math.round(scrollY));
  await fi2.keyboard.press('Control+k');
  const keyStack = await stack();
  check(await fi2.evaluate(() => document.activeElement.id === 'grid-q') && keyStack.y === beforeKey && Math.abs(keyStack.barTop - keyStack.dock) <= 2 && Math.abs(keyStack.mapTop - keyStack.barBottom) <= 2, `Ctrl+K deep in the plan should bring the filter to the screen without moving the page, got ${JSON.stringify(keyStack)} from ${beforeKey}`);
  await fi2.keyboard.press('Escape');
  check(await fi2.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bar-h').trim()) === '0px', 'the map should go back up once the filter is out of use');
  // a match in a folded year shows on its bar, and Enter opens it
  await fi2.click('#year-3 [data-action="year-toggle"]');
  const inY3 = await fi2.evaluate(() => { const c = WSLSA.context(); return c.slots.find(s => s.year === 3 && !s.pending && c.slots.filter(x => x.title === s.title).length === 1); });
  await fi2.fill('#grid-q', inY3.code);
  check(!!(await fi2.$('#year-3.has-match.is-folded')) && await fi2.isHidden('#year-3-body'), 'typing should not open a folded year, but its bar should show the match');
  await fi2.focus('#grid-q');
  await fi2.keyboard.press('Enter');
  check(await fi2.isVisible(`#slot-${inY3.id}`), 'Enter should open the folded year');
  await fi2.fill('#grid-q', '');
  // a filter that still has text stays on screen after leaving the box
  await fi2.fill('#grid-q', 'torts');
  await fi2.evaluate(() => document.activeElement.blur());
  check(!!(await fi2.$('#gridbar.is-searching')), 'a filter with text should stay on screen');
  check((await smallTargets(fi2)).length === 0, 'filter controls should be at least 24 px: ' + (await smallTargets(fi2)).join('; '));
  await fi2.fill('#grid-q', '');
  // the PDF is not affected by what is on screen
  const pdfBefore = await fi2.evaluate(() => WSLSA.buildPrintDoc({ mode: 'A' }).replace(/pd-plan">[^<]*</, ''));
  await fi2.click('[data-action="grid-view"][data-view="action"]');
  await fi2.fill('#grid-q', 'torts');
  check(await fi2.evaluate(() => WSLSA.buildPrintDoc({ mode: 'A' }).replace(/pd-plan">[^<]*</, '')) === pdfBefore, 'the PDF should ignore the view and the filter');
  check(fi.errors.length === 0 && fi2.errors.length === 0, 'filter console errors: ' + fi.errors.concat(fi2.errors).join('; '));
  await fi.close();
  await fi2.close();

  // on a phone: only the search row stays, the map under it, and undo is in the bar at the bottom
  const pf = await newPage(browser, { viewport: { width: 390, height: 844 } });
  await pf.goto(APP);
  await pf.evaluate(() => { localStorage.clear(); WSLSA.select('2785|BASE'); });
  await pf.evaluate(() => document.fonts.ready);
  check(await pf.evaluate(() => document.documentElement.scrollWidth <= 390), 'the bar should not cause sideways scrolling on a phone');
  check((await smallTargets(pf)).length === 0, 'phone filter controls should be at least 24 px: ' + (await smallTargets(pf)).join('; '));
  check(await pageTop(pf, '#grid .subj') < 1500, `the bar should not push the plan down on a phone, first subject at ${await pageTop(pf, '#grid .subj')}`);
  await pf.fill('#grid-q', 'torts');
  await pf.evaluate(() => window.scrollTo(0, document.getElementById('year-2').getBoundingClientRect().top + scrollY));
  await pf.waitForTimeout(120);
  const phoneStack = await pf.evaluate(() => { const r = s => document.querySelector(s).getBoundingClientRect(); return { input: Math.round(r('#grid-q').top), buttons: Math.round(r('.view-modes').bottom), bar: Math.round(r('#gridbar').bottom), map: Math.round(r('#dmap').top) }; });
  check(phoneStack.input >= 0 && phoneStack.input < 20 && phoneStack.buttons <= 2 && Math.abs(phoneStack.map - phoneStack.bar) <= 2, `on a phone the search row should stick to the top with the map under it, got ${JSON.stringify(phoneStack)}`);
  await pf.fill('#grid-q', '');
  await pf.evaluate(() => document.activeElement.blur());
  await pf.evaluate(() => window.scrollTo(0, document.getElementById('year-2').getBoundingClientRect().top + scrollY));
  await pf.waitForTimeout(150);
  check(await pf.isDisabled('#mini-bar [data-action="undo"]'), 'the phone bar undo should start disabled');
  await pf.click('#grid .subj:not(.is-pending) .tick');
  check(await pf.isEnabled('#mini-bar [data-action="undo"]') && await pf.evaluate(() => WSLSA.context().doneCP) === 10, 'ticking should enable the phone bar undo');
  await pf.click('#mini-bar [data-action="undo"]');
  check(await pf.evaluate(() => WSLSA.context().doneCP) === 0 && await pf.isDisabled('#mini-bar [data-action="undo"]'), 'the phone bar undo should work');
  check(pf.errors.length === 0, 'phone filter console errors: ' + pf.errors.join('; '));
  await pf.close();

  // ---------------------------------------------------------------- dark mode
  const dk = await newPage(browser, { viewport: { width: 1440, height: 900 } });
  await dk.goto(APP);
  await dk.evaluate(() => { WSLSA.select('2785|BASE'); });
  const themeNow = () => dk.evaluate(() => document.documentElement.dataset.theme);
  const paint = (s, prop) => dk.$eval(s, (e, p) => getComputedStyle(e)[p], prop || 'backgroundColor');
  const themeBtn = '[data-action="theme-toggle"]';
  check(await themeNow() === 'light' && await dk.getAttribute(themeBtn, 'aria-pressed') === 'false' && /Dark mode/.test(await dk.textContent(themeBtn)), 'the site should start light, with a Dark mode button');
  check(await paint('.year-bar') === 'rgb(30, 29, 32)' && await paint('body') === 'rgb(246, 241, 234)', 'light mode should look as it did');
  const paperLight = await dk.evaluate(() => WSLSA.buildPrintDoc({ mode: 'A' }).replace(/pd-plan">[^<]*</, ''));
  await dk.click(themeBtn);
  check(await themeNow() === 'dark' && await dk.getAttribute(themeBtn, 'aria-pressed') === 'true' && /Light mode/.test(await dk.textContent(themeBtn)), 'pressing it should switch to dark and offer light');
  check(await dk.evaluate(() => localStorage.getItem('wslsa-2027-theme')) === 'dark', 'the choice should be saved');
  check(await paint('body') === 'rgb(17, 17, 20)' && await paint('.topbar') === 'rgb(26, 25, 30)' && await paint('.dock-card') === 'rgb(26, 25, 30)' && await paint('.year') === 'rgb(26, 25, 30)' && await paint('.drawer') === 'rgb(26, 25, 30)', 'every surface should go dark');
  for (const s of ['.year-bar', '.advisory > summary', '.segmented button[aria-pressed="true"]']) {
    check(await paint(s) === 'rgb(40, 38, 48)' && await paint(s, 'color') === 'rgb(255, 255, 255)', `${s} should stay a dark band with white text`);
  }
  check(await paint('.site-footer') === 'rgb(40, 38, 48)' && await paint('.site-footer', 'color') === 'rgb(203, 197, 188)', 'the footer should stay a dark band with its light text');
  check(await paint('.subj-title', 'color') === 'rgb(244, 239, 230)', 'text should flip to light');
  check(await paint('.tbtn-primary') === 'rgb(139, 0, 41)' && await paint('.tbtn-primary', 'color') === 'rgb(255, 255, 255)', 'filled buttons should keep burgundy and white');
  check(await dk.evaluate(() => getComputedStyle(document.documentElement).colorScheme) === 'dark', 'native controls should go dark');
  check(await dk.$eval('.brand-crest', e => /url/.test(getComputedStyle(e).webkitMaskImage || getComputedStyle(e).maskImage)) && await paint('.brand-crest') === 'rgb(227, 199, 116)', 'the masthead crest should use the gold mask');
  // done cards and the catalogue
  await dk.click('#year-1 .session[data-s="Autumn"] [data-action="session-done"]');
  check(await paint('#year-1 .subj.is-done') === 'rgb(22, 21, 26)', 'a done card should use the dark done colour');
  await dk.click('[data-action="tab"][data-tab="catalogue"]');
  check(await paint('#cat-results table.cat th') === 'rgb(40, 38, 48)', 'the catalogue heading should stay a dark band');
  check(await dk.$eval('#cat-results tr.in-plan td.c-plan', c => !/rgba/.test(getComputedStyle(c).backgroundColor)), 'the sticky column should hide what scrolls under it');
  await dk.click('[data-action="tab"][data-tab="structure"]');
  // the paper stays paper
  check(await dk.evaluate(() => WSLSA.buildPrintDoc({ mode: 'A' }).replace(/pd-plan">[^<]*</, '')) !== '', 'the document should build in dark');
  await dk.click('[data-action="export-open"]');
  await dk.waitForTimeout(120);
  check(await paint('#preview-stage .pdoc') === 'rgb(255, 255, 255)' && await paint('#preview-stage .pdoc', 'color') === 'rgb(42, 40, 43)' && await paint('#preview-stage .pdoc', 'colorScheme') === 'light', 'the A4 preview should stay white paper in dark mode');
  check(await paint('#export-preview') === 'rgb(18, 17, 21)', 'the desk behind the paper should go dark');
  await dk.keyboard.press('Escape');
  await dk.evaluate(() => WSLSA.preparePrint({ mode: 'A', orient: 'portrait' }));
  await dk.emulateMedia({ media: 'print' });
  check(await paint('html') === 'rgb(255, 255, 255)' && await paint('body') === 'rgb(255, 255, 255)' && await paint('#print-root .pdoc') === 'rgb(255, 255, 255)' && await dk.isHidden('#app'), 'printing from dark mode should give a white page');
  await dk.emulateMedia({ media: 'screen' });
  // it survives a reload, and is set before anything is drawn
  await dk.reload();
  check(await themeNow() === 'dark' && await dk.getAttribute(themeBtn, 'aria-pressed') === 'true', 'dark should survive a reload');
  const shell = fs.readFileSync(path.join(ROOT, 'dist', 'wslsa-pathway-explorer.html'), 'utf8');
  check(shell.indexOf('wslsa-2027-theme') > 0 && shell.indexOf('wslsa-2027-theme') < shell.indexOf('<style>'), 'the theme should be set before the styles load');
  await dk.click(themeBtn);
  check(await themeNow() === 'light' && await dk.evaluate(() => localStorage.getItem('wslsa-2027-theme')) === 'light' && await paint('body') === 'rgb(246, 241, 234)', 'it should switch back');
  check(await dk.evaluate(() => { WSLSA.select('2785|BASE'); return true; }), 'a render should not disturb it');
  check(await themeNow() === 'light', 'the theme should stay as chosen');
  const pmenu = await newPage(browser, { viewport: { width: 390, height: 844 } });
  await pmenu.goto(APP);
  await pmenu.click('[data-action="top-menu"]');
  check(await pmenu.isVisible('[data-action="theme-toggle"]') && await pmenu.isVisible('[data-action="tour-start"]'), 'the menu should offer dark mode and the tour on a phone');
  await pmenu.click('[data-action="theme-toggle"]');
  check(await pmenu.evaluate(() => document.documentElement.dataset.theme) === 'dark' && await pmenu.isHidden('[data-action="print"]'), 'switching from the menu should work and close it');
  await pmenu.close();
  check(dk.errors.length === 0, 'dark mode console errors: ' + dk.errors.join('; '));
  await dk.close();

  // ---------------------------------------------------------------- the masthead stays on one row
  const mastRows = await newPage(browser);
  await mastRows.goto(APP);
  for (const w of [1440, 1321, 1320, 1200, 1131, 1130, 900]) {
    await mastRows.setViewportSize({ width: w, height: 800 });
    const tops = await mastRows.$$eval('.topbar .tbtn', bs => Array.from(new Set(bs.filter(b => b.getClientRects().length).map(b => Math.round(b.getBoundingClientRect().top)))));
    check(tops.length === 1, `the masthead should keep one row at ${w} px, got ${tops.length}`);
  }
  await mastRows.close();

  // ---------------------------------------------------------------- the guided tour is only ever offered to a first-time visitor
  const firstVisit = async (url, setup, opts) => {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' }, opts || {}));
    const p = await ctx.newPage();
    p.errors = [];
    p.on('pageerror', e => p.errors.push(e.message));
    if (setup) await p.addInitScript(setup);
    await p.goto(url);
    return p;
  };
  const promptShows = async p => { await p.waitForTimeout(900); return p.isVisible('#tour-prompt'); };
  const t1 = await firstVisit(APP);
  check(await promptShows(t1), 'a first-time visitor should be offered the tour');
  check(/New to the Pathway Explorer\? Would you like a quick guided tour of how to map your degree\?/.test(await t1.textContent('#tour-prompt')) && await t1.textContent('[data-action="tour-accept"]') === 'Start Tour →' && await t1.textContent('[data-action="tour-decline"]') === 'No thanks', 'the prompt should ask politely');
  check(await t1.evaluate(() => !document.getElementById('app').inert) && await t1.isHidden('#tour'), 'the prompt should not block the page');
  await t1.click('[data-action="tour-decline"]');
  check(await t1.isHidden('#tour-prompt') && await t1.evaluate(() => localStorage.getItem('wslsa-2027-tour-dismissed')) === '1', 'No thanks should be remembered');
  await t1.reload();
  check(!(await promptShows(t1)), 'it should not ask again');
  const t2 = await firstVisit(APP);
  await t2.waitForTimeout(100);
  const planLink = await t2.evaluate(() => WSLSA.planUrl());
  await t2.reload();
  check(!(await promptShows(t2)), 'a browser with a saved plan should not be asked');
  const t3 = await firstVisit(planLink);
  check(!(await promptShows(t3)), 'someone arriving by a share link should not be asked');
  const t4 = await firstVisit(APP + '?d=1');
  check(!(await promptShows(t4)), 'someone arriving with plan parameters should not be asked');
  const t5 = await firstVisit(APP, () => { localStorage.setItem('wslsa-2027-explorer-unrelated', '1'); localStorage.setItem('wslsa-2027-tour-dismissed', '1'); });
  check(!(await promptShows(t5)), 'someone who dismissed it should not be asked');
  for (const p of [t1, t2, t3, t4, t5]) check(p.errors.length === 0, 'tour prompt console errors: ' + p.errors.join('; '));
  // the nine steps
  const t6 = await firstVisit(APP);
  await t6.evaluate(() => WSLSA.select('2785|BASE'));
  await t6.waitForSelector('#tour-prompt:not([hidden])');
  await t6.click('[data-action="tour-accept"]');
  check(await t6.isVisible('#tour') && await t6.isHidden('#tour-prompt') && await t6.evaluate(() => document.getElementById('app').inert) && await t6.evaluate(() => document.activeElement.dataset.action === 'tour-next'), 'Start Tour should open it with focus on Next');
  const planBefore = await t6.evaluate(() => JSON.stringify(WSLSA.state()));
  const stepTargets = ['#dock', '#dock .progress', '#advisory', '#next', '#section-tools', '#gridbar', '.subj.tour-target', '#details', '#enquiry-box'];
  for (let i = 0; i < stepTargets.length; i++) {
    await t6.waitForTimeout(60);
    const s = await t6.evaluate(sel => {
      const r = e => e.getBoundingClientRect();
      const spot = r(document.querySelector('.tour-spot'));
      const t = r(document.querySelector(sel));
      const c = r(document.querySelector('.tour-card'));
      return { count: document.getElementById('tour-count').textContent, covers: spot.left <= t.left + 1 && spot.top <= t.top + 1 && spot.right >= t.right - 1 && spot.bottom >= t.bottom - 1, onScreen: t.top < innerHeight && t.bottom > 0 && t.left >= 0, card: c.top >= 0 && c.left >= 0 && c.bottom <= innerHeight && c.right <= innerWidth, border: getComputedStyle(document.querySelector('.tour-spot')).borderTopColor, shadow: /9999px/.test(getComputedStyle(document.querySelector('.tour-spot')).boxShadow), width: document.getElementById('tour-fill').style.width };
    }, stepTargets[i]);
    check(s.count === `Step ${i + 1} of 9` && s.covers && s.onScreen && s.card && s.shadow && parseFloat(s.width) > 0, `step ${i + 1} should light up ${stepTargets[i]}, got ${JSON.stringify(s)}`);
    if (i === 6) check(await t6.$eval('.subj.tour-target .chain-btn, .subj.tour-target .defer-btn', b => getComputedStyle(b).opacity) === '1', 'the cards step should show the tools it describes');
    if (i === 0) check(await t6.isDisabled('[data-action="tour-back"]'), 'there is nothing before the first step');
    if (i === 8) {
      check(await t6.textContent('[data-action="tour-next"]') === 'Finish' && !!(await t6.$('#tour .tour-clone')) && await t6.$eval('#tour .tour-clone', c => { const a = c.getBoundingClientRect(); const b = document.querySelector('.topbar [data-action="export-open"]').getBoundingClientRect(); return Math.abs(a.left - b.left) < 2 && Math.abs(a.top - b.top) < 2; }), 'the last step should finish, and show the PDF button too');
      break;
    }
    await t6.click('[data-action="tour-next"]');
  }
  await t6.click('[data-action="tour-next"]');
  check(await t6.isHidden('#tour') && await t6.evaluate(() => !document.getElementById('app').inert) && !(await t6.$('.tour-target, .tour-clone')), 'Finish should close it and leave nothing behind');
  check(await t6.evaluate(() => JSON.stringify(WSLSA.state())) === planBefore && await t6.evaluate(() => WSLSA.history().undo) === 0, 'the tour should not change the plan');
  await t6.reload();
  check(!(await promptShows(t6)), 'after a tour it should not ask again');
  // the keyboard, and starting it by hand
  await t6.click('[data-action="tour-start"]');
  const tourStep = () => t6.textContent('#tour-count');
  await t6.keyboard.press('ArrowRight');
  await t6.keyboard.press('ArrowRight');
  check(await tourStep() === 'Step 3 of 9', 'the right arrow should go forward');
  await t6.keyboard.press('ArrowLeft');
  check(await tourStep() === 'Step 2 of 9', 'the left arrow should go back');
  await t6.click('[data-action="tour-back"]');
  check(await tourStep() === 'Step 1 of 9', 'Back should go back');
  await t6.keyboard.press('ArrowLeft');
  check(await tourStep() === 'Step 1 of 9', 'the first step should stay put');
  for (let i = 0; i < 6; i++) await t6.keyboard.press('Tab');
  check(await t6.evaluate(() => !!document.activeElement.closest('.tour-card')), 'Tab should stay in the tour');
  await t6.keyboard.press('Control+z');
  check(await t6.isVisible('#tour'), 'keys for the page should wait until the tour is over');
  await t6.keyboard.press('Escape');
  check(await t6.isHidden('#tour') && await t6.evaluate(() => document.activeElement.dataset.action === 'tour-start'), 'Esc should end it and go back to the Tour button');
  await t6.click('[data-action="tour-start"]');
  await t6.click('[data-action="tour-skip"]');
  check(await t6.isHidden('#tour'), 'Skip Tour should end it');
  // on a phone
  const t7 = await firstVisit(APP, null, { viewport: { width: 390, height: 844 } });
  await t7.evaluate(() => { localStorage.setItem('wslsa-2027-tour-dismissed', '1'); WSLSA.select('2785|BASE'); });
  await t7.click('[data-action="top-menu"]');
  await t7.click('[data-action="tour-start"]');
  for (let i = 0; i < 9; i++) {
    await t7.waitForTimeout(60);
    const s = await t7.evaluate(() => { const c = document.querySelector('.tour-card').getBoundingClientRect(); const sp = document.querySelector('.tour-spot').getBoundingClientRect(); return { card: c.top >= 0 && c.bottom <= innerHeight && c.left >= 0 && c.right <= innerWidth, spot: sp.top < innerHeight && sp.bottom > 0, wide: document.documentElement.scrollWidth <= 390 }; });
    check(s.card && s.spot && s.wide, `phone step ${i + 1} should fit the screen, got ${JSON.stringify(s)}`);
    if (i === 8) check(await t7.evaluate(() => document.querySelector('.tour-card').getBoundingClientRect().bottom <= document.querySelector('.enq-pill').getBoundingClientRect().top), 'on a phone the last step should show the box, not cover it');
    await t7.click('[data-action="tour-next"]');
  }
  check(await t7.isHidden('#tour'), 'the phone tour should finish');
  check(t6.errors.length === 0 && t7.errors.length === 0, 'tour console errors: ' + t6.errors.concat(t7.errors).join('; '));
  for (const p of [t1, t2, t3, t4, t5, t6, t7]) await p.context().close();

  // ---------------------------------------------------------------- Law Enquiry box
  const en = await newPage(browser, { viewport: { width: 1440, height: 900 } });
  await en.goto(APP);
  await en.evaluate(() => { WSLSA.select('2848|BASE'); });
  const box = () => en.$eval('#enquiry-box', e => { const r = e.getBoundingClientRect(); return { right: Math.round(innerWidth - r.right), bottom: Math.round(innerHeight - r.bottom), position: getComputedStyle(e).position, z: getComputedStyle(e).zIndex }; });
  const b0 = await box();
  check(b0.position === 'fixed' && b0.right === 16 && b0.bottom === 16 && b0.z === '48', `the box should sit bottom right, got ${JSON.stringify(b0)}`);
  check(/Law Enquiry · 2027 Help/.test(await en.textContent('.enq-pill')) && await en.textContent('#enq-badge') === '< 80 Law CP' && await en.isHidden('#enq-card') && await en.getAttribute('.enq-pill', 'aria-expanded') === 'false', 'the pill should show its label and status');
  check(await en.textContent('#notice .notice-cta') === 'View details' && !(await en.$('#notice details')), 'the top notice should be one line');
  await en.click('#notice .notice-cta');
  check(await en.isVisible('#enq-card') && await en.evaluate(() => document.activeElement.id === 'enq-card') && await en.getAttribute('.enq-pill', 'aria-expanded') === 'true', 'the notice should open the box and move to it');
  const enqRect = await en.$eval('#enq-card', c => { const r = c.getBoundingClientRect(); return r.top >= 0 && r.left >= 0 && r.right <= innerWidth; });
  check(enqRect, 'the open box should fit on screen');
  check(/2026 Handbook/.test(await en.textContent('#enq-card')) && /under 80 CP/.test(await en.textContent('#enq-status')), 'the box should give the School\'s advice and where the student stands');
  check((await en.$$('[data-action="enq-topic"]')).length === 4 && await en.$eval('[data-action="enq-topic"][aria-pressed="true"]', c => c.textContent) === '2027 Transition Check', 'there should be four topics, starting with the transition check');
  check(await en.getAttribute('#enq-email', 'href') === 'mailto:' + LAW_ENQUIRY && await en.getAttribute('#enquiry-box [data-action="print"]', 'data-action') === 'print', 'it should email the Law Enquiry Team and offer the PDF');
  // the draft follows the topic and the plan
  await en.evaluate(() => { window.addEventListener('click', e => { if (e.target.closest('#enq-email')) e.preventDefault(); }); });
  const draftHref = async () => { await en.click('#enq-email'); const h = await en.getAttribute('#enq-email', 'href'); const u = new URL(h); return { to: u.pathname, subject: u.searchParams.get('subject'), body: u.searchParams.get('body') }; };
  const d1 = await draftHref();
  check(d1.to === LAW_ENQUIRY && /^2027 curriculum transition check: 2848 Bachelor of Laws$/.test(d1.subject) && /Degree: 2848 Bachelor of Laws/.test(d1.body) && /Completed: 0 of 320 CP/.test(d1.body) && /Chosen alternates: None yet/.test(d1.body) && /Plan link: \S+#\S+/.test(d1.body), `the email should carry the plan, got ${JSON.stringify(d1).slice(0, 300)}`);
  check(!/[—!]|n't\b/.test(d1.body), 'the draft should be in plain, full words');
  await en.click('[data-action="enq-topic"][data-topic="waiver"]');
  check(await en.getAttribute('[data-action="enq-topic"][data-topic="waiver"]', 'aria-pressed') === 'true' && await en.getAttribute('[data-action="enq-topic"][data-topic="transition"]', 'aria-pressed') === 'false', 'pressing a topic should select it');
  const d2 = await draftHref();
  check(/^Prerequisite waiver query/.test(d2.subject) && /prerequisite waiver/.test(d2.body), 'the topic should change the subject and body');
  await en.evaluate(() => { window.__copied = ''; const c = navigator.clipboard || {}; try { Object.defineProperty(navigator, 'clipboard', { value: { writeText: t => { window.__copied = t; return Promise.resolve(); } }, configurable: true }); } catch (e) { /* older browsers */ } });
  await en.click('[data-action="enq-copy"]');
  await en.waitForTimeout(60);
  const copied = await en.evaluate(() => window.__copied);
  check(copied === '' || (copied.indexOf('To: ' + LAW_ENQUIRY) === 0 && /Subject: Prerequisite waiver query/.test(copied) && /Plan link:/.test(copied)), `Copy Email Draft should copy who to, the subject and the body, got ${copied.slice(0, 120)}`);
  check(/Email draft copied/.test(await en.textContent('#toast')), 'it should confirm the copy');
  // the status follows the ticks, and only Law subjects count
  await en.evaluate(() => { WSLSA.select('2785|BASE'); });
  const lawCount = () => en.evaluate(() => { const c = WSLSA.context(); return c.slots.filter(s => s.done && !s.pending && /^LAWS /.test(s.code)).reduce((n, s) => n + s.cp, 0); });
  await en.evaluate(() => { WSLSA.context().slots.filter(s => !s.pending && !/^LAWS /.test(s.code) && s.year === 1).slice(0, 2).forEach(s => document.querySelector('#slot-' + s.id + ' .tick input').click()); });
  check(await lawCount() === 0 && await en.textContent('#enq-badge') === '< 80 Law CP', 'non-law subjects should not count');
  await en.evaluate(() => { WSLSA.context().slots.filter(s => !s.pending && /^LAWS /.test(s.code)).slice(0, 8).forEach(s => document.querySelector('#slot-' + s.id + ' .tick input').click()); });
  check(await lawCount() >= 80 && await en.textContent('#enq-badge') === '≥ 80 Law CP' && /80 CP or more/.test(await en.textContent('#enq-status')), `the badge should flip at 80 Law CP, with ${await lawCount()} ticked`);
  check(/Completed: \d+ of 400 CP, including \d+ CP of Law subjects/.test((await draftHref()).body), 'the email should use the live numbers');
  // a choice appears as a chosen alternate
  const altSlot = await en.evaluate(() => WSLSA.context().slots.find(s => s.kind === 'llb' && s.pending).id);
  await en.keyboard.press('Escape');
  await en.click(`#slot-${altSlot} [data-action="picker-open"]`);
  await en.click('#pick-results .pick:not([disabled])');
  await en.click('.enq-pill');
  const altCode = await en.evaluate(i => WSLSA.context().byId[i].code, altSlot);
  check(new RegExp('Chosen alternates: ' + altCode).test((await draftHref()).body), 'the email should name the chosen alternates');
  // its state is remembered
  check(await en.evaluate(() => localStorage.getItem('wslsa-2027-enquiry')) === 'open', 'open should be remembered');
  await en.reload();
  check(await en.isVisible('#enq-card'), 'it should reopen as it was');
  await en.focus('[data-action="enq-copy"]');
  await en.keyboard.press('Escape');
  check(await en.isHidden('#enq-card') && await en.evaluate(() => document.activeElement.classList.contains('enq-pill') && localStorage.getItem('wslsa-2027-enquiry') === 'min'), 'Esc inside it should minimise it and remember');
  await en.reload();
  check(await en.isHidden('#enq-card'), 'it should stay minimised');
  check((await smallTargets(en)).length === 0, 'the box should have targets of at least 24 px: ' + (await smallTargets(en)).join('; '));
  await en.click('.enq-pill');
  await en.click('.enq-more > summary');
  check((await smallTargets(en)).length === 0 && (await headingSkips(en, '#enquiry-box')).length === 0, 'the open box should have targets of at least 24 px and ordered headings: ' + (await smallTargets(en)).join('; '));
  // the actions stay in view however far the card is scrolled
  await en.setViewportSize({ width: 1440, height: 620 });
  const actionsShow = () => en.evaluate(() => { const c = document.getElementById('enq-card').getBoundingClientRect(); const a = document.querySelector('.enq-actions').getBoundingClientRect(); return document.getElementById('enq-card').scrollHeight > c.height && Math.abs(a.bottom - c.bottom) < 3; });
  check(await en.evaluate(() => { document.getElementById('enq-card').scrollTop = 0; return true; }) && await actionsShow(), 'at the top of a scrolling card, the actions should show');
  await en.evaluate(() => { document.getElementById('enq-card').scrollTop = 70; });
  check(await actionsShow(), 'part way down a scrolling card, the actions should show');
  await en.setViewportSize({ width: 1440, height: 900 });
  // nothing that floats overlaps it
  const overlapIn = (p, a, b) => p.evaluate(([x, y]) => { const r = document.querySelector(x).getBoundingClientRect(); const s = document.querySelector(y).getBoundingClientRect(); return r.width > 0 && s.width > 0 && r.left < s.right && s.left < r.right && r.top < s.bottom && s.top < r.bottom; }, [a, b]);
  const chainSlot = await en.evaluate(() => document.querySelector('#grid .chain-btn').dataset.slot);
  await en.$eval(`#slot-${chainSlot}`, c => c.scrollIntoView({ block: 'center' }));
  await en.$eval(`#slot-${chainSlot} .chain-btn`, b => b.click());
  check(await en.isVisible('#xray-note') && !(await overlapIn(en, '#xray-note', '#enq-card')) && !(await overlapIn(en, '#xray-note', '.enq-pill')), 'the chain note should not overlap the open box');
  await en.$eval(`#slot-${chainSlot} .chain-btn`, b => b.click());
  check(en.errors.length === 0, 'enquiry console errors: ' + en.errors.join('; '));
  await en.close();
  // first visits: open on a wide screen until the student scrolls, a pill on a phone
  const e1 = await firstVisit(APP);
  check(await e1.isVisible('#enq-card'), 'a first visit on a wide screen should show the box open');
  check(await e1.evaluate(() => document.getElementById('enq-card').getBoundingClientRect().top >= document.getElementById('dock-wrap').getBoundingClientRect().bottom), 'open on a first visit, the box should leave the degree controls clear');
  await e1.waitForSelector('#tour-prompt:not([hidden])');
  check(!(await overlapIn(e1, '#tour-prompt', '#enq-card')) && !(await overlapIn(e1, '#tour-prompt', '.enq-pill')), 'the tour prompt and the open box should not overlap');
  const firstChain = await e1.evaluate(() => { const b = document.querySelector('#grid .chain-btn'); b.scrollIntoView({ block: 'center' }); return b.dataset.slot; });
  await e1.$eval(`#slot-${firstChain} .chain-btn`, b => b.click());
  check(await e1.isVisible('#xray-note') && !(await overlapIn(e1, '#xray-note', '#tour-prompt')), 'the chain note and the tour prompt should not overlap');
  await e1.$eval(`#slot-${firstChain} .chain-btn`, b => b.click());
  await e1.evaluate(() => { const c = document.getElementById('enq-card'); if (!c.hidden) c.closest('#enquiry-box').querySelector('.enq-pill').click(); c.closest('#enquiry-box').querySelector('.enq-pill').click(); });
  check(await e1.evaluate(() => getComputedStyle(document.getElementById('enq-card')).getPropertyValue('--enq-room').trim() === ''), 'once the student opens it, the box should use its full height');
  await e1.evaluate(() => { localStorage.removeItem('wslsa-2027-enquiry'); window.scrollTo(0, 0); });
  await e1.reload();
  await e1.evaluate(() => window.scrollTo(0, 600));
  await e1.waitForFunction(() => document.getElementById('enq-card').hidden);
  check(await e1.evaluate(() => localStorage.getItem('wslsa-2027-enquiry')) === 'min', 'left alone, it should tuck itself away once the student scrolls');
  await e1.context().close();
  const e0 = await firstVisit(APP, null, { viewport: { width: 1366, height: 650 } });
  check(await e0.isHidden('#enq-card') && await e0.isVisible('.enq-pill'), 'a short laptop screen should start with the pill, as open it would cover the degree controls');
  await e0.context().close();
  const e2 = await firstVisit(APP, null, { viewport: { width: 390, height: 844 } });
  check(await e2.isHidden('#enq-card') && await e2.isVisible('.enq-pill'), 'a phone should start with the pill');
  await e2.waitForSelector('#tour-prompt:not([hidden])');
  check(!(await overlapIn(e2, '#tour-prompt', '.enq-pill')), 'on a phone the tour prompt should clear the pill');
  await e2.click('.enq-pill');
  check(await e2.isHidden('#tour-prompt'), 'on a phone the open box should not sit under the tour prompt');
  await e2.click('.enq-pill');
  check(await e2.isVisible('#tour-prompt'), 'the tour prompt should come back when the box closes');
  await e2.click('[data-action="tour-decline"]');
  await e2.evaluate(() => window.scrollTo(0, document.getElementById('grid').getBoundingClientRect().top + scrollY));
  await e2.waitForFunction(() => document.getElementById('mini-bar').classList.contains('is-on'));
  await e2.waitForTimeout(350);
  check(!(await overlapIn(e2, '.enq-pill', '#mini-bar')), 'the pill should sit above the phone bar');
  await e2.click('.mini-toggle');
  await e2.waitForTimeout(350);
  check(await e2.$eval('#mini-bar', b => b.classList.contains('is-min')) && !(await overlapIn(e2, '.enq-pill', '#mini-bar')), 'the pill should sit above the minimised phone bar');
  await e2.click('.mini-toggle');
  await e2.waitForTimeout(350);
  await e2.evaluate(() => { document.querySelector('#grid .subj:not(.is-pending) .tick input').click(); document.querySelector('#grid .subj:not(.is-pending) .tick input').click(); });
  await e2.click('.enq-pill');
  check(await e2.isVisible('#enq-card') && await e2.$eval('#enq-card', c => { const r = c.getBoundingClientRect(); return r.top >= 0 && r.left >= 0 && r.right <= innerWidth; }) && await e2.evaluate(() => document.documentElement.scrollWidth <= 390), 'the open box should fit a phone');
  await e2.context().close();

  // the footer should scroll every word clear of the pill
  for (const size of [{ width: 1440, height: 900 }, { width: 1100, height: 800 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
    const fp = await newPage(browser, { viewport: size });
    await fp.goto(APP);
    await fp.evaluate(() => { window.scrollTo(0, document.documentElement.scrollHeight); });
    await fp.waitForTimeout(400);
    const covered = await fp.evaluate(() => {
      const pill = document.querySelector('.enq-pill').getBoundingClientRect();
      const out = [];
      const walk = document.createTreeWalker(document.querySelector('.site-footer'), NodeFilter.SHOW_TEXT);
      while (walk.nextNode()) {
        if (!walk.currentNode.nodeValue.trim()) continue;
        const r = document.createRange();
        r.selectNodeContents(walk.currentNode);
        for (const q of r.getClientRects()) if (q.left < pill.right && pill.left < q.right && q.top < pill.bottom && pill.top < q.bottom) { out.push(walk.currentNode.nodeValue.trim().slice(-40)); break; }
      }
      return out;
    });
    check(covered.length === 0, `at ${size.width}x${size.height} the pill should not cover the end of the footer, got ${covered.join(' | ')}`);
    await fp.close();
  }

  // ---------------------------------------------------------------- plan backup
  const bk = await newPage(browser, { viewport: { width: 1440, height: 900 } });
  bk.on('dialog', d => d.accept());
  await bk.goto(APP);
  await bk.evaluate(() => { WSLSA.select('2848|BASE'); });
  const bkAlt = await bk.evaluate(() => WSLSA.context().slots.find(s => s.kind === 'llb' && s.pending).id);
  await bk.click(`#slot-${bkAlt} [data-action="picker-open"]`);
  await bk.click('#pick-results .pick:not([disabled])');
  await bk.click('#year-1 .session[data-s="Autumn"] [data-action="session-done"]');
  await bk.click('[data-action="pin"]');
  await bk.selectOption('#sel-campus', 'PS');
  await bk.click('[data-action="import-open"]');
  check(!!(await bk.$('.modal [data-action="backup-save"]')), 'Tick off from my results should offer a backup');
  await bk.keyboard.press('Escape');
  await bk.click('[data-action="progress-open"]');
  const dlBackup = bk.waitForEvent('download');
  await bk.click('.modal [data-action="backup-save"]');
  const backupFile = await dlBackup;
  check(/^wslsa-plan-backup-\d{4}-\d{2}-\d{2}\.json$/.test(backupFile.suggestedFilename()), `the backup should have a clear name, got ${backupFile.suggestedFilename()}`);
  const backupText = fs.readFileSync(await backupFile.path(), 'utf8');
  const backup = JSON.parse(backupText);
  check(backup.app === 'wslsa-2027-pathway-explorer' && backup.state.degree === '2848' && Object.keys(backup.state.picks).length === 1 && Object.keys(backup.state.done).length === 1 && Array.isArray(backup.pinned.subjects), 'the backup should hold the whole plan and the pinned snapshot');
  check(/\.json/.test(await bk.getAttribute('#progress-file', 'accept')) && /\.pdf/.test(await bk.getAttribute('#progress-file', 'accept')), 'the import box should take a backup as well as a PDF');
  await bk.keyboard.press('Escape');
  const planOnly = p => p.evaluate(() => { const s = WSLSA.state(); return JSON.stringify({ degree: s.degree, majorFor: s.majorFor, picks: s.picks, done: s.done, custom: s.custom, mode: s.mode, campus: s.campus, load: s.load }, (k, v) => (k === 'custom' && v === false ? undefined : v)); });
  const backedUp = await planOnly(bk);
  // restoring on a fresh browser, in one step
  const bk2 = await newPage(browser, { viewport: { width: 1440, height: 900 } });
  await bk2.goto(APP);
  await bk2.click('[data-action="progress-open"]');
  await bk2.setInputFiles('#progress-file', { name: 'plan.json', mimeType: 'application/json', buffer: Buffer.from(backupText) });
  await bk2.waitForFunction(() => /restored/i.test(document.getElementById('toast').textContent));
  check(await planOnly(bk2) === backedUp && !(await bk2.$('.modal')) && !!(await bk2.$('[data-action="compare"]')), 'adding the file should restore the plan and pinned snapshot in one step');
  check(await bk2.evaluate(() => /restored a plan backup/.test(WSLSA.history().undoLabel)), 'a restore should be undoable');
  await bk2.click('#toast [data-action="undo"]');
  check(await bk2.evaluate(() => Object.keys(WSLSA.state().picks).length === 0), 'Undo should go back to the plan before the restore');
  // bad files are refused, and a hand-edited one cannot add anything a plan could not hold
  await bk2.click('[data-action="progress-open"]');
  await bk2.setInputFiles('#progress-file', { name: 'plan.json', mimeType: 'application/json', buffer: Buffer.from('{not json') });
  await bk2.waitForFunction(() => /not a plan backup/.test(document.getElementById('progress-status').textContent));
  check(!!(await bk2.$('.modal')), 'a broken file should leave the window open with a message');
  await bk2.setInputFiles('#progress-file', { name: 'other.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":"world"}') });
  await bk2.waitForTimeout(80);
  check(await bk2.evaluate(() => Object.keys(WSLSA.state().picks).length === 0) && /not a plan backup/.test(await bk2.textContent('#progress-status')), 'some other JSON file should be refused');
  const nasty = JSON.parse(backupText);
  const nastySlot = Object.keys(nasty.state.picks['2848|BASE'])[0];
  nasty.state.picks['2848|BASE'][nastySlot] = { code: 'LAWS 9999', title: '<img src=x onerror="window.__hit=1">' };
  nasty.state.picks['9999|NOPE'] = { x: { code: 'A', title: 'B' } };
  nasty.state.view = 'evil';
  nasty.state.extra = 'ignored';
  nasty.pinned = { subjects: [{ c: '<b>x</b>', t: '<img src=x onerror="window.__hit=1">', w: 'y' }], finish: 'x', pinned: '<i>y</i>', label: 'z', load: 'FT', sessions: 1, summers: 0, commute: 0, heavy: 0 };
  await bk2.setInputFiles('#progress-file', { name: 'plan.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(nasty)) });
  await bk2.waitForFunction(() => /restored/i.test(document.getElementById('toast').textContent));
  const nastyState = await bk2.evaluate(() => { const s = WSLSA.state(); return { keys: Object.keys(s.picks), view: s.view, extra: s.extra }; });
  check(JSON.stringify(nastyState.keys) === JSON.stringify(['2848|BASE']) && nastyState.view === 'all' && nastyState.extra === undefined, `a hand-edited file should be cleaned like any saved plan, got ${JSON.stringify(nastyState)}`);
  await bk2.click('[data-action="compare"]');
  await bk2.waitForTimeout(60);
  check(!(await bk2.$('.modal img, #grid img')) && await bk2.evaluate(() => !window.__hit), 'text in a backup should never run as code');
  check(bk.errors.length === 0 && bk2.errors.length === 0, 'backup console errors: ' + bk.errors.concat(bk2.errors).join('; '));
  await bk.close();
  await bk2.close();

  // ---------------------------------------------------------------- mobile layout
  const m = await newPage(browser, { viewport: { width: 390, height: 844 } });
  await m.goto(APP);
  check(await m.evaluate(() => document.documentElement.scrollWidth <= 390), 'no horizontal scroll at 390px');
  // the dock scrolls away on a phone, so a small bar stands in for it
  await m.evaluate(() => { localStorage.clear(); WSLSA.select('2848|BASE'); });
  check(await m.isHidden('#mini-bar') || !(await m.$('#mini-bar.is-on')), 'the phone bar should wait until the dock has scrolled away');
  await m.evaluate(() => window.scrollTo(0, document.getElementById('grid').getBoundingClientRect().top + window.scrollY));
  await m.waitForTimeout(200);
  check(!!(await m.$('#mini-bar.is-on')) && await m.isVisible('#mini-track') && /^0 \/ 320 CP$/.test(await m.textContent('#mini-num')), 'the phone bar should show progress once the dock has gone');
  await m.click('#grid .subj .tick');
  check(/^10 \/ 320 CP$/.test(await m.textContent('#mini-num')), 'ticking should update the phone bar');
  await m.click('[data-action="mini-toggle"]');
  check(!!(await m.$('#mini-bar.is-min')) && await m.isHidden('#mini-track') && await m.getAttribute('[data-action="mini-toggle"]', 'aria-expanded') === 'false', 'the phone bar should collapse');
  await m.click('[data-action="mini-toggle"]');
  await m.click('[data-action="mini-top"]');
  await m.waitForTimeout(250);
  check(await m.evaluate(() => document.activeElement.id === 'sel-degree' && document.getElementById('dock-wrap').getBoundingClientRect().top < 40) && !(await m.$('#mini-bar.is-on')), 'Controls should jump back to the dock');
  check(await m.evaluate(() => document.documentElement.scrollWidth <= 390), 'the phone bar should not cause sideways scrolling');
  check(m.errors.length === 0, 'mobile console errors: ' + m.errors.join('; '));
  await m.close();

  // ---------------------------------------------------------------- PDFs (optional)
  if (args.has('--pdf') || args.has('--samples')) {
    if (!hasPoppler()) {
      console.log('SKIP PDF checks: pdfinfo/pdftotext not installed');
    } else {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wslsa-'));
      const pdfPage = await newPage(browser);
      await pdfPage.goto(APP);
      await pdfPage.evaluate(() => document.fonts.ready);
      const keys = args.has('--pdf') ? info.map(p => p.key) : [];
      for (const key of keys) {
        for (const [mode, orient, max] of [['A', 'portrait', 2], ['A', 'landscape', 2], ['B', 'portrait', 3], ['B', 'landscape', 4]]) {
          const f = path.join(tmp, 'x.pdf');
          await renderPdf(pdfPage, key, mode, orient, f);
          const pages = +execSync(`pdfinfo "${f}"`).toString().match(/Pages:\s+(\d+)/)[1];
          check(pages <= max, `${key} Mode ${mode} ${orient}: ${pages} pages (max ${max})`);
          const codes = await pdfPage.evaluate(() => Array.from(document.querySelectorAll('#print-root td.pd-code')).map(td => td.textContent.trim()).filter(c => c !== '—'));
          const p1 = execSync(`pdftotext -f 1 -l 1 "${f}" -`).toString().replace(/\s+/g, ' ');
          const missing = codes.filter(c => !p1.includes(c));
          check(missing.length === 0, `${key} Mode ${mode} ${orient}: grid spills off page 1 (${missing.join(', ')})`);
          if (mode === 'B') {
            const p2 = execSync(`pdftotext -f 2 -l 2 "${f}" -`).toString();
            check(p2.includes('LLB Alternate Subjects'), `${key} Mode B ${orient}: LLB Alternate table should start on page 2`);
          }
        }
      }
      if (args.has('--samples')) {
        const out = path.join(ROOT, 'samples');
        fs.mkdirSync(out, { recursive: true });
        // a realistic plan: Accounting major, Parramatta South, several choices made, first year complete
        await pdfPage.evaluate(() => {
          localStorage.clear();
          WSLSA.select('2788|T046');
        });
        await pdfPage.selectOption('#sel-campus', 'PS');
        await pdfPage.click('#slot-2A3 .inline-opt[data-code="ECON 1011"]');
        for (const [slot, code] of [['4A3', 'LAWS 4008'], ['4A4', 'LAWS 4018'], ['4S3', 'LAWS 3067'], ['4S4', 'LAWS 3005']]) {
          await pdfPage.click(`#slot-${slot} [data-action="picker-open"]`);
          await pdfPage.click(`#pick-results .pick[data-code="${code}"]`);
        }
        for (const i of [0, 1]) await pdfPage.locator('#grid .year:first-child [data-action="session-done"]').nth(i).click();
        const samples = [
          ['2788|T046', 'A', 'portrait', '2788-T046-accounting-custom-pathway-A4-portrait.pdf'],
          ['2788|T046', 'B', 'portrait', '2788-T046-accounting-handbook-sheet-A4-portrait.pdf'],
        ];
        for (const [key, mode, orient, name] of samples) {
          await pdfPage.evaluate(([m, o]) => WSLSA.preparePrint({ mode: m, orient: o, ticks: true }), [mode, orient]);
          await pdfPage.emulateMedia({ media: 'print' });
          await pdfPage.pdf({ path: path.join(out, name), preferCSSPageSize: true, printBackground: true });
          await pdfPage.emulateMedia({ media: 'screen' });
        }
        await pdfPage.evaluate(() => { localStorage.clear(); WSLSA.select('2848|BASE'); });
        await pdfPage.reload();
        await renderPdf(pdfPage, '2848|BASE', 'A', 'landscape', path.join(out, '2848-laws-custom-pathway-A4-landscape.pdf'));
        console.log('Wrote sample PDFs to samples/');
      }
      check(pdfPage.errors.length === 0, 'PDF page errors: ' + pdfPage.errors.join('; '));
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  check(page.errors.length === 0, 'console errors: ' + page.errors.join('; '));
  await browser.close();
  console.log(`\n${passes} checks passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
