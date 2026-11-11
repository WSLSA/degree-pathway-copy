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
  // a returning student: no tour prompt. The tour checks set up their own pages.
  await page.addInitScript(() => { try { localStorage.setItem('wslsa-2027-tour-dismissed', '1'); } catch (e) { /* about:blank */ } });
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
  // a student reaches a control in a menu by opening the menu first, so a click does too
  const probe = await browser.newPage();
  const pageProto = Object.getPrototypeOf(probe);
  await probe.close();
  const plainClick = pageProto.click;
  pageProto.clickRaw = plainClick;
  pageProto.click = async function (selector, options) {
    const over = await this.evaluate(s => {
      let el = null;
      try { el = document.querySelector(s); } catch (e) { return null; }
      if (!el) return null;
      // a session's and a year's quiet tools show once the pointer is on that session or year
      const quiet = el.matches('.session-tools .note-btn, .session-tools [data-action="session-done"], .year-foot .text-btn') ? el.closest('.session, .year') : null;
      if (quiet && getComputedStyle(el).pointerEvents === 'none') {
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }
      const top = el.closest('#top-actions');
      const menu = document.querySelector('.top-menu-btn');
      if (top && menu.offsetParent && !top.classList.contains('is-open')) menu.click();
      // a card's tools are behind its ••• button
      const card = el.closest('.subj-edit') ? el.closest('.subj') : null;
      const more = card && !card.classList.contains('is-open') ? card.querySelector('.subj-more') : null; if (more) more.click();
      const pop = el.closest('.pop-menu');
      if (pop && pop.hidden && pop.previousElementSibling.offsetParent) pop.previousElementSibling.click();
      return null;
    }, selector).catch(() => null);
    if (over) await this.mouse.move(over.x, over.y);
    await plainClick.call(this, selector, options);
    // with subjects ticked the dock asks how much to switch; these checks are about the whole plan's view, as before
    if (/data-action="load"/.test(selector) && await this.$('#rp-form')) {
      await this.check('input[name="rp-scope"][value="whole"]');
      await plainClick.call(this, '#rp-apply');
    }
  };
  // a student reaches a select by focusing it, which is when a card's Move to list is filled in
  const plainSelect = pageProto.selectOption;
  pageProto.selectOption = async function (selector, values, options) {
    await this.evaluate(s => { let el = null; try { el = document.querySelector(s); } catch (e) { return; } const card = el && el.closest('.subj-edit') ? el.closest('.subj') : null; const more = card && !card.classList.contains('is-open') ? card.querySelector('.subj-more') : null; if (more) more.click(); }, selector).catch(() => {});
    await this.focus(selector).catch(() => {});
    return plainSelect.call(this, selector, values, options);
  };
  // a page opened again has what it saved, and is ready once the explorer has drawn its plan
  const plainReload = pageProto.reload;
  pageProto.reload = async function (options) {
    // what the page saved a moment ago reaches the browser's store a beat later, so a busy machine can reload ahead of it
    await this.waitForTimeout(400);
    const r = await plainReload.call(this, options);
    await this.waitForFunction(() => !!window.WSLSA && !!document.querySelector('#dock select') && document.readyState === 'complete').catch(() => {});
    return r;
  };
  // hovering or focusing one of a card's tools means the card's tools are open
  for (const name of ['hover', 'focus']) {
    const plain = pageProto[name];
    pageProto[name] = async function (selector, options) {
      await this.evaluate(s => { let el = null; try { el = document.querySelector(s); } catch (e) { return; } const card = el && el.closest('.subj-edit') ? el.closest('.subj') : null; const more = card && !card.classList.contains('is-open') ? card.querySelector('.subj-more') : null; if (more) more.click(); }, selector).catch(() => {});
      return plain.call(this, selector, options);
    };
  }
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
      gridText: document.getElementById('grid').textContent + document.getElementById('advisory').textContent + document.getElementById('hero-meta').textContent,
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
  // an edited pathway links as ranges of untouched template slots
  await lp.click('[data-action="load"][data-load="FT"]');
  await lp.evaluate(() => WSLSA.select('2788|T046'));
  await lp.click('[data-action="summer-add"][data-y="1"]');
  await lp.click(`#slot-${await lp.evaluate(() => WSLSA.context().slots.find(s => s.session === 'Summer').id)} [data-action="picker-open"]`);
  await lp.click('[data-action="cbring"]');
  const customLinkUrl = await lp.evaluate(() => WSLSA.planUrl());
  const customText = await lp.evaluate(() => WSLSA.linkText());
  check(/^ed\/tp=2788-T046\/s=[\d,:\-AUS]+/.test(customText) && customText.length < 80, `an edited pathway should link by template ranges, got ${customText}`);
  const customBefore = await lp.evaluate(() => JSON.stringify(WSLSA.custom()));
  const lp3 = await links.newPage();
  await lp3.goto(customLinkUrl);
  check(await lp3.evaluate(() => JSON.stringify(WSLSA.custom())) === customBefore, 'an edited pathway link should restore the plan exactly');
  check(await lp3.evaluate(() => WSLSA.context().edit === '2788|T046' && WSLSA.state().mode === 'guide' && document.getElementById('sel-degree').value === '2788'), 'an edited pathway link should open as that pathway');
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
  check(/2026 Handbook/.test(await page.textContent('.hero-note')), 'the first screen should point current students to the 2026 Handbook');
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
  // on a WSLSA pathway, Summer is added straight away, in the pathway's own edited copy
  await sp.click('[data-action="summer-add"][data-y="1"]');
  await sp.waitForTimeout(100);
  let sc = await sp.evaluate(() => { const c = WSLSA.context(); const s = c.slots.find(x => x.session === 'Summer'); return { custom: c.custom, edit: c.edit, mode: WSLSA.state().mode, total: c.totalCP, id: s && s.id, year: s && s.year, pending: s && s.pending }; });
  check(!(await sp.$('#setup-form')) && sc.edit === '2788|T046' && sc.mode === 'guide' && sc.year === 1 && sc.pending && sc.total === 410, `Summer should add one open 10 CP slot to Year 1 of the pathway's edited copy, got ${JSON.stringify(sc)}`);
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
  check(await sp.evaluate(() => WSLSA.custom().slots.filter(x => x.s === 'Summer').length) === 2 && !(await sp.$('#setup-form')), 'Summer in an edited pathway should add the session straight away');
  await sp.evaluate(() => { WSLSA.select('2848|BASE'); });
  check(await sp.evaluate(() => !WSLSA.context().custom && !WSLSA.context().slots.some(s => s.session === 'Summer')), 'WSLSA pathways should stay free of Summer slots');
  check(sp.errors.length === 0 && sp2.errors.length === 0, 'Summer console errors: ' + sp.errors.concat(sp2.errors).join('; '));
  await sp.close();
  await sp2.close();

  // ---------------------------------------------------------------- progress tools: finish date, next to enrol, tick off from results
  const pp = await newPage(browser);
  await pp.goto(APP);
  await pp.evaluate(() => { localStorage.clear(); WSLSA.select('2848|BASE'); });
  check(/Spring 2030/.test(await pp.textContent('#hero-meta')), '2848 full-time should finish in Spring 2030');
  check(JSON.stringify(await pp.$$eval('.year-bar h2 small', s => s.map(x => x.textContent))) === JSON.stringify(['2027', '2028', '2029', '2030']), 'year bars should show calendar years from 2027');
  await pp.click('[data-action="load"][data-load="PT"]');
  check(/Spring 2034/.test(await pp.textContent('#hero-meta')), '2848 part-time should finish in Spring 2034');
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
  check(/Autumn 2030/.test(await pp.textContent('#hero-meta')), 'removing Year 4 Spring should bring the finish forward to Autumn 2030');
  check(pp.errors.length === 0, 'progress tools console errors: ' + pp.errors.join('; '));
  await pp.close();

  // ---------------------------------------------------------------- import my progress (lines as the PDF reader gives them)
  // The date is fixed at 1 November 2026, during Spring 2026, so which sessions have begun does not depend on when this runs.
  const NOW = '2026-11-01T10:00:00';
  const ip = await newPage(browser);
  await ip.goto(APP);
  const planOf = () => ip.evaluate(() => {
    const c = WSLSA.context();
    return { start: WSLSA.custom().start, cp: c.plan.cp, total: c.totalCP, slots: c.slots.map(s => ({ code: s.pending ? '' : s.code, y: s.year, s: s.session, done: s.done, kind: s.typeLabel, replaced: s.replaced ? s.replaced.code : '', twin: s.twin ? s.twin.code : '' })) };
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
  check(/2785 Bachelor of Accounting\/Bachelor of Laws/.test(preview) && /Started Autumn 2025/.test(preview) && /5\s*Completed/.test(preview) && /1\s*In progress/.test(preview), `the preview should name the degree, start and counts, got ${preview.replace(/\n+/g, ' | ').slice(0, 240)}`);
  check(/LAWS 2013 looks like a fail/.test(preview) && /follows that degree/.test(preview) && /Still needed lists in your audit/.test(preview) && /Suggested Remaining Guide with a suggested session for each, from Autumn 2027/.test(preview), 'the preview should explain the fail, the degree change and where the rest goes');
  check(!/\b(D|H|C|P|NA)\b \(?10\)?|2025 Autumn, SC|\(10\)/.test(preview), 'the preview should show no grades, credit point columns or raw terms');
  await ip.click('#progress-apply');
  const dw = await planOf();
  await ip.click('#section-tools [data-action="undo"]');
  check(await ip.evaluate(() => !WSLSA.context().custom) && /Undid: imported your progress/.test(await ip.textContent('#toast')), 'an import should be undoable');
  await ip.click('#section-tools [data-action="redo"]');
  check(JSON.stringify(await planOf()) === JSON.stringify(dw), 'redo should bring the imported plan back');
  const dg = await ip.evaluate(() => WSLSA.guide());
  check(dw.start === 2025 && dw.cp === 400 && dw.total + dg.cp === 400 && dw.slots.every(x => x.y <= 2), `the plan should hold only the sessions taken so far, with the guide making up 400 CP, got start ${dw.start}, ${dw.total} + ${dg.cp} of ${dw.cp}`);
  const where = c => { const x = at(dw, c); return x.y + x.s + (x.done ? '+' : '-'); };
  check(['LAWS 1003', 'MATH 1030', 'ECON 2002', 'LAWS 1009', 'LAWS 2012', 'LAWS 2008'].map(where).join(' ') === '1Autumn+ 1Autumn+ 1Spring+ 1Spring+ 1Summer+ 2Spring+',
    `history should sit in its real sessions, with passes and subjects in progress ticked, got ${['LAWS 1003', 'MATH 1030', 'ECON 2002', 'LAWS 1009', 'LAWS 2012', 'LAWS 2008'].map(where).join(' ')}`);
  check(at(dw, 'ECON 2002').twin === 'FINC 2003' && !at(dw, 'ECON 2002').replaced && at(dw, 'MATH 1030').kind === 'Choice' && at(dw, 'LAWS 2012').kind === 'LLB Alternate', 'history should be tied to the pathway slots it fills, a pre-2027 subject counting for its 2027 twin');
  const gAt = c => { const r = dg.items.find(x => x.code === c); return r ? r.y + r.s : ''; };
  check(gAt('LAWS 2015') === '3Autumn' && !dg.items.some(x => x.code === 'LAWS 2020') && gAt('LAWS 3018') === '3Autumn' && gAt('LAWS 2013') === '3Spring', `the guide should suggest from Autumn 2027, LAWS 2015 itself and first, each in its session, got ${['LAWS 2015', 'LAWS 3018', 'LAWS 2013'].map(gAt).join(' ')}`);
  check(!dw.slots.concat(dg.items).some(x => ['LAWS 1010', 'LAWS 2019', 'LAWS 3099', 'LAWS 3102'].indexOf(x.code) >= 0), 'a pre-2027 audit should add no 2027 subject its record already counts for, and none of the three new 2027 cores');
  check(dg.items.filter(x => x.kind === 'llb').length === 2 && !dg.items.concat(dw.slots).some(x => ['LAWS 3001', 'JUST 2013', 'NOAW 0004', 'FINC 2003'].indexOf(x.code) >= 0), 'a list to choose from should become LLB Alternate slots in the guide, with no listed code placed');
  check(JSON.stringify(await ip.$$eval('.year-bar h2 small', s => s.slice(0, 3).map(x => x.textContent))) === JSON.stringify(['2025', '2026', '2027']) && /started 2025/i.test(await ip.getAttribute('.hp-finish', 'title')) && /started 2025/.test(await ip.textContent('#details')), 'year bars and facts should show the real calendar years');
  check(/Next to enrol/.test(await ip.textContent('#next')) && /Autumn 2027/.test(await ip.textContent('#next')) && /nothing planned yet/.test(await ip.textContent('#next')), `Next to enrol should pass over sessions that have begun and point to the guide, got ${(await ip.textContent('#next')).slice(0, 80)}`);
  check(!/TBC|2026 data|Summer/.test(await ip.textContent('#advisory summary')), 'completed subjects should raise no session or Summer warnings');
  const finishedFolded = await ip.$$eval('#grid .year', ys => ys.filter(y => { const c = y.querySelectorAll('.subj'); return c.length && Array.from(c).every(x => x.classList.contains('is-done')); }).map(y => y.classList.contains('is-folded')));
  check(finishedFolded.length > 0 && finishedFolded.every(Boolean) && !!(await ip.$('#dmap .dm-s[data-y="3"][data-s="Autumn"]')) && (await ip.$$('#grid #year-3 .slot-empty')).length === 2, `an imported plan should open with finished years folded and its sessions ahead empty, got ${JSON.stringify(finishedFolded)}`);
  await ip.click('[data-action="load"][data-load="PT"]');
  const ptYears = await ip.$$eval('.year', ys => ys.map(y => y.querySelector('h2 small').textContent.slice(0, 4) + ':' + y.querySelectorAll('.subj').length));
  check(ptYears[0] === '2025:5' && ptYears[1] === '2026:1', `part-time should keep sessions that have begun as they are, got ${ptYears.join(' ')}`);
  await ip.click('[data-action="load"][data-load="FT"]');
  // the plan and its start year travel in a share link
  const sharedLink = await ip.evaluate(() => WSLSA.planUrl());
  const ip2 = await newPage(browser);
  await ip2.goto(sharedLink);
  const reopened = await ip2.evaluate(() => { const c = WSLSA.custom(); return c.start + ':' + c.slots.filter(x => x.done).length + ':' + c.slots.length; });
  check(reopened === '2025:' + dw.slots.filter(x => x.done).length + ':' + dw.slots.length, `a share link should reopen the imported plan with its start year, got ${reopened}`);
  check(await ip2.evaluate(() => { const c = WSLSA.custom(); return c.cohort || (c.start && c.start < 2027 ? 'pre2027' : '2027'); }) === 'pre2027', 'a share link should keep the pre-2027 structure');
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
  const sg = await ip.evaluate(() => WSLSA.guide());
  const srAt = c => { const x = at(sr, c); return x.y + x.s + (x.done ? '+' : '-'); };
  const sgAt = c => { const r = sg.items.find(x => x.code === c); return r ? r.y + r.s : ''; };
  check(sr.start === 2025 && ['LAWS 2003', 'ACCT 2005', 'ACCT 3007'].map(srAt).join(' ') === '1Autumn+ 1Autumn+ 2Autumn+' && /Spring$/.test(sgAt('ACCT 1007')) && sr.total + sg.cp === 400,
    `results should place passes in their sessions and suggest the rest of the pathway from 2027, got start ${sr.start} ${['LAWS 2003', 'ACCT 2005', 'ACCT 3007'].map(srAt).join(' ')} ${sgAt('ACCT 1007')} ${sr.total} + ${sg.cp} CP`);
  check(ip.errors.length === 0, 'Import my progress console errors: ' + ip.errors.join('; '));
  await ip.close();

  // ---------------------------------------------------------------- a student who started before 2027 (a made-up record)
  // 2785, started Autumn 2024: a Subject Results page and a Degree Works audit read together. Under the pre-2027
  // structure there are 160 CP of Law core and 80 CP of LLB Alternates, pre-2027 subjects count for the 2027
  // subjects that replaced them, and LAWS 3067, on two lists, fills the Alternate Accounting choice first.
  {
  const pr = await newPage(browser);
  await pr.goto(APP);
  await pr.evaluate(() => { localStorage.clear(); WSLSA.select('2848|BASE'); });
  const RESULTS = [
    'Subject Results', '2785 - Bachelor of Accounting/Bachelor of Laws',
    'TERM SUBJECT CODE SUBJECT TITLE GRADE MARK CREDIT COUNTED in REASON', 'POINTS GPA PROVIDED (if no',
    '2024 LAWS1003 Fundamentals of Australian Law C 66 10', 'Autumn',
    '2024 ACCT1005 Accounting in Context D 73 10', 'Autumn',
    '2024 ECON1011 Principles of Economics P 57 10', 'Autumn',
    '2024 LAWS2004 Criminal Law C 64 10', 'Autumn',
    '2024 LAWS1009 Legal Analysis and Critique D 72 10', 'Spring',
    '2024 ACCT1007 Financial Accounting C 67 10', 'Spring',
    '2024 LAWS2013 Torts Law P 59 10', 'Spring',
    '2024 ECON1016 Economics for Business C 65 10', 'Spring',
    '2025 LAWS2003 Contracts C 69 10', 'Autumn',
    '2025 ACCT1010 Management Accounting P 58 10', 'Autumn',
    '2025 ACCT2005 Techniques in Financial Accounting D 71 10', 'Autumn',
    '2025 LAWS4010 Law Elective C 66 10', 'Autumn',
    '2025 NOAW0004 Academic Integrity S 100 0', 'Autumn Module',
    '2025 ECON2002 Corporate Financial Management P 62 10', 'Spring',
    '2025 ACCT2001 Contemporary Management Accounting C 64 10', 'Spring',
    '2025 ACCT3003 Accounting Standards P 56 10', 'Spring',
    '2025 LAWS2001 Alternative Dispute Resolution D 74 10', 'Spring',
    '2026 ACCT3007 Corporate Accounting C 68 10', 'Autumn',
    '2026 ACCT3006 Auditing and Assurance P 55 10', 'Autumn',
    '2026 FINC2002 Finance Elective C 63 10', 'Autumn',
    '2026 LAWS3023 Law Elective P 58 10', 'Autumn',
    'Total Credit Points Required 400',
  ];
  const AUDIT = [
    'Western Sydney University Audit', 'Student, Sample - 10000002',
    'Level Undergraduate Major No Major Program B Accounting/B Laws (2785) School Law Campus PS_2785 Catalogue Term 202430',
    'Accounting and Laws Program Requirements INCOMPLETE', 'Credit points required: 400 Credit points applied: 200 Catalogue Term: 2024 AUTUMN',
    'Fundamentals of Australian Law LAWS 1003 Fundamentals of Australian Law C 10 2024 Autumn, SC 1,', 'WSTC T1',
    'Legal Analysis and Critique LAWS 1009 Legal Analysis and Critique D 10 2024 Spring',
    'Accounting Information Systems ACCT 3001 Accounting Information Systems NA (10) 2026 Spring',
    'The Accountant as a Consultant ACCT 3011 The Accountant as a Consultant NA (10) 2026 Spring',
    'Government and Public Law LAWS 2008 Government and Public Law NA (10) 2026 Spring',
    'Alternate Accounting Subjects LAWS 3067 Self-Managed Superannuation and Trusts NA (10) 2026 Spring',
    'Equity & Trusts Still needed: 10 Credit Points in LAWS 3018',
    'Professional Responsibility and Legal Ethics Still needed: 10 Credit Points in LAWS 2015',
    'Property Law Still needed: 10 Credit Points in LAWS 3082',
    'Still needed: 10 Credit Points in LAWS 3081', 'Still needed: 10 Credit Points in LAWS 3045',
    'Still needed: 10 Credit Points in LAWS 4013', 'Still needed: 10 Credit Points in LAWS 4015',
    'Still needed: 10 Credit Points in LAWS 4014', 'Still needed: 10 Credit Points in LAWS 4004',
    'Laws Alternate Pool Still needed: 60 Credit Points in LAWS 2005 or 2007 or 3001 or 3002 or', '3023 or 4010 or 4017',
    'Alternate Accounting Still needed: 10 Credit Points in FINC 3004 or 3006 or 3014',
    'Not Currently Applied NOAW 0004 Academic Integrity Module S 0 2024 Autumn, SC 1, WSTC T1',
    'Ellucian Degree Works - Copyright 1995-2026 Ellucian Company L.P.',
  ];
  const NEVER = ['LAWS 1010', 'LAWS 2018', 'FINC 2003', 'LAWS 2019', 'LAWS 3099', 'LAWS 3101', 'LAWS 3102'];
  // a student who started before 2027 is suggested the pre-2027 subjects while they are still offered
  const CORES = ['LAWS 2015', 'LAWS 3018', 'LAWS 3082', 'LAWS 3081', 'LAWS 3045', 'LAWS 4015', 'LAWS 4004', 'LAWS 4014', 'LAWS 4013'];
  const read = async (lines, name) => pr.evaluate(([l, now, n]) => WSLSA.importPdfLines(l, now, n), [lines, NOW, name]);
  const prPlan = () => pr.evaluate(() => {
    const c = WSLSA.context();
    const p = WSLSA.custom();
    return { cohort: p.cohort || (p.start && p.start < 2027 ? 'pre2027' : '2027'), stored: p.cohort, start: p.start, cp: c.plan.cp, total: c.totalCP, done: c.doneCP, slots: c.slots.map(s => ({ code: s.pending ? '' : s.code, y: s.year, s: s.session, done: s.done, kind: s.typeLabel, o: p.slots[+s.id.slice(1)].o, cp: s.cp, note: (document.querySelector('#slot-' + s.id + ' .flag-legacy') || {}).textContent || '' })) };
  });
  const term = x => (2023 + x.y) + ' ' + x.s;
  await pr.click('[data-action="progress-open"]');
  check(await pr.$eval('#progress-file', i => i.multiple), 'Import my progress should take several files at once');
  await read(RESULTS, 'results.pdf');
  const one = await pr.innerText('#progress-results');
  check(/Read your Subject Results page/.test(await pr.textContent('#progress-status')) && /Add another PDF/.test(await pr.textContent('#progress-choose')), 'after one file it should offer to add another');
  check(await pr.isChecked('#pp-cohort-pre2027') && /Pre-2027 Handbook \(160 CP Law Core \+ 80 CP LLB Alternates\) \(from your record: started 2024\)/.test(one) && /2027 Handbook \(190 CP Law Core \+ 50 CP LLB Alternates\)/.test(one), `a 2024 start should select the pre-2027 structure, got ${one.replace(/\n+/g, ' | ').slice(0, 300)}`);
  check(!(await pr.$('#pp-inprogress')) && /20\s*Completed/.test(one) && /does not list what you still need/.test(one) && !/NOAW/.test(one), 'a results page alone has no subjects in progress, and the 0 CP module is left out');
  await read(AUDIT, 'audit.pdf');
  const both = await pr.innerText('#progress-results');
  check(/Read 2 files \(Subject Results page and Degree Works audit\)/.test(await pr.textContent('#progress-status')) && /Read together: results\.pdf \(Subject Results page\), audit\.pdf \(Degree Works audit\)/.test(both), `the second file should be read with the first, got "${await pr.textContent('#progress-status')}"`);
  check(/20\s*Completed\s*200 CP/.test(both) && /4\s*In progress\s*40 CP/.test(both) && /16\s*Still to plan\s*160 CP/.test(both), `the counts should merge without repeats, got ${both.replace(/\n+/g, ' | ').slice(0, 400)}`);
  check(await pr.$$eval('.pp-badge', b => b.map(x => x.textContent).join('|')) === Array(4).fill('In Progress (2026 Spring)').join('|'), 'each subject in progress should carry its session');
  check(await pr.isChecked('#pp-inprogress') && (await pr.textContent('label.check-row:has(#pp-inprogress)')).trim() === 'Mark In-Progress subjects as completed/enrolled in their session', 'the in-progress option should be on by default');
  check(/LAWS 1009 for LAWS 1010/.test(both) && /LAWS 2004 for LAWS 2018/.test(both) && /LAWS 2001 for LAWS 3101/.test(both) && /ECON 2002 for FINC 2003/.test(both), 'the preview should say which subjects count for their 2027 replacements');
  check(/Still needed from before 2027[^.]*LAWS 2015 \(last offered 2028\)/.test(both) && /LAWS 4004 \(last offered 2029\)/.test(both) && /LAWS 4013 \(last offered 2029\)/.test(both) && !/LAWS 2020 for LAWS 2015/.test(both) && /Still needed lists in your audit/.test(both), 'the preview should name the pre-2027 subjects still needed, under their own codes');
  await pr.click('#progress-apply');
  const imported = await prPlan();
  const pg = await pr.evaluate(() => WSLSA.guide());
  check(imported.cohort === 'pre2027' && imported.start === 2024 && imported.total === 240 && imported.done === 240 && pg.cp === 160, `the plan should hold only the 240 CP done or in progress, with 160 CP in the guide, got ${imported.total} and ${pg.cp} (${imported.cohort})`);
  check(!imported.slots.concat(pg.items).some(x => NEVER.indexOf(x.code) >= 0), `neither the plan nor the guide should hold any of ${NEVER.join(', ')}`);
  check(JSON.stringify(pg.items.filter(x => x.code).map(x => x.code).sort()) === JSON.stringify(CORES.slice().sort()) && pg.items.filter(x => x.kind === 'law').length === 9, `the guide should list the nine Law core subjects, got ${pg.items.map(x => x.code || x.kind).join(' ')}`);
  check(pg.items.filter(x => x.kind === 'llb').length === 6 && pg.items.filter(x => x.kind === 'choice').length === 1, `the guide should list six LLB Alternate slots and one Alternate Accounting choice, got ${pg.items.filter(x => !x.code).map(x => x.kind).join(', ')}`);
  check(Array.from(new Set(pg.items.map(term))).join(', ') === '2027 Autumn, 2027 Spring, 2028 Autumn, 2028 Spring', `the guide should suggest Autumn 2027 to Spring 2028, got ${Array.from(new Set(pg.items.map(term))).join(', ')}`);
  const panel = await pr.innerText('#guide');
  check(/Suggested Remaining Guide/i.test(panel) && /160 CP to place/.test(panel) && /9 Law core subjects/.test(panel) && /6 LLB Alternate slots/.test(panel) && /Already counted, so not listed again: .*LAWS 1009 for LAWS 1010/.test(panel) && /Pre-2027 subject · last offered 2028 · after that, LAWS 2020/.test(panel), `the guide should sum up what is left, got ${panel.replace(/\n+/g, ' | ').slice(0, 300)}`);
  check((await pr.$$('#grid .year')).length === 5 && (await pr.$$('#grid .slot-empty')).length === 4 && /nothing planned yet/.test(await pr.textContent('#next')) && /following the guide/.test(await pr.textContent('.hp-finish')), 'Years 4 and 5 should be shown empty and ready to fill, with the finish following the guide');
  // one subject from the guide into a session of the student's choosing, then the rest in one step
  const firstItem = pg.items[0];
  await pr.selectOption('#gi-0', '5|Spring');
  await pr.click('[data-action="guide-add"][data-gi="0"]');
  check(await pr.evaluate(c => WSLSA.custom().slots.some(x => x.code === c && x.y === 5 && x.s === 'Spring' && !x.done), firstItem.code) && (await pr.evaluate(() => WSLSA.guide().items.length)) === 15, 'adding one subject from the guide should place it where chosen and take it off the list');
  await pr.click('#section-tools [data-action="undo"]');
  check((await pr.evaluate(() => WSLSA.guide().items.length)) === 16, 'Undo should put it back in the guide');
  await pr.click('[data-action="guide-fill"]');
  const pre = await prPlan();
  const rest = pre.slots.filter(x => !x.done);
  check(!(await pr.evaluate(() => WSLSA.guide())) && await pr.isHidden('#guide') && pre.total === 400 && rest.reduce((a, x) => a + x.cp, 0) === 160, `filling from the guide should place the 160 CP, got ${pre.total}`);
  check(!pre.slots.some(x => NEVER.indexOf(x.code) >= 0), `the plan should hold none of ${NEVER.join(', ')}, got ${pre.slots.filter(x => NEVER.indexOf(x.code) >= 0).map(x => x.code)}`);
  check(JSON.stringify(rest.filter(x => x.code).map(x => x.code).sort()) === JSON.stringify(CORES.slice().sort()), `what is left should be the nine Law core subjects, got ${rest.filter(x => x.code).map(x => x.code).join(' ')}`);
  check(rest.filter(x => !x.code && x.kind === 'LLB Alternate').length === 6 && rest.filter(x => !x.code && x.kind !== 'LLB Alternate').length === 1, `six open LLB Alternate slots and one Alternate Accounting choice should be left, got ${rest.filter(x => !x.code).map(x => x.kind || 'open').join(', ')}`);
  check(Array.from(new Set(rest.map(term))).join(', ') === '2027 Autumn, 2027 Spring, 2028 Autumn, 2028 Spring' && rest.every(x => x.s !== 'Summer'), `the rest should run from Autumn 2027 to Spring 2028, got ${Array.from(new Set(rest.map(term))).join(', ')}`);
  const super_ = pre.slots.find(x => x.code === 'LAWS 3067');
  check(super_ && super_.done && term(super_) === '2026 Spring' && /^3S[34]$/.test(super_.o) && super_.kind !== 'LLB Alternate', `LAWS 3067 should fill an Alternate Accounting choice before an LLB Alternate slot, got ${JSON.stringify(super_)}`);
  check(pre.slots.find(x => x.code === 'LAWS 2015').note === 'Pre-2027 subject' && /Pre-2027 subject/.test(pre.slots.find(x => x.code === 'LAWS 4004').note) && !pre.slots.find(x => x.code === 'LAWS 3018').note && !pre.slots.some(x => ['LAWS 2020', 'LAWS 3100', 'LAWS 3103'].indexOf(x.code) >= 0), 'a pre-2027 subject placed from the guide should keep its own code and say so');
  check(['LAWS 1009', 'ECON 2002', 'ACCT 3001', 'LAWS 2008'].every(c => { const x = pre.slots.find(y => y.code === c); return x && x.done; }) && term(pre.slots.find(x => x.code === 'ACCT 3001')) === '2026 Spring', 'history should keep its sessions, with subjects in progress enrolled');
  // a returning student opens the page with that plan saved
  await pr.reload();
  const reopened = await pr.evaluate(() => window.WSLSA ? { mode: WSLSA.state().mode, start: WSLSA.custom() && WSLSA.custom().start, cards: document.querySelectorAll('#grid .subj').length } : null);
  check(!!reopened && reopened.mode === 'custom' && reopened.start === 2024 && reopened.cards === pre.slots.length && pr.errors.length === 0, `the page should open with a saved plan that has past years, got ${JSON.stringify(reopened)} ${pr.errors.join('; ')}`);
  check(JSON.stringify(await prPlan()) === JSON.stringify(pre), 'reopening the page should keep the plan as it was');
  // either code of a pair meets the general order: LAWS 1009 is Usually first for a later Law subject
  const eqId = await pr.evaluate(() => WSLSA.context().slots.find(s => s.code === 'LAWS 3018').id);
  await pr.click(`#slot-${eqId} .chain-btn`);
  const firsts = await pr.$$eval('[data-xray="Usually first"]', e => e.map(x => x.querySelector('code') ? x.querySelector('code').textContent : x.dataset.slot));
  const legal = await pr.evaluate(() => WSLSA.context().slots.find(s => s.code === 'LAWS 1009').id);
  check(await pr.$eval(`#slot-${legal}`, e => e.getAttribute('data-xray')) === 'Usually first', `LAWS 1009 should count as LAWS 1010 in the general order, got ${JSON.stringify(firsts)}`);
  await pr.keyboard.press('Escape');
  // the same files with subjects in progress left open
  await pr.click('[data-action="progress-open"]');
  await read(RESULTS, 'results.pdf');
  await read(AUDIT, 'audit.pdf');
  await pr.clickRaw('#pp-inprogress');
  check(/4\s*In progress/.test(await pr.innerText('#progress-results')) && !(await pr.isChecked('#pp-inprogress')), 'unticking the option should keep the preview');
  await pr.click('#progress-apply');
  const open = await prPlan();
  check(open.done === 200 && ['ACCT 3001', 'ACCT 3011', 'LAWS 2008', 'LAWS 3067'].every(c => { const x = open.slots.find(y => y.code === c); return x && !x.done && term(x) === '2026 Spring'; }), `subjects in progress should stay in Spring 2026 without a tick, got ${open.done} CP done`);
  // the 2027 structure, chosen by hand: the audit's lists are set aside and the 2027 pathway fills the rest
  await pr.click('[data-action="progress-open"]');
  await read(AUDIT, 'audit.pdf');
  await read(RESULTS, 'results.pdf');
  await pr.clickRaw('#pp-cohort-2027');
  const as2027 = await pr.innerText('#progress-results');
  check(await pr.isChecked('#pp-cohort-2027') && /under the pre-2027 structure, so with the structure chosen here the rest follows the WSLSA 2027 pathway/.test(as2027), 'choosing the 2027 structure should say the audit lists are set aside');
  await pr.click('#progress-apply');
  const neu = await prPlan();
  const ng = await pr.evaluate(() => WSLSA.guide());
  check(neu.cohort === '2027' && neu.stored === '2027' && neu.total + ng.cp === 400 && ['LAWS 2019', 'LAWS 3099', 'LAWS 3102'].every(c => ng.items.some(x => x.code === c)) && !neu.slots.concat(ng.items).some(x => ['LAWS 1010', 'LAWS 2018', 'FINC 2003', 'LAWS 3101'].indexOf(x.code) >= 0), `the 2027 structure should add its three new cores and still count the pre-2027 passes, got ${ng.items.map(x => x.code || '[' + x.kind + ']').join(' ')}`);
  check(ng.items.filter(x => x.kind === 'llb').length === 3 && !/Replaces pre-2027/.test(await pr.innerText('#guide')), 'the 2027 structure should leave three LLB Alternate slots and no replacement notes');
  // Re-Pace switches the structure both ways
  await pr.clickRaw('[data-action="repace-open"]');
  check(await pr.isChecked('#rp-cohort-2027') && /Cohort Structure/.test(await pr.textContent('#rp-form')), 'Re-Pace should show the plan\'s structure');
  await pr.clickRaw('#rp-cohort-pre2027');
  check(/Pre-2027 structure: LAWS 2019, LAWS 3099, LAWS 3102 become LLB Alternate slots/.test(await pr.textContent('#rp-preview')), `Re-Pace should say what the pre-2027 structure changes, got ${(await pr.textContent('#rp-preview')).slice(0, 240)}`);
  await pr.clickRaw('#rp-apply');
  await pr.waitForFunction(() => !document.getElementById('rp-form'));
  const repaced = await prPlan();
  check(repaced.cohort === 'pre2027' && !repaced.slots.some(x => ['LAWS 2019', 'LAWS 3099', 'LAWS 3102'].indexOf(x.code) >= 0) && repaced.slots.filter(x => !x.done && !x.code && x.kind === 'LLB Alternate').length === 6 && repaced.total === 400, `Re-Pace to the pre-2027 structure should turn the three cores into LLB Alternate slots, got ${repaced.slots.filter(x => !x.done).map(x => x.code || '[' + x.kind + ']').join(' ')}`);
  await pr.clickRaw('[data-action="repace-open"]');
  await pr.clickRaw('#rp-cohort-2027');
  check(/2027 structure: LAWS 2019, LAWS 3099, LAWS 3102 take the place of open LLB Alternate slots/.test(await pr.textContent('#rp-preview')), `Re-Pace back to the 2027 structure should bring the three cores back, got ${(await pr.textContent('#rp-preview')).slice(0, 240)}`);
  await pr.keyboard.press('Escape');
  // the plan setup: the structure follows the year started, and a 2027 pathway copied in is changed to match
  await pr.evaluate(() => localStorage.clear());
  await pr.reload();
  await pr.evaluate(() => WSLSA.select('2785|BASE'));
  await pr.click('[data-action="custom-from-current"]');
  check(await pr.isChecked('#cs-cohort-2027'), 'a plan that starts in 2027 should default to the 2027 structure');
  await pr.selectOption('#cs-year', '2025');
  check(await pr.isChecked('#cs-cohort-pre2027'), 'a 2025 start should switch the setup to the pre-2027 structure');
  await pr.click('button[type=submit][form=setup-form]');
  const built = await prPlan();
  check(built.cohort === 'pre2027' && built.start === 2025 && !built.slots.some(x => ['LAWS 2019', 'LAWS 3099', 'LAWS 3102'].indexOf(x.code) >= 0) && built.slots.filter(x => !x.code && x.kind === 'LLB Alternate').length === 8 && built.total === 400, `a 2027 pathway copied in for a 2025 start should have 8 LLB Alternate slots, got ${built.slots.filter(x => !x.code).length} open`);
  await pr.click('[data-action="custom-setup"]');
  check(await pr.isChecked('#cs-cohort-pre2027'), 'editing the plan should show its structure');
  await pr.clickRaw('#cs-cohort-2027');
  await pr.click('button[type=submit][form=setup-form]');
  const kept = await prPlan();
  check(kept.cohort === '2027' && kept.stored === '2027' && ['LAWS 2019', 'LAWS 3099', 'LAWS 3102'].every(c => kept.slots.some(x => x.code === c)) && kept.slots.filter(x => !x.code && x.kind === 'LLB Alternate').length === 5, 'keeping the plan under the 2027 structure should bring the three cores back');
  // Tick off from my results: Still needed lists, lists of options and 0 CP modules are left out, a subject in
  // progress is marked, a pre-2027 subject ticks its 2027 replacement, and a record for another degree is offered
  await pr.evaluate(() => WSLSA.select('2848|BASE'));
  await pr.click('[data-action="import-open"]');
  await pr.fill('#import-text', ['2785 - Bachelor of Accounting/Bachelor of Laws', 'LAWS 1009 Legal Analysis and Critique D 10 2024 Spring', 'LAWS 2008 Government and Public Law NA (10) 2026 Spring',
    'Equity & Trusts Still needed: 10 Credit Points in LAWS 3018', 'Still needed: 20 Credit Points in LAWS 2005 or 2007 or', 'LAWS 3001 or 3002', 'Choose LAWS 3023 or LAWS 4010', 'NOAW 0004 Academic Integrity Module S 0 2024 Autumn', 'LAWS 1003, LAWS 2003'].join('\n'));
  await pr.waitForTimeout(100);
  const pasted = await pr.$$eval('.import-row', rs => rs.map(r => r.querySelector('code').textContent + (r.querySelector('input').checked ? '+' : '-') + (/In progress/.test(r.textContent) ? ' progress' : '') + (/counts for LAWS 1010/.test(r.textContent) ? ' counts' : '')));
  check(JSON.stringify(pasted) === JSON.stringify(['LAWS 1009+ counts', 'LAWS 2008+ progress', 'LAWS 1003+', 'LAWS 2003+']), `pasted results should skip lists and modules and match equivalents, got ${JSON.stringify(pasted)}`);
  check(!/LAWS 3018|LAWS 3001|LAWS 3023|LAWS 4010|NOAW/.test(await pr.textContent('#import-results')) && /This record is for/.test(await pr.textContent('#import-results')), 'nothing from a list should be offered, and the record\'s degree should be named');
  await pr.click('[data-action="import-degree"]');
  check(await pr.evaluate(() => WSLSA.state().degree) === '2785' && !(await pr.$('[data-action="import-degree"]')) && !!(await pr.$('#import-text')), 'matching the record to its degree should switch the guide and keep the window open');
  await pr.click('#import-apply');
  check(await pr.evaluate(() => ['LAWS 1010', 'LAWS 2008', 'LAWS 1003', 'LAWS 2003'].every(c => WSLSA.context().slots.find(s => s.code === c).done)), 'applying should tick LAWS 1010 for LAWS 1009 and the subject in progress');
  check(pr.errors.length === 0, 'pre-2027 import console errors: ' + pr.errors.join('; '));
  await pr.close();
  }

  // ---------------------------------------------------------------- every pathway in the pre-2027 structure, edited in place
  {
  const ed = await newPage(browser, { viewport: { width: 1440, height: 1100 } });
  ed.on('dialog', d => d.accept());
  await ed.goto(APP);
  await ed.evaluate(() => { localStorage.clear(); WSLSA.setNow('2026-11-09'); WSLSA.select('2785|BASE'); });
  const opts = await ed.$$eval('#sel-cohort option', o => o.map(x => x.value + '=' + x.textContent));
  check(JSON.stringify(opts) === JSON.stringify(['2027=2027 Handbook', 'pre2027=Pre-2027 Handbook']) && await ed.$eval('#sel-cohort', s => s.value) === '2027' && await ed.$eval('label[for="sel-cohort"]', l => l.textContent) === 'Handbook', `the dock should offer the Handbook structure, got ${JSON.stringify(opts)}`);
  // the pre-2027 structure as a live view of the pathway: no LAWS 1010 and none of the 2027-only cores
  await ed.selectOption('#sel-cohort', 'pre2027');
  const view = await ed.evaluate(() => {
    const c = WSLSA.context();
    const law = c.slots.filter(s => !s.pending && /^LAWS /.test(s.code) && (s.kind === 'fixed'));
    return { custom: c.custom, codes: c.slots.filter(s => !s.pending).map(s => s.code), lawCP: law.reduce((a, s) => a + s.cp, 0), llb: c.slots.filter(s => s.kind === 'llb').reduce((a, s) => a + s.cp, 0), notes: Array.from(document.querySelectorAll('#grid .flag-legacy')).map(f => f.textContent), stand: Array.from(document.querySelectorAll('#grid .flag-legacy')).filter(f => /^In place of LAWS (2019|3099|3102)$/.test(f.textContent)).length, badge: !!document.querySelector('.pbadge-pre') };
  });
  // every session of a pathway is in 2027 or later, so each subject shows the code a student enrols in, and says what it replaces
  check(!view.custom && ['LAWS 1009', 'LAWS 2004', 'LAWS 2001', 'LAWS 2019', 'LAWS 3099', 'LAWS 3102'].every(c => view.codes.indexOf(c) < 0) && ['LAWS 1010', 'LAWS 2018', 'LAWS 3101', 'LAWS 2020', 'LAWS 3100', 'LAWS 3103'].every(c => view.codes.indexOf(c) >= 0) && view.stand === 3, `the pre-2027 view should show the 2027 codes to enrol in and none of the 2027-only cores, got ${view.codes.join(' ')}`);
  check(view.lawCP === 160 && view.llb === 80 && view.badge, `the pre-2027 view should have 160 CP of Law core and 80 CP of LLB Alternates, got ${view.lawCP} and ${view.llb}`);
  check(['LAWS 1009', 'LAWS 2004', 'LAWS 2001', 'LAWS 2015', 'LAWS 4004', 'LAWS 4013', 'ECON 2002'].every(c => view.notes.indexOf('Replaces Pre-2027 ' + c) >= 0), `the pre-2027 subjects should say what they stand for, got ${view.notes.join(' | ')}`);
  // an LLB Alternate chosen in the place of a 2027-only core is kept, and the view travels in a link
  const stand = await ed.evaluate(() => WSLSA.context().slots.find(s => s.newCore).id);
  await ed.click(`#slot-${stand} [data-action="picker-open"]`);
  await ed.fill('#pick-q', 'LAWS 4010');
  await ed.click('#pick-results [data-action="pick"][data-code="LAWS 4010"]');
  check(await ed.evaluate(id => WSLSA.context().byId[id].code === 'LAWS 4010' && !WSLSA.context().custom, stand), 'an LLB Alternate should go in the place of a 2027-only core without copying the pathway');
  const preLink = await ed.evaluate(() => WSLSA.linkText());
  check(/^2785\/co=p\//.test(preLink), `a link should carry the pre-2027 view, got ${preLink}`);
  await ed.reload();
  check(await ed.evaluate(id => WSLSA.context().byId[id].code === 'LAWS 4010' && document.getElementById('sel-cohort').value === 'pre2027', stand), 'the pre-2027 view and its choice should survive a reload');
  // Move ▾ on any card: every session, marked by whether the subject runs there, and the edited copy in place
  const torts = await ed.evaluate(() => WSLSA.context().slots.find(s => s.code === 'LAWS 2013').id);
  check((await ed.$$(`#slot-${torts} .move-sel option`)).length === 1, 'a card should not build its list of sessions until Move to is used');
  await ed.focus(`#slot-${torts} .move-sel`);
  const moveOpts = await ed.$$eval(`#slot-${torts} .move-sel option`, o => o.map(x => x.textContent + (x.disabled ? ' [off]' : '')));
  check(moveOpts[0] === 'Move to' && moveOpts.some(t => /^Year 1 · Spring · 40 CP \(here\) \[off\]$/.test(t)) && moveOpts.some(t => /^Year 2 · Spring · 40 CP  ✓ Offered$/.test(t)) && moveOpts.some(t => /^Year 2 · Autumn · 40 CP  ⚠ Check offering$/.test(t)) && moveOpts.some(t => /^\+ New Year 6 · Autumn/.test(t)), `Move should list every session with its offering, got ${moveOpts.slice(0, 8).join(' | ')}`);
  await ed.selectOption(`#slot-${torts} .move-sel`, '2|Autumn');
  const after = await ed.evaluate(() => { const c = WSLSA.context(); const s = c.slots.find(x => x.code === 'LAWS 2013'); return { edit: c.edit, mode: WSLSA.state().mode, at: s.year + s.session, deg: document.getElementById('sel-degree').value, kicker: document.getElementById('section-kicker').textContent, badge: !!document.querySelector('.pbadge-edit'), pick: c.slots.some(x => x.code === 'LAWS 4010'), pre: !c.slots.some(x => x.code === 'LAWS 2019') && document.getElementById('sel-cohort').value === 'pre2027' }; });
  check(after.edit === '2785|BASE' && after.mode === 'guide' && after.at === '2Autumn' && after.deg === '2785' && /Your edited pathway/.test(after.kicker) && after.badge && after.pick && after.pre, `moving a card should edit the pathway in place, keeping its choices and structure, got ${JSON.stringify(after)}`);
  check(/LAWS 2013 moved to Year 2 Autumn\. Check: Not offered in Autumn/.test(await ed.textContent('#toast')), `moving to a session it does not run in should be allowed and say so, got ${await ed.textContent('#toast')}`);
  await ed.click('#section-tools [data-action="undo"]');
  check(await ed.evaluate(() => !WSLSA.context().edit && !WSLSA.context().custom && WSLSA.context().slots.some(s => s.code === 'LAWS 4010')), 'Undo should give back the pathway as it was');
  // Change / Replace on a core card: closing the window changes nothing, choosing replaces the subject
  const crim = await ed.evaluate(() => WSLSA.context().slots.find(s => s.code === 'LAWS 2018').id);
  await ed.click(`#slot-${crim} [data-action="change-open"]`);
  check(!!(await ed.$('#pick-q')) && /Change or move this subject/.test(await ed.textContent('#picker-h')), 'Change / Replace should open the subject picker');
  await ed.keyboard.press('Escape');
  check(await ed.evaluate(() => !WSLSA.context().edit), 'closing the picker without a change should leave the pathway as it was');
  await ed.click(`#slot-${crim} [data-action="change-open"]`);
  await ed.fill('#pick-q', 'LAWS 2004');
  await ed.click('#pick-results [data-action="cpick"][data-code="LAWS 2004"]');
  check(await ed.evaluate(() => WSLSA.context().edit === '2785|BASE' && WSLSA.context().slots.some(s => s.code === 'LAWS 2004') && !WSLSA.context().slots.some(s => s.code === 'LAWS 2018')), 'choosing a subject should replace the card in the edited pathway');
  // Remove ×, + Add slot with the pathway's kinds, + Add a year, then Reset to Default Sequence keeps ticks
  await ed.click(`#slot-${await ed.evaluate(() => WSLSA.context().slots.find(s => s.code === 'LAWS 1003').id)} .tick`);
  const consult = await ed.evaluate(() => WSLSA.context().slots.find(s => s.code === 'ACCT 3011').id);
  await ed.click(`#slot-${consult} [data-action="cremove"]`);
  check(await ed.evaluate(() => !WSLSA.context().slots.some(s => s.code === 'ACCT 3011')) && /Removed the Year 3 Autumn slot \(ACCT 3011\)/.test(await ed.textContent('#toast')), 'Remove should take the card out');
  const kinds = await ed.$$eval('#year-3 .session[data-s="Autumn"] .add-menu [data-action="cadd"]', b => b.map(x => x.textContent));
  check(JSON.stringify(kinds) === JSON.stringify(['Subject slot (any WSU subject)', 'LLB Alternate slot', 'Choice: Alternate Accounting subject']), `+ Add slot should offer the pathway's kinds of slot, got ${JSON.stringify(kinds)}`);
  await ed.click('#year-3 .session[data-s="Autumn"] [data-action="cadd"][data-o]');
  check(await ed.evaluate(() => WSLSA.context().slots.some(s => s.year === 3 && s.session === 'Autumn' && s.pending && s.orig && s.orig.kind === 'llb')), 'an LLB Alternate slot should be added to Year 3 Autumn');
  await ed.click('[data-action="cyear"]');
  check(await ed.evaluate(() => WSLSA.context().slots.filter(s => s.year === 6).length) === 8, '+ Add a year should add Year 6 with open slots');
  await ed.click('[data-action="reset-sequence"]');
  const reset = await ed.evaluate(() => { const c = WSLSA.context(); return { edit: c.edit, custom: c.custom, done: c.slots.filter(s => s.done).map(s => s.code), years: Math.max.apply(null, c.slots.map(s => s.year)), cohort: document.getElementById('sel-cohort').value, back: c.slots.some(s => s.code === 'ACCT 3011') && c.slots.some(s => s.code === 'LAWS 2018') && !c.slots.some(s => s.code === 'LAWS 2004') }; });
  check(!reset.edit && !reset.custom && JSON.stringify(reset.done) === JSON.stringify(['LAWS 1003']) && reset.years === 5 && reset.cohort === 'pre2027' && reset.back, `Reset to Default Sequence should put the pathway back, keeping its ticks and structure, got ${JSON.stringify(reset)}`);
  // the 2027 structure again: LAWS 1010 and the 2027 cores come back
  await ed.selectOption('#sel-cohort', '2027');
  check(await ed.evaluate(() => ['LAWS 1010', 'LAWS 2019', 'LAWS 3099', 'LAWS 3102'].every(c => WSLSA.context().slots.some(s => s.code === c))), 'the 2027 structure should show the 2027 subjects again');
  check(ed.errors.length === 0, 'edit in place console errors: ' + ed.errors.join('; '));
  await ed.close();
  }

  // ---------------------------------------------------------------- reading records: split terms, a missing term, pasted MySR text, and the guide
  {
  const rd = await newPage(browser, { viewport: { width: 1440, height: 1300 } });
  await rd.goto(APP);
  await rd.evaluate(() => { localStorage.clear(); WSLSA.select('2848|BASE'); });
  const NOW2 = '2026-11-09T10:00:00';
  // the term split across cells, with the session at the end of the row, and table cells copied with bars and tabs
  await rd.click('[data-action="progress-open"]');
  await rd.evaluate(([l, now]) => WSLSA.importPdfLines(l, now, 'results.pdf'), [[
    'Subject Results', '2848 - Bachelor of Laws',
    '2024 LAWS1003 Fundamentals of Australian Law D 77 10 ✓ Autumn',
    '2024 | LAWS2004 | Criminal Law | D | 77 | 10 | ✓ | Autumn',
    'LAWS1009 Legal Analysis and Critique C 65 10',
    '2025\tLAWS2003\tContracts\tH\t89\t10\t✓\tSpring',
    'Total Credit Points Required 320',
  ], NOW2]);
  await rd.click('#progress-apply');
  const terms = await rd.evaluate(() => WSLSA.custom().slots.map(x => x.code + '@' + x.y + x.s).join(' '));
  check(terms === 'LAWS 1003@1Autumn LAWS 2004@1Autumn LAWS 1009@1Autumn LAWS 2003@2Spring', `terms split across cells should be read, and a row without one should take the nearest, got ${terms}`);
  // a record with no terms at all goes in Year 1, and says so
  await rd.click('[data-action="progress-open"]');
  await rd.evaluate(([l, now]) => WSLSA.importPdfLines(l, now, 'list.pdf'), [['2848 - Bachelor of Laws', 'LAWS1003 Fundamentals of Australian Law D 77 10', 'LAWS2003 Contracts C 65 10'], NOW2]);
  check(/No session was found for LAWS 1003, LAWS 2003, so they go in Autumn 2026/.test(await rd.innerText('#progress-results')), `subjects with no session should be kept, in Year 1, got ${(await rd.innerText('#progress-results')).replace(/\n+/g, ' | ').slice(0, 300)}`);
  await rd.keyboard.press('Escape');
  // results pasted from MySR, read the same way
  await rd.click('[data-action="progress-open"]');
  await rd.click('#progress-paste-box summary');
  await rd.fill('#progress-text', ['Term\tSubject\tTitle\tGrade\tMark\tCredit Points', '2024\tAutumn\tLAWS1003\tFundamentals of Australian Law\tD\t77\t10', '2024\tSpring\tLAWS2013\tTorts Law\tC\t66\t10', '2025\tAutumn\tLAWS2003\tContracts\tNA\t(10)'].join('\n'));
  await rd.click('[data-action="progress-paste"]');
  const pasted = await rd.innerText('#progress-results');
  check(/Read your pasted results/.test(await rd.textContent('#progress-status')) && /2\s*Completed/.test(pasted) && /1\s*In progress/.test(pasted) && /does not name its degree, so your plan follows 2848 Bachelor of Laws, the degree on screen/.test(pasted), `pasted MySR results should be read like a PDF, got ${(await rd.textContent('#progress-status'))} ${pasted.replace(/\n+/g, ' | ').slice(0, 200)}`);
  await rd.click('#progress-apply');
  const g = await rd.evaluate(() => WSLSA.guide());
  check(!!g && g.items.length > 0 && (await rd.$$('#grid .year')).length >= 4, 'the pasted record should build a plan with a guide and its years ahead');
  // a guide item dragged onto a session ahead in the plan, with both on screen
  await rd.setViewportSize({ width: 1440, height: 4200 });
  await rd.evaluate(() => window.scrollTo(0, 0));
  const code = await rd.$eval('.guide-item', e => e.querySelector('code') ? e.querySelector('code').textContent : '');
  const src = await (await rd.$('.guide-item')).boundingBox();
  await rd.mouse.move(src.x + 20, src.y + 10);
  await rd.mouse.down();
  await rd.mouse.move(src.x + 40, src.y + 30, { steps: 4 });
  await rd.waitForTimeout(120);
  const zone = await (await rd.$('#year-4 .session[data-s="Spring"] .session-head')).boundingBox();
  await rd.mouse.move(zone.x + 30, zone.y + 8, { steps: 6 });
  await rd.mouse.move(zone.x + 34, zone.y + 9);
  await rd.waitForTimeout(80);
  const marked = await rd.evaluate(() => document.querySelector('#year-4 .session[data-s="Spring"]').className);
  await rd.mouse.up();
  const placed = await rd.evaluate(c => WSLSA.custom().slots.some(x => x.code === c && x.y === 4 && x.s === 'Spring'), code);
  check(/drop-(ok|warn)/.test(marked) && placed && !(await rd.evaluate(c => WSLSA.guide() && WSLSA.guide().items.some(x => x.code === c), code)), `dragging ${code} from the guide onto a session should place it there, got ${marked}`);
  await rd.setViewportSize({ width: 1440, height: 1300 });
  // Re-Pace lays out what the guide still lists
  await rd.clickRaw('[data-action="repace-open"]');
  check(/Remaining \d+ CP/.test(await rd.textContent('.rp-summary')) && await rd.isEnabled('#rp-apply'), `Re-Pace should lay out the guide's subjects, got ${await rd.textContent('.rp-summary')}`);
  await rd.clickRaw('#rp-apply');
  await rd.waitForFunction(() => !document.getElementById('rp-form'));
  check(await rd.evaluate(() => !WSLSA.guide() && WSLSA.context().totalCP >= 320), 'applying Re-Pace should place everything the guide listed');
  check(rd.errors.length === 0, 'reading records console errors: ' + rd.errors.join('; '));
  await rd.close();
  }

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
  check((await ux.$$('.subj[draggable="true"]')).length === 40, 'every card in a WSLSA pathway should be draggable');
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
  check(await ux.evaluate(() => WSLSA.context().edit === '2785|BASE' && WSLSA.state().mode === 'guide'), 'the drop should make the pathway its edited copy, in place');
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
    check(await pt.evaluate(() => WSLSA.context().edit === '2785|BASE' && WSLSA.custom().tpl === '2785|BASE' && WSLSA.state().mode === 'guide'), 'deferring on a pathway should make its edited copy, in place');
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
    // each pathway keeps its own edited copy: editing another one leaves this one as it is, with nothing to confirm
    const edit2785 = await pt.evaluate(() => JSON.stringify(WSLSA.custom()));
    await pt.evaluate(() => { WSLSA.select('2848|BASE'); });
    await pt.click(`#slot-${await idOf('LAWS 1003')} [data-action="defer"]`);
    check(await pt.evaluate(() => WSLSA.context().edit === '2848|BASE' && WSLSA.custom().tpl === '2848|BASE'), 'deferring on another pathway should edit that pathway');
    await pt.evaluate(() => { WSLSA.select('2785|BASE'); });
    check(await pt.evaluate(() => JSON.stringify(WSLSA.custom())) === edit2785 && await pt.evaluate(() => WSLSA.context().edit === '2785|BASE'), 'the first pathway should keep its own edited copy');
    await pt.evaluate(() => { WSLSA.select('2848|BASE'); });
    await pt.click('[data-action="reset-sequence"]');
    check(await pt.evaluate(() => !WSLSA.context().edit && !WSLSA.context().custom), 'Reset to Default Sequence should put the pathway back');

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
    check(!(await an.$('#next.is-changed')) && !/LAWS 1003/.test(await an.$eval('[data-action="copy-codes"]', b => b.dataset.codes)), 'ticking within the same session should update Next to enrol without animating it');
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
      if (!el.getClientRects().length || el.matches('p a, li a, p .hero-link') || el.closest('#preview-stage')) return;
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
  check(/2026 Handbook/.test(await lay.textContent('.hero-note')) && await lay.isVisible('.hero-note') && await lay.isHidden('#enquiry-box .phase-grid'), 'the first screen should show the advice with the detail closed');
  await lay.clickRaw('.hero-note .hero-link');
  await lay.click('.enq-more > summary');
  check(await lay.isVisible('#enquiry-box .phase-grid') && await lay.isVisible('#enquiry-box .enq-to a'), 'the link should open the box, with the phase-out subjects and contact');
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
  // per-card tools are always there, and quiet until the card is in use
  const quiet = await lay.evaluate(() => { const b = document.querySelector('#grid .defer-btn'); b.closest('.subj').scrollIntoView({ block: 'center' }); return b.dataset.slot; });
  const tools = id => lay.$eval(`#slot-${id}`, c => ({ shown: getComputedStyle(c.querySelector('.subj-edit')).display !== 'none', tall: Math.round(c.getBoundingClientRect().height), open: c.querySelector('.subj-more').getAttribute('aria-expanded') }));
  let cardT = await tools(quiet);
  check(!cardT.shown && cardT.tall < 84 && cardT.open === 'false', `a card at rest should keep its tools folded away and take no room for them, got ${JSON.stringify(cardT)}`);
  await lay.click(`#slot-${quiet} .subj-more`);
  cardT = await tools(quiet);
  check(cardT.shown && cardT.open === 'true' && await lay.textContent(`#slot-${quiet} .subj-more`) === 'Done ▴' && await lay.isVisible(`#slot-${quiet} .defer-btn`), `pressing ••• should open the card's tools in place, got ${JSON.stringify(cardT)}`);
  const otherCard = await lay.evaluate(q => Array.from(document.querySelectorAll('#grid .subj-more')).map(b => b.dataset.slot).find(id => id !== q), quiet);
  await lay.focus(`#slot-${otherCard} .subj-more`);
  await lay.keyboard.press('Enter');
  check((await tools(otherCard)).shown && !(await tools(quiet)).shown, 'opening another card from the keyboard should close the first');
  await lay.keyboard.press('Enter');
  check(!(await tools(otherCard)).shown, 'pressing ••• again should fold the tools away');
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
  await lay.click('#year-5 [data-action="year-toggle"]');
  await lay.evaluate(() => { document.getElementById('advisory-box').open = true; });
  await lay.click('#advisory-box .chipbtn');
  check(await lay.isVisible('#year-5-body'), 'jumping to a subject should open its folded year');
  await lay.evaluate(() => { document.getElementById('advisory-box').open = false; window.scrollTo(0, 0); });
  await lay.click('#year-1 .session[data-s="Spring"] [data-action="session-done"]');
  check(!(await lay.$('#year-1.is-folded')), 'finishing a year should not fold it under the student');
  const doneCard = await lay.$eval('#year-1 .subj.is-done', c => ({ opacity: getComputedStyle(c).opacity, tick: getComputedStyle(c.querySelector('.tick-box')).backgroundColor, title: getComputedStyle(c.querySelector('.subj-title')).color }));
  check(doneCard.opacity === '1' && doneCard.tick === 'rgb(21, 128, 61)' && doneCard.title === 'rgb(98, 93, 96)', `a done card should stay readable with a coloured tick, got ${JSON.stringify(doneCard)}`);
  // the ticks are saved before the page is opened again
  await lay.waitForFunction(() => WSLSA.context().doneCP === 80 && /"done"/.test(localStorage.getItem('wslsa-2027-pathway-explorer:v1') || ''));
  await lay.reload();
  await lay.evaluate(() => document.fonts.ready);
  await lay.waitForSelector('#year-1');
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
  check(/carried your subjects/.test((await hist()).undoLabel), 'carrying subjects into a new degree should be named in the history');
  await hi.click(undoBtn);
  check(await hi.evaluate(() => WSLSA.state().degree) === '2785' && !(await hi.evaluate(i => WSLSA.context().byId[i].pending, openAlt)), 'undo should go back to the plan the change was made in');
  await hi.click(undoBtn);
  check(await hi.evaluate(i => WSLSA.context().byId[i].pending, openAlt), 'the next undo should take back the choice made there');
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
  const assignRows = await as.$$eval('.modal .assign-slot[data-slot]', rs => rs.map(r => ({ id: r.dataset.slot, flag: r.querySelector('.flag').textContent, ok: r.querySelector('.flag').classList.contains('flag-done') })));
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
  const extraRows = await as.$$eval('.modal .assign-slot[data-slot]', rs => rs.map(r => r.dataset.slot));
  check(extraRows.length > 0 && await as.evaluate(ids => ids.every(i => WSLSA.context().byId[i].kind === 'elective'), extraRows), 'a WSU list subject should be offered only the elective slots');
  check(/No session data/.test(await as.textContent('.modal .assign-slot[data-slot] .flag')), 'a subject with no session data should say so');
  await as.click(`.modal .assign-slot[data-slot="${extraRows[0]}"]`);
  check(await as.evaluate(i => WSLSA.context().byId[i].listSubject, extraRows[0]) && await as.evaluate(i => WSLSA.context().byId[i].code, extraRows[0]) === extraCode, 'it should go in as a WSU list subject');
  await as.selectOption('#cat-comp', '');
  // a pathway with nowhere to put it says so, and offers a way forward
  const noElective = await as.evaluate(keys => keys.find(k => { WSLSA.select(k); return !WSLSA.context().slots.some(s => s.kind === 'elective'); }), await as.evaluate(() => WSLSA.keys()));
  await as.evaluate(k => WSLSA.select(k), noElective);
  await as.selectOption('#cat-comp', '__extra__');
  await as.click('#cat-results tr.extra .assign-btn');
  check(/No open slot/.test(await as.textContent('.modal .pick-empty')) && !!(await as.$('.modal [data-action="assign-new"]')), 'a pathway with no slot for it should say so and offer a new slot');
  await as.click('.modal [data-action="assign-new"]');
  check(await as.evaluate(k => WSLSA.context().edit === k && WSLSA.custom().slots.some(x => x.code && !WSLSA.context().deg.byCode[x.code]), noElective), 'a new slot should hold it in the pathway\'s edited copy');
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
  await sw.evaluate(() => { const t = document.getElementById('year-1').getBoundingClientRect().top + scrollY; window.scrollTo(0, t - 150); });
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
  check(await paint('body') === 'rgb(17, 17, 20)' && await paint('.topbar') === 'rgb(26, 25, 30)' && /^color\(srgb 0\.10\d* 0\.09\d* 0\.11\d* \/ 0\.86\)$/.test(await paint('.dock-card')) && await paint('.year') === 'rgb(26, 25, 30)' && await paint('.drawer') === 'rgb(26, 25, 30)', 'every surface should go dark');
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
      check(await t6.textContent('[data-action="tour-next"]') === 'Finish' && !!(await t6.$('#tour .tour-clone')) && await t6.$eval('#tour .tour-clone', c => { const a = c.getBoundingClientRect(); const b = document.querySelector('.topbar [data-action="print"]').getBoundingClientRect(); return Math.abs(a.left - b.left) < 2 && Math.abs(a.top - b.top) < 2; }), 'the last step should finish, and show the PDF button too');
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
  await en.clickRaw('.hero-note .hero-link');
  check(await en.isVisible('#enq-card') && await en.evaluate(() => document.activeElement.id === 'enq-card') && await en.getAttribute('.enq-pill', 'aria-expanded') === 'true', 'the link in the banner should open the box and move to it');
  await en.clickRaw('.hero-note .hero-link');
  check(await en.isVisible('#enq-card'), 'pressing the link again should leave the box open');
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
  // it always starts as a pill, and goes back to one when the student goes elsewhere
  await en.reload();
  check(await en.isHidden('#enq-card'), 'it should start minimised, even when it was left open');
  await en.clickRaw('.enq-pill');
  await en.focus('[data-action="enq-copy"]');
  await en.keyboard.press('Escape');
  check(await en.isHidden('#enq-card') && await en.evaluate(() => document.activeElement.classList.contains('enq-pill')), 'Esc inside it should minimise it and return to the pill');
  await en.clickRaw('.enq-pill');
  await en.mouse.click(8, 500);
  check(await en.isHidden('#enq-card'), 'pressing outside it should minimise it');
  await en.clickRaw('.enq-pill');
  await en.evaluate(() => document.activeElement.blur());
  await en.keyboard.press('Escape');
  check(await en.isHidden('#enq-card'), 'Esc from anywhere should minimise it');
  await en.clickRaw('.enq-pill');
  await en.clickRaw('.enq-more > summary');
  check(await en.isVisible('#enq-card'), 'pressing inside it should leave it open');
  await en.clickRaw('.enq-pill');
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
  // first visits: always a pill
  const e1 = await firstVisit(APP);
  check(await e1.isHidden('#enq-card') && await e1.isVisible('.enq-pill'), 'a first visit on a wide screen should show the pill');
  await e1.waitForSelector('#tour-prompt:not([hidden])');
  check(!(await overlapIn(e1, '#tour-prompt', '.enq-pill')), 'the tour prompt and the pill should not overlap');
  await e1.clickRaw('.enq-pill');
  check(!(await overlapIn(e1, '#tour-prompt', '#enq-card')), 'the tour prompt and the open box should not overlap');
  await e1.clickRaw('.enq-pill');
  const firstChain = await e1.evaluate(() => { const b = document.querySelector('#grid .chain-btn'); b.scrollIntoView({ block: 'center' }); return b.dataset.slot; });
  await e1.$eval(`#slot-${firstChain} .chain-btn`, b => b.click());
  check(await e1.isVisible('#xray-note') && !(await overlapIn(e1, '#xray-note', '#tour-prompt')), 'the chain note and the tour prompt should not overlap');
  await e1.$eval(`#slot-${firstChain} .chain-btn`, b => b.click());
  await e1.context().close();
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

  // ---------------------------------------------------------------- visual calm: the first screen
  const calm = await newPage(browser, { viewport: { width: 1440, height: 900 } });
  await calm.goto(APP);
  await calm.evaluate(() => { localStorage.clear(); WSLSA.setNow('2026-11-07'); WSLSA.select('2785|BASE'); });
  await calm.evaluate(() => document.fonts.ready);
  check(!(await calm.$('#notice')) && !(await calm.$('#facts')) && !(await calm.$('.ribbon')), 'the top notice and the facts ribbon should be gone');
  const heroFacts = await calm.textContent('#hero-meta');
  check(/400 CP/.test(heroFacts) && /Finish Spring 2031/.test(heroFacts) && /5 yrs full-time/.test(heroFacts) && /2027 Handbook/.test(heroFacts), `the banner should hold the key facts, got ${heroFacts}`);
  check(await calm.getAttribute('#hero-meta a.hero-pill', 'href') === await calm.evaluate(() => WSLSA.context().deg.handbook) && await calm.getAttribute('#hero-meta a.hero-pill', 'target') === '_blank', 'the Handbook pill should open the degree\'s Handbook page');
  const tab1 = await calm.textContent('#details');
  check(/Finish/.test(tab1) && /Intake/.test(tab1) && /Campuses/.test(tab1) && /Campbelltown/.test(tab1) && !!(await calm.$('#details a[href*="studenthandbook"]')), 'Tab 01 should keep the full course facts');
  const heroSize = await calm.evaluate(() => { const g = getComputedStyle(document.querySelector('.hero-grid')); const c = document.querySelector('.hero-crest').getBoundingClientRect(); return { top: g.paddingTop, bottom: g.paddingBottom, w: Math.round(c.width), h: Math.round(c.height) }; });
  check(heroSize.top === '14px' && heroSize.bottom === '12px' && heroSize.w === 150 && heroSize.h === 78, `the banner should be a slim masthead, got ${JSON.stringify(heroSize)}`);
  for (const key of ['2848|BASE', '2785|BASE', '2788|T046', '2843|BASE']) {
    await calm.evaluate(k => WSLSA.select(k), key);
    await calm.waitForTimeout(40);
    const firstAt = await pageTop(calm, '#grid .subj');
    check(firstAt < 660, `Year 1 should be above the fold on a laptop in ${key}, first subject at ${firstAt}`);
  }
  await calm.setViewportSize({ width: 1366, height: 768 });
  await calm.evaluate(() => WSLSA.select('2785|BASE'));
  await calm.waitForTimeout(40);
  check(await pageTop(calm, '#grid .subj') < 660, `Year 1 should start near the top of a small laptop, first subject at ${await pageTop(calm, '#grid .subj')}`);
  await calm.setViewportSize({ width: 1440, height: 900 });
  // the advisory goes quiet when nothing needs doing
  check(!!(await calm.$('#advisory-box.adv-warn')) && !!(await calm.$('#advisory-box .adv-icon path[d^="M12 3"]')), 'a plan with things to check should keep its warning triangle');
  await calm.evaluate(() => {
    const s = WSLSA.state();
    s.mode = 'custom';
    s.custom = { name: 'Short plan', code: '', cp: 10, tpl: '', start: 0, slots: [{ y: 1, s: 'Autumn', code: 'LAWS 1003', title: '', cp: 10, o: '', done: false }] };
    localStorage.setItem('wslsa-2027-pathway-explorer:v1', JSON.stringify(s));
  });
  await calm.reload();
  const okBar = await calm.$eval('#advisory-box > summary', b => { const c = getComputedStyle(b); return { padding: c.paddingTop + ' ' + c.paddingLeft, size: c.fontSize, circle: !!b.querySelector('.adv-icon circle'), triangle: !!b.querySelector('.adv-icon path[d^="M12 3"]'), bold: getComputedStyle(b.querySelector('.adv-counts b')).color, back: c.backgroundColor }; });
  check(!!(await calm.$('#advisory-box.adv-ok')) && okBar.padding === '6px 14px' && okBar.size === '13px' && okBar.circle && !okBar.triangle, `a plan with nothing flagged should get a slim bar with a tick, got ${JSON.stringify(okBar)}`);
  check(okBar.bold !== okBar.back && okBar.bold !== 'rgb(255, 255, 255)', `the numbers in the slim bar should show on its pale background, got ${JSON.stringify(okBar)}`);
  await calm.evaluate(() => { localStorage.clear(); });
  await calm.reload();
  await calm.evaluate(() => { WSLSA.select('2848|BASE'); });
  check(!!(await calm.$('#advisory-box.adv-warn')), 'open slots alone should not count as nothing to check');
  // masthead
  const shownTop = await calm.$$eval('#top-actions > .tbtn, #top-actions .pop-btn', b => b.filter(x => x.offsetParent).map(x => x.textContent.trim()));
  check(JSON.stringify(shownTop) === JSON.stringify(['Tour', 'Dark mode', 'Copy Share Link', 'More', 'Print / Save PDF →']), `the masthead should show only the main actions, got ${shownTop.join(', ')}`);
  check(await calm.isHidden('#top-actions [data-action="export-open"]') && await calm.isHidden('#top-actions [data-action="reset"]') && await calm.isHidden('#top-actions [data-action="backup-save"]') && await calm.isHidden('#top-actions .top-link'), 'the rest should wait in More');
  const moreBtn = '[aria-controls="top-more-menu"]';
  await calm.clickRaw(moreBtn);
  check(await calm.isVisible('#top-actions [data-action="export-open"]') && await calm.isVisible('#top-actions [data-action="reset"]') && await calm.isVisible('#top-actions [data-action="backup-save"]') && await calm.isVisible('#top-actions .top-link') && await calm.getAttribute(moreBtn, 'aria-expanded') === 'true', 'More should open');
  await calm.keyboard.press('Escape');
  check(await calm.isHidden('#top-more-menu') && await calm.getAttribute(moreBtn, 'aria-expanded') === 'false' && await calm.evaluate(() => document.activeElement.getAttribute('aria-controls') === 'top-more-menu'), 'Esc should close More and return to its button');
  await calm.clickRaw(moreBtn);
  await calm.mouse.click(8, 500);
  check(await calm.isHidden('#top-more-menu'), 'pressing elsewhere should close More');
  await calm.clickRaw(moreBtn);
  await calm.clickRaw('#top-actions [data-action="export-open"]');
  check(!!(await calm.$('.modal')) && await calm.isHidden('#top-more-menu'), 'an item in More should run and close it');
  await calm.keyboard.press('Escape');
  await calm.waitForTimeout(20);
  check(await calm.evaluate(() => document.activeElement.getAttribute('aria-controls') === 'top-more-menu'), 'closing that window should return to More');
  const dlBtn = calm.waitForEvent('download');
  await calm.click('#top-actions [data-action="backup-save"]');
  check(/^wslsa-plan-backup-/.test((await dlBtn).suggestedFilename()), 'Download Backup should work from More');
  // plan toolbar
  const toolsShown = await calm.$$eval('#section-tools button', b => b.filter(x => x.offsetParent).map(x => x.textContent.trim()));
  check(JSON.stringify(toolsShown) === JSON.stringify(['↶ Undo', '↷ Redo', 'Re-Pace / Switch Load', 'Plan Tools']), `the plan toolbar should show only four things, got ${toolsShown.join(', ')}`);
  const toolsBtn = '[aria-controls="plan-tools-menu"]';
  await calm.clickRaw(toolsBtn);
  const toolItems = await calm.$$eval('#plan-tools-menu .pop-item', b => b.map(x => x.textContent.trim()));
  check(['Auto-fill Open Slots', 'Pin Snapshot', 'Simulate Degree Transfer', 'Customise This Pathway', 'Build My Own', 'Reset Plan'].every(t => toolItems.indexOf(t) >= 0), `Plan Tools should hold the rest, got ${toolItems.join(', ')}`);
  check(await calm.$eval('#plan-tools-menu', m => { const r = m.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }), 'Plan Tools should fit on screen');
  await calm.keyboard.press('Escape');
  check((await smallTargets(calm)).length === 0, 'the first screen should have targets of at least 24 px: ' + (await smallTargets(calm)).join('; '));
  // a phone holds everything in its Menu
  const calmPhone = await newPage(browser, { viewport: { width: 390, height: 844 } });
  await calmPhone.goto(APP);
  await calmPhone.clickRaw('[data-action="top-menu"]');
  check(await calmPhone.isVisible('#top-actions [data-action="export-open"]') && await calmPhone.isVisible('#top-actions [data-action="reset"]') && await calmPhone.isVisible('#top-actions [data-action="backup-save"]') && await calmPhone.isVisible('#top-actions .top-link') && await calmPhone.isHidden(moreBtn), 'the phone Menu should list everything, with no More inside it');
  await calmPhone.keyboard.press('Escape');
  await calmPhone.$eval('#section-tools', e => e.scrollIntoView({ block: 'center' }));
  await calmPhone.clickRaw(toolsBtn);
  check(await calmPhone.$eval('#plan-tools-menu', m => { const r = m.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }) && await calmPhone.evaluate(() => document.documentElement.scrollWidth <= 390), 'Plan Tools should fit a phone');
  check(calmPhone.errors.length === 0, 'phone menu console errors: ' + calmPhone.errors.join('; '));
  await calmPhone.close();
  check(calm.errors.length === 0, 'first screen console errors: ' + calm.errors.join('; '));
  await calm.close();

  // ---------------------------------------------------------------- Re-Pace: switching load mid-degree
  const rp = await newPage(browser, { viewport: { width: 1440, height: 900 } });
  await rp.goto(APP);
  await rp.evaluate(() => { localStorage.clear(); WSLSA.setNow('2026-11-07'); WSLSA.select('2785|BASE'); });
  const rpOpen = () => rp.$('#rp-form');
  // with nothing ticked the dock's buttons are the plain view, as before
  await rp.clickRaw('[data-action="load"][data-load="PT"]');
  check(!(await rpOpen()) && await rp.evaluate(() => WSLSA.state().load) === 'PT', 'with nothing ticked, Part-time should just change the view');
  await rp.clickRaw('[data-action="load"][data-load="FT"]');
  await rp.evaluate(() => { WSLSA.context().slots.filter(s => s.year <= 2).forEach(s => document.querySelector('#slot-' + s.id + ' .tick input').click()); });
  await rp.clickRaw('[data-action="load"][data-load="FT"]');
  check(!(await rpOpen()), 'pressing the load already in use should do nothing');
  await rp.clickRaw('[data-action="load"][data-load="PT"]');
  check(!!(await rpOpen()) && await rp.isChecked('input[name="rp-scope"][value="remaining"]') && await rp.getAttribute('[data-action="rp-load"][data-v="20"]', 'aria-pressed') === 'true', 'with subjects ticked, Part-time should open Re-Pace, set to the remaining subjects');
  const rpWanted = 'Years 1–2 kept Full-Time · Remaining 240 CP re-paced to Part-Time (20 CP/session) → Finishes Spring 2034';
  check(await rp.textContent('.rp-summary') === rpWanted, `it should say exactly what changes, got ${await rp.textContent('.rp-summary')}`);
  check(/From Spring 2031 to Spring 2034 · 6 sessions later/.test(await rp.textContent('.rp-change')), `it should show the change in graduation, got ${await rp.textContent('.rp-change')}`);
  check((await headingSkips(rp, '#modal-root')).length === 0 && (await smallTargets(rp)).length === 0, 'the window should have ordered headings and targets of at least 24 px: ' + (await smallTargets(rp)).join('; '));
  const beforeRepace = await rp.evaluate(() => { const c = WSLSA.context(); return c.slots.filter(s => s.done).map(s => s.code + '@' + s.year + s.session).sort(); });
  await rp.clickRaw('#rp-apply');
  await rp.waitForFunction(() => !document.getElementById('rp-form'));
  const afterRepace = await rp.evaluate(() => {
    const c = WSLSA.context();
    const by = {};
    c.slots.filter(s => !s.done).forEach(s => { const k = s.year + s.session; by[k] = (by[k] || 0) + s.cp; });
    return { pace: c.plan.pace, edit: c.edit, mode: WSLSA.state().mode, load: WSLSA.state().load, kept: c.slots.filter(s => s.done).map(s => s.code + '@' + s.year + s.session).sort(), by: by, notOffered: c.risks.notOffered.map(s => s.code), finish: document.querySelector('.hp-finish').textContent, pressed: document.querySelector('[data-action="load"][aria-pressed="true"]').textContent, meta: document.getElementById('progress-meta').textContent, note: document.querySelector('.pt-note').textContent, slots: c.plan.slots.length };
  });
  check(afterRepace.pace === 20 && afterRepace.edit === '2785|BASE' && afterRepace.mode === 'guide' && afterRepace.load === 'FT', `applying should make the pathway's edited copy at that pace, got ${JSON.stringify(afterRepace).slice(0, 200)}`);
  check(JSON.stringify(afterRepace.kept) === JSON.stringify(beforeRepace), 'completed subjects should stay exactly where they were');
  check(Object.keys(afterRepace.by).every(k => afterRepace.by[k] <= 20) && Object.keys(afterRepace.by).every(k => +k[0] >= 3), `the rest should run at 20 CP a session from Year 3, got ${JSON.stringify(afterRepace.by)}`);
  check(afterRepace.notOffered.length === 0, `no subject should land in a session it is not offered in, got ${afterRepace.notOffered.join(', ')}`);
  check(/Spring 2034/.test(afterRepace.finish) && afterRepace.pressed === 'Part-time' && /12 sessions PT/.test(afterRepace.meta) && /Re-paced plan/.test(afterRepace.note), `the page should show the new pace, got ${JSON.stringify(afterRepace).slice(0, 300)}`);
  check(/Years 1–2 kept Full-Time/.test(await rp.textContent('#toast')) && /re-paced/.test(await rp.evaluate(() => WSLSA.history().undoLabel)), 'it should say what happened and be named in the history');
  // the link keeps the pace
  const pacedLink = await rp.evaluate(() => WSLSA.planUrl());
  const rp2 = await newPage(browser, { viewport: { width: 1440, height: 900 } });
  await rp2.goto(pacedLink);
  check(await rp2.evaluate(() => { const c = WSLSA.custom(); return c.pace === 20 && c.slots.filter(x => x.done).length === 16; }) && await rp2.textContent('[data-action="load"][aria-pressed="true"]') === 'Part-time', 'a share link should keep the pace and the ticks');
  await rp2.close();
  // undo
  await rp.keyboard.press('Control+z');
  await rp.waitForTimeout(40);
  check(await rp.evaluate(() => WSLSA.state().mode === 'guide' && WSLSA.context().doneCP === 160) && await rp.textContent('.hp-finish') !== afterRepace.finish, 'Undo should bring back the plan as it was');
  // the whole plan, from Year 1: the view, as before
  await rp.clickRaw('[data-action="load"][data-load="PT"]');
  await rp.check('input[name="rp-scope"][value="whole"]');
  check(/Whole plan at Part-Time/.test(await rp.textContent('.rp-summary')) && /Spring 2036/.test(await rp.textContent('.rp-summary')), `the whole plan should say what it does, got ${await rp.textContent('.rp-summary')}`);
  await rp.clickRaw('#rp-apply');
  check(await rp.evaluate(() => WSLSA.state().load === 'PT' && WSLSA.state().mode === 'guide' && WSLSA.context().doneCP === 160), 'switching the whole plan should keep the pathway and the ticks');
  await rp.clickRaw('[data-action="load"][data-load="FT"]');
  await rp.check('input[name="rp-scope"][value="whole"]');
  await rp.clickRaw('#rp-apply');
  check(await rp.evaluate(() => WSLSA.state().load) === 'FT', 'and back');
  // a three-subject load and a session off
  await rp.clickRaw('[data-action="repace-open"]');
  await rp.clickRaw('[data-action="rp-load"][data-v="30"]');
  await rp.check('#rp-loa');
  check(/3-Unit Load \(30 CP\/session\)/.test(await rp.textContent('.rp-summary')), `the 30 CP load should be named, got ${await rp.textContent('.rp-summary')}`);
  check(await rp.$eval('.rp-rows .ps-row', r => /Autumn 2029/.test(r.textContent) && /Leave of Absence/.test(r.textContent)), 'the session off should show as the first thing after Year 2');
  await rp.clickRaw('#rp-apply');
  await rp.waitForFunction(() => !document.getElementById('rp-form'));
  const thirty = await rp.evaluate(() => { const c = WSLSA.context(); const by = {}; c.slots.filter(s => !s.done).forEach(s => { by[s.year + s.session] = (by[s.year + s.session] || 0) + s.cp; }); return { by: by, gap: c.slots.some(s => s.year === 3 && s.session === 'Autumn'), pressed: document.querySelector('[data-action="repace-open"][aria-pressed="true"]') ? document.querySelector('[data-action="repace-open"][aria-pressed="true"]').textContent : '', empty: !!document.querySelector('#year-3 .session[data-s="Autumn"] .slot-empty') }; });
  check(!thirty.gap && thirty.empty && Object.keys(thirty.by).every(k => thirty.by[k] <= 30) && thirty.pressed === '30 CP', `30 CP with a session off should leave that session empty and show in the dock, got ${JSON.stringify(thirty)}`);
  // on a re-paced plan, the dock's buttons go through Re-Pace too
  await rp.clickRaw('[data-action="load"][data-load="FT"]');
  check(!!(await rpOpen()) && await rp.getAttribute('[data-action="rp-load"][data-v="40"]', 'aria-pressed') === 'true', 'on a re-paced plan, Full-time should open Re-Pace');
  await rp.clickRaw('#rp-apply');
  await rp.waitForFunction(() => !document.getElementById('rp-form'));
  check(await rp.textContent('[data-action="load"][aria-pressed="true"]') === 'Full-time' && await rp.evaluate(() => WSLSA.custom().pace) === 40, 're-pacing back to full-time should say so in the dock');
  check(rp.errors.length === 0, 'Re-Pace console errors: ' + rp.errors.join('; '));
  await rp.close();

  // ---------------------------------------------------------------- Re-Pace: every pathway, at every load, keeps the rules
  const sweep = await newPage(browser, { viewport: { width: 1440, height: 900 } });
  await sweep.goto(APP);
  const sweepProblems = await sweep.evaluate(() => {
    localStorage.clear();
    WSLSA.setNow('2026-11-07');
    const problems = [];
    WSLSA.keys().forEach(key => {
      WSLSA.select(key);
      const deg = WSLSA.context().deg;
      const canSpring = deg.intakeList.indexOf('Spring') >= 0;
      [20, 30, 40].forEach(load => {
        ['Autumn', 'Spring'].forEach(intake => {
          if (intake === 'Spring' && !canSpring) return;
          [false, true].forEach(ticked => {
            const r = WSLSA.pace({ scope: ticked ? 'remaining' : 'whole', load: load, intake: intake }, ticked ? 2 : 0);
            const label = key + ' ' + load + ' ' + intake + (ticked ? ' ticked' : '');
            if (r.unplaced || r.forced.length) problems.push(label + ': unplaced ' + r.unplaced + ', forced ' + r.forced.join(' '));
            const at = {};
            const per = {};
            r.rows.forEach(x => { if (x.code) at[x.code] = x.done ? -1 : x.k; per[x.k] = (per[x.k] || 0) + (x.locked ? 0 : x.cp); });
            r.rows.filter(x => !x.locked).forEach(x => {
              const sess = ['Autumn', 'Spring', 'Summer'][x.k % 3];
              if (sess === 'Summer') problems.push(label + ': ' + x.code + ' in Summer without Fast-Track');
              if (x.list.indexOf(sess) < 0) problems.push(label + ': ' + x.code + ' in ' + sess + ', runs in ' + x.list.join(' '));
              (r.groups[x.code] || []).forEach(g => {
                const known = g.filter(p => at[p] != null);
                if (known.length && !known.some(p => at[p] < x.k)) problems.push(label + ': ' + x.code + ' at ' + x.k + ' before ' + g.join('/'));
              });
            });
            Object.keys(per).forEach(k => { if (per[k] > load && r.rows.filter(x => !x.locked && x.k === +k).length > 1) problems.push(label + ': ' + per[k] + ' CP at ' + k); });
            if (intake === 'Spring' && !ticked && r.rows.some(x => x.k === 0)) problems.push(label + ': something in Year 1 Autumn');
          });
        });
      });
    });
    return problems;
  });
  check(sweepProblems.length === 0, `every pathway should re-pace within its rules, got ${sweepProblems.length}: ${sweepProblems.slice(0, 12).join(' | ')}`);
  check(sweep.errors.length === 0, 'sweep console errors: ' + sweep.errors.join('; '));
  await sweep.close();

  // ---------------------------------------------------------------- Spring start
  const sp1 = await newPage(browser, { viewport: { width: 1440, height: 900 } });
  await sp1.goto(APP);
  await sp1.evaluate(() => { localStorage.clear(); WSLSA.setNow('2026-11-07'); WSLSA.select('2743|' + WSLSA.keys().find(k => k.indexOf('2743|') === 0).split('|')[1]); });
  await sp1.clickRaw('[data-action="repace-open"]');
  check(await sp1.isDisabled('[data-action="rp-intake"][data-v="Spring"]') && /Autumn intake only/.test(await sp1.textContent('#rp-form')), 'a degree with an Autumn intake only should not offer Spring');
  await sp1.keyboard.press('Escape');
  await sp1.waitForFunction(() => !document.getElementById('rp-form'));
  await sp1.evaluate(() => WSLSA.select('2848|BASE'));
  await sp1.clickRaw('[data-action="repace-open"]');
  check(await sp1.isChecked('input[name="rp-scope"][value="whole"]') && await sp1.getAttribute('[data-action="rp-intake"][data-v="Autumn"]', 'aria-pressed') === 'true', 'with nothing ticked it should start on the whole plan and the plan\'s own intake');
  await sp1.clickRaw('[data-action="rp-load"][data-v="40"]');
  await sp1.clickRaw('[data-action="rp-intake"][data-v="Spring"]');
  check(/Spring 2027/.test(await sp1.textContent('.rp-rows .ps-row')), 'a Spring start should begin in Spring 2027');
  await sp1.clickRaw('#rp-apply');
  await sp1.waitForFunction(() => !document.getElementById('rp-form'));
  const spring = await sp1.evaluate(() => {
    const c = WSLSA.context();
    return { y1a: c.slots.filter(s => s.year === 1 && s.session === 'Autumn').length, y1s: c.slots.filter(s => s.year === 1 && s.session === 'Spring').length, y2a: c.slots.filter(s => s.year === 2 && s.session === 'Autumn').length, notOffered: c.risks.notOffered.map(s => s.code + ' ' + s.session), note: document.querySelector('#year-1 .session[data-s="Autumn"] .slot-empty').textContent, next: document.getElementById('next').textContent, cp: c.totalCP };
  });
  check(spring.y1a === 0 && spring.y1s > 0 && spring.y2a > 0 && spring.cp === 320, `Year 1 should run in Spring, then Autumn of the next year, got ${JSON.stringify(spring).slice(0, 200)}`);
  check(spring.notOffered.length === 0, `every subject should run in its session, got ${spring.notOffered.join(', ')}`);
  check(/starts in Spring/.test(spring.note) && /Spring 2027/.test(spring.next), 'the plan should say it starts in Spring');
  await sp1.keyboard.press('Control+z');
  await sp1.waitForTimeout(40);
  check(await sp1.evaluate(() => WSLSA.state().mode) === 'guide', 'Undo should reverse a Spring start');
  // a Spring starter with subjects ticked: what they completed moves with the start
  await sp1.evaluate(() => { WSLSA.context().slots.filter(s => s.year === 1 && s.session === 'Autumn').forEach(s => document.querySelector('#slot-' + s.id + ' .tick input').click()); });
  await sp1.clickRaw('[data-action="repace-open"]');
  await sp1.clickRaw('[data-action="rp-load"][data-v="40"]');
  await sp1.clickRaw('[data-action="rp-intake"][data-v="Spring"]');
  await sp1.clickRaw('#rp-apply');
  await sp1.waitForFunction(() => !document.getElementById('rp-form'));
  check(await sp1.evaluate(() => { const c = WSLSA.context(); return c.slots.filter(s => s.done).every(s => s.year === 1 && s.session === 'Spring') && c.slots.filter(s => !s.done).every(s => s.year >= 2); }), 'completed subjects should move to the Spring start, and the rest should follow them');
  // the start year
  await sp1.evaluate(() => { localStorage.clear(); });
  await sp1.reload();
  await sp1.evaluate(() => { WSLSA.setNow('2026-11-07'); WSLSA.select('2848|BASE'); });
  await sp1.evaluate(() => { WSLSA.context().slots.filter(s => s.year === 1).forEach(s => document.querySelector('#slot-' + s.id + ' .tick input').click()); });
  await sp1.clickRaw('[data-action="repace-open"]');
  await sp1.selectOption('#rp-start', '2025');
  check(/Finishes/.test(await sp1.textContent('.rp-summary')) && /Autumn 2027/.test(await sp1.textContent('.rp-rows .ps-row')), `a 2025 start should plan from the next session that has not begun, got ${await sp1.textContent('.rp-rows .ps-row')}`);
  await sp1.keyboard.press('Escape');
  check(sp1.errors.length === 0, 'Spring start console errors: ' + sp1.errors.join('; '));
  await sp1.close();

  // ---------------------------------------------------------------- Fast-Track
  const ft = await newPage(browser, { viewport: { width: 1440, height: 900 } });
  await ft.goto(APP);
  await ft.evaluate(() => { localStorage.clear(); WSLSA.setNow('2026-11-07'); WSLSA.select('2785|BASE'); });
  await ft.evaluate(() => { WSLSA.context().slots.filter(s => s.year <= 2).forEach(s => document.querySelector('#slot-' + s.id + ' .tick input').click()); });
  await ft.clickRaw('[data-action="repace-open"]');
  await ft.clickRaw('[data-action="rp-fast"]');
  check(await ft.getAttribute('[data-action="rp-load"][data-v="40"]', 'aria-pressed') === 'true' && await ft.isVisible('#rp-summer') && await ft.isVisible('#rp-over'), 'Fast-Track should set the full load and show what it may use');
  const fastText = await ft.textContent('.rp-fast-result');
  check(/Fast-Track finishes \d sessions? earlier/.test(fastText) && /no Summer data/.test(fastText) && /needs approval/.test(fastText) && /sessions? earlier/.test(await ft.textContent('.rp-change')), `it should say what it found and what to check, got ${fastText}`);
  check((await ft.$$eval('.rp-rows .ps-when', w => w.filter(x => /Summer/.test(x.textContent)).length)) > 0, 'it should show the Summer sessions it uses');
  await ft.uncheck('#rp-summer');
  await ft.uncheck('#rp-over');
  check(!(await ft.$('.rp-fast-result')) && /no earlier finish/.test(await ft.textContent('.rp-preview')), 'with both options off it should say it found nothing');
  await ft.check('#rp-summer');
  await ft.check('#rp-over');
  await ft.clickRaw('#rp-apply');
  await ft.waitForFunction(() => !document.getElementById('rp-form'));
  const fastPlan = await ft.evaluate(() => {
    const c = WSLSA.context();
    const per = {};
    c.slots.forEach(s => { const k = s.year + s.session; per[k] = (per[k] || 0) + s.cp; });
    return { per: per, summers: c.slots.filter(s => s.session === 'Summer').map(s => s.kind === 'cslot' ? s.raw.kind : s.kind), notOffered: c.risks.notOffered.map(s => s.code), overload: c.risks.overload.length, summerFlag: /in Summer to check/.test(document.querySelector('#advisory summary').textContent) || c.risks.pending.length > 0, advisory: document.querySelector('#advisory summary').textContent };
  });
  check(fastPlan.summers.length > 0 && fastPlan.summers.every(k => k === 'llb' || k === 'elective'), `only LLB Alternates and electives should go to Summer, got ${fastPlan.summers.join(', ')}`);
  check(Object.keys(fastPlan.per).every(k => fastPlan.per[k] <= (/Summer/.test(k) ? 20 : 50)), `no session should pass 50 CP, or a Summer 20 CP, got ${JSON.stringify(fastPlan.per)}`);
  check(fastPlan.notOffered.length === 0, `Fast-Track should keep subjects in sessions they run in, got ${fastPlan.notOffered.join(', ')}`);
  await ft.keyboard.press('Control+z');
  await ft.waitForTimeout(40);
  // a trailing short final session is the plain case: 2843 ends on 20 CP
  await ft.evaluate(() => { localStorage.clear(); WSLSA.select('2843|BASE'); });
  await ft.clickRaw('[data-action="repace-open"]');
  await ft.clickRaw('[data-action="rp-load"][data-v="40"]');
  await ft.clickRaw('[data-action="rp-fast"]');
  check(/Fast-Track finishes/.test(await ft.textContent('.rp-preview')), `a trailing 20 CP session should be cleared, got ${await ft.textContent('.rp-preview')}`);
  await ft.keyboard.press('Escape');
  check(ft.errors.length === 0, 'Fast-Track console errors: ' + ft.errors.join('; '));
  await ft.close();

  // ---------------------------------------------------------------- degree transfer
  const tr = await newPage(browser, { viewport: { width: 1440, height: 900 } });
  await tr.goto(APP);
  await tr.evaluate(() => { localStorage.clear(); WSLSA.setNow('2026-11-07'); WSLSA.select('2785|BASE'); });
  // nothing ticked: nothing to carry, and the simulator says so
  await tr.selectOption('#sel-degree', '2848');
  check(await tr.evaluate(() => WSLSA.context().doneCP) === 0 && await tr.evaluate(() => WSLSA.history().undo) === 0 && await tr.isHidden('#credit-offer'), 'with nothing ticked, changing degree should change nothing else');
  await tr.click('[data-action="transfer-open"]');
  check(/Tick off the subjects/.test(await tr.textContent('#tr-body')) && await tr.isDisabled('#tr-apply'), 'the simulator should ask for completed subjects first');
  await tr.keyboard.press('Escape');
  await tr.waitForFunction(() => !document.querySelector('.modal'));
  await tr.selectOption('#sel-degree', '2785');
  const lawDone = ['LAWS 1003', 'LAWS 1010', 'LAWS 2018', 'LAWS 2013'];
  await tr.evaluate(() => { WSLSA.context().slots.filter(s => s.year <= 2).forEach(s => document.querySelector('#slot-' + s.id + ' .tick input').click()); });
  const fromDone = await tr.evaluate(() => WSLSA.context().slots.filter(s => s.done).map(s => s.code));
  // switching degree carries them over by itself
  await tr.selectOption('#sel-degree', '2848');
  const carried = await tr.evaluate(() => { const c = WSLSA.context(); return { done: c.slots.filter(s => s.done).map(s => s.code), cp: c.doneCP, toast: document.getElementById('toast').textContent, degree: WSLSA.state().degree, undo: WSLSA.history().undoLabel }; });
  check(lawDone.every(x => carried.done.indexOf(x) >= 0) && carried.done.every(x => /^LAWS /.test(x)) && carried.cp === carried.done.length * 10, `matching Law subjects should tick off in the new degree, got ${carried.done.join(', ')}`);
  check(new RegExp('Carried over ' + carried.done.length + ' completed subjects \\(' + carried.cp + ' CP\\) from 2785\\. ' + carried.cp + ' of 320 CP of 2848 finished').test(carried.toast) && /carried your subjects/.test(carried.undo), `it should say what it did, got ${carried.toast}`);
  check(await tr.isVisible('#credit-offer') && /completed non-law subjects from 2785/.test(await tr.textContent('#credit-offer')) && /WSU decides credit/.test(await tr.textContent('#credit-offer')), 'moving into 2848 should offer the electives credit');
  const nonLawDone = fromDone.filter(x => !/^LAWS /.test(x));
  await tr.clickRaw('[data-action="credit-electives"]');
  const credited = await tr.evaluate(() => { const c = WSLSA.context(); return { electives: c.slots.filter(s => s.kind === 'elective').map(s => ({ code: s.code, done: s.done, pending: s.pending })), cp: c.doneCP, toast: document.getElementById('toast').textContent, bar: document.getElementById('progress-num').textContent }; });
  const filledElectives = credited.electives.filter(e => !e.pending);
  check(filledElectives.length === 8 && filledElectives.every(e => e.done && nonLawDone.indexOf(e.code) >= 0), `up to 8 non-law subjects should fill the electives, ticked, got ${JSON.stringify(filledElectives)}`);
  check(credited.cp === carried.cp + 80 && new RegExp(credited.cp + ' of 320 CP of 2848 finished').test(credited.toast) && new RegExp('^' + credited.cp).test(credited.bar.trim()), `the progress should show at once, got ${JSON.stringify(credited).slice(0, 240)}`);
  check(await tr.isHidden('#credit-offer'), 'the offer should go once taken');
  await tr.keyboard.press('Control+z');
  await tr.waitForTimeout(40);
  check(await tr.evaluate(() => WSLSA.context().slots.filter(s => s.kind === 'elective' && !s.pending).length) === 0 && await tr.evaluate(() => WSLSA.context().doneCP) === carried.cp, 'Undo should take the electives back out');
  await tr.keyboard.press('Control+z');
  await tr.waitForTimeout(40);
  check(await tr.evaluate(() => WSLSA.state().degree === '2785' && WSLSA.context().doneCP === 160), 'Undo again should go back to the first degree');
  // a double degree has no electives to offer
  await tr.selectOption('#sel-degree', '2766');
  check(await tr.isHidden('#credit-offer') && await tr.evaluate(() => WSLSA.context().doneCP) >= carried.cp, 'a degree with no electives should still carry subjects, with no offer');
  await tr.selectOption('#sel-degree', '2785');
  // the simulator shows it first, and can credit in one step
  await tr.click('[data-action="transfer-open"]');
  check(await tr.$eval('#tr-deg', s => s.value) === '2848' && /would already be finished/.test(await tr.textContent('.tr-score')) && await tr.isChecked('#tr-credit'), 'the simulator should start on 2848 with the credit on');
  const sim = await tr.textContent('.tr-score b');
  check(new RegExp((carried.cp + 80) + ' of 320 CP').test(sim), `the simulator should count the credited electives, got ${sim}`);
  check(await tr.$$eval('#tr-body .pick-section h3 span:first-child', s => s.map(x => x.textContent).join('|')).then(t => /Credited as electives/.test(t)), 'it should list what goes where');
  await tr.clickRaw('#tr-credit');
  check(new RegExp(carried.cp + ' of 320 CP').test(await tr.textContent('.tr-score b')), 'unticking the credit should take it off the count');
  await tr.clickRaw('#tr-credit');
  check((await headingSkips(tr, '#modal-root')).length === 0, 'the simulator headings should not skip a level');
  await tr.clickRaw('#tr-apply');
  await tr.waitForFunction(() => !document.querySelector('.modal'));
  check(await tr.evaluate(() => WSLSA.state().degree === '2848' && WSLSA.context().slots.filter(s => s.kind === 'elective' && s.done).length === 8) && /Switched to 2848/.test(await tr.textContent('#toast')), 'applying should switch degree with everything ticked');
  // a change of major carries subjects too
  await tr.evaluate(() => { localStorage.clear(); WSLSA.select('2788|T046'); });
  await tr.evaluate(() => { WSLSA.context().slots.filter(s => s.year === 1).forEach(s => document.querySelector('#slot-' + s.id + ' .tick input').click()); });
  const majorFrom = await tr.evaluate(() => WSLSA.context().slots.filter(s => s.done).map(s => s.code));
  await tr.selectOption('#sel-major', '2788|T039');
  check(await tr.evaluate(() => WSLSA.context().slots.filter(s => s.done).map(s => s.code)).then(d => d.length > 0 && d.every(x => majorFrom.indexOf(x) >= 0)), 'changing major should keep the subjects both majors share ticked');
  check(tr.errors.length === 0, 'transfer console errors: ' + tr.errors.join('; '));
  await tr.close();

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

  // ---------------------------------------------------------------- Handbook switch both ways, codes by year, loads, pools, filters
  {
  const hb = await newPage(browser, { viewport: { width: 1440, height: 1000 } });
  hb.on('dialog', d => d.accept());
  await hb.goto(APP);
  await hb.evaluate(() => { localStorage.clear(); WSLSA.setNow('2026-11-09'); WSLSA.select('2785|BASE'); });
  const sum = () => hb.evaluate(() => {
    const c = WSLSA.context();
    const llb = s => s.kind === 'llb' || (s.orig && s.orig.kind === 'llb');
    return {
      cohort: document.getElementById('sel-cohort').value,
      cores: ['LAWS 2019', 'LAWS 3099', 'LAWS 3102'].map(k => { const x = c.slots.find(y => y.code === k && !y.pending); return x ? x.year + x.session[0] : '-'; }).join(' '),
      llb: c.slots.filter(llb).length, total: c.totalCP, guide: c.guide ? c.guide.items.length : 0, edit: !!c.edit,
    };
  });
  check(await hb.$eval('#top-more-menu a[href="https://www.westernsydney.edu.au/students/dates"]', l => l.target === '_blank' && /Semester & Session Dates/.test(l.textContent)), 'More should link to the university\'s semester and session dates');
  // a slot added as any WSU subject is set right as an LLB Alternate on the card itself, with no need to remove it
  await hb.click('#year-1 .session[data-s="Autumn"] .add-menu [data-action="cadd"]:not([data-o])');
  const wrong = await hb.evaluate(() => { const c = WSLSA.context(); return c.slots[c.slots.length - 1].id; });
  await hb.click(`#slot-${wrong} [data-action="picker-open"]`);
  await hb.fill('#pick-q', 'LAWS 4010');
  await hb.click('#pick-results [data-action="cpick"][data-code="LAWS 4010"]');
  const typeOpts = await hb.$$eval(`#slot-${wrong} .type-sel option`, o => o.map(x => x.textContent + (x.selected ? '*' : '')));
  check(JSON.stringify(typeOpts) === JSON.stringify(['Any WSU subject*', 'LLB Alternate', 'Alternate Accounting subject']), `a card should offer the kinds of slot it can be, got ${JSON.stringify(typeOpts)}`);
  const llbRow = await hb.$eval(`#slot-${wrong} .type-sel option:nth-child(2)`, o => o.value);
  await hb.selectOption(`#slot-${wrong} .type-sel`, llbRow);
  const typed = await hb.evaluate(() => { const c = WSLSA.context(); const x = c.slots.find(y => y.code === 'LAWS 4010'); const el = document.getElementById('slot-' + x.id); return { kind: x.orig && x.orig.kind, label: x.typeLabel, slots: c.slots.length, sel: el.querySelector('.type-sel').selectedOptions[0].textContent, open: el.classList.contains('is-open'), llb: Array.from(document.querySelectorAll('#dock-track .tk-llb .track-num')).map(n => n.textContent).join('') }; });
  check(typed.kind === 'llb' && typed.label === 'LLB Alternate' && typed.slots === 41 && typed.sel === 'LLB Alternate' && typed.open && /60 CP/.test(typed.llb) && /LAWS 4010 now counts as LLB Alternate/.test(await hb.textContent('#toast')), `changing the type should keep the card and its subject and count it as an LLB Alternate, got ${JSON.stringify(typed)}`);
  check(!(await hb.$(`#slot-${await hb.evaluate(() => WSLSA.context().slots.find(x => x.code === 'LAWS 1003').id)} .type-sel`)), 'a core subject should not offer a type');
  for (let i = 0; i < 3; i++) await hb.click('#section-tools [data-action="undo"]');
  check(await hb.evaluate(() => !WSLSA.context().edit), 'Undo should take the type change, the subject and the slot back');
  // the laptop dock keeps its whole progress line, and the Edit pill and hidden tools behave
  await hb.setViewportSize({ width: 1180, height: 900 });
  check(await hb.evaluate(() => { const m = document.getElementById('progress-meta'); const p = document.querySelector('#dock .progress').getBoundingClientRect(); const t = document.getElementById('dock-track').getBoundingClientRect(); return getComputedStyle(m).display !== 'none' && m.getBoundingClientRect().width > 60 && t.left >= p.right - 1 && Math.abs(t.top - p.top) < 14; }), 'a laptop dock should show the progress details beside the tracker');
  await hb.setViewportSize({ width: 1440, height: 1000 });
  const edit1 = await hb.evaluate(() => { const c = WSLSA.context(); const s = c.slots.find(x => !x.pending); const p = c.slots.find(x => x.pending); const b = document.querySelector('#slot-' + s.id + ' .subj-more'); const cs = getComputedStyle(b); return { text: b.textContent, shown: cs.borderTopWidth === '1px' && cs.backgroundColor !== 'rgba(0, 0, 0, 0)', pendingTools: getComputedStyle(document.querySelector('#slot-' + p.id + ' .subj-edit')).display, pendingBtn: !!document.querySelector('#slot-' + p.id + ' .subj-more') }; });
  check(edit1.text === 'Edit ▾' && edit1.shown && edit1.pendingTools === 'flex' && !edit1.pendingBtn, `a card should show an Edit pill, and an open slot its tools, got ${JSON.stringify(edit1)}`);
  await hb.mouse.move(2, 2);
  check(await hb.evaluate(() => { const b = document.querySelector('#grid .session-tools [data-action="session-done"]'); const c = getComputedStyle(b); return c.opacity === '0' && c.pointerEvents === 'none'; }), 'a hidden session tool should not take a press');
  // the stage pill follows the credit points completed, and each requirement meter picks out its cards
  check(await hb.textContent('#hero-meta .hp-stage') === 'Stage 1 · Foundations', `a new plan should be at Stage 1, got ${await hb.textContent('#hero-meta .hp-stage')}`);
  await hb.click('#dock-track [data-action="track-filter"][data-k="llb"]');
  const tr = await hb.evaluate(() => ({ on: document.getElementById('grid').classList.contains('is-tracking'), n: document.querySelectorAll('#grid .subj.is-track').length, pressed: document.querySelector('#dock-track [data-k="llb"]').getAttribute('aria-pressed'), dim: getComputedStyle(document.querySelector('#grid .subj:not(.is-track)')).opacity, all: Array.from(document.querySelectorAll('#grid .subj.is-track')).every(c => /LLB ALT|LLB Alternate/i.test(c.textContent)) }));
  check(tr.on && tr.n === 5 && tr.pressed === 'true' && tr.dim === '0.3' && tr.all, `pressing the LLB Alternates meter should pick out its five cards, got ${JSON.stringify(tr)}`);
  await hb.keyboard.press('Escape');
  check(await hb.evaluate(() => !document.getElementById('grid').classList.contains('is-tracking') && document.querySelector('#dock-track [data-k="llb"]').getAttribute('aria-pressed') === 'false'), 'Esc should show everything again');
  // year options: delete a year, insert an empty one, clear what is unticked, each one step for Undo
  const shape = () => hb.evaluate(() => { const c = WSLSA.context(); return { years: document.querySelectorAll('#grid .year').length, slots: c.slots.length, total: c.totalCP, edit: !!c.edit, y2: c.slots.filter(x => x.year === 2).map(x => x.code || '-').sort().join(','), guide: c.guide ? c.guide.cp : 0 }; });
  const start = await shape();
  const wasY3 = await hb.evaluate(() => WSLSA.context().slots.filter(x => x.year === 3).map(x => x.code || '-').sort().join(','));
  check(await hb.$$eval('#year-2 .year-foot [data-action]', b => b.map(x => x.dataset.action).join(',')) === 'year-insert,year-clear,year-delete', 'each year should offer to insert a year, clear it or delete it');
  await hb.click('#year-2 [data-action="year-delete"]');
  let yr = await shape();
  check(yr.years === 5 && yr.slots === 32 && yr.total === 320 && yr.edit && yr.y2 === wasY3 && yr.guide === 80 && /Year 2 deleted, with 8 subjects\. The later years moved up/.test(await hb.textContent('#toast')), `deleting Year 2 should take its subjects out and bring the later years forward, got ${JSON.stringify(yr)}`);
  await hb.click('#section-tools [data-action="undo"]');
  yr = await shape();
  check(yr.years === 5 && yr.slots === 40 && !yr.edit && yr.y2 === start.y2, `Undo should bring the deleted year back, got ${JSON.stringify(yr)}`);
  await hb.click('#year-2 [data-action="year-insert"]');
  yr = await shape();
  check(yr.years === 6 && yr.slots === 40 && yr.y2 === '' && yr.total === 400 && yr.guide === 0 && await hb.evaluate(w => WSLSA.context().slots.filter(x => x.year === 3).map(x => x.code || '-').sort().join(',') === w, start.y2) && /Empty session/.test(await hb.textContent('#year-2 .slot-empty')), `inserting a year should leave Year 2 empty and move the rest a year on, got ${JSON.stringify(yr)}`);
  await hb.click('#year-2 [data-action="year-delete"]');
  yr = await shape();
  check(yr.years === 5 && yr.slots === 40 && yr.y2 === start.y2, `deleting the empty year should put the plan back without asking, got ${JSON.stringify(yr)}`);
  await hb.click('#year-1 .session[data-s="Autumn"] .tick');
  await hb.click('#year-1 [data-action="year-clear"]');
  yr = await shape();
  check(yr.slots === 33 && yr.guide === 70 && await hb.evaluate(() => WSLSA.context().slots.filter(x => x.year === 1).length === 1 && WSLSA.context().slots.find(x => x.year === 1).done), `clearing a year should keep what is ticked and list the rest in the guide, got ${JSON.stringify(yr)}`);
  for (let i = 0; i < 4; i++) await hb.click('#section-tools [data-action="undo"]');
  check(!(await shape()).edit, 'Undo should take the year changes back to the pathway');
  // a note on a session, kept with the plan, in its link and on paper
  await hb.click('#year-3 .session[data-s="Spring"] [data-action="session-note"]');
  check(/Note for Spring 2029/.test(await hb.textContent('#note-h')) && await hb.evaluate(() => document.activeElement.id === 'note-text'), 'a note should open its own window, ready to type in');
  await hb.fill('#note-text', 'Exchange semester in Leiden');
  await hb.click('.modal-note [type="submit"]');
  const noted = await hb.evaluate(() => { WSLSA.preparePrint({ mode: 'A', orient: 'portrait' }); return { text: document.querySelector('#year-3 .session[data-s="Spring"] .session-note').textContent, link: WSLSA.linkText(), paper: (document.querySelector('#print-root .pd-notes') || {}).textContent || '', button: document.querySelector('#year-3 .session[data-s="Spring"] .note-btn').textContent }; });
  check(noted.text === 'NoteExchange semester in Leiden' && /\/nt=7:Exchange%20semester%20in%20Leiden/.test(noted.link) && /Spring 2029: Exchange semester in Leiden/.test(noted.paper) && noted.button === 'Edit note', `a session note should show on the session, in the link and on paper, got ${JSON.stringify(noted)}`);
  await hb.click('#year-2 [data-action="year-insert"]');
  check(await hb.evaluate(() => WSLSA.custom().notes[10] === 'Exchange semester in Leiden' && !WSLSA.custom().notes[7]), 'a note should move with its session when a year is inserted');
  await hb.click('#year-4 .session[data-s="Spring"] [data-action="session-note"]');
  check(await hb.inputValue('#note-text') === 'Exchange semester in Leiden', 'editing a note should start from what it says');
  await hb.click('[data-action="note-remove"]');
  check(!(await hb.$('#grid .session-note')), 'an empty note should remove it');
  for (let i = 0; i < 3; i++) await hb.click('#section-tools [data-action="undo"]');
  check(!(await shape()).edit, 'Undo should take the notes back');
  // the requirement tracker counts each kind of subject, follows the Handbook and moves with a tick
  const track = () => hb.$$eval('#dock-track .track-item', li => li.map(x => x.querySelector('.track-label .tl-full').textContent + ' ' + x.querySelector('.track-num').textContent).join(' | '));
  check(await track() === 'Law core 0 / 190 CP | Non-law core 0 / 120 CP | LLB Alternates 0 / 50 CP | Choices 0 / 40 CP', `the tracker should count the 2027 structure, got ${await track()}`);
  await hb.selectOption('#sel-cohort', 'pre2027');
  check(/^Law core 0 \/ 160 CP \| Non-law core 0 \/ 120 CP \| LLB Alternates 0 \/ 80 CP/.test(await track()), `the tracker should follow the pre-2027 structure, got ${await track()}`);
  await hb.selectOption('#sel-cohort', '2027');
  await hb.click(`#slot-${await hb.evaluate(() => WSLSA.context().slots.find(x => x.code === 'LAWS 1003').id)} .tick`);
  check(/^Law core 10 \/ 190 CP/.test(await track()) && await hb.$eval('#dock-track .tk-law .tb-done', i => i.style.width !== '0%'), `ticking a subject should move the tracker at once, got ${await track()}`);
  await hb.click('#section-tools [data-action="undo"]');
  check(await hb.evaluate(() => { const d = document.querySelector('#sel-degree'); const p = document.querySelector('#dock .progress'); return p.getBoundingClientRect().top > d.getBoundingClientRect().bottom - 1 && getComputedStyle(document.getElementById('tracker')).display === 'none' && document.querySelector('#guide summary .guide-pin') === null; }), 'the dock should keep its progress and the tracker on a second line on a wide screen');
  await hb.setViewportSize({ width: 900, height: 900 });
  check(await hb.evaluate(() => getComputedStyle(document.getElementById('dock-track')).display === 'none' && document.querySelectorAll('#tracker .track-item').length === 4 && document.getElementById('tracker').getBoundingClientRect().height > 0), 'on a narrow screen the tracker should sit under the advisory instead');
  await hb.setViewportSize({ width: 1440, height: 1000 });
  // readiness counts what is settled, and one press moves a subject out of a session it does not run in
  const ready = () => hb.$eval('#advisory .adv-ready b', b => b.textContent);
  const r0 = await ready();
  check(/^\d+%$/.test(r0) && +r0.replace('%', '') === Math.round((400 - await hb.evaluate(() => WSLSA.context().risks.pending.reduce((a, x) => a + x.cp, 0))) / 4), `readiness should be the share of the degree that is settled, got ${r0}`);
  const tortsFix = await hb.evaluate(() => WSLSA.context().slots.find(x => x.code === 'LAWS 2013').id);
  await hb.selectOption(`#slot-${tortsFix} .move-sel`, '2|Autumn');
  check(+(await ready()).replace('%', '') < +r0.replace('%', '') && /LAWS 2013 \(not offered in Autumn\)/.test(await hb.textContent('#advisory .adv-fix')), `a subject where it does not run should lower readiness and be offered a fix, got ${await ready()}`);
  await hb.evaluate(() => document.querySelector('[data-action="plan-fix"]').click());
  const fixed = await hb.evaluate(() => { const c = WSLSA.context(); const x = c.slots.find(y => y.code === 'LAWS 2013'); return { at: x.year + x.session, none: c.risks.notOffered.length, over: c.risks.overload.length, fix: !!document.querySelector('#advisory .adv-fix'), total: c.totalCP }; });
  check(/Spring$/.test(fixed.at) && fixed.none === 0 && fixed.over === 0 && !fixed.fix && fixed.total === 400 && await ready() === r0, `the fix should move it to a session it runs in with room, got ${JSON.stringify(fixed)}`);
  await hb.click('#section-tools [data-action="undo"]');
  await hb.click('#section-tools [data-action="undo"]');
  check(await hb.evaluate(() => !WSLSA.context().edit), 'Undo should take the fix and the move back');
  // an edited pathway moves to the pre-2027 structure and back exactly as it was
  const torts = await hb.evaluate(() => WSLSA.context().slots.find(x => x.code === 'LAWS 2013').id);
  await hb.selectOption(`#slot-${torts} .move-sel`, '2|Spring');
  const edited = await hb.evaluate(() => JSON.stringify(WSLSA.custom().slots));
  await hb.selectOption('#sel-cohort', 'pre2027');
  let v = await sum();
  check(v.edit && v.cohort === 'pre2027' && v.cores === '- - -' && v.llb === 8 && v.total === 400 && v.guide === 0, `an edited pathway should move to the pre-2027 structure, got ${JSON.stringify(v)}`);
  check(await hb.evaluate(() => WSLSA.state().cohortFor['2785|BASE'] === 'pre2027'), 'the pathway should remember the Handbook chosen while it is edited');
  await hb.selectOption('#sel-cohort', '2027');
  v = await sum();
  check(v.cores === '3A 5A 5S' && v.llb === 5 && v.guide === 0 && await hb.evaluate(() => JSON.stringify(WSLSA.custom().slots)) === edited, `switching back should leave the edited pathway exactly as it was, got ${JSON.stringify(v)}`);
  // a completed core stays, LLB Alternates chosen in its place stay, and only spare open slots become cores again
  await hb.selectOption('#sel-cohort', 'pre2027');
  const stands = await hb.evaluate(() => WSLSA.context().slots.filter(x => x.newCore).map(x => x.id));
  check(stands.length === 3, `three slots should stand in for the 2027-only cores, got ${stands.length}`);
  await hb.click(`#slot-${stands[0]} [data-action="picker-open"]`);
  await hb.fill('#pick-q', 'LAWS 4010');
  await hb.click('#pick-results [data-action="cpick"][data-code="LAWS 4010"]');
  await hb.selectOption('#sel-cohort', '2027');
  v = await sum();
  check(v.llb === 5 && v.total === 400 && !/-/.test(v.cores) && await hb.evaluate(() => { const c = WSLSA.context(); const x = c.slots.find(y => y.code === 'LAWS 4010'); return !!x && x.orig.kind === 'llb' && !x.replaced; }), `an LLB Alternate chosen in a stand-in slot should stay an LLB Alternate under 2027, got ${JSON.stringify(v)}`);
  // Reset Plan keeps the Handbook on screen, and Undo restores the edited copy
  await hb.selectOption('#sel-cohort', 'pre2027');
  await hb.click('[data-action="reset"]');
  v = await sum();
  check(!v.edit && v.cohort === 'pre2027' && v.llb === 8 && /Undo/.test(await hb.textContent('#toast')), `Reset Plan should keep the Handbook on screen, got ${JSON.stringify(v)}`);
  await hb.click('#section-tools [data-action="undo"]');
  v = await sum();
  check(v.edit && v.cohort === 'pre2027' && await hb.evaluate(() => WSLSA.context().slots.some(x => x.code === 'LAWS 4010')), 'Undo should bring the edited pathway back after a reset');
  await hb.click('[data-action="reset"]');
  await hb.selectOption('#sel-cohort', '2027');
  // the credit breakdown follows the Handbook, on screen and on paper
  const parts = () => hb.$$eval('#details .structure-row:not(.structure-total):not(.structure-done)', r => r.map(x => x.textContent.replace(/\s+/g, ' ').trim()));
  check((await parts()).some(t => /^Core ?310 CP/.test(t)) && (await parts()).some(t => /^LLB Alternate Subjects ?50 CP/.test(t)), `the 2027 breakdown should read 310 and 50, got ${(await parts()).join(' | ')}`);
  await hb.selectOption('#sel-cohort', 'pre2027');
  check((await parts()).some(t => /^Core ?280 CP/.test(t)) && (await parts()).some(t => /^LLB Alternate Subjects ?80 CP/.test(t)) && !!(await hb.$('#details .structure-note')), `the pre-2027 breakdown should read 280 and 80, got ${(await parts()).join(' | ')}`);
  const paper = await hb.evaluate(() => { WSLSA.preparePrint({ mode: 'A', orient: 'portrait' }); return document.querySelector('#print-root .pd-structure').textContent; });
  check(/Pre-2027 structure: Core 280 CP/.test(paper) && /LLB Alternate Subjects 80 CP/.test(paper), `the PDF should carry the pre-2027 breakdown, got ${paper}`);
  await hb.evaluate(() => WSLSA.select('2848|BASE'));
  await hb.selectOption('#sel-cohort', 'pre2027');
  check((await parts()).some(t => /^Core ?160 CP/.test(t)) && (await parts()).some(t => /^LLB Alternate Subjects ?80 CP/.test(t)), `2848 should read 160 and 80 before 2027, got ${(await parts()).join(' | ')}`);
  await hb.selectOption('#sel-cohort', '2027');
  await hb.evaluate(() => WSLSA.select('2785|BASE'));
  await hb.selectOption('#sel-cohort', '2027');

  // a record of 250 CP from before 2027: only history in the plan, 150 CP in the guide
  const TAKEN = [
    [2024, 'Autumn', ['ACCT 1005', 'LAWS 1003', 'LAWS 2004', 'MATH 1030']], [2024, 'Spring', ['ACCT 1007', 'ECON 2002', 'LAWS 1009', 'LAWS 2013']],
    [2025, 'Autumn', ['ECON 1011', 'LAWS 2012', 'ACCT 1010', 'ACCT 2005']], [2025, 'Spring', ['LAWS 2003', 'ACCT 2001', 'ACCT 3003', 'FINC 3014']],
    [2026, 'Autumn', ['LAWS 2001', 'ACCT 3007', 'ACCT 3011', 'FINC 3004']], [2026, 'Spring', ['LAWS 4008', 'ACCT 3001', 'ACCT 3006', 'LAWS 2008', 'LAWS 3067']],
  ];
  const lines = ['Subject Results', '2785 - Bachelor of Accounting/Bachelor of Laws'];
  TAKEN.forEach(t => t[2].forEach(c => lines.push(t[0] + ' ' + c.replace(' ', '') + ' Subject C 65 10 ✓ ' + t[1])));
  lines.push('Total Credit Points Required 400');
  await hb.click('[data-action="progress-open"]');
  await hb.evaluate(r => WSLSA.importPdfLines(r, '2026-11-09T10:00:00', 'results.pdf'), lines);
  await hb.click('#progress-apply');
  const imp = await hb.evaluate(() => {
    const c = WSLSA.context();
    const g = WSLSA.guide();
    const by = k => g.items.filter(r => r.kind === k);
    return {
      cohort: document.getElementById('sel-cohort').value, done: c.doneCP, slots: c.slots.length, last: Math.max.apply(null, c.slots.map(x => x.year)),
      years: document.querySelectorAll('#grid .year').length, emptyAhead: Array.from(document.querySelectorAll('#year-4 .session, #year-5 .session')).every(x => !x.querySelector('.subj')),
      cp: g.cp, law: by('law').map(r => r.code).sort(), llb: by('llb').length, other: g.items.filter(r => r.kind !== 'law' && r.kind !== 'llb').map(r => r.code || r.label),
      codes: g.items.map(r => r.code).filter(Boolean), super: (c.slots.find(x => x.code === 'LAWS 3067').orig || {}).kind, notes: g.items.filter(r => r.was).map(r => r.code + '<' + r.was).sort(),
    };
  });
  check(imp.cohort === 'pre2027' && imp.done === 250 && imp.slots === 25 && imp.last === 3 && imp.years === 5 && imp.emptyAhead, `the import should hold 250 CP of history and leave 2027 and 2028 empty, got ${JSON.stringify(imp)}`);
  check(imp.cp === 150 && JSON.stringify(imp.law) === JSON.stringify(['LAWS 2015', 'LAWS 3018', 'LAWS 3045', 'LAWS 3081', 'LAWS 3082', 'LAWS 4004', 'LAWS 4013', 'LAWS 4014', 'LAWS 4015']) && imp.llb === 6 && imp.other.length === 0, `the guide should hold nine Law cores and six LLB Alternates, 150 CP, got ${JSON.stringify(imp)}`);
  check(['LAWS 1010', 'LAWS 2018', 'FINC 2003', 'LAWS 2019', 'LAWS 3099', 'LAWS 3101', 'LAWS 3102', 'LAWS 2020', 'LAWS 3100', 'LAWS 3103'].every(c => imp.codes.indexOf(c) < 0), `no subject already counted should be asked for again, got ${imp.codes.join(' ')}`);
  check(imp.super === 'pool' && imp.notes.length === 0 && /Pre-2027 subject · last offered 2028 · after that, LAWS 2020/.test(await hb.evaluate(() => document.getElementById('guide').textContent)), `LAWS 3067 should count as an Alternate Accounting subject first, and the pre-2027 subjects should be suggested under their own codes, got ${imp.super} ${imp.notes}`);
  // history shows its pre-2027 codes with no 2027 offering warnings
  const past = await hb.evaluate(() => { const c = WSLSA.context(); const s = c.slots.find(x => x.code === 'LAWS 1009'); const el = document.getElementById('slot-' + s.id); return { flags: Array.from(el.querySelectorAll('.flag')).map(f => f.textContent), pills: el.querySelector('.pills').textContent, risks: c.risks.notOffered.length + c.risks.tbc.length }; });
  check(past.flags.indexOf('Counts for LAWS 1010') >= 0 && past.pills === '' && past.risks === 0, `a completed pre-2027 subject should say what it counts for and carry no offering warnings, got ${JSON.stringify(past)}`);
  // empty sessions stay in every view
  for (const view of ['remaining', 'action']) {
    await hb.click(`.view-modes [data-view="${view}"]`);
    const shown = await hb.evaluate(() => ['year-4', 'year-5'].every(id => { const y = document.getElementById(id); return y && getComputedStyle(y).display !== 'none' && Array.from(y.querySelectorAll('.session')).every(x => !x.classList.contains('view-clear') && /Empty session/.test(x.textContent)); }));
    check(shown, `the ${view} view should keep the empty sessions ahead in sight`);
  }
  await hb.click('.view-modes [data-view="all"]');
  // the plan and its guide travel in a link, with the sessions ahead and what is still needed
  const link = await hb.evaluate(() => WSLSA.planUrl());
  check(/\/yr=5\//.test(await hb.evaluate(() => WSLSA.linkText())) && /\/nd=/.test(await hb.evaluate(() => WSLSA.linkText())), `a link should carry the empty years and the list still needed, got ${await hb.evaluate(() => WSLSA.linkText())}`);
  const need = await hb.evaluate(() => JSON.stringify(WSLSA.custom().need));
  const other = await newPage(browser);
  await other.goto(link);
  await other.evaluate(() => WSLSA.setNow('2026-11-09'));
  check(await other.evaluate(() => JSON.stringify(WSLSA.custom().need)) === need && await other.evaluate(() => WSLSA.custom().years) === 5 && await other.evaluate(() => document.getElementById('sel-cohort').value) === 'pre2027', 'a link should open the same plan, guide and Handbook');
  await other.close();
  // a backup restores it too
  const backup = await hb.evaluate(() => JSON.stringify({ app: 'wslsa-2027-pathway-explorer', version: 1, state: WSLSA.state() }));
  check(/"need":\[\{/.test(backup) && /"years":5/.test(backup), 'a backup should hold the list still needed and the years ahead');
  // the Handbook comparison, side by side
  await hb.click('#guide [data-action="handbook-compare"]');
  const hc = await hb.$$eval('.hc-table tbody tr', rows => rows.map(r => Array.from(r.children).map(c => c.textContent.replace(/\s+/g, ' ').trim())));
  check(hc[0][1] === '280 CP' && hc[0][2] === '310 CP' && /^80 CP/.test(hc[1][1]) && /^50 CP/.test(hc[1][2]), `the comparison should show both structures, got ${JSON.stringify(hc.slice(0, 2))}`);
  check(/^9 /.test(hc[2][1]) && /^12 /.test(hc[2][2]) && /LAWS 2019/.test(hc[2][2]) && hc[4][1] === '6' && hc[4][2] === '3' && hc[5][1] === '150 CP', `the comparison should count what is left under each Handbook, got ${JSON.stringify(hc.slice(2))}`);
  check(/adds LAWS 2019, LAWS 3099, LAWS 3102/.test(await hb.textContent('.hc-warn')) && await hb.$eval('[data-action="hc-switch"][data-v="pre2027"]', b => b.disabled), 'the comparison should warn what the move adds and mark the Handbook shown');
  await hb.click('[data-action="hc-switch"][data-v="2027"]');
  const moved = await hb.evaluate(() => { const g = WSLSA.guide(); return { cohort: document.getElementById('sel-cohort').value, law: g.items.filter(r => r.kind === 'law').length, llb: g.items.filter(r => r.kind === 'llb').length, cp: g.cp, need: WSLSA.custom().need.length }; });
  check(moved.cohort === '2027' && moved.law === 12 && moved.llb === 3 && moved.cp === 150 && moved.need === 15, `an imported plan's guide should move to the 2027 structure, got ${JSON.stringify(moved)}`);
  await hb.selectOption('#sel-cohort', 'pre2027');
  const back = await hb.evaluate(() => { const g = WSLSA.guide(); return { law: g.items.filter(r => r.kind === 'law').length, llb: g.items.filter(r => r.kind === 'llb').length, cp: g.cp }; });
  check(back.law === 9 && back.llb === 6 && back.cp === 150, `and back again to nine cores and six LLB Alternates, got ${JSON.stringify(back)}`);
  // + Add from the guide puts the subject in the session chosen, and the count drops at once
  await hb.evaluate(() => { const d = document.querySelector('#guide .guide-sess'); d.open = true; });
  const first = await hb.evaluate(() => { const g = WSLSA.guide(); return { code: g.items[0].code, at: g.items[0].y + '|' + g.items[0].s, sel: document.getElementById('gi-0').value }; });
  check(first.sel === first.at, 'the session beside a guide item should start at the one suggested');
  await hb.click('#guide [data-action="guide-add"][data-gi="0"]');
  check(await hb.evaluate(c => WSLSA.context().slots.some(x => x.code === c && x.year === 4) && WSLSA.guide().cp === 140, first.code) && /140 CP/.test(await hb.textContent('#guide .guide-counts')), 'adding from the guide should place the subject and update the count');
  // one suggestion can be dismissed on its own: the rest stay, nothing takes its place, and it comes back
  const g0 = await hb.evaluate(() => { const g = WSLSA.guide(); return { n: g.items.length, cp: g.cp, codes: g.items.map(r => r.code || r.kind).join(','), buttons: document.querySelectorAll('#guide [data-action="guide-dismiss"]').length }; });
  check(g0.buttons === g0.n, `every suggestion should have its own Dismiss, got ${g0.buttons} for ${g0.n}`);
  const gone = await hb.evaluate(() => { const g = WSLSA.guide(); const i = g.items.findIndex(r => r.code === 'LAWS 3018'); return i; });
  await hb.evaluate(() => document.querySelectorAll('#guide .guide-sess').forEach(d => { d.open = true; }));
  await hb.click(`#guide [data-action="guide-dismiss"][data-gi="${gone}"]`);
  let g1 = await hb.evaluate(() => { const g = WSLSA.guide(); return { n: g.items.length, cp: g.cp, has: g.items.some(r => r.code === 'LAWS 3018'), open: g.items.filter(r => r.kind === 'open').length, skip: WSLSA.custom().skip, text: document.querySelector('#guide .guide-skipped').textContent, link: WSLSA.linkText() }; });
  check(g1.n === g0.n - 1 && g1.cp === g0.cp - 10 && !g1.has && g1.open === 0 && JSON.stringify(g1.skip) === '[{"code":"LAWS 3018","o":""}]' && /1 suggestion dismissed/.test(g1.text) && /\/sk=LAWS3018/.test(g1.link), `dismissing one suggestion should take only that one out, got ${JSON.stringify(g1)}`);
  const llbAt = await hb.evaluate(() => WSLSA.guide().items.findIndex(r => r.kind === 'llb'));
  await hb.evaluate(() => document.querySelectorAll('#guide .guide-sess').forEach(d => { d.open = true; }));
  await hb.click(`#guide [data-action="guide-dismiss"][data-gi="${llbAt}"]`);
  g1 = await hb.evaluate(() => { const g = WSLSA.guide(); return { n: g.items.length, llb: g.items.filter(r => r.kind === 'llb').length, skipped: g.skipped }; });
  check(g1.n === g0.n - 2 && g1.llb === 5 && g1.skipped === 2, `dismissing an open choice should take one of them out, got ${JSON.stringify(g1)}`);
  await hb.click('#guide [data-action="guide-restore"]');
  check(await hb.evaluate(() => { const g = WSLSA.guide(); return g.items.map(r => r.code || r.kind).join(','); }) === g0.codes && !(await hb.$('#guide .guide-skipped')), 'Restore should bring the dismissed suggestions back');
  await hb.click('#section-tools [data-action="undo"]');
  check(await hb.evaluate(() => WSLSA.custom().skip.length) === 2, 'Undo should step back through the restore');
  await hb.click('#section-tools [data-action="undo"]');
  await hb.click('#section-tools [data-action="undo"]');
  check(await hb.evaluate(() => WSLSA.custom().skip.length === 0 && WSLSA.guide().items.length) === g0.n, 'Undo should bring each dismissed suggestion back in turn');
  // the guide pins to the bottom of the screen as a tray, and stays pinned after a reload
  await hb.click('#guide [data-action="guide-pin"]');
  const tray = await hb.evaluate(() => { const g = document.getElementById('guide'); const r = g.getBoundingClientRect(); return { fixed: getComputedStyle(g).position, bottom: Math.round(innerHeight - r.bottom), tall: r.height <= innerHeight * 0.38 + 1, open: document.getElementById('guide-box').open, saved: WSLSA.state().guidePinned }; });
  check(tray.fixed === 'fixed' && tray.bottom === 0 && tray.tall && tray.open && tray.saved, `the pinned guide should sit at the bottom of the screen, got ${JSON.stringify(tray)}`);
  await hb.evaluate(() => window.scrollTo(0, document.getElementById('year-5').getBoundingClientRect().top + scrollY - 100));
  check(await hb.evaluate(() => { const r = document.getElementById('guide').getBoundingClientRect(); return r.top < innerHeight && r.bottom <= innerHeight + 1; }), 'the pinned guide should stay in sight beside Year 5');
  await hb.click('#guide [data-action="guide-pin"]');
  check(await hb.evaluate(() => getComputedStyle(document.getElementById('guide')).position !== 'fixed' && !WSLSA.state().guidePinned), 'unpinning should put the guide back in the page');
  // a session's own load: the overload check and the guide's suggestions follow it
  await hb.click('#year-4 .session[data-s="Autumn"] [data-action="session-load"][data-v="20"]');
  const load = await hb.evaluate(() => { const g = WSLSA.guide(); const k = 3 * 3; return { text: document.querySelector('#year-4 .session[data-s="Autumn"] .load-btn').textContent, inAutumn: g.items.filter(r => r.k === k).reduce((a, r) => a + r.cp, 0), loads: WSLSA.custom().loads }; });
  check(load.text === '10 / 20 CP' && load.inAutumn <= 10 && load.loads[9] === 20, `a session set to 20 CP should be planned to 20 CP, got ${JSON.stringify(load)}`);
  await hb.click('#year-4 .session[data-s="Spring"] [data-action="session-load"][data-v="0"]');
  check(await hb.evaluate(() => WSLSA.guide().items.every(r => r.k !== 10)) && /Leave of Absence/.test(await hb.textContent('#year-4 .session[data-s="Spring"] .slot-empty')) && /\/ld=9\.20,10\.0/.test(await hb.evaluate(() => WSLSA.linkText())), 'a Leave of Absence should take no suggestions, and loads should travel in a link');
  await hb.click('#section-tools [data-action="undo"]');
  await hb.click('#section-tools [data-action="undo"]');
  check(await hb.evaluate(() => Object.keys(WSLSA.custom().loads).length === 0), 'Undo should take the session loads back');
  // a subject in two pools can count towards either
  const sup = await hb.evaluate(() => WSLSA.context().slots.find(x => x.code === 'LAWS 3067').id);
  if (await hb.$eval('#year-3', y => y.classList.contains('is-folded'))) await hb.click('#year-3 .year-toggle');
  check(/^Pool: Accounting Alternate ⇄ LLB Alternate$/.test(await hb.textContent(`#slot-${sup} .flag-pool`)) && await hb.$eval(`#slot-${sup} .flag-pool b`, b => b.textContent) === 'Accounting Alternate', `LAWS 3067 should offer its two pools, got ${await hb.textContent(`#slot-${sup} .flag-pool`)}`);
  await hb.click(`#slot-${sup} .flag-pool`);
  const pooled = await hb.evaluate(() => { const c = WSLSA.context(); const g = WSLSA.guide(); const x = c.slots.find(y => y.code === 'LAWS 3067'); return { kind: x.orig.kind, llb: g.items.filter(r => r.kind === 'llb').length, choice: g.items.filter(r => r.kind === 'choice').length, cp: g.cp, bold: document.querySelector('#slot-' + x.id + ' .flag-pool b').textContent }; });
  check(pooled.kind === 'llb' && pooled.llb === 5 && pooled.choice === 1 && pooled.cp === 140 && pooled.bold === 'LLB Alternate', `counting LAWS 3067 as an LLB Alternate should leave five to choose and one Accounting Alternate, got ${JSON.stringify(pooled)}`);
  await hb.click('#section-tools [data-action="undo"]');
  // a subject moved across 2027 takes the code a student enrols in that year
  await hb.evaluate(() => { const d = document.querySelectorAll('#guide .guide-sess'); d.forEach(x => { x.open = true; }); });
  // LAWS 2015 was added to 2027 above: it keeps its pre-2027 code while it is offered (to 2028), and is LAWS 2020 after
  const ethId = () => hb.evaluate(() => { const x = WSLSA.context().slots.find(y => y.code === 'LAWS 2020' || y.code === 'LAWS 2015'); return x ? x.id + ':' + x.code + ':' + x.year : ''; });
  check(/:LAWS 2015:4$/.test(await ethId()) && /Pre-2027 subject/.test(await hb.textContent('#slot-' + (await ethId()).split(':')[0])), `a pre-2027 subject placed in 2027 should keep its code while it is offered, got ${await ethId()}`);
  await hb.selectOption(`#slot-${(await ethId()).split(':')[0]} .move-sel`, '6|Autumn');
  check(/:LAWS 2020:6$/.test(await ethId()) && /Replaces Pre-2027 LAWS 2015/.test(await hb.textContent('#slot-' + (await ethId()).split(':')[0])), `moved past its final offering it should be the 2027 subject that replaces it, got ${await ethId()}`);
  await hb.selectOption(`#slot-${(await ethId()).split(':')[0]} .move-sel`, '5|Spring');
  check(/:LAWS 2015:5$/.test(await ethId()) && await hb.evaluate(() => !WSLSA.context().risks.dupes.length), `and the pre-2027 subject again in 2028, never both, got ${await ethId()}`);
  // paper: what is unplaced has its own box, and a year with nothing in it takes no room
  const gap = await hb.evaluate(() => { WSLSA.preparePrint({ mode: 'A', orient: 'portrait' }); const r = document.getElementById('print-root'); return r.querySelectorAll('.pd-year').length + '|' + r.querySelectorAll('.pd-empty').length; });
  check(/^4\|/.test(gap), `the PDF should print the four years in use, got ${gap}`);
  const pd = await hb.evaluate(() => { WSLSA.preparePrint({ mode: 'A', orient: 'portrait' }); const r = document.getElementById('print-root'); return { years: r.querySelectorAll('.pd-year').length, box: (r.querySelector('.pd-unplaced') || {}).textContent || '', bad: /NaN|undefined|\[object/.test(r.textContent) }; });
  check(pd.years === 4 && /Remaining unplaced subjects · 140 CP still to place/.test(pd.box) && /Autumn 2027: LAWS 4013/.test(pd.box) && /Years 4 and 6 have nothing in them yet/.test(pd.box) && !pd.bad, `the PDF should list what is unplaced under its suggested sessions, got ${JSON.stringify(pd).slice(0, 300)}`);
  // starting an own plan again keeps its Handbook
  await hb.click('[data-action="reset"]');
  const rebuilt = await hb.evaluate(() => { const c = WSLSA.context(); return { cohort: document.getElementById('sel-cohort').value, cores: c.slots.filter(x => ['LAWS 2019', 'LAWS 3099', 'LAWS 3102'].indexOf(x.code) >= 0).length, llb: c.slots.filter(x => x.orig && x.orig.kind === 'llb').length, guide: !!c.guide }; });
  check(rebuilt.cohort === 'pre2027' && rebuilt.cores === 0 && rebuilt.llb === 8 && !rebuilt.guide, `a plan started again should stay in its Handbook, got ${JSON.stringify(rebuilt)}`);
  check(hb.errors.length === 0, 'Handbook checks console errors: ' + hb.errors.join('; '));
  await hb.close();
  }

  check(page.errors.length === 0, 'console errors: ' + page.errors.join('; '));
  await browser.close();
  console.log(`\n${passes} checks passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
