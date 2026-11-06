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
  check(await page.$eval('#notice a[href="mailto:' + LAW_ENQUIRY + '"]', a => a.textContent.trim()) === LAW_ENQUIRY, 'the notice should link the Law Enquiry Team email');
  check(/2026 Handbook/.test(await page.textContent('#notice')), 'the notice should point current students to the 2026 Handbook');
  check(docB.includes(LAW_ENQUIRY), 'the PDF disclaimer should carry the Law Enquiry email');
  const phased = await page.textContent('#notice .phase-grid');
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
  await pp.click('#year-1 section[aria-label="Autumn session"] [data-action="session-done"]');
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
  check(/Suggested/.test(await ux.textContent('#toast')) && !!(await ux.$('#section-tools [data-action="suggest-undo"]')), 'suggesting should offer an undo');
  await ux.click('#section-tools [data-action="suggest-undo"]');
  check(await openNow() === openBefore && !(await ux.$('#section-tools [data-action="suggest-undo"]')), 'undo should restore the open slots');
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
  check(await ux.evaluate(() => document.activeElement.id === 'cat-q'), '/ should go to the catalogue search');
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
  await mo.evaluate(() => { const b = document.querySelector('.modal-x'); if (b) b.click(); });
  await mo.waitForTimeout(220);
  // a subject glides to its new session in a custom plan
  await mo.click('[data-action="custom-from-current"]');
  await mo.click('button[type=submit][form=setup-form]');
  await mo.waitForTimeout(1100);
  const glide = await mo.evaluate(() => { const c = WSLSA.context().slots.find(s => !s.pending); return c.id; });
  await mo.click(`#slot-${glide} [data-action="clear"]`);
  await mo.waitForFunction(() => !document.documentElement.classList.contains('vt-cards'));
  check(await mo.evaluate(id => !!document.querySelector('#slot-' + id + '.is-pending'), glide), 'a change inside a view transition should still land');
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
    check(/Deferred ACCT 2001 to .*moved ACCT 3011/.test(await pt.textContent('#toast')) && !!(await pt.$('#toast [data-action="defer-undo"]')), `the toast should sum up the moves and offer Undo, got "${await pt.textContent('#toast')}"`);
    await pt.click('#toast [data-action="defer-undo"]');
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
    const diff = await pt.$$eval('.modal .pick-section', s => s.map(x => [x.querySelector('h4 span').textContent, x.querySelectorAll('.chipbtn').length]));
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

  // ---------------------------------------------------------------- mobile layout
  const m = await newPage(browser, { viewport: { width: 390, height: 844 } });
  await m.goto(APP);
  check(await m.evaluate(() => document.documentElement.scrollWidth <= 390), 'no horizontal scroll at 390px');
  // the dock scrolls away on a phone, so a small bar stands in for it
  await m.evaluate(() => { localStorage.clear(); WSLSA.select('2848|BASE'); });
  check(await m.isHidden('#mini-bar') || !(await m.$('#mini-bar.is-on')), 'the phone bar should wait until the dock has scrolled away');
  await m.evaluate(() => window.scrollTo(0, document.getElementById('grid').offsetTop));
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
