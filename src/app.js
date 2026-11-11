/* WSLSA 2027 Degree Pathway Explorer.
   All data comes from the embedded JSON payload built by scripts/build_app.py from the WSLSA 2027
   Degree Guides workbook. No network calls; state lives in localStorage and the URL hash. */
(function () {
  'use strict';

  // ======================================================================== data
  const $ = (sel, root) => (root || document).querySelector(sel);
  const RAW = JSON.parse($('#wslsa-data').textContent);
  const META = RAW.meta;
  const PREREQS = RAW.prereqs || { subjects: {}, sequences: [] };
  const PRACTICE = RAW.practice || { areas: [], subjects: {} };
  const CAMPUS_NAMES = Object.assign({}, META.campuses, { TBC: 'Session not yet published for 2027' });
  const PRIMARY_CAMPUSES = ['PS', 'CA', 'PC', 'HA', 'BC', 'PE', 'LC'];
  const SESSIONS = ['Autumn', 'Spring'];
  // Students can add a Summer session after Spring in any year of their own plan. The 2027 guides
  // publish Autumn and Spring offerings only, so Summer subjects carry no session or campus data.
  const PLAN_SESSIONS = ['Autumn', 'Spring', 'Summer'];
  const LOAD_CP = { FT: 40, PT: 20 };
  // The intake these guides are for. It is read while a saved plan loads (a plan with past years goes by the year
  // the student started), so it is declared here, before the plan is read.
  const START_YEAR = 2027;
  const LAW_ENQUIRY = 'lawenquiry@westernsydney.edu.au';
  const MOD_KEY = /Mac|iPhone|iPad/.test(navigator.platform || '') ? 'Cmd' : 'Ctrl';
  const UNDO_KEYS = MOD_KEY + '+Z';
  const REDO_KEYS = MOD_KEY === 'Cmd' ? 'Cmd+Shift+Z' : 'Ctrl+Y';
  // Pre-2027 subjects and the 2027 subjects that replace them. Passing either one meets both: neither is added to
  // a plan that has the other, and either one meets a prerequisite that names the other.
  const LEGACY_EQUIVALENTS = {
    'LAWS 1009': 'LAWS 1010', 'LAWS 2004': 'LAWS 2018', 'LAWS 2001': 'LAWS 3101', 'LAWS 2015': 'LAWS 2020',
    'LAWS 4004': 'LAWS 3100', 'LAWS 4013': 'LAWS 3103', 'ECON 2002': 'FINC 2003',
  };
  const LEGACY_OF = {};
  Object.keys(LEGACY_EQUIVALENTS).forEach(function (old) { LEGACY_OF[LEGACY_EQUIVALENTS[old]] = old; });
  function sameAs(code) { const other = LEGACY_EQUIVALENTS[code] || LEGACY_OF[code]; return other ? [code, other] : [code]; }
  // Law core subjects that are new in 2027. A student who started earlier follows the pre-2027 structure, with
  // 160 CP of Law core and 80 CP of LLB Alternates, so these three are LLB Alternate slots in their plan instead.
  const NEW_2027_CORES = ['LAWS 2019', 'LAWS 3099', 'LAWS 3102'];
  const COHORT_LABEL = {
    pre2027: 'Pre-2027 Handbook (160 CP Law Core + 80 CP LLB Alternates)',
    2027: '2027 Handbook (190 CP Law Core + 50 CP LLB Alternates)',
  };
  // Pre-2027 subjects, known by code and title wherever a code is read, typed or shown
  const LEGACY = {
    'LAWS 1009': 'Legal Analysis and Critique', 'LAWS 2004': 'Criminal Law', 'LAWS 2001': 'Alternative Dispute Resolution',
    'LAWS 2015': 'Professional Responsibility and Legal Ethics', 'LAWS 4004': 'Criminal Procedure and Evidence',
    'LAWS 4013': 'Civil Procedure and Arbitration', 'ECON 2002': 'Corporate Financial Management',
  };
  // The code a subject not yet completed goes by in a session of a given calendar year. A student who started before
  // 2027 (past) and follows the pre-2027 structure keeps to the pre-2027 subject for as long as it is offered, up to its
  // final offering in PHASE_OUT, and takes the 2027 subject after that. A 2027 pathway shown in the pre-2027 structure
  // starts in 2027, so it shows the 2027 subjects and says what each replaces. A completed subject keeps the code it was
  // passed under, so this is never asked of one.
  function codeFor(code, cohort, year, past) {
    const old = LEGACY_EQUIVALENTS[code] ? code : LEGACY_OF[code];
    if (!old) return code;
    const last = past && PHASE_YEAR[old] ? PHASE_YEAR[old] : START_YEAR - 1;
    return cohort === 'pre2027' && year <= last ? old : LEGACY_EQUIVALENTS[old];
  }
  function startedBefore(start) { return !!start && start < START_YEAR; }
  function isNewCore(row) { return !!row && row.kind === 'fixed' && NEW_2027_CORES.indexOf(row.code) >= 0; }
  function cohortSet(name, value, note) {
    return '<fieldset class="cohort-set"><legend>Cohort Structure</legend>' + ['pre2027', '2027'].map(function (c) {
      return '<label class="check-row"><input type="radio" name="' + name + '" id="' + name + '-' + c + '" value="' + c + '"' + (value === c ? ' checked' : '') + '><span>' + COHORT_LABEL[c] + (note && note[c] ? ' <small>' + note[c] + '</small>' : '') + '</span></label>';
    }).join('') + '</fieldset>';
  }

  const DEG = {};
  const GLOBAL_BY_CODE = {}; // every subject in the workbook, across all degrees
  const DEGREES = RAW.degrees.map(function (d) {
    d.catalogue = d.catalogue.map(function (r) {
      return { component: r[0], level: r[1], code: r[2], title: r[3], autumn: r[4], spring: r[5], cp: r[6], source: r[7] };
    });
    d.byCode = {};
    d.byComp = {};
    d.components = [];
    d.catalogue.forEach(function (c) {
      if (!d.byCode[c.code]) d.byCode[c.code] = c;
      if (!d.byComp[c.component]) { d.byComp[c.component] = []; d.components.push(c.component); }
      d.byComp[c.component].push(c);
    });
    d.llbComponent = d.components.find(function (c) { return c.indexOf('LLB Alternate') === 0; });
    d.catalogue.forEach(function (c) { if (!GLOBAL_BY_CODE[c.code]) GLOBAL_BY_CODE[c.code] = c; });
    DEG[d.code] = d;
    return d;
  });

  const OPT = {};
  RAW.options.forEach(function (o) { OPT[o.pathwayKey] = o; });

  const PATH = {};
  Object.keys(RAW.pathways).forEach(function (key) {
    PATH[key] = RAW.pathways[key].map(function (r) {
      return {
        year: r[0], session: r[1] === 'A' ? 'Autumn' : 'Spring', slot: r[2], code: r[3], title: r[4], type: r[5],
        offered: r[6], cp: r[7], notes: r[8], kind: r[9], pool: r[10] || null,
        options: r[11] ? r[11].map(function (o) { return { code: o[0], title: o[1], tbcFlag: o[2] }; }) : null,
        id: r[0] + r[1] + r[2],
      };
    });
  });

  // Additional WSU subjects from the subject list: selectable in elective slots ("any WSU subject") and
  // searchable in the catalogue. The list has codes and titles only, with no session, campus or CP data.
  const EXTRA = (RAW.extra || []).map(function (r) { return { code: r[0], title: r[1], level: 'Level ' + r[0].charAt(5), lv: +r[0].charAt(5), list: true }; });
  const EXTRA_BY_CODE = {};
  EXTRA.forEach(function (e) { EXTRA_BY_CODE[e.code] = e; });
  // pre-2027 subjects take their proper titles, as the subject list gives one of them with its code repeated
  Object.keys(LEGACY).forEach(function (code) {
    if (!EXTRA_BY_CODE[code]) { EXTRA_BY_CODE[code] = { code: code, level: 'Level ' + code.charAt(5), lv: +code.charAt(5), list: true }; EXTRA.push(EXTRA_BY_CODE[code]); }
    EXTRA_BY_CODE[code].title = LEGACY[code];
    EXTRA_BY_CODE[code].legacy = true;
  });
  const PICK_LIMIT = 60;
  // Elective slots take any WSU subject: every workbook subject (with its 2027 sessions) plus the subject list.
  const ANY_SUBJECTS = Object.keys(GLOBAL_BY_CODE).map(function (code) {
    const c = GLOBAL_BY_CODE[code];
    return { code: code, title: c.title, level: c.level || 'Level ' + code.charAt(5), lv: +code.charAt(5), handbook: true };
  }).concat(EXTRA).sort(function (a, b) { return a.code < b.code ? -1 : 1; });

  // Custom degree plans: the student sets the credit points, names the degree and fills each session.
  const CUSTOM = '__custom__';
  const CP_PRESETS = [80, 160, 240, 320, 400, 480];
  const MAX_CP = 800;
  const MAX_YEARS = 12;
  const MAX_SLOTS = 120;
  const HANDBOOK_HOME = 'https://studenthandbook.westernsydney.edu.au/';
  // advisor notes from every degree, used to flag subjects in a plan built from scratch
  const ALL_NOTES = [];
  (function () {
    const seen = {};
    DEGREES.forEach(function (d) {
      d.advisorNotes.forEach(function (n) {
        if (seen[n.text]) return;
        seen[n.text] = 1;
        ALL_NOTES.push(Object.assign({ deg: d.code }, n));
      });
    });
  })();
  let GLOBAL_LIST = null;
  function globalList() {
    if (!GLOBAL_LIST) {
      GLOBAL_LIST = Object.keys(GLOBAL_BY_CODE).sort().map(function (code) {
        return Object.assign({}, GLOBAL_BY_CODE[code], { component: 'In the 2027 degree guides' });
      });
    }
    return GLOBAL_LIST;
  }

  // ======================================================================== helpers
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function parseOffered(v) {
    let s = (v || '').trim();
    const info = { codes: [], tbc: false, y2026: false, none: false };
    if (!s || s === '—' || s === '-') { info.none = true; return info; }
    if (s.indexOf('(2026)') >= 0) { info.y2026 = true; s = s.replace('(2026)', '').trim(); }
    if (s === 'TBC') { info.tbc = true; return info; }
    info.codes = s.split(/\s+/);
    return info;
  }
  function sessionValue(entry, session) { return session === 'Autumn' ? entry.autumn : entry.spring; }
  function offerFor(deg, code, session) {
    const e = deg.byCode[code] || GLOBAL_BY_CODE[code];
    if (!e || session === 'Summer') return null;
    const info = parseOffered(sessionValue(e, session));
    if (e.source && /^2026/.test(e.source)) info.y2026 = true;
    return info;
  }
  function orderIdx(y, s) { return (y - 1) * 3 + PLAN_SESSIONS.indexOf(s); }
  function where(s) { return 'Year ' + s.year + ' ' + s.session; }
  function fmt(n) { return String(Math.round(n * 10) / 10); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  // ---- subject search: matches a code (with or without the space) or words in the title, in any
  // order, and ranks the exact or most relevant subject first; tolerates a one-letter typo in longer words
  function normQ(q) { return String(q || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
  function qTokens(q) { return normQ(q).split(' ').map(function (t) { return t.replace(/[^a-z0-9]/g, ''); }).filter(Boolean); }
  function normCode(v) {
    const c = String(v || '').toUpperCase().replace(/[\s-]+/g, '');
    return /^[A-Z]{4}\d{4}$/.test(c) ? c.slice(0, 4) + ' ' + c.slice(4) : '';
  }
  function within1(a, b) {
    if (a === b) return true;
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0;
    let j = 0;
    let edits = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++edits > 1) return false;
      if (a.length > b.length) i++;
      else if (b.length > a.length) j++;
      else { i++; j++; }
    }
    return edits + (a.length - i) + (b.length - j) <= 1;
  }
  function searchScore(e, q) {
    const nq = normQ(q);
    if (!nq) return 1;
    const code = e.code.toLowerCase().replace(' ', '');
    const qc = nq.replace(/[\s-]+/g, '');
    const title = e.title.toLowerCase();
    if (code === qc) return 1000;
    if (title === nq) return 950;
    let best = 0;
    if (qc.length >= 2 && code.indexOf(qc) === 0) best = 800 - (code.length - qc.length);
    if (title.indexOf(nq) === 0) best = Math.max(best, 720);
    else if (nq.length >= 3 && title.indexOf(nq) > 0) best = Math.max(best, 620);
    const words = title.split(/[^a-z0-9]+/).filter(Boolean);
    const toks = qTokens(nq);
    let sum = 0;
    let strong = true; // every word matched a whole word, the start of a word, or the code
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k];
      if (words.indexOf(t) >= 0) sum += 60;
      else if (words.some(function (w) { return w.indexOf(t) === 0; })) sum += 45;
      else if (code.indexOf(t) >= 0) sum += 40;
      else if (title.indexOf(t) >= 0) { sum += 25; strong = false; }
      else if (t.length >= 4 && words.some(function (w) { return within1(w, t) || (w.length > t.length && within1(w.slice(0, t.length), t)); })) { sum += 12; strong = false; }
      else return best; // a word that matches nothing: only whole-phrase matches can still count
    }
    const wordScore = strong ? 640 + Math.min(sum, 100) : Math.min(sum, 590);
    return Math.max(best, wordScore) - e.title.length / 1000;
  }
  function rankByQuery(list, q) {
    if (!normQ(q)) return list.slice();
    return list.map(function (x) { return [x, searchScore(x, q)]; })
      .filter(function (r) { return r[1] > 0; })
      .sort(function (a, b) { return b[1] - a[1] || (a[0].code < b[0].code ? -1 : 1); })
      .map(function (r) { return r[0]; });
  }
  // wraps the parts of a title that match the search in <mark>, escaping everything else
  function hl(text, q) {
    const toks = qTokens(q).filter(function (t) { return t.length >= 2; });
    if (!toks.length) return esc(text);
    const low = text.toLowerCase();
    const ranges = [];
    const add = function (needle) {
      let i = low.indexOf(needle);
      while (needle && i >= 0) { ranges.push([i, i + needle.length]); i = low.indexOf(needle, i + needle.length); }
    };
    if (normQ(q).length >= 3) add(normQ(q));
    toks.forEach(add);
    if (!ranges.length) return esc(text);
    ranges.sort(function (a, b) { return a[0] - b[0]; });
    let out = '';
    let pos = 0;
    ranges.forEach(function (r) {
      if (r[1] <= pos) return;
      const start = Math.max(r[0], pos);
      out += esc(text.slice(pos, start)) + '<mark>' + esc(text.slice(start, r[1])) + '</mark>';
      pos = r[1];
    });
    return out + esc(text.slice(pos));
  }
  function hlCode(code, q) {
    const qc = normQ(q).replace(/[\s-]+/g, '');
    const c = code.toLowerCase().replace(' ', '');
    if (qc.length < 2 || c.indexOf(qc) !== 0) return esc(code);
    const n = qc.length <= 4 ? qc.length : qc.length + 1; // skip over the space after the prefix
    return '<mark>' + esc(code.slice(0, n)) + '</mark>' + esc(code.slice(n));
  }
  function cleanPoolTitle(t) { return t.replace(/\s*\(see list\)\s*/, '').trim(); }
  function today() {
    return new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function typeGroup(type) {
    switch (type) {
      case 'Law': return 'law';
      case 'Non-law': return 'nonlaw';
      case 'Major': case 'Major (option)': return 'major';
      case 'LLB alternate': return 'llb';
      case 'Choice': return 'choice';
      case 'Elective': return 'elective';
      default: return 'nonlaw';
    }
  }
  const TYPE_LABEL = { law: 'Law core', nonlaw: 'Non-law core', major: 'Major / minor', llb: 'LLB Alternate', choice: 'Choice', elective: 'Elective' };
  function typeLabel(raw, opt) {
    if (raw.type === 'Major') return opt.majorKind === 'Minor' ? 'Minor' : 'Major';
    if (raw.type === 'Major (option)') return 'Major option';
    return TYPE_LABEL[typeGroup(raw.type)];
  }

  // ======================================================================== state
  const STORE_KEY = 'wslsa-2027-pathway-explorer:v1';
  const DEFAULT_EXPORT = { mode: 'A', orient: 'portrait', ticks: true, llbSession: 'all', llbCampus: false, llbTbc: true };
  let state = sanitise(readStore());
  const ui = { tab: 'structure', cat: { q: '', comp: '', session: '', inPlan: false, area: '' }, modal: null, picker: null, assign: null, whyOpen: false, advisoryOpen: false, gridQ: '', viewFold: {}, yearInfo: {}, matchIds: [], matchAt: -1, enqOpen: false, enqTopic: 'transition', tour: null, repace: null, transfer: null, credit: null };

  function readStore() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { return null; }
  }
  function saveState() {
    recordHistory();
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* private mode: state still works for this session */ }
  }
  function str(v, max) { return typeof v === 'string' ? v.slice(0, max) : ''; }
  function sanitisePicks(key, picks) {
    const out = {};
    if (!picks || typeof picks !== 'object' || !PATH[key]) return out;
    PATH[key].forEach(function (raw) {
      const p = picks[raw.id];
      // a core subject new in 2027 is an LLB Alternate slot in the pre-2027 structure, so it can hold a choice
      if (!p || (raw.kind === 'fixed' && NEW_2027_CORES.indexOf(raw.code) < 0)) return;
      const code = str(p.code, 16).trim();
      const title = str(p.title, 140).trim();
      if (!code || !title) return;
      out[raw.id] = { code: code, title: title, custom: raw.kind === 'elective' && !!p.custom };
      if (raw.kind === 'elective' && p.list && EXTRA_BY_CODE[code]) out[raw.id].list = true;
    });
    return out;
  }
  function sanitiseDone(key, done) {
    const out = {};
    if (!done || !PATH[key]) return out;
    const ids = Array.isArray(done) ? done : Object.keys(done);
    PATH[key].forEach(function (raw) { if (ids.indexOf(raw.id) >= 0) out[raw.id] = 1; });
    return out;
  }
  function clampCP(v) {
    return Math.min(MAX_CP, Math.max(10, Math.round((+v || 0) / 10) * 10));
  }
  // One slot of a custom plan. Titles are stored only for subjects typed in by hand; every other
  // title comes from the workbook or the subject list so a shared link cannot rename a real subject.
  function sanitiseCSlot(x, tpl) {
    if (!x || typeof x !== 'object') return null;
    const y = Math.floor(+x.y);
    if (!(y >= 1 && y <= MAX_YEARS) || PLAN_SESSIONS.indexOf(x.s) < 0) return null;
    const typed = str(x.code, 16).trim().toUpperCase().replace(/\s+/g, ' ');
    const code = normCode(typed) || typed;
    const known = GLOBAL_BY_CODE[code] || EXTRA_BY_CODE[code];
    const title = known ? '' : str(x.title, 140).trim();
    const filled = !!(code && (known || title));
    const cp = Math.round(+x.cp);
    return {
      y: y, s: x.s, code: filled ? code : '', title: filled ? title : '', cp: cp >= 0 && cp <= 80 ? cp : 10,
      o: tpl && typeof x.o === 'string' && PATH[tpl].some(function (r) { return r.id === x.o; }) ? x.o : '',
      done: !!x.done,
    };
  }
  function sanitiseCustom(c) {
    if (!c || typeof c !== 'object') return null;
    const tpl = typeof c.tpl === 'string' && PATH[c.tpl] ? c.tpl : '';
    const start = Math.floor(+c.start);
    const out = {
      name: str(c.name, 120), code: str(c.code, 16).trim(), cp: clampCP(c.cp), tpl: tpl,
      // the calendar year of Year 1 in a plan imported from results; 0 for the 2027 intake
      start: start >= 2000 && start <= 2100 ? start : 0,
      // the load the rest of the plan runs at after Re-Pace; 0 for a plan that has not been re-paced
      pace: [20, 30, 40].indexOf(+c.pace) >= 0 ? +c.pace : 0,
      // the Handbook structure, 'pre2027' or '2027', kept only when it is not the one the start year gives
      cohort: c.cohort === 'pre2027' || c.cohort === '2027' ? c.cohort : '',
      // years shown after the last subject, so an imported plan has its sessions ahead ready to fill
      years: Math.min(MAX_YEARS, Math.max(0, Math.floor(+c.years) || 0)),
      // what an imported plan still needs (from the student's audit or the pathway), for its Suggested Remaining Guide
      need: Array.isArray(c.need) ? c.need.slice(0, MAX_SLOTS).map(function (n) { return sanitiseNeed(n, tpl); }).filter(Boolean) : [],
      // the load a student has set for a session, by its place in the plan; a session without one runs at 40 CP
      loads: sanitiseLoads(c.loads),
      // a student's own note on a session, by its place in the plan
      notes: sanitiseNotes(c.notes),
      // suggestions the student has dismissed from the guide: a subject by its code, or a choice by its pathway row
      skip: (Array.isArray(c.skip) ? c.skip : []).slice(0, MAX_SLOTS).map(function (k) { return sanitiseSkip(k, tpl); }).filter(Boolean),
      slots: (Array.isArray(c.slots) ? c.slots : []).slice(0, MAX_SLOTS).map(function (x) { return sanitiseCSlot(x, tpl); }).filter(Boolean),
    };
    if (out.cohort === startCohort(out.start)) out.cohort = '';
    return out;
  }
  const SESSION_LOADS = [[0, 'Leave of Absence'], [10, ''], [20, 'Part-time'], [30, ''], [40, 'Standard'], [50, 'Overload']];
  function sanitiseLoads(l) {
    const out = {};
    if (!l || typeof l !== 'object') return out;
    Object.keys(l).forEach(function (k) {
      const cp = +l[k];
      if (/^\d+$/.test(k) && +k < MAX_YEARS * 3 && cp !== LOAD_CP.FT && SESSION_LOADS.some(function (x) { return x[0] === cp; })) out[+k] = cp;
    });
    return out;
  }
  function sanitiseSkip(k, tpl) {
    if (!k || typeof k !== 'object') return null;
    const code = normCode(str(k.code, 16));
    if (code && !GLOBAL_BY_CODE[code] && !EXTRA_BY_CODE[code]) return null;
    return { code: code, o: !code && tpl && typeof k.o === 'string' && PATH[tpl].some(function (r) { return r.id === k.o; }) ? k.o : '' };
  }
  function sanitiseNotes(n) {
    const out = {};
    if (!n || typeof n !== 'object') return out;
    Object.keys(n).slice(0, MAX_YEARS * 3).forEach(function (k) {
      const text = str(n[k], 140).replace(/\s+/g, ' ').trim();
      if (/^\d+$/.test(k) && +k < MAX_YEARS * 3 && text) out[+k] = text;
    });
    return out;
  }
  // the credit points a session is planned to carry
  function sessionCap(plan, k) { return plan && plan.loads && plan.loads[k] != null ? plan.loads[k] : LOAD_CP.FT; }
  function sanitiseNeed(n, tpl) {
    if (!n || typeof n !== 'object') return null;
    const code = normCode(str(n.code, 16));
    if (code && !GLOBAL_BY_CODE[code] && !EXTRA_BY_CODE[code]) return null;
    const cp = Math.round(+n.cp);
    return {
      code: code, was: LEGACY[n.was] ? n.was : '', cp: cp >= 0 && cp <= 80 ? cp : 10,
      o: tpl && typeof n.o === 'string' && PATH[tpl].some(function (r) { return r.id === n.o; }) ? n.o : '',
      sess: n.sess === 'Autumn' || n.sess === 'Spring' ? n.sess : '',
    };
  }
  // the structure a start year gives: a student who started before 2027 follows the pre-2027 structure
  function startCohort(start) { return start && start < START_YEAR ? 'pre2027' : '2027'; }
  function cohortOf(plan) { return plan.cohort || startCohort(plan.start); }
  function isCustom() { return state.mode === 'custom' && !!state.custom; }
  // the plan an edit changes: the student's own plan, or the edited copy of the WSLSA pathway on screen
  function editPlan() { return isCustom() ? state.custom : state.edits[currentKey()] || null; }
  // the Handbook structure a WSLSA pathway is shown in, chosen in the dock
  function guideCohort(key) { return state.cohortFor[key] === 'pre2027' ? 'pre2027' : '2027'; }
  // the structure on screen: a plan's own, or its pathway's
  function ctxCohort(ctx) { return ctx.custom ? cohortOf(ctx.plan) : guideCohort(ctx.key); }
  function sanitise(s) {
    s = s && typeof s === 'object' ? s : {};
    const custom = sanitiseCustom(s.custom);
    const out = {
      degree: DEG[s.degree] ? s.degree : DEGREES[0].code,
      majorFor: {},
      campus: PRIMARY_CAMPUSES.indexOf(s.campus) >= 0 ? s.campus : '',
      load: s.load === 'PT' ? 'PT' : 'FT',
      track: !!s.track,
      picks: {},
      done: {},
      exp: Object.assign({}, DEFAULT_EXPORT),
      mode: s.mode === 'custom' && custom ? 'custom' : 'guide',
      custom: custom,
      edits: {},
      cohortFor: {},
      view: s.view === 'remaining' || s.view === 'action' ? s.view : 'all',
      guidePinned: !!s.guidePinned,
    };
    if (s.majorFor && typeof s.majorFor === 'object') {
      Object.keys(s.majorFor).forEach(function (d) {
        if (DEG[d] && DEG[d].options.indexOf(s.majorFor[d]) >= 0) out.majorFor[d] = s.majorFor[d];
      });
    }
    // each WSLSA pathway the student has edited keeps its own copy, and a pathway can show the pre-2027 structure
    if (s.edits && typeof s.edits === 'object') {
      Object.keys(s.edits).forEach(function (key) {
        if (!PATH[key] || !s.edits[key] || typeof s.edits[key] !== 'object') return;
        const e = sanitiseCustom(Object.assign({}, s.edits[key], { tpl: key }));
        if (e) out.edits[key] = e;
      });
    }
    if (s.cohortFor && typeof s.cohortFor === 'object') {
      Object.keys(s.cohortFor).forEach(function (key) { if (PATH[key] && s.cohortFor[key] === 'pre2027') out.cohortFor[key] = 'pre2027'; });
    }
    Object.keys(PATH).forEach(function (key) {
      const p = sanitisePicks(key, s.picks && s.picks[key]);
      if (Object.keys(p).length) out.picks[key] = p;
      const d = sanitiseDone(key, s.done && s.done[key]);
      if (Object.keys(d).length) out.done[key] = d;
    });
    if (s.exp && typeof s.exp === 'object') {
      if (s.exp.mode === 'B') out.exp.mode = 'B';
      if (s.exp.orient === 'landscape') out.exp.orient = 'landscape';
      out.exp.ticks = s.exp.ticks !== false;
      if (['Autumn', 'Spring', 'all'].indexOf(s.exp.llbSession) >= 0) out.exp.llbSession = s.exp.llbSession;
      out.exp.llbCampus = !!s.exp.llbCampus;
      out.exp.llbTbc = s.exp.llbTbc !== false;
    }
    return out;
  }
  function currentKey() {
    const deg = DEG[state.degree];
    const k = state.majorFor[deg.code];
    return deg.options.indexOf(k) >= 0 ? k : deg.options[0];
  }

  // ---- share links. The address bar stays clean while a student plans; a link is built only when
  // they copy it or print. The plan text names the pathway and carries only what differs from it:
  //   2788-T046/p=2A3:LAWS3067/d=Pw/c=PC      a WSLSA pathway with a choice, ticks and a campus
  //   my/tp=2788-T046/s=0-12,1U:LAWS2003::13,14-39   a custom copy of that pathway: runs of untouched
  //                                                   template slots as index ranges, changed slots in full
  // Subject titles are looked up from the code, so only titles typed in by hand travel in the link.
  // The text is then scrambled into a code that differs on every share (scrambleLink below).
  const SESS_LETTER = { Autumn: 'A', Spring: 'S', Summer: 'U' };
  const LETTER_SESS = { A: 'Autumn', S: 'Spring', U: 'Summer' };
  // free text is percent-encoded, including the characters links use as separators
  function enc(s) { return encodeURIComponent(s).replace(/[!'()*.~]/g, function (c) { return '%' + c.charCodeAt(0).toString(16).toUpperCase(); }); }
  function dec(s) { try { return decodeURIComponent(s); } catch (e) { return ''; } }
  function linkCode(code) { return normCode(code) === code ? code.replace(' ', '') : enc(code); }
  function linkKey(key) { return key.replace('|BASE', '').replace('|', '-'); }
  function keyFromLink(s) { const m = /^(\d{4})(?:-([A-Z0-9]+))?$/.exec(s || ''); return m ? m[1] + '|' + (m[2] || 'BASE') : ''; }
  // completed ticks travel as one bit per slot, six to a character
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  function packBits(flags) {
    let out = '';
    for (let i = 0; i < flags.length; i += 6) {
      let v = 0;
      for (let j = 0; j < 6 && i + j < flags.length; j++) if (flags[i + j]) v |= 1 << j;
      out += B64.charAt(v);
    }
    return out.replace(/A+$/, '');
  }
  function unpackBits(s, n) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(((Math.max(0, B64.indexOf(s.charAt(Math.floor(i / 6)))) >> (i % 6)) & 1) === 1);
    return out;
  }
  function guideLink(key) {
    const picks = state.picks[key] || {};
    const done = state.done[key] || {};
    const parts = [linkKey(key)];
    if (guideCohort(key) === 'pre2027') parts.push('co=p');
    const p = PATH[key].filter(function (r) { return picks[r.id]; }).map(function (r) {
      const k = picks[r.id];
      return r.id + ':' + linkCode(k.code) + (k.custom ? ':' + enc(k.title) : '');
    });
    if (p.length) parts.push('p=' + p.join(','));
    const d = packBits(PATH[key].map(function (r) { return !!done[r.id]; }));
    if (d) parts.push('d=' + d);
    return parts;
  }
  function customLink(plan) {
    const tdeg = plan.tpl ? DEG[plan.tpl.split('|')[0]] : null;
    const tpl = plan.tpl ? templateSlots(plan.tpl, false) : [];
    const tIdx = {};
    tpl.forEach(function (t, i) { tIdx[t.o] = i; });
    const parts = ['my'];
    if (tdeg) parts.push('tp=' + linkKey(plan.tpl));
    if (plan.name !== (tdeg ? tdeg.title : '')) parts.push('n=' + enc(plan.name));
    if (plan.code !== (tdeg ? tdeg.code : '')) parts.push('k=' + enc(plan.code));
    if (!tdeg || plan.cp !== tdeg.cp) parts.push('cp=' + plan.cp);
    if (plan.start) parts.push('st=' + plan.start);
    if (plan.pace) parts.push('pc=' + plan.pace);
    if (plan.cohort) parts.push('co=' + (plan.cohort === 'pre2027' ? 'p' : 'n'));
    const items = [];
    let run = null;
    const flush = function () { if (run) items.push(run[0] === run[1] ? String(run[0]) : run[0] + '-' + run[1]); run = null; };
    plan.slots.forEach(function (x) {
      const i = x.o && tIdx[x.o] != null ? tIdx[x.o] : -1;
      const t = i >= 0 ? tpl[i] : null;
      if (t && x.y === t.y && x.s === t.s && x.code === t.code && x.cp === t.cp && !x.title) {
        if (run && run[1] === i - 1) run[1] = i; else { flush(); run = [i, i]; }
        return;
      }
      flush();
      const f = [x.code ? linkCode(x.code) : '', x.cp !== (t ? t.cp : 10) ? String(x.cp) : '', i >= 0 ? String(i) : '', x.title ? enc(x.title) : ''];
      while (f.length && !f[f.length - 1]) f.pop();
      items.push(x.y + SESS_LETTER[x.s] + (f.length ? ':' + f.join(':') : ''));
    });
    flush();
    // identical changed slots in a row (empty slots in a blank plan) collapse to item*count
    const runs = [];
    items.forEach(function (it) {
      const last = runs[runs.length - 1];
      if (last && last.it === it && /[ASU]/.test(it)) last.n++; else runs.push({ it: it, n: 1 });
    });
    if (runs.length) parts.push('s=' + runs.map(function (r) { return r.n > 1 ? r.it + '*' + r.n : r.it; }).join(','));
    const d = packBits(plan.slots.map(function (x) { return x.done; }));
    if (d) parts.push('d=' + d);
    // an imported plan's empty sessions ahead and what it still needs travel too, so its guide opens the same
    if (plan.years) parts.push('yr=' + plan.years);
    const lk = Object.keys(plan.loads || {});
    if (lk.length) parts.push('ld=' + lk.map(function (k) { return k + '.' + plan.loads[k]; }).join(','));
    if ((plan.skip || []).length) parts.push('sk=' + plan.skip.map(function (k) { return k.code ? linkCode(k.code) : k.o && tIdx[k.o] != null ? 'o' + tIdx[k.o] : ''; }).join(','));
    const nk = Object.keys(plan.notes || {});
    if (nk.length) parts.push('nt=' + nk.map(function (k) { return k + ':' + enc(plan.notes[k]); }).join(','));
    if (plan.need.length) parts.push('nd=' + needLink(plan.need, tIdx, plan.tpl));
    return parts;
  }
  // What a pathway row still needed looks like, which is how most of an imported plan's list reads: these travel in a
  // link as the row's number, and anything else in full as n<code>:<cp>:<row>:<session>:<pre-2027 code>.
  function rowNeeds(tpl) {
    return guideSlots(tpl, {}, {}, '2027').map(function (s) {
      return { code: s.pending ? '' : s.code, was: '', cp: s.cp, o: s.id, sess: s.pending ? (s.kind === 'inline' ? runsIn(s.raw.options.map(function (x) { return x.code; })) : '') : s.session };
    });
  }
  function needLink(need, tIdx, tpl) {
    const base = tpl ? rowNeeds(tpl) : [];
    const items = [];
    let run = null;
    const flush = function () { if (run) items.push(run[0] === run[1] ? String(run[0]) : run[0] + '-' + run[1]); run = null; };
    need.forEach(function (n) {
      const i = n.o && tIdx[n.o] != null ? tIdx[n.o] : -1;
      const b = i >= 0 ? base[i] : null;
      if (b && b.code === n.code && b.cp === n.cp && b.sess === n.sess && !n.was) {
        if (run && run[1] === i - 1) run[1] = i; else { flush(); run = [i, i]; }
        return;
      }
      flush();
      const f = [n.code ? linkCode(n.code) : '', n.cp !== 10 ? String(n.cp) : '', i >= 0 ? String(i) : '', n.sess ? SESS_LETTER[n.sess] : '', n.was ? linkCode(n.was) : ''];
      while (f.length && !f[f.length - 1]) f.pop();
      items.push('n' + f.join(':'));
    });
    flush();
    const runs = [];
    items.forEach(function (it) {
      const last = runs[runs.length - 1];
      if (last && last.it === it && it.charAt(0) === 'n') last.n++; else runs.push({ it: it, n: 1 });
    });
    return runs.map(function (r) { return r.n > 1 ? r.it + '*' + r.n : r.it; }).join(',');
  }
  function needFromLink(text, tpl) {
    const base = tpl ? rowNeeds(tpl) : [];
    const code = function (s) { const typed = dec(s || ''); return normCode(typed) || typed; };
    const out = [];
    (text ? text.split(',') : []).forEach(function (item) {
      const rep = /^(.*)\*(\d+)$/.exec(item);
      const it = rep ? rep[1] : item;
      const range = /^(\d+)(?:-(\d+))?$/.exec(it);
      if (range) {
        for (let i = +range[1]; i <= +(range[2] || range[1]) && i < base.length && out.length < MAX_SLOTS; i++) out.push(Object.assign({}, base[i]));
        return;
      }
      if (it.charAt(0) !== 'n') return;
      const v = it.slice(1).split(':');
      const b = v[2] ? base[+v[2]] || null : null;
      const n = { code: code(v[0]), cp: v[1] ? +v[1] : 10, o: b ? b.o : '', sess: LETTER_SESS[v[3]] || '', was: code(v[4]) };
      for (let k = rep ? +rep[2] : 1; k > 0 && out.length < MAX_SLOTS; k--) out.push(Object.assign({}, n));
    });
    return out;
  }
  function encodeLink() {
    const edited = !isCustom() && editPlan();
    const parts = isCustom() ? customLink(state.custom) : edited ? ['ed'].concat(customLink(edited).slice(1)) : guideLink(currentKey());
    if (state.campus) parts.push('c=' + state.campus);
    if (state.load === 'PT') parts.push('pt');
    return parts.join('/');
  }
  // Shared links carry the plan as a scrambled code that is different every time, even for the same
  // plan: 4 random bytes, then the time shared (seconds since 2026), a check byte and the plan text,
  // all mixed with a keystream seeded from the random bytes. Two codes match only if two shares land
  // in the same second with the same random bytes (1 in 4.3 billion). The code is scrambled, not
  // encrypted: it hides the plan from a casual glance, and the check byte catches a link cut short.
  const CODE_EPOCH = Date.UTC(2026, 0, 1);
  function fnv(bytes) {
    let h = 0x811c9dc5;
    bytes.forEach(function (b) { h = Math.imul(h ^ b, 0x01000193) >>> 0; });
    return h;
  }
  function keystream(seed) {
    let s = fnv(seed) || 0x9e3779b9;
    return function () { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s >>> 24; };
  }
  function scrambleLink(text) {
    const r = new Uint8Array(4);
    try { crypto.getRandomValues(r); } catch (e) { for (let i = 0; i < 4; i++) r[i] = Math.floor(Math.random() * 256); }
    const t = Math.max(0, Math.floor((Date.now() - CODE_EPOCH) / 1000)) >>> 0;
    const time = [t >>> 24, (t >>> 16) & 255, (t >>> 8) & 255, t & 255];
    const body = Array.from(text, function (c) { return c.charCodeAt(0) & 255; });
    const seed = Array.from(r);
    const ks = keystream(seed);
    const bytes = seed.concat(time.concat([fnv(time.concat(body)) & 255], body).map(function (b) { return b ^ ks(); }));
    return btoa(String.fromCharCode.apply(null, bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  // the plan text inside a code, or null when it is not a code or was damaged in transit
  function unscrambleCode(code) {
    if (!/^[A-Za-z0-9_-]{14,}$/.test(code)) return null;
    let bin;
    try { bin = atob(code.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((code.length + 3) % 4)); } catch (e) { return null; }
    const b = Array.from(bin, function (c) { return c.charCodeAt(0); });
    if (b.length < 10) return null;
    const ks = keystream(b.slice(0, 4));
    for (let i = 4; i < b.length; i++) b[i] ^= ks();
    const body = b.slice(9);
    if ((fnv(b.slice(4, 8).concat(body)) & 255) !== b[8]) return null;
    return String.fromCharCode.apply(null, body);
  }
  function guideFromLink(key, f) {
    const picks = {};
    (f.p ? f.p.split(',') : []).forEach(function (item) {
      const v = item.split(':');
      const raw = PATH[key].find(function (r) { return r.id === v[0]; });
      if (!raw) return;
      const typed = dec(v[1] || '');
      const code = normCode(typed) || typed.trim();
      if (v[2] != null) { picks[raw.id] = { code: code, title: dec(v[2]), custom: true }; return; }
      const known = (raw.options && raw.options.find(function (o) { return o.code === code; })) || GLOBAL_BY_CODE[code] || EXTRA_BY_CODE[code];
      if (known) picks[raw.id] = { code: code, title: known.title, list: !!EXTRA_BY_CODE[code] };
    });
    const bits = unpackBits(f.d || '', PATH[key].length);
    return { picks: sanitisePicks(key, picks), done: sanitiseDone(key, PATH[key].filter(function (r, i) { return bits[i]; }).map(function (r) { return r.id; })) };
  }
  function customFromLink(f) {
    const tpl = keyFromLink(f.tp);
    if (f.tp && !PATH[tpl]) return null;
    const tdeg = tpl ? DEG[tpl.split('|')[0]] : null;
    const base = tpl ? templateSlots(tpl, false) : [];
    const slots = [];
    (f.s ? f.s.split(',') : []).forEach(function (item) {
      const rep = /^(.*)\*(\d+)$/.exec(item);
      const it = rep ? rep[1] : item;
      const range = /^(\d+)(?:-(\d+))?$/.exec(it);
      if (range) {
        for (let i = +range[1]; i <= +(range[2] || range[1]) && i < base.length && slots.length < MAX_SLOTS; i++) slots.push(Object.assign({}, base[i]));
        return;
      }
      const m = /^(\d+)([ASU])(?::(.*))?$/.exec(it);
      if (!m) return;
      const v = (m[3] || '').split(':');
      const t = v[2] ? base[+v[2]] || null : null;
      const x = { y: +m[1], s: LETTER_SESS[m[2]], code: dec(v[0] || ''), cp: v[1] ? +v[1] : t ? t.cp : 10, o: t ? t.o : '', title: dec(v[3] || ''), done: false };
      for (let n = rep ? +rep[2] : 1; n > 0 && slots.length < MAX_SLOTS; n--) slots.push(Object.assign({}, x));
    });
    const bits = unpackBits(f.d || '', slots.length);
    slots.forEach(function (x, i) { x.done = bits[i]; });
    return sanitiseCustom({
      name: 'n' in f ? dec(f.n) : tdeg ? tdeg.title : '',
      code: 'k' in f ? dec(f.k) : tdeg ? tdeg.code : '',
      cp: f.cp ? +f.cp : tdeg ? tdeg.cp : 10, tpl: tpl, start: +f.st || 0, pace: +f.pc || 0, cohort: f.co === 'p' ? 'pre2027' : f.co === 'n' ? '2027' : '',
      years: +f.yr || 0, need: needFromLink(typeof f.nd === 'string' ? f.nd : '', tpl), slots: slots,
      loads: (typeof f.ld === 'string' ? f.ld.split(',') : []).reduce(function (o, it) { const v = it.split('.'); o[v[0]] = +v[1]; return o; }, {}),
      skip: (typeof f.sk === 'string' ? f.sk.split(',') : []).map(function (it) { const m = /^o(\d+)$/.exec(it); const typed = dec(it); return m ? { code: '', o: base[+m[1]] ? base[+m[1]].o : '' } : { code: normCode(typed) || typed, o: '' }; }),
      notes: (typeof f.nt === 'string' ? f.nt.split(',') : []).reduce(function (o, it) { const i = it.indexOf(':'); if (i > 0) o[it.slice(0, i)] = dec(it.slice(i + 1)); return o; }, {}),
    });
  }
  function applyLink(s) {
    const segs = s.split('/');
    const f = Object.create(null);
    segs.slice(1).forEach(function (seg) { const i = seg.indexOf('='); if (i < 0) f[seg] = true; else f[seg.slice(0, i)] = seg.slice(i + 1); });
    if (segs[0] === 'my' || segs[0] === 'ed') {
      const c = customFromLink(f);
      if (!c) return false;
      if (segs[0] === 'ed' && c.tpl) {
        // an edited WSLSA pathway opens as that pathway, in place of any copy of it already here
        const d = c.tpl.split('|')[0];
        state.edits[c.tpl] = c;
        state.mode = 'guide';
        state.degree = d;
        state.majorFor[d] = c.tpl;
      } else {
        state.custom = c;
        state.mode = 'custom';
      }
    } else {
      const key = keyFromLink(segs[0]);
      if (!PATH[key]) return false;
      const g = guideFromLink(key, f);
      const deg = key.split('|')[0];
      state.mode = 'guide';
      state.degree = deg;
      state.majorFor[deg] = key;
      state.picks[key] = g.picks;
      state.done[key] = g.done;
      delete state.edits[key];
      if (f.co === 'p') state.cohortFor[key] = 'pre2027'; else delete state.cohortFor[key];
    }
    state.campus = PRIMARY_CAMPUSES.indexOf(f.c) >= 0 ? f.c : '';
    state.load = f.pt === true ? 'PT' : 'FT';
    return true;
  }

  // ---- older links: #plan=<base64url(JSON)>, still opened so links already shared and printed keep working
  function b64dec(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return decodeURIComponent(escape(atob(s))); }
  function unpackCustom(o) {
    if (!o || typeof o !== 'object' || !Array.isArray(o.s)) return null;
    return sanitiseCustom({
      name: o.n, code: o.k, cp: o.p, tpl: o.tp,
      slots: o.s.map(function (r) {
        return Array.isArray(r) ? { y: r[0], s: PLAN_SESSIONS[r[1]] || 'Autumn', code: r[2], cp: r[3], done: (r[4] & 1) === 1, o: r[5], title: r[6] } : null;
      }),
    });
  }
  function applyLegacyLink(h) {
    const m = /^#plan=([A-Za-z0-9_-]+)$/.exec(h);
    if (!m) return false;
    try {
      const o = JSON.parse(b64dec(m[1]));
      if (o && o.m === 'c') {
        const c = unpackCustom(o.x);
        if (!c) return false;
        state.custom = c;
        state.mode = 'custom';
        state.campus = PRIMARY_CAMPUSES.indexOf(o.c) >= 0 ? o.c : '';
        state.load = o.l === 'PT' ? 'PT' : 'FT';
        state.track = !!o.t;
        return true;
      }
      if (!o || !PATH[o.k]) return false;
      state.mode = 'guide';
      const deg = o.k.split('|')[0];
      state.degree = deg;
      state.majorFor[deg] = o.k;
      state.campus = PRIMARY_CAMPUSES.indexOf(o.c) >= 0 ? o.c : '';
      state.load = o.l === 'PT' ? 'PT' : 'FT';
      state.track = !!o.t;
      state.picks[o.k] = sanitisePicks(o.k, o.p);
      state.done[o.k] = sanitiseDone(o.k, o.d);
      return true;
    } catch (e) { return false; }
  }
  // Opens a plan link, then clears it from the address bar so the address stays short and a
  // reload keeps any changes made after opening it.
  // Returns null when there is no link, otherwise whether the link opened.
  function applyHash() {
    const h = location.hash || '';
    if (h.length < 2) return null;
    let ok = false;
    try {
      if (/^#plan=/.test(h)) ok = applyLegacyLink(h);
      else {
        const text = unscrambleCode(h.slice(1));
        ok = applyLink(text != null ? text : h.slice(1)); // readable links from before codes still open
      }
    } catch (e) { /* a damaged link opens the saved plan instead */ }
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* file:// in some browsers */ }
    return ok;
  }
  const LINK_FAILED = 'That plan link is incomplete or damaged, so your saved plan is shown instead.';
  function planUrl() { return location.href.split('#')[0] + '#' + scrambleLink(encodeLink()); }

  // ======================================================================== slot resolution
  function placeholder(raw) {
    if (raw.kind === 'llb') return 'LLB Alternate subject';
    if (raw.kind === 'pool') return 'Choose: ' + cleanPoolTitle(raw.title);
    if (raw.kind === 'elective') return 'Elective (any WSU subject)';
    if (raw.kind === 'inline') return 'Choose one of the options below';
    return raw.title;
  }

  function resolveSlot(raw, deg, opt, picks, done) {
    const s = {
      raw: raw, id: raw.id, year: raw.year, session: raw.session, cp: raw.cp, kind: raw.kind, type: raw.type,
      group: typeGroup(raw.type), typeLabel: typeLabel(raw, opt), selectable: raw.kind !== 'fixed',
      pick: picks[raw.id] || null, done: !!done[raw.id], pending: false, chosen: false, auto: false, custom: false,
      code: null, title: null, offer: null, tbcFlag: false,
    };
    if (raw.kind === 'fixed') {
      s.code = raw.code; s.title = raw.title; s.offer = parseOffered(raw.offered);
    } else if (raw.kind === 'option') {
      if (s.pick && s.pick.code !== raw.code) {
        s.code = s.pick.code; s.title = s.pick.title; s.chosen = true; s.offer = offerFor(deg, s.code, s.session);
      } else {
        s.code = raw.code; s.title = raw.title; s.offer = parseOffered(raw.offered);
      }
    } else if (raw.kind === 'inline') {
      let o = s.pick ? raw.options.find(function (x) { return x.code === s.pick.code; }) : null;
      if (!o && raw.options.length === 1) { o = raw.options[0]; s.auto = true; }
      if (o) {
        s.code = o.code; s.title = o.title; s.chosen = !s.auto; s.tbcFlag = o.tbcFlag;
        s.offer = offerFor(deg, o.code, s.session) || { codes: [], tbc: false, y2026: false, none: true };
        if (o.tbcFlag) s.offer.tbc = true;
      } else {
        s.pending = true; s.title = placeholder(raw);
      }
    } else {
      if (s.pick) {
        s.code = s.pick.code; s.title = s.pick.title; s.chosen = true; s.custom = !!s.pick.custom; s.listSubject = !!s.pick.list;
        s.offer = s.custom || s.listSubject ? null : offerFor(deg, s.code, s.session);
      } else {
        s.pending = true; s.title = placeholder(raw);
      }
    }
    return s;
  }

  function indexSlots(ctx) {
    ctx.byId = {};
    ctx.used = {};
    ctx.slots.forEach(function (s) {
      ctx.byId[s.id] = s;
      if (s.code && !s.pending) (ctx.used[s.code] = ctx.used[s.code] || []).push(s.id);
    });
    ctx.totalCP = ctx.slots.reduce(function (a, s) { return a + s.cp; }, 0);
    ctx.doneCP = ctx.slots.reduce(function (a, s) { return a + (s.done ? s.cp : 0); }, 0);
    ctx.risks = computeRisks(ctx);
    return ctx;
  }
  function buildContext() {
    if (isCustom()) return withGuide(buildCustomContext(state.custom));
    const key = currentKey();
    // an edited pathway is shown as that pathway, from its own copy
    if (state.edits[key]) {
      const ctx = buildCustomContext(state.edits[key]);
      ctx.key = key;
      ctx.edit = key;
      return withGuide(ctx);
    }
    const deg = DEG[state.degree];
    const opt = OPT[key];
    const slots = guideSlots(key, state.picks[key] || {}, state.done[key] || {}, guideCohort(key));
    return indexSlots({ key: key, deg: deg, opt: opt, slots: slots, custom: false });
  }
  // A WSLSA pathway's slots. In the pre-2027 structure the three core subjects new in 2027 are LLB Alternate slots
  // (each keeps its place and takes an LLB Alternate as a choice). Its sessions all fall in 2027 or later, so every
  // subject shows under its 2027 code, the one a student enrols in.
  function guideSlots(key, picks, done, cohort) {
    const deg = DEG[key.split('|')[0]];
    const opt = OPT[key];
    const pre = cohort === 'pre2027';
    const llb = pre ? PATH[key].find(function (r) { return r.kind === 'llb'; }) : null;
    return PATH[key].map(function (raw) {
      if (llb && raw.kind === 'fixed' && NEW_2027_CORES.indexOf(raw.code) >= 0) {
        const s = resolveSlot(Object.assign({}, llb, { id: raw.id, year: raw.year, session: raw.session, slot: raw.slot, cp: raw.cp }), deg, opt, picks, done);
        s.stand = llb;
        s.newCore = raw;
        return s;
      }
      return resolveSlot(raw, deg, opt, picks, done);
    });
  }
  // A WSLSA pathway as the student has it, as plan slots: their choices and ticks, in the structure it is shown in.
  function pathwayCopy(key) {
    const deg = DEG[key.split('|')[0]];
    const cohort = guideCohort(key);
    return sanitiseCustom({ name: deg.title, code: deg.code, cp: deg.cp, tpl: key, start: 0, pace: 0, cohort: cohort === 'pre2027' ? 'pre2027' : '', slots: templateSlots(key, true) });
  }
  // Every pathway can be edited in place. The first change to one copies it, with the student's choices and ticks, into
  // an edited copy kept for that pathway alone, which the page then shows in its place, so no separate plan is needed.
  // Returns the id the given slot has in the copy, which keeps the pathway's slots in their order.
  function ensureEditable(id) {
    if (editPlan()) return id;
    const key = currentKey();
    state.edits[key] = pathwayCopy(key);
    lastCtx = buildContext();
    const at = id ? PATH[key].findIndex(function (r) { return r.id === id; }) : -1;
    return at >= 0 ? 'c' + at : id;
  }

  // ======================================================================== suggested remaining guide
  // What a plan still needs, with a suggested session for each. The requirements are an imported plan's own list, worked
  // out when it was imported from the student's audit or the pathway, or else the pathway the plan is based on, in its
  // Handbook structure. A requirement is met by a subject with its code or its pre-2027 or 2027 twin, by a slot tied to
  // the same choice, or by a subject on the choice's list, narrowest list first, so nothing counts twice.
  function withGuide(ctx) { ctx.guide = remainingGuide(ctx); return ctx; }
  function remainingGuide(ctx) {
    const plan = ctx.plan;
    const tpl = plan.tpl;
    const rows = {};
    if (tpl) PATH[tpl].forEach(function (r) { rows[r.id] = r; });
    const tslots = tpl ? guideSlots(tpl, {}, {}, cohortOf(plan)) : [];
    const tctx = { deg: ctx.tdeg || BLANK_DEG, custom: false, slots: tslots };
    const listOf = function (o) {
      const s = o ? tslots.find(function (x) { return (x.stand ? x.stand.id : x.id) === o && x.pending; }) : null;
      return s ? choiceList(tctx, s, true).codes : null;
    };
    const open = plan.start ? firstOpenIdx(plan.start) : 0;
    let reqs;
    let pool;
    if (plan.need.length) {
      // an imported plan's list was worked out after its history, so only what is placed from now on can meet it
      reqs = plan.need.map(function (n) { return { code: n.code, was: n.was, cp: n.cp, o: n.o, sess: n.sess, type: n.code ? 'code' : 'choice', list: n.code ? null : listOf(n.o) }; });
      pool = ctx.slots.filter(function (s) { return orderIdx(s.year, s.session) >= open; });
    } else {
      reqs = tslots.map(function (s) {
        if (s.pending) return { code: '', cp: s.cp, o: s.stand ? s.stand.id : s.id, sess: s.kind === 'inline' ? runsIn(s.raw.options.map(function (x) { return x.code; })) : '', type: 'choice', list: choiceList(tctx, s, true).codes };
        return { code: s.code, cp: s.cp, o: s.id, sess: s.session, type: s.kind === 'fixed' ? 'code' : 'slot' };
      });
      pool = ctx.slots;
    }
    const used = {};
    reqs.forEach(function (r) {
      if (!r.code) return;
      const s = pool.find(function (x) { return !used[x.id] && !x.pending && sameAs(r.code).indexOf(x.code) >= 0; });
      if (s) { used[s.id] = 1; r.by = s; }
    });
    reqs.forEach(function (r) {
      if (r.by || r.type === 'code' || !r.o) return;
      const s = pool.find(function (x) { return !used[x.id] && x.orig && x.orig.id === r.o; });
      if (s) { used[s.id] = 1; r.by = s; }
    });
    // any slot for the same kind of choice meets it as well: one LLB Alternate slot is as good as another
    const choiceKey = function (row) {
      if (!row) return '';
      if (row.kind === 'llb' || row.kind === 'elective') return row.kind;
      return row.kind === 'pool' ? 'pool:' + (row.pool || []).join('|') : row.kind === 'inline' ? 'inline:' + row.options.map(function (o) { return o.code; }).join('|') : '';
    };
    reqs.forEach(function (r) {
      const key = r.by || r.type !== 'choice' ? '' : choiceKey(rows[r.o]);
      if (!key) return;
      const s = pool.find(function (x) { return !used[x.id] && x.orig && choiceKey(x.orig) === key; });
      if (s) { used[s.id] = 1; r.by = s; }
    });
    // in the pre-2027 structure a core subject new in 2027 that is in the plan counts as an LLB Alternate
    if (cohortOf(plan) === 'pre2027') {
      reqs.forEach(function (r) {
        if (r.by || r.type !== 'choice' || !rows[r.o] || rows[r.o].kind !== 'llb') return;
        const s = pool.find(function (x) { return !used[x.id] && !x.pending && NEW_2027_CORES.indexOf(x.code) >= 0; });
        if (s) { used[s.id] = 1; r.by = s; }
      });
    }
    // an open slot with nothing chosen yet stands for an open requirement
    reqs.forEach(function (r) {
      if (r.by || r.o || r.code) return;
      const s = pool.find(function (x) { return !used[x.id] && x.pending && !x.orig; });
      if (s) { used[s.id] = 1; r.by = s; }
    });
    const choices = reqs.filter(function (r) { return !r.by && r.type === 'choice'; });
    const size = function (r) { return r.list ? Object.keys(r.list).length : Infinity; };
    pool.filter(function (x) { return !used[x.id] && !x.pending; }).map(function (x) {
      return { x: x, fits: choices.filter(function (r) { return !r.list || r.list[x.code]; }).sort(function (a, b) { return size(a) - size(b); }) };
    }).filter(function (m) { return m.fits.length; }).sort(function (a, b) { return a.fits.length - b.fits.length; }).forEach(function (m) {
      const r = m.fits.find(function (q) { return !q.by; });
      if (r) { r.by = m.x; used[m.x.id] = 1; }
    });
    const items = reqs.filter(function (r) { return !r.by; });
    // any credit points still missing beyond the requirements are open subject slots
    const short = plan.cp - ctx.totalCP - items.reduce(function (a, r) { return a + r.cp; }, 0);
    for (let n = 0; n < short && items.length < MAX_SLOTS; n += 10) items.push({ code: '', cp: 10, o: '', sess: '', type: 'choice', list: null });
    // a suggestion the student has dismissed is left out, one for one, and is not replaced by an open slot
    let skipped = 0;
    (plan.skip || []).forEach(function (k) {
      const i = items.findIndex(function (r) { return k.code ? !!r.code && sameAs(k.code).indexOf(r.code) >= 0 : !r.code && (r.o || '') === k.o; });
      if (i >= 0) { items.splice(i, 1); skipped++; }
    });
    if (!items.length) return null;
    // a suggested session for each: named subjects first, in the order of the list (an audit's own list puts those being
    // phased out first), then choices, each in the earliest session it runs in, after its known prerequisites, at up to
    // 40 CP a session
    const load = {};
    const placedAt = {};
    const inPlan = {};
    ctx.slots.forEach(function (s) {
      const k = orderIdx(s.year, s.session);
      load[k] = (load[k] || 0) + s.cp;
      if (!s.pending && s.code) { inPlan[s.code] = 1; placedAt[s.code] = s.done ? -1 : Math.min(placedAt[s.code] == null ? k : placedAt[s.code], k); }
    });
    const order = items.filter(function (r) { return r.code; }).concat(items.filter(function (r) { return !r.code; }));
    let lastK = -1;
    let firstK = Infinity;
    order.forEach(function (r) {
      const fits = function (k, strict) {
        if (PLAN_SESSIONS[k % 3] === 'Summer' || (r.sess && PLAN_SESSIONS[k % 3] !== r.sess) || (load[k] || 0) + r.cp > sessionCap(plan, k)) return false;
        return !strict || !r.code || paceReady(r.code, k, placedAt, inPlan);
      };
      let k = open;
      while (k < MAX_YEARS * 3 && !fits(k, true)) k++;
      if (k >= MAX_YEARS * 3) { k = open; while (k < MAX_YEARS * 3 - 1 && !fits(k, false)) k++; }
      load[k] = (load[k] || 0) + r.cp;
      if (r.code) { inPlan[r.code] = 1; placedAt[r.code] = k; }
      r.k = k;
      r.y = Math.floor(k / 3) + 1;
      r.s = PLAN_SESSIONS[k % 3];
      // a pre-2027 subject suggested for a session after its final offering is the 2027 subject that replaces it
      if (r.code && startedBefore(plan.start)) {
        const c = codeFor(r.code, cohortOf(plan), plan.start + r.y - 1, true);
        if (c !== r.code) { r.was = LEGACY_EQUIVALENTS[r.code] ? r.code : ''; r.code = c; }
      }
      r.kind = r.code ? (/^LAWS /.test(r.code) ? 'law' : 'core') : !rows[r.o] ? 'open' : rows[r.o].kind === 'llb' ? 'llb' : rows[r.o].kind === 'elective' ? 'elective' : 'choice';
      r.label = r.code ? (GLOBAL_BY_CODE[r.code] || EXTRA_BY_CODE[r.code] || { title: r.code }).title : r.kind === 'llb' ? 'LLB Alternate' : r.kind === 'elective' ? 'Elective (any WSU subject)' : r.kind === 'choice' ? 'Choice: ' + cleanPoolTitle(rows[r.o].title) : 'Any subject';
      lastK = Math.max(lastK, k);
      firstK = Math.min(firstK, k);
    });
    // pre-2027 subjects passed that count for the 2027 subjects that replaced them, so neither is listed again
    const counted = ctx.slots.filter(function (s) { return s.done && !s.pending && LEGACY_EQUIVALENTS[s.code]; })
      .map(function (s) { return { from: s.code, to: LEGACY_EQUIVALENTS[s.code] }; });
    order.forEach(function (r) { delete r.by; delete r.list; });
    return { skipped: skipped, items: order, cp: order.reduce(function (a, r) { return a + r.cp; }, 0), firstK: firstK, lastK: lastK, lastYear: Math.floor(lastK / 3) + 1, open: open, counted: counted };
  }
  // the guide's items by suggested session, in order
  function guideSessions(g) {
    const by = {};
    g.items.forEach(function (r, i) { (by[r.k] = by[r.k] || { k: r.k, y: r.y, s: r.s, items: [] }).items.push({ r: r, i: i }); });
    return Object.keys(by).map(Number).sort(function (a, b) { return a - b; }).map(function (k) { return by[k]; });
  }
  const GUIDE_KIND = { law: ['Law core subject', 'Law core subjects'], core: ['other required subject', 'other required subjects'], llb: ['LLB Alternate slot', 'LLB Alternate slots'], elective: ['elective', 'electives'], choice: ['choice', 'choices'], open: ['open subject slot', 'open subject slots'] };
  function guideNote(r) {
    if (r.was) return 'Replaces pre-2027 ' + r.was + (PHASE_YEAR[r.was] ? ' · last offered ' + PHASE_YEAR[r.was] : '');
    if (LEGACY[r.code]) return 'Pre-2027 subject' + (PHASE_YEAR[r.code] ? ' · last offered ' + PHASE_YEAR[r.code] + (LEGACY_EQUIVALENTS[r.code] ? ' · after that, ' + LEGACY_EQUIVALENTS[r.code] : '') : '');
    if (LEGACY_OF[r.code] && ctxCohort(lastCtx) === 'pre2027') return 'Replaces pre-2027 ' + LEGACY_OF[r.code] + (PHASE_YEAR[LEGACY_OF[r.code]] ? ' · last offered ' + PHASE_YEAR[LEGACY_OF[r.code]] : '');
    return '';
  }
  function renderGuide(ctx) {
    const box = $('#guide');
    const g = ctx.custom ? ctx.guide : null;
    if (!g) { box.hidden = true; setHTML(box, ''); return; }
    box.hidden = false;
    const kinds = {};
    g.items.forEach(function (r) { (kinds[r.kind] = kinds[r.kind] || []).push(r); });
    const order = ['law', 'core', 'llb', 'choice', 'elective', 'open'].filter(function (k) { return kinds[k]; });
    const count = function (k) { const n = kinds[k].length; return n + ' ' + GUIDE_KIND[k][n === 1 ? 0 : 1]; };
    const cpOf = function (list) { return list.reduce(function (a, r) { return a + r.cp; }, 0); };
    // the sessions an item can go in: from the first not yet begun, to a year past the plan
    const lastY = Math.min(MAX_YEARS, Math.max(g.lastYear, ctx.shownYears || 0) + 1);
    const sessOpts = function (r) {
      let html = '';
      for (let k = g.open; k < lastY * 3; k++) {
        const y = Math.floor(k / 3) + 1;
        const ss = PLAN_SESSIONS[k % 3];
        html += '<option value="' + y + '|' + ss + '"' + (k === r.k ? ' selected' : '') + '>Year ' + y + ' · ' + ss + ' ' + (ss === 'Summer' ? calYear(y) + '/' + String(calYear(y) + 1).slice(2) : calYear(y)) + '</option>';
      }
      return html;
    };
    const item = function (x) {
      const r = x.r;
      const note = guideNote(r);
      const name = r.code ? r.code : r.label;
      return '<li class="guide-item" draggable="true" data-gi="' + x.i + '" title="Drag onto a session in your plan">' +
        '<span class="gi-main">' + (r.code ? '<code>' + esc(r.code) + '</code><span class="gi-title">' + esc(r.label) + '</span>' : '<span class="gi-title gi-open">' + esc(r.label) + '</span>') +
        '<span class="gi-cp">' + r.cp + ' CP</span>' + (note ? '<small class="gi-note">' + esc(note) + '</small>' : '') + '</span>' +
        '<span class="gi-add"><span class="select-wrap"><select id="gi-' + x.i + '" aria-label="Session for ' + esc(name) + '">' + sessOpts(r) + '</select></span>' +
        '<button type="button" class="tbtn tbtn-outline gi-btn" data-action="guide-add" data-gi="' + x.i + '" aria-label="Add ' + esc(name) + ' to the chosen session">+ Add</button>' +
        '<button type="button" class="gi-x" data-action="guide-dismiss" data-gi="' + x.i + '" aria-label="Dismiss the suggestion ' + esc(name) + '" title="Dismiss this suggestion. Undo or Restore brings it back.">Dismiss ×</button></span></li>';
    };
    const open = ui.guideOpen !== false;
    const pinned = !!state.guidePinned;
    box.classList.toggle('is-pinned', pinned);
    document.body.classList.toggle('guide-pinned', pinned);
    const sessions = guideSessions(g);
    // the first session to enrol in is open, and the rest wait folded until asked for, unless the list is short
    const sessOpen = function (gs, i) { return ui.guideSess && ui.guideSess[gs.k] != null ? ui.guideSess[gs.k] : i === 0 || g.items.length <= 8; };
    box.style.setProperty('--pin-w', '0px');
    setHTML(box, '<button type="button" class="guide-pin" data-action="guide-pin" aria-pressed="' + pinned + '" title="' + (pinned ? 'Put the guide back in the page' : 'Keep the guide at the bottom of the screen while you scroll your plan') + '"><span aria-hidden="true">📌</span><span class="gp-text"> ' + (pinned ? 'Unpin Guide' : 'Pin Guide to Bottom') + '</span><span class="sr-only gp-sr">' + (pinned ? 'Unpin Guide' : 'Pin Guide to Bottom') + '</span></button>' +
      '<details class="guide" id="guide-box"' + (open ? ' open' : '') + '>' +
      '<summary><span class="guide-label">Suggested Remaining Guide</span><span class="guide-counts"><b>' + g.cp + ' CP</b> to place<span class="guide-kinds"> · ' + order.map(count).join(' · ') + '</span></span>' +
      '<span class="adv-cta">' + (open ? 'Hide guide' : 'View guide') + '</span></summary>' +
      '<div class="guide-body"><p class="guide-intro">Your plan holds what you have completed or are studying, and the sessions ahead are yours to fill. <b>+ Add</b> puts a subject in the session chosen beside it, or drag it onto a session in your plan.</p>' +
      '<div class="guide-cols"><div class="guide-check"><h3>Remaining degree checklist</h3><ul>' +
      order.map(function (k) { return '<li><b>' + count(k) + '</b> (' + cpOf(kinds[k]) + ' CP)' + (k === 'law' || k === 'core' ? ': ' + kinds[k].map(function (r) { return esc(r.code); }).join(', ') : '') + '</li>'; }).join('') +
      '<li class="gc-total"><b>' + g.cp + ' CP</b> remaining of ' + ctx.plan.cp + ' CP</li></ul>' +
      (g.skipped ? '<p class="guide-counted guide-skipped">' + plural(g.skipped, 'suggestion') + ' dismissed. <button type="button" class="linkish" data-action="guide-restore">Restore</button></p>' : '') +
      (g.counted.length ? '<p class="guide-counted">Already counted, so not listed again: ' + g.counted.map(function (c) { return esc(c.from) + ' for ' + esc(c.to); }).join(', ') + '.</p>' : '') +
      (ctx.tdeg ? '<button type="button" class="text-btn strong guide-compare" data-action="handbook-compare">Compare Pre-2027 vs 2027 Handbook for my progress →</button>' : '') + '</div>' +
      '<div class="guide-plan"><h3>Suggested session by session</h3><div class="guide-sessions">' + sessions.map(function (gs, i) {
        const cp = gs.items.reduce(function (a, x) { return a + x.r.cp; }, 0);
        return '<details class="guide-sess" data-k="' + gs.k + '"' + (sessOpen(gs, i) ? ' open' : '') + '><summary><span class="gs-name">' + sessionLabel(gs.y, gs.s) + '</span><small>Year ' + gs.y + ' · ' + cp + ' CP suggested</small>' +
          '<span class="gs-codes">' + gs.items.map(function (x) { return esc(x.r.code || x.r.label); }).join(', ') + '</span></summary><ul class="guide-items">' + gs.items.map(item).join('') + '</ul></details>';
      }).join('') + '</div></div></div>' +
      '<div class="guide-foot"><button type="button" class="tbtn tbtn-primary" data-action="guide-fill">Auto-fill remaining semesters from guide</button><span class="small muted">Everything stays yours to move or change, and Undo takes it back out.</span></div></div></details>');
  }
  // the room the guide's summary keeps for the Pin button beside it, so the two never overlap at any width
  function sizeGuidePin() {
    const box = $('#guide');
    const pin = box.querySelector('.guide-pin');
    if (pin) box.style.setProperty('--pin-w', Math.ceil(pin.getBoundingClientRect().width) + 'px');
  }
  // puts guide items in the plan: each in the session given, or the one suggested
  function addFromGuide(list, at) {
    const g = lastCtx.guide;
    const plan = editPlan();
    const items = list.map(function (i) { return g.items[i]; }).filter(Boolean);
    if (!plan || !items.length) return;
    const one = items.length === 1;
    noteChange(one ? 'added ' + (items[0].code || items[0].label) + ' from the guide' : 'filled the remaining sessions from the guide');
    let id = '';
    items.forEach(function (r) {
      const to = at ? at.split('|') : [r.y, r.s];
      const x = { y: +to[0], s: to[1], code: r.code, title: '', cp: r.cp, o: r.o || '', done: false };
      yearCode(plan, x);
      plan.slots.push(x);
      if (+to[0] > plan.years) plan.years = +to[0];
      id = 'c' + (plan.slots.length - 1);
    });
    renderMoving(function () { if (one) flashSlot(id, true); });
    toast(one ? (items[0].code || items[0].label) + ' added to ' + sessionLabel(+(at ? at.split('|')[0] : items[0].y), at ? at.split('|')[1] : items[0].s) + '.' : 'Added ' + plural(items.length, 'subject') + ' from the guide to the sessions ahead.', { action: 'undo', label: 'Undo' });
  }

  // ======================================================================== custom degree plans
  const BLANK_DEG = {
    intake: '', intakeList: [], campuses: 'Check the Handbook', campusList: [], students: '', cricos: '', handbook: HANDBOOK_HOME,
    byCode: {}, byComp: {}, components: [], llbComponent: null, catalogueNote: '', advisorNotes: ALL_NOTES, accreditation: [],
    exitAwards: [], assumedKnowledge: '', structure: [], qrSvg: '', tbcSubjects: [], options: [], fixedStructure: false,
  };
  const BLANK_OPT = { majorCode: 'BASE', majorName: '', majorKind: '', majorLabel: '', groupLetter: '', groupUsedFor: [], pathwayKey: '' };
  function tplLabel(key) {
    const o = OPT[key];
    const d = DEG[o.degree];
    return d.code + ' ' + d.title + (o.majorCode !== 'BASE' ? ' · ' + o.majorLabel : '');
  }
  function customName(plan, tdeg) { return plan.name.trim() || (tdeg ? tdeg.title : 'My custom degree'); }
  function customPlaceholder(orig) {
    if (!orig) return 'Choose a subject';
    if (orig.kind === 'fixed' || orig.kind === 'option') return 'Choose a subject (was ' + orig.code + ' ' + orig.title + ')';
    if (orig.kind === 'inline') return 'Choose: ' + orig.options.map(function (o) { return o.code; }).join(' or ');
    return placeholder(orig);
  }
  function resolveCustomSlot(x, i, orig, deg, opt) {
    const filled = !!x.code;
    const same = !!(orig && filled && orig.code === x.code && (orig.kind === 'fixed' || orig.kind === 'option'));
    const twin = !!(orig && filled && !same && (orig.kind === 'fixed' || orig.kind === 'option') && sameAs(orig.code).indexOf(x.code) >= 0);
    const s = {
      raw: { slot: i, kind: orig ? orig.kind : 'open', pool: orig ? orig.pool : null, options: orig ? orig.options : null, title: orig ? orig.title : '' },
      orig: orig, idx: i, id: 'c' + i, year: x.y, session: x.s, cp: x.cp, kind: 'cslot', type: orig ? orig.type : '',
      typeLabel: '', selectable: true, pick: null, done: x.done, pending: !filled, chosen: false, auto: false, custom: false,
      listSubject: false, code: filled ? x.code : null, title: null, offer: null, tbcFlag: false, replaced: null, cardClass: 'k-slot',
    };
    if (filled) {
      // a template subject keeps its pathway offering only while it stays in its original session
      if (same) { s.title = orig.title; s.offer = x.s === orig.session ? parseOffered(orig.offered) : offerFor(deg, x.code, x.s); }
      else if (GLOBAL_BY_CODE[x.code]) {
        s.title = GLOBAL_BY_CODE[x.code].title;
        s.offer = offerFor(deg, x.code, x.s);
        const io = orig && orig.kind === 'inline' ? orig.options.find(function (o) { return o.code === x.code; }) : null;
        if (io && io.tbcFlag && s.offer) { s.offer.tbc = true; s.tbcFlag = true; }
      } else if (LEGACY[x.code]) { s.title = LEGACY[x.code]; s.legacy = true; }
      else if (EXTRA_BY_CODE[x.code]) { s.title = EXTRA_BY_CODE[x.code].title; s.listSubject = true; }
      else { s.title = x.title; s.custom = true; }
      if (twin) s.twin = orig;
    } else {
      s.title = customPlaceholder(orig);
    }
    // template core subjects keep their colour; anything the student changed or chose turns gold
    if (orig && (orig.kind === 'fixed' || orig.kind === 'option') && !same && !twin) s.replaced = orig;
    if (filled && (same || twin)) s.cardClass = kindClass({ kind: orig.kind, group: typeGroup(orig.type) });
    else if (filled && orig) s.chosen = true;
    else if (filled) s.cardClass = /^LAWS /.test(x.code) ? 'k-law' : 'k-nonlaw';
    s.typeLabel = orig ? typeLabel(orig, opt) : filled ? (/^LAWS /.test(x.code) ? 'Law' : 'Non-law') : 'Open slot';
    const ok = orig ? orig.kind : '';
    s.pendingCode = ok === 'llb' ? 'LLB ALT' : ok === 'elective' ? 'ELECTIVE' : ok === 'pool' || ok === 'inline' ? 'CHOICE' : 'OPEN';
    s.pendingLabel = orig && ok !== 'fixed' && ok !== 'option' ? pendingPrintTitle({ kind: ok, raw: orig }) : orig ? 'Open slot (was ' + orig.code + ')' : 'Open slot: subject to choose';
    return s;
  }
  function buildCustomContext(plan) {
    const tdeg = plan.tpl ? DEG[plan.tpl.split('|')[0]] : null;
    const topt = plan.tpl ? OPT[plan.tpl] : null;
    const deg = Object.assign({}, tdeg || BLANK_DEG, {
      code: plan.code || 'Custom', title: customName(plan, tdeg), cp: plan.cp, ftYears: plan.cp / 80, ptYears: plan.cp / 40,
      catalogue: tdeg ? tdeg.catalogue : globalList(),
      catalogueNote: tdeg ? tdeg.catalogueNote : 'Every subject in the 2027 WSLSA degree guides, with its published sessions. Search to include the WSU subject list.',
    });
    const opt = topt || BLANK_OPT;
    const origById = {};
    if (plan.tpl) PATH[plan.tpl].forEach(function (r) { origById[r.id] = r; });
    // in the pre-2027 structure a slot where a core subject new in 2027 stood is an LLB Alternate slot
    const llb = plan.tpl && cohortOf(plan) === 'pre2027' ? PATH[plan.tpl].find(function (r) { return r.kind === 'llb'; }) : null;
    const slots = plan.slots.map(function (x, i) {
      const orig = origById[x.o] || null;
      const stand = !!llb && isNewCore(orig) && x.code !== orig.code;
      const s = resolveCustomSlot(x, i, stand ? llb : orig, deg, opt);
      if (stand) s.newCore = orig;
      return s;
    });
    const ctx = indexSlots({ key: 'custom', custom: true, plan: plan, deg: deg, opt: opt, tdeg: tdeg, topt: topt, slots: slots });
    ctx.placedCP = slots.reduce(function (a, s) { return a + (s.pending ? 0 : s.cp); }, 0);
    return ctx;
  }
  // Copies a WSLSA pathway into custom slots, optionally with the student's own choices and ticks.
  // With mine, it is the pathway as the student has it, in the structure it is shown in; without, the 2027 pathway.
  // A slot standing in for a core subject new in 2027 stays tied to that subject, so the 2027 structure can put it back.
  function templateSlots(key, mine) {
    return guideSlots(key, mine ? state.picks[key] || {} : {}, mine ? state.done[key] || {} : {}, mine ? guideCohort(key) : '2027').map(function (s) {
      return { y: s.year, s: s.session, code: s.pending ? '' : s.code, title: s.custom ? s.title : '', cp: s.cp, o: s.id, done: s.done };
    });
  }
  // The rows of a pathway that matter to the Handbook structures: its LLB Alternate slots and its core subjects new in 2027.
  function structureRows(tpl) {
    const out = { rows: {}, llb: [], isLLB: {}, core: {}, alt: {} };
    PATH[tpl].forEach(function (r) {
      out.rows[r.id] = r;
      if (r.kind === 'llb') { out.llb.push(r); out.isLLB[r.id] = 1; }
      if (isNewCore(r)) out.core[r.code] = r;
    });
    const deg = DEG[tpl.split('|')[0]];
    (deg.byComp[deg.llbComponent] || []).forEach(function (c) { out.alt[c.code] = 1; });
    return out;
  }
  // Moves a plan's slots to a Handbook structure, so that a switch there and back leaves the plan as it was. Subjects
  // completed, or in a session that has begun (before open), are history and never change.
  // To the pre-2027 structure: a core subject new in 2027 becomes an open LLB Alternate slot where it stands, still tied
  // to the subject it stood for.
  // To the 2027 structure: each of those slots still open takes its core subject back, one holding an LLB Alternate keeps
  // it as an LLB Alternate slot, and while the plan has more LLB Alternate slots than the pathway, an open one becomes
  // each core subject still missing: where the pathway has it, else the latest in a session of the kind it runs in.
  function restructure(tpl, slots, cohort, start) {
    const t = structureRows(tpl);
    const pre = cohort === 'pre2027';
    const open = start ? firstOpenIdx(start) : 0;
    const kept = function (x) { return x.done || orderIdx(x.y, x.s) < open; };
    const held = {};
    slots.forEach(function (x) { if (x.code) held[x.code] = 1; });
    // a subject still ahead goes by the code a student enrols in that year: the 2027 one from 2027
    const out = slots.map(function (x) {
      if (kept(x) || !x.code) return x;
      const to = codeFor(x.code, cohort, (start || START_YEAR) + x.y - 1, startedBefore(start));
      if (to === x.code || held[to]) return x;
      held[to] = 1;
      return Object.assign({}, x, { code: to, title: '' });
    });
    if (!t.llb.length) return out;
    if (pre) {
      return out.map(function (x) {
        return kept(x) || NEW_2027_CORES.indexOf(x.code) < 0 ? x : Object.assign({}, x, { code: '', title: '', o: (t.core[x.code] || t.llb[0]).id });
      });
    }
    out.forEach(function (x, i) {
      const r = t.rows[x.o];
      if (!isNewCore(r) || x.code === r.code || kept(x)) return;
      if (!x.code && !held[r.code]) { held[r.code] = 1; out[i] = Object.assign({}, x, { code: r.code, title: '', cp: r.cp }); }
      else if (!x.code || t.alt[x.code]) out[i] = Object.assign({}, x, { o: t.llb[0].id });
    });
    let llbSlots = out.filter(function (x) { return t.isLLB[x.o]; }).length;
    const at = function (i) { return orderIdx(out[i].y, out[i].s); };
    NEW_2027_CORES.forEach(function (code) {
      const raw = t.core[code];
      if (!raw || held[code] || llbSlots <= t.llb.length) return;
      const home = orderIdx(raw.year, raw.session);
      const spare = out.map(function (x, i) { return i; }).filter(function (i) { return t.isLLB[out[i].o] && !out[i].code && !kept(out[i]); })
        .sort(function (a, b) { return (at(a) === home ? 0 : 1) - (at(b) === home ? 0 : 1) || (out[a].s === raw.session ? 0 : 1) - (out[b].s === raw.session ? 0 : 1) || at(b) - at(a) || b - a; });
      if (!spare.length) return;
      out[spare[0]] = Object.assign({}, out[spare[0]], { code: code, title: '', cp: raw.cp, o: raw.id });
      held[code] = 1;
      llbSlots--;
    });
    return out;
  }
  // What an imported plan still needs, moved to a Handbook structure with its slots: the core subjects new in 2027 are
  // LLB Alternates to choose under the pre-2027 structure, and the other way round while there are LLB Alternates to spare.
  function restructureNeed(plan, cohort) {
    if (!plan.tpl || !plan.need.length) return plan.need;
    const t = structureRows(plan.tpl);
    const pre = cohort === 'pre2027';
    const had = {};
    plan.slots.forEach(function (x) { if (x.code) sameAs(x.code).forEach(function (c) { had[c] = 1; }); });
    const need = plan.need.map(function (n) {
      if (!n.code) return n;
      if (pre) {
        if (NEW_2027_CORES.indexOf(n.code) >= 0 && t.llb.length) return { code: '', was: '', cp: n.cp, o: t.llb[0].id, sess: '' };
        const now = LEGACY_EQUIVALENTS[n.code] || n.code;
        // a student who started before 2027 is listed the pre-2027 subject, and one who did not, the 2027 subject with a note
        return startedBefore(plan.start) ? Object.assign({}, n, { code: LEGACY_OF[now] || now, was: '' }) : Object.assign({}, n, { code: now, was: LEGACY_OF[now] || '' });
      }
      return Object.assign({}, n, { code: LEGACY_EQUIVALENTS[n.code] || n.code, was: '' });
    });
    if (pre || !t.llb.length) return need;
    const openLLB = function (n) { return !n.code && t.isLLB[n.o]; };
    let llbTotal = plan.slots.filter(function (x) { return t.isLLB[x.o] || (isNewCore(t.rows[x.o]) && x.code !== t.rows[x.o].code); }).length + need.filter(openLLB).length;
    NEW_2027_CORES.forEach(function (code) {
      const raw = t.core[code];
      const i = need.findIndex(openLLB);
      if (!raw || had[code] || i < 0 || llbTotal <= t.llb.length || need.some(function (n) { return n.code === code; })) return;
      need[i] = { code: code, was: '', cp: raw.cp, o: raw.id, sess: raw.session };
      llbTotal--;
    });
    return need;
  }
  function emptyCSlot(y, s) { return { y: y, s: s, code: '', title: '', cp: 10, o: '', done: false }; }
  // Matches the plan's slots to the credit points required: removes open slots from the latest
  // sessions first (never a chosen subject) and adds open 10 CP slots after the last session in use.
  function fitToCP(plan) {
    let cap = plan.slots.reduce(function (a, x) { return a + x.cp; }, 0);
    const open = plan.slots.map(function (x, i) { return i; }).filter(function (i) { return !plan.slots[i].code; })
      .sort(function (a, b) { return orderIdx(plan.slots[b].y, plan.slots[b].s) - orderIdx(plan.slots[a].y, plan.slots[a].s) || b - a; });
    const drop = {};
    open.forEach(function (i) {
      if (cap - plan.slots[i].cp >= plan.cp && cap > plan.cp) { cap -= plan.slots[i].cp; drop[i] = 1; }
    });
    plan.slots = plan.slots.filter(function (x, i) { return !drop[i]; });
    const load = {};
    let idx = 0;
    plan.slots.forEach(function (x) {
      const k = orderIdx(x.y, x.s);
      load[k] = (load[k] || 0) + x.cp;
      idx = Math.max(idx, k);
    });
    // open slots only ever go into Autumn and Spring; Summer is the student's own choice
    while (cap < plan.cp && plan.slots.length < MAX_SLOTS) {
      while (PLAN_SESSIONS[idx % 3] === 'Summer' || (load[idx] || 0) + 10 > LOAD_CP.FT) idx++;
      const y = Math.floor(idx / 3) + 1;
      if (y > MAX_YEARS) break;
      plan.slots.push(emptyCSlot(y, PLAN_SESSIONS[idx % 3]));
      load[idx] = (load[idx] || 0) + 10;
      cap += 10;
    }
    return plan;
  }
  function usedElsewhere(ctx, code, slotId) {
    const ids = ctx.used[code] || [];
    return ids.some(function (id) { return id !== slotId; });
  }
  function poolEntries(ctx, raw) {
    const comps = raw.kind === 'elective' ? [ctx.deg.llbComponent] : raw.pool;
    const seen = {};
    const out = [];
    comps.forEach(function (comp) {
      (ctx.deg.byComp[comp] || []).forEach(function (e) {
        if (seen[e.code]) return;
        seen[e.code] = 1;
        out.push(e);
      });
    });
    return out;
  }

  // ======================================================================== risk engine
  function prereqHint(ctx, note, flagSlot) {
    const fIdx = flagSlot ? orderIdx(flagSlot.year, flagSlot.session) : Infinity;
    const have = ctx.slots.find(function (s) { return !s.pending && sameAs(note.prereq).indexOf(s.code) >= 0; });
    if (have) {
      return { type: orderIdx(have.year, have.session) < fIdx ? 'have-before' : 'have-after', slot: have };
    }
    const optSlot = ctx.slots.find(function (s) {
      if (s.kind === 'inline') return s.raw.options.some(function (o) { return o.code === note.prereq; });
      if (s.kind === 'pool' || s.kind === 'option') return poolEntries(ctx, s.raw).some(function (e) { return e.code === note.prereq; });
      return false;
    });
    if (optSlot) return { type: 'option', slot: optSlot, before: orderIdx(optSlot.year, optSlot.session) < fIdx };
    return null;
  }
  function hintText(note, h, flagSlot) {
    if (!h) return '';
    if (h.type === 'have-before') return 'Your plan has ' + note.prereq + ' in ' + where(h.slot) + ', before ' + note.subject + '. Still confirm with the advisor that this satisfies the rule.';
    if (h.type === 'have-after') return 'Your plan has ' + note.prereq + ' in ' + where(h.slot) + ', which is after ' + note.subject + (flagSlot ? ' (' + where(flagSlot) + ')' : '') + '.';
    if (h.type === 'option') return note.prereq + ' is one of the options in your ' + where(h.slot) + ' choice slot' + (h.before ? '; picking it there places it before ' + note.subject + '.' : ', but that slot sits after ' + note.subject + '.');
    return '';
  }
  function computeRisks(ctx) {
    const advisor = [];
    // a plan built from scratch has no degree rules, so notes from any guide show only for subjects in it
    const fromAnyGuide = ctx.custom && !ctx.tdeg;
    ctx.deg.advisorNotes.forEach(function (n) {
      const applies = !fromAnyGuide && (!n.major || n.major === ctx.opt.majorName);
      const flagSlot = ctx.slots.find(function (s) { return !s.pending && s.code === n.subject; }) || null;
      if (!applies && !flagSlot) return;
      const h = prereqHint(ctx, n, flagSlot);
      advisor.push({ note: n, applies: applies, flagSlot: flagSlot, hint: hintText(n, h, flagSlot), resolvedByChoice: !!(h && h.type === 'have-before' && h.slot.chosen) });
    });
    // where and when a subject runs no longer matters once it is passed
    // nor does it for a session that has already begun: what a student took then ran then, whatever 2027 offers
    const begun = ctx.custom && ctx.plan.start ? firstOpenIdx(ctx.plan.start) : 0;
    const live = ctx.slots.filter(function (s) { return !s.pending && s.offer && !s.done && orderIdx(s.year, s.session) >= begun; });
    const tbc = live.filter(function (s) { return s.offer.tbc; });
    const y2026 = live.filter(function (s) { return s.offer.y2026 && !s.offer.tbc; });
    const notOffered = live.filter(function (s) { return s.offer.none; });
    let campus = [];
    let onlineOnly = [];
    if (state.campus) {
      live.forEach(function (s) {
        if (s.offer.tbc || s.offer.none) return;
        const here = s.offer.codes.indexOf(state.campus) >= 0;
        const online = s.offer.codes.indexOf('ON') >= 0;
        if (!here && !online) campus.push(s);
        else if (!here && online) onlineOnly.push(s);
      });
    }
    const pending = ctx.slots.filter(function (s) { return s.pending; });
    const summer = ctx.slots.filter(function (s) { return s.session === 'Summer' && !s.pending && !s.done; });
    const unlisted = ctx.slots.filter(function (s) { return (s.listSubject || s.custom) && s.session !== 'Summer' && !s.done; });
    const legacy = ctx.slots.filter(function (s) { return !s.pending && !s.done && s.legacy; });
    const r = { legacy: legacy, unlisted: unlisted, summer: summer, advisor: advisor, tbc: tbc, y2026: y2026, notOffered: notOffered, campus: campus, onlineOnly: onlineOnly, pending: pending, dupes: [], overload: [], replaced: [], cpShort: 0, cpOver: 0 };
    if (ctx.custom) {
      r.dupes = Object.keys(ctx.used).filter(function (c) { return ctx.used[c].length > 1; })
        .map(function (c) { return { code: c, slots: ctx.used[c].map(function (id) { return ctx.byId[id]; }) }; });
      // a pre-2027 subject and the 2027 subject that replaced it count once between them
      Object.keys(LEGACY_EQUIVALENTS).forEach(function (old) {
        const a = ctx.used[old];
        const b = ctx.used[LEGACY_EQUIVALENTS[old]];
        if (a && b) r.dupes.push({ code: old + ' / ' + LEGACY_EQUIVALENTS[old], slots: a.concat(b).map(function (id) { return ctx.byId[id]; }) });
      });
      const load = {};
      ctx.slots.forEach(function (s) {
        const k = orderIdx(s.year, s.session);
        load[k] = load[k] || { year: s.year, session: s.session, cp: 0, open: false, cap: sessionCap(ctx.plan, k) };
        load[k].cp += s.cp;
        if (!s.done) load[k].open = true;
      });
      r.overload = Object.keys(load).map(Number).sort(function (a, b) { return a - b; }).map(function (k) { return load[k]; })
        .filter(function (l) { return l.cp > l.cap && l.open; });
      r.replaced = ctx.slots.filter(function (s) { return s.replaced; });
      const placed = ctx.slots.reduce(function (a, s) { return a + (s.pending ? 0 : s.cp); }, 0);
      r.cpShort = Math.max(0, ctx.plan.cp - ctx.totalCP);
      r.cpOver = Math.max(0, placed - ctx.plan.cp);
    }
    return r;
  }

  // ======================================================================== timeline (FT / PT)
  function timeline(ctx, load) {
    const years = {};
    function slotIn(y, sess, s) {
      years[y] = years[y] || { year: y, Autumn: [], Spring: [], Summer: [] };
      years[y][sess].push(s);
    }
    if (load !== 'PT') {
      ctx.slots.forEach(function (s) { slotIn(s.year, s.session, s); });
      // a plan's own sessions ahead stay in view while they are empty, ready to fill
      const show = ctx.custom ? Math.max(ctx.plan.years || 0, ctx.guide ? ctx.guide.lastYear : 0) : 0;
      for (let y = 1; y <= show; y++) years[y] = years[y] || { year: y, Autumn: [], Spring: [], Summer: [] };
    } else if (ctx.custom) {
      // A custom plan keeps every session that has begun as it is, and lays out the rest at 20 CP a session,
      // each subject in the session type it is planned for and never earlier than it is planned.
      const open = ctx.plan.start ? firstOpenIdx(ctx.plan.start) : 0;
      const load = {};
      ctx.slots.slice().sort(function (a, b) { return orderIdx(a.year, a.session) - orderIdx(b.year, b.session) || a.idx - b.idx; }).forEach(function (s) {
        let k = orderIdx(s.year, s.session);
        if (k < open) { slotIn(s.year, s.session, s); return; }
        while (PLAN_SESSIONS[k % 3] !== s.session || (load[k] && load[k] + s.cp > LOAD_CP.PT)) k++;
        load[k] = (load[k] || 0) + s.cp;
        slotIn(Math.floor(k / 3) + 1, s.session, s);
      });
    } else {
      // Indicative part-time reflow: each full-time session is split into two 20 CP halves. The first
      // half runs in part-time year 2y-1 and the second in year 2y, always in the same session type,
      // so every subject stays in a session it is offered in.
      const groups = {};
      ctx.slots.forEach(function (s) { (groups[s.year + s.session] = groups[s.year + s.session] || []).push(s); });
      Object.keys(groups).forEach(function (k) {
        const list = groups[k].slice().sort(function (a, b) { return a.raw.slot - b.raw.slot; });
        let cum = 0;
        let second = false;
        list.forEach(function (s) {
          if (!second && cum + s.cp <= LOAD_CP.PT) { cum += s.cp; slotIn(s.year * 2 - 1, s.session, s); }
          else { second = true; slotIn(s.year * 2, s.session, s); }
        });
      });
    }
    return Object.keys(years).map(Number).sort(function (a, b) { return a - b; }).map(function (y) { return years[y]; });
  }
  // Calendar dates assume a start in Autumn 2027 (START_YEAR), the intake these guides are for, except in a plan
  // imported from a student's results, which starts the year they did. Summer runs over the break after
  // Spring, so it spans two calendar years.
  function planStart() { const p = editPlan(); return p && p.start ? p.start : START_YEAR; }
  function calYear(y) { return planStart() + y - 1; }
  function termName(year, sess) { return sess === 'Summer' ? 'Summer ' + year + '/' + String(year + 1).slice(2) : sess + ' ' + year; }
  function sessionLabel(y, sess) { return termName(calYear(y), sess); }
  function sessionsInOrder(ctx) {
    const out = [];
    timeline(ctx, state.load).forEach(function (y) {
      PLAN_SESSIONS.forEach(function (sess) { if (y[sess].length) out.push({ year: y.year, session: sess, slots: sortSlots(y[sess]) }); });
    });
    return out;
  }
  // the last session with anything in it; moving subjects into Summer can bring it forward
  function finishOf(ctx) {
    const all = sessionsInOrder(ctx);
    return all.length ? all[all.length - 1] : null;
  }
  // the first session with a subject not yet ticked off; in a plan with past years, sessions that have
  // already begun are passed over, as their subjects are under way
  function nextSession(ctx) {
    const open = ctx.custom && ctx.plan.start ? firstOpenIdx(ctx.plan.start) : 0;
    return sessionsInOrder(ctx).find(function (x) { return orderIdx(x.year, x.session) >= open && x.slots.some(function (s) { return !s.done; }); }) || null;
  }

  // ======================================================================== render: pieces
  const ROMAN = [['M', 1000], ['CM', 900], ['D', 500], ['CD', 400], ['C', 100], ['XC', 90], ['L', 50], ['XL', 40], ['X', 10], ['IX', 9], ['V', 5], ['IV', 4], ['I', 1]];
  function roman(n) {
    let out = '';
    ROMAN.forEach(function (r) { while (n >= r[1]) { out += r[0]; n -= r[1]; } });
    return out;
  }
  // Card family: law, non-law and major cards are fixed; every slot the student fills is a gold "choice" card.
  function kindClass(s) {
    if (s.kind === 'cslot') return s.cardClass;
    if (s.kind === 'llb' || s.kind === 'pool' || s.kind === 'inline' || s.kind === 'elective') return 'k-slot';
    if (s.group === 'law') return 'k-law';
    if (s.group === 'major') return 'k-major';
    return 'k-nonlaw';
  }
  function titleHTML(t) { return esc(t).replace(/\//g, '<span class="slash">/</span>'); }
  function selectionLabel(ctx) {
    const o = ctx.opt;
    if (o.majorCode !== 'BASE') return o.majorLabel;
    const built = builtInMajor(ctx.deg);
    return built ? 'Built-in major: ' + built : 'No major or minor';
  }

  function pill(code, opts) {
    opts = opts || {};
    const name = CAMPUS_NAMES[code] || code;
    let cls = 'pill cp-' + code;
    if (state.campus && code !== 'TBC') cls += code === state.campus ? ' on' : code === 'ON' ? ' online' : ' dim';
    const actionable = PRIMARY_CAMPUSES.indexOf(code) >= 0;
    const tip = name + (code === state.campus ? ' · your campus (click to clear)' : actionable ? ' · click to highlight' : code === 'ON' && state.campus ? ' · available to you online' : '');
    // only legend pills take keyboard focus; the Primary campus selector covers the rest
    return '<span class="' + cls + '"' + (opts.focus ? ' tabindex="0"' : '') + ' data-tip="' + esc(tip) + '"' + (actionable ? ' role="button" data-action="campus-pill" data-campus="' + code + '"' : '') + ' aria-label="' + esc(name) + '">' + esc(code) + '</span>';
  }
  function pillsFor(offer) {
    if (!offer) return '<span class="muted small">Custom</span>';
    if (offer.tbc) return pill('TBC') + (offer.y2026 ? '<span class="pill pill-y2026" data-tip="2026 session data">2026</span>' : '');
    if (offer.none) return '<span class="muted small" title="Not offered in this session">Not offered</span>';
    return offer.codes.map(function (c) { return pill(c); }).join('') +
      (offer.y2026 ? '<span class="pill pill-y2026" data-tip="2027 session not yet published: 2026 session shown">2026</span>' : '');
  }
  const LOCK_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
  const OK_ICON = '<svg class="adv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="m7.8 12.3 2.9 2.9 5.5-6"/></svg>';
  const ALERT_ICON = '<svg class="adv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 10v4.5M12 17.2v.3" stroke-linecap="round"/></svg>';

  function builtInMajor(deg) {
    const m = deg.components.map(function (c) { return /^(\w{4}) (.+?), (Testamur Major|Major|Minor)/.exec(c); }).filter(Boolean)[0];
    return m ? m[1] + ' ' + m[2] + ', ' + m[3] : null;
  }

  function groupDiff(ctx) {
    const other = ctx.deg.options.map(function (k) { return OPT[k]; }).find(function (o) { return o.groupLetter !== ctx.opt.groupLetter; });
    if (!other) return null;
    function sig(key) {
      const m = {};
      PATH[key].forEach(function (r) {
        if (r.kind !== 'fixed' || (r.type !== 'Law' && r.type !== 'Non-law')) return;
        const k = r.year + ' ' + r.session;
        (m[k] = m[k] || []).push(r.code);
      });
      Object.keys(m).forEach(function (k) { m[k] = m[k].sort().join('|'); });
      return m;
    }
    const a = sig(ctx.key);
    const b = sig(other.pathwayKey);
    const keys = Array.from(new Set(Object.keys(a).concat(Object.keys(b)))).sort();
    return { other: other.groupLetter, diffs: keys.filter(function (k) { return a[k] !== b[k]; }) };
  }
  function pathwayWhy(ctx) {
    const o = ctx.opt;
    const deg = ctx.deg;
    if (!o.groupLetter) {
      return deg.fixedStructure
        ? '<b>Single recommended pathway.</b> ' + deg.code + ' has one structure, so one WSLSA Autumn/Spring sequence covers every student, and you can still move or change any subject in it.'
        : '<b>Single recommended pathway.</b> One Autumn/Spring sequence fits all ' + plural(deg.options.length, (o.majorKind === 'Minor' ? 'minor' : 'major')) + ' in ' + deg.code + ' against the published 2027 offerings; only the ' + (o.majorKind === 'Minor' ? 'minor' : 'major') + ' subjects change.';
    }
    const kind = (o.majorKind || 'major').toLowerCase().replace('testamur ', '');
    const d = groupDiff(ctx);
    const shared = o.groupUsedFor.map(function (n) { return n === o.majorName ? '<b>' + esc(n) + '</b>' : esc(n); }).join(', ');
    let diffText = '';
    if (d) {
      diffText = d.diffs.length
        ? ' Compared with Pathway ' + d.other + ', the core law and non-law subjects move in ' + d.diffs.map(function (k) { return 'Y' + k; }).join(', ') + ' to make room for ' + kind + ' subjects in the sessions they run.'
        : ' Core law and non-law subjects sit in the same sessions as Pathway ' + d.other + '; only the ' + kind + ' and choice slots move.';
    }
    return '<b>Why Pathway ' + o.groupLetter + '?</b> ' + deg.code + ' needs ' + deg.pathwayGroups + ' recommended pathways so every ' + kind + ' fits the published Autumn/Spring offerings. Pathway ' + o.groupLetter + ' is used for ' + shared + '.' + diffText;
  }

  function customWhy(ctx) {
    return '<b>Your own progression.</b> Set the credit points your degree needs, then fill each session with any WSU subject. Subjects from the 2027 WSLSA guides show their published sessions and campuses; subjects from the WSU subject list or typed in yourself need checking in the Handbook.' +
      ' Add a Summer session to any year to take a subject over the break or bring one forward; the guides have no Summer data, so check each Summer subject in the Handbook.' +
      (ctx.tdeg ? ' This plan started from the ' + esc(tplLabel(ctx.plan.tpl)) + ' pathway, and anything you change or choose turns gold.' : '') +
      ' A custom plan is not a WSLSA recommendation, so confirm it with the Academic Program Advisor before you enrol.';
  }
  // the finish replaces a plain duration: it moves with the load and with subjects taken over Summer
  function finishText(ctx) {
    const end = finishOf(ctx);
    // an imported plan, or one with nothing planned ahead, finishes where the guide's suggestions end
    const g = ctx.custom ? ctx.guide : null;
    const ahead = g && ctx.slots.some(function (s) { return !s.done && orderIdx(s.year, s.session) >= g.open; });
    if (g && (ctx.plan.need.length || !ahead) && (!end || g.lastK > orderIdx(end.year, end.session))) return { at: sessionLabel(Math.floor(g.lastK / 3) + 1, PLAN_SESSIONS[g.lastK % 3]), how: 'following the guide' };
    if (!end) return { at: 'No subjects yet', how: '' };
    const pace = ctx.custom ? ctx.plan.pace : 0;
    const pt = state.load === 'PT';
    return {
      at: sessionLabel(end.year, end.session),
      how: pace ? PACE_NAME[pace] : fmt(pt ? ctx.deg.ptYears : ctx.deg.ftYears) + ' yrs ' + (pt ? 'part-time' : 'full-time'),
    };
  }
  function heroPills(ctx) {
    const f = finishText(ctx);
    const began = (planStart() < START_YEAR ? 'Started ' : 'Starting ') + planStart();
    return stagePill(ctx) + '<span class="hero-pill hp-cp" title="Credit points the degree requires"><span class="num">' + ctx.deg.cp + '</span> CP</span>' +
      '<span class="hero-pill hp-finish" title="' + esc(began) + '">Finish ' + esc(f.at) + (f.how ? ' <small>· ' + esc(f.how) + '</small>' : '') + '</span>' +
      '<a class="hero-pill hp-link" href="' + esc(ctx.deg.handbook) + '" target="_blank" rel="noopener">' + (ctx.custom && !ctx.tdeg ? 'WSU Handbook ↗' : '2027 Handbook ↗') + '</a>';
  }
  function renderHero(ctx) {
    const d = ctx.deg;
    const o = ctx.opt;
    if (ctx.custom && !ctx.edit) {
      $('#hero-title').innerHTML = titleHTML(d.title);
      $('#hero-meta').innerHTML = '<span class="course" title="Course code">' + esc(ctx.plan.code || 'Custom') + '</span>' +
        '<span class="major">' + (ctx.tdeg ? 'Based on ' + esc(tplLabel(ctx.plan.tpl)) : 'Built from scratch') + '</span>' +
        '<span class="pbadge">Custom pathway</span>' + heroPills(ctx) +
        '<button type="button" class="why-btn" data-action="why" aria-expanded="' + !!ui.whyOpen + '" aria-controls="why-text">' + (ui.whyOpen ? 'Hide explanation ▴' : 'About custom plans ▾') + '</button>' +
        '<p class="why-text" id="why-text"' + (ui.whyOpen ? '' : ' hidden') + '>' + customWhy(ctx) + '</p>';
      document.title = 'WSLSA 2027 · ' + (ctx.plan.code ? ctx.plan.code + ' ' : '') + d.title + ' (custom)';
      return;
    }
    $('#hero-title').innerHTML = titleHTML(d.title);
    $('#hero-meta').innerHTML = '<span class="course" title="Course code">' + d.code + '</span>' +
      '<span class="major">' + esc(o.majorCode === 'BASE' && !builtInMajor(d) ? 'No major or minor' : selectionLabel(ctx)) + '</span>' +
      '<span class="pbadge">' + (o.groupLetter ? 'Pathway ' + o.groupLetter : 'Single pathway') + '</span>' +
      (ctx.edit ? '<span class="pbadge pbadge-edit" title="Your changes to this pathway are kept in this browser. Reset to Default Sequence in Plan Tools puts the WSLSA order back.">Edited by you</span>' : '') +
      (ctxCohort(ctx) === 'pre2027' ? '<span class="pbadge pbadge-pre" title="' + esc(COHORT_LABEL.pre2027) + '">Pre-2027 structure</span>' : '') + heroPills(ctx) +
      '<button type="button" class="why-btn" data-action="why" aria-expanded="' + !!ui.whyOpen + '" aria-controls="why-text">' + (ui.whyOpen ? 'Hide explanation ▴' : 'Why this pathway? ▾') + '</button>' +
      '<p class="why-text" id="why-text"' + (ui.whyOpen ? '' : ' hidden') + '>' + pathwayWhy(ctx) + '</p>';
    document.title = 'WSLSA 2027 · ' + d.code + ' ' + d.title + (ctx.edit ? ' (edited)' : '');
  }

  // the load a plan runs at now: its re-paced load, or the view chosen in the dock
  function paceNow(ctx) { return ctx.custom && ctx.plan.pace && state.load === 'FT' ? ctx.plan.pace : LOAD_CP[state.load]; }
  function progressMeta(ctx) {
    const remaining = Math.max(ctx.deg.cp - ctx.doneCP, 0);
    const pace = paceNow(ctx);
    return remaining ? remaining + ' CP to go · ≈ ' + plural(Math.ceil(remaining / pace), 'session') + ' ' + (pace === 40 ? 'FT' : pace === 20 ? 'PT' : 'at ' + pace + ' CP') : 'All ' + ctx.deg.cp + ' CP complete';
  }
  // Degree requirements at a glance: for each kind of subject, the credit points completed, planned and still to place.
  // What an imported plan's guide still lists counts towards the total of its kind.
  const TRACK = [['law', 'Law core', 'Law'], ['nonlaw', 'Non-law core', 'Non-law'], ['major', 'Major / minor', 'Major'], ['llb', 'LLB Alternates', 'LLB Alt'], ['choice', 'Choices', 'Choices'], ['elective', 'Electives', 'Electives'], ['open', 'Open slots', 'Open']];
  function slotGroup(ctx, s) { return s.newCore ? 'llb' : ctx.custom ? (s.orig ? typeGroup(s.orig.type) : s.pending ? 'open' : /^LAWS /.test(s.code) ? 'law' : 'nonlaw') : s.group; }
  function requirementGroups(ctx) {
    const g = {};
    const at = function (k) { return g[k] = g[k] || { cp: 0, done: 0, planned: 0 }; };
    ctx.slots.forEach(function (s) {
      const k = slotGroup(ctx, s);
      const t = at(k);
      t.cp += s.cp;
      if (s.done) t.done += s.cp; else if (!s.pending) t.planned += s.cp;
    });
    if (ctx.custom && ctx.guide) ctx.guide.items.forEach(function (r) { at(r.kind === 'core' ? 'nonlaw' : r.kind).cp += r.cp; });
    return TRACK.filter(function (t) { return g[t[0]] && g[t[0]].cp > 0; }).map(function (t) { return Object.assign({ key: t[0], label: t[1], short: t[2] }, g[t[0]]); });
  }
  function renderTracker(ctx) {
    const groups = requirementGroups(ctx);
    // on a wide screen the meters sit in the dock, beside the progress, and stay in sight; otherwise under the advisory
    const box = $('#tracker');
    box.hidden = groups.length < 2;
    const items = groups.map(function (t) {
      const left = t.cp - t.done - t.planned;
      const tip = t.done + ' CP completed, ' + t.planned + ' CP planned' + (left > 0 ? ', ' + left + ' CP still to choose or place' : '');
      return '<li class="track-item tk-' + t.key + (t.done >= t.cp ? ' is-done' : '') + '"><button type="button" class="track-btn" data-action="track-filter" data-k="' + t.key + '" aria-pressed="' + (ui.trackKey === t.key) + '" title="' + esc(t.label + ': ' + tip + '. Press to pick these out in your plan.') + '"><span class="track-top"><span class="track-label"><span class="tl-full">' + esc(t.label) + '</span><span class="tl-short" aria-hidden="true">' + esc(t.short) + '</span></span><span class="track-num"><b>' + t.done + '</b> / ' + t.cp + ' CP</span></span>' +
        '<span class="track-bar" role="img" aria-label="' + esc(t.label + ': ' + tip) + '"><i class="tb-done" style="width:' + (t.done / t.cp * 100) + '%"></i><i class="tb-plan" style="width:' + (t.planned / t.cp * 100) + '%"></i></span></button></li>';
    }).join('');
    if (ui.trackKey && !groups.some(function (t) { return t.key === ui.trackKey; })) ui.trackKey = '';
    setHTML(box, '<ul class="track">' + items + '</ul>');
    const inline = $('#dock-track');
    if (inline) { inline.hidden = groups.length < 2; inline.innerHTML = items; }
  }
  // Picks out the cards of one kind of requirement: the rest dim, and the page goes to the first one not yet completed.
  function applyTrack() {
    const ctx = lastCtx;
    const grid = $('#grid');
    const key = ui.trackKey || '';
    grid.classList.toggle('is-tracking', !!key);
    grid.querySelectorAll('.subj').forEach(function (el) {
      const s = ctx.byId[el.dataset.slot];
      el.classList.toggle('is-track', !!key && !!s && slotGroup(ctx, s) === key);
    });
    document.querySelectorAll('[data-action="track-filter"]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.k === key)); });
  }
  function setTrack(key) {
    ui.trackKey = ui.trackKey === key ? '' : key;
    applyTrack();
    if (!ui.trackKey) return;
    const ctx = lastCtx;
    const mine = sortSlots(ctx.slots.filter(function (s) { return slotGroup(ctx, s) === key; }));
    const label = (TRACK.filter(function (t) { return t[0] === key; })[0] || ['', 'These'])[1];
    if (!mine.length) { toast(label + ': nothing is in your plan yet. The Suggested Remaining Guide lists what to add.'); return; }
    const first = mine.find(function (s) { return !s.done; }) || mine[0];
    flashSlot(first.id);
    toast(label + ': ' + plural(mine.length, 'card') + ' picked out, ' + mine.filter(function (s) { return s.done; }).length + ' completed. Press it again, or Esc, to show everything.');
  }
  // The stage a student has reached, from the credit points completed
  function stageOf(ctx) {
    const done = ctx.doneCP;
    if (ctx.deg.cp && done >= ctx.deg.cp) return { n: 4, label: 'Graduand Ready ★', tip: 'Every credit point of the degree is completed' };
    if (done >= 200) return { n: 3, label: 'Stage 3 · Advanced & Electives', tip: '200 CP or more completed' };
    if (done >= 80) return { n: 2, label: 'Stage 2 · Core Practice', tip: '80 to 190 CP completed. Stage 3 starts at 200 CP' };
    return { n: 1, label: 'Stage 1 · Foundations', tip: 'Up to 70 CP completed. Stage 2 starts at 80 CP' };
  }
  function stagePill(ctx) {
    const st = stageOf(ctx);
    return '<button type="button" class="hero-pill hp-stage st-' + st.n + '" data-action="stage" title="' + esc(st.tip + '. Press to go to your next session.') + '">' + esc(st.label) + '</button>';
  }
  function syncStage(ctx) {
    const el = $('#hero-meta .hp-stage');
    if (!el) return;
    const st = stageOf(ctx);
    if (el.textContent === st.label) return;
    el.textContent = st.label;
    el.className = 'hero-pill hp-stage st-' + st.n + ' is-new';
    el.title = st.tip + '. Press to go to your next session.';
  }
  // ---- celebrations: a gold sweep when a session or a year is finished, and confetti when the degree is
  function sessionsDone(ctx) {
    const out = {};
    sessionsInOrder(ctx).forEach(function (x) { out[x.year + '|' + x.session] = x.slots.length > 0 && x.slots.every(function (s) { return s.done; }); });
    return out;
  }
  function celebrate(el) {
    if (!el || !motionOK()) return;
    el.classList.remove('is-celebrating');
    void el.offsetWidth;
    el.classList.add('is-celebrating');
    setTimeout(function () { el.classList.remove('is-celebrating'); }, 1700);
  }
  function confetti() {
    if (!motionOK() || $('#confetti')) return;
    const c = document.createElement('canvas');
    c.id = 'confetti';
    c.setAttribute('aria-hidden', 'true');
    document.body.appendChild(c);
    const g = c.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = c.width = window.innerWidth * dpr;
    const h = c.height = window.innerHeight * dpr;
    const colours = ['#C59B27', '#E3C774', '#8B0029', '#7D0028', '#FFFFFF'];
    const bits = [];
    for (let i = 0; i < 150; i++) {
      const side = i % 2 ? 1 : -1;
      bits.push({ x: w / 2 + side * w * 0.18 * Math.random(), y: h * 0.42, vx: side * (2 + Math.random() * 7) * dpr, vy: -(7 + Math.random() * 11) * dpr, r: (3 + Math.random() * 5) * dpr, a: Math.random() * 6.3, va: (Math.random() - 0.5) * 0.4, c: colours[i % colours.length] });
    }
    const start = performance.now();
    (function frame(now) {
      const t = (now - start) / 2600;
      g.clearRect(0, 0, w, h);
      bits.forEach(function (b) {
        b.vy += 0.32 * dpr; b.vx *= 0.992; b.x += b.vx; b.y += b.vy; b.a += b.va;
        g.save(); g.globalAlpha = Math.max(0, 1 - t * t); g.translate(b.x, b.y); g.rotate(b.a); g.fillStyle = b.c; g.fillRect(-b.r, -b.r * 0.45, b.r * 2, b.r * 0.9); g.restore();
      });
      if (t < 1) requestAnimationFrame(frame); else c.remove();
    })(start);
  }
  function renderDock(ctx) {
    const deg = ctx.deg;
    const single = DEGREES.filter(function (d) { return d.code === '2848'; });
    const dbl = DEGREES.filter(function (d) { return d.code !== '2848'; });
    function degOpt(d) { return '<option value="' + d.code + '"' + (!isCustom() && d.code === state.degree ? ' selected' : '') + '>' + esc(d.label) + '</option>'; }
    const own = state.custom ? 'Custom: ' + customName(state.custom, state.custom.tpl ? DEG[state.custom.tpl.split('|')[0]] : null) : 'Build my own degree…';
    const degSelect = '<div class="select-wrap"><select id="sel-degree" aria-label="Degree">' +
      '<optgroup label="Single degree">' + single.map(degOpt).join('') + '</optgroup>' +
      '<optgroup label="Double degrees">' + dbl.map(degOpt).join('') + '</optgroup>' +
      '<optgroup label="Your own"><option value="' + CUSTOM + '"' + (isCustom() ? ' selected' : '') + '>' + esc(own) + '</option></optgroup></select></div>';

    let majorField;
    if (isCustom()) {
      majorField = '<input class="input" id="custom-name" maxlength="120" autocomplete="off" placeholder="Type your degree, e.g. Bachelor of Laws (Graduate Entry)" value="' + esc(ctx.plan.name) + '">';
    } else if (deg.fixedStructure) {
      const built = builtInMajor(deg);
      majorField = '<div class="locked" id="major-locked"><span><b>One structure.</b> ' + (built ? 'Built-in: ' + esc(built) : 'No major or minor to choose') + '</span></div>';
    } else {
      const opts = deg.options.map(function (k) { return OPT[k]; });
      const letters = Array.from(new Set(opts.map(function (o) { return o.groupLetter; })));
      const optHtml = function (o) { return '<option value="' + esc(o.pathwayKey) + '"' + (o.pathwayKey === ctx.key ? ' selected' : '') + '>' + esc(o.majorLabel) + '</option>'; };
      const inner = letters.length > 1
        ? letters.map(function (L) { return '<optgroup label="Pathway ' + L + '">' + opts.filter(function (o) { return o.groupLetter === L; }).map(optHtml).join('') + '</optgroup>'; }).join('')
        : opts.map(optHtml).join('');
      majorField = '<div class="select-wrap"><select id="sel-major" aria-label="Major or minor">' + inner + '</select></div>';
    }
    const home = deg.campusList.map(function (n) { return Object.keys(META.campuses).find(function (c) { return META.campuses[c] === n; }); }).filter(Boolean);
    const others = PRIMARY_CAMPUSES.filter(function (c) { return home.indexOf(c) < 0; });
    const campOpt = function (c) { return '<option value="' + c + '"' + (state.campus === c ? ' selected' : '') + '>' + c + ' · ' + esc(META.campuses[c]) + '</option>'; };
    const campusSelect = '<div class="select-wrap"><select id="sel-campus" aria-label="Highlight a campus">' +
      '<option value="">All campuses</option>' +
      (home.length ? '<optgroup label="This degree\'s campuses">' + home.map(campOpt).join('') + '</optgroup>' : '') +
      '<optgroup label="' + (home.length ? 'Other campuses' : 'Campuses') + '">' + others.map(campOpt).join('') + '</optgroup></select></div>';
    const load = '<div class="segmented" role="group" aria-label="Enrolment load">' +
      '<button type="button" data-action="load" data-load="FT" aria-pressed="' + (paceNow(ctx) === 40) + '" title="40 CP per session">Full-time</button>' +
      '<button type="button" data-action="load" data-load="PT" aria-pressed="' + (paceNow(ctx) === 20) + '" title="20 CP per session (indicative)">Part-time</button>' +
      (paceNow(ctx) === 30 ? '<button type="button" data-action="repace-open" aria-pressed="true" title="30 CP per session, set in Re-Pace">30 CP</button>' : '') + '</div>';

    const total = deg.cp;
    const done = ctx.doneCP;
    const pct = total ? Math.min(100, Math.round(done / total * 100)) : 0;
    const progress = '<div class="progress"><div class="progress-top"><span class="field-label">Progress</span>' +
      '<span class="progress-num" id="progress-num"><span class="num">' + done + '</span> / ' + total + ' <small>CP</small></span></div>' +
      '<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="' + total + '" aria-valuenow="' + done + '" aria-label="Credit points completed"><span style="width:' + pct + '%"></span></div>' +
      '<div class="progress-meta" id="progress-meta">' + progressMeta(ctx) + '</div></div>';

    // the Handbook structure the plan is shown in: a student who started before 2027 follows the pre-2027 one
    const cohort = ctxCohort(ctx);
    const handbook = '<div class="select-wrap"><select id="sel-cohort" aria-label="Handbook" title="' + esc(COHORT_LABEL[cohort]) + '">' +
      '<option value="2027"' + (cohort === '2027' ? ' selected' : '') + ' title="' + esc(COHORT_LABEL['2027']) + '">2027 Handbook</option>' +
      '<option value="pre2027"' + (cohort === 'pre2027' ? ' selected' : '') + ' title="Started in 2026 or earlier. ' + esc(COHORT_LABEL.pre2027) + '">Pre-2027 Handbook</option></select></div>';
    $('#dock').innerHTML =
      '<div class="field"><label for="sel-degree">Degree</label>' + degSelect + '</div>' +
      '<div class="field">' + (isCustom() ? '<label for="custom-name">Degree name</label>' : deg.fixedStructure ? '<span class="field-label">Major / minor</span>' : '<label for="sel-major">Major / minor</label>') + majorField + '</div>' +
      '<div class="field"><label for="sel-campus">Campus highlight</label>' + campusSelect + '</div>' +
      '<div class="field field-cohort"><label for="sel-cohort">Handbook</label>' + handbook + '</div>' +
      '<div class="field"><span class="field-label">Load</span>' + load + '</div>' + progress + '<ul class="track track-inline" id="dock-track" aria-label="Degree requirements at a glance"></ul>';
  }

  // How much of the degree is settled: credit points completed, or planned with a subject chosen, in a session it runs
  // in and within the session's load. What is still open, unplaced or flagged is the rest.
  function planReadiness(ctx) {
    const r = ctx.risks;
    const flagged = {};
    r.notOffered.forEach(function (s) { flagged[s.id] = 1; });
    r.dupes.forEach(function (d) { d.slots.slice(1).forEach(function (s) { flagged[s.id] = 1; }); });
    r.overload.forEach(function (l) {
      let room = l.cap;
      sortSlots(ctx.slots.filter(function (s) { return s.year === l.year && s.session === l.session; })).forEach(function (s) { if (room >= s.cp) room -= s.cp; else flagged[s.id] = 1; });
    });
    const settled = ctx.slots.reduce(function (a, s) { return a + (s.done || (!s.pending && !flagged[s.id]) ? s.cp : 0); }, 0);
    const total = Math.max(ctx.deg.cp, 1);
    return { settled: Math.min(settled, total), total: total, pct: Math.min(100, Math.round(settled / total * 100)) };
  }
  // The problems one press can fix: a subject in a session it does not run in, and a session over its load. Each move
  // goes to the nearest session not yet begun that the subject runs in and that has room for it.
  function fixable(ctx) {
    if (state.load === 'PT') return [];
    const begun = ctx.custom && ctx.plan.start ? firstOpenIdx(ctx.plan.start) : 0;
    const out = ctx.risks.notOffered.filter(function (s) { return orderIdx(s.year, s.session) >= begun; }).map(function (s) { return { s: s, why: 'not offered in ' + s.session }; });
    ctx.risks.overload.forEach(function (l) {
      if (orderIdx(l.year, l.session) < begun) return;
      let over = l.cp - l.cap;
      sortSlots(ctx.slots.filter(function (s) { return s.year === l.year && s.session === l.session && !s.done; })).reverse().forEach(function (s) {
        if (over <= 0 || out.some(function (x) { return x.s === s; })) return;
        over -= s.cp;
        out.push({ s: s, why: 'session over its load' });
      });
    });
    return out;
  }
  function fixPlan() {
    const list = fixable(lastCtx);
    if (!list.length) return;
    const key = function (s) { return (s.pending ? '' : s.code) + '|' + s.year + s.session + '|' + s.raw.slot; };
    const wanted = list.map(function (x) { return { key: key(x.s), id: x.s.id }; });
    // a WSLSA pathway becomes its edited copy, which numbers its cards afresh
    const firstId = ensureEditable(wanted[0].id);
    const ctx = lastCtx;
    const plan = editPlan();
    const begun = plan.start ? firstOpenIdx(plan.start) : 0;
    const load = {};
    ctx.slots.forEach(function (s) { const k = orderIdx(s.year, s.session); load[k] = (load[k] || 0) + s.cp; });
    const lastK = Math.min(MAX_YEARS * 3 - 1, Math.max.apply(null, ctx.slots.map(function (s) { return orderIdx(s.year, s.session); }).concat([begun])) + 3);
    const moved = [];
    const stuck = [];
    const targets = firstId !== wanted[0].id ? list.map(function (x, i) { return i === 0 ? ctx.byId[firstId] : ctx.slots.find(function (s) { return key(s) === wanted[i].key; }); }) : list.map(function (x) { return x.s; });
    targets.filter(Boolean).forEach(function (s) {
      const x = plan.slots[s.idx];
      const cur = orderIdx(x.y, x.s);
      let best = -1;
      for (let k = begun; k <= lastK; k++) {
        const sess = PLAN_SESSIONS[k % 3];
        if (k === cur || sess === 'Summer' || (load[k] || 0) + x.cp > sessionCap(plan, k)) continue;
        const off = s.pending || !s.code ? null : offerFor(ctx.deg, s.code, sess);
        if (off && off.none) continue;
        if (best < 0 || Math.abs(k - cur) < Math.abs(best - cur)) best = k;
      }
      if (best < 0) { stuck.push(s.pending ? 'an open slot' : s.code); return; }
      load[cur] -= x.cp;
      load[best] = (load[best] || 0) + x.cp;
      x.y = Math.floor(best / 3) + 1;
      x.s = PLAN_SESSIONS[best % 3];
      yearCode(plan, x);
      if (x.y > plan.years) plan.years = x.y;
      moved.push((s.pending ? 'an open slot' : s.code) + ' to ' + sessionLabel(x.y, x.s));
    });
    if (!moved.length) { toast('No session has room for ' + stuck.join(', ') + '. Add a year, or raise a session\'s load, and try again.'); return; }
    noteChange('fixed ' + plural(moved.length, 'issue') + ' in your plan');
    ui.folded = null;
    renderMoving();
    toast('Moved ' + moved.slice(0, 4).join(', ') + (moved.length > 4 ? ' and ' + (moved.length - 4) + ' more' : '') + '.' + (stuck.length ? ' No room was found for ' + stuck.join(', ') + '.' : '') + ' Check prerequisites still fall in order.', { action: 'undo', label: 'Undo' });
  }
  function renderAdvisory(ctx) {
    const r = ctx.risks;
    const sev = r.advisor.length || r.dupes.length || (ctx.custom && r.notOffered.length) ? 'adv-crit'
      : (r.tbc.length || r.campus.length || r.notOffered.length || r.overload.length || r.cpShort || r.cpOver || r.summer.length || r.pending.length) ? 'adv-warn' : 'adv-ok';
    const parts = [];
    if (ctx.custom) parts.push('<b>' + ctx.placedCP + ' / ' + ctx.plan.cp + '</b> CP placed');
    if (r.advisor.length) parts.push('<b>' + plural(r.advisor.length, 'prerequisite note') + '</b>');
    if (r.dupes.length) parts.push('<b>' + r.dupes.length + '</b> listed twice');
    if (ctx.custom && r.notOffered.length) parts.push('<b>' + r.notOffered.length + '</b> not offered in the planned session');
    if (r.overload.length) parts.push('<b>' + r.overload.length + '</b> ' + (r.overload.length === 1 ? 'session' : 'sessions') + ' over its load');
    if (r.tbc.length) parts.push('<b>' + r.tbc.length + '</b> ' + (r.tbc.length === 1 ? 'subject has' : 'subjects have') + ' 2027 sessions TBC');
    if (r.pending.length) parts.push('<b>' + r.pending.length + '</b> ' + (ctx.custom ? (r.pending.length === 1 ? 'open slot' : 'open slots') : (r.pending.length === 1 ? 'choice' : 'choices') + ' still open'));
    if (state.campus && r.campus.length) parts.push('<b>' + r.campus.length + '</b> not at ' + esc(META.campuses[state.campus]) + ' or online');
    if (r.summer.length) parts.push('<b>' + r.summer.length + '</b> in Summer to check');
    if (r.y2026.length) parts.push(r.y2026.length + ' using 2026 session data');
    if (!parts.length) parts.push('Nothing flagged for this selection');

    const ready = planReadiness(ctx);
    const fixes = fixable(ctx);
    const secs = [];
    let secNo = 0;
    const idx = function () { return String(++secNo).padStart(2, '0') + '→'; };
    const jump = function (s, label) { return '<button type="button" class="linkish" data-action="jump" data-slot="' + s.id + '">' + esc(label || s.code) + '</button>'; };
    if (ctx.custom) {
      const cpl = [];
      cpl.push('<p><b>Placed ' + ctx.placedCP + ' of ' + ctx.plan.cp + ' CP.</b> ' + (r.pending.length ? plural(r.pending.length, 'open slot') + ' still to fill: ' + r.pending.map(function (s) { return jump(s, where(s)); }).join(', ') + '.' : 'Every slot has a subject.') + '</p>');
      if (r.cpShort) cpl.push('<p><b>' + r.cpShort + ' CP short:</b> your slots add up to ' + ctx.totalCP + ' CP. Add slots or a year to reach ' + ctx.plan.cp + ' CP.</p>');
      if (r.cpOver) cpl.push('<p><b>' + r.cpOver + ' CP over:</b> the subjects placed total ' + ctx.placedCP + ' CP, more than the ' + ctx.plan.cp + ' CP the degree requires.</p>');
      if (r.overload.length) cpl.push('<p><b>Over the load set for the session:</b> ' + r.overload.map(function (l) { return 'Year ' + l.year + ' ' + l.session + ' (' + l.cp + ' of ' + l.cap + ' CP)'; }).join('; ') + '. More than 40 CP in a session needs approval from the university.</p>');
      if (r.dupes.length) cpl.push('<p><b>Listed more than once:</b> ' + r.dupes.map(function (d) { return esc(d.code) + ' (' + d.slots.map(function (s) { return jump(s, where(s)); }).join(', ') + ')'; }).join('; ') + '. A subject counts towards your degree only once.</p>');
      if (r.notOffered.length) cpl.push('<p><b>Not offered in the planned session:</b> ' + r.notOffered.map(function (s) { return jump(s) + ' (' + where(s) + ')'; }).join('; ') + '. Move it to a session it runs in, or choose another subject.</p>');
      if (r.replaced.length) cpl.push('<p><b>Changed from the template:</b> ' + r.replaced.map(function (s) { return esc(s.replaced.code) + ' → ' + (s.pending ? 'open slot' : jump(s)) + ' (' + where(s) + ')'; }).join('; ') + '. Check the degree\'s rules still allow it.</p>');
      secs.push('<section class="adv-sec" id="risk-cp"><h3><span class="idx">' + idx() + '</span>Credit points &amp; load</h3>' + cpl.join('') + '</section>');
    }
    secs.push('<section class="adv-sec" id="risk-advisor"><h3><span class="idx">' + idx() + '</span>Prerequisite notes</h3>' + (r.advisor.length ? '<ul>' + r.advisor.map(function (a) {
      const kind = (a.note.majorKind || '').replace('Testamur ', '').toLowerCase();
      const scope = a.applies
        ? '<span class="note-scope">' + (a.note.major ? 'Applies to your ' + esc(kind) : 'Applies to this degree') + '</span>'
        : a.note.deg
          ? '<span class="note-scope related">From the ' + esc(a.note.deg) + ' guide' + (a.note.major ? ' (' + esc(a.note.major) + ' ' + esc(kind) + ')' : '') + '</span>'
          : '<span class="note-scope related">Flagged for the ' + esc(a.note.major) + ' ' + esc(kind) + '; ' + esc(a.note.subject) + ' is also in your pathway</span>';
      return '<li>' + scope + (a.flagSlot ? '<button type="button" class="where" data-action="jump" data-slot="' + a.flagSlot.id + '">' + where(a.flagSlot) + '</button>' : '<span class="where">Not in your plan</span>') +
        esc(a.note.text) + (a.hint ? '<span class="hint">' + (a.resolvedByChoice ? '<b>Your choice helps:</b> ' : '<b>From your plan:</b> ') + esc(a.hint) + '</span>' : '') + '</li>';
    }).join('') + '</ul>' : '<p>The workbook flags no prerequisite gaps for this selection.</p>') + '</section>');
    if (r.tbc.length) {
      secs.push('<section class="adv-sec" id="risk-tbc"><h3><span class="idx">' + idx() + '</span>2027 sessions TBC</h3>' +
        '<p>WSLSA placed these subjects in the session shown, but WSU has not published their 2027 offering yet. Check the <a href="' + esc(ctx.deg.handbook) + '" target="_blank" rel="noopener">2027 Handbook →</a> closer to enrolment.</p>' +
        '<div class="chiplist">' + r.tbc.map(function (s) {
          return '<button type="button" class="chipbtn" data-action="jump" data-slot="' + s.id + '"><code>' + esc(s.code) + '</code>' + esc(s.title) + ' <span>' + where(s) + (s.chosen ? ' · your choice' : '') + '</span></button>';
        }).join('') + '</div></section>');
    }
    const checks = [];
    if (r.summer.length) checks.push('<p><b>Summer subjects:</b> ' + r.summer.map(function (s) { return jump(s) + ' (' + where(s) + ')'; }).join(', ') + '. The 2027 guides list Autumn and Spring sessions only, so confirm in the Handbook that each subject runs in Summer and where. For help planning Summer study, contact the Law Enquiry Team at <a href="mailto:' + LAW_ENQUIRY + '">' + LAW_ENQUIRY + '</a>.</p>');
    if (state.campus && r.campus.length) checks.push('<p><b>Not at ' + esc(META.campuses[state.campus]) + ' or online:</b> ' + r.campus.map(function (s) { return '<button type="button" class="linkish" data-action="jump" data-slot="' + s.id + '">' + esc(s.code) + '</button> (' + s.offer.codes.join(' ') + ', ' + where(s) + ')'; }).join('; ') + '.</p>');
    if (state.campus && r.onlineOnly.length) checks.push('<p><b>Online only for you:</b> ' + r.onlineOnly.map(function (s) { return esc(s.code); }).join(', ') + '.</p>');
    if (r.y2026.length) checks.push('<p><b>2026 session data shown:</b> ' + r.y2026.map(function (s) { return esc(s.code) + ' ' + esc(s.title) + ' (' + where(s) + ')'; }).join('; ') + '.</p>');
    if (r.notOffered.length && !ctx.custom) checks.push('<p><b>Not offered in the planned session:</b> ' + r.notOffered.map(function (s) { return esc(s.code) + ' (' + where(s) + ')'; }).join('; ') + '.</p>');
    if (r.unlisted.length) checks.push('<p><b>Check sessions in the Handbook:</b> ' + r.unlisted.map(function (s) { return '<button type="button" class="linkish" data-action="jump" data-slot="' + s.id + '">' + esc(s.code) + '</button> (' + where(s) + ')'; }).join(', ') + '. ' + (ctx.custom ? 'These come from the WSU subject list or were typed in by hand, so there is no session or campus data: confirm they run in the session shown.' : 'The WSU subject list has no session or campus data, so confirm these electives run in the session shown.') + '</p>');
    if (r.pending.length && !ctx.custom) checks.push('<p><b>Still to choose:</b> ' + r.pending.map(function (s) { return '<button type="button" class="linkish" data-action="jump" data-slot="' + s.id + '">' + where(s) + '</button>'; }).join(', ') + '.</p>');
    if (checks.length) secs.push('<section class="adv-sec"><h3><span class="idx">' + idx() + '</span>' + (ctx.custom ? 'Campus &amp; session checks' : 'Campus &amp; choice checks') + '</h3>' + checks.join('') + '</section>');

    setHTML($('#advisory'), '<h2 class="sr-only">Pathway advisory</h2><details class="advisory ' + sev + '" id="advisory-box"' + (ui.advisoryOpen ? ' open' : '') + '>' +
      '<summary>' + (sev === 'adv-ok' ? OK_ICON : ALERT_ICON) + '<span class="adv-label">Pathway Advisory</span><span class="adv-counts">' + parts.join(' · ') + '</span>' +
      '<span class="adv-ready" style="--p:' + ready.pct + '" title="' + ready.settled + ' of ' + ready.total + ' CP is completed, or planned with a subject chosen in a session it runs in"><i aria-hidden="true"></i><b>' + ready.pct + '%</b> ready</span>' +
      '<span class="adv-cta">View details</span></summary>' +
      '<div class="adv-body">' + (fixes.length ? '<div class="adv-fix"><div><b>' + plural(fixes.length, 'subject') + ' can be moved for you.</b> ' + fixes.slice(0, 6).map(function (x) { return esc(x.s.pending ? 'An open slot' : x.s.code) + ' (' + esc(x.why) + ')'; }).join(', ') + (fixes.length > 6 ? ' and more' : '') + '. Each goes to the nearest session it runs in that has room.</div>' +
        '<button type="button" class="tbtn tbtn-primary" data-action="plan-fix">Fix ' + (fixes.length === 1 ? 'it' : 'these') + ' for me</button></div>' : '') + secs.join('') + '</div></details>');
  }

  // The next session with subjects still to do, with its codes ready to copy for enrolment.
  function renderNext(ctx) {
    const next = nextSession(ctx);
    const side = function (codes) {
      const lines = next ? next.slots.filter(function (s) { return !s.done && !s.pending; }).map(function (s) { return s.code + ' ' + s.title; }).join('\n') : '';
      const main = (codes.length ? '<button type="button" class="tbtn tbtn-primary" data-action="copy-codes" data-codes="' + esc(codes.join(', ')) + '" data-copy="' + esc(lines) + '" title="Copy the codes and titles, ready for WSU MySR or Allocate+">Copy Codes</button>' : '') +
        (next ? '<button type="button" class="tbtn tbtn-outline" data-action="ics" title="Save a calendar reminder for this session with your planned subjects and campuses">Export .ics</button>' : '');
      return '<div class="next-side">' + (main ? '<div class="next-actions">' + main + '</div>' : '') +
        '<div class="next-alt"><span class="next-alt-l">Already studying?</span>' +
        '<button type="button" class="tbtn tbtn-outline" data-action="progress-open" title="Rebuild your plan from your Degree Works audit or Subject Results PDF, with your past years in it">Import my progress</button>' +
        '<button type="button" class="text-btn" data-action="import-open" title="Paste your academic record or results to tick off the subjects you have passed">Tick off from my results</button></div></div>';
    };
    if (!next) {
      const g = ctx.custom ? ctx.guide : null;
      const at = g ? { y: Math.floor(g.firstK / 3) + 1, s: PLAN_SESSIONS[g.firstK % 3] } : null;
      setHTML($('#next'), '<div class="next-card"><div class="next-head"><p class="kicker">Next to enrol</p><h2>' +
        (at ? sessionLabel(at.y, at.s) + ' <small>Year ' + at.y + ' · nothing planned yet</small>' : ctx.slots.length ? (ctx.deg.cp && ctx.doneCP >= ctx.deg.cp ? '<span class="next-grad">🎓 Degree Complete · All ' + ctx.deg.cp + ' CP Mapped &amp; Completed!</span>' : 'Every subject in your plan is ticked off') : 'Your plan has no subjects yet') + '</h2>' +
        (at ? '<p class="next-sub">Add subjects from the <button type="button" class="linkish" data-action="guide-open">Suggested Remaining Guide</button>, or drag them onto a session.</p>' : '') + '</div>' + side([]) + '</div>');
      return;
    }
    const todo = next.slots.filter(function (s) { return !s.done; });
    const codes = todo.filter(function (s) { return !s.pending; }).map(function (s) { return s.code; });
    const choices = todo.filter(function (s) { return s.pending; }).length;
    const started = ctx.slots.some(function (s) { return s.done; });
    // when these cards are the first thing below, they do not need listing here as well
    const years = timeline(ctx, state.load);
    const folded = foldedYears(ctx, years);
    const listed = years.some(function (y) { return y.year < next.year && !folded[y.year]; });
    setHTML($('#next'), '<div class="next-card"><div class="next-head">' +
      '<p class="kicker">' + (started ? 'Next to enrol' : 'Your first session') + '</p>' +
      '<h2>' + sessionLabel(next.year, next.session) + ' <small>Year ' + next.year + (state.load === 'PT' ? ' · part-time' : '') + '</small>' + (choices ? ' <small class="next-note">· ' + plural(choices, 'choice') + '</small>' : '') + '</h2></div>' +
      side(codes) +
      (!listed ? '' : '<div class="chiplist next-chips">' + todo.map(function (s) {
        return '<button type="button" class="chipbtn' + (s.pending ? ' is-open' : '') + '" data-action="jump" data-slot="' + s.id + '" title="' + esc((s.pending ? '' : s.code + ' ') + s.title) + ', ' + s.cp + ' CP" aria-label="' + esc((s.pending ? 'Choose: ' : s.code + ' ') + s.title) + ', ' + s.cp + ' CP"><code>' + esc(s.pending ? 'Choose' : s.code) + '</code><span class="cb-t">' + esc(s.title) + '</span></button>';
      }).join('') + '</div>') + '</div>');
  }

  function renderLegend(ctx) {
    const types = [['law', 'Law core', '--crimson'], ['nonlaw', 'Non-law core', '--slate'], ['major', 'Major / minor', '--teal']];
    const swatches = function (slotLabel) {
      return types.map(function (t) {
        return '<span class="lg-sw"><i style="--k:var(' + t[2] + ')"></i>' + t[1] + '</span>';
      }).join('') + '<span class="lg-sw slot"><i></i>' + slotLabel + '</span>';
    };
    setHTML($('#legend'), '<details class="legend-box" id="legend-box"' + (ui.legendOpen ? ' open' : '') + '><summary>' +
      '<span class="lg-group lg-inline" aria-hidden="true">' + swatches(ctx.custom ? 'Open or changed' : 'Your choice') + '</span>' +
      '<span class="lg-cta">Key<span class="wide-only"> and campus codes</span></span></summary><div class="lg-body">' +
      '<div class="lg-group"><span class="lg-title">Unit type</span>' + swatches(ctx.custom ? 'Open slot, your choice or a change' : 'Your choice (LLB Alternate, choice, elective)') + '</div>' +
      '<div class="lg-group"><span class="lg-title">Campus</span>' + Object.keys(META.campuses).map(function (c) {
        return '<span class="lg-camp">' + pill(c, { focus: true }) + esc(META.campuses[c].replace(' (Kingswood)', '')) + '</span>';
      }).join('') + '<span class="lg-camp">' + pill('TBC', { focus: true }) + 'Not yet published</span>' +
      (state.campus ? '<button type="button" class="linkish small" data-action="campus-clear">Clear highlight</button>' : '') + '</div>' +
      '<p class="lg-tip"><span class="lg-title">Chain</span> Hover a subject, or press its Chain button, to see what it depends on and unlocks.</p>' +
      '<p class="lg-tip kbd-only"><span class="lg-title">Keys</span> <kbd>/</kbd> or <kbd>' + MOD_KEY + '+K</kbd> filter your plan · <kbd>' + UNDO_KEYS + '</kbd> undo · <kbd>' + REDO_KEYS + '</kbd> redo · <kbd>Esc</kbd> clear the filter or close a window</p>' +
      '</div></details>');
  }

  function selectLabel(s) {
    if (s.kind === 'llb') return 'Select LLB Alternate';
    if (s.kind === 'elective') return 'Select Elective';
    return 'Select Subject';
  }
  // The pools a subject can count towards in a plan, when its degree lists it in more than one (LAWS 3067 in 2785 is both
  // an Alternate Accounting subject and an LLB Alternate): the pathway rows of each kind of choice that lists it.
  function poolName(row) { return row.kind === 'llb' ? 'LLB Alternate' : cleanPoolTitle(row.title).replace(/ Subjects?$/i, '').replace(/^Alternate (.+)$/, '$1 Alternate'); }
  function poolsFor(ctx, s) {
    const tpl = ctx.custom ? ctx.plan.tpl : ctx.key;
    if (!tpl || s.pending || !s.code) return [];
    const deg = DEG[tpl.split('|')[0]];
    const comps = deg.catalogue.filter(function (c) { return c.code === s.code; }).map(function (c) { return c.component; });
    if (comps.length < 2) return [];
    const out = [];
    PATH[tpl].forEach(function (r) {
      const list = r.kind === 'llb' ? [deg.llbComponent] : r.kind === 'pool' ? r.pool || [] : [];
      if (!list.some(function (c) { return comps.indexOf(c) >= 0; })) return;
      const name = poolName(r);
      if (!out.some(function (p) { return p.name === name; })) out.push({ name: name, row: r });
    });
    return out.length > 1 ? out : [];
  }
  // counts a subject towards the next pool that lists it, trading places with an open slot of that pool when there is one
  function switchPool(slotId) {
    const sid = ensureEditable(slotId);
    const ctx = lastCtx;
    const s = ctx.byId[sid];
    const pools = s ? poolsFor(ctx, s) : [];
    if (!pools.length) return;
    const row = s.newCore ? null : s.orig;
    const at = pools.findIndex(function (p) { return row && poolName(row) === p.name; });
    const to = pools[(at + 1) % pools.length];
    const plan = editPlan();
    const x = plan.slots[s.idx];
    noteChange('counted ' + s.code + ' as ' + to.name);
    const other = ctx.slots.find(function (o) { return o.pending && o.orig && !o.newCore && poolName(o.orig) === to.name; });
    if (other) plan.slots[other.idx].o = x.o;
    else {
      // an imported plan lists what is still needed apart from its history, so the list trades one for the other
      const rows = {};
      PATH[plan.tpl].forEach(function (r) { rows[r.id] = r; });
      const n = plan.need.find(function (q) { return !q.code && rows[q.o] && (rows[q.o].kind === 'llb' || rows[q.o].kind === 'pool') && poolName(rows[q.o]) === to.name; });
      if (n && rows[x.o]) { n.o = x.o; n.cp = rows[x.o].cp; }
    }
    x.o = to.row.id;
    renderMoving(function () { flashSlot(sid, true); });
    toast(s.code + ' now counts as ' + to.name + (other ? ', and the open slot it took the place of is ' + (at >= 0 ? pools[at].name : 'an open') + ' instead' : '') + '.', { action: 'undo', label: 'Undo' });
  }
  // the flags under a subject's title, its offering column and its tools change when it is ticked, so ticking updates just these
  function slotFlags(s, ctx) {
    const offCampus = state.campus && ctx.risks.campus.indexOf(s) >= 0;
    const flags = [];
    const flag = function (cls, text, tip) { return '<span class="flag ' + cls + '"' + (tip ? ' title="' + esc(tip) + '"' : '') + '>' + text + '</span>'; };
    if (s.done) flags.push(flag('flag-done', '✓ Completed'));
    const begun = ctx.custom && ctx.plan.start ? firstOpenIdx(ctx.plan.start) : 0;
    const ahead = orderIdx(s.year, s.session) >= begun;
    const live = s.offer && !s.done && ahead;
    if (live && s.offer.tbc) flags.push(flag('flag-tbc', 'Session TBC', '2027 session not yet published'));
    if (live && s.offer.y2026 && !s.offer.tbc) flags.push(flag('flag-2026', '2026 data', '2027 session not yet published; 2026 session shown'));
    if (s.chosen && !s.replaced) flags.push(flag('flag-chosen', 'Your choice'));
    if (s.replaced && !s.pending) flags.push(flag('flag-chosen', 'Replaces ' + esc(s.replaced.code), 'Template subject: ' + s.replaced.code + ' ' + s.replaced.title));
    const twins = ctx.custom && !s.pending ? sameAs(s.code).filter(function (c) { return c !== s.code && ctx.used[c]; }) : [];
    if (ctx.custom && !s.pending && ((ctx.used[s.code] || []).length > 1 || twins.length)) flags.push(flag('flag-warn', 'Listed twice', twins.length ? twins[0] + ' is also in your plan, and the two count as one subject' : ''));
    if (s.custom) flags.push(flag('flag-chosen', 'Custom'));
    const pre = ctxCohort(ctx) === 'pre2027';
    // the pre-2027 structure, in a few words on the card and in full when the pointer rests on them
    if (s.newCore) flags.push(flag('flag-legacy', 'In place of ' + esc(s.newCore.code), 'Pre-2027 structure: an LLB Alternate in place of ' + s.newCore.code + ' ' + s.newCore.title + ', a core subject only from 2027'));
    if (!s.done && !s.pending && s.legacy) flags.push(flag('flag-legacy', 'Pre-2027 subject', 'A pre-2027 subject' + (PHASE_YEAR[s.code] ? ', last offered ' + PHASE_YEAR[s.code] : '') + (LEGACY_EQUIVALENTS[s.code] ? '. From 2027 enrol in ' + LEGACY_EQUIVALENTS[s.code] + ' instead' : '')));
    if (s.done && !s.pending && LEGACY_EQUIVALENTS[s.code] && (s.twin || pre)) flags.push(flag('flag-done', 'Counts for ' + esc(LEGACY_EQUIVALENTS[s.code]), 'The two count as one subject, so ' + LEGACY_EQUIVALENTS[s.code] + ' is not needed as well'));
    if (pre && !s.done && !s.pending && LEGACY_OF[s.code]) flags.push(flag('flag-legacy', 'Replaces Pre-2027 ' + LEGACY_OF[s.code], 'The subject to enrol in from 2027, in place of ' + LEGACY_OF[s.code] + ' ' + LEGACY[LEGACY_OF[s.code]] + (PHASE_YEAR[LEGACY_OF[s.code]] ? ', last offered ' + PHASE_YEAR[LEGACY_OF[s.code]] : '')));
    if (s.listSubject) flags.push(flag('flag-2026', 'WSU subject list', 'Added from the WSU subject list'));
    if (offCampus) flags.push(flag('flag-campus', 'Not at ' + state.campus));
    if (ctx.risks.advisor.some(function (a) { return a.flagSlot === s; })) flags.push('<button type="button" class="flag flag-warn" data-action="open-advisory">Check prerequisite</button>');
    if (live && s.offer.none && !s.pending) flags.push(flag('flag-warn', 'Not offered this session'));
    if (s.auto) flags.push(flag('flag-2026', 'Only option', 'Only option listed for this ' + s.session + ' slot'));
    // a subject its degree lists in two pools can count towards either
    const pools = state.load !== 'PT' ? poolsFor(ctx, s) : [];
    if (pools.length && (ctx.custom ? s.orig && !s.newCore && (s.orig.kind === 'llb' || s.orig.kind === 'pool') : s.kind === 'llb' || s.kind === 'pool')) {
      const row = ctx.custom ? (s.newCore ? null : s.orig) : s.raw;
      const now = pools.find(function (p) { return row && row.kind && poolName(row) === p.name; });
      flags.push('<button type="button" class="flag flag-pool" data-action="pool-switch" data-slot="' + s.id + '" title="This subject is in more than one list for your degree. Press to count it towards the other.">Pool: ' +
        pools.slice().sort(function (a, b) { return (a === now ? 0 : 1) - (b === now ? 0 : 1); }).map(function (p) { return p === now ? '<b>' + esc(p.name) + '</b>' : esc(p.name); }).join(' ⇄ ') + '</button>');
    }
    return flags.join('');
  }
  function slotOffer(s, ctx) {
    if (s.pending || s.done) return '';
    // a session that has begun shows no 2027 offering: what ran then is not what the 2027 guides list
    if (ctx && ctx.custom && ctx.plan.start && orderIdx(s.year, s.session) < firstOpenIdx(ctx.plan.start)) return '';
    if (s.session === 'Summer') return '<span class="muted small" title="The 2027 guides list Autumn and Spring sessions only">Check Handbook</span>';
    if (s.legacy) return '<span class="muted small" title="A pre-2027 subject: the 2027 guides do not list its sessions">Check Handbook</span>';
    if (s.listSubject) return '<span class="muted small" title="The WSU subject list has no session or campus data">Check Handbook</span>';
    return pillsFor(s.offer);
  }
  // A card's tools, in one row that is always there: Change, Move to, Chain, Defer and Remove. A WSLSA pathway becomes
  // its edited copy at the first change. The part-time view lays the plan out again, so it only changes choices.
  function slotTools(s, ctx) {
    const pt = state.load === 'PT';
    const at = ' data-slot="' + s.id + '"';
    const name = s.pending ? 'the ' + where(s) + ' slot' : s.code;
    const tool = function (action, label, tip, cls, extra) { return '<button type="button" class="tool-btn' + (cls ? ' ' + cls : '') + '" data-action="' + action + '"' + at + ' title="' + esc(tip) + '"' + (extra || '') + '>' + label + '</button>'; };
    const out = [];
    const picked = !s.pending;
    const choice = s.kind === 'llb' || s.kind === 'pool' || s.kind === 'elective';
    if ((choice || s.kind === 'cslot') && picked) out.push(tool('picker-open', 'Change', 'Change or replace ' + name + ' with another subject'));
    else if (s.kind === 'option') out.push(tool('picker-open', 'Swap', 'Swap ' + name + ' for another option of your major'));
    else if (s.kind === 'fixed' && !pt) out.push(tool('change-open', 'Change', 'Change or replace ' + name + ' with another subject'));
    if ((choice || s.kind === 'cslot') && picked) out.push(tool('clear', 'Clear', 'Take ' + name + ' out and leave the slot open'));
    else if (s.kind === 'option' && s.pick) out.push(tool('clear', 'Reset', 'Back to the WSLSA pick for this slot'));
    else if (s.kind === 'inline' && s.chosen && s.raw.options.length > 1) out.push(tool('clear', 'Clear', 'Clear your choice for this slot'));
    if (!pt) out.push(moveSelect(s));
    if (!pt) out.push(typeSelect(s, ctx));
    if (picked && s.code && hasChain(s.code, ctx)) out.push(tool('xray', 'Chain', 'Show what this subject depends on and unlocks', 'chain-btn', ' aria-pressed="' + (ui.xrayPin === s.id) + '"'));
    if (picked && !s.done && s.code && !pt) out.push(tool('defer', 'Defer ↷', 'Move to the next session it runs in, and move any subject that needs it' + (ctx.custom ? '' : ', in your edited copy of this pathway'), 'defer-btn', ' aria-label="Defer ' + esc(s.code) + ' to its next offered session"'));
    if (!pt) out.push(tool('cremove', '<span class="tl">Remove </span>×', 'Remove ' + name + ' from your plan', 'rm-btn', ' aria-label="Remove ' + esc(name) + ' from your plan"'));
    return out.join('');
  }
  function slotHTML(s, ctx) {
    const kc = kindClass(s);
    const cls = ['subj', kc];
    if (kc === 'k-slot') cls.push(s.pending ? 'is-pending' : 'is-chosen');
    if (s.done) cls.push('is-done');
    // a card's tools stay folded away until its ••• button is pressed, one card at a time
    if (ui.openCard === s.id) cls.push('is-open');
    const offCampus = state.campus && ctx.risks.campus.indexOf(s) >= 0;
    if (offCampus) cls.push('offcampus');
    let body = '';
    if (s.kind === 'inline' && s.raw.options.length > 1) {
      body += '<div class="inline-opts" role="group" aria-label="Choose one">' + s.raw.options.map(function (o) {
        const sel = s.code === o.code && !s.pending;
        const clash = !sel && usedElsewhere(ctx, o.code, s.id);
        const off = offerFor(ctx.deg, o.code, s.session);
        const tip = clash ? 'Already in your plan' : (off && off.codes.length ? 'Offered ' + s.session + ': ' + off.codes.join(' ') : (o.tbcFlag || (off && off.tbc) ? 'Session TBC' : ''));
        return '<button type="button" class="inline-opt" data-action="inline" data-slot="' + s.id + '" data-code="' + esc(o.code) + '" aria-pressed="' + sel + '"' + (clash ? ' disabled' : '') + ' title="' + esc(tip) + '">' +
          '<span class="io-code">' + esc(o.code) + (o.tbcFlag ? ' · TBC' : '') + '</span><span class="io-title">' + esc(o.title) + '</span></button>';
      }).join('') + '</div>';
    }
    // an open slot's one call to action; what the slot takes is in its title, and in full when the pointer rests on the button
    if (s.pending && (s.kind === 'llb' || s.kind === 'pool' || s.kind === 'elective')) {
      body += '<div class="subj-actions"><button type="button" class="select-btn" data-action="picker-open" data-slot="' + s.id + '" title="' + (s.kind === 'llb' ? 'Any LLB Alternate offered in ' + s.session + ' 2027' : 'Choose a subject for this slot') + '">+ ' + selectLabel(s) + ' →</button></div>';
    } else if (s.pending && s.kind === 'cslot') {
      const tip = s.session === 'Summer' ? 'Choose a subject, or bring one forward from later in your plan' : s.raw.kind === 'llb' ? 'Any LLB Alternate offered in ' + s.session + ' 2027' : s.raw.kind === 'inline' ? 'Template options: ' + s.raw.options.map(function (o) { return o.code + ' ' + o.title; }).join(' or ') : 'Choose a subject for this slot';
      body += '<div class="subj-actions"><button type="button" class="select-btn" data-action="picker-open" data-slot="' + s.id + '" title="' + esc(tip) + '">+ ' + (s.raw.kind === 'llb' ? 'Select LLB Alternate' : 'Choose subject') + ' →</button></div>';
    }
    const tools = slotTools(s, ctx);
    const codeTxt = s.pending ? (s.kind === 'cslot' ? s.pendingCode : s.kind === 'llb' ? 'LLB ALT' : s.kind === 'elective' ? 'ELECTIVE' : 'CHOICE') : s.code;
    const check = '<label class="tick" title="Mark complete"><input type="checkbox" data-action="done" data-slot="' + s.id + '"' + (s.done ? ' checked' : '') + ' aria-label="Mark ' + esc((s.pending ? '' : s.code + ' ') + s.title) + ' complete"><span class="tick-box" aria-hidden="true"></span></label>';
    return '<div class="' + cls.join(' ') + '" id="slot-' + s.id + '" data-slot="' + s.id + '"' + (state.load !== 'PT' ? ' draggable="true"' : '') + (s.vt ? ' style="--vt:' + s.vt + '"' : '') + '>' +
      '<div class="subj-lead">' + check + '<span class="code-pill">' + esc(codeTxt) + '</span></div>' +
      '<div class="subj-main"><div class="subj-title">' + esc(s.title) + '</div><div class="subj-meta"><span class="cat">' + esc(s.typeLabel) + '</span>' + slotFlags(s, ctx) + '</div>' + body + '</div>' +
      '<div class="subj-side"><span class="pills">' + slotOffer(s, ctx) + '</span><span class="subj-end">' + (tools && !s.pending ? '<button type="button" class="subj-more" data-action="card-tools" data-slot="' + s.id + '" aria-expanded="' + (ui.openCard === s.id) + '" aria-controls="tools-' + s.id + '" aria-label="' + (ui.openCard === s.id ? 'Close the tools for ' : 'Edit ') + esc(s.code) + '" title="Change, move or remove"><span class="sm-t" aria-hidden="true">' + (ui.openCard === s.id ? 'Done ▴' : 'Edit ▾') + '</span></button>' : '') + '<span class="cp-badge">' + s.cp + ' CP</span></span></div>' +
      '<div class="subj-edit" id="tools-' + s.id + '" role="group" aria-label="Tools for ' + esc(s.pending ? 'this open slot' : s.code) + '">' + tools + '</div></div>';
  }

  // Move to ▾ on a card: any session of the plan, or a new year, each with the credit points it holds and whether the
  // subject runs there
  function moveSelect(s) {
    return '<span class="move-wrap"><select class="move-sel" data-slot="' + s.id + '" data-lazy="1" aria-label="Move ' + esc(s.pending ? 'this open slot' : s.code) + ' to another session" title="Move to another session"><option value="">Move to</option></select></span>';
  }
  function fillMove(sel) {
    if (!sel || !sel.dataset.lazy) return;
    const ctx = lastCtx;
    const s = ctx.byId[sel.dataset.slot];
    if (!s) return;
    delete sel.dataset.lazy;
    const years = ctx.shownYears || 1;
    const maxY = Math.min(MAX_YEARS, years + 1);
    const held = {};
    ctx.slots.forEach(function (o) { const k = orderIdx(o.year, o.session); held[k] = (held[k] || 0) + o.cp; });
    let opts = '<option value="">Move to</option>';
    for (let y = 1; y <= maxY; y++) {
      const fresh = y > years;
      opts += '<optgroup label="' + (fresh ? 'New year' : 'Year ' + y) + ' · ' + calYear(y) + '">' + PLAN_SESSIONS.filter(function (ss) { return !fresh || ss !== 'Summer'; }).map(function (ss) {
        const here = y === s.year && ss === s.session;
        const mark = here ? ' (here)' : s.pending || !s.code ? '' : offerIssue(ctx, s, ss) ? '  ⚠ Check offering' : '  ✓ Offered';
        return '<option value="' + y + '|' + ss + '"' + (here ? ' disabled' : '') + '>' + (fresh ? '+ New Year ' : 'Year ') + y + ' · ' + ss + (fresh ? '' : ' · ' + (held[orderIdx(y, ss)] || 0) + ' CP') + mark + '</option>';
      }).join('') + '</optgroup>';
    }
    sel.innerHTML = opts;
  }
  ['focusin', 'pointerdown'].forEach(function (type) {
    document.addEventListener(type, function (ev) { if (ev.target.classList && ev.target.classList.contains('move-sel')) fillMove(ev.target); }, true);
  });
  // + Add slot: a slot for any subject, or one tied to the pathway's own kinds of choice
  function kindLabel(r) {
    return !r ? '' : r.kind === 'llb' ? 'LLB Alternate slot' : r.kind === 'elective' ? 'Elective slot' : r.kind === 'option' ? 'Major option slot' : r.kind === 'pool' ? 'Choice: ' + cleanPoolTitle(r.title) : '';
  }
  // The kind of slot a card is, changed on the card itself: a subject put in as any WSU subject that should have been an
  // LLB Alternate, say, is set right without taking the card out and adding it again.
  function typeSelect(s, ctx) {
    const kinds = slotKinds(ctx);
    const row = ctx.custom ? (s.newCore ? null : s.orig) : s.raw;
    const can = ctx.custom ? !s.orig || s.newCore || !!kindLabel(s.orig) : s.kind === 'llb' || s.kind === 'elective' || s.kind === 'pool';
    if (!kinds.length || !can) return '';
    const now = s.newCore ? 'LLB Alternate slot' : kindLabel(row);
    return '<label class="type-wrap" title="What this slot counts as in your degree"><span class="type-l">Type</span><select class="type-sel" data-slot="' + s.id + '" aria-label="Type of slot for ' + esc(s.pending ? 'this open slot' : s.code) + '">' +
      '<option value=""' + (now ? '' : ' selected') + '>Any WSU subject</option>' +
      kinds.map(function (k) { return '<option value="' + k.o + '"' + (k.label === now ? ' selected' : '') + '>' + esc(k.label.replace(/ slot$/, '').replace(/^Choice: /, '')) + '</option>'; }).join('') + '</select></label>';
  }
  function setSlotType(slotId, o) {
    const sid = ensureEditable(slotId);
    const s = lastCtx.byId[sid];
    const plan = editPlan();
    if (!s || !plan) return;
    const row = o && plan.tpl ? PATH[plan.tpl].find(function (r) { return r.id === o; }) : null;
    const x = plan.slots[s.idx];
    const name = s.pending ? 'The ' + where(s) + ' slot' : s.code;
    noteChange('changed what ' + (s.pending ? 'a slot' : s.code) + ' counts as');
    x.o = row ? row.id : '';
    if (!x.code) x.cp = row ? row.cp : 10;
    ui.openCard = sid;
    renderMoving(function () { flashSlot(sid, true); });
    toast(name + ' now counts as ' + (row ? kindLabel(row).replace(/ slot$/, '').replace(/^Choice: /, 'a choice from ') : 'any WSU subject') + '.', { action: 'undo', label: 'Undo' });
  }
  function slotKinds(ctx) {
    const key = ctx.custom ? ctx.plan.tpl : ctx.key;
    if (!key) return [];
    const out = [];
    const seen = {};
    PATH[key].forEach(function (r) {
      const label = kindLabel(r);
      if (!label || seen[label]) return;
      seen[label] = 1;
      out.push({ o: r.id, label: label });
    });
    return out;
  }
  function addSlotTool(ctx, y, sess) {
    const kinds = slotKinds(ctx);
    const at = ' data-y="' + y + '" data-s="' + sess + '"';
    if (!kinds.length) return '<button type="button" class="mark-all add-slot" data-action="cadd"' + at + '>+ Add slot</button>';
    const id = 'add-' + y + '-' + sess;
    return '<div class="pop add-pop"><button type="button" class="mark-all add-slot" data-action="pop-toggle" aria-expanded="false" aria-controls="' + id + '" aria-label="Add a slot to Year ' + y + ' ' + sess + '">+ Add slot</button><div class="pop-menu add-menu" id="' + id + '" hidden>' +
      '<button type="button" class="tbtn pop-item" data-action="cadd"' + at + '>Subject slot (any WSU subject)</button>' +
      kinds.map(function (k) { return '<button type="button" class="tbtn pop-item" data-action="cadd"' + at + ' data-o="' + k.o + '">' + esc(k.label) + '</button>'; }).join('') + '</div></div>';
  }
  // A session's credit points, which a student can press to set the load they plan for it: the overload check and the
  // guide's suggestions then follow that load.
  function sessionLoad(ctx, y, sess, cp, edit) {
    const k = orderIdx(y, sess);
    const cap = sessionCap(ctx.custom ? ctx.plan : null, k);
    const own = cap !== LOAD_CP.FT;
    const over = ctx.custom && cp > cap;
    const text = (own ? cp + ' / ' + cap : cp) + ' CP' + (own && cap === 0 ? ' · Leave' : '');
    if (!edit) return '<span class="session-cp' + (over ? ' over' : '') + '">' + text + '</span>';
    const id = 'load-' + y + '-' + sess;
    return '<div class="pop load-pop"><button type="button" class="session-cp load-btn' + (over ? ' over' : '') + (own ? ' is-set' : '') + '" data-action="pop-toggle" aria-expanded="false" aria-controls="' + id + '" aria-label="Year ' + y + ' ' + sess + ': ' + cp + ' CP planned, load ' + cap + ' CP. Set the load for this session" title="' + (over ? 'More than the ' + cap + ' CP set for this session. ' : '') + 'Set the load for this session">' + text + '</button>' +
      '<div class="pop-menu load-menu" id="' + id + '" hidden><span class="pop-label">Load for this session</span>' + SESSION_LOADS.map(function (l) {
        return '<button type="button" class="tbtn pop-item" data-action="session-load" data-y="' + y + '" data-s="' + sess + '" data-v="' + l[0] + '" aria-pressed="' + (l[0] === cap) + '">' + l[0] + ' CP' + (l[1] ? ' · ' + l[1] : '') + '</button>';
      }).join('') + '</div></div>';
  }
  function sortSlots(list) {
    return list.slice().sort(function (a, b) { return orderIdx(a.year, a.session) - orderIdx(b.year, b.session) || a.raw.slot - b.raw.slot; });
  }
  function sumCP(list, doneOnly) { return list.reduce(function (a, s) { return a + (!doneOnly || s.done ? s.cp : 0); }, 0); }

  // Years that are already finished when a plan opens start folded, so a current student lands near
  // where they are now. Ticking never folds a year: the page must not move under a student's hand.
  function foldedYears(ctx, years) {
    const key = ctx.key + '|' + state.load;
    if (!ui.folded || ui.folded.key !== key) {
      const fold = {};
      // a plan with something left to do, in it or in its guide, folds its finished years
      if (ctx.slots.some(function (s) { return !s.done; }) || (ctx.custom && ctx.guide)) {
        years.forEach(function (y) {
          const all = y.Autumn.concat(y.Spring, y.Summer);
          if (all.length && all.every(function (s) { return s.done; })) fold[y.year] = true;
        });
      }
      ui.folded = { key: key, years: fold };
      ui.viewFold = {};
    }
    return ui.folded.years;
  }
  function foldLabel(y, fold) { return (fold ? 'Show' : 'Hide') + ' Year ' + y + ' subjects'; }
  function setYearFold(y, fold) {
    // a view's own opening and closing lasts until the view changes, and leaves the student's folds alone
    if (state.view !== 'all') ui.viewFold[y] = fold;
    else if (ui.folded) { if (fold) ui.folded.years[y] = true; else delete ui.folded.years[y]; }
    showYearFold(y);
    if (state.view !== 'all') applyGridFilter(true);
  }
  function yearIsFolded(y) {
    if (state.view !== 'all' && ui.viewFold[y] != null) return ui.viewFold[y];
    const info = ui.yearInfo[y];
    if (state.view === 'action' && info && info.action) return false;
    if (state.view === 'remaining' && info && info.finished) return true;
    return !!(ui.folded && ui.folded.years[y]);
  }
  function showYearFold(y) {
    const box = document.getElementById('year-' + y);
    if (!box) return;
    const fold = yearIsFolded(y);
    box.classList.toggle('is-folded', fold);
    box.querySelector('.sessions').hidden = fold;
    const b = box.querySelector('.year-toggle');
    b.setAttribute('aria-expanded', String(!fold));
    b.setAttribute('aria-label', foldLabel(y, fold));
    b.title = foldLabel(y, fold);
  }

  // ---- degree map: every session of the plan at a glance, one press from any of them
  const SESSION_SHORT = { Autumn: 'Aut', Spring: 'Spr', Summer: 'Sum' };
  function renderMap(ctx) {
    const box = $('#dmap');
    const years = timeline(ctx, state.load);
    box.hidden = !years.length;
    const next = nextSession(ctx);
    const doneOf = function (list) { return list.filter(function (s) { return s.done; }).length; };
    const many = years.length > 6;
    setHTML(box, '<ol class="dm-list' + (many ? ' dm-many' : '') + '">' + years.map(function (y) {
      const all = y.Autumn.concat(y.Spring, y.Summer);
      const total = sumCP(all);
      const finished = all.length && doneOf(all) === all.length;
      const sessions = y.Summer.length ? PLAN_SESSIONS : SESSIONS;
      const yearLabel = 'Year ' + y.year + ', ' + calYear(y.year) + ': ' + doneOf(all) + ' of ' + plural(all.length, 'subject') + ' done';
      return '<li class="dm-year' + (finished ? ' is-done' : '') + '" data-y="' + y.year + '">' +
        '<button type="button" class="dm-y" data-action="map-jump" data-y="' + y.year + '" aria-label="' + yearLabel + '" title="' + yearLabel + '"><span class="dm-yl">' + (many ? 'Y' : 'Year ') + y.year + '</span><span class="dm-fill"><span style="width:' + (total ? Math.round(sumCP(all, true) / total * 100) : 0) + '%"></span></span></button>' +
        sessions.map(function (sess) {
          const list = sortSlots(y[sess]);
          const isNext = next && next.year === y.year && next.session === sess;
          const label = sessionLabel(y.year, sess) + ', Year ' + y.year + ': ' + (list.length ? doneOf(list) + ' of ' + plural(list.length, 'subject') + ' done' : 'no subjects') + (isNext ? ', next to enrol' : '');
          return '<button type="button" class="dm-s' + (isNext ? ' is-next' : '') + '" data-action="map-jump" data-y="' + y.year + '" data-s="' + sess + '" aria-label="' + label + '" title="' + label + '"><span class="dm-n">' + SESSION_SHORT[sess] + '</span><span class="dm-seg">' +
            list.map(function (s) { return '<i data-slot="' + s.id + '"' + (s.done ? ' class="on"' : s.pending ? ' class="open"' : '') + '></i>'; }).join('') + '</span></button>';
        }).join('') + '</li>';
    }).join('') + '</ol>');
    markHere();
  }
  // the year on screen, marked in the map; a map too wide for the screen keeps that year in view
  function markHere() {
    const box = $('#dmap');
    box.querySelectorAll('.dm-year').forEach(function (li) {
      const on = +li.dataset.y === ui.here;
      li.classList.toggle('is-here', on);
      const b = li.querySelector('.dm-y');
      if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
      if (on && box.scrollWidth > box.clientWidth) box.scrollTo({ left: li.offsetLeft - (box.clientWidth - li.offsetWidth) / 2, behavior: scrollMode() });
    });
  }
  let yearSpy = null;
  function updateHere() {
    const marker = window.innerHeight * 0.3;
    let here = 0;
    document.querySelectorAll('#grid .year').forEach(function (y) { if (y.getBoundingClientRect().top <= marker) here = +y.id.replace('year-', ''); });
    if (here !== ui.here) { ui.here = here; markHere(); }
  }
  function watchYears() {
    if (!window.IntersectionObserver) return;
    if (yearSpy) yearSpy.disconnect();
    yearSpy = new IntersectionObserver(updateHere, { rootMargin: '-30% 0px -65% 0px' });
    document.querySelectorAll('#grid .year').forEach(function (y) { yearSpy.observe(y); });
  }

  function renderGrid(ctx) {
    const years = timeline(ctx, state.load);
    const pt = state.load === 'PT';
    let html = pt ? '<p class="pt-note"><b>Part-time view (indicative).</b> ' + (ctx.custom && ctx.plan.start ? 'Sessions that have begun stay as they are, and the rest is laid out at 20 CP a session, keeping every subject in the session type it is planned for.' : 'Each full-time session is split into two 20 CP sessions, keeping every subject in the session type it is offered in.') + ' This lengthens the pathway to about ' + fmt(ctx.deg.ptYears) + ' years and can shift prerequisite timing, so confirm your sequence with the Academic Program Advisor. Switch to Full-time to add, remove or move subjects.</p>'
      : ctx.custom && ctx.plan.pace ? '<p class="pt-note"><b>Re-paced plan.</b> Completed subjects stay where you took them, and the rest runs at up to ' + ctx.plan.pace + ' CP a session, in sessions each subject is offered in, after its known prerequisites. Confirm it with your Academic Program Advisor before you enrol.</p>' : '';
    const edit = !pt;
    const folded = foldedYears(ctx, years);
    const begun = ctx.custom && ctx.plan.start ? firstOpenIdx(ctx.plan.start) : 0;
    ctx.shownYears = years.length ? years[years.length - 1].year : 1;
    // cards glide by subject, as slot numbers shift when a custom plan changes; names must be unique
    const named = {};
    ctx.slots.forEach(function (s) {
      const base = s.pending ? 'open-' + s.id : String(s.code).replace(/[^A-Za-z0-9]/g, '-');
      named[base] = (named[base] || 0) + 1;
      s.vt = 'vt-' + base + (named[base] > 1 ? '-' + named[base] : '');
    });
    years.forEach(function (y) {
      const lists = { Autumn: sortSlots(y.Autumn), Spring: sortSlots(y.Spring), Summer: sortSlots(y.Summer) };
      const all = lists.Autumn.concat(lists.Spring, lists.Summer);
      const sessions = lists.Summer.length ? PLAN_SESSIONS : SESSIONS;
      const R = roman(y.year);
      const addSummer = !pt && !lists.Summer.length
        ? '<button type="button" class="summer-add" data-action="summer-add" data-y="' + y.year + '" title="Add a Summer session after Spring in Year ' + y.year + '">+ Add Summer</button>'
        : '';
      const fold = !!folded[y.year];
      html += '<article class="year' + (fold ? ' is-folded' : '') + '" id="year-' + y.year + '" aria-label="Year ' + y.year + '">' +
        '<header class="year-bar" data-roman="' + R + '"><span class="year-seal" aria-hidden="true">' + R + '</span>' +
        '<h2>Year ' + y.year + '<small>' + calYear(y.year) + (pt ? ' · part-time' : '') + '</small></h2>' + addSummer +
        '<div class="year-cp"><b>' + sumCP(lists.Autumn) + ' CP</b> Autumn · <b>' + sumCP(lists.Spring) + ' CP</b> Spring' + (lists.Summer.length ? ' · <b>' + sumCP(lists.Summer) + ' CP</b> Summer' : '') + '<span class="done">' + sumCP(all, true) + ' / ' + sumCP(all) + ' CP completed</span></div>' +
        '<button type="button" class="year-toggle" data-action="year-toggle" data-y="' + y.year + '" aria-expanded="' + !fold + '" aria-controls="year-' + y.year + '-body" aria-label="' + foldLabel(y.year, fold) + '" title="' + foldLabel(y.year, fold) + '"></button></header>' +
        '<div class="sessions" id="year-' + y.year + '-body"' + (fold ? ' hidden' : '') + '>';
      sessions.forEach(function (sess) {
        const list = lists[sess];
        const allDone = list.length && list.every(function (s) { return s.done; });
        const note = ctx.custom && ctx.plan.notes ? ctx.plan.notes[orderIdx(y.year, sess)] || '' : '';
        html += '<section class="session' + (sess === 'Summer' ? ' session-summer' : '') + '" aria-label="Year ' + y.year + ' ' + sess + ' session" data-y="' + y.year + '" data-s="' + sess + '"><div class="session-head"><h3>' + sess + '<span>Session</span></h3><div class="session-tools"><span class="commute-slot">' + commutePill(list) + '</span><span class="load-slot">' + loadPill(list) + '</span>' +
          (edit ? '<button type="button" class="mark-all note-btn" data-action="session-note" data-y="' + y.year + '" data-s="' + sess + '" title="Add your own note to this session, such as an exchange, a placement or work">' + (note ? 'Edit note' : '+ Note') + '</button>' + addSlotTool(ctx, y.year, sess) : '') +
          (list.length ? '<button type="button" class="mark-all" data-action="session-done" data-ids="' + list.map(function (s) { return s.id; }).join(',') + '">' + (allDone ? 'Unmark all' : 'Mark all done') + '</button>' : '') +
          sessionLoad(ctx, y.year, sess, sumCP(list), edit) + '</div></div>' + (note ? '<p class="session-note"><span class="sn-label">Note</span>' + esc(note) + '</p>' : '') + '<p class="session-clear"></p><div class="slots">' +
          (list.length ? list.map(function (s) { return slotHTML(s, ctx); }).join('') : '<div class="slot-empty">' + (sess === 'Autumn' && y === years[0] && lists.Spring.length ? 'Your plan starts in Spring, so nothing is planned here'
            : !ctx.custom ? 'No subjects scheduled this session'
            // a session that has already begun is not one to plan: it only shows what the record had in it
            : orderIdx(y.year, sess) < begun ? 'Nothing recorded for this session. If you studied then, use + Add slot to put the subject in.'
            : sessionCap(ctx.plan, orderIdx(y.year, sess)) === 0 ? '<b>Leave of Absence.</b> Nothing is planned for this session.'
            : '<b>Empty session.</b> ' + (ctx.guide ? 'Drag or + Add subjects from the Suggested Remaining Guide, or use + Add slot.' : 'Drag a subject here, or use + Add slot.')) + '</div>') + '</div></section>';
      });
      if (edit) {
        html += '<div class="year-foot" role="group" aria-label="Options for Year ' + y.year + '"><span class="yf-label">Year ' + y.year + '</span>' +
          '<button type="button" class="text-btn" data-action="year-insert" data-y="' + y.year + '" title="For a year off, or room before this year: this year and the later ones move a year on">Insert an empty year before</button>' +
          '<button type="button" class="text-btn" data-action="year-clear" data-y="' + y.year + '" title="Take out every subject and slot in this year that is not ticked">Clear unticked subjects</button>' +
          '<button type="button" class="text-btn year-del" data-action="year-delete" data-y="' + y.year + '" title="Remove this year and its subjects, and bring the later years one year earlier">Delete Year ' + y.year + ' ×</button></div>';
      }
      html += '</div></article>';
    });
    if (ctx.custom && !ctx.edit && !ctx.slots.length && !years.length) html += '<div class="plan-empty"><b>Your plan has no slots yet.</b> Add a year, or use Edit setup to fill it to the credit points your degree needs.</div>';
    if (edit) {
      html += '<div class="grid-actions"><button type="button" class="tbtn tbtn-outline" data-action="cyear">+ Add a year</button>' +
        '<span class="small muted">' + (ctx.custom ? ctx.placedCP + ' of ' + ctx.plan.cp + ' CP placed · slots total ' + ctx.totalCP + ' CP · open slots count towards the session load until you remove them' : 'Move, change, add or remove any subject: this pathway then keeps your edited copy here, and Reset to Default Sequence in Plan Tools puts the WSLSA order back.') + '</span></div>';
    }
    $('#grid').innerHTML = html;
  }

  function statusClass(st) {
    if (!st) return 'status-non';
    if (/^Essential/.test(st)) return 'status-essential';
    if (/Relates to Major/.test(st)) return 'status-major';
    return 'status-non';
  }

  const TABS = [
    ['structure', '01→', 'Program Structure & Credit Breakdown'],
    ['admission', '02→', 'Admission, LPAB Accreditation & Exit Awards'],
    ['catalogue', '03→', 'Full 2027 Subject & LLB Alternate Catalogue'],
  ];
  const CUSTOM_TABS = [
    ['structure', '01→', 'Your Plan & Credit Breakdown'],
    ['admission', '02→', 'Admission, LPAB Accreditation & Exit Awards'],
    ['catalogue', '03→', '2027 Subject Catalogue'],
  ];
  function courseFacts(ctx) {
    const d = ctx.deg;
    const f = finishText(ctx);
    return '<dl class="kv"><dt>Finish</dt><dd>' + esc(f.at) + (f.how ? ' · ' + esc(f.how) : '') + ' · ' + (planStart() < START_YEAR ? 'started ' : 'starting ') + planStart() + '</dd></dl>' +
      (d.intake ? '<dl class="kv"><dt>Intake</dt><dd>' + esc(d.intake) + (d.intakeList.length === 1 ? ' only' : '') + '</dd></dl>' : '') +
      '<dl class="kv"><dt>Campuses</dt><dd>' + esc(d.campuses) + '</dd></dl>' +
      '<p class="kv-link"><a class="tbtn tbtn-outline" href="' + esc(d.handbook) + '" target="_blank" rel="noopener">' + (ctx.custom && !ctx.tdeg ? 'WSU Student Handbook →' : 'Official 2027 Handbook →') + '</a></p>';
  }
  // A degree's credit breakdown in a Handbook structure: before 2027 the Law core was 30 CP smaller and the LLB
  // Alternates 30 CP larger, as LAWS 2019, LAWS 3099 and LAWS 3102 are core only from 2027.
  function effectiveStructure(deg, cohort) {
    const list = deg.structure || [];
    if (cohort !== 'pre2027') return list;
    const shift = NEW_2027_CORES.filter(function (c) { return deg.byCode && deg.byCode[c]; }).reduce(function (a, c) { return a + (deg.byCode[c].cp || 10); }, 0);
    const core = list.find(function (c) { return /^Core - Laws/.test(c.component); }) || list.find(function (c) { return c.component === 'Core'; });
    const llb = list.find(function (c) { return /^LLB Alternate/.test(c.component); });
    if (!core || !llb || !shift) return list;
    return list.map(function (c) { return c === core ? { component: c.component, cp: c.cp - shift, was: c.cp } : c === llb ? { component: c.component, cp: c.cp + shift, was: c.cp } : c; });
  }
  function structureNote(ctx) {
    return ctxCohort(ctx) === 'pre2027' ? '<p class="small muted structure-note"><b>Pre-2027 structure.</b> LAWS 2019, LAWS 3099 and LAWS 3102 are core subjects only from 2027, so the Law core is 30 CP smaller and the LLB Alternates 30 CP larger than the 2027 Handbook shows.</p>' : '';
  }
  function customStructure(ctx) {
    const areas = {};
    let openCP = 0;
    ctx.slots.forEach(function (s) {
      if (s.pending) { openCP += s.cp; return; }
      const k = s.custom ? 'Typed in by hand' : s.code.slice(0, 4) + ' subjects';
      areas[k] = (areas[k] || 0) + s.cp;
    });
    const rows = Object.keys(areas).sort(function (a, b) { return areas[b] - areas[a] || (a < b ? -1 : 1); });
    const max = Math.max.apply(null, [1, openCP].concat(rows.map(function (k) { return areas[k]; })));
    const row = function (label, cp, cls) { return '<div class="structure-row' + (cls ? ' ' + cls : '') + '"><span>' + esc(label) + '</span><span class="cpv">' + cp + ' CP</span><span class="sbar"><span style="width:' + (cp / max * 100) + '%"></span></span></div>'; };
    const progress = areaCP(ctx);
    const areaRow = function (k) { return '<div class="structure-row" data-area="' + esc(k) + '"><span>' + esc(k) + '</span><span class="cpv">' + progress[k].done + ' / ' + progress[k].cp + ' CP</span><span class="sbar"><span style="width:' + (progress[k].cp / max * 100) + '%"><i style="width:' + (progress[k].done / progress[k].cp * 100) + '%"></i></span></span></div>'; };
    const t = ctx.tdeg;
    return '<div class="two-col"><div><h3 class="panel-h">Credit breakdown by subject area</h3>' +
      (rows.length ? rows.map(areaRow).join('') : '<p class="muted small">No subjects placed yet.</p>') +
      (openCP ? row('Open slots', openCP, 'row-open') : '') +
      '<div class="structure-row structure-total"><span>Placed of ' + ctx.plan.cp + ' CP required</span><span class="cpv">' + ctx.placedCP + ' CP</span></div>' + doneRow(ctx) +
      '<dl class="kv" style="margin-top:18px"><dt>Duration</dt><dd>' + fmt(ctx.deg.ftYears) + ' years full-time · ' + fmt(ctx.deg.ptYears) + ' years part-time (40 or 20 CP a session)</dd></dl>' +
      courseFacts(ctx) +
      '<dl class="kv"><dt>Starting point</dt><dd>' + (t ? esc(tplLabel(ctx.plan.tpl)) + (ctx.risks.replaced.length ? ' · ' + plural(ctx.risks.replaced.length, 'template subject') + ' changed' : ' · no template subjects changed') : 'Blank plan built from scratch') + '</dd></dl>' +
      '<button type="button" class="tbtn tbtn-outline" data-action="custom-setup">Edit name, credit points or template →</button></div>' +
      '<div><h3 class="panel-h">How custom plans work</h3><p class="small muted" style="margin-top:0">' + customWhy(ctx) + '</p>' +
      (t ? '<h3 class="panel-h" style="margin-top:18px">' + esc(t.code) + ' program structure</h3>' + structureNote(ctx) + effectiveStructure(t, ctxCohort(ctx)).map(function (c) { return '<div class="structure-row"><span>' + esc(c.component) + '</span><span class="cpv">' + c.cp + ' CP</span></div>'; }).join('') : '') +
      (t && t.advisorNotes.length ? '<h3 class="panel-h" style="margin-top:18px">Advisor notes for ' + esc(t.code) + '</h3><ul class="src-list">' + t.advisorNotes.map(function (n) { return '<li>' + esc(n.text) + '</li>'; }).join('') + '</ul>' : '') +
      '</div></div>';
  }
  function renderDetails(ctx) {
    const d = ctx.deg;
    const own = ctx.custom && !ctx.edit;
    const tabs = own ? CUSTOM_TABS : TABS;
    let html = '<div class="drawer-head"><p class="kicker">' + (own ? 'Your custom plan <i>·</i> 2027 Student Handbook' : 'Degree details <i>·</i> 2027 Student Handbook') + '</p><h2>Inside ' + titleHTML(d.title) + '</h2></div>' +
      '<div class="tabs" role="tablist">' + tabs.map(function (t) {
        return '<button type="button" class="tab" role="tab" id="tab-' + t[0] + '" data-action="tab" data-tab="' + t[0] + '" aria-selected="' + (ui.tab === t[0]) + '"><span class="idx">' + t[1] + '</span>' + esc(t[2]) + '</button>';
      }).join('') + '</div><div class="tab-panel" role="tabpanel" aria-labelledby="tab-' + ui.tab + '">';
    if (own && ui.tab === 'structure') {
      html += customStructure(ctx);
    } else if (own && ui.tab === 'admission' && !ctx.tdeg) {
      html += '<p class="muted" style="margin:0;max-width:72ch">Admission, LPAB accreditation and exit awards belong to a specific degree, so a plan built from scratch has none to show. Use <button type="button" class="linkish" data-action="custom-setup">Edit setup</button> to start from one of the 2027 WSLSA pathways, or check your degree in the <a href="' + esc(HANDBOOK_HOME) + '" target="_blank" rel="noopener">WSU Student Handbook →</a></p>';
    } else if (ui.tab === 'structure') {
      const parts = effectiveStructure(ctx.tdeg || d, ctxCohort(ctx));
      const max = Math.max.apply(null, parts.map(function (c) { return c.cp; }));
      const c = META.counts;
      html += '<div class="two-col"><div><h3 class="panel-h">Credit breakdown</h3>' + structureNote(ctx) +
        parts.map(function (c) {
          return '<div class="structure-row"><span>' + esc(c.component) + '</span><span class="cpv">' + c.cp + ' CP</span><span class="sbar"><span style="width:' + (c.cp / max * 100) + '%"></span></span></div>';
        }).join('') +
        '<div class="structure-row structure-total"><span>Total credit points</span><span class="cpv">' + d.structureTotal + ' CP</span></div>' + doneRow(ctx) +
        '<dl class="kv" style="margin-top:18px"><dt>Major / minor choices</dt><dd>' + esc(d.majorChoices) + ' · ' + plural(d.pathwayGroups, 'pathway group') + '</dd></dl>' +
        '<dl class="kv"><dt>Duration</dt><dd>' + fmt(d.ftYears) + ' years full-time · ' + fmt(d.ptYears) + ' years part-time</dd></dl>' +
        courseFacts(ctx) + '</div>' +
        '<div><h3 class="panel-h">How the pathway is built</h3><p class="small muted" style="margin-top:0">' + esc(d.sheetIntro) + '</p>' +
        '<h3 class="panel-h" style="margin-top:18px">Advisor notes for ' + d.code + '</h3>' +
        (d.advisorNotes.length ? '<ul class="src-list">' + d.advisorNotes.map(function (n) { return '<li>' + esc(n.text) + '</li>'; }).join('') + '</ul>' : '<p class="muted small">The workbook lists no advisor notes for this degree.</p>') +
        '<p class="small muted" style="margin-top:14px">Source: ' + esc(META.sourceWorkbook) + ' (' + c.pathwayRows.toLocaleString('en-AU') + ' pathway slots, ' + c.catalogueRows.toLocaleString('en-AU') + ' catalogue rows across ' + c.degrees + ' degrees)' + (EXTRA.length ? ', plus ' + EXTRA.length.toLocaleString('en-AU') + ' more subjects from the WSU subject list for any-subject electives' : '') + '. Subjects with sessions TBC in this degree: ' + esc(d.tbcSubjects.join(', ')) + '.</p></div></div>';
    } else if (ui.tab === 'admission') {
      html += (own ? '<p class="small muted" style="margin:0 0 16px">From the ' + esc(tplLabel(ctx.plan.tpl)) + ' template. Changing subjects in a custom plan does not change these degree rules.</p>' : '') +
        '<div class="two-col"><div><h3 class="panel-h">Admission</h3>' +
        '<dl class="kv"><dt>Assumed knowledge / admission</dt><dd>' + esc(d.assumedKnowledge) + '</dd></dl>' +
        '<dl class="kv"><dt>Intake</dt><dd>' + esc(d.intake) + '</dd></dl>' +
        '<dl class="kv"><dt>Campuses</dt><dd>' + esc(d.campuses) + '</dd></dl>' +
        '<dl class="kv"><dt>Students</dt><dd>' + esc(d.students) + (d.cricos ? ' · CRICOS ' + esc(d.cricos) : '') + '</dd></dl>' +
        '<h3 class="panel-h" style="margin-top:20px">Exit awards</h3><ul class="exit-list">' + d.exitAwards.map(function (e) {
          return '<li><span>' + (e.code ? '<b class="mono">' + e.code + '</b> ' : '') + esc(e.name) + '</span>' + (e.exitOnly ? '<span class="status status-non">Exit only</span>' : '') + '</li>';
        }).join('') + '</ul></div>' +
        '<div><h3 class="panel-h">LPAB &amp; professional accreditation</h3><ul class="acc-list">' + d.accreditation.map(function (a) {
          return '<li><span>' + esc(a.name) + '</span><span class="status ' + statusClass(a.status) + '">' + esc(a.status || '') + '</span></li>';
        }).join('') + '</ul></div></div>';
    } else {
      html += '<p class="cat-count">' + esc(d.catalogueNote || '') + '</p>' +
        '<div class="cat-filters">' +
        '<div class="field"><label for="cat-q">Search</label><input class="input" id="cat-q" type="search" placeholder="Code or title, e.g. LAWS 4008 or Revenue" value="' + esc(ui.cat.q) + '"></div>' +
        '<div class="field"><label for="cat-comp">Component</label><div class="select-wrap"><select id="cat-comp"><option value="">All components</option>' + d.components.map(function (c) { return '<option' + (ui.cat.comp === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') +
          (EXTRA.length ? '<option value="__extra__"' + (ui.cat.comp === '__extra__' ? ' selected' : '') + '>WSU subject list (' + EXTRA.length.toLocaleString('en-AU') + ' more subjects)</option>' : '') + '</select></div></div>' +
        '<div class="field"><label for="cat-session">Session</label><div class="select-wrap"><select id="cat-session"><option value="">Autumn or Spring</option><option value="Autumn"' + (ui.cat.session === 'Autumn' ? ' selected' : '') + '>Offered in Autumn</option><option value="Spring"' + (ui.cat.session === 'Spring' ? ' selected' : '') + '>Offered in Spring</option><option value="TBC"' + (ui.cat.session === 'TBC' ? ' selected' : '') + '>Session TBC</option></select></div></div>' +
        '<label class="check-row" style="padding-bottom:10px"><input type="checkbox" id="cat-inplan"' + (ui.cat.inPlan ? ' checked' : '') + '>In my plan</label>' +
        '</div>' + (d.llbComponent ? areaTools('cat-area', ui.cat.area) : '') + toolsNote(d.llbComponent, '<kbd>/</kbd> search the catalogue · <kbd>Esc</kbd> close a window or clear a highlight') + '<div id="cat-results"></div>';
    }
    html += '</div>';
    // assigning from a long list leaves the list where it was
    const scroller = $('#cat-results .table-scroll');
    const keep = scroller ? [scroller.scrollTop, scroller.scrollLeft] : null;
    $('#details').innerHTML = html;
    if (ui.tab === 'catalogue') {
      renderCatalogueRows(ctx);
      const again = $('#cat-results .table-scroll');
      if (keep && again) { again.scrollTop = keep[0]; again.scrollLeft = keep[1]; }
    }
  }

  function renderCatalogueRows(ctx) {
    const d = ctx.deg;
    const q = normQ(ui.cat.q);
    const onlyExtra = ui.cat.comp === '__extra__';
    const rows = onlyExtra ? [] : rankByQuery(d.catalogue, q).filter(function (c) {
      if (ui.cat.comp && c.component !== ui.cat.comp) return false;
      if (!inArea(c.code, ui.cat.area)) return false;
      if (ui.cat.inPlan && !ctx.used[c.code]) return false;
      if (ui.cat.session === 'TBC') return c.autumn === 'TBC' || c.spring === 'TBC';
      if (ui.cat.session) { const v = sessionValue(c, ui.cat.session); return v && v !== '—' && v !== 'TBC'; }
      return true;
    });
    // subject-list rows: shown when that component is chosen, or as extra matches for a search
    const wantExtra = EXTRA.length && !ui.cat.session && !ui.cat.area && (onlyExtra || (!ui.cat.comp && q.length >= 2));
    const extraHits = wantExtra ? rankByQuery(EXTRA, q).filter(function (e) { return !ui.cat.inPlan || ctx.used[e.code]; }) : [];
    const extraLimit = onlyExtra ? 300 : 100;
    function cell(v) { const o = parseOffered(v); return o.none ? '<span class="muted">—</span>' : '<span class="pills" style="justify-content:flex-start">' + pillsFor(o) + '</span>'; }
    let note = '';
    if (EXTRA.length && ui.cat.session && (onlyExtra || !ui.cat.comp)) note = ' · subjects from the WSU subject list have no session data, so the session filter hides them';
    else if (extraHits.length > extraLimit) note = ' · showing the first ' + extraLimit + ' WSU subject list matches; refine the search to narrow them';
    else if (!wantExtra && EXTRA.length && !ui.cat.comp && !ui.cat.area) note =' · search to include ' + EXTRA.length.toLocaleString('en-AU') + ' more subjects from the WSU subject list';
    $('#cat-results').innerHTML = '<p class="cat-count">' + (onlyExtra ? extraHits.length.toLocaleString('en-AU') + ' of ' + EXTRA.length.toLocaleString('en-AU') + ' WSU subject list subjects' : rows.length + ' of ' + d.catalogue.length + ' degree subjects' + (extraHits.length ? ' + ' + extraHits.length.toLocaleString('en-AU') + ' from the WSU subject list' : '')) + note + '</p>' +
      '<div class="table-scroll" tabindex="0" role="region" aria-label="Subject catalogue results"><table class="cat"><thead><tr><th>Code</th><th>Title</th><th>Component</th><th>Level</th><th>Autumn</th><th>Spring</th><th>CP</th><th>Data source</th><th class="c-plan">Your plan</th></tr></thead><tbody>' +
      rows.map(function (c) {
        const inPlan = !!ctx.used[c.code];
        return '<tr class="' + (inPlan ? 'in-plan' : '') + '"><td class="c-code">' + hlCode(c.code, q) + '</td><td>' + hl(c.title, q) + areaTags(c.code) + '</td><td class="c-comp">' + esc(c.component) + '</td><td class="small">' + esc(c.level) + '</td><td>' + cell(c.autumn) + '</td><td>' + cell(c.spring) + '</td><td class="small mono">' + c.cp + '</td><td class="small muted">' + esc(c.source) + '</td>' + planCell(ctx, c.code) + '</tr>';
      }).join('') +
      extraHits.slice(0, extraLimit).map(function (e) {
        const inPlan = !!ctx.used[e.code];
        return '<tr class="extra' + (inPlan ? ' in-plan' : '') + '"><td class="c-code">' + hlCode(e.code, q) + '</td><td>' + hl(e.title, q) + '</td><td class="c-comp">WSU subject list (any-subject electives)</td><td class="small">' + e.level + '</td><td colspan="2" class="small muted">Check the 2027 Handbook</td><td class="small muted">—</td><td class="small muted">Subject list</td>' + planCell(ctx, e.code) + '</tr>';
      }).join('') + '</tbody></table></div>';
    if (!rows.length && !extraHits.length) $('#cat-results .table-scroll').outerHTML = '<div class="pick-empty">No subjects match these filters. <button type="button" class="linkish" data-action="cat-reset">Clear filters</button></div>';
  }

  function disclaimerText() {
    const ex = META.explorerIntro.match(/Pathways are[^.]*\./);
    const sheet = DEGREES[0].sheetIntro.match(/The recommended pathway[^]*$/);
    const src = META.overviewNote.match(/^Source:[^]*?Degree Guides\./);
    return ['This explorer is a student resource from the Western Sydney Law Students\' Association and is not endorsed by the School of Law of Western Sydney University.', sheet ? sheet[0] : '', ex ? ex[0] : '', src ? src[0] : '',
      'Confirm enrolment decisions, prerequisites and any flagged gaps with your Academic Program Advisor. If you get stuck, contact the Law Enquiry Team at ' + LAW_ENQUIRY + ' or your Academic Program Advisor.',
      'If you started your degree before 2027, plan your 2027 subjects with the 2026 Handbook, which reflects the curriculum for your course.'].filter(Boolean).join(' ');
  }
  // From the School of Law's announcement to current students, 26 October 2026: final offering of each subject.
  const PHASE_OUT = [
    [2027, [['LAWS 2004', 'Criminal Law'], ['LAWS 1009', 'Legal Analysis and Critique']]],
    [2028, [['LAWS 2015', 'Professional Responsibility and Legal Ethics'], ['LAWS 2001', 'Alternative Dispute Resolution']]],
    [2029, [['LAWS 4004', 'Criminal Procedure and Evidence'], ['LAWS 4013', 'Civil Procedure and Arbitration']]],
  ];
  // ======================================================================== Law Enquiry box
  // The School's 2027 advice, its contact and a drafted email, in a box that stays out of the way: a pill
  // until the student opens it, and a pill again once they press anywhere else or Esc.
  const ENQ_TOPICS = [
    { id: 'transition', label: '2027 Transition Check', subject: '2027 curriculum transition check', ask: 'Please could you confirm how the 2027 curriculum change affects my degree, and which Handbook and subjects apply to me.' },
    { id: 'progression', label: 'Progression / Study Plan Check', subject: 'Progression and study plan check', ask: 'Please could you check whether my study plan below meets my degree requirements and is in a suitable order.' },
    { id: 'waiver', label: 'Prerequisite Waiver Query', subject: 'Prerequisite waiver query', ask: 'I would like to ask about a prerequisite waiver for this subject: [subject code and your reason].' },
    { id: 'alternate', label: 'LLB Alternate Question', subject: 'LLB Alternate question', ask: 'I have a question about my LLB Alternate subjects: [your question].' },
  ];
  // What each side of 80 Law CP means for a student. Put the School's own wording here once it is published:
  // until then this only says where the student stands and sends them to the School, and claims no rule.
  const TRANSITION_NOTE = {
    under: 'To confirm how the 2027 change applies to you, send the School a 2027 Transition Check below.',
    over: 'To confirm how the 2027 change applies to you, send the School a 2027 Transition Check below.',
  };
  function readStored(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function writeStored(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* private mode: it lasts until this page is closed */ }
  }
  function lawCP(ctx) {
    return ctx.slots.reduce(function (n, s) { return n + (s.done && !s.pending && /^LAWS /.test(s.code || '') ? s.cp : 0); }, 0);
  }
  function renderEnquiryBox() {
    $('#enquiry-box').innerHTML = '<button type="button" class="enq-pill" data-action="enq-toggle" aria-expanded="false" aria-controls="enq-card"><span aria-hidden="true">✉</span><span>Law Enquiry<span class="wide-only"> · 2027 Help</span></span><span class="enq-badge" id="enq-badge"></span><span class="enq-caret" id="enq-caret" aria-hidden="true">▴</span></button>' +
      '<div class="enq-card" id="enq-card" tabindex="-1" hidden>' +
      '<div class="enq-head"><div><p class="enq-kicker">School of Law update <i>·</i> 26 Oct<span class="wide-only">ober</span> 2026</p><h2>Law Enquiry and 2027 help</h2></div><button type="button" class="modal-x" data-action="enq-toggle" aria-label="Minimise Law Enquiry">×</button></div>' +
      '<p>This explorer follows the 2027 Handbook, which reflects the School of Law\'s new curriculum for students starting in 2027. If you are a current student, the School of Law advises choosing the <b>2026 Handbook</b> when you plan and enrol in your 2027 subjects, as it reflects the requirements of your course.</p>' +
      '<p class="enq-status" id="enq-status"></p>' +
      '<details class="enq-more"><summary>Phase 1, 2 and 3: subjects being phased out</summary>' +
      '<p>If you fail one of these subjects, or have not completed it in the correct order, enrol in its next available offering. Each is listed under the year of its final offering.</p>' +
      '<div class="phase-grid">' + PHASE_OUT.map(function (p, i) {
        return '<div><b>Phase ' + (i + 1) + ' · ' + p[0] + '</b>' + p[1].map(function (s) { return '<span><code>' + s[0] + '</code> ' + esc(s[1]) + '</span>'; }).join('') + '</div>';
      }).join('') + '</div>' +
      '<p>Remedies (LAWS 4014) runs in Autumn and Spring 2027, then once a year from 2028, so its session in a later year of your pathway may change.</p></details>' +
      '<h3>What is your question about?</h3><div class="enq-chips" role="group" aria-label="Enquiry topic">' + ENQ_TOPICS.map(function (t) {
        return '<button type="button" class="chip" data-action="enq-topic" data-topic="' + t.id + '" aria-pressed="' + (t.id === ui.enqTopic) + '">' + esc(t.label) + '</button>';
      }).join('') + '</div>' +
      '<h3>Added to your email</h3><dl class="enq-context" id="enq-context"></dl>' +
      '<p class="enq-to">This explorer is a student resource from WSLSA and is not endorsed by the School of Law of Western Sydney University. If you get stuck, contact the Law Enquiry Team at <a href="mailto:' + LAW_ENQUIRY + '">' + LAW_ENQUIRY + '</a> or your Academic Program Advisor.</p>' +
      '<div class="enq-actions"><a class="tbtn tbtn-primary" id="enq-email" data-action="enq-email" href="mailto:' + LAW_ENQUIRY + '">Email School of Law →</a>' +
      '<button type="button" class="tbtn tbtn-outline" data-action="enq-copy">Copy Email Draft</button>' +
      '<button type="button" class="tbtn tbtn-outline" data-action="print" title="Save your guide as a PDF, then attach it to your email">Save PDF to Attach</button></div></div>';
  }
  function syncEnquiry(ctx) {
    const law = lawCP(ctx);
    const under = law < 80;
    $('#enq-badge').textContent = (under ? '< 80' : '≥ 80') + ' Law CP';
    $('#enq-badge').title = 'You have ticked ' + law + ' CP of Law subjects';
    $('#enq-status').textContent = 'You have ticked ' + law + ' CP of Law subjects (' + (under ? 'under 80 CP' : '80 CP or more') + '). ' + (under ? TRANSITION_NOTE.under : TRANSITION_NOTE.over);
    const facts = enquiryFacts(ctx);
    $('#enq-context').innerHTML = facts.map(function (f) { return '<dt>' + f[0] + '</dt><dd>' + esc(f[1]) + '</dd>'; }).join('') + '<dt>Plan link</dt><dd>Your live share link</dd>';
  }
  function enquiryFacts(ctx) {
    const chosen = ctx.slots.filter(function (s) { return !s.pending && s.chosen; });
    return [
      ['Degree', ctx.deg.code + ' ' + ctx.deg.title],
      ['Major or minor', ctx.opt.majorCode !== 'BASE' ? ctx.opt.majorLabel : 'None'],
      ['Completed', ctx.doneCP + ' of ' + ctx.deg.cp + ' CP, including ' + lawCP(ctx) + ' CP of Law subjects'],
      ['Chosen alternates', chosen.length ? chosen.slice(0, 12).map(function (s) { return s.code + ' ' + s.title + ' (' + shownWhere(ctx, s) + ')'; }).join('; ') + (chosen.length > 12 ? '; and ' + (chosen.length - 12) + ' more' : '') : 'None yet'],
    ];
  }
  function enquiryDraft() {
    const ctx = lastCtx;
    const topic = ENQ_TOPICS.find(function (t) { return t.id === ui.enqTopic; }) || ENQ_TOPICS[0];
    const lines = ['Dear School of Law,', '', topic.ask, '', 'My plan:'];
    enquiryFacts(ctx).forEach(function (f) { lines.push(f[0] + ': ' + f[1]); });
    lines.push('Plan link: ' + planUrl(), '', 'Name: ', 'Student ID: ');
    return { to: LAW_ENQUIRY, subject: topic.subject + ': ' + ctx.deg.code + ' ' + ctx.deg.title, body: lines.join('\n') };
  }
  function enquiryMailto() {
    const d = enquiryDraft();
    return 'mailto:' + d.to + '?subject=' + encodeURIComponent(d.subject) + '&body=' + encodeURIComponent(d.body.replace(/\n/g, '\r\n'));
  }
  function setEnquiryOpen(open) {
    ui.enqOpen = open;
    $('#enq-card').hidden = !open;
    $('.enq-pill').setAttribute('aria-expanded', String(open));
    $('#enq-caret').textContent = open ? '▾' : '▴';
    document.body.classList.toggle('enq-is-open', open);
  }

  // ======================================================================== dark mode
  const THEME_KEY = 'wslsa-2027-theme';
  function currentTheme() { return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'; }
  function syncTheme() {
    const dark = currentTheme() === 'dark';
    document.querySelectorAll('[data-action="theme-toggle"]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(dark));
      b.querySelector('.theme-label').textContent = dark ? 'Light mode' : 'Dark mode';
    });
    $('meta[name="theme-color"]').setAttribute('content', dark ? '#1A191E' : '#7D0028');
  }
  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    writeStored(THEME_KEY, theme);
    syncTheme();
  }

  // ======================================================================== guided tour
  // Optional. It is only offered to someone with nothing saved who did not arrive by a plan link, and it
  // can always be started from the masthead. It never changes the plan.
  const TOUR_KEY = 'wslsa-2027-tour-dismissed';
  const TOUR_STEPS = [
    { title: 'Choose your degree', text: 'Start here. Pick your degree and, if it has one, your major or minor. Campus highlight shows what runs at your campus, and Full-time or Part-time changes how your plan is laid out.', targets: ['#dock'], top: true },
    { title: 'Key facts and progress', text: 'The pills in the banner show the credit points your degree requires, when you are on track to finish and the official 2027 Handbook. The progress bar counts the credit points you have ticked off.', targets: ['#hero-meta', '#dock .progress'], top: true },
    { title: 'Pathway Advisory', text: 'This bar checks your plan for you: subjects whose 2027 sessions are not published yet (TBC), subjects that do not run at your campus, and prerequisite notes. Press View details to read them.', targets: ['#advisory'] },
    { title: 'Next to enrol', text: 'This is your next session. Copy Codes gives you the subject codes for MySR and Export .ics saves a calendar reminder. Already studying? Import my progress rebuilds your plan from a PDF, and Tick off from my results ticks subjects from text you paste.', targets: ['#next'] },
    { title: 'Plan tools', text: 'Undo and Redo step through your changes (' + UNDO_KEYS + ' and ' + REDO_KEYS + '). Re-Pace / Switch Load changes your load for the rest of your degree, with a Leave of Absence, a Spring start and Fast-Track. Plan Tools holds Auto-fill, Pin Snapshot, Simulate Degree Transfer and your own custom plan.', targets: ['#section-tools'] },
    { title: 'Filter bar and degree map', text: 'Show everything, only what remains, or only what needs action. Type in the box, or press /, to filter your plan by code or title. The degree map shows every session, stays on screen as you scroll and jumps to a session when you press it.', targets: ['#gridbar', '#dmap'] },
    { title: 'Subject cards', text: 'Tick a subject when you pass it. Press Edit on a card for its tools: Change swaps the subject, Move to sends it to any session, Chain shows what it depends on and unlocks, Defer ↷ moves it to the next session it runs in, and Remove × takes it out. Open slots let you pick an LLB Alternate, and you can drag one subject onto another to swap them.', targets: ['#grid .subj'], fallback: '#grid' },
    { title: 'Degree details and catalogue', text: 'Credit breakdown, admission, accreditation and exit awards are here. In the subject catalogue tab, + Assign puts a subject straight into an open slot in your plan.', targets: ['#details'] },
    { title: 'Law Enquiry and your PDF', text: 'The Law Enquiry box in the corner holds the School of Law\'s 2027 advice and drafts an email to the School with your plan attached as a link. Print / Save PDF, at the top of the page or in the Menu, saves a sharp A4 guide of your plan, and PDF Options under More sets it up.', targets: ['#enquiry-box'], also: '[data-action="print"]', top: true, corner: true },
  ];
  function showsOnPage(el) { return !!el && el.getClientRects().length > 0; }
  function tourElements(step) {
    const out = [];
    step.targets.forEach(function (sel) {
      const el = Array.from(document.querySelectorAll(sel)).find(showsOnPage);
      if (el) out.push(el);
    });
    if (!out.length && step.fallback && showsOnPage($(step.fallback))) out.push($(step.fallback));
    return out;
  }
  // targets far apart on this screen size (the facts follow the plan on a phone) light up only the first
  function tourRect(els) {
    let box = null;
    els.forEach(function (el) {
      const r = el.getBoundingClientRect();
      if (!box) { box = { top: r.top, left: r.left, right: r.right, bottom: r.bottom }; return; }
      if (r.top - box.bottom > 160 || box.top - r.bottom > 160) return;
      box = { top: Math.min(box.top, r.top), left: Math.min(box.left, r.left), right: Math.max(box.right, r.right), bottom: Math.max(box.bottom, r.bottom) };
    });
    return box;
  }
  function tourScroll(step, els) {
    if (step.top) { window.scrollTo(0, 0); return; }
    const box = tourRect(els);
    if (!box) return;
    const sticky = window.innerWidth > 1040 ? $('#dock-wrap').getBoundingClientRect().height + (els[0].closest('.plan-body') && els[0].id !== 'gridbar' ? 50 : 0) : els[0].closest('#grid') ? 50 : 0;
    const under = window.innerWidth <= 760 ? $('.tour-card').getBoundingClientRect().height + 32 : 0;
    const room = window.innerHeight - sticky - under;
    const h = box.bottom - box.top;
    const y = box.top + window.scrollY - sticky - (h < room ? Math.max(16, (room - h) / 2) : 16);
    window.scrollTo(0, Math.max(0, y));
  }
  function tourPlace() {
    const t = ui.tour;
    if (!t) return;
    const box = tourRect(t.els);
    const spot = $('.tour-spot');
    if (box) {
      const css = { top: box.top - 6, left: box.left - 6, width: box.right - box.left + 12, height: box.bottom - box.top + 12 };
      Object.keys(css).forEach(function (k) { spot.style[k] = Math.round(css[k]) + 'px'; });
    }
    if (t.clone && showsOnPage(t.cloneOf)) {
      const r = t.cloneOf.getBoundingClientRect();
      t.clone.style.top = r.top + 'px';
      t.clone.style.left = r.left + 'px';
      t.clone.style.width = r.width + 'px';
      t.clone.style.height = r.height + 'px';
    }
    const card = $('.tour-card');
    card.style.bottom = window.innerWidth <= 760 && box && TOUR_STEPS[t.at].corner ? Math.round(window.innerHeight - box.top + 16) + 'px' : '';
    if (window.innerWidth <= 760 || !box) { card.style.top = ''; card.style.left = ''; return; }
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const left = Math.max(16, Math.min(box.left, vw - w - 16));
    let top;
    if (box.bottom + 16 + h + 16 <= vh) top = box.bottom + 16;
    else if (box.top - 16 - h >= 16) top = box.top - 16 - h;
    else top = vh - h - 16;
    // beside a target in the corner rather than over it
    const side = step0Side(box, w, h, vw, vh, top);
    card.style.top = Math.round(side ? side.top : top) + 'px';
    card.style.left = Math.round(side ? side.left : left) + 'px';
  }
  function step0Side(box, w, h, vw, vh, top) {
    if (top + h <= box.top || top >= box.bottom) return null;
    if (box.right + 16 + w + 16 <= vw) return { top: Math.max(16, Math.min(box.top, vh - h - 16)), left: box.right + 16 };
    if (box.left - 16 - w >= 16) return { top: Math.max(16, Math.min(box.top, vh - h - 16)), left: box.left - 16 - w };
    return null;
  }
  function tourFrame() {
    if (!ui.tour) return;
    tourPlace();
    ui.tour.raf = requestAnimationFrame(tourFrame);
  }
  function tourClearStep() {
    const t = ui.tour;
    document.querySelectorAll('.tour-target').forEach(function (el) { el.classList.remove('tour-target'); });
    if (t.clone) { t.clone.remove(); t.clone = null; t.cloneOf = null; }
  }
  function tourGo(i) {
    const t = ui.tour;
    if (!t || i < 0) return;
    if (i >= TOUR_STEPS.length) { endTour(); return; }
    tourClearStep();
    t.at = i;
    const step = TOUR_STEPS[i];
    $('#tour-count').textContent = 'Step ' + (i + 1) + ' of ' + TOUR_STEPS.length;
    $('#tour-fill').style.width = ((i + 1) / TOUR_STEPS.length * 100) + '%';
    $('#tour-title').textContent = step.title;
    $('#tour-text').textContent = step.text;
    $('[data-action="tour-back"]').disabled = i === 0;
    $('[data-action="tour-next"]').textContent = i === TOUR_STEPS.length - 1 ? 'Finish' : 'Next →';
    t.els = tourElements(step);
    t.els.forEach(function (el) { el.classList.add('tour-target'); });
    if (step.also) {
      const other = $(step.also);
      if (showsOnPage(other)) {
        t.cloneOf = other;
        t.clone = other.cloneNode(true);
        t.clone.removeAttribute('data-action');
        t.clone.removeAttribute('title');
        t.clone.setAttribute('aria-hidden', 'true');
        t.clone.tabIndex = -1;
        t.clone.classList.add('tour-clone');
        $('#tour').appendChild(t.clone);
      }
    }
    tourScroll(step, t.els);
    tourPlace();
    if (document.activeElement && document.activeElement.disabled) $('[data-action="tour-next"]').focus();
  }
  function startTour(opener) {
    if (ui.tour) return;
    if (ui.modal) closeModal(true);
    hideTourPrompt(true);
    ui.tour = { at: 0, els: [], opener: opener || null, enqBefore: ui.enqOpen, raf: 0, clone: null, cloneOf: null };
    // an open box would sit over whatever each step lights up
    if (ui.enqOpen) setEnquiryOpen(false);
    $('#app').inert = true;
    $('#tour').hidden = false;
    tourGo(0);
    $('[data-action="tour-next"]').focus({ preventScroll: true });
    ui.tour.raf = requestAnimationFrame(tourFrame);
  }
  function endTour() {
    const t = ui.tour;
    if (!t) return;
    cancelAnimationFrame(t.raf);
    tourClearStep();
    ui.tour = null;
    $('#tour').hidden = true;
    $('#app').inert = false;
    if (t.enqBefore) setEnquiryOpen(true);
    if (t.opener && t.opener.isConnected && showsOnPage(t.opener)) t.opener.focus({ preventScroll: true });
    else if (t.opener && t.opener.closest && t.opener.closest('#top-actions')) $('.top-menu-btn').focus({ preventScroll: true });
  }
  function tourKey(ev) {
    if (ev.key === 'Escape') { ev.preventDefault(); endTour(); return; }
    if (ev.key === 'ArrowRight') { ev.preventDefault(); tourGo(ui.tour.at + 1); return; }
    if (ev.key === 'ArrowLeft') { ev.preventDefault(); tourGo(ui.tour.at - 1); return; }
    if (ev.key === 'Tab') {
      const items = Array.from(document.querySelectorAll('.tour-card button')).filter(function (b) { return !b.disabled; });
      const at = items.indexOf(document.activeElement);
      ev.preventDefault();
      items[(at + (ev.shiftKey ? -1 : 1) + items.length) % items.length].focus();
    }
  }
  function hideTourPrompt(remember) {
    $('#tour-prompt').hidden = true;
    document.body.classList.remove('has-tour-prompt');
    if (remember) writeStored(TOUR_KEY, '1');
  }
  // read before the first render, which saves a plan: anything already here means this is not a first visit
  function tourMayAsk() {
    if (location.search.length > 1 || location.hash.length > 1) return false;
    try { return localStorage.getItem(STORE_KEY) === null && localStorage.getItem(TOUR_KEY) === null; } catch (e) { return false; }
  }

  // ======================================================================== plan backup
  const BACKUP_APP = 'wslsa-2027-pathway-explorer';
  const BACKUP_MAX = 2000000;
  function downloadBackup() {
    const data = { app: BACKUP_APP, version: 1, savedAt: new Date().toISOString(), state: state, pinned: ui.pin || null };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'wslsa-plan-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('Plan backup saved. Drop it on Import my progress to restore everything.');
  }
  function restoreBackup(file) {
    const fail = function () { progressStatus('That file is not a plan backup from this explorer. Use the .json file saved by Download Plan Backup.', 'error'); };
    if (file.size > BACKUP_MAX) { fail(); return; }
    ui.progress = null;
    renderProgress();
    file.text().then(function (text) {
      const data = JSON.parse(text);
      if (!data || data.app !== BACKUP_APP || !data.state || typeof data.state !== 'object') { fail(); return; }
      noteChange('restored a plan backup');
      // everything in the file goes through the same checks as a saved plan or a share link
      state = sanitise(data.state);
      const pin = data.pinned;
      if (pin && Array.isArray(pin.subjects) && typeof pin.finish === 'string') { ui.pin = pin; writePin(); }
      ui.folded = null;
      ui.viewFold = {};
      document.querySelectorAll('.view-modes button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.view === state.view)); });
      closeModal(true);
      renderEntering();
      toast('Plan restored from your backup.', { action: 'undo', label: 'Undo' });
    }).catch(fail);
  }
  const CREST = '<span class="crest-img pd-crest" role="img" aria-label="WSLSA crest"></span>';
  const FOOT_LINE = '© 2026 Western Sydney Law Students\' Association Inc. <i>·</i> Building EK, Parramatta South Campus <i>·</i> By students, for students';

  function renderFoot(ctx) {
    $('#site-foot').innerHTML = '<span class="foot-watermark crest-rev" aria-hidden="true"></span><div class="foot-inner">' +
      '<div class="foot-brand"><span class="crest-rev foot-crest" role="img" aria-label="WSLSA crest"></span><div><p class="foot-sub">Western Sydney</p><p class="foot-name">Law Students\' Association</p><p class="foot-tag">Est. 1996 · By students, for students</p></div></div>' +
      '<div class="foot-col"><h2>Your plan</h2><p>Choices and progress are saved in this browser only and are never uploaded. To continue on another phone or computer, use Copy Share Link and open that link there.</p>' +
      '<div class="foot-links"><a href="' + esc(ctx.deg.handbook) + '" target="_blank" rel="noopener">Official 2027 Handbook →</a><a href="mailto:' + LAW_ENQUIRY + '">Email the Law Enquiry Team →</a><a href="https://wslsa.com.au/" target="_blank" rel="noopener">wslsa.com.au →</a></div></div>' +
      '<div class="foot-col"><h2>Disclaimer</h2><p>' + esc(disclaimerText()) + '</p></div>' +
      '</div><div class="foot-base">' + FOOT_LINE + '</div>';
  }

  // an edited pathway, or the student's own plan copied from one, can go back to the WSLSA order
  function canResetSequence(ctx) { return !!(ctx.edit || (isCustom() && ctx.plan.tpl && !ctx.plan.start)); }
  function renderSectionHead(ctx) {
    $('#section-kicker').innerHTML = (ctx.edit ? 'Your edited pathway' : ctx.custom ? 'Custom pathway' : 'Recommended pathway') + ' <i>·</i> 2027';
    const item = function (action, label, title, off) { return '<button type="button" class="tbtn pop-item" data-action="' + action + '"' + (title ? ' title="' + esc(title) + '"' : '') + (off ? ' disabled' : '') + '>' + label + '</button>'; };
    $('#section-tools').innerHTML = '<div class="tool-group tool-group-history">' + historyButtons() + '</div>' +
      '<button type="button" class="tbtn tbtn-primary" data-action="repace-open" title="Change your load for the rest of your degree, take a session off, start in Spring or finish earlier">Re-Pace / Switch Load</button>' +
      '<div class="pop plan-tools"><button type="button" class="tbtn pop-btn" data-action="pop-toggle" aria-expanded="false" aria-controls="plan-tools-menu">Plan Tools</button><div class="pop-menu" id="plan-tools-menu" hidden>' +
      suggestItem(ctx) + pinItems() + item('transfer-open', 'Simulate Degree Transfer', 'See how your completed subjects would count in another degree') +
      (ctx.custom && (ctx.plan.skip || []).length ? item('guide-restore', 'Restore Dismissed Suggestions', 'Bring back the ' + plural(ctx.plan.skip.length, 'suggestion') + ' you dismissed from the Suggested Remaining Guide') : '') +
      ((ctx.custom ? ctx.tdeg : true) ? item('handbook-compare', 'Compare Handbooks', 'See what you would still need under the pre-2027 and the 2027 Handbook, side by side') : '') +
      '<span class="pop-sep"></span>' + (canResetSequence(ctx) ? item('reset-sequence', 'Reset to Default Sequence', 'Put back the WSLSA order and subjects, keeping your ticks') : '') + (isCustom()
        ? item('custom-setup', 'Custom Plan Setup', 'Change the degree name, credit points or starting template') +
          item('custom-exit', '← WSLSA Pathways', 'Your custom plan is kept; switch back any time from the Degree menu')
        : item('custom-from-current', 'Customise This Pathway', 'Copy this pathway into your own editable plan') +
          (state.custom ? item('custom-open', 'Open My Custom Plan', 'Switch to your saved custom plan') : item('custom-open', 'Build My Own', 'Set the credit points and build a degree from scratch'))) +
      '<span class="pop-sep"></span>' + item('reset', 'Reset Plan', isCustom() ? 'Clear your custom plan and rebuild it' : 'Clear choices, changes and progress for this pathway') + '</div></div>';
    syncHistoryButtons();
  }

  // ======================================================================== motion
  // Every flourish checks this first: a student who asks for reduced motion gets instant updates.
  function motionOK() { return !window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  function scrollMode() { return motionOK() ? 'smooth' : 'auto'; }
  function setHTML(el, html) {
    if (el._html === html) return false;
    el._html = html;
    el.innerHTML = html;
    return true;
  }
  // Runs a change that rebuilds part of the page inside a view transition, where the browser has one, so
  // old and new cross-fade. With cards on, each subject card also glides to its new place (the names
  // the transition needs are switched on only while it runs). Other browsers just make the change.
  let cardMoves = 0;
  function transition(change, cards) {
    if (!motionOK() || !document.startViewTransition) { change(); return; }
    const root = document.documentElement;
    if (cards) { cardMoves++; root.classList.add('vt-cards'); }
    const vt = document.startViewTransition(change);
    const finish = function () { if (cards && --cardMoves === 0) root.classList.remove('vt-cards'); };
    vt.finished.then(finish, finish);
    vt.ready.catch(function () { /* a skipped transition is not an error */ });
  }
  function renderMoving(after) { transition(function () { render(); if (after) after(); }, true); }
  // A new degree or major: the cards on screen settle in one after another, and the rest appear at once.
  function renderEntering() {
    render();
    if (!motionOK()) return;
    const grid = $('#grid');
    let i = 0;
    grid.querySelectorAll('.year, .subj').forEach(function (el) {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--i', r.top < window.innerHeight && r.bottom > 0 ? Math.min(i++, 16) : 0);
    });
    grid.classList.remove('is-entering');
    void grid.offsetWidth;
    grid.classList.add('is-entering');
    clearTimeout(ui.enterTimer);
    ui.enterTimer = setTimeout(function () { grid.classList.remove('is-entering'); }, 1000);
  }
  function countTo(el, from, to) {
    if (!el) return;
    const token = el._count = {};
    if (from === to || !motionOK()) { el.textContent = to; return; }
    const start = performance.now();
    el.textContent = from;
    requestAnimationFrame(function step(now) {
      if (el._count !== token) return;
      const t = Math.min(1, Math.max(0, now - start) / 450);
      el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - t, 3)));
      if (t < 1) requestAnimationFrame(step);
    });
  }
  function glowBars() {
    if (!motionOK()) return;
    document.querySelectorAll('.bar').forEach(function (b) {
      b.classList.remove('glow');
      void b.offsetWidth;
      b.classList.add('glow');
    });
  }
  function progressPct(ctx) { return ctx.deg.cp ? Math.min(100, Math.round(ctx.doneCP / ctx.deg.cp * 100)) : 0; }
  // brings the credit point numbers and bars from what was last shown to what is true now
  function showCounters(ctx) {
    const shown = ui.shown;
    const pct = progressPct(ctx);
    ui.shown = { done: ctx.doneCP, cp: ctx.deg.cp, pct: pct };
    countTo($('#progress-num .num'), shown ? shown.done : ctx.doneCP, ctx.doneCP);
    countTo($('#hero-meta .hp-cp .num'), shown ? shown.cp : ctx.deg.cp, ctx.deg.cp);
    const bar = $('#dock .bar');
    bar.setAttribute('aria-valuenow', ctx.doneCP);
    const fill = bar.firstElementChild;
    if (shown && shown.pct !== pct && motionOK()) {
      fill.style.transition = 'none';
      fill.style.width = shown.pct + '%';
      void fill.offsetWidth;
      fill.style.transition = '';
    }
    fill.style.width = pct + '%';
    $('#mini-num').innerHTML = '<b>' + ctx.doneCP + '</b> / ' + ctx.deg.cp + ' CP';
    $('#mini-fill').style.width = pct + '%';
    $('#mini-track').setAttribute('aria-valuemax', ctx.deg.cp);
    $('#mini-track').setAttribute('aria-valuenow', ctx.doneCP);
    if (shown && pct === 100 && shown.pct < 100) glowBars();
  }
  function afterRender(ctx) {
    showCounters(ctx);
    watchYears();
    ui.xrayHover = '';
    if (ui.xrayPin && ctx.byId[ui.xrayPin]) xrayShow(ui.xrayPin);
    else { ui.xrayPin = ''; xrayClear(); }
    restoreFocus();
  }

  // ---- ticking a subject off changes the card in place, so its checkbox spring, strike-through and fade
  // can play, and updates only the numbers and panels that depend on it
  // The dock's Handbook choice: a WSLSA pathway is shown in that structure, and a plan is moved to it.
  function setCohort(cohort) {
    cohort = cohort === 'pre2027' ? 'pre2027' : '2027';
    const plan = editPlan();
    const pre = cohort === 'pre2027';
    if (cohort === (plan ? cohortOf(plan) : guideCohort(currentKey()))) return;
    noteChange('switched to the ' + (pre ? 'pre-2027' : '2027') + ' structure');
    if (plan) {
      plan.cohort = cohort === startCohort(plan.start) ? '' : cohort;
      if (plan.tpl) {
        // the plan's subjects and what it still needs both move to the structure
        plan.slots = restructure(plan.tpl, plan.slots, cohort, plan.start);
        plan.need = restructureNeed(plan, cohort);
      }
    }
    // a WSLSA pathway remembers the choice with or without an edited copy, so resetting it shows the same structure
    if (!isCustom()) {
      if (pre) state.cohortFor[currentKey()] = 'pre2027'; else delete state.cohortFor[currentKey()];
    }
    ui.folded = null;
    renderMoving();
    // a core subject the plan has no open LLB Alternate slot to give back is not dropped quietly: the guide lists it
    const used = {};
    if (plan) plan.slots.forEach(function (x) { if (x.code) used[x.code] = 1; });
    const missing = pre || !plan || !plan.tpl || plan.need.length ? [] : Object.keys(structureRows(plan.tpl).core).filter(function (code) { return !used[code]; });
    toast(pre
      ? 'Showing the pre-2027 structure: LAWS 2019, LAWS 3099 and LAWS 3102 are LLB Alternate slots, and each 2027 subject that replaces a pre-2027 one says which.'
      : 'Showing the 2027 structure: LAWS 2019, LAWS 3099 and LAWS 3102 are core subjects, in place of three LLB Alternate slots.' + (missing.length ? ' Your plan has no open LLB Alternate slot to give ' + missing.join(' or ') + ', so the Suggested Remaining Guide lists ' + (missing.length === 1 ? 'it' : 'them') + ' to add.' : ''), { action: 'undo', label: 'Undo' });
  }
  // Move ▾ on a card: any session of the plan, or a new year
  function quickMove(slotId, value) {
    const v = value.split('|');
    const y = +v[0];
    const sess = v[1];
    // the copy is made first, as it replaces the context the slot is looked up in
    const sid = ensureEditable(slotId);
    const s = lastCtx.byId[sid];
    if (!s || (s.year === y && s.session === sess)) return;
    const issue = offerIssue(lastCtx, s, sess);
    noteChange('moved ' + (s.pending ? 'an open slot' : s.code) + ' to Year ' + y + ' ' + sess);
    const id = moveCustomSlot(s.idx, y, sess);
    renderMoving(function () { flashSlot(id, true); });
    toast((s.pending ? 'Open slot' : s.code) + ' moved to Year ' + y + ' ' + sess + (issue ? '. Check: ' + issue : '') + '.', { action: 'undo', label: 'Undo' });
  }
  // Puts back the WSLSA order and subjects of the pathway a plan is based on, keeping ticks, and choices where the
  // pathway has the same choice.
  function resetSequence() {
    if (!isCustom()) {
      const key = currentKey();
      const e = state.edits[key];
      if (!e) return null;
      delete state.edits[key];
      if (cohortOf(e) === 'pre2027') state.cohortFor[key] = 'pre2027'; else delete state.cohortFor[key];
      const picks = {};
      PATH[key].forEach(function (r) {
        const x = e.slots.find(function (y) { return y.o === r.id && y.code && !y.done; });
        // a slot standing in for a core subject new in 2027 keeps the LLB Alternate chosen for it
        const stand = isNewCore(r) && cohortOf(e) === 'pre2027' && !!x && x.code !== r.code;
        if (!x || (r.kind === 'fixed' && !stand) || (r.kind === 'option' && x.code === r.code)) return;
        const k = GLOBAL_BY_CODE[x.code] || EXTRA_BY_CODE[x.code];
        picks[r.id] = k ? { code: x.code, title: k.title } : { code: x.code, title: x.title, custom: true };
      });
      state.picks[key] = sanitisePicks(key, picks);
      state.done[key] = {};
      const completed = e.slots.filter(function (x) { return x.done && x.code; }).map(function (x) {
        const k = GLOBAL_BY_CODE[x.code] || EXTRA_BY_CODE[x.code];
        return { code: x.code, title: k ? k.title : x.title, cp: x.cp, custom: !k };
      });
      const t = transferTo(key, completed, true);
      writeTransfer(key, t);
      return { kept: t.matched.length + t.chosen.length + t.electives.length };
    }
    const plan = state.custom;
    const old = plan.slots;
    plan.slots = restructure(plan.tpl, templateSlots(plan.tpl, false), cohortOf(plan));
    plan.pace = 0;
    plan.years = 0;
    plan.need = [];
    plan.skip = [];
    const taken = {};
    let kept = 0;
    old.filter(function (x) { return x.code; }).forEach(function (x) {
      let i = plan.slots.findIndex(function (y, j) { return !taken[j] && y.code && sameAs(x.code).indexOf(y.code) >= 0; });
      if (i < 0) i = plan.slots.findIndex(function (y, j) { return !taken[j] && !y.code && y.o && y.o === x.o; });
      if (i < 0) return;
      taken[i] = 1;
      if (x.done) kept++;
      plan.slots[i] = Object.assign({}, plan.slots[i], { code: x.code, title: x.title, done: x.done });
    });
    return { kept: kept };
  }
  function setDone(id, on) {
    const plan = editPlan();
    if (plan) { plan.slots[lastCtx.byId[id].idx].done = on; return; }
    const key = currentKey();
    state.done[key] = state.done[key] || {};
    if (on) state.done[key][id] = 1; else delete state.done[key][id];
  }
  function yearsDone(ctx) {
    const out = {};
    timeline(ctx, state.load).forEach(function (y) {
      const all = y.Autumn.concat(y.Spring, y.Summer);
      out[y.year] = all.length > 0 && all.every(function (s) { return s.done; });
    });
    return out;
  }
  function refreshDone(ids) {
    const sessBefore = sessionsDone(lastCtx);
    const cpBefore = lastCtx.doneCP;
    const before = yearsDone(lastCtx);
    const nextWas = nextSession(lastCtx);
    const ctx = buildContext();
    lastCtx = ctx;
    ids.forEach(function (id) {
      const s = ctx.byId[id];
      const el = document.getElementById('slot-' + id);
      if (!s || !el) return;
      el.classList.toggle('is-done', s.done);
      el.classList.toggle('just-done', s.done);
      el.classList.toggle('offcampus', !!(state.campus && ctx.risks.campus.indexOf(s) >= 0));
      el.querySelector('.tick input').checked = s.done;
      el.querySelector('.subj-meta').innerHTML = '<span class="cat">' + esc(s.typeLabel) + '</span>' + slotFlags(s, ctx);
      el.querySelector('.subj-side .pills').innerHTML = slotOffer(s, ctx);
      el.querySelector('.subj-edit').innerHTML = slotTools(s, ctx);
    });
    const after = yearsDone(ctx);
    timeline(ctx, state.load).forEach(function (y) {
      const box = document.getElementById('year-' + y.year);
      if (!box) return;
      const all = y.Autumn.concat(y.Spring, y.Summer);
      box.querySelector('.year-cp .done').textContent = sumCP(all, true) + ' / ' + sumCP(all) + ' CP completed';
      PLAN_SESSIONS.forEach(function (sess) {
        const section = box.querySelector('.session[data-s="' + sess + '"]');
        if (!section) return;
        const button = section.querySelector('[data-action="session-done"]');
        if (button) button.textContent = y[sess].length && y[sess].every(function (s) { return s.done; }) ? 'Unmark all' : 'Mark all done';
        section.querySelector('.commute-slot').innerHTML = commutePill(y[sess]);
        section.querySelector('.load-slot').innerHTML = loadPill(y[sess]);
      });
      if (after[y.year] && !before[y.year] && motionOK()) {
        const bar = box.querySelector('.year-bar');
        bar.classList.remove('year-glow');
        void bar.offsetWidth;
        bar.classList.add('year-glow');
        glowBars();
      }
    });
    $('#progress-meta').textContent = progressMeta(ctx);
    renderMap(ctx);
    applyGridFilter(true);
    syncEnquiry(ctx);
    renderAdvisory(ctx);
    renderTracker(ctx);
    const next = $('#next');
    renderNext(ctx);
    const nextNow = nextSession(ctx);
    const moved = (nextWas ? nextWas.year + nextWas.session : '') !== (nextNow ? nextNow.year + nextNow.session : '');
    if (moved && motionOK()) {
      next.classList.remove('is-changed');
      void next.offsetWidth;
      next.classList.add('is-changed');
    }
    showCounters(ctx);
    syncStructure(ctx);
    syncStage(ctx);
    applyTrack();
    const sessNow = sessionsDone(ctx);
    Object.keys(sessNow).forEach(function (k) {
      if (!sessNow[k] || sessBefore[k]) return;
      const v = k.split('|');
      celebrate(document.querySelector('#year-' + v[0] + ' .session[data-s="' + v[1] + '"] .session-head'));
    });
    Object.keys(after).forEach(function (y) { if (after[y] && !before[y]) celebrate(document.querySelector('#year-' + y + ' .year-bar')); });
    if (ctx.deg.cp && ctx.doneCP >= ctx.deg.cp && cpBefore < ctx.deg.cp) {
      confetti();
      toast('Degree complete: all ' + ctx.deg.cp + ' CP mapped and completed. Congratulations.');
    }
    saveState();
  }

  // ======================================================================== prerequisite chain
  // Only what has a source is shown as a rule: the 2027 Handbook entries in data/prerequisites.json and the
  // workbook's advisor notes. Its general sequences are labelled Usually first and Usually after instead.
  const REQUIRES = {};
  const REQUIRED_BY = {};
  const REQ_GROUPS = {};
  // a pre-2027 subject meets what its 2027 replacement meets, and the other way round
  function addRequirement(code, group, source) {
    const wide = [];
    group.forEach(function (p) { sameAs(p).forEach(function (q) { if (wide.indexOf(q) < 0) wide.push(q); }); });
    sameAs(code).forEach(function (c) {
      (REQ_GROUPS[c] = REQ_GROUPS[c] || []).push(wide);
      wide.forEach(function (p) {
        (REQUIRES[c] = REQUIRES[c] || []).push({ code: p, source: source });
        (REQUIRED_BY[p] = REQUIRED_BY[p] || []).push({ code: c, source: source });
      });
    });
  }
  Object.keys(PREREQS.subjects).forEach(function (code) {
    PREREQS.subjects[code].requires.forEach(function (group) { addRequirement(code, group, PREREQS.subjects[code].source); });
  });
  const NOTED = {};
  DEGREES.forEach(function (d) {
    d.advisorNotes.forEach(function (n) {
      const k = n.subject + '<' + n.prereq;
      if (!n.subject || !n.prereq || NOTED[k]) return;
      NOTED[k] = 1;
      addRequirement(n.subject, [n.prereq], 'WSLSA advisor note');
    });
  });
  // the general order takes a pre-2027 subject in place of the 2027 subject that replaced it
  PREREQS.sequences.forEach(function (seq) {
    seq.first = seq.first.reduce(function (all, c) { sameAs(c).forEach(function (q) { if (all.indexOf(q) < 0) all.push(q); }); return all; }, []);
  });
  function followsSequence(code, seq) { return code.indexOf(seq.then.area + ' ') === 0 && seq.then.levels.indexOf(+code.charAt(5)) >= 0; }
  // what a subject leads back to and on to, across the whole chain, limited to subjects in this plan
  function chainOf(code, ctx) {
    const walk = function (map) {
      const seen = {};
      const stack = [code];
      while (stack.length) {
        (map[stack.pop()] || []).forEach(function (e) {
          if (seen[e.code]) return;
          seen[e.code] = e.source;
          stack.push(e.code);
        });
      }
      return seen;
    };
    const up = walk(REQUIRES);
    const down = walk(REQUIRED_BY);
    const first = {};
    const then = {};
    PREREQS.sequences.forEach(function (seq) {
      if (seq.first.indexOf(code) >= 0) Object.keys(ctx.used).forEach(function (c) { if (c !== code && followsSequence(c, seq)) then[c] = 1; });
      else if (followsSequence(code, seq)) seq.first.forEach(function (c) { first[c] = 1; });
    });
    const inPlan = function (o, not) { return Object.keys(o).filter(function (c) { return ctx.used[c] && !(not && not[c]); }); };
    const c = { up: inPlan(up), down: inPlan(down), first: inPlan(first, up), then: inPlan(then, down), sources: {} };
    c.up.forEach(function (x) { c.sources[up[x]] = 1; });
    c.down.forEach(function (x) { c.sources[down[x]] = 1; });
    c.count = c.up.length + c.down.length + c.first.length + c.then.length;
    return c;
  }
  function xrayClear() {
    const grid = $('#grid');
    if (grid.classList.contains('is-xray')) {
      grid.classList.remove('is-xray');
      grid.querySelectorAll('.xray-self, [data-xray]').forEach(function (el) { el.classList.remove('xray-self'); el.removeAttribute('data-xray'); });
    }
    $('#xray-note').hidden = true;
    document.querySelectorAll('.chain-btn[aria-pressed="true"]').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
  }
  function xrayShow(id) {
    xrayClear();
    const ctx = lastCtx;
    const s = ctx.byId[id];
    const c = s && !s.pending && s.code ? chainOf(s.code, ctx) : null;
    if (!c || !c.count) return;
    const labels = {};
    c.then.forEach(function (x) { labels[x] = 'Usually after'; });
    c.first.forEach(function (x) { labels[x] = 'Usually first'; });
    c.down.forEach(function (x) { labels[x] = 'Unlocks'; });
    c.up.forEach(function (x) { labels[x] = 'Prerequisite'; });
    $('#grid').classList.add('is-xray');
    $('#grid').querySelectorAll('.subj').forEach(function (el) {
      const o = ctx.byId[el.dataset.slot];
      if (!o || o.pending) return;
      if (o.code === s.code) el.classList.add('xray-self');
      else if (labels[o.code]) el.setAttribute('data-xray', labels[o.code]);
    });
    if (ui.xrayPin === id) {
      const b = document.querySelector('#slot-' + id + ' .chain-btn');
      if (b) b.setAttribute('aria-pressed', 'true');
    }
    const parts = [];
    if (c.up.length) parts.push('Needs ' + c.up.join(', ') + ' (' + Object.keys(c.sources).join(', ') + ').');
    if (c.down.length) parts.push('Unlocks ' + c.down.join(', ') + '.');
    if (c.first.length) parts.push('Usually after ' + c.first.join(', ') + '.');
    if (c.then.length) parts.push('Usually taken before ' + plural(c.then.length, 'later law subject') + '.');
    if (c.first.length || c.then.length) parts.push('“Usually” is a general order, not a Handbook rule.');
    const note = $('#xray-note');
    note.textContent = s.code + ': ' + parts.join(' ') + ' Confirm prerequisites in the Handbook.';
    note.hidden = false;
  }
  function hasChain(code, ctx) { return chainOf(code, ctx).count > 0; }

  // ======================================================================== commute check
  // The two Parramatta campuses and external study there count as one place for travel. A session is
  // flagged only when its in-person subjects cannot all be taken in one place, whichever campuses are
  // chosen; a subject with an online offering never forces a trip, and a passed one no longer matters.
  const CAMPUS_AREA = { PS: 'Parramatta', PC: 'Parramatta', EX: 'Parramatta' };
  function fewestCampuses(needs) {
    const all = Array.from(new Set([].concat.apply([], needs)));
    let best = null;
    for (let mask = 1; mask < (1 << all.length); mask++) {
      const pick = all.filter(function (c, i) { return mask & (1 << i); });
      if (!needs.every(function (codes) { return codes.some(function (c) { return pick.indexOf(c) >= 0; }); })) continue;
      const areas = new Set(pick.map(function (c) { return CAMPUS_AREA[c] || c; })).size;
      const score = areas * 100 + pick.length * 10 - (state.campus && pick.indexOf(state.campus) >= 0 ? 5 : 0);
      if (!best || score < best.score) best = { pick: pick, areas: areas, score: score };
    }
    return best;
  }
  function inPersonNeeds(list) {
    return list.filter(function (s) { return !s.done && !s.pending && s.offer && !s.offer.none && !s.offer.tbc && s.offer.codes.length && s.offer.codes.indexOf('ON') < 0; })
      .map(function (s) { return s.offer.codes; });
  }
  function commutePill(list) {
    const needs = inPersonNeeds(list);
    const c = needs.length > 1 ? fewestCampuses(needs) : null;
    if (!c || c.areas < 2) return '';
    return '<span class="commute-pill" title="These subjects cannot all be taken in one place or online this session, based on 2027 offerings.">' + c.pick.length + ' Campuses: ' + c.pick.join(' + ') + '</span>';
  }

  // ======================================================================== auto-suggest open slots
  // A quick baseline, one click to undo: each open choice gets a subject from its own list that runs in
  // that session, at the student's campus or online, with its known prerequisites earlier in the plan and
  // without adding a campus trip to the session. Anything without such a subject stays open.
  function openChoices(ctx) {
    return ctx.slots.filter(function (s) { return s.pending && s.session !== 'Summer'; })
      .map(function (s) { return choiceList(ctx, s); })
      .filter(function (c) { return c.rank != null && Object.keys(c.codes).length; })
      .sort(function (a, b) { return a.rank - b.rank || a.at - b.at || a.s.raw.slot - b.s.raw.slot; });
  }
  function suggestItem(ctx) {
    const any = openChoices(ctx).length;
    return '<button type="button" class="tbtn pop-item" data-action="suggest"' + (any ? '' : ' disabled') + ' title="' + (any ? 'Fill open choices with subjects that run in that session' + (state.campus ? ' at ' + esc(META.campuses[state.campus]) + ' or online' : ', online first') : 'No open slots to fill') + '">Auto-fill Open Slots</button>';
  }
  function prereqsMet(code, idx, ctx, placed) {
    return (REQ_GROUPS[code] || []).every(function (group) {
      return group.some(function (p) {
        if (placed[p] != null && placed[p] < idx) return true;
        return ctx.slots.some(function (s) { return !s.pending && s.code === p && (s.done || orderIdx(s.year, s.session) < idx); });
      });
    });
  }
  function autoSuggest() {
    const ctx = lastCtx;
    const placed = {};
    const needs = {};
    ctx.slots.forEach(function (s) {
      const k = orderIdx(s.year, s.session);
      needs[k] = needs[k] || [];
      if (s.pending) return;
      placed[s.code] = k;
      needs[k].push.apply(needs[k], inPersonNeeds([s]));
    });
    const planned = Object.assign({}, placed);
    let count = 0;
    const open = openChoices(ctx);
    open.forEach(function (c) {
      const s = c.s;
      const k = orderIdx(s.year, s.session);
      let best = null;
      Object.keys(c.codes).forEach(function (code) {
        if (planned[code] != null) return;
        const off = offerFor(ctx.deg, code, s.session);
        if (!off || off.none || off.tbc) return;
        const here = !!state.campus && off.codes.indexOf(state.campus) >= 0;
        const online = off.codes.indexOf('ON') >= 0;
        if (state.campus && !here && !online) return;
        if (!prereqsMet(code, k, ctx, placed)) return;
        if (!online && needs[k].length) {
          const cover = fewestCampuses(needs[k].concat([off.codes]));
          if (cover && cover.areas > 1 && (!fewestCampuses(needs[k]) || cover.areas > fewestCampuses(needs[k]).areas)) return;
        }
        const score = (state.campus ? (here ? 0 : 1000) : (online ? 0 : 1000)) + (off.y2026 ? 100 : 0) + (+code.charAt(5) || 9);
        if (!best || score < best.score || (score === best.score && code < best.code)) best = { code: code, score: score, off: off };
      });
      if (!best) return;
      const e = c.codes[best.code];
      if (ctx.custom) setCustomSubject(s.idx, best.code, '', GLOBAL_BY_CODE[best.code] ? GLOBAL_BY_CODE[best.code].cp : null);
      else setPick(s.id, { code: e.code, title: e.title });
      planned[best.code] = k;
      placed[best.code] = k;
      if (best.off.codes.indexOf('ON') < 0) needs[k].push(best.off.codes);
      count++;
    });
    if (!count) { toast('No subject fits the open slots with these settings. Try another campus or choose by hand.'); return; }
    noteChange('auto-suggested ' + plural(count, 'subject'));
    renderMoving();
    const left = open.length - count;
    toast('Suggested ' + plural(count, 'subject') + (left ? ', ' + left + ' left open' : '') + '. A starting point only, so check them in the Handbook.', { action: 'undo', label: 'Undo' });
  }

  // ======================================================================== drag between sessions
  // Any plan at the full-time view; Move ▾ and Change / Replace are the way in for keyboards and phones.
  // Over a session, a card moves there. Over a card in another session the two swap places, and over a
  // card in its own session it changes order.
  function offerIssue(ctx, s, sess) {
    if (s.pending || !s.code) return '';
    if (sess === 'Summer') return 'Check Handbook for Summer';
    if (s.listSubject || s.custom || s.legacy) return 'Check Handbook';
    const off = offerFor(ctx.deg, s.code, sess);
    if (off && off.none) return 'Not offered in ' + sess;
    if (off && off.tbc) return sess + ' TBC';
    return '';
  }
  function dropIssues(ctx, s, y, sess) {
    const issues = [];
    const offer = offerIssue(ctx, s, sess);
    if (offer) issues.push(offer);
    const load = sumCP(ctx.slots.filter(function (o) { return o !== s && o.year === y && o.session === sess; })) + s.cp;
    if (load > LOAD_CP.FT) issues.push(load + ' CP, over the ' + LOAD_CP.FT + ' CP load');
    return issues;
  }
  // what a swap would do: each subject in the other's session, and the load of both sessions afterwards
  function swapInfo(ctx, s, t) {
    const inSession = function (x) { return ctx.slots.filter(function (o) { return o.year === x.year && o.session === x.session; }); };
    const name = function (x) { return x.pending ? 'open slot' : x.code; };
    const atT = sumCP(inSession(t)) - t.cp + s.cp;
    const atS = sumCP(inSession(s)) - s.cp + t.cp;
    const problems = [];
    [[s, t.session], [t, s.session]].forEach(function (p) {
      const issue = offerIssue(ctx, p[0], p[1]);
      if (issue) problems.push(name(p[0]) + (/^Not offered/.test(issue) ? ' is not offered' + issue.slice(11) : ': ' + issue));
    });
    [[atT, t], [atS, s]].forEach(function (p) {
      if (p[0] > LOAD_CP.FT) problems.push(where(p[1]) + ' would be ' + p[0] + ' CP');
    });
    const lead = 'Swap with ' + (t.pending ? 'this open slot' : t.code) + ': ';
    const good = atT === atS ? 'keeps both sessions at ' + atT + ' CP' : where(t) + ' becomes ' + atT + ' CP and ' + where(s) + ' ' + atS + ' CP';
    return { warn: problems.length > 0, problems: problems, text: lead + (problems.length ? problems.join(', ') : good) };
  }
  function swapCustomSlots(a, b) {
    const slots = editPlan().slots;
    const x = slots[a];
    const y = slots[b];
    const at = { y: x.y, s: x.s };
    x.y = y.y;
    x.s = y.s;
    y.y = at.y;
    y.s = at.s;
    // each takes the other's exact place in its session, not just its session
    slots[a] = y;
    slots[b] = x;
    return ['c' + b, 'c' + a];
  }
  function reorderCustomSlot(idx, targetIdx, after) {
    const to = targetIdx + (after ? 1 : 0) - (idx < targetIdx ? 1 : 0);
    if (to === idx) return null;
    const slots = editPlan().slots;
    const x = slots.splice(idx, 1)[0];
    slots.splice(to, 0, x);
    return 'c' + to;
  }
  function doSwap(s, t) {
    const info = swapInfo(lastCtx, s, t);
    const name = function (x) { return x.pending ? 'the open slot' : x.code; };
    noteChange('swapped ' + name(s) + ' and ' + name(t));
    const ids = swapCustomSlots(s.idx, t.idx);
    if (ui.modal) closeModal(true);
    renderMoving(function () { flashSlot(ids[0], true); flashSlot(ids[1], true); });
    toast('Swapped ' + name(s) + ' into ' + where(t) + ' and ' + name(t) + ' into ' + where(s) + (info.problems.length ? '. Check: ' + info.problems.join(', ') : '') + '.', { action: 'undo', label: 'Undo' });
  }
  function doReorder(s, t, after) {
    const id = reorderCustomSlot(s.idx, t.idx, after);
    if (!id) return;
    noteChange('reordered ' + where(s));
    if (ui.modal) closeModal(true);
    renderMoving(function () { flashSlot(id, true); });
    toast('Reordered ' + where(s) + '.', { action: 'undo', label: 'Undo' });
  }
  function dropZone(el) { return el && el.closest ? el.closest('#grid .session, #grid .summer-add') : null; }
  function zoneTarget(zone) { return { y: +zone.dataset.y, s: zone.dataset.s || 'Summer' }; }
  function markDropZones() {
    const ctx = lastCtx;
    const s = ctx.byId[ui.drag];
    if (!s) return;
    document.getElementById('slot-' + s.id).classList.add('is-dragging');
    $('#grid').querySelectorAll('.session, .summer-add').forEach(function (zone) {
      const t = zoneTarget(zone);
      if (t.y === s.year && t.s === s.session) { zone.classList.add('drop-home'); return; }
      const issues = dropIssues(ctx, s, t.y, t.s);
      zone.classList.add(issues.length ? 'drop-warn' : 'drop-ok');
      if (zone.classList.contains('summer-add')) return;
      const badge = document.createElement('span');
      badge.className = 'drop-badge';
      const full = issues.some(function (i) { return /over the/.test(i); });
      badge.textContent = (issues.length ? issues.join(' · ') : (s.pending ? 'Fits' : 'Offered, fits load')) + (full && zone.querySelector('.subj') ? ' · drop on a card to swap' : '');
      zone.querySelector('.session-head').appendChild(badge);
    });
  }
  // the card under the pointer decides a swap or a new order; anywhere else in a session is a plain move
  function cardDrop(ev, zone) {
    const ctx = lastCtx;
    const s = ctx.byId[ui.drag];
    const card = ev.target.closest ? ev.target.closest('.subj') : null;
    if (card) {
      if (card.dataset.slot === ui.drag) return null;
      const t = ctx.byId[card.dataset.slot];
      if (t.year !== s.year || t.session !== s.session) return { type: 'swap', t: t };
      const r = card.getBoundingClientRect();
      // a Summer session lays its cards out side by side on a wide screen
      const sideways = zone.classList.contains('session-summer') && window.innerWidth > 760;
      return { type: 'reorder', t: t, after: sideways ? ev.clientX > r.left + r.width / 2 : ev.clientY > r.top + r.height / 2 };
    }
    // the gaps between cards keep what was last shown, so the highlight does not flicker
    const p = ui.dropPlan;
    if (p && ev.target.closest && ev.target.closest('.slots') && p.t.year === +zone.dataset.y && p.t.session === zone.dataset.s) return p;
    return null;
  }
  function clearDropPlan() {
    ui.dropPlan = null;
    ui.dropKey = '';
    const grid = $('#grid');
    grid.querySelectorAll('.swap-badge').forEach(function (b) { b.remove(); });
    grid.querySelectorAll('.swap-ok, .swap-warn, .reorder-before, .reorder-after, .has-swap').forEach(function (el) {
      el.classList.remove('swap-ok', 'swap-warn', 'reorder-before', 'reorder-after', 'has-swap');
    });
  }
  function showDropPlan(plan) {
    const key = plan ? plan.type + plan.t.id + (plan.after ? '+' : '') : '';
    if (key === (ui.dropKey || '')) return;
    clearDropPlan();
    if (!plan) return;
    ui.dropPlan = plan;
    ui.dropKey = key;
    const card = document.getElementById('slot-' + plan.t.id);
    if (plan.type === 'reorder') { card.classList.add(plan.after ? 'reorder-after' : 'reorder-before'); return; }
    const info = swapInfo(lastCtx, lastCtx.byId[ui.drag], plan.t);
    card.classList.add(info.warn ? 'swap-warn' : 'swap-ok');
    const badge = document.createElement('span');
    badge.className = 'swap-badge';
    badge.textContent = info.text;
    card.appendChild(badge);
    card.closest('.session').classList.add('has-swap');
  }
  function clearDrag() {
    clearDropPlan();
    ui.drag = '';
    document.body.classList.remove('drag-on');
    const grid = $('#grid');
    grid.querySelectorAll('.drop-badge').forEach(function (b) { b.remove(); });
    grid.querySelectorAll('.drop-ok, .drop-warn, .drop-home, .drop-over, .is-dragging').forEach(function (el) {
      el.classList.remove('drop-ok', 'drop-warn', 'drop-home', 'drop-over', 'is-dragging');
    });
  }
  // a guide item goes to any session not yet begun
  function guideZones(i) {
    const r = lastCtx.guide.items[i];
    $('#grid').querySelectorAll('.session, .summer-add').forEach(function (zone) {
      const t = zoneTarget(zone);
      if (orderIdx(t.y, t.s) < lastCtx.guide.open) return;
      const used = sumCP(lastCtx.slots.filter(function (o) { return o.year === t.y && o.session === t.s; }));
      const off = r.code && t.s !== 'Summer' ? offerFor(lastCtx.deg, r.code, t.s) : null;
      zone.classList.add((off && off.none) || used + r.cp > LOAD_CP.FT || (r.code && t.s === 'Summer') ? 'drop-warn' : 'drop-ok');
    });
  }
  document.addEventListener('dragstart', function (ev) {
    const gi = ev.target.closest ? ev.target.closest('.guide-item[draggable="true"]') : null;
    // a card's own controls stay out of the way while something is dragged over them
    if (gi || (ev.target.closest && ev.target.closest('.subj[draggable="true"]'))) document.body.classList.add('drag-on');
    if (gi) {
      ui.dragGuide = +gi.dataset.gi;
      ev.dataTransfer.effectAllowed = 'copy';
      ev.dataTransfer.setData('text/plain', lastCtx.guide.items[ui.dragGuide].code || 'Open slot');
      requestAnimationFrame(function () { guideZones(ui.dragGuide); });
      return;
    }
    const card = ev.target.closest ? ev.target.closest('.subj[draggable="true"]') : null;
    if (!card) return;
    clearTimeout(xrayTimer);
    ui.drag = card.dataset.slot;
    ui.xrayPin = '';
    xrayClear();
    ev.dataTransfer.effectAllowed = 'move';
    ev.dataTransfer.setData('text/plain', lastCtx.byId[ui.drag].code || 'Open slot');
    // after the browser has taken its drag picture of the card
    requestAnimationFrame(markDropZones);
  });
  document.addEventListener('dragover', function (ev) {
    if (ui.dragGuide != null) {
      const z = dropZone(ev.target);
      $('#grid').querySelectorAll('.drop-over').forEach(function (x) { if (x !== z) x.classList.remove('drop-over'); });
      if (!z || !(z.classList.contains('drop-ok') || z.classList.contains('drop-warn'))) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'copy';
      z.classList.add('drop-over');
      return;
    }
    if (!ui.drag) return;
    const zone = dropZone(ev.target);
    const plan = zone ? cardDrop(ev, zone) : null;
    showDropPlan(plan);
    $('#grid').querySelectorAll('.drop-over').forEach(function (z) { if (z !== zone || plan) z.classList.remove('drop-over'); });
    if (!zone) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'move';
    if (!plan) zone.classList.add('drop-over');
  });
  document.addEventListener('drop', function (ev) {
    if (ui.dragGuide != null) {
      const z = dropZone(ev.target);
      const i = ui.dragGuide;
      if (!z || !(z.classList.contains('drop-ok') || z.classList.contains('drop-warn'))) return;
      ev.preventDefault();
      const t = zoneTarget(z);
      ui.dragGuide = null;
      clearDrag();
      addFromGuide([i], t.y + '|' + t.s);
      return;
    }
    if (!ui.drag) return;
    const zone = dropZone(ev.target);
    if (!zone) return;
    ev.preventDefault();
    const ctx = lastCtx;
    let s = ctx.byId[ui.drag];
    const plan = cardDrop(ev, zone);
    const t = zoneTarget(zone);
    const issues = dropIssues(ctx, s, t.y, t.s);
    clearDrag();
    if (!plan && s.year === t.y && s.session === t.s) return;
    if (!editPlan()) {
      const key = currentKey();
      const copied = function (id) { return 'c' + PATH[key].findIndex(function (r) { return r.id === id; }); };
      const tid = plan ? copied(plan.t.id) : '';
      const sid = ensureEditable(s.id);
      s = lastCtx.byId[sid];
      if (plan) plan.t = lastCtx.byId[tid];
    }
    if (plan && plan.type === 'swap') { doSwap(s, plan.t); return; }
    if (plan) { doReorder(s, plan.t, plan.after); return; }
    noteChange('moved ' + (s.pending ? 'an open slot' : s.code) + ' to Year ' + t.y + ' ' + t.s);
    const id = moveCustomSlot(s.idx, t.y, t.s);
    renderMoving(function () { flashSlot(id, true); });
    toast((s.pending ? 'Open slot' : s.code) + ' moved to Year ' + t.y + ' ' + t.s + (issues.length ? '. Check: ' + issues.join(', ') : '') + '.', { action: 'undo', label: 'Undo' });
  });
  document.addEventListener('dragend', function () {
    if (ui.dragGuide != null) { ui.dragGuide = null; clearDrag(); return; }
    if (ui.drag) clearDrag();
  });

  // ======================================================================== modals: focus and closing
  let modalTimer = 0;
  let focusBack = null;
  function lockScroll() {
    if (document.body.style.overflow === 'hidden') return;
    const bar = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (bar > 0) {
      $('#app').style.paddingRight = bar + 'px';
      // fixed to the right edge, the box would jump sideways as the scrollbar goes
      $('#enquiry-box').style.marginRight = bar + 'px';
    }
  }
  function unlockScroll() {
    document.body.style.overflow = '';
    $('#app').style.paddingRight = '';
    $('#enquiry-box').style.marginRight = '';
  }
  function showModal(html) {
    const root = $('#modal-root');
    const closing = root.classList.contains('closing');
    clearTimeout(modalTimer);
    root.classList.remove('closing');
    if ((!root.firstChild || closing) && !focusBack) {
      const a = document.activeElement;
      focusBack = a && a !== document.body ? { el: a, id: a.id, action: a.dataset && a.dataset.action, slot: a.dataset && a.dataset.slot } : null;
    }
    const opening = !root.firstChild || closing;
    root.innerHTML = html;
    $('#app').inert = true;
    lockScroll();
    if (opening) {
      const m = root.querySelector('.modal');
      m.tabIndex = -1;
      m.focus({ preventScroll: true });
    }
  }
  function closeModal(now) {
    // a pathway copied only to open a window, and left as it was, goes back to being the pathway
    if (ui.probe) {
      const p = ui.probe;
      ui.probe = null;
      if (state.edits[p.key] && JSON.stringify(state.edits[p.key]) === p.json) { delete state.edits[p.key]; lastCtx = buildContext(); }
    }
    ui.modal = null;
    ui.picker = null;
    ui.assign = null;
    ui.setupSummer = 0;
    ui.importFound = null;
    ui.progress = null;
    ui.repace = null;
    ui.transfer = null;
    ui.importJob = (ui.importJob || 0) + 1;
    const root = $('#modal-root');
    clearTimeout(modalTimer);
    $('#app').inert = false;
    unlockScroll();
    if (now === true || !root.firstChild || !motionOK()) {
      root.classList.remove('closing');
      root.innerHTML = '';
    } else {
      root.classList.add('closing');
      modalTimer = setTimeout(function () {
        root.classList.remove('closing');
        root.innerHTML = '';
      }, 150);
    }
    setTimeout(restoreFocus, 0);
  }
  // back to what opened the window, or its stand-in if the page was rebuilt meanwhile
  function restoreFocus() {
    if (!focusBack || ui.modal) return;
    const f = focusBack;
    focusBack = null;
    let el = f.el && f.el.isConnected ? f.el : f.id ? document.getElementById(f.id) : null;
    if (!el && f.action) el = document.querySelector('[data-action="' + f.action + '"]' + (f.slot ? '[data-slot="' + f.slot + '"]' : ''));
    if (el && el.focus) el.focus({ preventScroll: true });
    if (el && document.activeElement !== el && el.closest('.pop')) {
      const button = el.closest('.pop').querySelector('.pop-btn');
      if (button.offsetParent) { button.focus({ preventScroll: true }); return; }
    }
    if (el && el.closest('#top-actions') && document.activeElement !== el) $('.top-menu-btn').focus({ preventScroll: true });
  }
  function trapTab(ev) {
    const box = $('#modal-root .modal');
    if (!box) return;
    const items = Array.from(box.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
      .filter(function (el) { return !el.hidden && el.offsetParent !== null; });
    if (!items.length) { ev.preventDefault(); box.focus(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    const at = document.activeElement;
    if (!box.contains(at) || at === box) { ev.preventDefault(); (ev.shiftKey ? last : first).focus(); }
    else if (ev.shiftKey && at === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && at === last) { ev.preventDefault(); first.focus(); }
  }
  const KEY_HINT = '<kbd>/</kbd> search · <kbd>Esc</kbd> close';
  const CLEAR_PICK = ' <button type="button" class="linkish" data-action="pick-reset">Clear filters</button>';

  // The chain view follows a settled pointer or the keyboard, unless a Chain button has pinned it. A pointer
  // has to rest on a card for XRAY_INTENT before anything dims, so passing over cards or scrolling
  // never flickers; the Chain button itself responds at once.
  const XRAY_INTENT = 220;
  let xrayTimer = 0;
  let scrolledAt = 0;
  function xrayFollow(id, delay) {
    if (ui.xrayPin || ui.drag || ui.modal || id === ui.xrayHover) return;
    ui.xrayHover = id;
    clearTimeout(xrayTimer);
    xrayTimer = setTimeout(function () { if (id) xrayShow(id); else xrayClear(); }, delay);
  }
  // moving counts as well as entering, so a card under a pointer that has scrolled to it still responds, once the pointer moves
  function xrayPointer(ev) {
    if (ev.pointerType !== 'mouse' || Date.now() - scrolledAt < 250 || !ev.target.closest) return;
    const chain = ev.target.closest('#grid .chain-btn');
    const card = ev.target.closest('#grid .subj');
    if (chain) xrayFollow(chain.dataset.slot, 0);
    else if (card) xrayFollow(card.dataset.slot, XRAY_INTENT);
    else xrayFollow('', 60);
  }
  // a soft light follows the pointer across the card it is on
  let spotAt = null;
  $('#grid').addEventListener('pointermove', function (ev) {
    if (ev.pointerType !== 'mouse' || !motionOK()) return;
    const first = !spotAt;
    spotAt = ev;
    if (!first) return;
    requestAnimationFrame(function () {
      const e = spotAt;
      spotAt = null;
      const card = e.target.closest ? e.target.closest('.subj') : null;
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', Math.round(e.clientX - r.left) + 'px');
      card.style.setProperty('--my', Math.round(e.clientY - r.top) + 'px');
    });
  }, { passive: true });
  document.addEventListener('pointerover', xrayPointer);
  document.addEventListener('pointermove', xrayPointer, { passive: true });
  window.addEventListener('scroll', function () {
    scrolledAt = Date.now();
    if (ui.xrayPin || ui.xrayFocus || !ui.xrayHover) return;
    clearTimeout(xrayTimer);
    ui.xrayHover = '';
    xrayClear();
  }, { passive: true });
  document.addEventListener('focusin', function (ev) {
    const card = ev.target.closest ? ev.target.closest('#grid .subj') : null;
    if (!card || !ev.target.matches(':focus-visible')) return;
    ui.xrayFocus = true;
    xrayFollow(card.dataset.slot, 0);
  });
  document.addEventListener('focusout', function (ev) {
    if (!ev.target.closest || !ev.target.closest('#grid .subj') || (ev.relatedTarget && ev.relatedTarget.closest && ev.relatedTarget.closest('#grid .subj'))) return;
    ui.xrayFocus = false;
    xrayFollow('', 60);
  });

  // ======================================================================== practice areas
  // WSLSA groupings of the LLB Alternates, made from subject titles (data/practice-areas.json)
  const AREA_LABEL = {};
  PRACTICE.areas.forEach(function (a) { AREA_LABEL[a.id] = a.label; });
  function inArea(code, area) { return !area || (PRACTICE.subjects[code] || []).indexOf(area) >= 0; }
  function areaTags(code) {
    return (PRACTICE.subjects[code] || []).map(function (a) { return '<span class="area-tag">' + esc(AREA_LABEL[a]) + '</span>'; }).join('');
  }
  function areaTools(action, current) {
    return '<div class="tool-row area-chips" role="group" aria-label="Filter by practice area">' +
      [{ id: '', label: 'All Areas' }].concat(PRACTICE.areas).map(function (a) {
        return '<button type="button" class="chip" data-action="' + action + '" data-area="' + a.id + '" aria-pressed="' + ((current || '') === a.id) + '">' + esc(a.label) + '</button>';
      }).join('') + '</div>';
  }
  function toolsNote(areas, keys) {
    return '<p class="area-note">' + (areas ? 'Areas are WSLSA groupings by subject title, not Handbook categories. ' : '') + '<span class="kbd-only">' + keys + '</span></p>';
  }
  function pressArea(action, area) {
    document.querySelectorAll('[data-action="' + action + '"]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.area === area)); });
  }

  // ======================================================================== session load
  // A session with three or more Level 3 or 4 Law subjects, or a full load made up only of Level 3 and 4
  // subjects, gets a pill. The level is the first digit of the subject number. A finished session has none.
  function loadPill(list) {
    const subjects = list.filter(function (s) { return !s.pending && /^[A-Z]{4} \d{4}$/.test(s.code || ''); });
    if (!subjects.length || subjects.every(function (s) { return s.done; })) return '';
    const level = function (s) { return +s.code.charAt(5); };
    const law = function (s) { return s.code.indexOf('LAWS ') === 0; };
    const upper = subjects.filter(function (s) { return level(s) === 3 || level(s) === 4; });
    const upperLaw = upper.filter(law);
    const allUpper = upper.length === subjects.length && subjects.length === list.length && sumCP(list) >= LOAD_CP.FT;
    if (upperLaw.length < 3 && !allUpper) return '';
    const lawCount = subjects.filter(law).length;
    const levels = [1, 2, 3, 4].map(function (n) { return 'Level ' + n + ': ' + subjects.filter(function (s) { return level(s) === n; }).length; }).join(', ');
    return '<span class="load-pill" title="' + plural(upperLaw.length, 'Level 3 or 4 Law subject') + ' this session. Mix: ' + lawCount + ' Law, ' + (subjects.length - lawCount) + ' non-Law; ' + levels + '.">Heavy L3/4 Load</span>';
  }

  // ======================================================================== structure progress
  // The plan's completed credit points, drawn in the details panel. A WSLSA pathway shows one overall bar, as
  // its structure components do not map cleanly to subjects in every degree; a custom plan groups by
  // subject area, which comes from the plan itself, so each area can show its own.
  function areaKey(s) { return s.custom ? 'Typed in by hand' : s.code.slice(0, 4) + ' subjects'; }
  function areaCP(ctx) {
    const out = {};
    ctx.slots.forEach(function (s) {
      if (s.pending) return;
      const k = areaKey(s);
      out[k] = out[k] || { cp: 0, done: 0 };
      out[k].cp += s.cp;
      if (s.done) out[k].done += s.cp;
    });
    return out;
  }
  function doneRow(ctx) {
    return '<div class="structure-row structure-done" data-done-row="1"><span>Completed so far</span><span class="cpv">' + ctx.doneCP + ' / ' + ctx.deg.cp + ' CP</span><span class="sbar"><span style="width:' + progressPct(ctx) + '%"></span></span></div>';
  }
  function syncStructure(ctx) {
    const row = $('#details [data-done-row]');
    if (!row) return;
    row.querySelector('.cpv').textContent = ctx.doneCP + ' / ' + ctx.deg.cp + ' CP';
    row.querySelector('.sbar span').style.width = progressPct(ctx) + '%';
    const areas = areaCP(ctx);
    document.querySelectorAll('#details [data-area]').forEach(function (r) {
      const a = areas[r.dataset.area];
      if (!a) return;
      r.querySelector('.cpv').textContent = a.done + ' / ' + a.cp + ' CP';
      r.querySelector('.sbar i').style.width = (a.cp ? a.done / a.cp * 100 : 0) + '%';
    });
  }

  // ======================================================================== defer and cascade
  // Moves a subject to the next Autumn or Spring it runs in, and moves on any subject in the plan that needs it
  // and now sits at or before it. Only rules with a source cascade, not the general Usually order.
  function nextOffered(deg, code, after, floor) {
    const runs = SESSIONS.filter(function (sess) {
      const o = offerFor(deg, code, sess);
      return o && !o.none && !o.tbc;
    });
    for (let k = Math.max(after + 1, floor); k < MAX_YEARS * 3; k++) {
      const sess = PLAN_SESSIONS[k % 3];
      if (sess === 'Summer' || (runs.length && runs.indexOf(sess) < 0)) continue;
      return { y: Math.floor(k / 3) + 1, s: sess, k: k, unsure: !runs.length };
    }
    return null;
  }
  function deferSubject(id) {
    const copied = !editPlan();
    id = ensureEditable(id);
    const plan = editPlan();
    const ctx = lastCtx;
    const s = ctx.byId[id];
    const floor = ctx.plan.start ? firstOpenIdx(ctx.plan.start) : 0;
    const moved = [];
    let unsure = false;
    const shift = function (slot, after) {
      const x = plan.slots[slot.idx];
      const t = nextOffered(ctx.deg, slot.code, after, floor);
      if (!t) return null;
      x.y = t.y;
      x.s = t.s;
      if (t.unsure) unsure = true;
      moved.push(slot.code + ' to ' + sessionLabel(t.y, t.s));
      return t.k;
    };
    const first = shift(s, orderIdx(s.year, s.session));
    if (first == null) {
      if (copied) { delete state.edits[currentKey()]; lastCtx = buildContext(); }
      toast(s.code + ' has no later session within the ' + MAX_YEARS + ' years a plan can hold.');
      return;
    }
    // a subject stays where it is if another subject still meets the requirement earlier in the plan
    const placedAt = function (code) {
      const found = plan.slots.filter(function (x) { return x.code === code; });
      if (!found.length) return null;
      return found.some(function (x) { return x.done; }) ? -1 : Math.min.apply(null, found.map(function (x) { return orderIdx(x.y, x.s); }));
    };
    const stillMet = function (code, idx) {
      return (REQ_GROUPS[code] || []).every(function (group) {
        return group.some(function (p) { const at = placedAt(p); return at != null && at < idx; });
      });
    };
    const queue = [{ code: s.code, at: first }];
    while (queue.length) {
      const q = queue.shift();
      (REQUIRED_BY[q.code] || []).forEach(function (e) {
        ctx.slots.filter(function (o) { return !o.pending && !o.done && o.code === e.code; }).forEach(function (o) {
          const idx = orderIdx(plan.slots[o.idx].y, plan.slots[o.idx].s);
          if (idx > q.at || stillMet(o.code, idx)) return;
          const to = shift(o, q.at);
          if (to != null) queue.push({ code: o.code, at: to });
        });
      });
    }
    noteChange('deferred ' + s.code);
    if (ui.modal) closeModal(true);
    const target = id;
    renderMoving(function () { flashSlot(target); });
    const over = lastCtx.risks.overload.filter(function (l) { const x = plan.slots[s.idx]; return l.year === x.y && l.session === x.s; })[0];
    toast((moved.length > 1 ? 'Deferred ' + moved[0] + ', and moved ' + moved.slice(1).join(', ') : 'Deferred ' + moved[0]) + '.' + (copied ? ' This pathway is now your edited copy.' : '') +
      (over ? ' That session is now ' + over.cp + ' CP.' : '') + (unsure ? ' Its sessions are unpublished, so check the Handbook.' : ''), { action: 'undo', label: 'Undo' });
  }

  // ======================================================================== re-pace
  // Lays out what is left of a degree again at a chosen load, in the student's own copy of the plan.
  // Completed subjects stay in the sessions they were taken in. Everything else goes into the earliest
  // session that has room, that the subject runs in according to the 2027 guides, and that comes after its
  // known prerequisites. The data lists few prerequisites and a WSLSA pathway carries the rest in its order,
  // so a subject can only move ahead of the subjects before it by one session.
  const PACE_NAME = { 20: 'Part-Time', 30: '3-Unit Load', 40: 'Full-Time' };
  const SUMMER_CP = 20;
  // counts Autumn and Spring sessions only, so two sessions can be compared across a Summer
  function studyNo(k) { return Math.floor(k / 3) * 2 + Math.min(k % 3, 1); }
  function studyIdx(k) { return PLAN_SESSIONS[k % 3] === 'Summer' ? k + 1 : k; }
  function shiftStudy(k, by) {
    const sess = PLAN_SESSIONS[k % 3];
    if (!by || sess === 'Summer') return k;
    if (by > 0) return sess === 'Autumn' ? k + 1 : k + 2;
    return sess === 'Spring' ? k - 1 : Math.max(0, k - 2);
  }
  function shownPlaces(ctx) {
    const at = {};
    timeline(ctx, state.load).forEach(function (y) {
      PLAN_SESSIONS.forEach(function (sess) { y[sess].forEach(function (s) { at[s.id] = orderIdx(y.year, sess); }); });
    });
    return at;
  }
  function planIntake(ctx) {
    const at = shownPlaces(ctx);
    const first = ctx.slots.reduce(function (m, s) { return Math.min(m, at[s.id]); }, Infinity);
    return first < Infinity && PLAN_SESSIONS[first % 3] === 'Spring' ? 'Spring' : 'Autumn';
  }
  // The session types a subject can go in: those the guides publish. A subject with nothing published
  // stays in the type it was planned for, and one the guides do not list could go in either; both are flagged.
  function sessionsOf(deg, code, planned) {
    const e = deg.byCode[code] || GLOBAL_BY_CODE[code];
    if (!e) return { list: SESSIONS, unsure: true };
    const list = SESSIONS.filter(function (sess) { return parseOffered(sessionValue(e, sess)).codes.length > 0; });
    if (list.length) return { list: list, unsure: false };
    const tbc = SESSIONS.filter(function (sess) { return parseOffered(sessionValue(e, sess)).tbc; });
    const keep = SESSIONS.indexOf(planned) >= 0 ? planned : 'Autumn';
    return { list: tbc.length && tbc.indexOf(keep) < 0 ? tbc : [keep], unsure: true };
  }
  function sessionsForRow(deg, r) {
    if (r.code) return sessionsOf(deg, r.code, r.slot.s);
    const options = r.s.raw && r.s.raw.options;
    if (!options || !options.length) return { list: SESSIONS, unsure: false };
    const runs = {};
    options.forEach(function (o) { sessionsOf(deg, o.code, r.slot.s).list.forEach(function (sess) { runs[sess] = 1; }); });
    return { list: SESSIONS.filter(function (sess) { return runs[sess]; }), unsure: false };
  }
  // Known rules must be met in an earlier session. A subject the plan does not hold cannot be waited for, and
  // the advisory already says so. The general order (a Usually first) allows the same session, as the pathways do.
  function paceReady(code, k, placedAt, inPlan) {
    if (!code) return true;
    const rules = (REQ_GROUPS[code] || []).every(function (group) {
      const known = group.filter(function (p) { return inPlan[p]; });
      return !known.length || known.some(function (p) { return placedAt[p] != null && placedAt[p] < k; });
    });
    if (!rules) return false;
    return PREREQS.sequences.every(function (seq) {
      return !followsSequence(code, seq) || seq.first.every(function (p) { return !inPlan[p] || (placedAt[p] != null && placedAt[p] <= k); });
    });
  }
  function layoutPace(ctx, o) {
    const deg = ctx.deg;
    const places = shownPlaces(ctx);
    const base = ctx.custom ? ctx.plan.slots : templateSlots(ctx.key, true);
    const whole = o.scope === 'whole';
    const began = ctx.custom && ctx.plan.start ? firstOpenIdx(ctx.plan.start) : 0;
    const shift = o.intake === planIntake(ctx) ? 0 : o.intake === 'Spring' ? 1 : -1;
    let rows = ctx.slots.map(function (s, i) {
      const locked = !whole && (s.done || places[s.id] < began);
      return { s: s, slot: base[i], code: s.pending ? '' : s.code, cp: s.cp, order: i, shown: places[s.id], from: orderIdx(base[i].y, base[i].s), locked: locked, k: locked ? shiftStudy(places[s.id], shift) : -1 };
    });
    // a subject whose pre-2027 or 2027 equivalent is passed is not needed again: it goes when the plan has the
    // credit points to spare, and otherwise becomes an open slot
    const tplKey = ctx.custom ? ctx.plan.tpl : ctx.key;
    const llb = tplKey ? PATH[tplKey].find(function (r) { return r.kind === 'llb'; }) : null;
    // what a plan still needs is laid out with the rest, so re-pacing an imported plan places it
    if (ctx.custom && ctx.guide) {
      ctx.guide.items.forEach(function (r, i) {
        const raw = r.o && tplKey ? PATH[tplKey].find(function (x) { return x.id === r.o; }) : null;
        const shape = raw ? { kind: raw.kind, pool: raw.pool, options: raw.options, title: raw.title } : { kind: 'open', pool: null, options: null, title: '' };
        const s = { id: 'g' + i, kind: 'cslot', pending: !r.code, code: r.code || null, title: r.label, done: false, cp: r.cp, year: r.y, session: r.s, raw: shape, orig: raw };
        rows.push({ s: s, slot: { y: r.y, s: r.s, code: r.code, title: '', cp: r.cp, o: r.o || '', done: false }, code: r.code, cp: r.cp, order: rows.length, shown: r.k, from: r.k, locked: false, k: -1 });
      });
    }
    const asSlot = function (r, raw, code) {
      r.code = code;
      r.slot = Object.assign({}, r.slot, { code: code, title: '', o: raw ? raw.id : '' });
      const shape = raw ? { kind: raw.kind, pool: raw.pool, options: raw.options, title: raw.title } : { kind: 'open', pool: null, options: null, title: '' };
      r.s = Object.assign({}, r.s, r.s.kind === 'cslot' ? { raw: shape, orig: raw } : { kind: shape.kind, raw: raw || shape });
    };
    const passed = {};
    rows.forEach(function (r) { if (r.s.done && r.code) sameAs(r.code).forEach(function (c) { if (c !== r.code) passed[c] = r.code; }); });
    const dropped = [];
    let spareCP = rows.reduce(function (a, r) { return a + r.cp; }, 0) - (ctx.custom ? ctx.plan.cp : deg.cp);
    rows = rows.filter(function (r) {
      if (r.locked || r.s.done || !r.code || !passed[r.code]) return true;
      dropped.push({ code: r.code, by: passed[r.code] });
      if (spareCP >= r.cp) { spareCP -= r.cp; return false; }
      asSlot(r, null, '');
      return true;
    });
    // the pre-2027 structure has LLB Alternate slots where the 2027 structure has LAWS 2019, LAWS 3099 and LAWS 3102
    const converted = [];
    const restored = [];
    if (o.cohort === 'pre2027') {
      rows.forEach(function (r) {
        if (r.locked || r.s.done || NEW_2027_CORES.indexOf(r.code) < 0) return;
        converted.push(r.code);
        asSlot(r, llb, '');
      });
    } else if (ctx.custom && cohortOf(ctx.plan) === 'pre2027' && tplKey && llb) {
      const held = {};
      rows.forEach(function (r) { if (r.code) held[r.code] = 1; });
      const isLLB = {};
      PATH[tplKey].forEach(function (r) { if (r.kind === 'llb') isLLB[r.id] = 1; });
      const spare = rows.filter(function (r) { return !r.locked && !r.s.done && !r.code && isLLB[r.slot.o]; }).reverse();
      NEW_2027_CORES.forEach(function (code) {
        const raw = PATH[tplKey].find(function (x) { return x.code === code; });
        if (!raw || held[code] || !spare.length) return;
        restored.push(code);
        asSlot(spare.shift(), raw, code);
      });
    }
    const lastLocked = rows.reduce(function (m, r) { return r.locked ? Math.max(m, r.k) : m; }, -1);
    const floor = whole ? 0 : Math.max(lastLocked + 1, firstOpenIdx(o.start));
    let first = studyIdx(Math.max(floor, o.intake === 'Spring' ? 1 : 0));
    let loa = -1;
    if (o.loa) { loa = first; first = studyIdx(first + 1); }
    const inPlan = {};
    const placedAt = {};
    const loads = {};
    rows.forEach(function (r) {
      if (r.code) inPlan[r.code] = 1;
      if (!r.locked) return;
      loads[r.k] = (loads[r.k] || 0) + r.cp;
      if (r.code) placedAt[r.code] = r.s.done ? -1 : r.k;
    });
    const todo = rows.filter(function (r) { return !r.locked; });
    const lowest = todo.reduce(function (m, r) { return Math.min(m, studyNo(r.from)); }, Infinity);
    todo.forEach(function (r) {
      r.runs = sessionsForRow(deg, r);
      // subjects being phased out go first, before their last offerings pass
      r.rank = PHASE_YEAR[r.code] ? lowest : studyNo(r.from);
      // an open slot or an elective has no place in the pathway's order, so it can fill a session that would run short
      r.free = !r.code || (r.s.kind === 'cslot' ? r.s.raw.kind : r.s.kind) === 'elective';
    });
    todo.sort(function (a, b) { return (PHASE_YEAR[a.code] || 9999) - (PHASE_YEAR[b.code] || 9999) || a.from - b.from || a.order - b.order; });
    let left = todo;
    let idle = 0;
    let keepOrder = true;
    let strict = true;
    const forced = [];
    for (let k = first; left.length && k < MAX_YEARS * 3; k++) {
      const sess = PLAN_SESSIONS[k % 3];
      if (sess === 'Summer') continue;
      const lead = left.reduce(function (m, r) { return Math.min(m, r.rank); }, Infinity);
      const before = left.length;
      left = left.filter(function (r) {
        const used = loads[k] || 0;
        if (used && used + r.cp > o.load) return true;
        if (r.runs.list.indexOf(sess) < 0) return true;
        if (keepOrder && !r.free && r.rank > lead + 1) return true;
        const met = paceReady(r.code, k, placedAt, inPlan);
        if (strict && !met) return true;
        if (!met) forced.push(r.code);
        r.k = k;
        loads[k] = used + r.cp;
        if (r.code && placedAt[r.code] == null) placedAt[r.code] = k;
        return false;
      });
      idle = left.length === before ? idle + 1 : 0;
      // a plan whose own order cannot be kept still gets laid out, and the student is told
      if (idle >= 2) keepOrder = false;
      if (idle >= 4) strict = false;
    }
    const lastOf = function () { return rows.reduce(function (m, r) { return Math.max(m, r.k); }, -1); };
    const plainEnd = lastOf();
    let fast = null;
    if (o.fast && !left.length && todo.length) {
      fast = fastTrack(deg, todo, loads, placedAt, inPlan, o, o.loa ? first : floor);
      fast.gain = studyNo(plainEnd) - studyNo(lastOf());
    }
    const end = lastOf();
    return { rows: rows, todo: todo, first: first, loa: loa, unplaced: left, forced: forced, fast: fast, converted: converted, restored: restored, dropped: dropped, finishK: end, finishLabel: end < 0 ? 'No subjects yet' : termName(o.start + Math.floor(end / 3), PLAN_SESSIONS[end % 3]) };
  }
  // Tries to clear the last session, twice at most: first into room already free, then LLB Alternates and
  // electives into a Summer session, then by moving one of those from an earlier session into Summer to make
  // room, then one extra subject in an Autumn or Spring it runs in. The guides have no Summer data, so a
  // subject moved there is flagged, and an extra subject at full-time is an overload.
  function fastTrack(deg, todo, loads, placedAt, inPlan, o, floor) {
    const moves = [];
    const inLLB = {};
    (deg.byComp[deg.llbComponent] || []).forEach(function (e) { inLLB[e.code] = 1; });
    const summerOK = function (r) {
      const kind = r.s.kind === 'cslot' ? r.s.raw.kind : r.s.kind;
      return kind === 'llb' || kind === 'elective' || !!inLLB[r.code];
    };
    for (let round = 0; round < 2; round++) {
      const last = todo.reduce(function (m, r) { return Math.max(m, r.k); }, -1);
      const movers = todo.filter(function (r) { return r.k === last; });
      const tryLoads = Object.assign({}, loads);
      const tryAt = Object.assign({}, placedAt);
      const found = [];
      const at = function (x) { const m = found.filter(function (f) { return f.r === x; }).pop(); return m ? m.k : x.k; };
      const makeRoom = function (r) {
        for (let k = last - 1; k >= floor; k--) {
          const sess = PLAN_SESSIONS[k % 3];
          if (sess === 'Summer' || r.runs.list.indexOf(sess) < 0 || !paceReady(r.code, k, tryAt, inPlan)) continue;
          const out = todo.find(function (x) { return at(x) === k && x.k !== last && summerOK(x) && x.cp === r.cp; });
          if (!out) continue;
          for (let u = last - 1; u >= floor; u--) {
            if (PLAN_SESSIONS[u % 3] !== 'Summer' || (tryLoads[u] || 0) + out.cp > SUMMER_CP) continue;
            if (!paceReady(out.code, u, tryAt, inPlan)) continue;
            const needed = (REQUIRED_BY[out.code] || []).some(function (e) { return tryAt[e.code] != null && tryAt[e.code] <= u; });
            if (needed) continue;
            tryLoads[u] = (tryLoads[u] || 0) + out.cp;
            if (out.code) tryAt[out.code] = u;
            if (r.code) tryAt[r.code] = k;
            found.push({ r: out, k: u, way: 'summer' }, { r: r, k: k, way: 'room' });
            return true;
          }
        }
        return false;
      };
      const place = function (r, way) {
        for (let k = last - 1; k >= floor; k--) {
          const sess = PLAN_SESSIONS[k % 3];
          const used = tryLoads[k] || 0;
          if (way === 'summer') {
            if (sess !== 'Summer' || !summerOK(r) || used + r.cp > SUMMER_CP) continue;
          } else {
            if (sess === 'Summer' || r.runs.list.indexOf(sess) < 0) continue;
            if (used + r.cp > o.load + (way === 'extra' ? 10 : 0)) continue;
          }
          if (!paceReady(r.code, k, tryAt, inPlan)) continue;
          tryLoads[k] = used + r.cp;
          if (r.code) tryAt[r.code] = k;
          found.push({ r: r, k: k, way: way });
          return true;
        }
        return false;
      };
      const cleared = movers.length && movers.every(function (r) {
        return place(r, 'room') || (o.summer && (place(r, 'summer') || makeRoom(r))) || (o.overload && place(r, 'extra'));
      });
      if (!cleared) break;
      found.forEach(function (f) {
        loads[f.r.k] -= f.r.cp;
        loads[f.k] = (loads[f.k] || 0) + f.r.cp;
        f.r.k = f.k;
        if (f.r.code) placedAt[f.r.code] = f.k;
        moves.push(f);
      });
    }
    return { moves: moves, gain: 0 };
  }
  function pacedPlan(ctx, res, o) {
    const head = ctx.custom
      ? { name: ctx.plan.name, code: ctx.plan.code, cp: ctx.plan.cp, tpl: ctx.plan.tpl }
      : { name: ctx.deg.title, code: ctx.deg.code, cp: ctx.deg.cp, tpl: ctx.key };
    const slots = res.rows.slice().sort(function (a, b) { return a.k - b.k || a.order - b.order; }).map(function (r) {
      return Object.assign({}, r.slot, { y: Math.floor(r.k / 3) + 1, s: PLAN_SESSIONS[r.k % 3] });
    });
    // a re-paced plan runs at one load, so loads set by hand go; the student's notes stay with their sessions
    return sanitiseCustom(Object.assign(head, { start: o.start === START_YEAR ? 0 : o.start, pace: o.load, cohort: o.cohort, slots: slots, notes: ctx.custom ? ctx.plan.notes : {}, skip: ctx.custom ? ctx.plan.skip : [] }));
  }
  function paceSummary(res, o) {
    const rest = res.todo.reduce(function (a, r) { return a + r.cp; }, 0);
    const locked = res.rows.filter(function (r) { return r.locked; });
    const tail = ' re-paced to ' + PACE_NAME[o.load] + ' (' + o.load + ' CP/session) → Finishes ' + res.finishLabel;
    if (!locked.length) return 'All ' + rest + ' CP' + tail;
    const yearOf = function (r) { return Math.floor(r.shown / 3) + 1; };
    const years = Array.from(new Set(res.rows.map(yearOf))).sort(function (a, b) { return a - b; });
    let full = 0;
    while (full < years.length && res.rows.every(function (r) { return yearOf(r) !== years[full] || r.locked; })) full++;
    const perSession = {};
    locked.forEach(function (r) { perSession[r.shown] = (perSession[r.shown] || 0) + r.cp; });
    const heavy = Object.keys(perSession).some(function (k) { return perSession[k] > 20; });
    const kept = full > 1 ? 'Years ' + years[0] + '–' + years[full - 1] + ' kept ' + (heavy ? 'Full-Time' : 'Part-Time')
      : full === 1 ? 'Year ' + years[0] + ' kept ' + (heavy ? 'Full-Time' : 'Part-Time')
        : locked.reduce(function (a, r) { return a + r.cp; }, 0) + ' CP kept';
    return kept + ' · Remaining ' + rest + ' CP' + tail;
  }
  function sessionsApart(n) { return n === 0 ? 'the same finish' : plural(Math.abs(n), 'session') + (n > 0 ? ' later' : ' earlier'); }
  // a change a student could already make with the dock's two buttons: a view, not a new plan
  function paceIsView(ctx, o) {
    return o.scope === 'whole' && (o.load === 20 || o.load === 40) && !o.loa && !o.fast && o.intake === planIntake(ctx) && o.start === planStart() && o.cohort === planCohort(ctx) && !(ctx.custom && ctx.plan.pace);
  }
  // the structure a plan follows: a custom plan says, and otherwise it goes by the year Year 1 begins
  function planCohort(ctx, start) {
    if (ctx.custom && ctx.plan.cohort) return ctx.plan.cohort;
    return startCohort(start || planStart());
  }
  function lastIn(ctx, load) {
    const years = timeline(ctx, load);
    const y = years[years.length - 1];
    if (!y) return null;
    const sess = PLAN_SESSIONS.slice().reverse().find(function (x) { return y[x].length; });
    return { year: y.year, session: sess };
  }
  function openRePace(init) {
    const ctx = lastCtx;
    const now = paceNow(ctx);
    const end = finishOf(ctx);
    const canSpring = !ctx.deg.intakeList.length || ctx.deg.intakeList.indexOf('Spring') >= 0;
    ui.repace = {
      scope: ctx.doneCP > 0 ? 'remaining' : 'whole', load: init && init.load ? init.load : now === 40 ? 20 : 40,
      loa: false, intake: planIntake(ctx), start: planStart(), fast: false, summer: true, overload: true, cohort: planCohort(ctx), cohortSet: false,
    };
    const years = [];
    for (let yr = Math.min(planStart(), START_YEAR - 8); yr <= Math.max(planStart(), START_YEAR + 2); yr++) years.push(yr);
    const card = function (val, title, desc) {
      return '<label class="opt-card"><input type="radio" name="rp-scope" value="' + val + '"' + (ui.repace.scope === val ? ' checked' : '') + '><b>' + title + '</b><span>' + desc + '</span></label>';
    };
    ui.modal = 'repace';
    showModal('<div class="modal-backdrop" data-action="backdrop"><div class="modal modal-repace" role="dialog" aria-modal="true" aria-labelledby="rp-h">' +
      '<div class="modal-head"><div><h2 id="rp-h">Re-Pace Remaining Degree</h2><p>' + (ctx.doneCP > 0 ? 'You have completed ' + ctx.doneCP + ' of ' + ctx.deg.cp + ' CP.' : 'Nothing is ticked off yet, so all ' + ctx.deg.cp + ' CP can move.') + (end ? ' Your plan finishes ' + esc(sessionLabel(end.year, end.session)) + ' as it stands.' : '') + '</p></div><button type="button" class="modal-x" data-action="modal-close" aria-label="Close">×</button></div>' +
      '<div class="setup-body rp-body" id="rp-form"><div class="rp-controls">' +
      '<fieldset><legend><span class="idx">01→</span>What to switch</legend><div class="start-opts">' +
      card('remaining', 'Switch remaining only', 'Keeps your completed subjects in the sessions you took them, and moves only what is left into future sessions.') +
      card('whole', 'Switch entire plan from Year 1', 'Changes the whole degree at this load, as though you had always studied this way. Your ticks stay on their subjects.') + '</div></fieldset>' +
      '<fieldset><legend><span class="idx">02→</span>Load</legend>' +
      '<div class="segmented rp-seg" role="group" aria-label="Load for the rest of your degree">' +
      [[20, '20 CP Part-time'], [30, '30 CP 3 Units'], [40, '40 CP Full-time']].map(function (x) { return '<button type="button" data-action="rp-load" data-v="' + x[0] + '" aria-pressed="false">' + x[1] + '</button>'; }).join('') + '</div>' +
      '<label class="check-row"><input type="checkbox" id="rp-loa"><span>Take one session off first (Leave of Absence)</span></label></fieldset>' +
      '<fieldset><legend><span class="idx">03→</span>Intake and start year</legend><div class="rp-row">' +
      '<div class="segmented rp-seg" role="group" aria-label="Intake">' +
      '<button type="button" data-action="rp-intake" data-v="Autumn" aria-pressed="false">Autumn Start</button>' +
      '<button type="button" data-action="rp-intake" data-v="Spring" aria-pressed="false"' + (canSpring ? '' : ' disabled title="' + esc(ctx.deg.code) + ' has an Autumn intake only"') + '>Spring Start</button></div>' +
      '<div class="field rp-year"><label for="rp-start">Year 1 begins in</label><div class="select-wrap"><select id="rp-start">' + years.map(function (yr) {
        return '<option value="' + yr + '"' + (yr === ui.repace.start ? ' selected' : '') + '>' + yr + '</option>';
      }).join('') + '</select></div></div></div>' +
      (canSpring ? '' : '<p class="cs-derived">' + esc(ctx.deg.code) + ' has an Autumn intake only.</p>') +
      cohortSet('rp-cohort', ui.repace.cohort) +
      '<p class="cs-derived">Started before 2027? The pre-2027 structure leaves out LAWS 2019, LAWS 3099 and LAWS 3102 and has three more LLB Alternate slots.</p></fieldset>' +
      '<fieldset><legend><span class="idx">04→</span>Finish earlier</legend><div class="rp-row"><button type="button" class="tbtn tbtn-outline" data-action="rp-fast" aria-pressed="false">Fast-Track Remaining</button>' +
      '<p class="cs-derived rp-fast-note">Sets the full-time load, then looks for a finish one or two sessions earlier.</p></div>' +
      '<div class="rp-fast-opts" id="rp-fast-opts" hidden><label class="check-row"><input type="checkbox" id="rp-summer" checked><span>Move LLB Alternates and electives into a Summer session (up to ' + SUMMER_CP + ' CP each)</span></label>' +
      '<label class="check-row"><input type="checkbox" id="rp-over" checked><span>Add one extra subject to a session (a 50 CP overload at full-time)</span></label></div></fieldset></div>' +
      '<section class="rp-preview" id="rp-preview" tabindex="0" aria-live="polite" aria-label="What this does to your plan"></section></div>' +
      '<div class="modal-foot"><span class="small muted">Confirm it with your Academic Program Advisor before you enrol.</span><div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn btn-ghost" data-action="modal-close">Cancel</button><button type="button" class="btn btn-primary" data-action="rp-apply" id="rp-apply">Apply →</button></div></div></div></div>');
    renderRePace();
  }
  function renderRePace() {
    const o = ui.repace;
    const ctx = lastCtx;
    if (!o || !$('#rp-preview')) return;
    document.querySelectorAll('[data-action="rp-load"]').forEach(function (b) { b.setAttribute('aria-pressed', String(+b.dataset.v === o.load)); });
    document.querySelectorAll('[data-action="rp-intake"]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.v === o.intake)); });
    document.querySelectorAll('input[name="rp-cohort"]').forEach(function (r) { r.checked = r.value === o.cohort; });
    document.querySelectorAll('input[name="rp-scope"]').forEach(function (r) { r.checked = r.value === o.scope; });
    $('[data-action="rp-fast"]').setAttribute('aria-pressed', String(o.fast));
    $('#rp-fast-opts').hidden = !o.fast;
    const apply = $('#rp-apply');
    const end = finishOf(ctx);
    const wasNo = end ? planStart() * 2 + studyNo(orderIdx(end.year, end.session)) : 0;
    const box = $('#rp-preview');
    if (paceIsView(ctx, o)) {
      const key = o.load === 20 ? 'PT' : 'FT';
      const f = lastIn(ctx, key);
      const same = key === state.load;
      apply.disabled = same;
      apply.textContent = 'Switch whole plan →';
      box.innerHTML = same
        ? '<p class="rp-summary">Your plan is already laid out at ' + PACE_NAME[o.load] + '.</p>'
        : '<p class="rp-summary">Whole plan at ' + PACE_NAME[o.load] + ' (' + o.load + ' CP/session) → Finishes ' + esc(f ? sessionLabel(f.year, f.session) : '') + '</p>' +
          (end && f ? '<p class="rp-change">From ' + esc(sessionLabel(end.year, end.session)) + ' to ' + esc(sessionLabel(f.year, f.session)) + ' · ' + sessionsApart(planStart() * 2 + studyNo(orderIdx(f.year, f.session)) - wasNo) + '</p>' : '') +
          '<p class="pick-hint">An indicative view of the WSLSA pathway, so your plan itself does not change.</p>';
      return;
    }
    const res = layoutPace(ctx, o);
    apply.disabled = !!res.unplaced.length || !res.todo.length;
    apply.textContent = 'Apply re-pace →';
    const parts = [];
    if (!res.todo.length) parts.push('<p class="rp-summary">' + (ctx.slots.length ? 'Every subject in your plan is already complete.' : 'Your plan has no subjects yet.') + '</p>');
    else if (res.unplaced.length) parts.push('<p class="cs-warn">This does not fit in the ' + MAX_YEARS + ' years a plan can hold, so ' + plural(res.unplaced.length, 'subject') + ' would be left out. Choose a heavier load.</p>');
    else {
      parts.push('<p class="rp-summary">' + esc(paceSummary(res, o)) + '</p>');
      if (end) parts.push('<p class="rp-change">From ' + esc(sessionLabel(end.year, end.session)) + ' to ' + esc(res.finishLabel) + ' · ' + sessionsApart(o.start * 2 + studyNo(res.finishK) - wasNo) + '</p>');
    }
    if (res.fast) {
      if (res.fast.gain > 0) {
        const summers = res.fast.moves.filter(function (m) { return m.way === 'summer'; });
        const extras = res.fast.moves.filter(function (m) { return m.way === 'extra'; });
        const free = res.fast.moves.filter(function (m) { return m.way === 'room'; });
        const uses = [];
        if (summers.length) uses.push(plural(summers.length, 'LLB Alternate or elective', 'LLB Alternates or electives') + ' in ' + plural(new Set(summers.map(function (m) { return m.k; })).size, 'Summer session'));
        if (free.length) uses.push(plural(free.length, 'subject') + ' brought forward');
        if (extras.length) uses.push(plural(extras.length, 'session') + ' at ' + (o.load + 10) + ' CP');
        parts.push('<p class="rp-fast-result"><b>Fast-Track finishes ' + plural(res.fast.gain, 'session') + ' earlier,</b> with ' + uses.join(', ') + '.' +
          (summers.length ? ' The guides have no Summer data, so check in the Handbook that each subject runs in Summer.' : '') +
          (extras.length && o.load === 40 ? ' An overload needs approval from the university.' : '') + '</p>');
      } else {
        parts.push('<p class="pick-hint">Fast-Track found no earlier finish with these settings.</p>');
      }
    }
    if (res.converted.length) parts.push('<p class="pick-hint"><b>Pre-2027 structure:</b> ' + esc(res.converted.join(', ')) + (res.converted.length === 1 ? ' becomes an LLB Alternate slot.' : ' become LLB Alternate slots.') + '</p>');
    if (res.restored.length) parts.push('<p class="pick-hint"><b>2027 structure:</b> ' + esc(res.restored.join(', ')) + (res.restored.length === 1 ? ' takes the place of an open LLB Alternate slot.' : ' take the place of open LLB Alternate slots.') + '</p>');
    if (res.dropped.length) parts.push('<p class="pick-hint">' + res.dropped.map(function (d) { return esc(d.code) + ' is not needed, as ' + esc(d.by) + ' counts for it'; }).join('. ') + '.</p>');
    const unsure = res.todo.filter(function (r) { return r.code && r.runs.unsure; }).map(function (r) { return r.code; });
    if (unsure.length) parts.push('<p class="pick-hint"><b>Check the Handbook:</b> ' + esc(unsure.join(', ')) + (unsure.length === 1 ? ' has' : ' have') + ' no published 2027 session, so each stays in the session type it was planned for.</p>');
    const late = res.todo.filter(function (r) { return PHASE_YEAR[r.code] && r.k >= 0 && o.start + Math.floor(r.k / 3) > PHASE_YEAR[r.code]; });
    if (late.length) parts.push('<p class="cs-warn">' + late.map(function (r) { return esc(r.code) + ' has its final offering in ' + PHASE_YEAR[r.code] + ', but this places it in ' + esc(termName(o.start + Math.floor(r.k / 3), PLAN_SESSIONS[r.k % 3])); }).join('. ') + '. Ask the School of Law how to fit it in.</p>');
    if (res.forced.length) parts.push('<p class="cs-warn">' + esc(res.forced.join(', ')) + ' could not be kept after ' + (res.forced.length === 1 ? 'its' : 'their') + ' known prerequisites. Check this plan with your Academic Program Advisor.</p>');
    const groups = {};
    res.todo.forEach(function (r) { if (r.k >= 0) (groups[r.k] = groups[r.k] || []).push(r); });
    const label = function (k) { return termName(o.start + Math.floor(k / 3), PLAN_SESSIONS[k % 3]); };
    const keys = Object.keys(groups).map(Number);
    if (res.loa >= 0) keys.push(res.loa);
    parts.push('<div class="progress-sessions rp-rows">' + keys.sort(function (a, b) { return a - b; }).map(function (k) {
      return '<div class="ps-row"><span class="ps-when">' + esc(label(k)) + '</span>' + (k === res.loa ? '<div class="rp-break">Leave of Absence</div>' : '<div class="chiplist">' + groups[k].sort(function (a, b) { return a.order - b.order; }).map(function (r) {
        return '<span class="chipbtn' + (r.code ? '' : ' is-open') + '"><code>' + esc(r.code || 'Open slot') + '</code></span>';
      }).join('') + '</div>') + '</div>';
    }).join('') + '</div>');
    box.innerHTML = parts.join('');
  }
  function applyRePace() {
    const ctx = lastCtx;
    const o = ui.repace;
    if (paceIsView(ctx, o)) {
      state.load = o.load === 20 ? 'PT' : 'FT';
      closeModal(true);
      renderMoving();
      toast('Whole plan switched to ' + PACE_NAME[o.load] + '.');
      return;
    }
    const res = layoutPace(ctx, o);
    if (res.unplaced.length || !res.todo.length) return;
    const summary = paceSummary(res, o);
    noteChange('re-paced your plan to ' + PACE_NAME[o.load]);
    // a WSLSA pathway is re-paced in place, as its edited copy
    const paced = pacedPlan(ctx, res, o);
    if (isCustom()) state.custom = paced; else state.edits[currentKey()] = paced;
    state.load = 'FT';
    ui.folded = null;
    closeModal(true);
    renderMoving();
    toast(summary + '.', { action: 'undo', label: 'Undo' });
  }

  // ======================================================================== degree transfer
  // What a student's completed subjects would count for in another degree. The same subject ticks off where
  // it stands; a subject a choice lists fills that choice; other non-law subjects can fill any-subject
  // electives, in one step, as credit is the university's decision and the student should choose it.
  function completedIn(ctx) {
    return ctx.slots.filter(function (s) { return s.done && !s.pending && s.code; }).map(function (s) {
      return { code: s.code, title: s.title, cp: s.cp, custom: !!s.custom };
    });
  }
  function sourceLabel(ctx) { return ctx.custom ? customName(ctx.plan, ctx.tdeg) : ctx.deg.code; }
  function pickFrom(c) {
    if (c.custom) return { code: c.code, title: c.title, custom: true };
    return EXTRA_BY_CODE[c.code] && !GLOBAL_BY_CODE[c.code] ? { code: c.code, title: c.title, list: true } : { code: c.code, title: c.title };
  }
  function transferTo(key, completed, credit) {
    const deg = DEG[key.split('|')[0]];
    const picks = Object.assign({}, state.picks[key] || {});
    const done = Object.assign({}, state.done[key] || {});
    const slots = guideSlots(key, picks, done, guideCohort(key));
    const taken = {};
    const out = { matched: [], chosen: [], electives: [], left: [], nonLaw: [], picks: picks, done: done, electiveSlots: 0 };
    let rest = completed.filter(function (c) {
      const s = slots.find(function (x) { return !taken[x.id] && !x.pending && sameAs(c.code).indexOf(x.code) >= 0; });
      if (!s) return true;
      taken[s.id] = 1;
      if (!done[s.id]) { done[s.id] = 1; out.matched.push(c); }
      return false;
    });
    const tctx = { deg: deg, custom: false, slots: slots };
    const open = slots.filter(function (s) { return s.pending && s.kind !== 'elective'; }).map(function (s) { return choiceList(tctx, s); }).filter(function (c) { return c.rank != null; });
    rest = rest.filter(function (c) {
      const fit = open.filter(function (o) { return !taken[o.s.id] && o.codes[c.code]; }).sort(function (a, b) { return a.rank - b.rank || a.at - b.at; })[0];
      if (!fit) return true;
      taken[fit.s.id] = 1;
      picks[fit.s.id] = pickFrom(c);
      done[fit.s.id] = 1;
      out.chosen.push(c);
      return false;
    });
    const electives = slots.filter(function (s) { return s.pending && s.kind === 'elective' && !done[s.id]; });
    out.electiveSlots = electives.length;
    out.nonLaw = rest.filter(function (c) { return !/^LAWS /.test(c.code) && c.cp === 10; });
    if (credit) {
      out.electives = out.nonLaw.slice(0, electives.length);
      out.electives.forEach(function (c, i) {
        picks[electives[i].id] = pickFrom(c);
        done[electives[i].id] = 1;
      });
    }
    out.left = rest.filter(function (c) { return out.electives.indexOf(c) < 0; });
    out.doneCP = PATH[key].reduce(function (a, r) { return a + (done[r.id] ? r.cp : 0); }, 0);
    out.cp = deg.cp;
    return out;
  }
  function writeTransfer(key, t) {
    state.picks[key] = t.picks;
    state.done[key] = t.done;
    // an edited pathway is shown from its own copy, so what is carried over is written there as well
    const e = state.edits[key];
    if (!e) return;
    t.matched.forEach(function (c) {
      const x = e.slots.find(function (y) { return !y.done && sameAs(c.code).indexOf(y.code) >= 0; });
      if (x) x.done = true;
    });
    Object.keys(t.picks).forEach(function (id) {
      const p = t.picks[id];
      if (!t.done[id] || e.slots.some(function (y) { return y.code === p.code; })) return;
      const x = e.slots.find(function (y) { return !y.code && y.o === id; });
      if (x) { x.code = p.code; x.title = p.custom ? p.title : ''; x.done = true; }
    });
  }
  function carryOver(from, key, completed) {
    if (!completed.length) { ui.credit = null; return null; }
    const t = transferTo(key, completed, false);
    const moved = t.matched.length + t.chosen.length;
    if (moved) {
      noteChange('carried your subjects over to ' + key.split('|')[0]);
      writeTransfer(key, t);
    }
    ui.credit = t.nonLaw.length && t.electiveSlots ? { key: key, from: from, completed: completed } : null;
    return { moved: moved, t: t, from: from, key: key };
  }
  function announceCarry(c) {
    if (!c || !c.moved) return;
    const list = c.t.matched.concat(c.t.chosen);
    const cp = list.reduce(function (a, x) { return a + x.cp; }, 0);
    toast('Carried over ' + plural(c.moved, 'completed subject') + ' (' + cp + ' CP) from ' + c.from + '. ' + c.t.doneCP + ' of ' + c.t.cp + ' CP of ' + c.key.split('|')[0] + ' finished.', { action: 'undo', label: 'Undo' });
  }
  function renderCreditOffer(ctx) {
    const box = $('#credit-offer');
    const c = ui.credit;
    const t = c && !ctx.custom && c.key === ctx.key ? transferTo(ctx.key, c.completed, true) : null;
    if (!t || !t.electives.length) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    box.hidden = false;
    box.innerHTML = '<div class="credit-card"><p><b>' + plural(t.electives.length, 'completed non-law subject') + ' from ' + esc(c.from) + ' could fill open electives here,</b> taking you to ' + t.doneCP + ' of ' + t.cp + ' CP. WSU decides credit, so confirm it with your Academic Program Advisor.</p>' +
      '<div class="credit-actions"><button type="button" class="tbtn tbtn-primary" data-action="credit-electives">Credit Completed Non-Law Units as Electives</button><button type="button" class="btn btn-ghost" data-action="credit-dismiss">Not now</button></div></div>';
  }
  function creditElectives() {
    const c = ui.credit;
    if (!c) return;
    const t = transferTo(c.key, c.completed, true);
    if (!t.electives.length) return;
    noteChange('credited ' + plural(t.electives.length, 'subject') + ' as electives');
    writeTransfer(c.key, t);
    ui.credit = null;
    ui.folded = null;
    renderMoving();
    toast('Credited ' + plural(t.electives.length, 'subject') + ' as electives. ' + t.doneCP + ' of ' + t.cp + ' CP of ' + c.key.split('|')[0] + ' finished.', { action: 'undo', label: 'Undo' });
  }
  function completedInKey(key) {
    const e = state.edits[key];
    if (e) {
      return e.slots.filter(function (x) { return x.done && x.code; }).map(function (x) {
        const k = GLOBAL_BY_CODE[x.code] || EXTRA_BY_CODE[x.code];
        return { code: x.code, title: k ? k.title : x.title, cp: x.cp, custom: !k };
      });
    }
    return guideSlots(key, state.picks[key] || {}, state.done[key] || {}, guideCohort(key))
      .filter(function (s) { return s.done && !s.pending && s.code; }).map(function (s) { return { code: s.code, title: s.title, cp: s.cp, custom: !!s.custom }; });
  }
  // the plan on screen first, then any other plan with subjects ticked off
  function transferSources() {
    const out = [];
    const here = lastCtx;
    if (here.doneCP > 0) out.push({ id: 'here', label: 'This plan: ' + (here.custom ? customName(here.plan, here.tdeg) : tplLabel(here.key)), completed: completedIn(here) });
    Array.from(new Set(Object.keys(state.done).concat(Object.keys(state.edits)))).forEach(function (key) {
      if (key === here.key) return;
      const completed = completedInKey(key);
      if (completed.length) out.push({ id: key, label: tplLabel(key), completed: completed });
    });
    return out.filter(function (s) { return s.completed.length; });
  }
  function openTransfer() {
    const sources = transferSources();
    const target = lastCtx.custom || lastCtx.deg.code !== '2848' ? '2848' : DEGREES.find(function (d) { return d.code !== '2848'; }).code;
    ui.transfer = { sources: sources, from: sources.length ? sources[0].id : '', deg: target, key: DEG[target].options[0], credit: true };
    ui.modal = 'transfer';
    showModal('<div class="modal-backdrop" data-action="backdrop"><div class="modal modal-setup" role="dialog" aria-modal="true" aria-labelledby="tr-h">' +
      '<div class="modal-head"><div><h2 id="tr-h">Simulate Degree Transfer</h2><p>See how your completed subjects would count in another degree. This is a simulation: WSU decides credit, so confirm it with the Law Enquiry Team or your Academic Program Advisor.</p></div><button type="button" class="modal-x" data-action="modal-close" aria-label="Close">×</button></div>' +
      '<div class="modal-body import-body" id="tr-body"></div>' +
      '<div class="modal-foot"><span class="small muted">Your current plan stays saved, and Undo reverses this.</span><div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn btn-ghost" data-action="modal-close">Cancel</button><button type="button" class="btn btn-primary" data-action="transfer-apply" id="tr-apply">Switch to this degree →</button></div></div></div></div>');
    renderTransfer();
  }
  function renderTransfer() {
    const u = ui.transfer;
    const body = $('#tr-body');
    if (!u || !body) return;
    if (!u.sources.length) {
      body.innerHTML = '<p class="pick-hint">Tick off the subjects you have completed first, or import your progress, then come back here.</p>';
      $('#tr-apply').disabled = true;
      return;
    }
    const src = u.sources.find(function (s) { return s.id === u.from; }) || u.sources[0];
    const deg = DEG[u.deg];
    const t = transferTo(u.key, src.completed, u.credit);
    const chips = function (list) { return '<div class="chiplist">' + list.map(function (c) { return '<span class="chipbtn"><code>' + esc(c.code) + '</code>' + esc(c.title) + '</span>'; }).join('') + '</div>'; };
    const part = function (title, list) { return list.length ? '<div class="pick-section"><h3><span>' + title + '</span><span>' + list.length + '</span></h3>' + chips(list) + '</div>' : ''; };
    const pct = t.cp ? Math.min(100, Math.round(t.doneCP / t.cp * 100)) : 0;
    const a = document.activeElement && document.activeElement.id;
    body.innerHTML =
      '<div class="tpl-fields tr-fields">' +
      '<div class="field tr-span"><label for="tr-from">Completed subjects from</label><div class="select-wrap"><select id="tr-from">' + u.sources.map(function (s) { return '<option value="' + esc(s.id) + '"' + (s === src ? ' selected' : '') + '>' + esc(s.label) + ' (' + plural(s.completed.length, 'subject') + ')</option>'; }).join('') + '</select></div></div>' +
      '<div class="field"><label for="tr-deg">Transfer to</label><div class="select-wrap"><select id="tr-deg">' + DEGREES.map(function (d) { return '<option value="' + d.code + '"' + (d.code === u.deg ? ' selected' : '') + '>' + esc(d.label) + '</option>'; }).join('') + '</select></div></div>' +
      '<div class="field"><label for="tr-major">Major / minor</label><div class="select-wrap"><select id="tr-major"' + (deg.options.length > 1 ? '' : ' disabled') + '>' + tplMajorOptions(u.deg, u.key) + '</select></div></div></div>' +
      '<div class="tr-score"><p><b>' + t.doneCP + ' of ' + t.cp + ' CP</b> of ' + esc(deg.code) + ' would already be finished.</p><span class="bar" aria-hidden="true"><span style="width:' + pct + '%"></span></span></div>' +
      (t.nonLaw.length && t.electiveSlots ? '<label class="check-row tr-credit"><input type="checkbox" id="tr-credit"' + (u.credit ? ' checked' : '') + '><span><b>Credit Completed Non-Law Units as Electives</b> (' + plural(Math.min(t.nonLaw.length, t.electiveSlots), 'subject') + ' into ' + plural(t.electiveSlots, 'open elective slot') + ')</span></label>' : '') +
      part('Same subject in this degree', t.matched) + part('LLB Alternates and choices', t.chosen) + part('Credited as electives', t.electives) + part('Not carried over', t.left);
    $('#tr-apply').disabled = false;
    if (a && document.getElementById(a)) document.getElementById(a).focus({ preventScroll: true });
  }
  function applyTransfer() {
    const u = ui.transfer;
    const src = u.sources.find(function (s) { return s.id === u.from; }) || u.sources[0];
    if (!src) return;
    const t = transferTo(u.key, src.completed, u.credit);
    const moved = t.matched.length + t.chosen.length + t.electives.length;
    noteChange('simulated a transfer to ' + u.deg);
    if (moved) writeTransfer(u.key, t);
    state.mode = 'guide';
    state.degree = u.deg;
    state.majorFor[u.deg] = u.key;
    ui.credit = !u.credit && t.nonLaw.length && t.electiveSlots ? { key: u.key, from: src.label.replace(/^This plan: /, ''), completed: src.completed } : null;
    ui.folded = null;
    closeModal(true);
    renderEntering();
    toast('Switched to ' + u.deg + ': ' + t.doneCP + ' of ' + t.cp + ' CP finished, with ' + plural(moved, 'subject') + ' carried over.', moved ? { action: 'undo', label: 'Undo' } : null);
  }

  // ======================================================================== snapshot and compare
  const PIN_KEY = STORE_KEY + ':pin';
  ui.pin = (function () {
    try {
      const p = JSON.parse(localStorage.getItem(PIN_KEY) || 'null');
      return p && Array.isArray(p.subjects) && typeof p.finish === 'string' ? p : null;
    } catch (e) { return null; }
  }());
  function writePin() {
    try {
      if (ui.pin) localStorage.setItem(PIN_KEY, JSON.stringify(ui.pin)); else localStorage.removeItem(PIN_KEY);
    } catch (e) { /* private mode: the snapshot still lasts until this page is closed */ }
  }
  function planSummary(ctx) {
    const sessions = sessionsInOrder(ctx);
    const end = sessions[sessions.length - 1];
    const subjects = [];
    let open = 0;
    let placed = 0;
    sessions.forEach(function (x) {
      x.slots.forEach(function (s) {
        if (s.pending) { open++; return; }
        placed += s.cp;
        subjects.push({ c: s.code, t: s.title, w: sessionLabel(x.year, x.session) });
      });
    });
    return {
      label: (ctx.custom ? (ctx.plan.code ? ctx.plan.code + ' ' : '') + customName(ctx.plan, ctx.tdeg) : ctx.deg.code + ' ' + ctx.deg.title) + (ctx.opt.majorCode !== 'BASE' ? ' · ' + ctx.opt.majorLabel : ''),
      load: paceNow(ctx) === 20 ? 'Part-time' : paceNow(ctx) === 30 ? '3-unit load' : 'Full-time',
      finish: end ? sessionLabel(end.year, end.session) : 'No subjects yet',
      sessions: sessions.length,
      summers: sessions.filter(function (x) { return x.session === 'Summer'; }).length,
      commute: sessions.filter(function (x) { return commutePill(x.slots); }).length,
      heavy: sessions.filter(function (x) { return loadPill(x.slots); }).length,
      placed: placed,
      open: open,
      subjects: subjects,
      pinned: today(),
    };
  }
  function pinItems() {
    return '<button type="button" class="tbtn pop-item" data-action="pin" title="Save this plan as a baseline, then change things and compare">' + (ui.pin ? 'Re-pin Snapshot' : 'Pin Snapshot') + '</button>' +
      (ui.pin ? '<button type="button" class="tbtn pop-item" data-action="compare">Compare with Pinned</button>' : '');
  }
  function pinPlan() {
    ui.pin = planSummary(lastCtx);
    writePin();
    if (ui.modal) closeModal(true);
    renderSectionHead(lastCtx);
    toast('Snapshot pinned: ' + ui.pin.label + ', finishing ' + ui.pin.finish + '. Make your changes, then compare.');
  }
  // What a plan would still need under a Handbook structure: the plan moved there on a copy, and counted.
  function handbookView(cohort) {
    const ctx = lastCtx;
    const tpl = ctx.custom ? ctx.plan.tpl : ctx.key;
    const plan = JSON.parse(JSON.stringify(ctx.custom ? ctx.plan : pathwayCopy(ctx.key)));
    if (cohortOf(plan) !== cohort) {
      plan.slots = restructure(tpl, plan.slots, cohort, plan.start);
      plan.need = restructureNeed(plan, cohort);
      plan.cohort = cohort === startCohort(plan.start) ? '' : cohort;
    }
    const c = withGuide(buildCustomContext(plan));
    const t = structureRows(tpl);
    const items = c.guide ? c.guide.items : [];
    const isAlt = function (s) { return !s.pending && (t.alt[s.code] && s.orig && s.orig.kind === 'llb' || (cohort === 'pre2027' && NEW_2027_CORES.indexOf(s.code) >= 0) || (s.orig && s.orig.kind === 'llb')); };
    const isCore = function (s) { return !s.pending && /^LAWS /.test(s.code) && !isAlt(s) && !!s.orig && (s.orig.kind === 'fixed' || s.orig.kind === 'option') && typeGroup(s.orig.type) === 'law'; };
    const deg = DEG[tpl.split('|')[0]];
    const parts = effectiveStructure(deg, cohort);
    const core = parts.find(function (p) { return /^Core - Laws/.test(p.component); }) || parts.find(function (p) { return p.component === 'Core'; });
    const llb = parts.find(function (p) { return /^LLB Alternate/.test(p.component); });
    const altDone = c.slots.filter(function (s) { return s.done && isAlt(s); });
    // every completed LLB Alternate on the degree's list counts here, wherever the plan has it
    const altPassed = c.slots.filter(function (s) { return s.done && !s.pending && t.alt[s.code]; });
    const coreLeft = c.slots.filter(function (s) { return !s.done && isCore(s); }).map(function (s) { return s.code; }).concat(items.filter(function (r) { return r.kind === 'law'; }).map(function (r) { return r.code; }));
    const altOpen = c.slots.filter(function (s) { return !s.done && s.orig && s.orig.kind === 'llb'; }).length + items.filter(function (r) { return r.kind === 'llb'; }).length;
    const left = Math.max(0, plan.cp - c.doneCP);
    return { cohort: cohort, core: core ? core.cp : 0, llb: llb ? llb.cp : 0, coreLabel: core ? core.component : 'Core', coreLeft: coreLeft, altDone: Math.max(altDone.length, altPassed.length), altOpen: altOpen, left: left, done: c.doneCP, newCores: Object.keys(t.core).filter(function (code) { return coreLeft.indexOf(code) >= 0; }) };
  }
  function openHandbookCompare() {
    const ctx = lastCtx;
    if (ctx.custom && !ctx.tdeg) { toast('A plan built from scratch has no Handbook structure to compare.'); return; }
    const now = ctxCohort(ctx);
    const a = handbookView('pre2027');
    const b = handbookView('2027');
    const row = function (label, x, y, same) { return '<tr' + (same || String(x) === String(y) ? '' : ' class="is-diff"') + '><th scope="row">' + label + '</th><td>' + x + '</td><td>' + y + '</td></tr>'; };
    const codes = function (v) { return v.coreLeft.length ? '<b>' + v.coreLeft.length + '</b> · ' + v.coreLeft.map(esc).join(', ') : '<b>None</b>'; };
    const cap2027 = b.llb / 10;
    const warn = [];
    if (a.altDone > cap2027) warn.push('You have completed ' + plural(a.altDone, 'LLB Alternate') + '. The 2027 Handbook counts ' + cap2027 + ' (' + b.llb + ' CP), so ' + plural(a.altDone - cap2027, 'subject') + ' may not count towards the degree if you move to it.');
    if (b.newCores.length) warn.push('Moving to the 2027 Handbook adds ' + b.newCores.join(', ') + ' as core subjects, in place of ' + plural(b.newCores.length, 'LLB Alternate') + ' you would otherwise choose.');
    const head = function (v, title) { return title + (now === v.cohort ? ' <span class="hc-now">Shown now</span>' : ''); };
    ui.modal = 'hcompare';
    showModal('<div class="modal-backdrop" data-action="backdrop"><div class="modal modal-compare" role="dialog" aria-modal="true" aria-labelledby="hc-h">' +
      '<div class="modal-head"><div><h2 id="hc-h">Pre-2027 vs 2027 Handbook</h2><p>What your progress leaves to do under each Handbook, for ' + esc(ctx.deg.code + ' ' + ctx.deg.title) + '. ' + a.done + ' CP is completed so far.</p></div><button type="button" class="modal-x" data-action="modal-close" aria-label="Close">×</button></div>' +
      '<div class="modal-body" style="padding:14px 20px 18px"><table class="compare-table hc-table"><thead><tr><th scope="col"><span class="sr-only">What is compared</span></th><th scope="col">' + head(a, 'Staying on the Pre-2027 Handbook') + '</th><th scope="col">' + head(b, 'Moving to the 2027 Handbook') + '</th></tr></thead><tbody>' +
      row(esc(a.coreLabel === 'Core' ? 'Core subjects required' : a.coreLabel.replace('Core - ', '') + ' core required'), a.core + ' CP', b.core + ' CP') +
      row('LLB Alternates required', a.llb + ' CP (' + a.llb / 10 + ' subjects)', b.llb + ' CP (' + b.llb / 10 + ' subjects)') +
      row('Law core still to complete', codes(a), codes(b), a.coreLeft.join() === b.coreLeft.join()) +
      row('LLB Alternates completed', a.altDone, Math.min(b.altDone, cap2027) + (b.altDone > cap2027 ? ' counted of ' + b.altDone : '')) +
      row('LLB Alternates still to choose', '<b>' + a.altOpen + '</b>', '<b>' + b.altOpen + '</b>') +
      row('Credit points still to complete', a.left + ' CP', b.left + ' CP') +
      '</tbody></table>' +
      (warn.length ? '<ul class="hc-warn">' + warn.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>' : '') +
      '<p class="small muted" style="margin:12px 0 0">The School of Law advises students who started before 2027 to stay on the Handbook of the year they started unless it tells them otherwise. This is a planning aid, not a decision: confirm any change with the School of Law at <a href="mailto:' + LAW_ENQUIRY + '">' + LAW_ENQUIRY + '</a> before you enrol.</p></div>' +
      '<div class="modal-foot"><span class="small muted">Switching here is the same as the Handbook choice in the bar, and Undo takes it back.</span><div style="display:flex;gap:8px;flex-wrap:wrap">' +
      '<button type="button" class="btn ' + (now === 'pre2027' ? 'btn-ghost' : 'btn-primary') + '" data-action="hc-switch" data-v="pre2027"' + (now === 'pre2027' ? ' disabled' : '') + '>Show Pre-2027</button>' +
      '<button type="button" class="btn ' + (now === '2027' ? 'btn-ghost' : 'btn-primary') + '" data-action="hc-switch" data-v="2027"' + (now === '2027' ? ' disabled' : '') + '>Show 2027</button>' +
      '<button type="button" class="btn btn-ghost" data-action="modal-close">Close</button></div></div></div></div>');
  }
  function openCompare() {
    const a = ui.pin;
    const b = planSummary(lastCtx);
    const row = function (label, x, y) {
      return '<tr' + (String(x) === String(y) ? '' : ' class="is-diff"') + '><th scope="row">' + esc(label) + '</th><td>' + esc(String(x)) + '</td><td>' + esc(String(y)) + '</td></tr>';
    };
    const byCode = function (s) { const m = {}; s.subjects.forEach(function (x) { if (!m[x.c]) m[x.c] = x; }); return m; };
    const was = byCode(a);
    const now = byCode(b);
    const added = Object.keys(now).filter(function (c) { return !was[c]; });
    const removed = Object.keys(was).filter(function (c) { return !now[c]; });
    const moved = Object.keys(now).filter(function (c) { return was[c] && was[c].w !== now[c].w; });
    const chip = function (x, extra) { return '<span class="chipbtn"><code>' + esc(x.c) + '</code>' + esc(x.t) + (extra ? ' <span>' + esc(extra) + '</span>' : '') + '</span>'; };
    const list = function (title, codes, draw) {
      return '<div class="pick-section"><h3><span>' + title + '</span><span>' + codes.length + '</span></h3>' +
        (codes.length ? '<div class="chiplist">' + codes.map(draw).join('') + '</div>' : '<p class="pick-hint">None.</p>') + '</div>';
    };
    ui.modal = 'compare';
    showModal('<div class="modal-backdrop" data-action="backdrop"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="compare-h">' +
      '<div class="modal-head"><div><h2 id="compare-h">Compare with pinned</h2><p>Your snapshot from ' + esc(a.pinned) + ' against your plan as it is now.</p></div><button type="button" class="modal-x" data-action="modal-close" aria-label="Close">×</button></div>' +
      '<div class="modal-body import-body"><div class="table-scroll" tabindex="0" role="region" aria-label="Comparison of your plans"><table class="compare-table"><thead><tr><th scope="col"></th><th scope="col">Pinned</th><th scope="col">Now</th></tr></thead><tbody>' +
      row('Plan', a.label, b.label) + row('Load', a.load, b.load) + row('Final completion session', a.finish, b.finish) +
      row('Total sessions', a.sessions, b.sessions) + row('Summer sessions used', a.summers, b.summers) +
      row('Multi-campus commute sessions', a.commute, b.commute) + row('Heavy L3/4 load sessions', a.heavy, b.heavy) +
      row('Credit points placed', a.placed + ' CP', b.placed + ' CP') + row('Open slots', a.open, b.open) +
      '</tbody></table></div>' +
      list('Subjects added', added, function (c) { return chip(now[c]); }) +
      list('Subjects removed', removed, function (c) { return chip(was[c]); }) +
      list('Subjects moved', moved, function (c) { return chip(now[c], was[c].w + ' → ' + now[c].w); }) +
      '</div><div class="modal-foot"><button type="button" class="btn btn-ghost" data-action="pin-clear">Remove pin</button><div style="display:flex;gap:8px;flex-wrap:wrap">' +
      '<button type="button" class="btn" data-action="pin">Pin this plan instead</button><button type="button" class="btn btn-primary" data-action="modal-close">Close</button></div></div></div></div>');
  }

  // ======================================================================== calendar reminder
  // The session start is an estimate (SESSION_BEGINS), and both the file and the toast say so.
  function icsText(s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n'); }
  function icsFold(line) {
    const parts = [];
    let cur = '';
    let size = 0;
    Array.from(line).forEach(function (ch) {
      const n = new TextEncoder().encode(ch).length;
      if (size + n > 73) { parts.push(cur); cur = ' '; size = 1; }
      cur += ch;
      size += n;
    });
    parts.push(cur);
    return parts.join('\r\n');
  }
  function exportIcs() {
    const ctx = lastCtx;
    const next = nextSession(ctx);
    if (!next) return;
    const label = sessionLabel(next.year, next.session);
    const begins = SESSION_BEGINS[next.session];
    const day = function (d) { return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0'); };
    const start = new Date(calYear(next.year), begins[0], begins[1]);
    const after = new Date(calYear(next.year), begins[0], begins[1] + 1);
    const planned = next.slots.filter(function (s) { return !s.done; }).map(function (s) {
      if (s.pending) return 'Still to choose: ' + s.title;
      const places = s.offer && s.offer.codes.length ? ' (' + s.offer.codes.map(function (c) { return META.campuses[c] || c; }).join(', ') + ')' : '';
      return s.code + ' ' + s.title + places;
    });
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//WSLSA//Degree Pathway Explorer//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
      'UID:' + Date.now() + '-' + Math.floor(Math.random() * 1e9) + '@wslsa-pathway',
      'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'),
      'DTSTART;VALUE=DATE:' + day(start), 'DTEND;VALUE=DATE:' + day(after),
      'SUMMARY:' + icsText(label + ' session (approximate start)'),
      'DESCRIPTION:' + icsText('Planned subjects:\n' + planned.join('\n') + '\n\nThis date is an estimate. Check the WSU key dates and your enrolment dates. From the WSLSA Degree Pathway Explorer.'),
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsText(label + ' is about two weeks away. Check your enrolment.'), 'TRIGGER:-P14D', 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR'];
    const url = URL.createObjectURL(new Blob([lines.map(icsFold).join('\r\n') + '\r\n'], { type: 'text/calendar;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'wslsa-' + label.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.ics';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('Calendar reminder saved for ' + label + '. The date is an estimate, so check the WSU key dates.');
  }

  // ======================================================================== render: main
  let lastCtx = null;
  function render() {
    const active = document.activeElement && document.activeElement.id;
    const ctx = buildContext();
    lastCtx = ctx;
    document.body.classList.toggle('has-campus', !!state.campus);
    renderHero(ctx);
    renderDock(ctx);
    renderAdvisory(ctx);
    renderTracker(ctx);
    renderCreditOffer(ctx);
    renderNext(ctx);
    renderSectionHead(ctx);
    renderLegend(ctx);
    renderMap(ctx);
    renderGrid(ctx);
    renderGuide(ctx);
    renderDetails(ctx);
    renderFoot(ctx);
    syncEnquiry(ctx);
    applyGridFilter();
    if (active && document.getElementById(active) && /^(sel-|cat-|custom-name)/.test(active)) document.getElementById(active).focus({ preventScroll: true });
    saveState();
    afterRender(ctx);
    if (ctx.custom && ctx.guide) sizeGuidePin();
    if (ui.modal === 'export') renderExportPreview();
  }

  // ======================================================================== undo and redo
  // Everything that changes a plan ends in saveState, so that is where a change is recorded: nothing can
  // slip past the history, and handlers only have to say what the change was called.
  const HISTORY_MAX = 30;
  const undoStack = [];
  const redoStack = [];
  let historyPlan = null;
  let historyView = null;
  let historyNote = '';
  let historyMerge = '';
  function planPart() { return JSON.stringify({ picks: state.picks, done: state.done, custom: state.custom, edits: state.edits, cohortFor: state.cohortFor }); }
  // which plan was on screen travels with it, so an undo always shows the plan it changed
  function viewPart() { return { mode: state.mode, degree: state.degree, majorFor: Object.assign({}, state.majorFor), load: state.load }; }
  function noteChange(label, merge) {
    historyNote = label;
    historyMerge = merge || '';
  }
  function recordHistory() {
    const plan = planPart();
    if (historyPlan !== null && plan !== historyPlan) {
      const top = undoStack[undoStack.length - 1];
      // typing a name is one change, not one for each letter
      if (!(historyMerge && top && top.merge === historyMerge)) {
        undoStack.push({ label: historyNote || 'your last change', plan: historyPlan, view: historyView, merge: historyMerge });
        if (undoStack.length > HISTORY_MAX) undoStack.shift();
      }
      redoStack.length = 0;
    }
    historyPlan = plan;
    historyView = viewPart();
    historyNote = '';
    historyMerge = '';
    syncHistoryButtons();
  }
  function historyButtons() {
    return '<button type="button" class="tbtn tbtn-history" data-action="undo" disabled>↶ Undo</button>' +
      '<button type="button" class="tbtn tbtn-history" data-action="redo" disabled>↷ Redo</button>';
  }
  function syncHistoryButtons() {
    const set = function (action, entry, word, keys) {
      document.querySelectorAll('#section-tools [data-action="' + action + '"], #mini-bar [data-action="' + action + '"]').forEach(function (b) {
        b.disabled = !entry;
        b.title = entry ? word + ': ' + entry.label + ' (' + keys + ')' : 'Nothing to ' + word.toLowerCase() + ' yet';
      });
    };
    set('undo', undoStack[undoStack.length - 1], 'Undo', UNDO_KEYS);
    set('redo', redoStack[redoStack.length - 1], 'Redo', REDO_KEYS);
  }
  function stepHistory(back) {
    const from = back ? undoStack : redoStack;
    const to = back ? redoStack : undoStack;
    const entry = from.pop();
    if (!entry) { toast(back ? 'Nothing to undo.' : 'Nothing to redo.'); return; }
    to.push({ label: entry.label, plan: historyPlan, view: viewPart() });
    const plan = JSON.parse(entry.plan);
    state.picks = plan.picks;
    state.done = plan.done;
    state.custom = plan.custom;
    state.edits = plan.edits || {};
    state.cohortFor = plan.cohortFor || {};
    state.mode = entry.view.mode;
    state.degree = entry.view.degree;
    state.majorFor = Object.assign({}, entry.view.majorFor);
    if (entry.view.load) state.load = entry.view.load;
    ui.folded = null;
    historyPlan = entry.plan;
    // the control in use is rebuilt with the page: focus stays with it, or moves to its partner once it has nothing left to do
    const a = document.activeElement;
    const action = a && a.dataset ? a.dataset.action : '';
    if (action === 'undo' || action === 'redo') {
      const spent = action === 'undo' ? !undoStack.length : !redoStack.length;
      focusBack = { action: spent ? (action === 'undo' ? 'redo' : 'undo') : action };
    } else if (action && a.dataset.slot) focusBack = { action: action, slot: a.dataset.slot };
    renderMoving();
    toast((back ? 'Undid: ' : 'Redid: ') + entry.label + '.', { action: back ? 'redo' : 'undo', label: back ? 'Redo' : 'Undo' });
  }
  // text is typed into a search box or a name, but a tick is an input too, and undo must still work from one
  function typingIn(el) {
    if (!el || !el.tagName) return false;
    if (el.isContentEditable || el.tagName === 'TEXTAREA') return true;
    return el.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|reset|file|range|color)$/i.test(el.type);
  }

  // ======================================================================== grid view and quick filter
  // what the Action needed view shows, and what the advisory counts: nothing here is about a finished subject
  function actionSlots(ctx) {
    const out = {};
    const r = ctx.risks;
    const add = function (list) { list.forEach(function (s) { if (!s.done) out[s.id] = 1; }); };
    [r.pending, r.tbc, r.notOffered, r.campus, r.summer, r.unlisted].forEach(add);
    r.advisor.forEach(function (a) { if (a.flagSlot) add([a.flagSlot]); });
    r.dupes.forEach(function (d) { add(d.slots); });
    r.overload.forEach(function (l) { add(ctx.slots.filter(function (s) { return s.year === l.year && s.session === l.session; })); });
    return out;
  }
  function slotMatches(s, q) {
    const scored = function (code, title) { return searchScore({ code: code || '', title: title || '' }, q) > 0; };
    if (scored(s.code, s.title)) return true;
    return !!(s.raw && s.raw.options) && s.raw.options.some(function (o) { return scored(o.code, o.title); });
  }
  function markSlotText(el, s, q) {
    if (!q && !el._marked) return;
    el._marked = !!q;
    el.querySelector('.subj-title').innerHTML = q ? hl(s.title, q) : esc(s.title);
    if (!s.pending) el.querySelector('.code-pill').innerHTML = q ? hlCode(s.code, q) : esc(s.code);
  }
  // Applies the view and the filter to the cards on the page. Ticking passes keepFolds, so a year does
  // not fold under a student's hand, and a card ticked a moment ago (.just-done) stays until the next render.
  function applyGridFilter(keepFolds) {
    const ctx = lastCtx;
    const grid = $('#grid');
    const view = state.view;
    const q = normQ(ui.gridQ);
    const action = actionSlots(ctx);
    const marks = {};
    const matches = [];
    let hiddenHits = 0;
    let shownCards = 0;
    grid.classList.toggle('view-remaining', view === 'remaining');
    grid.classList.toggle('view-action', view === 'action');
    ui.yearInfo = {};
    timeline(ctx, state.load).forEach(function (y) {
      const box = document.getElementById('year-' + y.year);
      if (!box) return;
      const all = y.Autumn.concat(y.Spring, y.Summer);
      const showDone = view === 'remaining' && ui.viewFold[y.year] === false;
      ui.yearInfo[y.year] = { finished: all.length > 0 && all.every(function (s) { return s.done; }), action: all.some(function (s) { return action[s.id]; }) };
      box.classList.toggle('show-done', showDone);
      let yearShown = 0;
      let yearHits = 0;
      PLAN_SESSIONS.forEach(function (sess) {
        const section = box.querySelector('.session[data-s="' + sess + '"]');
        if (!section) return;
        let shown = 0;
        sortSlots(y[sess]).forEach(function (s) {
          const el = document.getElementById('slot-' + s.id);
          if (!el) return;
          const just = el.classList.contains('just-done');
          const visible = view === 'remaining' ? !s.done || just || showDone : view === 'action' ? !!action[s.id] || just : true;
          const hit = !!q && slotMatches(s, q);
          el.classList.toggle('is-action', !!action[s.id]);
          el.classList.toggle('is-match', hit);
          markSlotText(el, s, hit ? q : '');
          if (visible) shown++;
          if (hit) {
            marks[s.id] = 1;
            if (visible) { matches.push(s.id); yearHits++; } else hiddenHits++;
          } else if (!q && view === 'action' && action[s.id]) marks[s.id] = 1;
        });
        yearShown += shown;
        const clear = y[sess].length > 0 && !shown;
        section.classList.toggle('view-clear', clear);
        section.querySelector('.session-clear').textContent = clear ? (view === 'remaining' ? 'Everything in this session is done.' : 'Nothing in this session needs action.') : '';
      });
      shownCards += yearShown;
      // a year with nothing in it yet is waiting to be planned, so no view hides it
      box.classList.toggle('view-none', view === 'action' && !yearShown && all.length > 0);
      box.classList.toggle('has-match', yearHits > 0);
      if (!keepFolds) showYearFold(y.year);
    });
    grid.classList.toggle('is-filtering', matches.length > 0);
    applyTrack();
    // the map marks where the matches are, as they may be far from the screen
    const map = $('#dmap');
    map.querySelectorAll('.dm-seg i').forEach(function (i) { i.classList.toggle('hit', !!marks[i.dataset.slot]); });
    map.querySelectorAll('.dm-year').forEach(function (li) {
      li.querySelectorAll('.dm-s').forEach(function (b) { b.classList.toggle('has-hit', !!b.querySelector('i.hit')); });
      li.querySelector('.dm-y').classList.toggle('has-hit', !!li.querySelector('i.hit'));
    });
    $('#gv-remaining').textContent = ctx.slots.filter(function (s) { return !s.done; }).length;
    $('#gv-action').textContent = Object.keys(action).length;
    ui.matchIds = matches;
    if (ui.matchAt >= matches.length) ui.matchAt = -1;
    let status = '';
    if (q) {
      status = matches.length ? plural(matches.length, 'match', 'matches') + '<span class="wide-only">' + (matches.length > 1 ? ' · Enter for next' : ' · Enter to go there') + '</span>' : 'No match';
      if (hiddenHits) status += ' · ' + hiddenHits + ' hidden';
    }
    $('#grid-status').innerHTML = status;
    $('#grid-q').classList.toggle('no-match', !!q && !matches.length);
    const empty = $('#grid-empty');
    const none = view !== 'all' && !shownCards && ctx.slots.length > 0;
    empty.hidden = !none;
    if (none) empty.innerHTML = (view === 'remaining' ? '<b>Every subject in this plan is ticked off.</b>' : '<b>Nothing in this plan needs action right now.</b>') + ' <button type="button" class="linkish" data-action="grid-view" data-view="all">Show everything</button>';
  }
  function setGridView(view) {
    state.view = view;
    ui.viewFold = {};
    document.querySelectorAll('.view-modes button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.view === view)); });
    $('#grid').querySelectorAll('.just-done').forEach(function (el) { el.classList.remove('just-done'); });
    applyGridFilter();
    saveState();
  }
  // the bar joins the sticky stack only while the filter is in use, so it costs no height the rest of the time
  function syncGridBar() {
    const bar = $('#gridbar');
    const on = document.activeElement === $('#grid-q') || !!ui.gridQ;
    bar.classList.toggle('is-searching', on);
    // on a phone only the search row needs to stay, so the view buttons above it slide off the top
    const hide = window.innerWidth <= 760 ? $('.grid-search').offsetTop : 0;
    const root = document.documentElement.style;
    root.setProperty('--bar-hide', hide + 'px');
    root.setProperty('--bar-h', on ? Math.max(0, bar.offsetHeight - hide) + 'px' : '0px');
  }
  function focusGridFilter() {
    const q = $('#grid-q');
    $('#gridbar').classList.add('is-searching');
    const r = q.getBoundingClientRect();
    q.focus({ preventScroll: r.top >= 0 && r.bottom <= window.innerHeight });
    syncGridBar();
    q.select();
  }
  function clearGridFilter() {
    $('#grid-q').value = '';
    ui.gridQ = '';
    ui.matchAt = -1;
    applyGridFilter(true);
    syncGridBar();
  }
  function stepMatch(dir) {
    const ids = ui.matchIds;
    if (!ids.length) return;
    ui.matchAt = (ui.matchAt + dir + ids.length) % ids.length;
    flashSlot(ids[ui.matchAt]);
    $('#grid-status').textContent = (ui.matchAt + 1) + ' of ' + ids.length;
  }

  // ======================================================================== mutations
  function setPick(slotId, pick) {
    const key = currentKey();
    state.picks[key] = state.picks[key] || {};
    if (pick) state.picks[key][slotId] = pick; else delete state.picks[key][slotId];
    if (!Object.keys(state.picks[key]).length) delete state.picks[key];
  }
  function setMajor(newKey) {
    const prev = currentKey();
    state.majorFor[state.degree] = newKey;
    // carry LLB alternate and elective picks into the new pathway where the same slot is still free
    const prevPicks = state.picks[prev] || {};
    PATH[newKey].forEach(function (raw) {
      const oldRaw = PATH[prev].find(function (r) { return r.id === raw.id; });
      const p = prevPicks[raw.id];
      if (!p || !oldRaw || oldRaw.kind !== raw.kind || (raw.kind !== 'llb' && raw.kind !== 'elective')) return;
      state.picks[newKey] = state.picks[newKey] || {};
      if (!state.picks[newKey][raw.id]) state.picks[newKey][raw.id] = p;
    });
  }
  function flashSlot(id, stay) {
    const el = document.getElementById('slot-' + id);
    if (!el) return;
    const home = el.closest('.year');
    // a jump to a card that this view hides goes back to showing everything
    if (state.view !== 'all' && (getComputedStyle(el).display === 'none' || (home && home.classList.contains('view-none')))) setGridView('all');
    if (home && home.classList.contains('is-folded')) setYearFold(+home.id.replace('year-', ''), false);
    if (!stay) el.scrollIntoView({ behavior: scrollMode(), block: 'center' });
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }
  let toastTimer = null;
  function toast(msg, act) {
    const t = $('#toast');
    t.textContent = msg;
    if (act) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'toast-action';
      b.dataset.action = act.action;
      b.textContent = act.label;
      t.appendChild(b);
    }
    t.classList.toggle('has-action', !!act);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, act ? 8000 : 2600);
  }

  // ======================================================================== assign from the catalogue
  const SESS_SHORT = { Autumn: 'A', Spring: 'S', Summer: 'Su' };
  // the year a slot shows under at the current load, as part-time spreads a plan over more years
  function shownYear(ctx, s) {
    if (!ctx.shownYears) {
      ctx.shownYears = {};
      timeline(ctx, state.load).forEach(function (y) {
        PLAN_SESSIONS.forEach(function (sess) { y[sess].forEach(function (x) { ctx.shownYears[x.id] = y.year; }); });
      });
    }
    return ctx.shownYears[s.id] || s.year;
  }
  function shownWhere(ctx, s) { return 'Year ' + shownYear(ctx, s) + ' ' + s.session; }
  function planCell(ctx, code) {
    const ids = ctx.used[code];
    if (!ids) return '<td class="c-plan"><button type="button" class="assign-btn" data-action="assign-open" data-code="' + esc(code) + '" aria-label="Assign ' + esc(code) + ' to your plan">+ Assign</button></td>';
    const s = ctx.byId[ids[0]];
    return '<td class="c-plan"><button type="button" class="plan-badge" data-action="cat-jump" data-slot="' + s.id + '" data-code="' + esc(code) + '" title="Go to ' + esc(code) + ' in ' + shownWhere(ctx, s) + (s.done ? ', completed' : '') + '">In Plan (Y' + shownYear(ctx, s) + SESS_SHORT[s.session] + ') ↗</button></td>';
  }
  // whether a subject runs in the session of the slot on offer
  function assignOffer(ctx, code, s) {
    if (s.session === 'Summer') return { ok: false, label: 'Check the Handbook for Summer' };
    const off = offerFor(ctx.deg, code, s.session);
    if (!off) return { ok: false, label: 'No session data, so check the Handbook' };
    if (off.none) return { ok: false, label: 'Not offered in ' + s.session };
    if (off.tbc) return { ok: false, label: s.session + ' session TBC' };
    const campuses = off.codes.join(', ');
    if (state.campus && off.codes.indexOf(state.campus) < 0 && off.codes.indexOf('ON') < 0) return { ok: false, label: 'In ' + s.session + ' at ' + campuses + ', not ' + state.campus + ' or online' };
    return { ok: true, label: 'Offered in ' + s.session + ': ' + campuses };
  }
  function assignRow(ctx, code, s, count) {
    const o = assignOffer(ctx, code, s);
    return '<button type="button" class="pick assign-slot" data-action="assign-to" data-slot="' + s.id + '"><span class="p-code">Y' + shownYear(ctx, s) + SESS_SHORT[s.session] + '</span>' +
      '<span class="p-title">Year ' + shownYear(ctx, s) + ' · ' + sessionLabel(shownYear(ctx, s), s.session) + '</span>' +
      '<span class="p-side"><span class="flag ' + (o.ok ? 'flag-done' : 'flag-tbc') + '">' + esc(o.label) + '</span></span>' +
      '<span class="p-meta"><span>' + esc(s.title) + (count > 1 ? ' · ' + count + ' open' : '') + '</span></span></button>';
  }
  function offerSummary(ctx, code) {
    const part = function (sess) {
      const off = offerFor(ctx.deg, code, sess);
      if (!off) return '';
      return sess + ': ' + (off.none ? 'not offered' : off.tbc ? 'TBC' : off.codes.join(', '));
    };
    return [part('Autumn'), part('Spring')].filter(Boolean).join(' · ') || 'Sessions not listed, so check the Handbook';
  }
  function openAssign(code) {
    const ctx = lastCtx;
    const e = ctx.deg.byCode[code] || GLOBAL_BY_CODE[code] || EXTRA_BY_CODE[code];
    if (!e) return;
    ui.modal = 'assign';
    ui.assign = { code: code };
    const named = [];
    const others = [];
    ctx.slots.forEach(function (s) {
      if (!s.pending || s.done) return;
      const listed = !!choiceList(ctx, s).codes[code];
      if (ctx.custom) (listed ? named : others).push(s);
      else if (listed || s.kind === 'elective') named.push(s);
    });
    const order = function (list) {
      return list.map(function (s) { return [s, assignOffer(ctx, code, s).ok ? 0 : 1]; }).sort(function (a, b) { return a[1] - b[1] || orderIdx(a[0].year, a[0].session) - orderIdx(b[0].year, b[0].session) || a[0].raw.slot - b[0].raw.slot; }).map(function (x) { return x[0]; });
    };
    const section = function (title, list) {
      if (!list.length) return '';
      const rows = {};
      order(list).forEach(function (s) { const k = shownYear(ctx, s) + s.session + s.title; (rows[k] = rows[k] || []).push(s); });
      return '<div class="pick-section"><h3><span>' + title + '</span><span>' + list.length + '</span></h3><div class="pick-list">' + Object.keys(rows).map(function (k) { return assignRow(ctx, code, rows[k][0], rows[k].length); }).join('') + '</div></div>';
    };
    let body = section(ctx.custom ? 'Open slots that list this subject' : 'Open slots that can take this subject', named) + section('Other open slots in your plan', others);
    // any plan can make room for it, a WSLSA pathway as its edited copy
    if (state.load !== 'PT') {
      const next = nextSession(ctx);
      const at = next ? orderIdx(next.year, next.session) : 0;
      const t = nextOffered(ctx.deg, code, at - 1, at);
      if (t) body += '<div class="pick-section"><h3>Or make room for it</h3><div class="pick-list"><button type="button" class="pick assign-slot" data-action="assign-new" data-y="' + t.y + '" data-s="' + t.s + '"><span class="p-code">New slot</span><span class="p-title">Add a slot in Year ' + t.y + ' · ' + sessionLabel(t.y, t.s) + '</span><span class="p-meta"><span>' + (t.unsure ? 'Its sessions are not published, so check the Handbook' : 'The next session it runs in') + '</span></span></button></div></div>';
    }
    if (!named.length && !others.length && !ctx.custom) {
      body += '<div class="pick-empty"><p>No open slot in this pathway can take ' + esc(code) + '. Every slot it could fill already has a subject, or the pathway has none for it.</p><p>Add it in a new slot above, which keeps your edited copy of this pathway, or clear a choice first.</p></div>';
    }
    showModal('<div class="modal-backdrop" data-action="backdrop"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="assign-h">' +
      '<div class="modal-head"><div><h2 id="assign-h">Assign ' + esc(code) + '</h2><p>' + esc(e.title) + (e.cp != null ? ' · ' + e.cp + ' CP' : '') + ' · ' + esc(offerSummary(ctx, code)) + '</p></div><button type="button" class="modal-x" data-action="modal-close" aria-label="Close">×</button></div>' +
      '<div class="modal-body">' + body + '</div>' +
      '<div class="modal-foot"><span class="small muted">A session it does not run in stays open to you, so confirm it in the 2027 Handbook first.</span><button type="button" class="btn btn-ghost" data-action="modal-close">Cancel</button></div></div></div>');
    lockScroll();
  }
  function assignSubject(slotId, code) {
    const ctx = lastCtx;
    const s = ctx.byId[slotId];
    const g = GLOBAL_BY_CODE[code];
    const x = EXTRA_BY_CODE[code];
    const e = ctx.deg.byCode[code] || g || x;
    if (!s || !e) return;
    const place = shownWhere(ctx, s);
    noteChange('assigned ' + code + ' to ' + place);
    if (ctx.custom) setCustomSubject(s.idx, code, '', g ? g.cp : null);
    else if (!g && x) setPick(s.id, { code: x.code, title: x.title, list: true });
    else setPick(s.id, { code: e.code, title: e.title });
    // the student stays in the catalogue, on the row they were using, to assign the next one
    focusBack = null;
    closeModal(true);
    render();
    const badge = document.querySelector('#cat-results .plan-badge[data-code="' + code + '"]');
    if (badge) {
      badge.focus({ preventScroll: true });
      badge.classList.add('flash');
    }
    toast(code + ' assigned to ' + place + '.', { action: 'undo', label: 'Undo' });
  }

  // ======================================================================== picker modal
  function openPicker(slotId) {
    ui.modal = 'picker';
    ui.picker = { slotId: slotId, q: '', area: '', campusOnly: !!state.campus, showOff: false, level: '', ugOnly: true, custom: !!(lastCtx && lastCtx.custom) };
    renderPicker(true);
  }
  function pickerTitle(s) {
    if (s.kind === 'llb') return 'Choose an LLB Alternate subject';
    if (s.kind === 'elective') return 'Choose an elective';
    if (s.kind === 'option') return 'Swap this major option';
    return 'Choose: ' + cleanPoolTitle(s.raw.title);
  }
  function renderPicker(first) {
    if (ui.picker.custom) { renderCustomPicker(first); return; }
    const ctx = lastCtx;
    const s = ctx.byId[ui.picker.slotId];
    const p = ui.picker;
    const levels = s.kind === 'llb' || s.kind === 'elective' ? ['Level 2', 'Level 3', 'Level 4'] : [];
    let tools = '<div class="tool-row"><input class="input" id="pick-q" type="search" placeholder="' + (s.kind === 'elective' && EXTRA.length ? 'Search any WSU subject by code or title' : 'Search code or title') + '" value="' + esc(p.q) + '" style="flex:1;min-width:200px" aria-label="Search subjects"></div><div class="tool-row">';
    if (state.campus) tools += '<button type="button" class="chip" data-action="pick-campus" aria-pressed="' + p.campusOnly + '">' + esc(META.campuses[state.campus]) + ' or online only</button>';
    levels.forEach(function (l) { tools += '<button type="button" class="chip" data-action="pick-level" data-level="' + l + '" aria-pressed="' + (p.level === l) + '">' + l + '</button>'; });
    if (s.kind === 'elective' && EXTRA.length) tools += '<button type="button" class="chip" data-action="pick-ug" aria-pressed="' + p.ugOnly + '" title="Hide level 0 and level 5 to 9 subjects from the WSU subject list">Undergraduate levels 1–4</button>';
    tools += '<button type="button" class="chip" data-action="pick-off" aria-pressed="' + p.showOff + '">Show subjects not offered in ' + s.session + '</button></div>';
    const areas = s.kind === 'llb' || s.kind === 'elective';
    if (areas) tools += areaTools('pick-area', p.area);

    const custom = s.kind === 'elective'
      ? '<div class="pick-section"><h3>Not on the list? Enter it yourself</h3><form class="custom-form" id="custom-form"><div class="field"><label for="cu-code">Code</label><input class="input" id="cu-code" placeholder="e.g. HUMN 1052" maxlength="12" value="' + esc(s.custom ? s.code : '') + '"></div><div class="field"><label for="cu-title">Title</label><input class="input" id="cu-title" placeholder="Subject title" maxlength="120" value="' + esc(s.custom ? s.title : '') + '"></div><button type="submit" class="btn btn-primary">Use subject</button></form><p class="small muted" style="margin:4px 8px 0">Check prerequisites and session availability in the 2027 Handbook.</p></div>'
      : '';

    showModal('<div class="modal-backdrop" data-action="backdrop"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="picker-h">' +
      '<div class="modal-head"><div><h2 id="picker-h">' + esc(pickerTitle(s)) + '</h2><p>' + where(s) + ' · ' + s.cp + ' CP · ' + esc(ctx.deg.code) + ' ' + esc(ctx.opt.majorCode !== 'BASE' ? ctx.opt.majorLabel : ctx.deg.title) + '</p></div><button type="button" class="modal-x" data-action="modal-close" aria-label="Close">×</button></div>' +
      '<div class="modal-tools">' + tools + toolsNote(areas, KEY_HINT) + '</div>' +
      '<div class="modal-body"><div id="pick-results"></div>' + custom + '</div>' +
      '<div class="modal-foot"><span class="small muted">Subjects already in your plan are disabled. TBC = 2027 session not yet published.</span><div style="display:flex;gap:8px">' +
      (s.pick ? '<button type="button" class="btn" data-action="pick-clear">' + (s.kind === 'option' ? 'Reset to WSLSA pick' : 'Clear choice') + '</button>' : '') +
      '<button type="button" class="btn btn-ghost" data-action="modal-close">Cancel</button></div></div></div></div>');
    lockScroll();
    renderPickerResults();
    if (first) { const q = $('#pick-q'); if (q && window.matchMedia('(pointer:fine)').matches) q.focus(); }
  }
  function renderPickerResults() {
    if (ui.picker.custom) { renderCustomPickerResults(); return; }
    const ctx = lastCtx;
    const s = ctx.byId[ui.picker.slotId];
    const p = ui.picker;
    const q = normQ(p.q);
    const groups = { offered: [], tbc: [], off: [] };
    let hiddenByCampus = 0;
    rankByQuery(poolEntries(ctx, s.raw), q).forEach(function (e) {
      if (p.level && e.level !== p.level) return;
      if (!inArea(e.code, p.area)) return;
      const off = offerFor(ctx.deg, e.code, s.session);
      if (off.tbc) groups.tbc.push({ e: e, off: off });
      else if (off.none) groups.off.push({ e: e, off: off });
      else {
        if (p.campusOnly && state.campus && off.codes.indexOf(state.campus) < 0 && off.codes.indexOf('ON') < 0) { hiddenByCampus++; return; }
        groups.offered.push({ e: e, off: off });
      }
    });
    // elective slots also search the WSU subject list
    const listOn = s.kind === 'elective' && EXTRA.length > 0;
    const shownCodes = {};
    if (listOn) poolEntries(ctx, s.raw).forEach(function (e) { shownCodes[e.code] = 1; });
    const listPool = listOn ? ANY_SUBJECTS.filter(function (e) { return !shownCodes[e.code] && (!p.ugOnly || (e.lv >= 1 && e.lv <= 4)) && (!p.level || e.level === p.level) && inArea(e.code, p.area); }) : [];
    const listHits = listOn && q.length >= 2 ? rankByQuery(listPool, q) : [];
    // the single most relevant subject across every list is pinned to the top
    // labelled only when it is an exact code or title match, or clearly ahead of the next result
    let best = null;
    if (q.length >= 2) {
      const cands = groups.offered.concat(groups.tbc).map(function (i) { return { src: 'pool', item: i, e: i.e, score: searchScore(i.e, q) }; });
      // an exact match that does not run this session is still surfaced, so students learn why
      groups.off.forEach(function (i) { const sc = searchScore(i.e, q); if (sc >= 950) cands.push({ src: 'pool', off: true, item: i, e: i.e, score: sc }); });
      listHits.slice(0, 2).forEach(function (e) { cands.push({ src: 'list', e: e, score: searchScore(e, q) }); });
      cands.sort(function (a, b) { return b.score - a.score; });
      const top = cands[0];
      const next = cands[1] ? cands[1].score : 0;
      if (top && (top.score >= 950 || (top.score >= 70 && top.score - next >= 40))) best = top;
    }
    const bestCode = best ? best.e.code : null;
    function statusFor(e, badge) {
      const current = s.code === e.code && !s.pending;
      const clash = !current && usedElsewhere(ctx, e.code, s.id);
      return { current: current, clash: clash, html: (badge ? '<span class="status status-best">' + badge + '</span>' : '') + (current ? '<span class="status status-essential">Selected</span>' : clash ? '<span class="status status-non">In plan</span>' : '') };
    }
    function row(item, disabledReason, badge) {
      const e = item.e;
      const st = statusFor(e, badge);
      const other = sessionValue(e, s.session === 'Autumn' ? 'Spring' : 'Autumn');
      return '<button type="button" class="pick" data-action="pick" data-code="' + esc(e.code) + '"' + (st.clash || disabledReason ? ' disabled' : '') + (st.current ? ' aria-current="true"' : '') + '>' +
        '<span class="p-code">' + hlCode(e.code, q) + '</span><span class="p-title">' + hl(e.title, q) + '</span>' +
        '<span class="p-side"><span class="pills">' + pillsFor(item.off) + '</span>' + st.html + '</span>' +
        '<span class="p-meta"><span>' + esc(e.level || '') + '</span>' + areaTags(e.code) + '<span>' + esc(e.source || '') + '</span>' + (other && other !== '—' ? '<span>' + (s.session === 'Autumn' ? 'Spring' : 'Autumn') + ': ' + esc(other) + '</span>' : '') + (s.kind !== 'llb' && s.kind !== 'elective' ? '<span>' + esc(e.component.replace(/^.*?: /, '')) + '</span>' : '') + (s.kind === 'elective' ? '<span>LLB Alternate</span>' : '') + '</span></button>';
    }
    function listRow(e, badge) {
      const st = statusFor(e, badge);
      const off = e.handbook ? offerFor(ctx.deg, e.code, s.session) : null;
      return '<button type="button" class="pick" data-action="pick" data-src="list" data-code="' + esc(e.code) + '"' + (st.clash ? ' disabled' : '') + (st.current ? ' aria-current="true"' : '') + '>' +
        '<span class="p-code">' + hlCode(e.code, q) + '</span><span class="p-title">' + hl(e.title, q) + '</span>' +
        '<span class="p-side">' + (off ? '<span class="pills">' + pillsFor(off) + '</span>' : '<span class="muted small">Check Handbook</span>') + st.html + '</span>' +
        '<span class="p-meta"><span>' + esc(e.level) + '</span><span>' + (e.handbook ? '2027 Handbook data' : 'WSU subject list') + '</span>' + (off && off.none ? '<span>Not offered in ' + s.session + '</span>' : '') + '</span></button>';
    }
    const notBest = function (i) { return (i.e || i).code !== bestCode; };
    let html = '';
    if (best) {
      const badge = best.score >= 950 ? 'Exact match' : 'Best match';
      const otherSession = s.session === 'Autumn' ? 'Spring' : 'Autumn';
      html += '<div class="pick-section pick-best"><h3><span>' + badge + '</span></h3><div class="pick-list">' + (best.src === 'list' ? listRow(best.e, badge) : row(best.item, best.off ? 'off' : false, badge)) + '</div>' +
        (best.off ? '<p class="pick-hint">' + esc(best.e.code) + ' runs only in ' + otherSession + ', so it cannot go in this ' + s.session + ' slot.</p>' : '') + '</div>';
    }
    const offered = groups.offered.filter(notBest);
    const tbc = groups.tbc.filter(notBest);
    const offeredHead = (s.kind === 'elective' ? 'LLB Alternates offered in ' : 'Offered in ') + s.session + ' 2027';
    if (offered.length || !q || s.kind !== 'elective') {
      html += '<div class="pick-section"><h3><span>' + offeredHead + '</span><span>' + offered.length + (hiddenByCampus ? ' · ' + hiddenByCampus + ' hidden by campus filter' : '') + '</span></h3><div class="pick-list">' +
        (offered.length ? offered.map(function (i) { return row(i); }).join('') : '<div class="pick-empty">' + (best && best.src === 'pool' ? 'No other matches' : 'No matching subjects') + ' offered in ' + s.session + '.' + CLEAR_PICK + '</div>') + '</div></div>';
    } else {
      html += '<p class="pick-hint">No ' + (best && best.src === 'pool' ? 'other ' : '') + 'LLB Alternates offered in ' + s.session + ' match “' + esc(p.q.trim()) + '”.</p>';
    }
    if (tbc.length) html += '<div class="pick-section"><h3><span>Session TBC (not yet published for 2027)</span><span>' + tbc.length + '</span></h3><div class="pick-list">' + tbc.map(function (i) { return row(i); }).join('') + '</div></div>';
    if (listOn) html += extraPickSection(p, q, listPool, listHits.filter(notBest), listRow, best && best.src === 'list');
    groups.off = groups.off.filter(notBest);
    if (p.showOff && groups.off.length) html += '<div class="pick-section"><h3><span>Not offered in ' + s.session + '</span><span>' + groups.off.length + '</span></h3><div class="pick-list">' + groups.off.map(function (i) { return row(i, 'off'); }).join('') + '</div></div>';
    else if (groups.off.length) html += '<p class="small muted" style="margin:10px 8px">' + plural(groups.off.length, 'matching subject') + ' in this list ' + (groups.off.length === 1 ? 'runs' : 'run') + ' only in ' + (s.session === 'Autumn' ? 'Spring' : 'Autumn') + '.</p>';
    $('#pick-results').innerHTML = html;
  }
  // Elective slots can also take any subject from the WSU subject list.
  function extraPickSection(p, q, pool, hits, listRow, bestFromList) {
    const head = '<div class="pick-section"><h3><span>Any WSU subject · subject list and 2027 Handbook</span><span>';
    if (q.length < 2) {
      return head + pool.length.toLocaleString('en-AU') + ' subjects</span></h3><p class="pick-hint">Type a subject code (for example ACCT2004) or words from its name above to search ' + pool.length.toLocaleString('en-AU') + ' more WSU subjects' + (p.ugOnly ? ' at undergraduate levels 1–4' : '') + '. The list gives codes and titles only, so check sessions and prerequisites in the 2027 Handbook.</p></div>';
    }
    return head + hits.length.toLocaleString('en-AU') + (hits.length === 1 ? ' match' : ' matches') + '</span></h3><div class="pick-list">' +
      (hits.length ? hits.slice(0, PICK_LIMIT).map(function (e) { return listRow(e); }).join('') : '<div class="pick-empty">No ' + (bestFromList ? 'other ' : '') + 'subjects in the WSU subject list match “' + esc(p.q.trim()) + '”' + (p.ugOnly ? ' at levels 1–4. Turn off “Undergraduate levels 1–4” to search every level' : '') + '.' + CLEAR_PICK + '</div>') + '</div>' +
      (hits.length > PICK_LIMIT ? '<p class="pick-hint">Showing the ' + PICK_LIMIT + ' most relevant of ' + hits.length.toLocaleString('en-AU') + '. Add more of the code or name to narrow the list.</p>' : '') + '</div>';
  }
  function choosePick(code, src) {
    const ctx = lastCtx;
    const s = ctx.byId[ui.picker.slotId];
    const e = src === 'list' ? (EXTRA_BY_CODE[code] || GLOBAL_BY_CODE[code]) : poolEntries(ctx, s.raw).find(function (x) { return x.code === code; });
    if (!e) return;
    noteChange('chose ' + e.code + ' for ' + where(s));
    if (s.kind === 'option' && code === s.raw.code) setPick(s.id, null);
    else if (src === 'list' && EXTRA_BY_CODE[code]) setPick(s.id, { code: e.code, title: e.title, list: true });
    else setPick(s.id, { code: e.code, title: e.title });
    closeModal();
    render();
    toast(e.code + ' ' + e.title + ' set for ' + where(s));
    flashSlot(s.id);
  }

  // ---- custom plan picker: any WSU subject, with the template's own options suggested first
  function suggestionsFor(ctx, s) {
    const o = s.orig;
    const t = ctx.tdeg;
    if (!o || !t) return [];
    const entry = function (code) { return t.byCode[code] || GLOBAL_BY_CODE[code]; };
    if (o.kind === 'fixed') return [entry(o.code)].filter(Boolean);
    if (o.kind === 'inline') return o.options.map(function (x) { return entry(x.code); }).filter(Boolean);
    const comps = o.kind === 'llb' || o.kind === 'elective' ? [t.llbComponent] : o.pool || [];
    const seen = {};
    const out = [];
    comps.forEach(function (comp) {
      (t.byComp[comp] || []).forEach(function (e) { if (!seen[e.code]) { seen[e.code] = 1; out.push(e); } });
    });
    return out;
  }
  function suggestionsHead(s) {
    const k = s.orig.kind;
    if (k === 'fixed') return 'Template subject for this slot';
    if (k === 'llb' || k === 'elective') return 'LLB Alternates from the template';
    if (k === 'inline') return 'Template options for this slot';
    if (k === 'option') return 'Template options for this slot';
    return 'Template choices: ' + cleanPoolTitle(s.orig.title);
  }
  function renderCustomPicker(first) {
    const ctx = lastCtx;
    const s = ctx.byId[ui.picker.slotId];
    const p = ui.picker;
    const summer = s.session === 'Summer';
    let tools = '<div class="tool-row"><input class="input" id="pick-q" type="search" placeholder="Search any WSU subject by code or title, e.g. LAWS1001 or contract" value="' + esc(p.q) + '" style="flex:1;min-width:200px" aria-label="Search subjects"></div><div class="tool-row">';
    // the guides have no Summer sessions or campuses, so those filters would have nothing to filter
    if (state.campus && !summer) tools += '<button type="button" class="chip" data-action="pick-campus" aria-pressed="' + p.campusOnly + '">' + esc(META.campuses[state.campus]) + ' or online only</button>';
    ['Level 1', 'Level 2', 'Level 3', 'Level 4'].forEach(function (l) { tools += '<button type="button" class="chip" data-action="pick-level" data-level="' + l + '" aria-pressed="' + (p.level === l) + '">' + l + '</button>'; });
    tools += '<button type="button" class="chip" data-action="pick-ug" aria-pressed="' + p.ugOnly + '" title="Hide level 0 and level 5 to 9 subjects">Undergraduate levels 1–4</button>';
    if (!summer) tools += '<button type="button" class="chip" data-action="pick-off" aria-pressed="' + p.showOff + '">Show subjects not offered in ' + s.session + '</button>';
    tools += '</div>';
    const areas = s.orig && (s.orig.kind === 'llb' || s.orig.kind === 'elective');
    if (areas) tools += areaTools('pick-area', p.area);
    const maxY = Math.min(MAX_YEARS, ctx.slots.reduce(function (m, x) { return Math.max(m, x.year); }, 1) + 1);
    let moveOpts = '';
    for (let y = 1; y <= maxY; y++) {
      PLAN_SESSIONS.forEach(function (ss) { moveOpts += '<option value="' + y + '|' + ss + '"' + (y === s.year && ss === s.session ? ' selected' : '') + '>Year ' + y + ' · ' + ss + '</option>'; });
    }
    let moveMore = '';
    if (state.load !== 'PT') {
      const named = function (o) { return (o.pending ? 'Open slot' : o.code + ' ' + o.title); };
      const groups = {};
      sortSlots(ctx.slots).forEach(function (o) {
        if (o.year === s.year && o.session === s.session) return;
        const k = 'Year ' + o.year + ' · ' + o.session;
        groups[k] = (groups[k] || '') + '<option value="' + o.id + '">' + esc(named(o)) + '</option>';
      });
      const keys = Object.keys(groups);
      if (keys.length) moveMore += '<div class="move-row"><label for="cp-swap">Swap with</label><div class="select-wrap"><select id="cp-swap"><option value="">Choose a slot</option>' + keys.map(function (k) { return '<optgroup label="' + k + '">' + groups[k] + '</optgroup>'; }).join('') + '</select></div></div>';
      const here = sortSlots(ctx.slots.filter(function (o) { return o.year === s.year && o.session === s.session; }));
      if (here.length > 1) {
        const at = here.indexOf(s);
        moveMore += '<div class="move-row"><span class="field-label">Order</span><button type="button" class="btn order-btn" data-action="creorder" data-dir="-1" aria-label="Move up in ' + where(s) + '"' + (at === 0 ? ' disabled' : '') + '>↑</button><button type="button" class="btn order-btn" data-action="creorder" data-dir="1" aria-label="Move down in ' + where(s) + '"' + (at === here.length - 1 ? ' disabled' : '') + '>↓</button></div>';
      }
    }
    const typedCP = s.custom ? s.cp : s.cp > 0 ? s.cp : 10;
    const custom = '<div class="pick-section"><h3>Not on the list? Enter it yourself</h3><form class="custom-form cf-cp" id="custom-form">' +
      '<div class="field"><label for="cu-code">Code</label><input class="input" id="cu-code" placeholder="e.g. HUMN 1052" maxlength="12" value="' + esc(s.custom ? s.code : '') + '"></div>' +
      '<div class="field"><label for="cu-title">Title</label><input class="input" id="cu-title" placeholder="Subject title" maxlength="120" value="' + esc(s.custom ? s.title : '') + '"></div>' +
      '<div class="field"><label for="cu-cp">Credit</label><div class="select-wrap"><select id="cu-cp">' + [0, 10, 20, 30, 40].map(function (c) { return '<option value="' + c + '"' + (c === typedCP ? ' selected' : '') + '>' + c + ' CP</option>'; }).join('') + '</select></div></div>' +
      '<button type="submit" class="btn btn-primary">Use subject</button></form><p class="small muted" style="margin:4px 8px 0">A code from the 2027 guides or the WSU subject list fills in its real title and credit points.</p></div>';
    showModal('<div class="modal-backdrop" data-action="backdrop"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="picker-h">' +
      '<div class="modal-head"><div><h2 id="picker-h">' + (s.pending ? 'Choose a subject' : 'Change or move this subject') + '</h2><p>' + where(s) + ' · ' + s.cp + ' CP · ' + esc(ctx.deg.title) + (s.replaced ? ' · template subject: ' + esc(s.replaced.code + ' ' + s.replaced.title) : '') + '</p></div><button type="button" class="modal-x" data-action="modal-close" aria-label="Close">×</button></div>' +
      '<div class="modal-tools">' + tools + toolsNote(areas, KEY_HINT) + '</div>' +
      '<div class="modal-body"><div id="pick-results"></div>' + custom + '</div>' +
      '<div class="modal-foot"><div class="move-rows"><div class="move-row"><label for="cp-move">Move to</label><div class="select-wrap"><select id="cp-move">' + moveOpts + '</select></div></div>' + moveMore + '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' + (s.pending || s.done ? '' : '<button type="button" class="btn" data-action="defer" data-slot="' + s.id + '">Defer to next offered session</button>') + (s.pending ? '' : '<button type="button" class="btn" data-action="pick-clear">Clear subject</button>') +
      '<button type="button" class="btn" data-action="cremove" data-slot="' + s.id + '">Remove slot</button><button type="button" class="btn btn-ghost" data-action="modal-close">Cancel</button></div></div></div></div>');
    lockScroll();
    renderCustomPickerResults();
    if (first) { const q = $('#pick-q'); if (q && window.matchMedia('(pointer:fine)').matches) q.focus(); }
  }
  function renderCustomPickerResults() {
    const ctx = lastCtx;
    const s = ctx.byId[ui.picker.slotId];
    const p = ui.picker;
    const q = normQ(p.q);
    const summer = s.session === 'Summer';
    const other = s.session === 'Autumn' ? 'Spring' : 'Autumn';
    // a Summer slot shows each subject's Autumn and Spring sessions for context
    const others = summer ? SESSIONS : [other];
    const offOf = function (e) { return GLOBAL_BY_CODE[e.code] ? offerFor(ctx.deg, e.code, s.session) : null; };
    let hiddenOff = 0;
    let hiddenCampus = 0;
    const shown = function (i) {
      if (i.off && i.off.none && !p.showOff) { hiddenOff++; return false; }
      if (i.off && p.campusOnly && state.campus && !i.off.tbc && !i.off.none && i.off.codes.indexOf(state.campus) < 0 && i.off.codes.indexOf('ON') < 0) { hiddenCampus++; return false; }
      return true;
    };
    const sugg = suggestionsFor(ctx, s);
    const suggCodes = {};
    sugg.forEach(function (e) { suggCodes[e.code] = 1; });
    const suggItems = rankByQuery(sugg.filter(function (e) { return (!p.level || e.level === p.level) && inArea(e.code, p.area); }), q)
      .map(function (e) { return { e: e, off: offOf(e) }; }).filter(shown);
    const pool = ANY_SUBJECTS.filter(function (e) { return !suggCodes[e.code] && (!p.ugOnly || (e.lv >= 1 && e.lv <= 4)) && (!p.level || e.level === p.level) && inArea(e.code, p.area); });
    const anyItems = q.length >= 2 ? rankByQuery(pool, q).map(function (e) { return { e: e, off: offOf(e) }; }).filter(shown) : [];
    // the most relevant subject is pinned; an exact code is surfaced even when a filter hides it
    let best = null;
    if (q.length >= 2) {
      const cands = suggItems.slice(0, 3).concat(anyItems.slice(0, 3)).map(function (i) { return { i: i, score: searchScore(i.e, q) }; });
      const exact = normCode(q);
      const ex = exact && (GLOBAL_BY_CODE[exact] || EXTRA_BY_CODE[exact]);
      if (ex && !cands.some(function (c) { return c.i.e.code === exact; })) cands.push({ i: { e: { code: exact, title: ex.title, level: ex.level }, off: offOf({ code: exact }) }, score: 1000 });
      cands.sort(function (a, b) { return b.score - a.score; });
      const top = cands[0];
      const next = cands[1] ? cands[1].score : 0;
      if (top && (top.score >= 950 || (top.score >= 70 && top.score - next >= 40))) best = top;
    }
    const bestCode = best ? best.i.e.code : null;
    function crow(i, badge) {
      const e = i.e;
      const current = s.code === e.code && !s.pending;
      const clash = !current && usedElsewhere(ctx, e.code, s.id);
      const g = ctx.deg.byCode[e.code] || GLOBAL_BY_CODE[e.code];
      const otherVals = others.map(function (o) { const v = g ? sessionValue(g, o) : ''; return v && v !== '—' ? '<span>' + o + ': ' + esc(v) + '</span>' : ''; }).join('');
      return '<button type="button" class="pick" data-action="cpick" data-code="' + esc(e.code) + '"' + (clash ? ' disabled' : '') + (current ? ' aria-current="true"' : '') + '>' +
        '<span class="p-code">' + hlCode(e.code, q) + '</span><span class="p-title">' + hl(e.title, q) + '</span>' +
        '<span class="p-side">' + (i.off ? '<span class="pills">' + pillsFor(i.off) + '</span>' : '<span class="muted small">Check Handbook</span>') +
        (badge ? '<span class="status status-best">' + badge + '</span>' : '') + (current ? '<span class="status status-essential">Selected</span>' : clash ? '<span class="status status-non">In plan</span>' : '') + '</span>' +
        '<span class="p-meta"><span>' + esc(e.level || 'Level ' + e.code.charAt(5)) + '</span>' + areaTags(e.code) + '<span>' + (g ? '2027 Handbook data' : 'WSU subject list') + '</span>' +
        (g && g.cp !== 10 ? '<span>' + g.cp + ' CP</span>' : '') + otherVals +
        (i.off && i.off.none ? '<span>Not offered in ' + s.session + '</span>' : '') + '</span></button>';
    }
    const notBest = function (i) { return i.e.code !== bestCode; };
    let html = '';
    if (summer) {
      html += '<p class="pick-hint summer-hint">The 2027 guides list Autumn and Spring sessions only. Before you plan on a Summer subject, check in the Handbook that it runs in Summer and where.</p>';
      // taking a later subject over Summer: moving it here keeps the plan's credit points the same
      if (s.pending) {
        const later = ctx.slots.filter(function (x) { return !x.pending && orderIdx(x.year, x.session) > orderIdx(s.year, s.session); });
        const hits = q ? rankByQuery(later, q) : sortSlots(later);
        if (later.length) {
          html += '<div class="pick-section"><h3><span>Bring forward from later in your plan</span><span>' + hits.length + '</span></h3><div class="pick-list">' +
            (hits.length ? hits.map(function (x) {
              return '<button type="button" class="pick" data-action="cbring" data-from="' + x.id + '">' +
                '<span class="p-code">' + hlCode(x.code, q) + '</span><span class="p-title">' + hl(x.title, q) + '</span>' +
                '<span class="p-side"><span class="status status-non">' + where(x) + '</span></span>' +
                '<span class="p-meta"><span>Moves here from ' + where(x) + '</span><span>' + x.cp + ' CP</span></span></button>';
            }).join('') : '<div class="pick-empty">No later subjects in your plan match “' + esc(p.q.trim()) + '”.' + CLEAR_PICK + '</div>') + '</div></div>';
        }
      }
    }
    if (best) {
      const badge = best.score >= 950 ? 'Exact match' : 'Best match';
      html += '<div class="pick-section pick-best"><h3><span>' + badge + '</span></h3><div class="pick-list">' + crow(best.i, badge) + '</div>' +
        (best.i.off && best.i.off.none ? '<p class="pick-hint">' + esc(best.i.e.code) + ' runs only in ' + other + '. You can still place it here, but it stays flagged until you move it to an ' + other + ' session.</p>' : '') + '</div>';
    }
    if (sugg.length && (suggItems.filter(notBest).length || !q)) {
      const list = suggItems.filter(notBest);
      html += '<div class="pick-section"><h3><span>' + esc(suggestionsHead(s)) + '</span><span>' + list.length + '</span></h3><div class="pick-list">' +
        (list.length ? list.map(function (i) { return crow(i); }).join('') : '<div class="pick-empty">No ' + (best ? 'other ' : '') + 'template options match.' + CLEAR_PICK + '</div>') + '</div></div>';
    }
    const head = '<div class="pick-section"><h3><span>Any WSU subject · 2027 guides and subject list</span><span>';
    if (q.length >= 2 && best && !anyItems.filter(notBest).length) {
      html += '<p class="pick-hint">No other subjects match “' + esc(p.q.trim()) + '”.</p>';
    } else if (q.length < 2) {
      html += head + pool.length.toLocaleString('en-AU') + ' subjects</span></h3><p class="pick-hint">Type a subject code (for example LAWS1001) or words from its name to search ' + pool.length.toLocaleString('en-AU') + ' WSU subjects' + (p.ugOnly ? ' at undergraduate levels 1–4' : '') + '. Subjects in the 2027 guides show their sessions and campuses; the subject list gives codes and titles only.</p></div>';
    } else {
      const list = anyItems.filter(notBest);
      html += head + list.length.toLocaleString('en-AU') + (list.length === 1 ? ' match' : ' matches') + '</span></h3><div class="pick-list">' +
        (list.length ? list.slice(0, PICK_LIMIT).map(function (i) { return crow(i); }).join('') : '<div class="pick-empty">No ' + (best ? 'other ' : '') + 'subjects match “' + esc(p.q.trim()) + '”' + (p.ugOnly ? ' at levels 1–4' : '') + '.' + CLEAR_PICK + '</div>') + '</div>' +
        (list.length > PICK_LIMIT ? '<p class="pick-hint">Showing the ' + PICK_LIMIT + ' most relevant of ' + list.length.toLocaleString('en-AU') + '. Add more of the code or name to narrow the list.</p>' : '') + '</div>';
    }
    if (hiddenOff) html += '<p class="pick-hint">' + plural(hiddenOff, 'matching subject') + ' ' + (hiddenOff === 1 ? 'runs' : 'run') + ' only in ' + other + '. <button type="button" class="linkish" data-action="pick-off">Show ' + (hiddenOff === 1 ? 'it' : 'them') + '</button></p>';
    if (hiddenCampus) html += '<p class="pick-hint">' + plural(hiddenCampus, 'matching subject') + ' hidden by the campus filter.</p>';
    $('#pick-results').innerHTML = html;
  }
  function setCustomSubject(idx, code, title, cp) {
    const x = editPlan().slots[idx];
    if (x.code !== code) x.done = false;
    x.code = code;
    x.title = title || '';
    if (cp != null) x.cp = cp;
    else if (!x.cp) x.cp = 10;
  }
  function chooseCustom(code) {
    const s = lastCtx.byId[ui.picker.slotId];
    const g = GLOBAL_BY_CODE[code];
    if (!g && !EXTRA_BY_CODE[code]) return;
    noteChange('chose ' + code + ' for ' + where(s));
    setCustomSubject(s.idx, code, '', g ? g.cp : null);
    closeModal();
    render();
    const n = lastCtx.byId[s.id];
    toast(code + ' ' + n.title + ' set for ' + where(n));
    flashSlot(s.id);
  }
  function clearCustomSlot(idx) {
    const plan = editPlan();
    const x = plan.slots[idx];
    const orig = x.o && plan.tpl ? PATH[plan.tpl].find(function (r) { return r.id === x.o; }) : null;
    x.code = '';
    x.title = '';
    x.done = false;
    x.cp = orig ? orig.cp : 10;
  }
  // a subject not yet completed goes by the code a student enrols in for the year it now sits in
  function yearCode(plan, x) {
    if (!x.code || x.done) return;
    const to = codeFor(x.code, cohortOf(plan), (plan.start || START_YEAR) + x.y - 1, startedBefore(plan.start));
    if (to === x.code || plan.slots.some(function (o) { return o !== x && o.code === to; })) return;
    x.code = to;
    x.title = '';
  }
  function moveCustomSlot(idx, y, sess) {
    const plan = editPlan();
    const x = plan.slots.splice(idx, 1)[0];
    x.y = y;
    x.s = sess;
    yearCode(plan, x);
    plan.slots.push(x);
    if (y > plan.years) plan.years = y;
    return 'c' + (plan.slots.length - 1);
  }
  // an open slot, or one tied to a slot of the pathway the plan is based on (an LLB Alternate, an elective or a choice)
  function addCustomSlot(y, sess, o) {
    const plan = editPlan();
    if (plan.slots.length >= MAX_SLOTS) { toast('A plan can hold up to ' + MAX_SLOTS + ' slots.'); return null; }
    const x = emptyCSlot(y, sess);
    const raw = o && plan.tpl ? PATH[plan.tpl].find(function (r) { return r.id === o; }) : null;
    if (raw) { x.o = raw.id; x.cp = raw.cp; }
    plan.slots.push(x);
    return 'c' + (plan.slots.length - 1);
  }
  // Year options. Deleting a year takes its subjects out and brings every later year one year earlier; inserting one
  // pushes that year and the later ones a year on, leaving an empty year for a break; clearing takes out what is not
  // ticked. Loads and notes move with their sessions, and a subject still ahead takes the code for its new year.
  function lastYear(plan) { return Math.max(plan.years || 0, plan.slots.reduce(function (m, x) { return Math.max(m, x.y); }, 0)); }
  function shiftYears(plan, from, by) {
    plan.slots.forEach(function (x) { if (x.y >= from) { x.y += by; yearCode(plan, x); } });
    ['loads', 'notes'].forEach(function (name) {
      const next = {};
      Object.keys(plan[name] || {}).forEach(function (k) {
        const y = Math.floor(+k / 3) + 1;
        if (by < 0 && y === from - 1) return;
        next[y >= from ? +k + by * 3 : +k] = plan[name][k];
      });
      plan[name] = next;
    });
  }
  function deleteYear(y) {
    ensureEditable();
    const plan = editPlan();
    const last = lastYear(plan);
    if (last <= 1) { toast('A plan needs at least one year.'); return; }
    const inYear = plan.slots.filter(function (x) { return x.y === y; });
    const filled = inYear.filter(function (x) { return x.code; });
    const done = inYear.filter(function (x) { return x.done; }).length;
    if (filled.length && !window.confirm('Delete Year ' + y + '? This takes ' + plural(filled.length, 'subject') + ' out of your plan' + (done ? ', ' + done + ' of them completed' : '') + (y < last ? ', and brings the later years one year earlier' : '') + '. Undo puts it back.')) return;
    noteChange('deleted Year ' + y);
    plan.slots = plan.slots.filter(function (x) { return x.y !== y; });
    shiftYears(plan, y + 1, -1);
    plan.years = Math.max(0, Math.min(plan.years || 0, last - 1));
    ui.folded = null;
    renderMoving();
    toast('Year ' + y + ' deleted' + (filled.length ? ', with ' + plural(filled.length, 'subject') : '') + (y < last ? '. The later years moved up.' : '.'), { action: 'undo', label: 'Undo' });
  }
  function insertYear(y) {
    ensureEditable();
    const plan = editPlan();
    const last = lastYear(plan);
    if (last >= MAX_YEARS) { toast('A plan can run for up to ' + MAX_YEARS + ' years.'); return; }
    noteChange('added an empty year before Year ' + y);
    shiftYears(plan, y, 1);
    plan.years = last + 1;
    ui.folded = null;
    renderMoving(function () { const el = document.getElementById('year-' + y); if (el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); } });
    toast('An empty Year ' + y + ' was added, and the years after it moved a year later. Use it for a break, or fill it.', { action: 'undo', label: 'Undo' });
  }
  function clearYear(y) {
    ensureEditable();
    const plan = editPlan();
    const out = plan.slots.filter(function (x) { return x.y === y && !x.done; });
    if (!out.length) { toast('Year ' + y + ' has nothing unticked to clear.'); return; }
    noteChange('cleared Year ' + y);
    plan.slots = plan.slots.filter(function (x) { return x.y !== y || x.done; });
    if (y > plan.years) plan.years = y;
    renderMoving();
    toast(plural(out.length, 'unticked slot') + ' cleared from Year ' + y + '. Anything your degree still needs is listed in the Suggested Remaining Guide.', { action: 'undo', label: 'Undo' });
  }
  function openNote(y, sess) {
    const k = orderIdx(y, sess);
    const now = (editPlan() && editPlan().notes[k]) || '';
    ui.modal = 'note';
    ui.note = { y: y, sess: sess };
    showModal('<div class="modal-backdrop" data-action="backdrop"><div class="modal modal-note" role="dialog" aria-modal="true" aria-labelledby="note-h">' +
      '<div class="modal-head"><div><h2 id="note-h">Note for ' + esc(sessionLabel(y, sess)) + '</h2><p>Year ' + y + ' ' + sess + '. A reminder of your own, such as an exchange, a placement, work or a subject to ask about. It is kept with your plan, in its share link and in your PDF.</p></div><button type="button" class="modal-x" data-action="modal-close" aria-label="Close">×</button></div>' +
      '<form class="note-body" id="note-form" novalidate><label class="sr-only" for="note-text">Your note</label><textarea class="input" id="note-text" rows="3" maxlength="140" placeholder="e.g. Exchange semester, so no WSU subjects">' + esc(now) + '</textarea><p class="small muted" style="margin:6px 0 0">Up to 140 characters.</p></form>' +
      '<div class="modal-foot">' + (now ? '<button type="button" class="btn btn-ghost" data-action="note-remove">Remove note</button>' : '<span></span>') + '<div style="display:flex;gap:8px"><button type="button" class="btn btn-ghost" data-action="modal-close">Cancel</button><button type="submit" form="note-form" class="btn btn-primary">Save note</button></div></div></div></div>');
    const t = $('#note-text');
    t.focus();
    t.setSelectionRange(t.value.length, t.value.length);
  }
  function setSessionNote(y, sess, text) {
    const k = orderIdx(y, sess);
    const now = (editPlan() && editPlan().notes[k]) || '';
    const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 140);
    closeModal(true);
    if (clean === now) return;
    ensureEditable();
    const plan = editPlan();
    noteChange((clean ? 'noted ' : 'removed the note on ') + 'Year ' + y + ' ' + sess);
    if (clean) plan.notes[k] = clean; else delete plan.notes[k];
    if (y > plan.years) plan.years = Math.min(MAX_YEARS, y);
    renderMoving();
    toast(clean ? 'Note saved on ' + sessionLabel(y, sess) + '.' : 'Note removed.', { action: 'undo', label: 'Undo' });
  }
  function addCustomYear() {
    const plan = editPlan();
    const y = Math.max(plan.years || 0, plan.slots.reduce(function (m, x) { return Math.max(m, x.y); }, 0)) + 1;
    if (y > MAX_YEARS || plan.slots.length + 8 > MAX_SLOTS) { toast('A plan can run for up to ' + MAX_YEARS + ' years.'); return null; }
    SESSIONS.forEach(function (sess) { for (let i = 0; i < 4; i++) plan.slots.push(emptyCSlot(y, sess)); });
    return y;
  }
  // Starts a plan again from its template or empty slots, in the Handbook structure it is shown in.
  function rebuildCustom() {
    const plan = editPlan();
    const cohort = cohortOf(plan);
    plan.start = 0;
    plan.pace = 0;
    plan.years = 0;
    plan.need = [];
    plan.loads = {};
    plan.notes = {};
    plan.skip = [];
    plan.cohort = cohort === startCohort(0) ? '' : cohort;
    plan.slots = plan.tpl ? restructure(plan.tpl, templateSlots(plan.tpl, false), cohort, 0) : [];
    fitToCP(plan);
  }

  // ---- custom degree setup: name, credit points and starting point
  function cpDerived(v) {
    const n = +v;
    if (!(n >= 10 && n <= MAX_CP)) return 'Enter a total between 10 and ' + MAX_CP + ' CP.';
    const c = clampCP(n);
    return '<b>' + c + ' CP</b> = ' + plural(c / 10, 'subject') + ' of 10 CP · about ' + fmt(c / 80) + ' ' + (c === 80 ? 'year' : 'years') + ' full-time (' + plural(Math.ceil(c / 40), 'session') + ' of up to 40 CP) · about ' + fmt(c / 40) + ' years part-time' + (c !== n ? ' · rounded to ' + c + ' CP' : '');
  }
  function tplMajorOptions(dcode, selKey) {
    const d = DEG[dcode];
    return d.options.map(function (k) {
      return '<option value="' + esc(k) + '"' + (k === selKey ? ' selected' : '') + '>' + esc(d.fixedStructure ? selectionLabel({ deg: d, opt: OPT[k] }) : OPT[k].majorLabel) + '</option>';
    }).join('');
  }
  function openSetup(opts) {
    opts = opts || {};
    ui.cohortPicked = !!(state.custom && state.custom.cohort && (opts.start || 'keep') === 'keep');
    const plan = state.custom;
    const start = opts.start || (plan ? 'keep' : 'blank');
    const key = opts.tpl || (plan && plan.tpl) || currentKey();
    const tdeg = DEG[key.split('|')[0]];
    const auto = start === 'template';
    const name = auto ? tdeg.title : plan ? plan.name : '';
    const code = auto ? tdeg.code : plan ? plan.code : '';
    const cp = auto ? tdeg.cp : plan ? plan.cp : DEG[state.degree].cp;
    const filled = plan ? plan.slots.filter(function (x) { return x.code; }).length : 0;
    const began = start === 'keep' && plan.start ? plan.start : START_YEAR;
    const years = [];
    for (let yr = Math.min(began, START_YEAR - 8); yr <= START_YEAR; yr++) years.push(yr);
    const radio = function (val, title, desc) {
      return '<label class="opt-card"><input type="radio" name="cs-start" value="' + val + '"' + (start === val ? ' checked' : '') + '><b>' + title + '</b><span>' + desc + '</span></label>';
    };
    ui.modal = 'setup';
    ui.setupSummer = opts.summerYear || 0;
    showModal('<div class="modal-backdrop" data-action="backdrop"><div class="modal modal-setup" role="dialog" aria-modal="true" aria-labelledby="setup-h">' +
      '<div class="modal-head"><div><h2 id="setup-h">' + (ui.setupSummer ? 'Add a Summer session' : plan ? 'Edit your custom degree' : 'Build your own degree') + '</h2><p>Set the credit points your degree requires, name it, then start from empty slots or from a 2027 WSLSA pathway you can edit subject by subject.</p></div><button type="button" class="modal-x" data-action="modal-close" aria-label="Close">×</button></div>' +
      '<form class="setup-body" id="setup-form" novalidate>' +
      (ui.setupSummer ? '<p class="cs-summer"><b>Summer is planned in your own copy of a pathway.</b> Create it below and Year ' + ui.setupSummer + ' Summer is added after Spring, ready for you to choose a subject or bring one forward from later in your plan. The WSLSA pathway itself stays as it is.</p>' : '') +
      '<fieldset><legend><span class="idx">01→</span>Your degree</legend><div class="setup-row">' +
      '<div class="field"><label for="cs-name">Degree name</label><input class="input" id="cs-name" maxlength="120" autocomplete="off" placeholder="e.g. Bachelor of Laws (Graduate Entry)" value="' + esc(name) + '"' + (auto ? ' data-auto="1"' : '') + '></div>' +
      '<div class="field"><label for="cs-code">Course code (optional)</label><input class="input" id="cs-code" maxlength="16" autocomplete="off" placeholder="e.g. 2753" value="' + esc(code) + '"' + (auto ? ' data-auto="1"' : '') + '></div></div>' +
      '<div class="setup-row"><p class="cs-derived">Already studying? Choose the year you started, so Year 1 is that year and your plan shows your past years. Import my progress sets this from your results.</p>' +
      '<div class="field"><label for="cs-year">Year you started</label><div class="select-wrap"><select id="cs-year">' + years.map(function (yr) {
        return '<option value="' + yr + '"' + (yr === began ? ' selected' : '') + '>' + yr + (yr === START_YEAR ? ' (new students)' : '') + '</option>';
      }).join('') + '</select></div></div></div>' +
      cohortSet('cs-cohort', start === 'keep' && plan.cohort ? plan.cohort : startCohort(began)) +
      '<p class="cs-derived">Started before 2027? A 2027 pathway copied in under the pre-2027 structure leaves out LAWS 2019, LAWS 3099 and LAWS 3102 and has three more LLB Alternate slots.</p></fieldset>' +
      '<fieldset><legend><span class="idx">02→</span>Credit points the degree requires</legend><div class="cp-row">' +
      '<div class="segmented cp-presets" role="group" aria-label="Common totals">' + CP_PRESETS.map(function (c) { return '<button type="button" data-action="cs-cp" data-v="' + c + '" aria-pressed="' + (c === cp) + '">' + c + '</button>'; }).join('') + '</div>' +
      '<div class="field cp-field"><label for="cs-cp">Exact total (CP)</label><input class="input" id="cs-cp" type="number" min="10" max="' + MAX_CP + '" step="10" inputmode="numeric" value="' + cp + '"></div></div>' +
      '<p class="cs-derived" id="cs-derived">' + cpDerived(cp) + '</p></fieldset>' +
      '<fieldset><legend><span class="idx">03→</span>Starting point</legend><div class="start-opts">' +
      (plan ? radio('keep', 'Keep my current subjects', 'Rename it or change the credit points. Open slots are added or removed to match; chosen subjects are never removed.') : '') +
      radio('blank', 'Empty slots', 'Four 10 CP slots per session, Autumn and Spring, until the credit points are reached.') +
      radio('template', 'Start from a 2027 WSLSA pathway', 'Copy a degree and major, then change, move or remove any subject.') + '</div>' +
      '<div class="tpl-fields" id="cs-tpl"' + (start === 'template' ? '' : ' hidden') + '>' +
      '<div class="field"><label for="cs-tpl-deg">Template degree</label><div class="select-wrap"><select id="cs-tpl-deg">' + DEGREES.map(function (d) { return '<option value="' + d.code + '"' + (d.code === tdeg.code ? ' selected' : '') + '>' + esc(d.label) + '</option>'; }).join('') + '</select></div></div>' +
      '<div class="field"><label for="cs-tpl-major">Major / minor</label><div class="select-wrap"><select id="cs-tpl-major">' + tplMajorOptions(tdeg.code, key) + '</select></div></div>' +
      '<label class="check-row"><input type="checkbox" id="cs-tpl-mine" checked><span>Bring across my choices and completed ticks for that pathway from the Explorer</span></label></div>' +
      '<p class="cs-warn" id="cs-warn"' + (filled && start !== 'keep' ? '' : ' hidden') + ' data-filled="' + filled + '">Starting again replaces the ' + plural(filled, 'subject') + ' in your current custom plan.</p>' +
      '</fieldset></form>' +
      '<div class="modal-foot"><span class="small muted">Saved in this browser and in your share link.</span><div style="display:flex;gap:8px"><button type="button" class="btn btn-ghost" data-action="modal-close">Cancel</button><button type="submit" form="setup-form" class="btn btn-primary">' + (plan ? 'Update plan →' : 'Create plan →') + '</button></div></div></div></div>');
    lockScroll();
    const n = $('#cs-name');
    if (n && window.matchMedia('(pointer:fine)').matches) n.focus();
  }
  function setupStart() { const r = document.querySelector('input[name="cs-start"]:checked'); return r ? r.value : 'blank'; }
  function setupSync(changed) {
    const start = setupStart();
    const fromTpl = start === 'template';
    $('#cs-tpl').hidden = !fromTpl;
    const warn = $('#cs-warn');
    warn.hidden = !(+warn.dataset.filled && start !== 'keep');
    const n = $('#cs-name');
    const c = $('#cs-code');
    if (fromTpl && (changed === 'start' || changed === 'tpl')) {
      const d = DEG[$('#cs-tpl-deg').value];
      $('#cs-cp').value = d.cp;
      if (!n.value.trim() || n.dataset.auto) { n.value = d.title; n.dataset.auto = '1'; }
      if (!c.value.trim() || c.dataset.auto) { c.value = d.code; c.dataset.auto = '1'; }
    } else if (!fromTpl && changed === 'start') {
      if (n.dataset.auto) { n.value = start === 'keep' && state.custom ? state.custom.name : ''; delete n.dataset.auto; }
      if (c.dataset.auto) { c.value = start === 'keep' && state.custom ? state.custom.code : ''; delete c.dataset.auto; }
    }
    const cp = $('#cs-cp').value;
    $('#cs-derived').innerHTML = cpDerived(cp);
    document.querySelectorAll('[data-action="cs-cp"]').forEach(function (b) { b.setAttribute('aria-pressed', String(+b.dataset.v === +cp)); });
  }
  function applySetup() {
    ui.folded = null;
    const cpRaw = +$('#cs-cp').value;
    if (!(cpRaw >= 10 && cpRaw <= MAX_CP)) { toast('Enter the credit points your degree requires, between 10 and ' + MAX_CP + '.'); $('#cs-cp').focus(); return; }
    const start = setupStart();
    const summerY = ui.setupSummer;
    const prev = state.custom;
    const filled = prev ? prev.slots.filter(function (x) { return x.code; }).length : 0;
    if (filled && start !== 'keep' && !window.confirm('Start again? This replaces the ' + plural(filled, 'subject') + ' in your current custom plan.')) return;
    const plan = { name: $('#cs-name').value.trim().slice(0, 120), code: $('#cs-code').value.trim().slice(0, 16), cp: clampCP(cpRaw), tpl: '', start: 0, pace: 0, cohort: '', years: 0, need: [], loads: {}, notes: {}, skip: [], slots: [] };
    if (start === 'keep' && prev) { plan.tpl = prev.tpl; plan.slots = prev.slots; plan.pace = prev.pace; plan.years = prev.years || 0; plan.need = prev.need || []; plan.loads = prev.loads || {}; plan.notes = prev.notes || {}; plan.skip = prev.skip || []; }
    else if (start === 'template') { plan.tpl = $('#cs-tpl-major').value; plan.slots = templateSlots(plan.tpl, $('#cs-tpl-mine').checked); }
    const began = +$('#cs-year').value;
    plan.start = began < START_YEAR ? began : 0;
    const cohort = $('#cs-cohort-pre2027').checked ? 'pre2027' : '2027';
    plan.cohort = cohort === startCohort(plan.start) ? '' : cohort;
    // a 2027 pathway copied in, or a plan kept, moves to the structure chosen
    const was = start === 'keep' && prev ? cohortOf(prev) : '2027';
    if (plan.tpl && cohort !== was) {
      plan.slots = restructure(plan.tpl, plan.slots, cohort, plan.start);
      plan.need = restructureNeed(plan, cohort);
    }
    fitToCP(plan);
    noteChange(summerY ? 'added Year ' + summerY + ' Summer' : start === 'keep' ? 'edited your custom plan' : 'started a new custom plan');
    const addSummer = summerY && plan.slots.length < MAX_SLOTS && !plan.slots.some(function (x) { return x.y === summerY && x.s === 'Summer'; });
    if (addSummer) plan.slots.push(emptyCSlot(summerY, 'Summer'));
    state.custom = plan;
    state.mode = 'custom';
    closeModal();
    render();
    if (summerY) {
      toast(addSummer ? 'Year ' + summerY + ' Summer added. Choose a subject or bring one forward.' : 'Your plan already has a Year ' + summerY + ' Summer session.');
      if (addSummer) flashSlot('c' + (plan.slots.length - 1));
      return;
    }
    const years = plan.slots.reduce(function (m, x) { return Math.max(m, x.y); }, 0);
    toast(start === 'keep' ? 'Custom plan updated: ' + plan.cp + ' CP required.' : 'Custom plan ready: ' + plural(plan.slots.length, 'slot') + ' across ' + plural(years, 'year') + '.');
    const head = $('.section-head');
    if (head) head.scrollIntoView({ behavior: scrollMode(), block: 'start' });
  }
  function openCustom() {
    if (state.custom) { state.mode = 'custom'; renderEntering(); toast('Showing your custom plan.'); }
    else openSetup({ start: 'blank' });
  }

  // ======================================================================== share / reset
  function share() {
    const url = planUrl();
    const done = function () { toast('Plan link copied. It restores this degree, choices and progress.'); };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(url).then(done, function () { showShare(url); });
    } else {
      showShare(url);
    }
  }
  function showShare(url) {
    ui.modal = 'share';
    showModal('<div class="modal-backdrop" data-action="backdrop"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="share-h"><div class="modal-head"><div><h2 id="share-h">Plan link</h2><p>Copy this link to reopen or share this exact plan.</p></div><button type="button" class="modal-x" data-action="modal-close" aria-label="Close">×</button></div><div class="modal-body" style="padding:16px 20px"><textarea class="input" id="share-url" rows="4" readonly style="font:12px var(--mono);resize:vertical">' + esc(url) + '</textarea></div><div class="modal-foot"><span></span><button type="button" class="btn btn-ghost" data-action="modal-close">Close</button></div></div></div>');
    const ta = $('#share-url');
    ta.focus();
    ta.select();
  }

  function copyText(text, done) {
    const fallback = function () {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      toast(ok ? done : 'Copy these codes: ' + text);
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(function () { toast(done); }, fallback);
    else fallback();
  }

  // ======================================================================== import my progress
  // A PDF of the Degree Works audit or the Subject Results page rebuilds the student's plan: every
  // subject they have passed or are studying goes in the session they took it, and what they still need
  // is laid out from their next session. A subject counts only when its row carries a grade followed by
  // its credit points (Degree Works: "D 10") or its mark and credit points (Subject Results: "D 76 10"),
  // so codes in "Still needed" lists, choice pools and notes never become history. NA with credit points
  // in brackets is Degree Works for a subject still in progress. Grades and marks are read only to tell
  // passes from fails and are never shown or kept.
  const PASS_GRADES = ['H', 'HD', 'D', 'DN', 'C', 'CR', 'P', 'PS', 'PC', 'S', 'SY', 'T', 'TR', 'AS', 'CT', 'EX', 'RPL'];
  const FAIL_GRADES = ['F', 'AF', 'FN', 'FW', 'U', 'US', 'UN', 'N', 'NS', 'W', 'WD', 'WN', 'WF', 'AB', 'ABS', 'X', 'DNS'];
  const PROGRESS_GRADES = ['NA', 'IP', 'I', 'DE', 'GP', 'RP'];
  const STATUS_RANK = { failed: 1, progress: 2, done: 3 };
  const RESULT_NUM = /^\(?\d{1,3}(\.\d+)?\)?$/;
  // read from printed pages, a code can come back with a digit as a letter (LAWS 2O03) or a letter as a digit (N0AW)
  const PDF_CODE = /(^|[^A-Za-z0-9])([A-Za-z][A-Za-z0-9]{3})\s?([0-9OoIlSB]{4})(?![A-Za-z0-9])/g;
  function pdfCode(letters, digits) {
    if ((digits.match(/\d/g) || []).length < 2) return '';
    const l = letters.toUpperCase().replace(/0/g, 'O').replace(/1/g, 'I').replace(/5/g, 'S').replace(/8/g, 'B');
    const d = digits.replace(/[Oo]/g, '0').replace(/[Il]/g, '1').replace(/S/g, '5').replace(/B/g, '8');
    return /^[A-Z]{4}$/.test(l) ? l + ' ' + d : '';
  }
  function gradeStatus(tok) {
    if (!/^[A-Z]/.test(tok)) return '';
    // a letter read twice ("Cc") is still one grade
    const g = tok.replace(/[^A-Za-z]/g, '').toUpperCase().replace(/(.)\1+/g, '$1');
    if (g.length > 3) return '';
    return PASS_GRADES.indexOf(g) >= 0 ? 'done' : FAIL_GRADES.indexOf(g) >= 0 ? 'failed' : PROGRESS_GRADES.indexOf(g) >= 0 ? 'progress' : '';
  }
  // the result in the words after a code: the first grade followed by numbers, the last of which is the
  // credit points. The words before the grade are the subject's title.
  function rowResult(words, audit) {
    for (let i = 0; i < words.length - 1; i++) {
      const status = gradeStatus(words[i]);
      if (!status || !RESULT_NUM.test(words[i + 1])) continue;
      let j = i + 1;
      while (j + 1 < words.length && RESULT_NUM.test(words[j + 1])) j++;
      const cp = words[j];
      return { status: /^\(/.test(cp) && status === 'done' ? 'progress' : status, cp: parseFloat(cp.replace(/[()]/g, '')), title: words.slice(0, i).join(' ') };
    }
    if (audit) return null;
    // a grade the text reader could not make out on the Subject Results page: its mark and credit points
    // still say whether the subject was passed, as every mark from 50 is a pass
    for (let i = 0; i < words.length - 1; i++) {
      if (/^\d{1,3}$/.test(words[i]) && +words[i] <= 100 && /^\d{1,2}$/.test(words[i + 1]) && !RESULT_NUM.test(words[i + 2] || '')) {
        return { status: +words[i] >= 50 ? 'done' : 'failed', cp: +words[i + 1], title: words.slice(0, i).join(' ') };
      }
    }
    // a row with only its credit points has no result yet, so the subject is under way
    const nums = words.filter(function (w) { return RESULT_NUM.test(w); });
    if (nums.length === 1 && /^\d{1,2}$/.test(words[words.length - 1])) return { status: 'progress', cp: +nums[0], title: words.slice(0, -1).join(' ') };
    return null;
  }
  // session names on WSU records; Winter runs between Autumn and Spring, so it sits with Spring in a plan
  function sessionOf(word) {
    const m = /^(Autumn|Spring|Summer|Winter|1H|2H)\b/i.exec(word || '');
    if (!m) return '';
    const k = m[1].toLowerCase();
    return k === 'autumn' || k === '1h' ? 'Autumn' : k === 'summer' ? 'Summer' : 'Spring';
  }
  // the term a subject was taken: "2024 Autumn" after the result (Degree Works), or the year before the
  // code with the session beside it or at the start of a following line (Subject Results, where the
  // term cell wraps and a row can break across pages)
  function rowTerm(lines, li, before, after) {
    for (let k = 0; k < after.length - 1; k++) {
      if (/^20\d\d$/.test(after[k]) && sessionOf(after[k + 1])) return { year: +after[k], session: sessionOf(after[k + 1]) };
    }
    const b = before.trim().split(/\s+/);
    const yi = b.map(function (w) { return /^20\d\d$/.test(w); }).lastIndexOf(true);
    if (yi < 0) return null;
    const here = b.slice(yi + 1).map(sessionOf).filter(Boolean)[0];
    if (here) return { year: +b[yi], session: here };
    // the session can also end the row, after the result, when the term is split across cells ("2024 LAWS2004 ... 10 ✓ Autumn")
    const tail = after.map(sessionOf).filter(Boolean);
    if (tail.length) return { year: +b[yi], session: tail[tail.length - 1] };
    for (let n = li + 1; n < lines.length && n <= li + 4; n++) {
      const s = sessionOf(lines[n]);
      if (s) return { year: +b[yi], session: s };
      if (new RegExp(PDF_CODE.source).test(lines[n])) break;
    }
    return null;
  }
  // lines of a PDF in reading order: one subject per line in both formats. In an audit the text before
  // the code is the requirement it counts for, kept as a label. A row whose term cannot be read takes
  // the term of the row above, as both formats list subjects term by term.
  function parsePdfLines(lines, audit) {
    const best = {};
    const order = [];
    let last = null;
    lines.forEach(function (line, li) {
      const re = new RegExp(PDF_CODE.source, 'g');
      let m;
      while ((m = re.exec(line))) {
        const code = pdfCode(m[2], m[3]);
        const words = line.slice(re.lastIndex).trim().split(/\s+/);
        const res = code && rowResult(words, audit);
        // zero credit point modules (the academic integrity module) are not part of a plan
        if (!res || (res.cp === 0 && !GLOBAL_BY_CODE[code])) continue;
        const before = line.slice(0, m.index + m[1].length);
        const term = rowTerm(lines, li, before, words) || last;
        last = term;
        const rec = { code: code, status: res.status, label: audit ? before.trim() : '', cp: res.cp, title: res.title, term: term };
        const prev = best[code];
        if (!prev) { best[code] = rec; order.push(code); }
        else if (STATUS_RANK[res.status] > STATUS_RANK[prev.status]) { rec.label = rec.label || prev.label; best[code] = rec; }
      }
    });
    const out = order.map(function (c) { return best[c]; });
    // a row whose term cannot be read takes the nearest one read: the row above, or else the row below
    let below = null;
    for (let i = out.length - 1; i >= 0; i--) { if (out[i].term) below = out[i].term; else if (below) out[i].term = below; }
    return out;
  }
  // Degree Works "Still needed" requirements: "10 Credit Points in LAWS 2015", or a list such as
  // "60 Credit Points in JUST 2013 or 3008 or LAWS 2005 or 2007" that can run over several lines, where a
  // bare number keeps the subject area before it. "See ... section" points at a requirement listed elsewhere.
  function parseNeeded(lines) {
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const m = /^(.*?)\s*Still needed:\s*(.*)$/i.exec(lines[i]);
      if (!m) continue;
      let body = m[2].trim();
      while (/\b(or|and)$|,$/.test(body) && i + 1 < lines.length) body += ' ' + lines[++i].trim();
      const r = /^(\d+(?:\.\d+)?)\s+(Credit Points?|Class(?:es)?)\s+in\s+(.+)$/i.exec(body);
      if (!r) continue;
      const codes = [];
      let area = '';
      let any = false;
      r[3].split(/\s*(?:\bor\b|\band\b|,)\s*/i).forEach(function (t) {
        const c = /^([A-Z]{4})\s?([\d@]+)$/.exec(t);
        if (c) area = c[1];
        const num = c ? c[2] : /^[\d@]+$/.test(t) ? t : '';
        if (!num || !area) return;
        if (/@/.test(num)) any = true;
        else if (/^\d{4}$/.test(num) && codes.indexOf(area + ' ' + num) < 0) codes.push(area + ' ' + num);
      });
      if (!codes.length && !any) continue;
      const n = +r[1];
      const credit = /^credit/i.test(r[2]);
      out.push({ label: m[1].trim(), count: credit ? Math.max(1, Math.round(n / 10)) : n, cp: credit && n < 10 ? n : 10, codes: codes, any: any });
    }
    return out;
  }
  // the degree a PDF is for: "Program B Accounting/B Laws (2785)" in an audit, "2785 - Bachelor of
  // Accounting/Bachelor of Laws" on Subject Results, with the credit points it requires
  function pdfDegree(text) {
    let code = '';
    let name = '';
    let m = /Program\s+(.+?)\s*\((\d{4})\)/.exec(text);
    if (m) { name = m[1]; code = m[2]; }
    else {
      // "2785 - Bachelor of ...", or without the dash for a course that is one of the guides (a year can come first too)
      const re = /\b(\d{4})(\s*[-–]\s*|\s+)((?:Bachelor|Master|Graduate|Diploma|Associate)[^\n]*)/g;
      while ((m = re.exec(text))) {
        if (/[-–]/.test(m[2]) || DEG[m[1]]) { code = m[1]; name = m[3]; break; }
      }
    }
    const major = (/\bMajor\s+(.+?)\s+(?:Minor|Program)\b/.exec(text) || [])[1] || '';
    const cp = /Credit points required:\s*(\d+)/i.exec(text) || /Total Credit Points Required\s+(\d+)/i.exec(text);
    // the Handbook year the requirements come from: "Catalogue Term: 2024 AUTUMN", or "Catalogue Term 202430"
    const cat = /Catalogu?e Term:?\s*(20\d\d)/i.exec(text);
    return { code: code, name: name.trim(), major: /^no major$/i.test(major) ? '' : major.trim(), cp: cp ? +cp[1] : 0, catalogue: cat ? +cat[1] : 0 };
  }
  function pdfProgress(lines) {
    // cells copied from a table come apart with tabs or bars, and read the same as spaces
    lines = lines.map(function (l) { return String(l).replace(/[\t|]+/g, ' '); });
    const text = lines.join('\n');
    // the Subject Results page links to Degree Works at the foot, so it is recognised first
    const results = /Subject Results/i.test(text);
    const audit = !results && /Degree\s?Works|Still needed/i.test(text);
    return Object.assign(pdfDegree(text), {
      kind: results ? 'Subject Results page' : audit ? 'Degree Works audit' : 'PDF', audit: audit,
      found: parsePdfLines(lines, audit), needed: audit ? parseNeeded(lines) : null,
    });
  }
  // groups words into lines by their vertical position, with y measured down from the top of the page
  function pageLines(items) {
    const lines = [];
    items.filter(function (it) { return it.s.trim(); }).sort(function (a, b) { return a.y - b.y || a.x - b.x; }).forEach(function (it) {
      const last = lines[lines.length - 1];
      if (last && Math.abs(it.y - last.y) <= Math.max(last.h, it.h) * 0.5) last.items.push(it);
      else lines.push({ y: it.y, h: it.h, items: [it] });
    });
    return lines.map(function (l) {
      let text = '';
      let end = -Infinity;
      l.items.sort(function (a, b) { return a.x - b.x; }).forEach(function (it) {
        // pieces of one word sit right next to each other
        text += (text && it.x - end > it.h * 0.15 ? ' ' : '') + it.s.trim();
        end = it.x + it.w;
      });
      return text;
    });
  }

  // The PDF reader and, for printed pages that hold pictures of text, a text recogniser load from
  // jsDelivr the first time a student adds a PDF. Versions are pinned, and the scripts that run on this
  // page are checked against their hashes first. The file itself is read on this device.
  const PDF_LIBS = {
    reader: ['https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build/pdf.min.mjs', 'sha384-z/XbAtvhBXJoK+yvYimnFuTCF6/2wTCDSIFD09/HtIfwFtvDKOMdAe5Z3wOChkmW'],
    parser: ['https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build/pdf.worker.min.mjs', 'sha384-vbNBYP03jHFPlgtK4qSXtazEmGfmpTWlSsfq9OiU20MroW/Q9TbaEXiM7PpeWg+6'],
    ocr: ['https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js', 'sha384-GJqSu7vueQ9qN0E9yLPb3Wtpd7OrgK8KmYzC8T1IysG1bcvxvIO4qtYR/D3A991F'],
  };
  const OCR_FILES = {
    workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
    corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',
    langPath: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int',
  };
  const PDF_MAX_PAGES = 12;
  const OCR_SCALE = 3;
  const STALE = {};
  function libError(e) { e.lib = true; throw e; }
  function verifiedModule(lib) {
    return fetch(lib[0]).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.arrayBuffer();
    }).then(function (buf) {
      return crypto.subtle.digest('SHA-384', buf).then(function (h) {
        if ('sha384-' + btoa(String.fromCharCode.apply(null, new Uint8Array(h))) !== lib[1]) throw new Error('integrity');
        return import(URL.createObjectURL(new Blob([buf], { type: 'text/javascript' })));
      });
    });
  }
  let pdfReader = null;
  function loadPdfReader() {
    if (!pdfReader) {
      // the parser runs on this page rather than in a worker, which also works when the explorer is opened as a file
      pdfReader = Promise.all([verifiedModule(PDF_LIBS.reader), verifiedModule(PDF_LIBS.parser)]).then(function (mods) {
        window.pdfjsWorker = mods[1];
        return mods[0];
      });
      pdfReader.catch(function () { pdfReader = null; });
    }
    return pdfReader.catch(libError);
  }
  let ocrScript = null;
  // a fresh recogniser for each file, closed when the file is done since it holds its language data in memory
  function loadOcr() {
    if (!ocrScript) {
      ocrScript = window.Tesseract ? Promise.resolve(window.Tesseract) : new Promise(function (resolve, reject) {
        const s = document.createElement('script');
        s.src = PDF_LIBS.ocr[0];
        s.integrity = PDF_LIBS.ocr[1];
        s.crossOrigin = 'anonymous';
        s.onload = function () { resolve(window.Tesseract); };
        s.onerror = function () { s.remove(); reject(new Error('OCR script')); };
        document.head.appendChild(s);
      });
      ocrScript.catch(function () { ocrScript = null; });
    }
    return ocrScript.then(function (T) {
      return T.createWorker('eng', 1, OCR_FILES);
    }).then(function (w) {
      // one block of text: keeps the narrow grade and mark columns that page layout analysis drops
      return w.setParameters({ tessedit_pageseg_mode: '6' }).then(function () { return w; });
    }).catch(libError);
  }
  function textItems(tc) {
    return tc.items.map(function (it) {
      const t = it.transform;
      return { s: it.str, x: t[4], y: -t[5], h: Math.hypot(t[2], t[3]) || it.height || 10, w: it.width };
    });
  }
  function ocrItems(worker, page) {
    const vp = page.getViewport({ scale: OCR_SCALE });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    const c2d = canvas.getContext('2d');
    c2d.fillStyle = '#fff';
    c2d.fillRect(0, 0, canvas.width, canvas.height);
    return page.render({ canvasContext: c2d, viewport: vp }).promise.then(function () {
      return worker.recognize(canvas, {}, { blocks: true, text: false });
    }).then(function (r) {
      canvas.width = canvas.height = 0;
      const items = [];
      (r.data.blocks || []).forEach(function (b) {
        b.paragraphs.forEach(function (p) {
          p.lines.forEach(function (l) {
            l.words.forEach(function (w) { items.push({ s: w.text, x: w.bbox.x0, y: (w.bbox.y0 + w.bbox.y1) / 2, h: w.bbox.y1 - w.bbox.y0, w: w.bbox.x1 - w.bbox.x0 }); });
          });
        });
      });
      return items;
    });
  }
  function readPdfs(list) {
    const pdfs = Array.from(list || []);
    if (pdfs.length === 1 && (/\.json$/i.test(pdfs[0].name) || pdfs[0].type === 'application/json')) { restoreBackup(pdfs[0]); return; }
    pdfs.reduce(function (chain, f) { return chain.then(function () { return readPdf(f); }); }, Promise.resolve());
  }
  function readPdf(file) {
    const job = ui.importJob = (ui.importJob || 0) + 1;
    const live = function () { return ui.modal === 'progress' && ui.importJob === job; };
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      progressStatus('That file is not a PDF. Save your Degree Works audit or Subject Results page as a PDF, then choose it here.', 'error');
      return Promise.resolve();
    }
    progressStatus('Opening ' + file.name + '…', 'busy');
    let ocr = null;
    return Promise.all([loadPdfReader(), file.arrayBuffer()]).then(function (r) {
      return r[0].getDocument({ data: new Uint8Array(r[1]), isEvalSupported: false }).promise;
    }).then(function (doc) {
      const n = Math.min(doc.numPages, PDF_MAX_PAGES);
      const lines = [];
      let chain = Promise.resolve();
      for (let i = 1; i <= n; i++) {
        chain = chain.then(function () {
          if (!live()) throw STALE;
          return doc.getPage(i);
        }).then(function (page) {
          return page.getTextContent().then(function (tc) {
            const items = textItems(tc);
            if (items.map(function (it) { return it.s; }).join('').replace(/\s/g, '').length >= 20) return items;
            // a page printed to PDF can hold pictures of its text instead of text, so it is read like a scan
            progressStatus(ocr ? 'Reading page ' + i + ' of ' + n + '…' : 'Getting the text reader ready (about 7 MB, only the first time)…', 'busy');
            ocr = ocr || loadOcr();
            return ocr.then(function (w) {
              if (!live()) throw STALE;
              progressStatus('Reading page ' + i + ' of ' + n + '…', 'busy');
              return ocrItems(w, page);
            });
          }).then(function (items) { lines.push.apply(lines, pageLines(items)); });
        });
      }
      return chain.then(function () { doc.destroy(); return lines; }, function (e) { doc.destroy(); throw e; });
    }).then(function (lines) {
      if (live()) addProgressFile(file.name, pdfProgress(lines));
    }).catch(function (e) {
      if (e === STALE || !live()) return;
      progressStatus(e.lib ? 'The PDF reader could not load. Check your internet connection and try again.' :
        e.name === 'PasswordException' ? 'That PDF is password-protected. Save it again without a password, then choose it here.' :
        'That file could not be read as a PDF. Save your Degree Works audit or Subject Results page as a PDF and try again.', 'error');
    }).then(function () {
      if (ocr) ocr.then(function (w) { w.terminate(); }, function () {});
    });
  }
  function progressStatus(msg, kind) {
    const el = $('#progress-status');
    if (!el) return;
    el.hidden = !msg;
    el.textContent = msg || '';
    el.className = 'import-status' + (kind ? ' is-' + kind : '');
  }

  // ---- the imported plan. Sessions begin about the start of March (Autumn), mid-July (Spring) and
  // December (Summer); a session that has begun is history, so what is left starts in the next one.
  const SESSION_BEGINS = { Autumn: [2, 1], Spring: [6, 15], Summer: [11, 1] };
  function nowDate() { return ui.now ? new Date(ui.now) : new Date(); }
  function firstOpenIdx(start) {
    const now = nowDate();
    let k = 0;
    while (k < MAX_YEARS * 3 && new Date(start + Math.floor(k / 3), SESSION_BEGINS[PLAN_SESSIONS[k % 3]][0], SESSION_BEGINS[PLAN_SESSIONS[k % 3]][1]) <= now) k++;
    return k;
  }
  const PHASE_YEAR = {};
  PHASE_OUT.forEach(function (p) { p[1].forEach(function (s) { PHASE_YEAR[s[0]] = p[0]; }); });
  // the session type a subject runs in, when the 2027 guides offer it in only one
  function offeredIn(code) { return runsIn([code]); }
  // the session type a set of subjects runs in, when every one of them runs only in that one
  function runsIn(codes) {
    const runs = {};
    codes.forEach(function (code) {
      const e = GLOBAL_BY_CODE[code];
      if (!e) { runs.Autumn = runs.Spring = 1; return; }
      if (!parseOffered(e.autumn).none) runs.Autumn = 1;
      if (!parseOffered(e.spring).none) runs.Spring = 1;
    });
    return runs.Autumn && !runs.Spring ? 'Autumn' : runs.Spring && !runs.Autumn ? 'Spring' : '';
  }
  // Builds a custom plan from a student's PDFs, based on their WSLSA pathway when the course is one of the guides.
  // History keeps its real sessions, with Year 1 the year the student started. Each subject is tied to the pathway
  // slot it fills: the same code, its pre-2027 or 2027 equivalent (LAWS 1009 fills Legal Methods), the pathway
  // subject a Degree Works requirement names, or a choice whose list includes it, where a choice that stands for a
  // whole list takes anything on that list, and a subject on two lists fills the narrower one first. What is left
  // comes from the audit's Still needed lists when the audit follows the structure the student has chosen, or from
  // the pathway slots not yet filled. A student who started before 2027 follows the pre-2027 structure: the three
  // core subjects new in 2027 are LLB Alternate slots instead, and a pre-2027 subject still needed shows as the 2027
  // subject that replaces it. The rest is laid out from the next session at 40 CP a session, subjects being phased
  // out first, and open slots then make up any credit points still missing.
  function buildProgress(info, opts) {
    opts = opts || {};
    // a record that does not name its degree (results pasted from MySR, say) follows the degree on screen
    const onScreen = info.code ? null : isCustom() ? (state.custom.tpl ? DEG[state.custom.tpl.split('|')[0]] : null) : DEG[state.degree];
    const deg = DEG[info.code] || onScreen || null;
    let tpl = '';
    if (deg) {
      const named = info.major ? deg.options.filter(function (k) { return OPT[k].majorCode !== 'BASE' && normQ(OPT[k].majorName) === normQ(info.major); })[0] : '';
      tpl = named || (deg.options.indexOf(state.majorFor[deg.code]) >= 0 ? state.majorFor[deg.code] : deg.options[0]);
    }
    const tdeg = tpl ? DEG[tpl.split('|')[0]] : null;
    const tctx = { deg: tdeg || BLANK_DEG, custom: false, slots: tpl ? PATH[tpl].map(function (raw) { return resolveSlot(raw, tdeg, OPT[tpl], {}, {}); }) : [] };
    // a subject with no session anywhere in the record goes in Year 1 Autumn, rather than being left out
    const termed = info.found.filter(function (f) { return f.term; });
    const y0 = termed.length ? Math.min.apply(null, termed.map(function (f) { return f.term.year; })) : nowDate().getFullYear();
    const history = info.found.filter(function (f) { return f.status !== 'failed' && f.cp > 0; }).map(function (f) {
      return f.term ? f : Object.assign({}, f, { term: { year: y0, session: 'Autumn' }, guessed: true });
    });
    if (!history.length) return null;
    const start = Math.min.apply(null, history.map(function (f) { return f.term.year; }));
    const began = info.catalogue ? Math.min(info.catalogue, start) : start;
    const detected = began < START_YEAR ? 'pre2027' : '2027';
    const cohort = opts.cohort || detected;
    const pre = cohort === 'pre2027';
    const had = {};
    history.forEach(function (f) { sameAs(f.code).forEach(function (c) { had[c] = 1; }); });
    const used = {};
    const link = {};
    const counted = [];
    const take = function (code, s) { used[s.id] = 1; link[code] = s; };
    const fixed = tctx.slots.filter(function (s) { return !s.pending && s.code; });
    history.forEach(function (f) {
      const s = fixed.find(function (x) { return x.code === f.code && !used[x.id]; });
      if (s) take(f.code, s);
    });
    history.forEach(function (f) {
      if (link[f.code]) return;
      const s = fixed.find(function (x) { return !used[x.id] && x.code !== f.code && sameAs(f.code).indexOf(x.code) >= 0; });
      if (!s) return;
      take(f.code, s);
      counted.push({ from: f.code, to: s.code });
    });
    history.forEach(function (f) {
      const s = !link[f.code] && f.label && fixed.find(function (x) { return !used[x.id] && !had[x.code] && normQ(x.title) === normQ(f.label); });
      if (s) take(f.code, s);
    });
    const listSlot = function (s) { return s.kind === 'inline' && !!choiceComponent(tctx.deg, s.raw); };
    const open = tctx.slots.filter(function (s) { return !used[s.id] && (s.pending || (listSlot(s) && !had[s.code])); })
      .map(function (s) { return choiceList(tctx, s, true); }).filter(function (c) { return c.rank != null; });
    history.filter(function (f) { return !link[f.code]; }).map(function (f) {
      return { f: f, fits: open.filter(function (c) { return c.codes[f.code]; }).sort(function (a, b) { return a.rank - b.rank || a.at - b.at; }) };
    }).filter(function (x) { return x.fits.length; }).sort(function (a, b) { return a.fits.length - b.fits.length; }).forEach(function (x) {
      const c = x.fits.find(function (o) { return !used[o.s.id]; });
      if (c) take(x.f.code, c.s);
    });

    const inProgressDone = opts.inProgressDone !== false;
    const slots = history.map(function (f) {
      const known = GLOBAL_BY_CODE[f.code] || EXTRA_BY_CODE[f.code];
      return { y: f.term.year - start + 1, s: f.term.session, code: f.code, title: known ? '' : (f.title || f.code).slice(0, 140), cp: f.cp, o: link[f.code] ? link[f.code].id : '', done: f.status === 'done' || (inProgressDone && f.status === 'progress') };
    });
    const llbId = (tctx.slots.find(function (s) { return s.kind === 'llb'; }) || {}).id || '';
    const rest = [];
    // an audit lists what the student still needs under the structure of its own catalogue term
    const auditPre = (info.catalogue || start) < START_YEAR;
    const hasNeeded = !!(info.needed && info.needed.length);
    const fromAudit = hasNeeded && auditPre === pre;
    if (fromAudit) {
      info.needed.forEach(function (r) {
        if (r.codes.length === 1 && !r.any && r.count === 1) {
          let code = r.codes[0];
          if (had[code]) return;
          // a pre-2027 subject still needed shows as the 2027 subject that replaces it, the one to enrol in, with a note
          // under the pre-2027 structure a pre-2027 subject still needed stays as it is; under the 2027 structure it is
          // the 2027 subject that replaces it, with a note
          const was = !pre && LEGACY_EQUIVALENTS[code] ? code : '';
          if (was) code = LEGACY_EQUIVALENTS[was];
          else if (pre && LEGACY_OF[code]) code = LEGACY_OF[code];
          const t = fixed.find(function (x) { return sameAs(code).indexOf(x.code) >= 0 && !used[x.id]; });
          if (t) used[t.id] = 1;
          rest.push({ code: code, was: was, first: PHASE_YEAR[was || code], cp: GLOBAL_BY_CODE[code] ? GLOBAL_BY_CODE[code].cp : r.cp, o: t ? t.id : '', sess: t ? t.session : offeredIn(code) });
          return;
        }
        // a list to choose from becomes open slots tied to the pathway choice that shares most of the list,
        // so the picker suggests the right subjects; they can go in either session
        const fits = open.map(function (c) { return { c: c, n: r.codes.filter(function (code) { return c.codes[code]; }).length }; })
          .filter(function (x) { return x.n; }).sort(function (a, b) { return b.n - a.n || a.c.at - b.c.at; });
        for (let n = 0; n < r.count; n++) {
          const pick = fits.find(function (x) { return !used[x.c.s.id]; }) || fits[0];
          if (pick) used[pick.c.s.id] = 1;
          rest.push({ code: '', cp: r.cp, o: pick ? pick.c.s.id : '', sess: '' });
        }
      });
    } else {
      tctx.slots.forEach(function (s) {
        if (used[s.id]) return;
        // passed already, or its pre-2027 or 2027 equivalent was
        if (!s.pending && had[s.code]) return;
        if (pre && NEW_2027_CORES.indexOf(s.code) >= 0) { rest.push({ code: '', cp: s.cp, o: llbId, sess: '', newCore: s.code }); return; }
        // in the pre-2027 structure a 2027 subject that replaces a pre-2027 one the student has not passed says so
        const old = pre && !s.pending && LEGACY_OF[s.code] && !had[LEGACY_OF[s.code]] ? LEGACY_OF[s.code] : '';
        // an open choice can go in any session its options run in
        rest.push({ code: s.pending ? '' : old || s.code, was: '', first: PHASE_YEAR[old], cp: s.cp, o: s.id, sess: s.pending ? (s.kind === 'inline' ? runsIn(s.raw.options.map(function (x) { return x.code; })) : '') : s.session });
      });
    }
    const cp = clampCP(info.cp || (tdeg ? tdeg.cp : 0) || slots.concat(rest).reduce(function (a, x) { return a + x.cp; }, 0));
    for (let have = slots.concat(rest).reduce(function (a, x) { return a + x.cp; }, 0); have < cp; have += 10) rest.push({ code: '', cp: 10, o: '', sess: '' });
    rest.sort(function (a, b) { return (a.first || 9999) - (b.first || 9999); });

    const first = Math.max(slots.reduce(function (m, x) { return Math.max(m, orderIdx(x.y, x.s)); }, -1) + 1, firstOpenIdx(start));
    const load = {};
    let lastK = -1;
    let next = Infinity;
    // named subjects first, in order, and open slots then fill the room they leave: this sets the years the plan shows
    // ahead, while the subjects themselves go in the Suggested Remaining Guide
    rest.filter(function (r) { return r.code; }).concat(rest.filter(function (r) { return !r.code; })).forEach(function (r) {
      let k = first;
      while (PLAN_SESSIONS[k % 3] === 'Summer' || (r.sess && PLAN_SESSIONS[k % 3] !== r.sess) || (load[k] && load[k] + r.cp > LOAD_CP.FT)) k++;
      load[k] = (load[k] || 0) + r.cp;
      lastK = Math.max(lastK, k);
      next = Math.min(next, k);
    });
    // only what the student has passed or is studying goes in the plan; the sessions ahead stay empty for them to fill
    const plan = sanitiseCustom({
      name: tdeg ? tdeg.title : info.name || 'My degree', code: tdeg ? tdeg.code : info.code, cp: cp, tpl: tpl, start: start, cohort: cohort,
      years: lastK >= 0 ? Math.floor(lastK / 3) + 1 : 0,
      need: rest.map(function (r) { return { code: r.code, was: r.was || '', cp: r.cp, o: r.o, sess: r.sess }; }),
      slots: slots,
    });
    return {
      info: info, plan: plan, tpl: tpl, tdeg: tdeg, start: start, began: began, cohort: cohort, detected: detected, onScreen: !!onScreen,
      fromAudit: fromAudit, auditSetAside: hasNeeded && !fromAudit, history: history, rest: rest,
      counted: counted, swapped: rest.filter(function (r) { return r.was; }), newCores: rest.filter(function (r) { return r.newCore; }).map(function (r) { return r.newCore; }),
      next: next < Infinity ? termName(start + Math.floor(next / 3), PLAN_SESSIONS[next % 3]) : '',
      failed: info.found.filter(function (f) { return f.status === 'failed'; }),
    };
  }
  // one record from several PDFs, such as a Subject Results page and a Degree Works audit: each subject once, with
  // its best status and the term it was taken, and the audit's degree, catalogue term and Still needed lists
  function mergeProgress(list) {
    if (!list.length) return null;
    if (list.length === 1) return list[0].info;
    // the audit added last is the most recent one
    const audit = list.map(function (x) { return x.info; }).filter(function (i) { return i.audit; }).pop();
    const base = audit || list[0].info;
    const out = Object.assign({}, base, {
      kind: list.map(function (x) { return x.info.kind; }).filter(function (k, i, all) { return all.indexOf(k) === i; }).join(' and '),
      needed: audit ? audit.needed : null, found: [],
    });
    ['code', 'name', 'major', 'cp', 'catalogue'].forEach(function (k) {
      if (out[k]) return;
      const other = list.map(function (x) { return x.info[k]; }).filter(Boolean)[0];
      if (other) out[k] = other;
    });
    const best = {};
    const order = [];
    list.forEach(function (x) {
      x.info.found.forEach(function (f) {
        const prev = best[f.code];
        if (!prev) { best[f.code] = Object.assign({}, f); order.push(f.code); return; }
        if (STATUS_RANK[f.status] > STATUS_RANK[prev.status] || (STATUS_RANK[f.status] === STATUS_RANK[prev.status] && !prev.term && f.term)) {
          best[f.code] = Object.assign({}, f, { label: f.label || prev.label, title: f.title || prev.title });
        } else if (!prev.label && f.label) prev.label = f.label;
      });
    });
    out.found = order.map(function (c) { return best[c]; });
    return out;
  }
  function openProgress() {
    ui.modal = 'progress';
    ui.progress = null;
    ui.progressFiles = [];
    ui.progressOpts = {};
    showModal('<div class="modal-backdrop" data-action="backdrop"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="progress-h">' +
      '<div class="modal-head"><div><h2 id="progress-h">Import my progress</h2><p>Add your Degree Works audit, your Subject Results page or both as PDFs and your plan is rebuilt from them: the subjects you have completed or are studying go in the sessions you took them, and what you still need goes in a Suggested Remaining Guide, with your sessions ahead left for you to fill. Grades and marks are never shown or kept, and your file stays in this browser.</p></div><button type="button" class="modal-x" data-action="modal-close" aria-label="Close">×</button></div>' +
      '<div class="modal-body import-body">' +
      '<div class="import-drop" id="progress-drop"><input type="file" id="progress-file" accept="application/pdf,.pdf,application/json,.json" multiple hidden>' +
      '<button type="button" class="btn btn-primary" data-action="progress-file" id="progress-choose">Choose files</button>' +
      '<p><b>Degree Works audit and Subject Results page</b>Save either one as a PDF (Print, then Save as PDF), then choose it here or drop it on this box. Add both and they are read together: your Subject Results page gives every result, and your audit adds the subjects you are studying now and what you still need. A plan backup (.json) goes here too, and restores everything in one step.</p></div>' +
      '<details class="paste-box" id="progress-paste-box"><summary>Or paste your results from MySR</summary><label class="sr-only" for="progress-text">Your results, copied from MySR</label>' +
      '<textarea class="input" id="progress-text" rows="6" placeholder="Select your Subject Results table in MySR (with its terms, codes, grades and credit points), copy it, and paste it here"></textarea>' +
      '<div class="paste-actions"><button type="button" class="btn" data-action="progress-paste">Read pasted results</button><span class="small muted">Read together with any PDFs above, and kept in this browser only.</span></div></details>' +
      '<p class="import-status" id="progress-status" role="status" hidden></p>' +
      '<div id="progress-results"></div></div>' +
      '<div class="modal-foot"><span class="small muted">Import again whenever you have new results.</span><div style="display:flex;gap:8px;flex-wrap:wrap">' +
      '<button type="button" class="btn" data-action="backup-save" title="Save your whole plan to a file on this device">Download Plan Backup (.json)</button>' +
      '<button type="button" class="btn btn-ghost" data-action="modal-close">Cancel</button><button type="button" class="btn btn-primary" data-action="progress-apply" id="progress-apply" disabled>Build my plan</button></div></div></div></div>');
    lockScroll();
  }
  // each PDF read joins the ones before it; one with the same file name takes its place
  function addProgressFile(name, info) {
    ui.progressFiles = (ui.progressFiles || []).filter(function (f) { return f.name !== name; }).concat([{ name: name, info: info }]);
    showProgress();
  }
  function showProgress() {
    const list = ui.progressFiles || [];
    const info = mergeProgress(list);
    ui.progress = info ? buildProgress(info, ui.progressOpts || {}) : null;
    renderProgress();
    const kinds = list.length > 1 ? plural(list.length, 'file') + ' (' + info.kind + ')' : 'your ' + (info ? info.kind : 'file');
    if (ui.progress) progressStatus('Read ' + kinds + '. Check what was found, then build your plan.', 'ok');
    else if (info) progressStatus('No subjects with results were found in ' + (list.length > 1 ? 'those files' : 'that ' + info.kind) + '. Use your Degree Works audit or Subject Results page saved as a PDF.', 'error');
    const choose = $('#progress-choose');
    if (choose) choose.textContent = list.length ? 'Add another PDF' : 'Choose files';
  }
  function renderProgress() {
    const p = ui.progress;
    const btn = $('#progress-apply');
    if (btn) btn.disabled = !p;
    const box = $('#progress-results');
    if (!box) return;
    if (!p) { box.innerHTML = ''; return; }
    const cpOf = function (list) { return list.reduce(function (a, x) { return a + x.cp; }, 0); };
    const done = p.history.filter(function (f) { return f.status === 'done'; });
    const now = p.history.filter(function (f) { return f.status === 'progress'; });
    const fact = function (n, label, list) { return '<div><b>' + n + '</b><span>' + label + ' <small>' + cpOf(list) + ' CP</small></span></div>'; };
    const files = ui.progressFiles || [];
    const titleOf = function (f) { const k = GLOBAL_BY_CODE[f.code] || EXTRA_BY_CODE[f.code]; return k ? k.title : f.title; };
    const groups = {};
    p.history.forEach(function (f) {
      const k = (f.term.year - p.start) * 3 + PLAN_SESSIONS.indexOf(f.term.session);
      (groups[k] = groups[k] || { label: termName(f.term.year, f.term.session), list: [] }).list.push(f);
    });
    const deg = p.tdeg ? p.tdeg.code + ' ' + p.tdeg.title + (OPT[p.tpl].majorCode !== 'BASE' ? ' · ' + OPT[p.tpl].majorLabel : '') : (p.info.code ? p.info.code + ' ' : '') + (p.info.name || 'Your degree');
    const notes = [];
    if (p.onScreen) notes.push('Your record does not name its degree, so your plan follows ' + esc(p.tdeg.code + ' ' + p.tdeg.title) + ', the degree on screen. Choose your degree first if that is not right.');
    if (!p.tdeg) notes.push((p.info.code ? 'Course ' + esc(p.info.code) + ' is' : 'This degree is') + ' not one of the 2027 WSLSA guides, so your plan has no WSLSA pathway behind it.');
    else if (isCustom() ? state.custom.tpl.split('|')[0] !== p.tdeg.code : state.degree !== p.tdeg.code) notes.push('Your PDF is for ' + esc(p.tdeg.code + ' ' + p.tdeg.title) + ', so your plan follows that degree.');
    const guessed = p.history.filter(function (f) { return f.guessed; });
    if (guessed.length) notes.push('No session was found for ' + esc(guessed.map(function (f) { return f.code; }).join(', ')) + ', so ' + (guessed.length === 1 ? 'it goes' : 'they go') + ' in ' + esc(termName(guessed[0].term.year, 'Autumn')) + '. Move ' + (guessed.length === 1 ? 'it' : 'them') + ' to the right session once your plan is built.');
    if (p.failed.length) notes.push(esc(p.failed.map(function (f) { return f.code; }).join(', ')) + (p.failed.length === 1 ? ' looks' : ' look') + ' like a fail or withdrawal, so ' + (p.failed.length === 1 ? 'it is' : 'they are') + ' left out.');
    if (p.counted.length) notes.push('Counted for the 2027 subjects they match: ' + p.counted.map(function (c) { return esc(c.from) + ' for ' + esc(c.to); }).join(', ') + '.');
    if (p.newCores.length) notes.push('Under the pre-2027 structure, ' + esc(p.newCores.join(', ')) + (p.newCores.length === 1 ? ' is' : ' are') + ' not part of your degree, so ' + plural(p.newCores.length, 'more LLB Alternate slot') + ' take their place.');
    const olds = p.rest.filter(function (r) { return r.code && LEGACY[r.code]; });
    if (olds.length) notes.push('Still needed from before 2027, and suggested while each is still offered: ' + olds.map(function (r) { return esc(r.code) + (PHASE_YEAR[r.code] ? ' (last offered ' + PHASE_YEAR[r.code] + ')' : ''); }).join(', ') + '. After its final offering, the 2027 subject that replaces it is suggested. Check with the School of Law which one to enrol in.');
    if (p.swapped.length) notes.push('Still needed and shown as the 2027 subject that replaces it: ' + p.swapped.map(function (r) { return esc(r.code) + ' for ' + esc(r.was) + (PHASE_YEAR[r.was] ? ' (last offered ' + PHASE_YEAR[r.was] + ')' : ''); }).join(', ') + '. Check with the School of Law which one to enrol in.');
    if (p.auditSetAside) notes.push('Your audit lists what you still need under the ' + (p.cohort === 'pre2027' ? '2027' : 'pre-2027') + ' structure, so with the structure chosen here the rest follows the WSLSA 2027 pathway instead.');
    const filled = state.custom ? state.custom.slots.filter(function (x) { return x.code; }).length : 0;
    const first = Object.keys(groups).map(Number).sort(function (a, b) { return a - b; })[0];
    const a = document.activeElement && document.activeElement.id;
    box.innerHTML =
      (files.length > 1 ? '<p class="pp-files">Read together: ' + files.map(function (f) { return '<b>' + esc(f.name) + '</b> (' + esc(f.info.kind) + ')'; }).join(', ') + ' <button type="button" class="linkish" data-action="progress-reset">Start again</button></p>' : '') +
      '<div class="progress-head"><p class="kicker">Your degree</p><h3>' + esc(deg) + '</h3><p>Started ' + esc(groups[first].label) + ' · ' + p.plan.cp + ' CP required</p></div>' +
      cohortSet('pp-cohort', p.cohort, { [p.detected]: '(from your record: ' + (p.began < START_YEAR ? 'started ' : 'starting ') + p.began + ')' }) +
      (now.length ? '<label class="check-row pp-inprogress"><input type="checkbox" id="pp-inprogress"' + ((ui.progressOpts || {}).inProgressDone !== false ? ' checked' : '') + '><span>Mark In-Progress subjects as completed/enrolled in their session</span></label>' : '') +
      '<div class="progress-facts">' + fact(done.length, 'Completed', done) + fact(now.length, 'In progress', now) + fact(p.rest.length, 'Still to plan', p.rest) + '</div>' +
      '<p class="pick-hint">' + (p.fromAudit ? 'What you still need comes from the Still needed lists in your audit'
        : p.auditSetAside ? 'The rest follows the WSLSA 2027 pathway' + (p.cohort === 'pre2027' ? ' under the pre-2027 structure' : '')
          : 'Your ' + esc(p.info.kind) + ' does not list what you still need, so the rest follows the WSLSA 2027 pathway' + (p.cohort === 'pre2027' ? ' under the pre-2027 structure' : '') + '. Your Degree Works audit lists it, so add that too for a plan that matches your own requirements') +
      (p.next ? '. It goes in a Suggested Remaining Guide with a suggested session for each, from ' + esc(p.next) + ', and your sessions ahead stay empty for you to fill.' : '.') + '</p>' +
      notes.map(function (n) { return '<p class="pick-hint">' + n + '</p>'; }).join('') +
      '<div class="pick-section"><h3><span>Your subjects so far</span><span>' + p.history.length + '</span></h3><div class="progress-sessions">' +
      Object.keys(groups).map(Number).sort(function (a, b) { return a - b; }).map(function (k) {
        return '<div class="ps-row"><span class="ps-when">' + esc(groups[k].label) + '</span><div class="chiplist">' + groups[k].list.map(function (f) {
          return '<span class="chipbtn' + (f.status === 'progress' ? ' is-open' : '') + '"><code>' + esc(f.code) + '</code>' + esc(titleOf(f)) + (f.status === 'progress' ? ' <span class="pp-badge">In Progress (' + f.term.year + ' ' + f.term.session + ')</span>' : '') + '</span>';
        }).join('') + '</div></div>';
      }).join('') + '</div></div>' +
      (filled ? '<p class="cs-warn">Building replaces your current custom plan and its ' + plural(filled, 'subject') + '.</p>' : '');
    if (a && document.getElementById(a)) document.getElementById(a).focus({ preventScroll: true });
  }
  function applyProgress() {
    const p = ui.progress;
    if (!p) return;
    noteChange('imported your progress');
    state.custom = p.plan;
    state.mode = 'custom';
    ui.folded = null;
    if (p.tdeg) { state.degree = p.tdeg.code; state.majorFor[p.tdeg.code] = p.tpl; }
    const done = p.history.filter(function (f) { return f.status === 'done'; }).length;
    const now = p.history.length - done;
    closeModal(true);
    renderEntering();
    ui.guideOpen = true;
    toast('Plan rebuilt from your ' + p.info.kind + ': ' + done + ' completed' + (now ? ', ' + now + ' in progress' : '') + ', and ' + p.rest.length + ' still to place, listed in the Suggested Remaining Guide.');
    const head = $('.section-head');
    if (head) head.scrollIntoView({ behavior: scrollMode(), block: 'start' });
  }

  // ======================================================================== tick off from results
  // Every subject code in pasted text (an academic record, results or a plain list) is matched to the
  // plan. A code followed on its line by a fail or withdrawal grade is left unticked for the student
  // to check, and a passed subject outside the plan fills the open choice whose list includes it.
  // Nothing pasted is stored or sent anywhere.
  const FAIL_MARK = /(^|[^A-Za-z])(F|FF|AF|FAIL|FAILED|W|WD|WN|WITHDRAWN|INCOMPLETE|DNS)(?![A-Za-z])/i;
  // a grade with its credit points straight after a code ("D 10", or "NA (10)" for a subject in progress)
  function gradeRow(words) {
    for (let i = 0; i < words.length - 1; i++) {
      const status = gradeStatus(words[i]);
      if (!status || !RESULT_NUM.test(words[i + 1])) continue;
      let j = i + 1;
      while (j + 1 < words.length && RESULT_NUM.test(words[j + 1])) j++;
      return { status: /^\(/.test(words[j]) ? 'progress' : status, cp: parseFloat(words[j].replace(/[()]/g, '')) };
    }
    return null;
  }
  function parseResults(text) {
    const found = [];
    const seen = {};
    const lines = String(text || '').split(/\r?\n/);
    for (let li = 0; li < lines.length; li++) {
      let line = lines[li];
      // a Degree Works "Still needed" requirement is a list of what is still to do, and can run over several lines
      if (/Still needed/i.test(line)) {
        while (/\b(or|and)\s*$|,\s*$/i.test(line) && li + 1 < lines.length) line = lines[++li];
        continue;
      }
      const hits = [];
      const re = /(^|[^A-Za-z0-9])([A-Za-z]{4})\s?(\d{4})(?![0-9])/g;
      let m;
      while ((m = re.exec(line))) hits.push({ code: m[2].toUpperCase() + ' ' + m[3], end: re.lastIndex, start: m.index + m[1].length });
      hits.forEach(function (h, i) {
        if (seen[h.code]) return;
        // the grade belongs to the text between this code and the next one on the line
        const tail = line.slice(h.end, i + 1 < hits.length ? hits[i + 1].start : line.length);
        const before = line.slice(i ? hits[i - 1].end : 0, h.start);
        // a code in a list of options ("LAWS 2005 or 2007") is something to choose from, not a result
        if (/^\s*or(\s|$)/i.test(tail) || /(^|\s)or\s*$/i.test(before)) return;
        const row = gradeRow(tail.trim().split(/\s+/));
        // a 0 CP module (the academic integrity module) is not part of a degree
        if (row && row.cp === 0 && !GLOBAL_BY_CODE[h.code]) return;
        seen[h.code] = 1;
        found.push({ code: h.code, status: row ? (row.status === 'failed' ? 'failed' : row.status) : FAIL_MARK.test(tail) ? 'failed' : 'done' });
      });
    }
    return found;
  }
  // the subjects an open choice takes, which Import my progress also uses to tie history to the pathway
  // a choice whose options all come from one list (in 2785, FINC 2002 is the Autumn option among the Alternate
  // Accounting subjects) stands for that list: a subject already passed from the list counts for it
  function choiceComponent(deg, raw) {
    if (!raw || !raw.options || !raw.options.length || !deg.components) return '';
    const comps = deg.components.filter(function (c) {
      return c !== 'Core' && raw.options.every(function (o) { return (deg.byComp[c] || []).some(function (e) { return e.code === o.code; }); });
    });
    return comps.length === 1 ? comps[0] : '';
  }
  function choiceList(ctx, s, wide) {
    const k = ctx.custom ? (s.orig ? s.orig.kind : '') : s.kind;
    const listed = !ctx.custom && wide && s.kind === 'inline' ? choiceComponent(ctx.deg, s.raw) : '';
    const entries = ctx.custom ? (s.orig ? suggestionsFor(ctx, s) : []) : listed ? ctx.deg.byComp[listed] : s.kind === 'inline' ? s.raw.options : s.kind === 'llb' || s.kind === 'pool' || s.kind === 'elective' ? poolEntries(ctx, s.raw) : [];
    const codes = {};
    entries.forEach(function (e) { codes[e.code] = e; });
    // the most specific choice first: a named option, then a pool, then LLB Alternates and electives
    return { s: s, codes: codes, rank: { fixed: 0, option: 0, inline: 0, pool: 1, llb: 2, elective: 3 }[k], at: orderIdx(s.year, s.session) };
  }
  function matchFound(found, ctx) {
    const inPlan = {};
    ctx.slots.forEach(function (s) { if (!s.pending && s.code) (inPlan[s.code] = inPlan[s.code] || []).push(s); });
    // text such as "Year 2027" also looks like a code, so only real subjects (or ones in the plan) count
    const out = found.map(function (f) {
      let slots = inPlan[f.code] || [];
      // a pre-2027 subject ticks off the 2027 subject that replaces it, and the other way round
      const alt = slots.length ? '' : sameAs(f.code).filter(function (c) { return c !== f.code && inPlan[c]; })[0] || '';
      if (alt) slots = inPlan[alt];
      const known = GLOBAL_BY_CODE[f.code] || EXTRA_BY_CODE[f.code];
      return { code: f.code, status: f.status, counts: alt, slots: slots, known: !!known, place: null, entry: null, title: known ? known.title : slots.length ? slots[0].title : '', done: slots.length > 0 && slots.every(function (s) { return s.done; }) };
    }).filter(function (f) { return f.slots.length || f.known; });
    const claimed = {};
    const open = ctx.slots.filter(function (s) { return s.pending; }).map(function (s) { return choiceList(ctx, s); }).filter(function (c) { return c.rank != null; });
    out.filter(function (f) { return f.status !== 'failed' && !f.slots.length; }).map(function (f) {
      return { f: f, fits: open.filter(function (c) { return c.codes[f.code]; }).sort(function (a, b) { return a.rank - b.rank || a.at - b.at; }) };
    }).filter(function (x) { return x.fits.length; }).sort(function (a, b) { return a.fits.length - b.fits.length; }).forEach(function (x) {
      const c = x.fits.find(function (o) { return !claimed[o.s.id]; });
      if (!c) return;
      claimed[c.s.id] = 1;
      x.f.place = c.s;
      x.f.entry = c.codes[x.f.code];
      x.f.title = x.f.entry.title;
    });
    return out;
  }
  function openImport() {
    ui.modal = 'import';
    ui.importFound = [];
    showModal('<div class="modal-backdrop" data-action="backdrop"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="import-h">' +
      '<div class="modal-head"><div><h2 id="import-h">Tick off from my results</h2><p>Paste your academic record, results or a list of subjects you have passed. Every subject code in the text is matched to your plan, and nothing you paste leaves this browser. To rebuild your plan from a PDF instead, use Import my progress.</p></div><button type="button" class="modal-x" data-action="modal-close" aria-label="Close">×</button></div>' +
      '<div class="modal-body import-body"><label class="field-label" for="import-text">Your results</label>' +
      '<textarea class="input" id="import-text" rows="6" placeholder="For example:&#10;LAWS 1003  Fundamentals of Australian Law  HD&#10;LAWS1010  Legal Methods  D"></textarea>' +
      '<div id="import-results"></div></div>' +
      '<div class="modal-foot"><span class="small muted" id="import-summary">Subjects you pass later can be ticked here again.</span><div style="display:flex;gap:8px;flex-wrap:wrap">' +
      '<button type="button" class="btn" data-action="backup-save" title="Save your whole plan to a file on this device">Download Plan Backup (.json)</button>' +
      '<button type="button" class="btn btn-ghost" data-action="modal-close">Cancel</button><button type="button" class="btn btn-primary" data-action="import-apply" id="import-apply" disabled>Tick subjects</button></div></div></div></div>');
    lockScroll();
    const t = $('#import-text');
    if (t && window.matchMedia('(pointer:fine)').matches) t.focus();
  }
  function importRow(f, i, place) {
    const done = !place && f.done;
    const note = done ? '<span class="status status-major">Already ticked</span>' :
      f.status === 'failed' ? '<span class="status status-non">Looks like a fail or withdrawal</span>' :
      f.status === 'progress' ? '<span class="status status-best">In progress</span>' :
      place ? '<span class="status status-best">Fills a choice</span>' : '';
    const at = (place ? where(f.place) + ' · ' + esc(f.place.typeLabel || 'Open slot') : f.slots.map(where).join(', ')) + (f.counts ? ' · counts for ' + esc(f.counts) : '');
    return '<label class="import-row"><input type="checkbox" name="import-pick" value="' + i + '"' + (done ? ' checked disabled' : f.status !== 'failed' ? ' checked' : '') + '>' +
      '<code>' + esc(f.code) + '</code><span class="import-title">' + esc(f.title) + ' <small>' + at + '</small></span>' + note + '</label>';
  }
  function renderImportResults() {
    const text = $('#import-text').value;
    const found = matchFound(parseResults(text), lastCtx);
    ui.importFound = found;
    const section = function (title, n, hint, body) {
      return '<div class="pick-section"><h3><span>' + title + '</span><span>' + n + '</span></h3>' + (hint ? '<p class="pick-hint">' + hint + '</p>' : '') + body + '</div>';
    };
    const rows = function (place) {
      return '<div class="import-list">' + found.map(function (f, i) { return (place ? f.place : f.slots.length) ? importRow(f, i, place) : ''; }).join('') + '</div>';
    };
    const plan = found.filter(function (f) { return f.slots.length; });
    const fill = found.filter(function (f) { return f.place; });
    const other = found.filter(function (f) { return !f.slots.length && !f.place && f.status !== 'failed'; });
    let html = '';
    // a record for another degree: offer to match it to that degree instead
    const named = pdfDegree(text);
    const here = isCustom() ? '' : state.degree;
    if (named.code && DEG[named.code] && named.code !== here) html += '<p class="pick-hint import-degree">This record is for <b>' + esc(DEG[named.code].label) + '</b>. <button type="button" class="linkish" data-action="import-degree" data-code="' + named.code + '">Match it to ' + named.code + ' instead</button></p>';
    if (plan.length) html += section('In your plan', plan.length, '', rows(false));
    if (fill.length) html += section('Fills an open choice', fill.length, 'Each of these is on the list for an open choice in your plan, so ticking it places it there as completed.', rows(true));
    if (other.length) {
      html += section('Not in your plan', other.length, 'If these count towards your degree, add them as a choice or elective first, then tick them here or on the plan.', '<div class="chiplist import-other">' +
        other.map(function (f) { return '<span class="chipbtn"><code>' + esc(f.code) + '</code>' + esc(f.title) + '</span>'; }).join('') + '</div>');
    }
    if (!found.length && text.trim()) html = '<p class="pick-hint">No subject codes found. Codes look like LAWS 1003 or LAWS1003.</p>';
    $('#import-results').innerHTML = html;
    updateImportCount();
  }
  function updateImportCount() {
    const n = document.querySelectorAll('input[name="import-pick"]:checked:not(:disabled)').length;
    const btn = $('#import-apply');
    btn.disabled = !n;
    btn.textContent = n ? 'Tick ' + plural(n, 'subject') : 'Tick subjects';
  }
  function applyImport() {
    const picked = Array.from(document.querySelectorAll('input[name="import-pick"]:checked:not(:disabled)')).map(function (i) { return ui.importFound[+i.value]; });
    const key = currentKey();
    let placed = 0;
    picked.forEach(function (f) {
      if (f.place) {
        placed++;
        if (editPlan()) setCustomSubject(f.place.idx, f.code, '', GLOBAL_BY_CODE[f.code] ? GLOBAL_BY_CODE[f.code].cp : null);
        else setPick(f.place.id, { code: f.entry.code, title: f.entry.title });
      }
      (f.place ? [f.place] : f.slots).forEach(function (s) {
        if (editPlan()) editPlan().slots[s.idx].done = true;
        else { state.done[key] = state.done[key] || {}; state.done[key][s.id] = 1; }
      });
    });
    noteChange('ticked off ' + plural(picked.length, 'subject') + ' from your results');
    closeModal();
    ui.folded = null;
    render();
    toast('Ticked off ' + plural(picked.length, 'subject') + ' from your results' + (placed ? ', ' + placed + ' of them in open choices' : '') + '.');
  }

  // ======================================================================== PDF / print engine
  function pdPill(c, hl) { return '<span class="pp pp-' + c + (hl ? ' pp-hl' : '') + '">' + c + '</span>'; }
  function pdOffer(offer) {
    if (!offer) return '<span class="pp-26">custom</span>';
    if (offer.tbc) return pdPill('TBC');
    if (offer.none) return '<span class="pp-26">n/a</span>';
    return offer.codes.map(function (c) { return pdPill(c, state.campus && c === state.campus); }).join('') + (offer.y2026 ? '<span class="pp-26">2026</span>' : '');
  }
  function pdHeader(ctx) {
    const d = ctx.deg;
    const o = ctx.opt;
    if (ctx.custom && !ctx.edit) {
      const t = ctx.tdeg;
      const cfacts = [
        ['Credit points', d.cp + ' CP'],
        ['Placed', ctx.placedCP + ' CP'],
        ['Duration', fmt(d.ftYears) + ' yrs FT · ' + fmt(d.ptYears) + ' yrs PT'],
        ['Open slots', String(ctx.risks.pending.length)],
        ['Campuses', t ? esc(t.campuses) : 'Check the Handbook'],
        ['Starting point', t ? esc(t.code) : 'Blank plan'],
      ];
      return '<header class="pd-head"><div class="pd-head-grid"><div class="pd-head-main">' +
        '<div class="pd-mast">' + CREST + '<div><div class="pd-eyebrow">Western Sydney Law Students\' Association · 2027 Custom Degree Plan</div><div class="pd-est">Est. 1996 · By students, for students</div></div></div>' +
        '<h1>' + titleHTML(d.title) + '</h1>' +
        '<div class="pd-sub">' + (ctx.plan.code ? '<b>Course ' + esc(ctx.plan.code) + '</b> · ' : '') + (t ? 'Based on <b>' + esc(tplLabel(ctx.plan.tpl)) + '</b>' : '<b>Built by the student</b>') + ' · <span class="pd-badge">Custom pathway</span>' + (cohortOf(ctx.plan) === 'pre2027' ? ' · <span class="pd-badge">Pre-2027 structure</span>' : '') + (state.campus ? ' · Campus highlight: <b>' + esc(META.campuses[state.campus]) + '</b>' : '') + '</div>' +
        pdStructure(ctx) +
        '<dl class="pd-facts">' + cfacts.map(function (f) { return '<div><dt>' + f[0] + '</dt><dd>' + f[1] + '</dd></div>'; }).join('') + '</dl>' +
        '<div class="pd-link"><b>Your plan:</b> <span class="pd-plan">' + esc(planUrl()) + '</span></div>' +
        '<div class="pd-link"><b>' + (t ? 'Official 2027 WSU Handbook' : 'WSU Student Handbook') + ':</b> <a href="' + esc(d.handbook) + '">' + esc(d.handbook.replace(/^https?:\/\//, '')) + '</a></div></div>' +
        (t && t.qrSvg ? '<div class="pd-qr">' + t.qrSvg + '<div class="pd-url"><b>Scan for the</b>2027 Handbook</div></div>' : '') +
        '</div></header>';
    }
    const badge = o.groupLetter ? 'Pathway ' + o.groupLetter : 'Single recommended pathway';
    const facts = [
      ['Credit points', d.cp + ' CP'],
      ['Duration', fmt(d.ftYears) + ' yrs FT · ' + fmt(d.ptYears) + ' yrs PT'],
      ['Intake', esc(d.intake)],
      ['Campuses', esc(d.campuses)],
      ['Students', esc(d.students)],
      ['CRICOS', d.cricos ? esc(d.cricos) : 'Not listed'],
    ];
    return '<header class="pd-head"><div class="pd-head-grid"><div class="pd-head-main">' +
      '<div class="pd-mast">' + CREST + '<div><div class="pd-eyebrow">Western Sydney Law Students\' Association · 2027 Degree Guide</div><div class="pd-est">Est. 1996 · By students, for students</div></div></div>' +
      '<h1>' + titleHTML(d.title) + '</h1>' +
      '<div class="pd-sub"><b>Course ' + d.code + '</b> · ' + (o.majorCode === 'BASE' ? '' : (o.majorKind === 'Minor' ? 'Minor: ' : 'Major: ')) + '<b>' + esc(selectionLabel(ctx)) + '</b> · <span class="pd-badge">' + esc(badge) + '</span>' +
      (ctx.edit ? ' · <span class="pd-badge">Edited by the student</span>' : '') + (ctxCohort(ctx) === 'pre2027' ? ' · <span class="pd-badge">Pre-2027 structure</span>' : '') + (state.campus ? ' · Campus highlight: <b>' + esc(META.campuses[state.campus]) + '</b>' : '') + '</div>' +
      pdStructure(ctx) +
      '<dl class="pd-facts">' + facts.map(function (f) { return '<div><dt>' + f[0] + '</dt><dd>' + f[1] + '</dd></div>'; }).join('') + '</dl>' +
      '<div class="pd-link"><b>Your plan:</b> <span class="pd-plan">' + esc(planUrl()) + '</span></div>' +
      '<div class="pd-link"><b>Official 2027 WSU Handbook:</b> <a href="' + esc(d.handbook) + '">' + esc(d.handbook.replace(/^https?:\/\//, '')) + '</a></div></div>' +
      '<div class="pd-qr">' + (d.qrSvg || '') + '<div class="pd-url"><b>Scan for the</b>2027 Handbook</div></div>' +
      '</div></header>';
  }
  // the credit breakdown in the structure the plan follows, on one line
  function pdStructure(ctx) {
    const deg = ctx.tdeg || (ctx.custom ? null : ctx.deg);
    if (!deg || !deg.structure || !deg.structure.length) return '';
    return '<div class="pd-link pd-structure"><b>' + (ctxCohort(ctx) === 'pre2027' ? 'Pre-2027 structure' : '2027 structure') + ':</b> ' + effectiveStructure(deg, ctxCohort(ctx)).map(function (c) { return esc(c.component) + ' ' + c.cp + ' CP'; }).join(' · ') + '</div>';
  }
  function pdLegend() {
    const types = [['law', 'Law core', '#8B0029'], ['nonlaw', 'Non-law core', '#334155'], ['major', 'Major / minor', '#0F766E']];
    return '<div class="pd-legend"><span class="pd-lt">Unit type</span>' + types.map(function (t) {
      return '<span class="pd-sw"><i style="border-color:' + t[2] + '"></i>' + t[1] + '</span>';
    }).join('') + '<span class="pd-sw"><i class="slot"></i>Your choice (LLB Alternate, choice, elective)</span><span class="pd-sw">◆ selected by you</span><span class="pd-sw">italic = still to choose</span></div>';
  }
  function pdTable(sess, list, ticks) {
    const cp = list.reduce(function (a, s) { return a + s.cp; }, 0);
    let html = '<table class="pd-t' + (sess === 'Summer' ? ' pd-t-summer' : '') + '"><colgroup>' + (ticks ? '<col class="c-tick">' : '') + '<col class="c-code"><col><col class="c-camp"><col class="c-cp"></colgroup>' +
      '<thead><tr><th colspan="' + (ticks ? 5 : 4) + '">' + sess + ' <span class="pd-sess">Session</span><span class="pd-cpt">' + cp + ' CP</span></th></tr></thead><tbody>';
    if (!list.length) html += '<tr><td class="pd-empty" colspan="' + (ticks ? 5 : 4) + '">No subjects scheduled</td></tr>';
    list.forEach(function (s) {
      const cls = kindClass(s).replace('k-', 'r-') + (s.pending ? ' r-pending' : '') + (s.done ? ' r-done' : '');
      let title = esc(s.pending ? pendingPrintTitle(s) : s.title);
      if (s.chosen) title = '◆ ' + title;
      html += '<tr class="' + cls + '">' + (ticks ? '<td class="pd-tick">' + (s.done ? '✓' : '') + '</td>' : '') +
        '<td class="pd-code">' + esc(s.pending ? '—' : s.code) + '</td><td class="pd-title">' + title + '</td>' +
        '<td class="pd-camp">' + (s.pending ? '' : s.listSubject || s.session === 'Summer' ? '<span class="pp-26">see Handbook</span>' : pdOffer(s.offer)) + '</td><td class="pd-cp">' + s.cp + '</td></tr>';
    });
    return html + '</tbody></table>';
  }
  function pendingPrintTitle(s) {
    if (s.kind === 'cslot') return s.pendingLabel;
    if (s.kind === 'llb') return 'LLB Alternate subject: to choose';
    if (s.kind === 'elective') return 'Elective (any WSU subject)';
    if (s.kind === 'inline') return 'Choose: ' + s.raw.options.map(function (x) { return x.code; }).join(' or ');
    return cleanPoolTitle(s.raw.title);
  }
  function pdGrid(ctx, o) {
    const ticks = o.ticks && ctx.slots.some(function (s) { return s.done; });
    // a year with nothing in it yet takes no room on paper: what is still to place is listed in its own box
    return timeline(ctx, 'FT').filter(function (y) { return y.Autumn.length + y.Spring.length + y.Summer.length > 0; }).map(function (y) {
      const sessions = y.Summer.length ? PLAN_SESSIONS : SESSIONS;
      return '<div class="pd-year' + (y.Summer.length ? ' has-summer' : '') + '"><div class="pd-ylabel"><span class="pd-roman">' + roman(y.year) + '</span><span class="pd-yword">Year ' + y.year + '</span></div>' +
        sessions.map(function (sess) { return pdTable(sess, y[sess].slice().sort(function (a, b) { return a.raw.slot - b.raw.slot; }), ticks); }).join('') + '</div>';
    }).join('');
  }
  // the years of a plan that hold nothing yet, as a range to name on paper
  function emptyYears(ctx) {
    const empty = timeline(ctx, 'FT').filter(function (y) { return y.Autumn.length + y.Spring.length + y.Summer.length === 0; }).map(function (y) { return y.year; });
    if (!empty.length) return '';
    const run = empty[empty.length - 1] - empty[0] === empty.length - 1;
    return (empty.length === 1 ? 'Year ' + empty[0] + ' has' : 'Years ' + (run ? empty[0] + ' to ' + empty[empty.length - 1] : empty.slice(0, -1).join(', ') + ' and ' + empty[empty.length - 1]) + ' have') + ' nothing in ' + (empty.length === 1 ? 'it' : 'them') + ' yet, so ' + (empty.length === 1 ? 'it is' : 'they are') + ' not shown above.';
  }
  function pdWarnings(ctx) {
    const r = ctx.risks;
    let html = '';
    html += '<div class="pd-box pd-warn"><h3>Advisor prerequisite warnings</h3>' + (r.advisor.length ? '<ul>' + r.advisor.map(function (a) {
      const kind = (a.note.majorKind || '').replace('Testamur ', '').toLowerCase();
      const scope = a.applies ? '' : a.note.deg ? '<i>From the ' + esc(a.note.deg) + ' guide' + (a.note.major ? ' (' + esc(a.note.major) + ' ' + esc(kind) + ')' : '') + '.</i> ' : '<i>Flagged for the ' + esc(a.note.major) + ' ' + esc(kind) + '; ' + esc(a.note.subject) + ' is also in this pathway.</i> ';
      return '<li>' + (a.flagSlot ? '<span class="pd-where">' + where(a.flagSlot) + ':</span> ' : '') + scope + esc(a.note.text) + (a.hint ? ' <i>' + esc(a.hint) + '</i>' : '') + '</li>';
    }).join('') + '</ul>' : '<p>No advisor prerequisite gaps are flagged in the workbook for this selection.</p>') + '</div>';
    if (ctx.custom) {
      const cl = ['<li><b>Credit points:</b> ' + ctx.placedCP + ' of ' + ctx.plan.cp + ' CP placed' + (r.pending.length ? ', ' + plural(r.pending.length, 'open slot') + ' (' + r.pending.map(where).join(', ') + ')' : '') + '.' + (r.cpShort ? ' Slots total ' + ctx.totalCP + ' CP, ' + r.cpShort + ' CP short of the requirement.' : '') + (r.cpOver ? ' ' + r.cpOver + ' CP more than required.' : '') + '</li>'];
      if (r.overload.length) cl.push('<li><b>Over the load set for the session:</b> ' + r.overload.map(function (l) { return 'Year ' + l.year + ' ' + l.session + ' (' + l.cp + ' of ' + l.cap + ' CP)'; }).join('; ') + '.</li>');
      if (r.dupes.length) cl.push('<li><b>Listed more than once:</b> ' + r.dupes.map(function (d) { return esc(d.code) + ' (' + d.slots.map(where).join(', ') + ')'; }).join('; ') + '.</li>');
      if (r.notOffered.length) cl.push('<li><b>Not offered in the planned session:</b> ' + r.notOffered.map(function (s) { return esc(s.code) + ' (' + where(s) + ')'; }).join('; ') + '.</li>');
      if (r.replaced.length) cl.push('<li><b>Changed from the template:</b> ' + r.replaced.map(function (s) { return esc(s.replaced.code) + ' → ' + (s.pending ? 'open slot' : esc(s.code)) + ' (' + where(s) + ')'; }).join('; ') + '.</li>');
      html += '<div class="pd-box pd-tbcbox"><h3>' + (ctx.edit ? 'Edited pathway checks' : 'Custom plan checks') + '</h3><ul>' + cl.join('') + '</ul></div>';
      const noteKeys = Object.keys(ctx.plan.notes || {}).map(Number).sort(function (a, b) { return a - b; });
      if (noteKeys.length) {
        html += '<div class="pd-box pd-tbcbox pd-notes"><h3>Your session notes</h3><ul>' + noteKeys.map(function (k) {
          return '<li><b>' + sessionLabel(Math.floor(k / 3) + 1, PLAN_SESSIONS[k % 3]) + ':</b> ' + esc(ctx.plan.notes[k]) + '</li>';
        }).join('') + '</ul></div>';
      }
      if (ctx.guide) {
        const gap = emptyYears(ctx);
        html += '<div class="pd-box pd-tbcbox pd-unplaced"><h3>Remaining unplaced subjects · ' + ctx.guide.cp + ' CP still to place</h3>' +
          '<p>Not in the plan above yet. Each is listed under the session the Suggested Remaining Guide suggests for it.' + (gap ? ' ' + gap : '') + '</p><ul>' + guideSessions(ctx.guide).map(function (gs) {
            return '<li><b>' + sessionLabel(gs.y, gs.s) + ':</b> ' + gs.items.map(function (x) { return esc(x.r.code || x.r.label); }).join(', ') + '</li>';
          }).join('') + '</ul></div>';
      }
    }
    const tbcText = r.tbc.length ? r.tbc.map(function (s) { return '<b>' + esc(s.code) + '</b> ' + esc(s.title) + ' (' + where(s) + ')'; }).join('; ') : '';
    const lines = [];
    if (tbcText) lines.push('<li><b>Session TBC:</b> ' + tbcText + '. WSU has not yet published the 2027 session; verify closer to enrolment.</li>');
    if (r.summer.length) lines.push('<li><b>Summer:</b> ' + r.summer.map(function (s) { return esc(s.code) + ' (' + where(s) + ')'; }).join('; ') + '. The 2027 guides list Autumn and Spring sessions only; confirm in the Handbook that these run in Summer.</li>');
    if (r.y2026.length) lines.push('<li><b>2026 session shown:</b> ' + r.y2026.map(function (s) { return esc(s.code) + ' (' + where(s) + ')'; }).join('; ') + '.</li>');
    if (state.campus && r.campus.length) lines.push('<li><b>Not at ' + esc(META.campuses[state.campus]) + ' or online:</b> ' + r.campus.map(function (s) { return esc(s.code) + ' (' + s.offer.codes.join(' ') + ')'; }).join('; ') + '.</li>');
    if (r.unlisted.length) lines.push('<li><b>Check in the Handbook:</b> ' + r.unlisted.map(function (s) { return esc(s.code) + ' (' + where(s) + ')'; }).join('; ') + '. Chosen from the WSU subject list or entered by hand, so no session data is shown.</li>');
    if (r.pending.length && !ctx.custom) lines.push('<li><b>Still to choose:</b> ' + plural(r.pending.length, 'slot') + ' (' + r.pending.map(where).join(', ') + ').</li>');
    if (lines.length) html += '<div class="pd-box pd-tbcbox"><h3>Session &amp; availability checks</h3><ul>' + lines.join('') + '</ul></div>';
    return html;
  }
  function pdAccreditation(ctx, withAssumed) {
    const d = ctx.deg;
    if (ctx.custom && !ctx.tdeg) return '';
    return '<div class="pd-cols"><div class="pd-box pd-acc"><h3>Professional accreditation</h3><ul>' + d.accreditation.map(function (a) {
      return '<li><b>' + esc(a.name) + '</b> <span class="st' + (/^Essential/.test(a.status || '') ? ' st-e' : '') + '">' + esc(a.status || '') + '</span></li>';
    }).join('') + '</ul></div><div class="pd-box"><h3>Exit awards</h3><ul>' + d.exitAwards.map(function (e) {
      return '<li>' + (e.code ? e.code + ' ' : '') + esc(e.name) + (e.exitOnly ? ' (exit only)' : '') + '</li>';
    }).join('') + '</ul>' + (withAssumed ? '<h3 style="margin-top:1.6mm">Assumed knowledge / admission</h3><p>' + esc(d.assumedKnowledge) + '</p>' : '') + '</div></div>';
  }
  function pdCampusLegend() {
    return '<div class="pd-box"><h3>Campus codes</h3><div class="pd-camp-legend">' + Object.keys(META.campuses).map(function (c) {
      return '<span>' + pdPill(c) + esc(META.campuses[c]) + '</span>';
    }).join('') + '<span>' + pdPill('TBC') + 'No 2027 session published yet</span><span><span class="pp-26" style="margin:0 1mm 0 0">2026</span>2027 session not yet published, 2026 session shown</span></div></div>';
  }
  function pdDisclaimer(ctx) {
    const o = ctx.opt;
    const subject = ctx.custom
      ? 'a custom plan' + (ctx.tdeg ? ' based on ' + esc(ctx.tdeg.code) + (o.majorCode === 'BASE' ? '' : ' · ' + esc(o.majorCode)) : ' built by the student') + '. A custom plan is the student\'s own and is not a WSLSA recommendation. Units marked ◆ are the student\'s own choices or changes.'
      : esc(ctx.deg.code) + (o.majorCode === 'BASE' ? '' : ' · ' + esc(o.majorCode)) + '. Units marked ◆ are the student\'s own selections.';
    return '<div class="pd-disclaimer"><b>Disclaimer.</b> ' + esc(disclaimerText()) + ' Generated ' + esc(today()) + ' from ' + esc(META.sourceWorkbook) + ' for ' + subject + '<div class="pd-footline">' + FOOT_LINE + '</div></div>';
  }
  function shortSource(src) {
    if (/^2027/.test(src || '')) return '2027';
    if (/^2026/.test(src || '')) return '2026';
    return src ? 'Unpublished' : '';
  }
  // Landscape pages are too short for 60 rows in one column, so long lists split into two
  // side-by-side tables there; portrait keeps a single full-width table.
  function pdCatalogueTable(ctx, entries, o, title, sub) {
    const plan = ctx.used;
    const split = o.orient === 'landscape' && entries.length > 24;
    const cellFor = function (v) { const off = parseOffered(v); return off.none ? '<span class="na">—</span>' : pdOffer(off); };
    const table = function (list) {
      const camp = split ? 19 : o.orient === 'landscape' ? 34 : 24;
      return '<table class="pd-cat"><colgroup><col style="width:' + (split ? 16 : 17) + 'mm"><col><col style="width:' + (split ? 7 : 13) + 'mm"><col style="width:' + camp + 'mm"><col style="width:' + camp + 'mm"><col style="width:' + (split ? 15 : o.orient === 'landscape' ? 40 : 24) + 'mm"></colgroup>' +
        '<thead><tr><th>Code</th><th>Title</th><th>' + (split ? 'Lvl' : 'Level') + '</th><th>Autumn</th><th>Spring</th><th>' + (split ? 'Source' : 'Data source') + '</th></tr></thead><tbody>' +
        list.map(function (e) {
          const inPlan = !!plan[e.code];
          const src = split ? shortSource(e.source) : (e.source || '').replace(' (2027 not yet published)', '');
          return '<tr class="' + (inPlan ? 'inplan' : '') + '"><td class="c">' + (inPlan ? '<span class="mark">◆</span> ' : '') + esc(e.code) + '</td><td>' + esc(e.title) + '</td><td>' + esc((e.level || '').replace('Level ', 'L')) + '</td><td class="s">' + cellFor(e.autumn) + '</td><td class="s">' + cellFor(e.spring) + '</td><td class="src">' + esc(src) + '</td></tr>';
        }).join('') + '</tbody></table>';
    };
    const half = Math.ceil(entries.length / 2);
    return '<div class="pd-sec-h"><h2>' + esc(title) + '</h2><span>' + sub + '</span></div>' +
      (split ? '<div class="pd-cat-split">' + table(entries.slice(0, half)) + table(entries.slice(half)) + '</div>' : table(entries));
  }
  function llbFiltered(ctx, o) {
    const all = ctx.deg.byComp[ctx.deg.llbComponent] || [];
    const sessions = o.llbSession === 'all' ? SESSIONS : [o.llbSession];
    return all.filter(function (e) {
      return sessions.some(function (sess) {
        const off = parseOffered(sessionValue(e, sess));
        if (off.none) return false;
        if (off.tbc) return o.llbTbc;
        if (o.llbCampus && state.campus) return off.codes.indexOf(state.campus) >= 0 || off.codes.indexOf('ON') >= 0;
        return true;
      });
    });
  }
  function buildPrintDoc(ctx, o) {
    const head = pdHeader(ctx) + pdLegend();
    const grid = '<section class="pd-grid">' + pdGrid(ctx, o) + '</section>';
    // a plan built from scratch has no degree, so no LLB Alternate table: it prints as Mode A
    if (o.mode === 'A' || (ctx.custom && !ctx.tdeg)) {
      return '<article class="pdoc pdoc-a ' + o.orient + '">' + head + grid + '<section class="pd-foot">' + pdWarnings(ctx) + pdAccreditation(ctx, false) + pdCampusLegend() + pdDisclaimer(ctx) + '</section></article>';
    }
    const llb = llbFiltered(ctx, o);
    const total = (ctx.deg.byComp[ctx.deg.llbComponent] || []).length;
    const filters = [];
    filters.push(o.llbSession === 'all' ? 'Autumn and Spring' : 'Offered in ' + o.llbSession);
    if (o.llbCampus && state.campus) filters.push('at ' + META.campuses[state.campus] + ' or online');
    if (!o.llbTbc) filters.push('excluding session TBC');
    const sub = esc(ctx.deg.code) + ' · ' + esc(filters.join(', ')) + ' · ' + llb.length + ' of ' + total + ' subjects · ◆ in your plan';
    const pools = {};
    ctx.slots.forEach(function (s) {
      const k = s.kind === 'cslot' ? s.raw.kind : s.kind;
      if ((k === 'pool' || k === 'option') && s.raw.pool) s.raw.pool.forEach(function (p) { pools[p] = 1; });
    });
    const poolHtml = Object.keys(pools).map(function (p) {
      return '<div class="pd-pool">' + pdCatalogueTable(ctx, ctx.deg.byComp[p] || [], o, cleanPoolTitle(p), 'Choice pool used in this pathway') + '</div>';
    }).join('');
    const portrait = o.orient === 'portrait';
    return '<article class="pdoc pdoc-b ' + o.orient + '">' + head + grid +
      (portrait ? '<section class="pd-foot">' + pdWarnings(ctx) + '</section>' : '') +
      '<div class="pd-page-break"></div>' +
      pdCatalogueTable(ctx, llb, o, 'LLB Alternate Subjects', sub) + '<p class="pd-note">' + esc(ctx.deg.catalogueNote || '') + '</p>' + poolHtml +
      '<section class="pd-foot" style="margin-top:3mm">' + (portrait ? '' : pdWarnings(ctx)) + pdAccreditation(ctx, true) + pdCampusLegend() + pdDisclaimer(ctx) + '</section></article>';
  }
  function setPageSize(orient) { $('#page-size').textContent = '@page { size: A4 ' + orient + '; margin: 10mm; }'; }
  function preparePrint() {
    const ctx = buildContext();
    setPageSize(state.exp.orient);
    $('#print-root').innerHTML = buildPrintDoc(ctx, state.exp);
  }
  function doPrint() {
    preparePrint();
    window.print();
  }
  window.addEventListener('beforeprint', preparePrint);

  // ---- export modal with live A4 preview
  function openExport() {
    ui.modal = 'export';
    const e = Object.assign({}, state.exp);
    if (lastCtx && lastCtx.custom && !lastCtx.tdeg) e.mode = 'A';
    const radio = function (name, val, title, desc) {
      return '<label class="opt-card"><input type="radio" name="' + name + '" value="' + val + '"' + (e[name.replace('exp-', '')] === val ? ' checked' : '') + '><b>' + title + '</b><span>' + desc + '</span></label>';
    };
    showModal('<div class="modal-backdrop" data-action="backdrop"><div class="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="export-h">' +
      '<div class="modal-head"><div><h2 id="export-h">PDF guide options</h2><p>Vector-sharp A4 output through your browser\'s print engine. Choose <b>Save as PDF</b> as the destination.</p></div><button type="button" class="modal-x" data-action="modal-close" aria-label="Close">×</button></div>' +
      '<div class="export-layout"><div class="export-settings">' +
      '<fieldset><legend>Guide type</legend>' +
      radio('exp-mode', 'A', 'Mode A · Custom student pathway', '1–2 pages. Your selected units, campus codes, CP totals, warnings, accreditation and disclaimer.') +
      (lastCtx && lastCtx.custom && !lastCtx.tdeg
        ? '<label class="opt-card is-off"><input type="radio" name="exp-mode" value="B" disabled><b>Mode B · Complete handbook sheet</b><span>Needs a template degree for its LLB Alternate table. Use Edit setup to start from a 2027 pathway; until then this plan prints as Mode A.</span></label>'
        : radio('exp-mode', 'B', 'Mode B · Complete handbook sheet', 'Pathway on page 1, the full LLB Alternate Subjects table on page 2, plus any choice pools used.')) +
      '</fieldset>' +
      '<fieldset><legend>Orientation</legend><div class="segmented" role="group"><button type="button" data-action="exp-orient" data-v="portrait" aria-pressed="' + (e.orient === 'portrait') + '">A4 portrait</button><button type="button" data-action="exp-orient" data-v="landscape" aria-pressed="' + (e.orient === 'landscape') + '">A4 landscape</button></div></fieldset>' +
      '<fieldset><legend>Options</legend>' +
      '<label class="check-row"><input type="checkbox" name="exp-ticks"' + (e.ticks ? ' checked' : '') + '><span>Show completion ticks for subjects you have marked done</span></label></fieldset>' +
      '<fieldset id="exp-llb"' + (e.mode === 'B' ? '' : ' disabled') + '><legend>LLB Alternate table (Mode B)</legend>' +
      '<div class="select-wrap"><select name="exp-llbSession" aria-label="Session filter"><option value="all"' + (e.llbSession === 'all' ? ' selected' : '') + '>Autumn and Spring</option><option value="Autumn"' + (e.llbSession === 'Autumn' ? ' selected' : '') + '>Offered in Autumn</option><option value="Spring"' + (e.llbSession === 'Spring' ? ' selected' : '') + '>Offered in Spring</option></select></div>' +
      '<label class="check-row"><input type="checkbox" name="exp-llbCampus"' + (e.llbCampus ? ' checked' : '') + (state.campus ? '' : ' disabled') + '><span>Only at ' + (state.campus ? esc(META.campuses[state.campus]) : 'my campus') + ' or online' + (state.campus ? '' : ' (set a primary campus first)') + '</span></label>' +
      '<label class="check-row"><input type="checkbox" name="exp-llbTbc"' + (e.llbTbc ? ' checked' : '') + '><span>Include subjects with session TBC</span></label></fieldset>' +
      '<p class="export-help"><b>Tips.</b> Paper size A4, scale 100%, margins default. Background tints are forced on with <code>print-color-adjust</code>; if a browser still drops them, tick <b>Background graphics</b> in its print dialog.</p>' +
      '<button type="button" class="btn btn-primary" data-action="export-print" style="min-height:46px">Print / Save PDF →</button>' +
      '</div><div class="export-preview" id="export-preview" tabindex="0" role="region" aria-label="A4 preview of your guide"><div class="preview-meta"><span id="preview-pages">Preview</span><span>A4 · 10 mm margins</span></div><div class="preview-stage" id="preview-stage" inert></div></div></div></div></div>');
    lockScroll();
    renderExportPreview();
  }
  function renderExportPreview() {
    const stage = $('#preview-stage');
    if (!stage) return;
    const ctx = lastCtx || buildContext();
    stage.innerHTML = buildPrintDoc(ctx, state.exp);
    const llbSet = $('#exp-llb');
    if (llbSet) llbSet.disabled = state.exp.mode !== 'B' || (ctx.custom && !ctx.tdeg);
    requestAnimationFrame(function () {
      const box = $('#export-preview');
      const doc = stage.firstElementChild;
      if (!box || !doc) return;
      const avail = box.clientWidth - 36;
      const scale = Math.min(1, avail / doc.offsetWidth);
      stage.style.transform = 'scale(' + scale + ')';
      stage.style.height = (doc.offsetHeight * scale) + 'px';
      stage.style.width = (doc.offsetWidth) + 'px';
      const pages = estimatePages(doc, state.exp.orient);
      $('#preview-pages').textContent = 'Estimated length: ' + plural(pages, 'A4 page') + ' (' + state.exp.orient + ')';
    });
  }
  // Packs the document's unbreakable blocks into A4 pages the way the print engine does
  // (break-inside: avoid on headers, year blocks and footer boxes; table rows may split).
  function estimatePages(doc, orient) {
    const mm = doc.offsetWidth / (orient === 'landscape' ? 297 : 210);
    const pageH = (orient === 'landscape' ? 190 : 277) * mm;
    const pad = 10 * mm;
    const blocks = doc.querySelectorAll('.pd-head, .pd-legend, .pd-year, .pd-foot > *, .pd-page-break, .pd-sec-h, .pd-cat-split, table.pd-cat thead, table.pd-cat tbody tr, .pd-note');
    let pages = 1;
    let start = pad;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const top = b.getBoundingClientRect().top - doc.getBoundingClientRect().top;
      const scale = doc.getBoundingClientRect().width / doc.offsetWidth || 1;
      const t = top / scale;
      const h = b.getBoundingClientRect().height / scale;
      if (b.classList.contains('pd-page-break')) {
        pages++;
        const next = blocks[i + 1];
        start = next ? (next.getBoundingClientRect().top - doc.getBoundingClientRect().top) / scale : t;
        continue;
      }
      if (t + h - start > pageH + 0.5) {
        pages++;
        start = t;
      }
    }
    return pages;
  }

  // ======================================================================== events
  // --mini-h is the room the progress bar at the bottom of a small screen takes while it is up, and 0 otherwise
  function syncMiniHeight() {
    const bar = $('#mini-bar');
    const up = bar.classList.contains('is-on') && !bar.classList.contains('is-min') && getComputedStyle(bar).display !== 'none';
    document.documentElement.style.setProperty('--mini-h', up ? Math.round(bar.getBoundingClientRect().height) + 'px' : '0px');
  }
  function closePops() {
    document.querySelectorAll('.pop-menu:not([hidden])').forEach(function (m) {
      m.hidden = true;
      m.previousElementSibling.setAttribute('aria-expanded', 'false');
    });
  }
  // pressing anywhere else puts away what floats over the page
  document.addEventListener('pointerdown', function (ev) {
    const t = ev.target;
    if (!t.closest) return;
    if (ui.enqOpen && !t.closest('#enquiry-box, [data-action="enq-open"]')) setEnquiryOpen(false);
    if (!t.closest('.pop')) closePops();
  });
  function setTopMenu(open) {
    $('#top-actions').classList.toggle('is-open', open);
    $('.top-menu-btn').setAttribute('aria-expanded', String(open));
  }
  document.addEventListener('click', function (ev) {
    if ($('#top-actions').classList.contains('is-open') && !ev.target.closest('.top-menu-btn')) setTopMenu(false);
    if (!ev.target.closest('[data-action="pop-toggle"]')) closePops();
    const el = ev.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action;
    const ctx = lastCtx;
    switch (a) {
      case 'theme-toggle': {
        const next = currentTheme() === 'dark' ? 'light' : 'dark';
        transition(function () { setTheme(next); });
        break;
      }
      case 'tour-start': startTour(el); break;
      case 'tour-accept': startTour(); break;
      case 'tour-decline': hideTourPrompt(true); break;
      case 'tour-next': tourGo(ui.tour.at + 1); break;
      case 'tour-back': tourGo(ui.tour.at - 1); break;
      case 'tour-skip': endTour(); break;
      case 'enq-toggle': setEnquiryOpen(!ui.enqOpen); break;
      case 'enq-open':
        setEnquiryOpen(true);
        $('#enq-card').focus({ preventScroll: true });
        break;
      case 'enq-topic':
        ui.enqTopic = el.dataset.topic;
        document.querySelectorAll('[data-action="enq-topic"]').forEach(function (b) { b.setAttribute('aria-pressed', String(b === el)); });
        break;
      // built as the link is followed, as each share link is a fresh code
      case 'enq-email': el.href = enquiryMailto(); break;
      case 'enq-copy': {
        const d = enquiryDraft();
        copyText('To: ' + d.to + '\nSubject: ' + d.subject + '\n\n' + d.body, 'Email draft copied, with who to send it to.');
        break;
      }
      case 'backup-save': downloadBackup(); break;
      case 'undo': stepHistory(true); break;
      case 'redo': stepHistory(false); break;
      case 'grid-view': {
        const view = el.dataset.view;
        transition(function () { setGridView(view); }, true);
        break;
      }
      case 'assign-open': openAssign(el.dataset.code); break;
      case 'assign-to': assignSubject(el.dataset.slot, ui.assign.code); break;
      case 'assign-new': {
        const code = ui.assign.code;
        ensureEditable();
        const id = addCustomSlot(+el.dataset.y, el.dataset.s);
        if (!id) break;
        lastCtx = buildContext();
        assignSubject(id, code);
        break;
      }
      case 'cat-jump': {
        const s = ctx.byId[el.dataset.slot];
        ui.catBack = s.id;
        flashSlot(s.id);
        toast(s.code + ' is in ' + shownWhere(ctx, s) + '.', { action: 'cat-back', label: 'Back to catalogue' });
        break;
      }
      case 'cat-back': {
        const row = document.querySelector('#cat-results [data-action="cat-jump"][data-slot="' + ui.catBack + '"]');
        $('#toast').classList.remove('show');
        if (row) {
          row.scrollIntoView({ behavior: scrollMode(), block: 'center' });
          row.focus({ preventScroll: true });
        }
        break;
      }
      case 'creorder': {
        const s = ctx.byId[ui.picker.slotId];
        const here = sortSlots(ctx.slots.filter(function (o) { return o.year === s.year && o.session === s.session; }));
        const other = here[here.indexOf(s) + (+el.dataset.dir)];
        if (other) doReorder(s, other, +el.dataset.dir > 0);
        break;
      }
      case 'top-menu': setTopMenu(!$('#top-actions').classList.contains('is-open')); break;
      case 'pop-toggle': {
        const menu = el.nextElementSibling;
        const opening = menu.hidden;
        closePops();
        menu.hidden = !opening;
        el.setAttribute('aria-expanded', String(opening));
        break;
      }
      case 'year-toggle': {
        const fold = el.getAttribute('aria-expanded') === 'true';
        transition(function () { setYearFold(+el.dataset.y, fold); }, true);
        break;
      }
      case 'map-jump': {
        const y = +el.dataset.y;
        const box = document.getElementById('year-' + y);
        if (!box) break;
        // this view may be hiding that year altogether
        if (box.classList.contains('view-none')) setGridView('all');
        setYearFold(y, false);
        const target = el.dataset.s ? box.querySelector('.session[data-s="' + el.dataset.s + '"]') : box;
        target.tabIndex = -1;
        target.focus({ preventScroll: true });
        target.scrollIntoView({ behavior: scrollMode(), block: 'start' });
        break;
      }
      case 'top': ev.preventDefault(); window.scrollTo({ top: 0, behavior: scrollMode() }); break;
      case 'skip': {
        ev.preventDefault();
        const heading = $('#plan-heading');
        heading.focus({ preventScroll: true });
        heading.scrollIntoView({ behavior: scrollMode(), block: 'start' });
        break;
      }
      case 'backdrop': if (ev.target === el) closeModal(); break;
      case 'modal-close': closeModal(); break;
      case 'share': share(); break;
      case 'reset': {
        if (isCustom()) {
          if (!window.confirm('Start your custom plan again? This clears every subject and tick and rebuilds it from ' + (state.custom.tpl ? 'the ' + tplLabel(state.custom.tpl) + ' template.' : 'empty slots.'))) return;
          noteChange('rebuilt your custom plan');
          rebuildCustom();
          ui.folded = null;
          render();
          toast('Custom plan rebuilt.', { action: 'undo', label: 'Undo' });
          break;
        }
        const key = currentKey();
        if (!window.confirm('Clear all choices' + (state.edits[key] ? ', changes' : '') + ' and progress for ' + key.replace('|BASE', '') + '?')) return;
        noteChange('reset this pathway');
        // the Handbook structure on screen stays: it says when the student started, which a reset does not change
        if (state.edits[key]) {
          if (cohortOf(state.edits[key]) === 'pre2027') state.cohortFor[key] = 'pre2027'; else delete state.cohortFor[key];
        }
        delete state.picks[key];
        delete state.done[key];
        delete state.edits[key];
        ui.folded = null;
        render();
        toast('Pathway reset to the WSLSA recommendation' + (guideCohort(key) === 'pre2027' ? ', in the pre-2027 structure' : '') + '.', { action: 'undo', label: 'Undo' });
        break;
      }
      case 'export-open': openExport(); break;
      case 'print': doPrint(); break;
      case 'why': ui.whyOpen = !ui.whyOpen; renderHero(ctx); break;
      case 'open-advisory': {
        ui.advisoryOpen = true;
        const box = $('#advisory-box');
        if (box) { box.open = true; box.scrollIntoView({ behavior: scrollMode(), block: 'start' }); }
        break;
      }
      case 'export-print': doPrint(); break;
      case 'exp-orient': state.exp.orient = el.dataset.v; el.parentElement.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(b === el)); }); saveState(); renderExportPreview(); break;
      case 'load': {
        const want = el.dataset.load;
        // with subjects ticked off or a re-paced plan, the student chooses how much of the plan this changes
        if (ctx.doneCP > 0 || (ctx.custom && ctx.plan.pace)) {
          if (LOAD_CP[want] !== paceNow(ctx)) openRePace({ load: LOAD_CP[want] });
          break;
        }
        state.load = want;
        renderMoving();
        break;
      }
      case 'repace-open': openRePace(); break;
      case 'rp-load':
        ui.repace.load = +el.dataset.v;
        renderRePace();
        break;
      case 'rp-intake':
        ui.repace.intake = el.dataset.v;
        renderRePace();
        break;
      case 'rp-fast':
        ui.repace.fast = !ui.repace.fast;
        // the preset is the full load, plus whatever brings the finish forward
        if (ui.repace.fast) ui.repace.load = 40;
        if (ui.repace.fast && ctx.doneCP > 0) ui.repace.scope = 'remaining';
        renderRePace();
        break;
      case 'rp-apply': applyRePace(); break;
      case 'transfer-open': openTransfer(); break;
      case 'transfer-apply': applyTransfer(); break;
      case 'credit-electives': creditElectives(); break;
      case 'credit-dismiss':
        ui.credit = null;
        renderCreditOffer(ctx);
        break;
      case 'campus-pill': {
        const c = el.dataset.campus;
        state.campus = state.campus === c ? '' : c;
        render();
        toast(state.campus ? 'Highlighting ' + META.campuses[c] + ' (and online).' : 'Campus filter cleared.');
        break;
      }
      case 'campus-clear': state.campus = ''; render(); break;
      case 'tab': {
        const tab = el.dataset.tab;
        transition(function () {
          ui.tab = tab;
          renderDetails(ctx);
          if (motionOK()) $('.tab-panel').classList.add('panel-in');
          $('#tab-' + tab).focus();
        });
        break;
      }
      case 'jump': ev.preventDefault(); flashSlot(el.dataset.slot); break;
      case 'picker-open': openPicker(el.dataset.slot); break;
      case 'inline': {
        const s = ctx.byId[el.dataset.slot];
        const code = el.dataset.code;
        noteChange(s.code === code && !s.pending && s.chosen ? 'cleared ' + code + ' from ' + where(s) : 'chose ' + code + ' for ' + where(s));
        if (s.code === code && !s.pending && s.chosen) setPick(s.id, null);
        else {
          const o = s.raw.options.find(function (x) { return x.code === code; });
          setPick(s.id, { code: o.code, title: o.title });
        }
        renderMoving(function () {
          const opts = motionOK() ? $('#slot-' + s.id + ' .inline-opts') : null;
          if (opts) opts.classList.add('opts-in');
        });
        break;
      }
      case 'clear':
        noteChange('cleared ' + ctx.byId[el.dataset.slot].code + ' from ' + where(ctx.byId[el.dataset.slot]));
        if (ctx.custom) clearCustomSlot(ctx.byId[el.dataset.slot].idx); else setPick(el.dataset.slot, null);
        renderMoving();
        break;
      case 'session-done': {
        const ids = el.dataset.ids.split(',');
        const all = ids.every(function (id) { return ctx.byId[id].done; });
        noteChange((all ? 'unmarked ' : 'marked ') + where(ctx.byId[ids[0]]) + (all ? '' : ' done'));
        ids.forEach(function (id) { setDone(id, !all); });
        refreshDone(ids);
        break;
      }
      case 'xray': {
        const id = el.dataset.slot;
        ui.xrayPin = ui.xrayPin === id ? '' : id;
        ui.xrayHover = '';
        if (ui.xrayPin) xrayShow(id); else xrayClear();
        break;
      }
      case 'suggest': autoSuggest(); break;
      case 'defer': deferSubject(el.dataset.slot); break;
      case 'pin': pinPlan(); break;
      case 'pin-clear':
        ui.pin = null;
        writePin();
        closeModal();
        renderSectionHead(lastCtx);
        toast('Snapshot removed.');
        break;
      case 'compare': openCompare(); break;
      case 'ics': exportIcs(); break;
      case 'pick-area':
        ui.picker.area = el.dataset.area;
        pressArea('pick-area', ui.picker.area);
        renderPickerResults();
        break;
      case 'cat-area':
        ui.cat.area = el.dataset.area;
        pressArea('cat-area', ui.cat.area);
        renderCatalogueRows(ctx);
        break;
      case 'mini-top': {
        window.scrollTo({ top: $('#dock-wrap').getBoundingClientRect().top + window.scrollY - 8, behavior: scrollMode() });
        const first = $('#sel-degree');
        if (first) first.focus({ preventScroll: true });
        break;
      }
      case 'mini-toggle': {
        const small = $('#mini-bar').classList.toggle('is-min');
        syncMiniHeight();
        el.setAttribute('aria-expanded', String(!small));
        el.setAttribute('aria-label', small ? 'Expand progress bar' : 'Collapse progress bar');
        break;
      }
      case 'pick-reset':
        Object.assign(ui.picker, { q: '', area: '', level: '', showOff: false, campusOnly: false });
        renderPicker(false);
        $('#pick-q').focus();
        break;
      case 'cat-reset':
        ui.cat = { q: '', comp: '', session: '', inPlan: false, area: '' };
        renderDetails(ctx);
        $('#cat-q').focus();
        break;
      case 'pick': choosePick(el.dataset.code, el.dataset.src); break;
      case 'cpick': chooseCustom(el.dataset.code); break;
      case 'cremove': {
        const sid = ensureEditable(el.dataset.slot);
        const s = lastCtx.byId[sid];
        noteChange('removed the ' + where(s) + ' slot');
        editPlan().slots.splice(s.idx, 1);
        if (ui.modal) closeModal(true);
        renderMoving();
        toast('Removed the ' + where(s) + ' slot' + (s.pending ? '' : ' (' + s.code + ')') + '.');
        break;
      }
      case 'cadd': {
        ensureEditable();
        const id = addCustomSlot(+el.dataset.y, el.dataset.s, el.dataset.o || '');
        if (!id) break;
        noteChange('added a slot to Year ' + el.dataset.y + ' ' + el.dataset.s);
        renderMoving(function () { flashSlot(id); });
        break;
      }
      case 'copy-codes': copyText(el.dataset.copy || el.dataset.codes, 'Copied ' + el.dataset.codes + ' for enrolment.'); break;
      case 'import-open': openImport(); break;
      case 'import-apply': applyImport(); break;
      case 'progress-open': openProgress(); break;
      case 'progress-file': $('#progress-file').click(); break;
      case 'progress-paste': {
        const text = $('#progress-text').value;
        if (!text.trim()) { progressStatus('Paste your results first, then read them.', 'error'); break; }
        const info = pdfProgress(text.split(/\r?\n/));
        if (info.kind === 'PDF') info.kind = 'pasted results';
        addProgressFile('Pasted results', info);
        break;
      }
      case 'progress-reset':
        ui.progressFiles = [];
        ui.progress = null;
        renderProgress();
        progressStatus('');
        $('#progress-choose').textContent = 'Choose files';
        break;
      case 'import-degree': {
        const from = lastCtx;
        const completed = completedIn(from);
        state.mode = 'guide';
        state.degree = el.dataset.code;
        const carried = carryOver(sourceLabel(from), currentKey(), completed);
        render();
        announceCarry(carried);
        renderImportResults();
        break;
      }
      case 'progress-apply': applyProgress(); break;
      case 'summer-add': {
        const y = +el.dataset.y;
        ensureEditable();
        const id = addCustomSlot(y, 'Summer');
        if (!id) break;
        noteChange('added Year ' + y + ' Summer');
        renderMoving(function () { flashSlot(id); });
        toast('Year ' + y + ' Summer added. Choose a subject or bring one forward.');
        break;
      }
      case 'cbring': {
        // the later subject moves into this Summer slot, and the empty Summer slot it fills is removed
        const target = ctx.byId[ui.picker.slotId];
        const from = ctx.byId[el.dataset.from];
        noteChange('brought ' + from.code + ' forward to ' + where(target));
        const slots = editPlan().slots;
        const moved = slots[from.idx];
        moved.y = target.year;
        moved.s = target.session;
        slots.splice(target.idx, 1);
        const id = 'c' + slots.indexOf(moved);
        closeModal(true);
        renderMoving(function () { flashSlot(id); });
        toast(from.code + ' brought forward from ' + where(from) + ' to ' + where(target) + '.');
        break;
      }
      case 'cyear': {
        ensureEditable();
        const y = addCustomYear();
        if (!y) break;
        noteChange('added Year ' + y);
        render();
        const yr = document.getElementById('year-' + y);
        if (yr) yr.scrollIntoView({ behavior: scrollMode(), block: 'start' });
        toast('Added Year ' + y + ' with eight open slots.');
        break;
      }
      case 'custom-setup': openSetup(); break;
      case 'guide-add': {
        const sel = document.getElementById('gi-' + el.dataset.gi);
        addFromGuide([+el.dataset.gi], sel ? sel.value : '');
        break;
      }
      case 'guide-dismiss': {
        const r = lastCtx.guide && lastCtx.guide.items[+el.dataset.gi];
        const plan = editPlan();
        if (!r || !plan) break;
        const name = r.code || r.label;
        noteChange('dismissed the suggestion ' + name);
        // a subject is remembered by the code the list holds it under, and a choice by its pathway row
        plan.skip.push({ code: r.was && LEGACY[r.was] ? r.was : r.code || '', o: r.code ? '' : r.o || '' });
        renderMoving();
        toast(name + ' dismissed from the guide. Your degree may still need it, so check before you enrol.', { action: 'undo', label: 'Undo' });
        break;
      }
      case 'guide-restore': {
        const plan = editPlan();
        if (!plan || !plan.skip.length) break;
        noteChange('restored the dismissed suggestions');
        const n = plan.skip.length;
        plan.skip = [];
        ui.guideOpen = true;
        renderMoving();
        toast(plural(n, 'dismissed suggestion') + ' restored to the guide.', { action: 'undo', label: 'Undo' });
        break;
      }
      case 'guide-fill': addFromGuide(lastCtx.guide.items.map(function (r, i) { return i; }), ''); break;
      case 'plan-fix': fixPlan(); break;
      case 'track-filter': setTrack(el.dataset.k); break;
      case 'stage': {
        const n = nextSession(lastCtx);
        const target = n ? document.querySelector('#year-' + n.year + ' .session[data-s="' + n.session + '"]') : $('#next');
        if (n) { const yr = document.getElementById('year-' + n.year); if (yr && yr.classList.contains('is-folded')) setYearFold(n.year, false); }
        if (target) target.scrollIntoView({ behavior: scrollMode(), block: 'center' });
        break;
      }
      case 'card-tools': {
        const id = el.dataset.slot;
        const opening = ui.openCard !== id;
        document.querySelectorAll('#grid .subj.is-open').forEach(function (c) {
          c.classList.remove('is-open');
          const b = c.querySelector('.subj-more');
          if (b) { b.setAttribute('aria-expanded', 'false'); b.querySelector('.sm-t').textContent = 'Edit ▾'; }
        });
        ui.openCard = opening ? id : '';
        if (opening) {
          el.closest('.subj').classList.add('is-open');
          el.setAttribute('aria-expanded', 'true');
          el.querySelector('.sm-t').textContent = 'Done ▴';
        }
        break;
      }
      case 'year-delete': deleteYear(+el.dataset.y); break;
      case 'year-insert': insertYear(+el.dataset.y); break;
      case 'year-clear': clearYear(+el.dataset.y); break;
      case 'session-note': openNote(+el.dataset.y, el.dataset.s); break;
      case 'note-remove': setSessionNote(ui.note.y, ui.note.sess, ''); break;
      case 'guide-pin':
        ev.stopPropagation();
        state.guidePinned = !state.guidePinned;
        if (state.guidePinned) ui.guideOpen = true;
        renderGuide(lastCtx);
        sizeGuidePin();
        saveState();
        break;
      case 'handbook-compare': openHandbookCompare(); break;
      case 'hc-switch': closeModal(true); setCohort(el.dataset.v); break;
      case 'pool-switch': switchPool(el.dataset.slot); break;
      case 'session-load': {
        ensureEditable();
        const plan = editPlan();
        const k = orderIdx(+el.dataset.y, el.dataset.s);
        const v = +el.dataset.v;
        if (sessionCap(plan, k) === v) break;
        noteChange('set Year ' + el.dataset.y + ' ' + el.dataset.s + ' to ' + v + ' CP');
        if (v === LOAD_CP.FT) delete plan.loads[k]; else plan.loads[k] = v;
        if (+el.dataset.y > plan.years) plan.years = Math.min(MAX_YEARS, +el.dataset.y);
        renderMoving();
        toast('Year ' + el.dataset.y + ' ' + el.dataset.s + ' is set to ' + (v === 0 ? 'a Leave of Absence' : v + ' CP') + '. The overload check and the guide follow it.', { action: 'undo', label: 'Undo' });
        break;
      }
      case 'guide-open': {
        ui.guideOpen = true;
        const box = $('#guide-box');
        if (box) { box.open = true; box.scrollIntoView({ behavior: scrollMode(), block: 'start' }); }
        break;
      }
      case 'change-open': {
        const copied = !editPlan();
        const id = ensureEditable(el.dataset.slot);
        // opening the window alone changes nothing: a copy still as it was is put away when the window closes
        if (copied) ui.probe = { key: currentKey(), json: JSON.stringify(editPlan()) };
        openPicker(id);
        break;
      }
      case 'reset-sequence': {
        noteChange('reset to the default sequence');
        const r = resetSequence();
        ui.folded = null;
        renderMoving();
        toast('Back to the default WSLSA sequence' + (r && r.kept ? ', with ' + plural(r.kept, 'ticked subject') + ' kept' : '') + '.', { action: 'undo', label: 'Undo' });
        break;
      }
      case 'custom-from-current': openSetup({ start: 'template', tpl: currentKey() }); break;
      case 'custom-open': openCustom(); break;
      case 'custom-exit': state.mode = 'guide'; renderEntering(); toast('Back to the WSLSA pathways. Your custom plan is kept under Degree → Your own.'); break;
      case 'cs-cp': $('#cs-cp').value = el.dataset.v; setupSync('cp'); break;
      case 'pick-ug': ui.picker.ugOnly = !ui.picker.ugOnly; el.setAttribute('aria-pressed', ui.picker.ugOnly); renderPickerResults(); break;
      case 'pick-clear': {
        const id = ui.picker.slotId;
        noteChange('cleared ' + where(ctx.byId[id]));
        if (ui.picker.custom) clearCustomSlot(ctx.byId[id].idx); else setPick(id, null);
        closeModal();
        render();
        flashSlot(id);
        break;
      }
      case 'pick-campus': ui.picker.campusOnly = !ui.picker.campusOnly; el.setAttribute('aria-pressed', ui.picker.campusOnly); renderPickerResults(); break;
      case 'pick-off':
        ui.picker.showOff = !ui.picker.showOff;
        document.querySelectorAll('.chip[data-action="pick-off"]').forEach(function (b) { b.setAttribute('aria-pressed', ui.picker.showOff); });
        renderPickerResults();
        break;
      case 'pick-level': {
        ui.picker.level = ui.picker.level === el.dataset.level ? '' : el.dataset.level;
        document.querySelectorAll('[data-action="pick-level"]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.level === ui.picker.level)); });
        renderPickerResults();
        break;
      }
      default: break;
    }
  });

  document.addEventListener('submit', function (ev) {
    if (ev.target.id === 'note-form') { ev.preventDefault(); setSessionNote(ui.note.y, ui.note.sess, $('#note-text').value); return; }
    if (ev.target.id === 'setup-form') { ev.preventDefault(); applySetup(); return; }
    if (ev.target.id !== 'custom-form') return;
    ev.preventDefault();
    const typed = $('#cu-code').value.trim().toUpperCase().replace(/\s+/g, ' ');
    const code = normCode(typed) || typed;
    const title = $('#cu-title').value.trim();
    if (!code || !title) { toast('Enter both a subject code and a title.'); return; }
    const id = ui.picker.slotId;
    noteChange('chose ' + code + ' for ' + where(lastCtx.byId[id]));
    if (ui.picker.custom) {
      const idx = lastCtx.byId[id].idx;
      const cp = +$('#cu-cp').value;
      if (GLOBAL_BY_CODE[code]) setCustomSubject(idx, code, '', GLOBAL_BY_CODE[code].cp);
      else if (EXTRA_BY_CODE[code]) setCustomSubject(idx, code, '', cp);
      else setCustomSubject(idx, code.slice(0, 16), title.slice(0, 140), cp);
      closeModal();
      render();
      flashSlot(id);
      return;
    }
    if (EXTRA_BY_CODE[code]) setPick(id, { code: code, title: EXTRA_BY_CODE[code].title, list: true });
    else if (GLOBAL_BY_CODE[code]) setPick(id, { code: code, title: GLOBAL_BY_CODE[code].title });
    else setPick(id, { code: code.slice(0, 16), title: title.slice(0, 140), custom: true });
    closeModal();
    render();
    flashSlot(id);
  });

  document.addEventListener('change', function (ev) {
    const t = ev.target;
    if (t.id === 'sel-degree') {
      if (t.value === CUSTOM) {
        if (state.custom) { state.mode = 'custom'; renderEntering(); }
        else { t.value = state.degree; openSetup({ start: 'blank' }); }
      } else {
        const from = lastCtx;
        const completed = completedIn(from);
        state.mode = 'guide';
        state.degree = t.value;
        const carried = carryOver(sourceLabel(from), currentKey(), completed);
        renderEntering();
        announceCarry(carried);
      }
    } else if (t.id === 'custom-name') { render(); }
    else if (t.id === 'cp-move') {
      const v = t.value.split('|');
      const s = lastCtx.byId[ui.picker.slotId];
      noteChange('moved ' + (s.pending ? 'an open slot' : s.code) + ' to Year ' + v[0] + ' ' + v[1]);
      const id = moveCustomSlot(s.idx, +v[0], v[1]);
      closeModal(true);
      renderMoving(function () { flashSlot(id); });
      toast((s.pending ? 'Open slot' : s.code) + ' moved to Year ' + v[0] + ' ' + v[1] + '.');
    } else if (t.id === 'cp-swap') {
      const s = lastCtx.byId[ui.picker.slotId];
      const other = lastCtx.byId[t.value];
      if (s && other) doSwap(s, other);
    } else if (t.name === 'import-pick') { updateImportCount(); }
    else if (t.id === 'progress-file') {
      if (t.files.length) readPdfs(t.files);
      t.value = '';
    }
    else if (t.name === 'pp-cohort') { ui.progressOpts.cohort = t.value; showProgress(); }
    else if (t.id === 'pp-inprogress') { ui.progressOpts.inProgressDone = t.checked; showProgress(); }
    else if (t.name === 'cs-start') { setupSync('start'); }
    // the structure follows the year started until the student picks one
    else if (t.id === 'cs-year' && !ui.cohortPicked) { $(+t.value < START_YEAR ? '#cs-cohort-pre2027' : '#cs-cohort-2027').checked = true; }
    else if (t.name === 'cs-cohort') { ui.cohortPicked = true; }
    else if (t.id === 'cs-tpl-deg') { $('#cs-tpl-major').innerHTML = tplMajorOptions(t.value, DEG[t.value].options[0]); setupSync('tpl'); }
    else if (t.id === 'sel-major') {
      const from = lastCtx;
      const completed = completedIn(from);
      noteChange('changed your major');
      setMajor(t.value);
      const carried = carryOver(sourceLabel(from), t.value, completed);
      renderEntering();
      announceCarry(carried);
    }
    else if (t.name === 'rp-scope') { ui.repace.scope = t.value; renderRePace(); }
    else if (t.name === 'rp-cohort') { ui.repace.cohort = t.value; ui.repace.cohortSet = true; renderRePace(); }
    else if (t.id === 'rp-loa') { ui.repace.loa = t.checked; renderRePace(); }
    else if (t.id === 'rp-start') {
      ui.repace.start = +t.value;
      if (!ui.repace.cohortSet) ui.repace.cohort = planCohort(lastCtx, ui.repace.start);
      renderRePace();
    }
    else if (t.id === 'rp-summer') { ui.repace.summer = t.checked; renderRePace(); }
    else if (t.id === 'rp-over') { ui.repace.overload = t.checked; renderRePace(); }
    else if (t.id === 'tr-from') { ui.transfer.from = t.value; renderTransfer(); }
    else if (t.id === 'tr-deg') { ui.transfer.deg = t.value; ui.transfer.key = DEG[t.value].options[0]; renderTransfer(); }
    else if (t.id === 'tr-major') { ui.transfer.key = t.value; renderTransfer(); }
    else if (t.id === 'tr-credit') { ui.transfer.credit = t.checked; renderTransfer(); }
    else if (t.id === 'sel-campus') { state.campus = t.value; render(); }
    else if (t.id === 'sel-cohort') setCohort(t.value);
    else if (t.classList && t.classList.contains('type-sel')) setSlotType(t.dataset.slot, t.value);
    else if (t.classList && t.classList.contains('move-sel')) { if (t.value) quickMove(t.dataset.slot, t.value); }
    else if (t.dataset && t.dataset.action === 'done') {
      const ticked = lastCtx.byId[t.dataset.slot];
      noteChange((t.checked ? 'ticked ' : 'unticked ') + (ticked.pending ? 'the ' + where(ticked) + ' slot' : ticked.code));
      setDone(t.dataset.slot, t.checked);
      refreshDone([t.dataset.slot]);
    } else if (t.id === 'cat-comp') { ui.cat.comp = t.value; renderCatalogueRows(lastCtx); }
    else if (t.id === 'cat-session') { ui.cat.session = t.value; renderCatalogueRows(lastCtx); }
    else if (t.id === 'cat-inplan') { ui.cat.inPlan = t.checked; renderCatalogueRows(lastCtx); }
    else if (t.name && t.name.indexOf('exp-') === 0) {
      const k = t.name.slice(4);
      state.exp[k] = t.type === 'checkbox' ? t.checked : t.value;
      saveState();
      renderExportPreview();
    }
  });

  document.addEventListener('input', function (ev) {
    const t = ev.target;
    if (t.id === 'grid-q') { ui.gridQ = t.value; ui.matchAt = -1; applyGridFilter(true); syncGridBar(); }
    else if (t.id === 'pick-q') { ui.picker.q = t.value; renderPickerResults(); }
    else if (t.id === 'import-text') { renderImportResults(); }
    else if (t.id === 'cat-q') { ui.cat.q = t.value; renderCatalogueRows(lastCtx); }
    else if (t.id === 'custom-name' && isCustom()) {
      noteChange('renamed your custom plan', 'name');
      state.custom.name = t.value.slice(0, 120);
      lastCtx = buildContext();
      renderHero(lastCtx);
      saveState();
    } else if (t.id === 'cs-cp') { setupSync('cp'); }
    else if (t.id === 'cs-name' || t.id === 'cs-code') { delete t.dataset.auto; }
    else if (t.id === 'cu-code') {
      const known = EXTRA_BY_CODE[normCode(t.value)] || GLOBAL_BY_CODE[normCode(t.value)];
      const title = $('#cu-title');
      const cpSel = $('#cu-cp');
      if (cpSel && GLOBAL_BY_CODE[normCode(t.value)]) cpSel.value = String(GLOBAL_BY_CODE[normCode(t.value)].cp);
      if (known && (!title.value || title.dataset.auto)) { title.value = known.title; title.dataset.auto = '1'; }
      else if (!known && title.dataset.auto) { title.value = ''; delete title.dataset.auto; }
    } else if (t.id === 'cu-title') { delete t.dataset.auto; }
  });

  document.addEventListener('keydown', function (ev) {
    if (ui.tour) { tourKey(ev); return; }
    const el = ev.target;
    const key = (ev.key || '').toLowerCase();
    if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && !ui.modal) {
      if (key === 'k' && !ev.shiftKey) { ev.preventDefault(); focusGridFilter(); return; }
      if ((key === 'z' || key === 'y') && !typingIn(el)) {
        ev.preventDefault();
        stepHistory(key === 'z' && !ev.shiftKey);
        return;
      }
    }
    if (ev.key === 'Enter' && el.id === 'grid-q') { ev.preventDefault(); stepMatch(ev.shiftKey ? -1 : 1); return; }
    if (ev.key === 'Escape') {
      if ($('#top-actions').classList.contains('is-open')) { setTopMenu(false); $('.top-menu-btn').focus(); return; }
      const pop = document.querySelector('.pop-menu:not([hidden])');
      if (pop) {
        const button = pop.previousElementSibling;
        closePops();
        button.focus();
        return;
      }
      if (ui.modal) { closeModal(); return; }
      if (ui.enqOpen) {
        const inside = el.closest && el.closest('#enquiry-box');
        setEnquiryOpen(false);
        if (inside) $('.enq-pill').focus();
        return;
      }
      if (el.id === 'grid-q') {
        if (el.value) clearGridFilter(); else el.blur();
        return;
      }
      if (ui.xrayPin) { ui.xrayPin = ''; ui.xrayHover = ''; xrayClear(); return; }
      if (ui.trackKey) { ui.trackKey = ''; applyTrack(); return; }
      if (el.id === 'cat-q' && el.value) { el.value = ''; ui.cat.q = ''; renderCatalogueRows(lastCtx); return; }
      xrayClear();
      return;
    }
    if (ev.key === 'Tab' && ui.modal) { trapTab(ev); return; }
    if (ev.key === '/' && !ev.ctrlKey && !ev.metaKey && !ev.altKey && !typingIn(el) && el.tagName !== 'SELECT') {
      if (ui.modal === 'picker') { ev.preventDefault(); $('#pick-q').focus(); }
      else if (!ui.modal) {
        ev.preventDefault();
        // the catalogue's own search when it is the thing on screen, otherwise the filter on the plan
        const q = $('#cat-q');
        const r = q ? q.getBoundingClientRect() : null;
        if (r && r.top >= 0 && r.bottom <= window.innerHeight) q.focus({ preventScroll: true });
        else focusGridFilter();
      }
      return;
    }
    if ((ev.key === 'Enter' || ev.key === ' ') && el.getAttribute && el.getAttribute('role') === 'button' && el.dataset.action) {
      ev.preventDefault();
      el.click();
    }
  });

  // a PDF dropped anywhere while Import my progress is open is read, rather than opened by the browser
  document.addEventListener('dragover', function (ev) {
    if (ui.modal !== 'progress') return;
    ev.preventDefault();
    $('#progress-drop').classList.add('is-over');
  });
  document.addEventListener('dragleave', function (ev) { if (ui.modal === 'progress' && !ev.relatedTarget) $('#progress-drop').classList.remove('is-over'); });
  document.addEventListener('drop', function (ev) {
    if (ui.modal !== 'progress') return;
    ev.preventDefault();
    $('#progress-drop').classList.remove('is-over');
    if (ev.dataTransfer && ev.dataTransfer.files.length) readPdfs(ev.dataTransfer.files);
  });

  window.addEventListener('resize', function () { if (ui.modal === 'export') renderExportPreview(); });
  // remember whether the advisory panel is open across re-renders (toggle does not bubble)
  document.addEventListener('toggle', function (ev) {
    const gs = ev.target.classList && ev.target.classList.contains('guide-sess') ? ev.target : null;
    if (gs) { ui.guideSess = ui.guideSess || {}; ui.guideSess[gs.dataset.k] = gs.open; return; }
    if (ev.target.id === 'advisory-box') ui.advisoryOpen = ev.target.open;
    if (ev.target.id === 'legend-box') ui.legendOpen = ev.target.open;
    if (ev.target.id === 'guide-box') {
      ui.guideOpen = ev.target.open;
      const cta = ev.target.querySelector('.adv-cta');
      if (cta) cta.textContent = ev.target.open ? 'Hide guide' : 'View guide';
    }
  }, true);

  // a link opened in a tab that already shows the explorer changes only the hash, without a reload
  window.addEventListener('hashchange', function () {
    const opened = applyHash();
    if (opened === null) return;
    if (!opened) { toast(LINK_FAILED); return; }
    if (ui.modal) closeModal();
    ui.folded = null;
    noteChange('opened a plan from a link');
    render();
    toast('Plan opened from the link.');
  });

  if (window.ResizeObserver) {
    new ResizeObserver(function () {
      document.documentElement.style.setProperty('--dock-h', Math.ceil($('#dock-wrap').getBoundingClientRect().height) + 'px');
    }).observe($('#dock-wrap'));
    new ResizeObserver(syncGridBar).observe($('#gridbar'));
  }

  // ======================================================================== phone progress bar
  if (window.IntersectionObserver) {
    new IntersectionObserver(function (entries) {
      $('#mini-bar').classList.toggle('is-on', !entries[0].isIntersecting && entries[0].boundingClientRect.top < 0);
      syncMiniHeight();
    }).observe($('#dock-wrap'));
  }

  // ======================================================================== boot
  const askTour = tourMayAsk();
  const opened = applyHash();
  renderEnquiryBox();
  syncTheme();
  document.querySelectorAll('.view-modes button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.view === state.view)); });
  if (window.matchMedia('(hover: none)').matches) $('#grid-q').placeholder = 'Filter by code or title';
  $('#grid-q').addEventListener('focus', syncGridBar);
  $('#grid-q').addEventListener('blur', syncGridBar);
  render();
  if (opened === false) toast(LINK_FAILED);
  if (askTour) {
    setTimeout(function () {
      if (ui.tour || readStored(TOUR_KEY)) return;
      $('#tour-prompt').hidden = false;
      document.body.classList.add('has-tour-prompt');
    }, 700);
  }

  // test hook: lets the automated checks drive the app without relying on UI layout
  window.WSLSA = {
    state: function () { return JSON.parse(JSON.stringify(state)); },
    context: function () { return buildContext(); },
    keys: function () { return Object.keys(PATH); },
    extraCount: function () { return EXTRA.length; },
    select: function (key) { const d = key.split('|')[0]; state.mode = 'guide'; state.degree = d; state.majorFor[d] = key; render(); },
    custom: function () { const p = editPlan(); return p ? JSON.parse(JSON.stringify(p)) : null; },
    guide: function () { return lastCtx && lastCtx.guide ? JSON.parse(JSON.stringify(lastCtx.guide)) : null; },
    planUrl: function () { return planUrl(); },
    history: function () { return { undo: undoStack.length, redo: redoStack.length, undoLabel: undoStack.length ? undoStack[undoStack.length - 1].label : '', redoLabel: redoStack.length ? redoStack[redoStack.length - 1].label : '' }; },
    linkText: function () { return encodeLink(); },
    // the date to treat as today, so which sessions have begun does not depend on when the checks run
    setNow: function (now) { ui.now = now || null; },
    // lays a plan out without applying it, optionally as though the first years were ticked off
    pace: function (o, tickYears) {
      const ctx = buildContext();
      if (tickYears) ctx.slots.forEach(function (s) { if (s.year <= tickYears) s.done = true; });
      const r = layoutPace(ctx, Object.assign({ scope: 'whole', load: 40, loa: false, intake: 'Autumn', start: START_YEAR, fast: false, summer: true, overload: true, cohort: planCohort(ctx) }, o));
      return { finish: r.finishLabel, unplaced: r.unplaced.length, forced: r.forced, groups: REQ_GROUPS, rows: r.rows.map(function (x) { return { code: x.code, k: x.k, cp: x.cp, locked: x.locked, done: x.s.done, list: x.runs ? x.runs.list : null }; }) };
    },
    unscramble: function (code) { return unscrambleCode(code); },
    buildPrintDoc: function (opts) { return buildPrintDoc(buildContext(), Object.assign({}, state.exp, opts || {})); },
    preparePrint: function (opts) { Object.assign(state.exp, opts || {}); preparePrint(); },
    // lines as a PDF's pages would give them, for checks that run without loading the PDF reader, and
    // the date to treat as today, so which sessions have begun does not depend on when the checks run
    importPdfLines: function (lines, now, name) { ui.now = now || null; addProgressFile(name || 'record.pdf', pdfProgress(lines)); },
    // the session commute check, given the campus lists of a session's subjects
    commute: function (lists) { return commutePill(lists.map(function (codes) { return { done: false, pending: false, offer: { codes: codes } }; })); },
  };
})();
