/* Every outside address the explorer links to (the Handbook pages, the University's dates, WSLSA) should still open.
   A site that turns automated checks away (403, 429) is reported but does not fail the check, as it may well work
   for a person.   node tests/links.cjs */
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'dist', 'wslsa-pathway-explorer.html'), 'utf8');
const urls = Array.from(new Set((html.match(/https:\/\/[a-z0-9.-]+\.(?:edu\.au|com\.au|gov\.au)[^"'\s<>\\)]*/gi) || [])
  .map(u => u.replace(/[.,;]+$/, '')))).sort();

(async () => {
  const bad = [];
  const shy = [];
  for (const url of urls) {
    let status = 0;
    try {
      const r = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'Mozilla/5.0 (link check for the WSLSA Degree Explorer)' } });
      status = r.status;
    } catch (e) { status = -1; }
    if (status === 403 || status === 429) shy.push(status + ' ' + url);
    else if (status < 200 || status >= 400) bad.push((status === -1 ? 'no answer' : status) + ' ' + url);
  }
  console.log('checked ' + urls.length + ' links');
  shy.forEach(l => console.log('WARN turned the check away: ' + l));
  bad.forEach(l => console.log('FAIL ' + l));
  process.exit(bad.length ? 1 : 0);
})();
