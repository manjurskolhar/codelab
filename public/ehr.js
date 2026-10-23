'use strict';
/* CodeLab EHR workstation: the window students open from an assignment.
   Layout follows the conventions of hospital EHR workstations: patient tab strip, storyboard on the left,
   activity tabs, report grids with a preview pane, results and vital-sign flowsheets, MAR, notes, and an
   HIM Coding activity where students enter, sequence and validate their codes. */
S.ew = { act: 'summary', sub: 'encounters', sel: null, noteFilter: 'all', abs: null, absFor: null, dirty: false, saving: false };

const EW_ACTS = [['summary', 'Summary'], ['chart', 'Chart Review'], ['results', 'Results Review'], ['flow', 'Flowsheets'], ['mar', 'MAR'], ['problems', 'Problem List'],
  ['allergies', 'Allergies'], ['notes', 'Notes'], ['demo', 'Demographics'], ['coding', 'Coding'], ['codebook', 'Code Book']];
const EW_ACTS_DS = [['reports', 'Reports'], ['notes', 'Notes'], ['coding', 'Coding'], ['codebook', 'Code Book']];
const EW_SUBS = [['encounters', 'Encounters'], ['notes', 'Notes'], ['labs', 'Labs'], ['imaging', 'Imaging'], ['procedures', 'Procedures'], ['meds', 'Meds'], ['orders', 'Orders'], ['immun', 'Immunizations']];
const IMG_RE = /radiolog|x-ray|xray|\bct\b|\bmri\b|ultrasound|echocardiogram|imaging|mammogra/i;
const PROC_RE = /operative|procedure|catheteri|delivery note|\bpci\b|surgery/i;
const EW_HINT = { summary: 'The most important information for this encounter. Use More › to open the full list.', chart: 'Every encounter, note, result, report and order. Select a row to preview it below.',
  results: 'Laboratory and microbiology results over time.', flow: 'Vital signs over time.', mar: 'Medications ordered for this patient, with route, frequency and status.',
  problems: 'Problems recorded by the care team. Code from the provider documentation in the notes, not from this list.', allergies: 'Allergies and adverse reactions.',
  notes: 'Provider, nursing and allied health documentation, newest first.', demo: 'Registration, encounter and coverage details.', reports: 'Claim forms, logs and data tables attached to this record.', codebook: '' };
const EW_ICON = { summary: '▤', chart: '☰', results: '⚗', flow: '♥', mar: '℞', problems: '!', allergies: '⚠', notes: '✎', demo: '☺', coding: '#', codebook: '📖', reports: '▦' };

const ewDays = (a, b) => { const k1 = timeKey(a).slice(0, 8), k2 = timeKey(b).slice(0, 8); if (/~/.test(k1 + k2)) return null; const d = (s) => new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)); return Math.round((d(k2) - d(k1)) / 864e5); };
const ewGrid = (head, rows, { cls = '', empty = 'No data to display.' } = {}) => `<div class="ew-grid-wrap"><table class="ew-grid ${cls}"><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('') || `<tr><td colspan="${head.length}" class="ew-none">${esc(empty)}</td></tr>`}</tbody></table></div>`;
const ewSec = (title, body, act) => `<section class="ew-card"><header><span>${esc(title)}</span>${act ? `<button class="ew-link" data-act="ew-act" data-v="${act}">More ›</button>` : ''}</header>${body}</section>`;
const flagTd = (f, v) => { const h = /^H/.test(f || ''), l = /^L/.test(f || ''); return `<td class="${h ? 'ew-hi' : l ? 'ew-lo' : ''}">${esc(v)}${h ? ' <b>(H)</b>' : l ? ' <b>(L)</b>' : ''}</td>`; };

function ewContext() {
  let aid = S.ehrAid;
  if (!aid && role() === 'student') { const m = Object.entries(S.assignments).filter(([, x]) => x.ehr?.chartId === S.ehrOnly); if (m.length === 1) aid = m[0][0]; }
  const a = aid && S.assignments[aid]; return a && a.ehr?.chartId === S.ehrOnly ? { aid, a } : null;
}
function ewMode() { const c = ewContext(); if (role() === 'student' && c) { const g = grade(S.me.id, c.aid); return g && !(S.program && !passed(g)) ? 'graded' : 'save'; } return 'practice'; }

/* ---------- storyboard ---------- */
function ewStory(p) {
  const al = p.allergies.map(a => a.subject).filter(x => x && !/^no known/i.test(x)); const los = p.admit && p.discharge ? ewDays(p.admit, p.discharge) : null;
  const row = (k, v, cls = '') => `<div class="ew-sb-row ${cls}"><span>${esc(k)}</span><b>${v ? esc(v) : '<i>—</i>'}</b></div>`;
  if (p.kind === 'dataset') return `<aside class="ew-story"><div class="ew-sb-id"><span class="ew-photo ds">▦</span><div><b class="ew-sb-name">${esc(p.name)}</b><span>Data set ${esc(p.mrn)}</span></div></div>
    <div class="ew-sb-grp"><h4>Source</h4>${row('Organization', p.facility)}${row('Reports', String(p.reports.length))}${row('Notes', String(p.docs.length))}</div>
    ${p.description ? `<div class="ew-sb-grp"><h4>About</h4><p class="ew-sb-p">${esc(p.description)}</p></div>` : ''}${ewStoryCoding()}</aside>`;
  return `<aside class="ew-story" aria-label="Patient storyboard">
    <div class="ew-sb-id"><span class="ew-photo">${esc(initials(p.name))}</span><div><b class="ew-sb-name">${esc(lastFirst(p.name))}</b><span>${esc(p.sex || '')}, ${age(p.dob)} y.o., ${esc(usDate(p.dob))}</span><span>MRN: <b>${esc(p.mrn)}</b></span></div></div>
    <div class="ew-sb-alert ${al.length ? 'on' : ''}"><b>Allergies:</b> ${al.length ? esc(al.join('; ')) : 'No Known Allergies'}</div>
    <div class="ew-sb-grp"><h4>Code status</h4><p class="ew-sb-p">${esc(p.advanceDirective || 'Not on file')}</p></div>
    <div class="ew-sb-grp"><h4>Encounter</h4>${row('Type', p.encounterType)}${row('Unit', p.unit)}${row('Attending', p.attending)}${row(/inpatient/i.test(p.encounterType || '') ? 'Admitted' : 'Arrived', p.admit)}${row(/inpatient/i.test(p.encounterType || '') ? 'Discharged' : 'Departed', p.discharge)}${los != null && /inpatient/i.test(p.encounterType || '') ? row('Length of stay', `${los} day${los === 1 ? '' : 's'}`) : ''}</div>
    <div class="ew-sb-grp"><h4>Coverage</h4>${row('Primary', p.payer || p.insurance[0]?.plan)}</div>
    <div class="ew-sb-grp"><h4>Facility</h4><p class="ew-sb-p">${esc(p.facility)}</p></div>${ewStoryCoding()}</aside>`;
}
function ewStoryCoding() {
  const m = ewMode(); const ab = ewAbs(); const n = ab.dx.filter(r => r.code).length + ab.px.filter(r => r.code).length;
  return `<div class="ew-sb-grp"><h4>Coding</h4><p class="ew-sb-p">${m === 'practice' ? 'Practice mode (not saved)' : m === 'graded' ? 'Graded: read-only' : n ? `${n} code${n > 1 ? 's' : ''} entered` : 'Not started'}</p><button class="ew-btn sm" data-act="ew-act" data-v="coding">Open Coding</button></div>`;
}

