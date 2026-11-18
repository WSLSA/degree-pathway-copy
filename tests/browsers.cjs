/* The explorer in every browser engine students use: Chromium (Chrome, Edge), WebKit (Safari on iPhone, iPad and Mac)
   and Firefox, on a laptop and on a phone. The full checks in e2e.cjs run in Chromium; these walk through what a
   student does most, in each engine, and fail on any page error.

   node tests/browsers.cjs                    # every engine
   node tests/browsers.cjs webkit firefox     # some of them
   APP_URL=https://wslsa.github.io/degree-pathway-copy/ node tests/browsers.cjs   # the live site
   On a failure, a screenshot of the page is saved to test-results/. */
const path = require('path');
const fs = require('fs');
const pw = require('playwright');

const ROOT = path.resolve(__dirname, '..');
// APP_URL runs it against a published copy, such as the live site, in place of the local build
const APP = process.env.APP_URL || 'file:///' + path.join(ROOT, 'dist', 'wslsa-pathway-explorer.html').replace(/\\/g, '/');
const OUT = path.join(ROOT, 'test-results');
const ENGINES = process.argv.slice(2).length ? process.argv.slice(2) : ['chromium', 'webkit', 'firefox'];
const RESULTS = [
  'Subject Results', '2785 - Bachelor of Accounting/Bachelor of Laws',
  '2024 LAWS1003 Fundamentals of Australian Law C 66 10 ✓ Autumn', '2024 ACCT1005 Accounting in Context D 73 10 ✓ Autumn',
  '2024 LAWS2004 Criminal Law C 64 10 ✓ Autumn', '2024 LAWS1009 Legal Analysis and Critique D 72 10 ✓ Spring',
  '2025 LAWS2003 Contracts C 69 10 ✓ Autumn', '2025 ECON2002 Corporate Financial Management P 62 10 ✓ Spring',
  'Total Credit Points Required 400',
];

let failures = 0;
let passes = 0;
function check(ok, msg) { if (ok) passes++; else { failures++; console.log('FAIL', msg); } }