/* ---------- activities ---------- */
function ewSummary(p) {
  const prob = p.problems.filter(x => !/resolved|inactive/i.test(x.status));
  const v = p.vitals[p.vitals.length - 1]; const ab = p.labs.filter(l => /^[HL]/.test(l.flag || ''));
  const meds = p.meds.filter(m => /active/i.test(m.status));
  const notes = [...p.docs].reverse().slice(0, 6);
  return `<div class="ew-sum">
    ${ewSec('Active Problems', ewGrid(['Problem', 'Noted'], prob.map(x => `<tr><td>${esc(x.desc)}${x.priority ? ` <span class="ew-tag">${esc(x.priority)}</span>` : ''}</td><td class="num">${esc(x.onset)}</td></tr>`)), 'problems')}
    ${ewSec('Allergies', ewGrid(['Allergen', 'Status'], p.allergies.map(a => `<tr><td>${esc(a.subject)}</td><td>${esc(a.status)}</td></tr>`)), 'allergies')}
    ${ewSec('Last Filed Vitals', v ? `<dl class="ew-kv"><dt>Time</dt><dd>${esc(v.t)}</dd><dt>Temp</dt><dd>${esc(v.temp || '—')}</dd><dt>Pulse</dt><dd>${esc(v.hr || '—')}</dd><dt>Resp</dt><dd>${esc(v.rr || '—')}</dd><dt>BP</dt><dd>${esc(v.bp || '—')}</dd><dt>SpO2</dt><dd>${esc(v.spo2 || '—')}${v.spo2 && !/%/.test(v.spo2) ? '%' : ''}</dd>${v.pain ? `<dt>Pain</dt><dd>${esc(v.pain)}</dd>` : ''}</dl>` : '<p class="ew-none">No vitals filed.</p>', 'flow')}
    ${ewSec('Abnormal Results', ewGrid(['Test', 'Result', 'Collected'], ab.slice(0, 8).map(l => `<tr><td>${esc(l.name)}</td>${flagTd(l.flag, `${l.value} ${l.unit || ''}`)}<td class="num">${esc(l.date)}</td></tr>`), { empty: 'No abnormal results.' }), 'results')}
    ${ewSec('Active Medications', ewGrid(['Medication', 'Route', 'Frequency'], meds.slice(0, 8).map(m => `<tr><td>${esc(m.drug)}</td><td>${esc(m.route)}</td><td>${esc(m.frequency)}</td></tr>`)), 'mar')}
    ${ewSec('Recent Notes', ewGrid(['Date', 'Note', 'Author'], notes.map(d => `<tr class="ew-click" data-act="ew-note" data-v="${esc(d.id)}"><td class="num">${esc(d.date)}</td><td><a>${esc(d.title)}</a>${d.signed ? '' : ' <span class="ew-tag red">Unsigned</span>'}</td><td>${esc(d.author)}</td></tr>`)), 'notes')}
  </div>`;
}
function ewNoteView(d) {
  if (!d) return '<div class="ew-preview-empty">Select a row to preview it here.</div>';
  return `<article class="ew-doc"><header><div><h3>${esc(d.title)}</h3><p>${esc(d.author || '')}${d.location ? ' · ' + esc(d.location) : ''}</p></div><div class="ew-doc-meta"><span class="num">${esc(d.date || '')}</span><span class="ew-stamp ${d.signed ? 'ok' : 'bad'}">${d.signed ? 'Signed' : 'Unsigned'}</span></div></header><pre>${esc(d.body || '')}</pre></article>`;
}
function ewChart(p) {
  const sub = S.ew.sub; let grid = '', prev = '';
  const sel = S.ew.sel; const pick = (k) => `class="ew-click ${sel === k ? 'on' : ''}" data-act="ew-sel" data-v="${esc(k)}"`;
  if (['notes', 'imaging', 'procedures'].includes(sub)) {
    const list = p.docs.filter(d => sub === 'notes' ? true : sub === 'imaging' ? IMG_RE.test(d.title) : PROC_RE.test(d.title));
    grid = ewGrid(['Date/Time', 'Type', 'Description', 'Author', 'Status'], [...list].reverse().map(d => `<tr ${pick(d.id)}><td class="num">${esc(d.date)}</td><td>${IMG_RE.test(d.title) ? 'Imaging' : PROC_RE.test(d.title) ? 'Procedure' : /nurs|rn\b|triage/i.test(d.title + d.author) ? 'Nursing Note' : 'Provider Note'}</td><td>${esc(d.title)}</td><td>${esc(d.author)}</td><td>${d.signed ? 'Signed' : '<span class="ew-bad">Unsigned</span>'}</td></tr>`), { empty: sub === 'imaging' ? 'No imaging reports.' : sub === 'procedures' ? 'No procedure or operative reports.' : 'No notes.' });
    prev = ewNoteView(p.docs.find(d => d.id === sel) || null);
  } else if (sub === 'encounters') {
    grid = ewGrid(['Date', 'Type / Description', 'Department', 'Provider', 'Status'], [...p.encounters].reverse().map((e, i) => `<tr ${pick('e' + i)}><td class="num">${esc(e.date)}</td><td>${esc(e.description)}</td><td>${esc(e.location)}</td><td>${esc(e.provider)}</td><td>${esc(e.status)}</td></tr>`));
    const i = /^e(\d+)$/.exec(sel || ''); const e = i && [...p.encounters].reverse()[+i[1]];
    prev = e ? `<dl class="ew-kv wide"><dt>Encounter date</dt><dd>${esc(e.date)}</dd><dt>Description</dt><dd>${esc(e.description)}</dd><dt>Department</dt><dd>${esc(e.location)}</dd><dt>Provider</dt><dd>${esc(e.provider)}</dd><dt>Status / disposition</dt><dd>${esc(e.status)}</dd></dl>` : '';
  } else if (sub === 'labs') {
    grid = ewGrid(['Collected', 'Panel', 'Test', 'Result', 'Units', 'Reference'], [...p.labs].reverse().map((l, i) => `<tr ${pick('l' + i)}><td class="num">${esc(l.date)}</td><td>${esc(l.panel || '')}</td><td>${esc(l.name)}</td>${flagTd(l.flag, l.value)}<td>${esc(l.unit || '')}</td><td class="num">${esc(l.ref || '')}</td></tr>`));
    const i = /^l(\d+)$/.exec(sel || ''); const l = i && [...p.labs].reverse()[+i[1]];
    prev = l ? `<dl class="ew-kv wide"><dt>Test</dt><dd>${esc(l.name)}</dd><dt>Result</dt><dd class="${/^H/.test(l.flag) ? 'ew-hi' : /^L/.test(l.flag) ? 'ew-lo' : ''}">${esc(l.value)} ${esc(l.unit || '')} ${l.flag ? '(' + esc(l.flag === 'H' ? 'High' : l.flag === 'L' ? 'Low' : l.flag) + ')' : ''}</dd><dt>Reference range</dt><dd>${esc(l.ref || '—')}</dd><dt>Collected</dt><dd>${esc(l.date)}</dd>${l.panel ? `<dt>Panel</dt><dd>${esc(l.panel)}</dd>` : ''}</dl>` : '';
  } else if (sub === 'meds') {
    grid = ewGrid(['Medication', 'Route', 'Frequency', 'Status', 'Start', 'Class'], p.meds.map(m => `<tr><td>${esc(m.drug)}</td><td>${esc(m.route)}</td><td>${esc(m.frequency)}</td><td>${esc(m.status)}</td><td class="num">${esc(m.when)}</td><td>${esc(m.category)}</td></tr>`));
  } else if (sub === 'orders') {
    grid = ewGrid(['Ordered', 'Category', 'Order', 'Frequency', 'Status'], [...p.orders].reverse().map(o => `<tr><td class="num">${esc(o.when)}</td><td>${esc(o.category)}</td><td>${esc(o.item)}</td><td>${esc(o.frequency)}</td><td>${esc(o.status)}</td></tr>`));
  } else if (sub === 'immun') {
    grid = ewGrid(['Date', 'Immunization / screening', 'Details', 'Type'], p.prevention.map(x => `<tr><td class="num">${esc(x.date)}</td><td>${esc(x.subject)}</td><td>${esc(x.details)}</td><td>${esc(x.type)}</td></tr>`));
  }
  const hasPrev = ['notes', 'imaging', 'procedures', 'encounters', 'labs'].includes(sub);
  return `<div class="ew-subtabs" role="tablist">${EW_SUBS.map(([k, l]) => `<button role="tab" aria-selected="${sub === k}" data-act="ew-sub" data-v="${k}">${l}</button>`).join('')}</div>
    <div class="ew-split ${hasPrev ? '' : 'one'}"><div class="ew-split-top">${grid}</div>${hasPrev ? `<div class="ew-split-bot"><div class="ew-pane-h">Preview</div>${prev || '<div class="ew-preview-empty">Select a row to preview it here.</div>'}</div>` : ''}</div>`;
}
function ewResults(p) {
  if (!p.labs.length) return '<p class="ew-none pad">No results on file.</p>';
  const cols = [...new Set(sortByTime(p.labs.map(l => ({ d: l.date })), 'd').map(x => x.d))];
  const groups = {}; p.labs.forEach(l => { const g = l.panel || 'Other results'; (groups[g] ||= {}); (groups[g][l.name] ||= { ref: l.ref, unit: l.unit, v: {} }).v[l.date] = l; });
  const rows = Object.entries(groups).map(([g, tests]) => `<tr class="ew-grp"><td colspan="${cols.length + 2}">${esc(g)}</td></tr>` + Object.entries(tests).map(([t, x]) => `<tr><th scope="row">${esc(t)}${x.unit ? ` <span class="ew-unit">(${esc(x.unit)})</span>` : ''}</th>${cols.map(c => { const l = x.v[c]; return l ? flagTd(l.flag, l.value) : '<td></td>'; }).join('')}<td class="ew-ref">${esc(x.ref || '')}</td></tr>`).join('')).join('');
  return `<p class="ew-hint">Results flowsheet: one row per test, one column per collection time. High and low values are flagged.</p><div class="ew-grid-wrap"><table class="ew-grid ew-flow"><thead><tr><th>Component</th>${cols.map(c => `<th class="num">${esc(c).replace(' ', '<br>')}</th>`).join('')}<th>Ref range</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function ewFlow(p) {
  if (!p.vitals.length) return '<p class="ew-none pad">No flowsheet data.</p>';
  const R = [['Temp', 'temp'], ['Pulse', 'hr'], ['Resp', 'rr'], ['BP', 'bp'], ['SpO2 (%)', 'spo2'], ['Pain (0-10)', 'pain']];
  return `<p class="ew-hint">Vital signs flowsheet, oldest on the left.</p><div class="ew-grid-wrap"><table class="ew-grid ew-flow"><thead><tr><th>Vital signs</th>${p.vitals.map(v => `<th class="num">${esc(v.t).replace(' ', '<br>')}</th>`).join('')}</tr></thead><tbody>${R.map(([l, k]) => `<tr><th scope="row">${l}</th>${p.vitals.map(v => `<td class="num">${esc(v[k] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function ewMar(p) {
  const g = {}; p.meds.forEach(m => (g[m.category || 'Medications'] ||= []).push(m));
  return Object.entries(g).map(([c, list]) => `<h3 class="ew-h3">${esc(c)}</h3>` + ewGrid(['Medication', 'Dose / instructions', 'Route', 'Frequency', 'Status', 'Start'], list.map(m => { const [name, ...rest] = String(m.drug).split(/(?<=\b(?:mg|mcg|g|units?|mL|mEq|%)\b)\s/); return `<tr><td><b>${esc(name)}</b></td><td>${esc(rest.join(' '))}</td><td>${esc(m.route)}</td><td>${esc(m.frequency)}</td><td><span class="ew-tag ${/active/i.test(m.status) ? 'green' : /discontinued/i.test(m.status) ? 'red' : ''}">${esc(m.status)}</span></td><td class="num">${esc(m.when)}</td></tr>`; }))).join('') || '<p class="ew-none pad">No medications.</p>';
}
function ewNotes(p) {
  const f = S.ew.noteFilter; const kind = d => IMG_RE.test(d.title) ? 'imaging' : PROC_RE.test(d.title) ? 'procedure' : /nurs|rn\b|triage|wound care|dietitian|social/i.test(d.title + ' ' + d.author) ? 'nursing' : 'provider';
  const list = [...p.docs].reverse().filter(d => f === 'all' || kind(d) === f); const cur = p.docs.find(d => d.id === S.ew.sel) || list[0];
  return `<div class="ew-notes"><nav class="ew-nlist" aria-label="Notes"><div class="ew-nfilter"><label>Show <select data-act="ew-nfilter" id="ew-nfilter">${[['all', 'All notes'], ['provider', 'Provider notes'], ['nursing', 'Nursing & allied health'], ['imaging', 'Imaging'], ['procedure', 'Procedures']].map(([k, l]) => `<option value="${k}" ${f === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
    ${list.map(d => `<button data-act="ew-sel" data-v="${esc(d.id)}" aria-current="${cur && d.id === cur.id}"><b>${esc(d.title)}</b><span>${esc(d.author || '')}</span><span class="num">${esc(d.date || '')}${d.signed ? '' : ' · <em>Unsigned</em>'}</span></button>`).join('') || '<p class="ew-none pad">No notes.</p>'}</nav>
    <div class="ew-nview">${ewNoteView(cur)}</div></div>`;
}
function ewDemo(p) {
  return `<div class="ew-sum">${ewSec('Patient Demographics', `<dl class="ew-kv wide"><dt>Legal name</dt><dd>${esc(p.name)}</dd><dt>MRN</dt><dd>${esc(p.mrn)}</dd><dt>Date of birth</dt><dd>${esc(usDate(p.dob))} (${age(p.dob)} y.o.)</dd><dt>Sex</dt><dd>${esc(p.sex)}</dd><dt>Language</dt><dd>${esc(p.language || '—')}</dd><dt>Race / ethnicity</dt><dd>${esc(p.race || '—')}</dd><dt>Contact</dt><dd>${esc(p.contact || '—')}</dd><dt>Advance directive</dt><dd>${esc(p.advanceDirective || 'None on file')}</dd></dl>`)}
    ${ewSec('Current Encounter', `<dl class="ew-kv wide"><dt>Facility</dt><dd>${esc(p.facility)}</dd><dt>Encounter type</dt><dd>${esc(p.encounterType || '—')}</dd><dt>Unit</dt><dd>${esc(p.unit || '—')}</dd><dt>Attending</dt><dd>${esc(p.attending || '—')}</dd><dt>Admit / arrival</dt><dd>${esc(p.admit || '—')}</dd><dt>Discharge</dt><dd>${esc(p.discharge || '—')}</dd></dl>`)}
    ${ewSec('Coverage', ewGrid(['Priority', 'Plan', 'Member number', 'Active'], p.insurance.map(i => `<tr><td>${esc(i.priority)}</td><td>${esc(i.plan)}</td><td class="num">${esc(i.number)}</td><td>${esc(i.active)}</td></tr>`)))}</div>`;
}
function ewReports(p) {
  return p.reports.map(r => `<section class="ew-card wide"><header><span>${esc(r.title)}</span></header>${r.note ? `<p class="ew-hint pad">${esc(r.note)}</p>` : ''}${ewGrid(r.columns, r.rows.map(row => `<tr>${r.columns.map((_, i) => `<td>${esc(row[i] ?? '')}</td>`).join('')}</tr>`))}</section>`).join('') || '<p class="ew-none pad">No reports.</p>';
}

/* ---------- Coding activity ---------- */
function ewAbs() {
  const key = (S.ehrOnly || '') + '|' + (S.ehrAid || '');
  if (S.ew.absFor !== key) {
    const c = ewContext(); const saved = c && S.abstracts?.[S.me.id]?.[c.aid];
    S.ew.abs = clone(saved || { dx: [], px: [], comments: '' }); S.ew.abs.dx ||= []; S.ew.abs.px ||= []; S.ew.absFor = key; S.ew.dirty = false;
  }
  return S.ew.abs;
}
const ewNormDx = raw => { let c = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); return c.length > 3 ? c.slice(0, 3) + '.' + c.slice(3) : c; };
const ewNormPx = raw => String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7);
const ewRefs = t => { const out = []; String(t).replace(/\b([A-Z]\d[0-9A-Z](?:\.[0-9A-Z]{1,4})?)(?:\s*-\s*([A-Z]\d[0-9A-Z](?:\.[0-9A-Z]{1,4})?))?/g, (m, a, b) => { out.push([a.replace('.', ''), (b || '').replace('.', '')]); return m; }); return out; };
const ewHit = (code, ref) => { const c = code.replace('.', ''); const [a, b] = ref; if (!b) return c.startsWith(a); return c.slice(0, a.length) >= a && c.slice(0, b.length) <= b; };
function ewDxInfo(code) {
  if (!CB.data) return { ok: null, desc: 'Loading code book…' };
  const r = CB.resolve(code); if (!r) return { ok: false, desc: '', err: 'Not a valid ICD-10-CM code in the FY2026 code set.' };
  const n = r.node; if (n.k) return { ok: false, desc: n.d, err: 'This is a chapter or block, not a code.' };
  if (r.ext) { const s7 = CB.seventh(n); return { ok: true, n, desc: `${n.d}, ${s7.def.find(d => d[0] === r.ext)?.[1] || ''}`, full: CB.full(n, r.ext) }; }
  if (!n.leaf) { const k = (CB.kids.get(n.c) || []).slice(0, 4); return { ok: false, n, desc: n.d, err: `Not billable: add more characters (${k.join(', ')}${(CB.kids.get(n.c) || []).length > 4 ? ', …' : ''}).` }; }
  const s7 = CB.seventh(n); if (s7) return { ok: false, n, desc: n.d, err: `Needs a 7th character (${s7.def.map(d => d[0]).join(', ')})${CB.norm(n.c).length < 6 ? ' and X placeholder(s)' : ''}, e.g. ${CB.full(n, s7.def[0][0])}.` };
  return { ok: true, n, desc: n.d, full: n.c };
}
function ewEdits(ab, p) {
  const inpt = /inpatient/i.test(p.encounterType || '') && p.kind !== 'dataset';
  const dx = ab.dx.map(r => ({ ...r, info: r.code ? ewDxInfo(r.code) : null, msgs: [] }));
  const codes = dx.map(r => r.info?.ok ? r.info.full : '');
  dx.forEach((r, i) => {
    const m = r.msgs; if (!r.code) return; const inf = r.info; if (inf.ok === null) return;
    if (!inf.ok) { m.push(['err', inf.err]); return; }
    const c = inf.full, n = inf.n, first = p.kind === 'dataset' ? (i === 0 || (dx[i - 1]?.case || '') !== (r.case || '')) : i === 0;
    if (codes.indexOf(c) !== i) m.push(['warn', 'Duplicate code.']);
    if (first) {
      if (/in diseases classified elsewhere/i.test(n.d)) m.push(['err', 'Manifestation code: it can never be principal or first-listed. Sequence the underlying condition first.']);
      if (/^R65\.2/.test(c)) m.push(['err', 'Severe sepsis (R65.2-) can never be principal or first-listed. Code the underlying infection first.']);
      if (/^[VWXY]/.test(c)) m.push(['err', 'External cause codes are never principal or first-listed.']);
      if (/^Z(3A|68|37)/.test(c)) m.push(['warn', 'This code is reported as an additional code, not first-listed.']);
    }
    if (inpt && !r.poa) m.push(/^(Z(79|68|87|86|8[0-4]|3A|37|88|91\.1|92|95|99|00|01|23)|[VWXY])/.test(c) ? ['info', 'This code is usually on the POA-exempt list: choose 1 (exempt).'] : ['warn', 'Choose a POA indicator.']);
    const chain = CB.chain(n).filter(x => !x.k);
    for (const lvl of chain) for (const note of lvl.x1 || []) for (const ref of ewRefs(note)) dx.forEach((o, j) => {
      if (j !== i && codes[j] && ewHit(codes[j], ref) && !(ref[0] && c.replace('.', '').startsWith(ref[0]))) { const msg = `Excludes1 at ${lvl.c}: "${note}" — ${codes[j]} is not normally reported with this code. Check the guideline exceptions.`; if (!m.some(x => x[1] === msg)) m.push(['warn', msg]); }
    });
    for (const lvl of chain.slice(-2)) {
      for (const note of lvl.cf || []) { const refs = ewRefs(note); if (!refs.length || refs.length > 20) continue; const at = codes.findIndex((o, j) => j !== i && o && refs.some(rf => ewHit(o, rf)));
        if (at > i && (p.kind !== 'dataset' || (dx[at].case || '') === (r.case || ''))) m.push(['err', `Sequencing: "Code first" note at ${lvl.c} — ${codes[at]} should be listed before this code.`]); }
      /* "Use additional code" notes: a line ending in ":" starts a list; treat the list as one instruction */
      const groups = []; for (const note of lvl.ua || []) { if (groups.length && /:\s*$/.test(groups[groups.length - 1].head) && !/:\s*$/.test(note) && groups[groups.length - 1].open) groups[groups.length - 1].items.push(note); else groups.push({ head: note, items: [note], open: /:\s*$/.test(note) }); }
      for (const g of groups) { const refs = g.items.flatMap(ewRefs); if (!refs.length || refs.length > 8) continue; if (!codes.some((o, j) => j !== i && o && refs.some(rf => ewHit(o, rf)))) m.push(['info', `Use additional code at ${lvl.c}: ${g.items.join(' ')}`]); }
    }
  });
  const px = ab.px.map(r => { const m = []; if (r.code) { const c = ewNormPx(r.code); if (!/^[0-9B-DFGHX][0-9A-HJ-NP-Z]{6}$/.test(c)) m.push(['err', 'An ICD-10-PCS code has 7 characters (letters I and O are never used).']); else m.push(['info', 'Format valid. Verify the code in the ICD-10-PCS Tables.']); } return { ...r, msgs: m }; });
  const count = k => [...dx, ...px].reduce((s, r) => s + r.msgs.filter(x => x[0] === k).length, 0);
  return { dx, px, inpt, errs: count('err'), warns: count('warn') };
}
function ewMsgs(m) { return m.length ? `<ul class="ew-edits">${m.map(([l, t]) => `<li class="${l}">${l === 'err' ? '✖' : l === 'warn' ? '▲' : 'ℹ'} ${esc(t)}</li>`).join('')}</ul>` : ''; }
/* read-only view used on the faculty grading page */
function ewAbstractView(ab, p) {
  if (!ab || !(ab.dx?.length || ab.px?.length || ab.comments)) return '<p class="muted">The student has not entered codes in the EHR Coding activity.</p>';
  if (!CB.data) { CB.load().then(() => scheduleRender()).catch(() => {}); }
  const e = ewEdits({ dx: ab.dx || [], px: ab.px || [] }, P(p) || { kind: '' }); const ds = p?.kind === 'dataset';
  return `<div class="ew-ro">${tbl(['#', ...(ds ? ['Case'] : []), 'Diagnosis code', 'Description', ...(e.inpt ? ['POA'] : []), 'Edits'], e.dx.map((r, i) => `<tr><td>${i + 1}</td>${ds ? `<td>${esc(r.case || '')}</td>` : ''}<td class="num"><b>${esc(r.info?.full || r.code)}</b></td><td>${esc(r.info?.desc || '')}</td>${e.inpt ? `<td>${esc(r.poa || '—')}</td>` : ''}<td>${ewMsgs(r.msgs.filter(x => x[0] !== 'info'))}</td></tr>`))}
    ${e.px.length ? tbl(['#', ...(ds ? ['Case'] : []), 'ICD-10-PCS code', 'Date', 'Description / notes'], e.px.map((r, i) => `<tr><td>${i + 1}</td>${ds ? `<td>${esc(r.case || '')}</td>` : ''}<td class="num"><b>${esc(ewNormPx(r.code))}</b></td><td>${esc(r.date || '')}</td><td>${esc(r.note || '')}</td></tr>`)) : ''}
    ${ab.comments ? `<p class="answer" style="margin-top:8px"><b>Coder comments:</b> ${esc(ab.comments)}</p>` : ''}<p class="hint">Saved ${fmtWhen(ab.savedAt)} · ${e.errs} edit error${e.errs === 1 ? '' : 's'}, ${e.warns} warning${e.warns === 1 ? '' : 's'} (automatic checks against the code book; they do not replace the answer key).</p></div>`;
}
function ewCoding(p) {
  if (!CB.data && !CB.loading && !CB.error) CB.load().then(() => render()).catch(() => render());
  const ab = ewAbs(); const mode = ewMode(); const ro = mode === 'graded'; const e = ewEdits(ab, p); const ds = p.kind === 'dataset';
  const c = ewContext(); const enc = ds ? `Data set ${esc(p.mrn)} · ${esc(p.facility)}` : `${esc(p.encounterType || '')} · ${esc(p.admit || '')}${p.discharge ? ' – ' + esc(p.discharge) : ''} · ${esc(p.attending || '')}`;
  const first = e.inpt ? 'Principal' : ds ? 'First for case' : 'First-listed';
  const dxRows = e.dx.map((r, i) => `<tr class="${r.msgs.some(m => m[0] === 'err') ? 'has-err' : ''}"><td class="ew-seq">${i + 1}${i === 0 && !ds ? `<span>${first}</span>` : ''}</td>
      ${ds ? `<td><input class="ew-in sm" aria-label="Case for diagnosis ${i + 1}" data-ewf="dx.${i}.case" value="${esc(r.case || '')}" ${ro ? 'disabled' : ''} placeholder="Case"></td>` : ''}
      <td><input class="ew-in code" aria-label="Diagnosis code ${i + 1}" data-ewf="dx.${i}.code" value="${esc(r.code)}" ${ro ? 'disabled' : ''} spellcheck="false"></td>
      <td class="ew-desc">${r.info ? `<span class="${r.info.ok ? '' : 'ew-bad'}">${esc(r.info.desc || '')}</span>` : ''}${ewMsgs(r.msgs)}</td>
      ${e.inpt ? `<td><select class="ew-in poa" aria-label="POA for diagnosis ${i + 1}" data-ewf="dx.${i}.poa" ${ro ? 'disabled' : ''}>${['', 'Y', 'N', 'U', 'W', '1'].map(v => `<option value="${v}" ${r.poa === v ? 'selected' : ''}>${v === '' ? '—' : v === '1' ? '1 (exempt)' : v}</option>`).join('')}</select></td>` : ''}
      <td class="ew-rowact">${ro ? '' : `<button class="ew-ico" title="Move up" aria-label="Move up" data-act="ew-mv" data-k="dx" data-v="${i}" data-d="-1" ${i ? '' : 'disabled'}>▲</button><button class="ew-ico" title="Move down" aria-label="Move down" data-act="ew-mv" data-k="dx" data-v="${i}" data-d="1" ${i < e.dx.length - 1 ? '' : 'disabled'}>▼</button><button class="ew-ico x" title="Remove" aria-label="Remove" data-act="ew-rm" data-k="dx" data-v="${i}">✕</button>`}</td></tr>`).join('');
  const pxRows = e.px.map((r, i) => `<tr><td class="ew-seq">${i + 1}</td>${ds ? `<td><input class="ew-in sm" aria-label="Case for procedure ${i + 1}" data-ewf="px.${i}.case" value="${esc(r.case || '')}" ${ro ? 'disabled' : ''} placeholder="Case"></td>` : ''}
      <td><input class="ew-in code" aria-label="Procedure code ${i + 1}" data-ewf="px.${i}.code" value="${esc(r.code)}" ${ro ? 'disabled' : ''} spellcheck="false"></td>
      <td><input class="ew-in sm" aria-label="Procedure date ${i + 1}" data-ewf="px.${i}.date" value="${esc(r.date || '')}" ${ro ? 'disabled' : ''} placeholder="MM/DD/YYYY"></td>
      <td class="ew-desc"><input class="ew-in" aria-label="Procedure description ${i + 1}" data-ewf="px.${i}.note" value="${esc(r.note || '')}" ${ro ? 'disabled' : ''} placeholder="Procedure (as documented)">${ewMsgs(r.msgs)}</td>
      <td class="ew-rowact">${ro ? '' : `<button class="ew-ico" title="Move up" aria-label="Move up" data-act="ew-mv" data-k="px" data-v="${i}" data-d="-1" ${i ? '' : 'disabled'}>▲</button><button class="ew-ico" title="Move down" aria-label="Move down" data-act="ew-mv" data-k="px" data-v="${i}" data-d="1" ${i < e.px.length - 1 ? '' : 'disabled'}>▼</button><button class="ew-ico x" title="Remove" aria-label="Remove" data-act="ew-rm" data-k="px" data-v="${i}">✕</button>`}</td></tr>`).join('');
  const status = mode === 'practice' ? '<span class="ew-tag">Practice mode: codes are not saved. Open the EHR from your assignment to save.</span>' : ro ? '<span class="ew-tag">Graded: read-only</span>' : S.ew.saving ? '<span class="ew-tag">Saving…</span>' : S.ew.dirty ? '<span class="ew-tag amber">Unsaved changes</span>' : ab.savedAt ? `<span class="ew-tag green">Saved ${esc(fmtWhen(ab.savedAt))}${ab.byName && ab.by !== S.me.id ? ' by ' + esc(ab.byName) : ''}</span>` : '<span class="ew-tag">Not saved yet</span>';
  return `<div class="ew-coding">
    <div class="ew-cod-main">
      <div class="ew-cod-head"><div><b>Coding Summary</b><span>${enc}</span>${c ? `<span>Assignment: ${esc(c.a.title)}</span>` : ''}${c?.a.teamwork && S.me.team ? `<span>Group activity: shared with ${esc(S.me.team)} (${esc((S.team || []).map(x => x.name).join(', '))})</span>` : ''}</div>
        <div class="ew-cod-act">${status}<span class="ew-tag ${e.errs ? 'red' : e.warns ? 'amber' : 'green'}">${e.errs} error${e.errs === 1 ? '' : 's'} · ${e.warns} warning${e.warns === 1 ? '' : 's'}</span>${mode === 'save' ? `<button class="ew-btn primary" data-act="ew-save" ${S.ew.saving ? 'disabled' : ''}>Save coding</button>` : ''}</div></div>
      <h3 class="ew-h3">Diagnoses (ICD-10-CM)</h3>
      <p class="ew-hint">Enter codes in sequence: ${e.inpt ? 'the principal diagnosis first, then secondary diagnoses. Choose a POA indicator for each.' : ds ? 'label each code with its case number and list each case\'s first-listed code first.' : 'the first-listed diagnosis first.'} Type a code with or without the dot; checks run automatically.</p>
      <div class="ew-grid-wrap"><table class="ew-grid ew-cod"><thead><tr><th>#</th>${ds ? '<th>Case</th>' : ''}<th>Code</th><th>Description and edits</th>${e.inpt ? '<th>POA</th>' : ''}<th></th></tr></thead><tbody>${dxRows || `<tr><td colspan="6" class="ew-none">No diagnosis codes yet.</td></tr>`}</tbody></table></div>
      ${ro ? '' : `<div class="ew-addrow"><input class="ew-in code" id="ew-add-dx" placeholder="Add ICD-10-CM code" aria-label="Add diagnosis code" spellcheck="false"><button class="ew-btn" data-act="ew-add" data-k="dx">Add diagnosis</button></div>`}
      <h3 class="ew-h3">Procedures (ICD-10-PCS)</h3>
      <div class="ew-grid-wrap"><table class="ew-grid ew-cod"><thead><tr><th>#</th>${ds ? '<th>Case</th>' : ''}<th>Code</th><th>Date</th><th>Description and edits</th><th></th></tr></thead><tbody>${pxRows || `<tr><td colspan="6" class="ew-none">No procedure codes. Leave empty if no procedures are coded for this record.</td></tr>`}</tbody></table></div>
      ${ro ? '' : `<div class="ew-addrow"><input class="ew-in code" id="ew-add-px" placeholder="Add ICD-10-PCS code" aria-label="Add procedure code" spellcheck="false"><button class="ew-btn" data-act="ew-add" data-k="px">Add procedure</button></div>`}
      <h3 class="ew-h3">Coder comments</h3>
      <textarea class="ew-in" id="ew-comments" rows="3" data-ewf="comments" ${ro ? 'disabled' : ''} placeholder="Queries you would send, documentation you relied on, or questions for your instructor">${esc(ab.comments || '')}</textarea>
      <p class="ew-hint">Edits are automatic checks against the Tabular List (validity, billability, 7th characters, Excludes1, Code first and principal-diagnosis rules). They help you find mistakes; they do not tell you whether a code is the right one for the documentation.</p>
    </div>
    <aside class="ew-cod-book" aria-label="Code book">${codeBookHTML('coding')}</aside></div>`;
}

/* ---------- workstation shell ---------- */
function ehrWorkstationHTML(raw) {
  const p = P(raw); if (!p) return '<div class="empty">Patient chart not found.</div>';
  const acts = p.kind === 'dataset' ? EW_ACTS_DS : p.reports.length ? [...EW_ACTS.slice(0, 9), ['reports', `Reports & Forms (${p.reports.length})`], ...EW_ACTS.slice(9)] : EW_ACTS;
  if (!acts.some(([k]) => k === S.ew.act)) S.ew.act = acts[0][0];
  const act = S.ew.act; const searching = S.chartTab === 'search' && (S.chartQ || '').trim();
  let body = '', title = acts.find(a => a[0] === act)[1];
  if (searching) { body = searchHTML(p); title = 'Search Results'; }
  else body = { summary: ewSummary, chart: ewChart, results: ewResults, flow: ewFlow, mar: ewMar, notes: ewNotes, demo: ewDemo, reports: ewReports, coding: ewCoding,
    problems: x => ewGrid(['Priority', 'Problem', 'Status', 'Acuity', 'Noted', 'Provider'], x.problems.map(a => `<tr><td>${esc(a.priority)}</td><td><b>${esc(a.desc)}</b></td><td>${esc(a.status)}</td><td>${esc(a.immediacy)}</td><td class="num">${esc(a.onset)}</td><td>${esc(a.provider)}</td></tr>`)),
    allergies: x => ewGrid(['Allergen', 'Reaction / details', 'Type', 'Status', 'Noted'], x.allergies.map(a => { const m = /^(.*?)\s*\((.*)\)\s*$/.exec(a.subject || ''); return `<tr><td><b>${esc(m ? m[1] : a.subject)}</b></td><td>${esc(m ? m[2] : '')}</td><td>${esc(a.type)}</td><td>${esc(a.status)}</td><td class="num">${esc(a.date)}</td></tr>`; })),
    codebook: () => codeBookHTML('ewbook') }[act](p);
  const mode = ewMode(); const ctx = ewContext();
  return `<div class="ew">
    <header class="ew-bar"><div class="ew-brand"><span class="ew-logo">${MARK_SVG}</span><b>${esc(S.site.siteName || 'CodeLab')} EHR</b><span class="ew-env">TRAINING</span></div>
      <nav class="ew-tools" aria-label="Toolbar">${(p.kind === 'dataset' ? [['reports', 'Reports'], ['notes', 'Notes'], ['coding', 'Coding'], ['codebook', 'Code Book']] : [['chart', 'Chart Review'], ['results', 'Results'], ['notes', 'Notes'], ['mar', 'MAR'], ...(p.reports.length ? [['reports', 'Forms']] : []), ['coding', 'Coding'], ['codebook', 'Code Book']]).map(([k, l]) => `<button data-act="ew-act" data-v="${k}" class="${act === k && !searching ? 'on' : ''}">${l}</button>`).join('')}</nav>
      <div class="ew-right"><input type="search" id="chart-q" data-act="chart-q" placeholder="Search chart" aria-label="Search this chart" value="${esc(S.chartQ || '')}" autocomplete="off">${p.kind === 'dataset' ? '' : '<button class="ew-btn sm" id="tour-help" data-act="tour">? Help</button>'}<span class="ew-user">${esc(S.me.name)}</span></div></header>
    <div class="ew-ptabs"><span class="ew-ptab on">${esc(p.kind === 'dataset' ? p.name : lastFirst(p.name))}<small>${esc(p.kind === 'dataset' ? 'Data set ' + p.mrn : 'MRN ' + p.mrn)}</small></span>${ctx ? `<span class="ew-ctx">Assignment: <b>${esc(ctx.a.title)}</b></span>` : ''}</div>
    <div class="ew-body">${ewStory(p)}
      <nav class="ew-acts" aria-label="Activities">${acts.map(([k, l]) => `<button data-act="ew-act" data-v="${k}" aria-current="${act === k && !searching}"><span aria-hidden="true">${EW_ICON[k] || '•'}</span>${l}</button>`).join('')}</nav>
      <main class="ew-main"><div class="ew-acthead"><h2>${esc(title)}</h2>${act === 'coding' && !searching ? '' : `<span class="ew-hint">${esc(searching ? '' : EW_HINT[act] || '')}</span>`}</div>
        <div class="ew-content ${act === 'coding' || act === 'codebook' ? 'flush' : ''}">${body}</div></main></div>
    <footer class="ew-status"><span>${esc(S.me.name)} · ${esc(ROLE_LABEL[role()] || '')}</span><span>${esc(p.facility || '')}</span><span>Fictional patient data for education only</span><span>${mode === 'save' ? 'Coding is saved to your assignment' : mode === 'graded' ? 'Assignment graded' : 'Practice mode'}</span></footer></div>`;
}

/* ---------- events ---------- */
const SEARCH_TAB_MAP = { registration: 'demo', insurance: 'demo', alerts: 'allergies', problems: 'problems', vitals: 'flow', labs: 'results', meds: 'mar', notes: 'notes', reports: 'reports', encounters: ['chart', 'encounters'], orders: ['chart', 'orders'], prevention: ['chart', 'immun'] };
async function ewSave(quiet) {
  const c = ewContext(); if (!c || ewMode() !== 'save') return;
  S.ew.saving = true; render();
  try { const ab = S.ew.abs; const r = await api('PUT', '/api/abstract/' + encodeURIComponent(c.aid), { dx: ab.dx.filter(x => x.code), px: ab.px.filter(x => x.code), comments: ab.comments || '' });
    (S.abstracts ||= {})[S.me.id] = { ...(S.abstracts[S.me.id] || {}), [c.aid]: r.abstract }; S.ew.abs.savedAt = r.abstract.savedAt; S.ew.dirty = false; if (!quiet) toast('Coding summary saved to your assignment');
  } catch (err) { toast(err.message); }
  S.ew.saving = false; render();
}
let ewTimer = null;
function ewTouched() { S.ew.dirty = true; clearTimeout(ewTimer); if (ewMode() === 'save') ewTimer = setTimeout(() => ewSave(true), 2500); }
function ewAdd(k) {
  const el = document.getElementById('ew-add-' + k); const v = el?.value.trim(); if (!v) return;
  const code = k === 'dx' ? ewNormDx(v) : ewNormPx(v); const ab = ewAbs(); const last = ab[k][ab[k].length - 1];
  ab[k].push(k === 'dx' ? { code, poa: '', case: last?.case || '' } : { code, date: '', case: last?.case || '', note: '' }); ewTouched(); render();
  setTimeout(() => document.getElementById('ew-add-' + k)?.focus(), 0);
}
document.addEventListener('click', e => {
  if (!S.ehrOnly) return;
  const el = e.target.closest('[data-act]'); if (!el) return; const a = el.dataset.act, v = el.dataset.v;
  if (a === 'ew-act') { S.ew.act = v; S.ew.sel = null; S.chartTab = 'overview'; S.chartQ = ''; render(); document.querySelector('.ew-content')?.scrollTo?.(0, 0); }
  else if (a === 'ew-sub') { S.ew.sub = v; S.ew.sel = null; render(); }
  else if (a === 'ew-sel') { S.ew.sel = v; render(); }
  else if (a === 'ew-note') { S.ew.act = 'notes'; S.ew.sel = v; S.ew.noteFilter = 'all'; render(); }
  else if (a === 'open-note' || a === 'chart-tab') { /* links from search results */
    setTimeout(() => { if (a === 'open-note') { S.ew.act = 'notes'; S.ew.sel = v; S.ew.noteFilter = 'all'; } else { const m = SEARCH_TAB_MAP[v] || 'summary'; if (Array.isArray(m)) { S.ew.act = m[0]; S.ew.sub = m[1]; } else S.ew.act = m; S.ew.sel = null; }
      S.chartTab = 'overview'; S.chartQ = ''; render(); }, 0); }
  else if (a === 'ew-add') ewAdd(el.dataset.k);
  else if (a === 'ew-rm') { ewAbs()[el.dataset.k].splice(+v, 1); ewTouched(); render(); }
  else if (a === 'ew-mv') { const L = ewAbs()[el.dataset.k], i = +v, j = i + +el.dataset.d; if (j >= 0 && j < L.length) { [L[i], L[j]] = [L[j], L[i]]; ewTouched(); render(); } }
  else if (a === 'ew-save') { clearTimeout(ewTimer); ewSave(false); }
  else if (a === 'ew-add-code') { if (ewMode() === 'graded') return; const ab = ewAbs(); const last = ab.dx[ab.dx.length - 1]; if (ab.dx.some(r => ewNormDx(r.code) === v)) return toast(v + ' is already in the coding summary'); ab.dx.push({ code: v, poa: '', case: last?.case || '' }); ewTouched(); toast('Added ' + v + ' to diagnoses'); render(); }
});
document.addEventListener('change', e => {
  const el = e.target; if (!S.ehrOnly) return;
  if (el.dataset.act === 'ew-nfilter') { S.ew.noteFilter = el.value; S.ew.sel = null; render(); return; }
  const f = el.dataset.ewf; if (!f || f === 'comments') return;
  const [k, i, fld] = f.split('.'); const row = ewAbs()[k][+i]; if (!row) return;
  row[fld] = fld === 'code' ? (k === 'dx' ? ewNormDx(el.value) : ewNormPx(el.value)) : el.value; ewTouched(); render();
});
document.addEventListener('input', e => { const el = e.target; if (S.ehrOnly && el.dataset.ewf === 'comments') { ewAbs().comments = el.value; ewTouched(); } });
document.addEventListener('keydown', e => {
  if (!S.ehrOnly || e.key !== 'Enter') return; const id = e.target.id;
  if (id === 'ew-add-dx' || id === 'ew-add-px') { e.preventDefault(); ewAdd(id.slice(-2)); }
});
window.addEventListener('beforeunload', e => { if (S.ehrOnly && S.ew.dirty && ewMode() === 'save') { e.preventDefault(); e.returnValue = ''; } });