async function walk(browser, engine, device) {
  const tag = engine + (device ? ' ' + device : ' laptop');
  const opts = device ? Object.assign({}, pw.devices[device]) : { viewport: { width: 1360, height: 900 } };
  if (engine === 'firefox') delete opts.isMobile; // Firefox has no mobile emulation; its size and touch still apply
  const context = await browser.newContext(Object.assign(opts, { reducedMotion: 'reduce' }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', d => d.accept());
  await page.addInitScript(() => { try { localStorage.setItem('wslsa-2027-tour-dismissed', '1'); } catch (e) { /* about:blank */ } });
  const step = async (name, fn) => {
    try { await fn(); } catch (e) {
      failures++;
      console.log('FAIL', tag + ': ' + name + ': ' + e.message.split('\n')[0]);
      fs.mkdirSync(OUT, { recursive: true });
      await page.screenshot({ path: path.join(OUT, (tag + ' ' + name).replace(/[^a-z0-9]+/gi, '-') + '.png'), fullPage: false }).catch(() => {});
    }
  };
  const press = sel => page.evaluate(s => { const e = document.querySelector(s); if (!e) throw new Error('no ' + s); e.click(); }, sel);
  const ctx = () => page.evaluate(() => { const c = WSLSA.context(); return { total: c.totalCP, n: c.slots.length, done: c.doneCP, edit: !!c.edit }; });

  await step('opens', async () => {
    await page.goto(APP);
    await page.waitForFunction(() => !!window.WSLSA && document.querySelectorAll('#grid .subj').length > 0);
    await page.evaluate(() => WSLSA.setNow('2026-11-09'));
    check(/WSLSA Degree Explorer/.test(await page.title()), tag + ': the title should name the site');
  });
  await step('every degree draws', async () => {
    const bad = await page.evaluate(() => {
      const seen = {};
      return WSLSA.keys().filter(k => !seen[k.split('|')[0]] && (seen[k.split('|')[0]] = 1)).map(k => {
        WSLSA.select(k);
        const c = WSLSA.context();
        const cards = document.querySelectorAll('#grid .subj').length;
        return c.totalCP === c.deg.cp && cards === c.slots.length && !/undefined|NaN|\[object/.test(document.getElementById('app').innerText) ? '' : k + ' ' + c.totalCP + '/' + c.deg.cp + ' ' + cards + '/' + c.slots.length;
      }).filter(Boolean);
    });
    check(!bad.length, tag + ': every degree should draw its whole pathway, got ' + bad.join('; '));
  });
  await step('ticks and undo', async () => {
    await page.evaluate(() => WSLSA.select('2785|BASE'));
    await press('#grid .tick input');
    check((await ctx()).done === 10, tag + ': ticking a subject should count 10 CP');
    await press('#section-tools [data-action="undo"]');
    check((await ctx()).done === 0, tag + ': Undo should untick it');
  });
  await step('edits a card', async () => {
    const id = await page.evaluate(() => WSLSA.context().slots.find(s => s.code === 'LAWS 2013').id);
    await press('#slot-' + id + ' .subj-more');
    check(await page.evaluate(i => document.getElementById('slot-' + i).classList.contains('is-open'), id), tag + ': Edit should open the card\'s tools');
    await page.evaluate(i => { const s = document.querySelector('#slot-' + i + ' .move-sel'); s.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); s.value = '2|Spring'; s.dispatchEvent(new Event('change', { bubbles: true })); }, id);
    const c = await ctx();
    check(c.edit && c.total === 400 && await page.evaluate(() => WSLSA.context().slots.some(s => s.code === 'LAWS 2013' && s.year === 2 && s.session === 'Spring')), tag + ': Move to should move the card');
    await press('#section-tools [data-action="undo"]');
    check(!(await ctx()).edit, tag + ': Undo should give the pathway back');
  });
  await step('switches Handbook', async () => {
    await page.selectOption('#sel-cohort', 'pre2027');
    check(await page.evaluate(() => WSLSA.context().slots.filter(s => s.kind === 'llb').length === 8), tag + ': the pre-2027 structure should have eight LLB Alternate slots');
    await page.selectOption('#sel-cohort', '2027');
  });
  await step('folds a year from its banner', async () => {
    await page.evaluate(() => document.querySelector('#year-2 .year-bar h2').click());
    check(await page.evaluate(() => document.getElementById('year-2-body').hidden), tag + ': pressing a year\'s banner should fold it');
    await page.evaluate(() => document.querySelector('#year-2 .year-bar h2').click());
  });
  await step('picks a subject', async () => {
    const llb = await page.evaluate(() => WSLSA.context().slots.find(s => s.kind === 'llb' && s.pending).id);
    await press('#slot-' + llb + ' [data-action="picker-open"]');
    await page.waitForSelector('#pick-q');
    await page.fill('#pick-q', 'LAWS');
    await page.waitForSelector('#pick-results [data-action="pick"]:not([disabled])');
    const code = await page.evaluate(() => document.querySelector('#pick-results [data-action="pick"]:not([disabled])').dataset.code);
    await press('#pick-results [data-action="pick"]:not([disabled])');
    check(await page.evaluate(([i, c]) => { const s = WSLSA.context().byId[i]; return !s.pending && s.code === c; }, [llb, code]), tag + ': choosing from the picker should fill the slot');
  });
  await step('imports a record and uses the guide', async () => {
    await press('[data-action="progress-open"]');
    await page.evaluate(r => WSLSA.importPdfLines(r, '2026-11-09T10:00:00', 'results.pdf'), RESULTS);
    await press('#progress-apply');
    await page.waitForFunction(() => !!WSLSA.guide());
    const g = await page.evaluate(() => WSLSA.guide().cp);
    await page.evaluate(() => { document.querySelectorAll('#guide .guide-sess').forEach(d => { d.open = true; }); });
    await press('#guide [data-action="guide-add"]');
    check(await page.evaluate(() => WSLSA.guide().cp) === g - 10, tag + ': + Add should place a suggestion');
    await press('#guide [data-action="guide-dismiss"]');
    check(await page.evaluate(() => WSLSA.guide().cp) === g - 20, tag + ': Dismiss should take one suggestion out');
  });
  await step('keeps the plan through a reload and a share link', async () => {
    const before = await ctx();
    const link = await page.evaluate(() => WSLSA.planUrl());
    await page.reload();
    await page.waitForFunction(() => !!window.WSLSA && document.querySelectorAll('#grid .subj').length > 0);
    check(JSON.stringify(await ctx()) === JSON.stringify(before), tag + ': a reload should keep the plan');
    const other = await context.newPage();
    other.on('pageerror', e => errors.push(e.message));
    await other.goto(link);
    await other.waitForFunction(() => !!window.WSLSA && document.querySelectorAll('#grid .subj').length > 0);
    check(await other.evaluate(() => WSLSA.context().doneCP) === before.done, tag + ': a share link should open the same plan');
    await other.close();
  });
  await step('dark mode and the PDF', async () => {
    await press('[data-action="theme-toggle"]');
    check(await page.evaluate(() => document.documentElement.dataset.theme) === 'dark', tag + ': the theme button should switch to dark');
    await press('[data-action="theme-toggle"]');
    const doc = await page.evaluate(() => WSLSA.buildPrintDoc({ mode: 'A' }));
    check(doc.length > 5000 && !/undefined|NaN|\[object/.test(doc.replace(/pd-plan">[^<]*</, '')), tag + ': the PDF guide should build');
  });
  if (device) {
    await step('fits the phone', async () => {
      await page.evaluate(() => window.scrollTo(0, 0));
      check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), tag + ': nothing should scroll sideways on a phone');
    });
  }
  check(!errors.length, tag + ': page errors: ' + errors.slice(0, 3).join(' | '));
  await context.close();
}

(async () => {
  for (const engine of ENGINES) {
    const browser = await pw[engine].launch();
    await walk(browser, engine, '');
    await walk(browser, engine, engine === 'webkit' ? 'iPhone 13' : engine === 'chromium' ? 'Pixel 7' : 'iPhone 13');
    await browser.close();
  }
  console.log(`\n${passes} checks passed, ${failures} failed (${ENGINES.join(', ')})`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
