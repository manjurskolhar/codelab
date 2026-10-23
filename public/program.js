'use strict';
/* Online certificate program: independent learners register, pay the fee (confirmed by hand), complete the course
   practicals, upload their sheets, and receive a certificate that staff issue by hand. */
const money = (pr) => `${pr.fee} ${pr.currency}`;
function passMark() { return +(S.program?.passMark ?? 70); }
function pct(g) { return g ? Math.round(g.score / (g.max || 100) * 100) : 0; }
function passed(g) { return !!g && pct(g) >= passMark(); }
/* course progress for one learner: every assignment visible to the learner is a course practical */
function progressOf(sid) {
  const stu = S.students[sid]; const list = Object.entries(S.assignments).map(([id, a]) => ({ id, ...a })).filter(a => a.target === 'all' || a.target === stu?.section)
    .sort((x, y) => (x.createdAt || 0) - (y.createdAt || 0));
  const rows = list.map(a => { const g = grade(sid, a.id), s = sub(sid, a.id); return { a, g, s, state: g ? (passed(g) ? 'passed' : 'failed') : s?.status === 'submitted' ? 'submitted' : 'todo' }; });
  const n = rows.filter(r => r.state === 'passed').length;
  return { rows, total: rows.length, passed: n, eligible: rows.length > 0 && n === rows.length };
}
const learnerState = (u) => u.access === 'approved' ? ['ok', 'Approved'] : u.access === 'rejected' ? ['bad', 'Not approved'] : (S.learners?.[u.id]?.receipt ? ['warn', 'Receipt to check'] : ['', 'Awaiting payment']);

/* ---------------- public: register ---------------- */
VIEWS.register = () => {
  if (S.pubProgram === undefined) { S.pubProgram = null; api('GET', '/api/program').then(r => { S.pubProgram = r; render(); }).catch(() => { S.pubProgram = { open: false }; render(); }); }
  const pr = S.pubProgram;
  const steps = [['Register', 'Create your account with the name you want on your certificate.'], ['Pay the fee', pr?.open ? `Pay ${money(pr)} and upload your payment receipt.` : 'Pay the registration fee and upload your receipt.'],
    ['Get access', 'We confirm your payment and open your practicals.'], ['Complete the practicals', 'Work in the EHR, enter your codes, and upload your completed sheet for each practical.'],
    ['Pass and get certified', `Pass every practical (${pr?.passMark ?? 70}% or more) to receive your certificate. You can resubmit any practical you do not pass.`]];
  return `<div class="lp lp-college">
    <aside class="lp-side"><div class="lp-side-in"><a class="lp-side-brand" href="/"><span class="lp-logo mark">${MARK_SVG}</span><div><b>${esc(S.site.siteName || 'CodeLab')}</b><span>${esc(pr?.name || 'Online certificate program')}</span></div></a>
      <h1>${esc(pr?.title || 'ICD-10 Coding Practicum Certificate')}</h1><p class="lp-lead">${esc(pr?.summary || 'Hands-on ICD-10 coding practicals in a hospital-style EHR, with a certificate of completion.')}</p>
      ${pr?.open ? `<div class="reg-price"><b>${esc(money(pr))}</b><span>one-time registration fee · ${pr.practicals} practical${pr.practicals === 1 ? '' : 's'} · self-paced</span></div>` : ''}
      <ol class="lp-steps vertical">${steps.map(([t, d], i) => `<li><span class="lp-num">${i + 1}</span><div><h3>${t}</h3><p>${d}</p></div></li>`).join('')}</ol>
      <p class="lp-side-foot">Already registered? <a href="/#signin">Sign in</a></p></div></aside>
    <main class="lp-main"><div class="lp-main-in">
      ${!pr ? '<p class="muted">Loading…</p>' : !pr.open ? `<h2>Registration is closed</h2><p class="muted">Registration for the online program is not open at the moment. Please check back later.</p><a class="btn" href="/">Back to the front page</a>` : `
      <h2>Create your account</h2><p class="muted">Independent learners register here. You do not need a college.</p>
      <form class="stack" data-form="register">
        <label class="field"><span>Full name (exactly as it should appear on your certificate)</span><input type="text" id="rg-name" name="name" required autocomplete="name"></label>
        <label class="field"><span>Email (your username)</span><input type="text" id="rg-email" name="email" required inputmode="email" autocomplete="email"></label>
        <div class="grid2"><label class="field"><span>Phone (optional)</span><input type="text" id="rg-phone" name="phone" autocomplete="tel"></label>
          <label class="field"><span>Country</span><input type="text" id="rg-country" name="country" autocomplete="country-name"></label></div>
        <label class="field"><span>Choose a password (at least 8 characters)</span><input type="password" id="rg-pw" name="password" required minlength="8" autocomplete="new-password"></label>
        <label class="field"><span>Repeat the password</span><input type="password" id="rg-pw2" name="repeat" required minlength="8" autocomplete="new-password"></label>
        <label class="row small" style="gap:8px;align-items:flex-start"><input type="checkbox" id="rg-agree" name="agree" required style="margin-top:3px"> <span>I understand that access opens after my payment of ${esc(money(pr))} is confirmed, that a certificate is issued only after I pass every practical, and that all patient records are fictional training data.</span></label>
        <button class="btn primary lp-wide" type="submit">Register and continue to payment</button>
      </form>`}
    </div></main></div>`;
};
async function loadPubProgram() { if (S.pubProgram !== undefined) return; S.pubProgram = null; try { S.pubProgram = await api('GET', '/api/program'); } catch (_) { S.pubProgram = { open: false }; } render(); }

/* ---------------- learner: registration & payment ---------------- */
VIEWS.registration = () => {
  const pr = S.program, L = S.learner || {}, up = S.upload, f = (S.form ||= {}); const rej = S.me.access === 'rejected';
  const status = S.me.access === 'approved' ? ['ok', 'Payment confirmed: your practicals are open.'] : rej ? ['bad', 'We could not confirm your payment.'] : L.receipt ? ['warn', 'Receipt received. We are checking your payment; your practicals open as soon as it is confirmed.'] : ['', 'Waiting for your payment receipt.'];
  return `<div class="page-head"><div><span class="label">Online program</span><h1>Registration and payment</h1><p class="muted">${esc(pr.title)} · registration fee <b>${esc(money(pr))}</b></p></div></div>
    <div class="panel panel-pad reg-status ${status[0]}"><b>Status:</b> ${esc(status[1])}${rej && L.decision?.note ? `<div class="small" style="margin-top:4px">Note from the program team: ${esc(L.decision.note)}</div>` : ''}${rej ? '<div class="small" style="margin-top:4px">Upload a new receipt below to ask us to check again.</div>' : ''}</div>
    <ol class="steps">
      <li class="panel panel-pad stack"><div class="step-h"><span class="step-n">1</span><div><h2>Pay the registration fee: ${esc(money(pr))}</h2></div></div>
        <p class="reg-instr">${esc(pr.instructions)}</p>${pr.link ? `<div><a class="btn primary" href="${esc(pr.link)}" target="_blank" rel="noopener">Pay ${esc(money(pr))} online ↗</a></div>` : ''}</li>
      <li class="panel panel-pad stack"><div class="step-h"><span class="step-n">2</span><div><h2>Upload your payment receipt</h2><p class="small muted">A photo or PDF of the receipt or transfer confirmation (PDF, PNG or JPG, up to 20 MB).</p></div></div>
        ${L.receipt ? `<div class="stack" style="gap:6px"><span class="label">Uploaded ${fmtWhen(L.receiptAt)}${L.payRef ? ' · reference ' + esc(L.payRef) : ''}</span><div class="files">${fileRow(L.receipt)}</div></div>` : ''}
        ${S.me.access === 'approved' ? '' : `${f.receipt ? `<div class="files">${fileRow(f.receipt, '<button class="btn sm danger" data-act="rcpt-clear">Remove</button>')}</div>` : up?.slot === 'receipt' ? `<span class="small muted">Uploading ${esc(up.name)}…</span>` : `<label class="btn" style="align-self:flex-start"><input type="file" id="up-receipt" data-act="upload" data-slot="receipt" accept=".pdf,.png,.jpg,.jpeg" hidden>${L.receipt ? 'Upload a different receipt' : 'Choose receipt file'}</label>`}
        <label class="field"><span>Payment reference or transaction number (optional)</span><input type="text" id="rc-ref" data-bind="payRef" value="${esc(f.payRef ?? L.payRef ?? '')}" style="max-width:360px"></label>
        <div><button class="btn primary" data-act="rcpt-send" ${f.receipt ? '' : 'disabled'}>Send receipt for confirmation</button></div>`}</li>
      <li class="panel panel-pad stack"><div class="step-h"><span class="step-n">3</span><div><h2>Start your practicals</h2><p class="small muted">After your payment is confirmed, <b>My practicals</b> and <b>Progress & certificate</b> appear in the menu.</p></div></div></li>
    </ol>`;
};

/* ---------------- learner: progress & certificate ---------------- */
VIEWS.progress = () => {
  const pr = S.program, P0 = progressOf(S.me.id), L = S.learner || {}, cert = L.certificate;
  const lab = { passed: ['ok', 'Passed'], failed: ['bad', 'Not passed: resubmit'], submitted: ['info', 'Submitted: awaiting grade'], todo: ['', 'Not started'] };
  return `<div class="page-head"><div><span class="label">Online program</span><h1>Progress and certificate</h1><p class="muted">${esc(pr.title)}. Pass every practical with ${passMark()}% or more to receive your certificate.</p></div></div>
    <div class="stats"><div class="panel stat"><span class="label">Practicals passed</span><b>${P0.passed} / ${P0.total}</b><div class="bar" style="margin-top:8px"><i style="width:${P0.total ? P0.passed / P0.total * 100 : 0}%"></i></div></div>
      <div class="panel stat"><span class="label">Certificate</span><b style="font-size:1.2rem">${cert ? 'Issued' : P0.eligible ? 'Being prepared' : 'Not yet'}</b><span class="small muted">${cert ? 'No. ' + esc(cert.number || '—') : P0.eligible ? 'All practicals passed' : `${P0.total - P0.passed} practical${P0.total - P0.passed === 1 ? '' : 's'} to go`}</span></div></div>
    ${cert ? `<section class="panel panel-pad cert-box"><div><span class="label">Certificate of completion</span><h2>Congratulations, ${esc(S.me.name)}!</h2><p>Certificate number <b class="mono">${esc(cert.number || '—')}</b> · issued ${fmtWhen(cert.issuedAt)}</p></div>${cert.fid ? `<a class="btn primary" href="${fileHref(cert)}" download>Download certificate</a>` : '<span class="small muted">Your certificate file will be attached here.</span>'}</section>`
      : P0.eligible ? `<section class="panel panel-pad cert-box pending"><div><h2>All practicals passed</h2><p>${esc(pr.certNote)}</p></div></section>` : `<p class="hint">${esc(pr.certNote)}</p>`}
    <section class="panel">${tbl(['Practical', 'Status', 'Score', 'Attempts', ''], P0.rows.map(r => `<tr><td><b>${esc(r.a.title)}</b></td><td><span class="pill ${lab[r.state][0]}">${lab[r.state][1]}</span></td><td class="num">${r.g ? pct(r.g) + '%' : '—'}</td><td class="num">${r.s ? (r.s.attempt || 1) : 0}</td>
      <td><button class="btn sm ${r.state === 'passed' ? '' : 'primary'}" data-act="work" data-v="${r.a.id}">${r.state === 'todo' ? 'Start' : r.state === 'failed' ? 'Resubmit' : 'Open'}</button></td></tr>`))}</section>`;
};

/* ---------------- staff: registrations ---------------- */
VIEWS.registrations = () => {
  const tab = S.regTab || 'check'; const all = students().sort((a, b) => (S.learners?.[b.id]?.registeredAt || b.createdAt || 0) - (S.learners?.[a.id]?.registeredAt || a.createdAt || 0));
  const groups = { check: all.filter(u => u.access === 'pending' && S.learners?.[u.id]?.receipt), wait: all.filter(u => u.access === 'pending' && !S.learners?.[u.id]?.receipt), approved: all.filter(u => u.access === 'approved'), rejected: all.filter(u => u.access === 'rejected') };
  const labels = { check: 'Receipts to check', wait: 'Awaiting payment', approved: 'Approved', rejected: 'Not approved' };
  const list = groups[tab];
  return `<div class="page-head"><div><span class="label">Online program</span><h1>Registrations</h1><p class="muted">Check each learner's payment receipt against your bank or payment account, then approve to open their practicals. Fee: <b>${esc(money(S.program))}</b>.</p></div></div>
    <div class="chips" role="group" aria-label="Filter">${Object.keys(labels).map(k => `<button class="chip" data-act="reg-tab" data-v="${k}" aria-pressed="${tab === k}">${labels[k]} <span class="count">${groups[k].length}</span></button>`).join('')}</div>
    <section class="panel">${list.length ? tbl(['Learner', 'Contact', 'Registered', 'Receipt', 'Status', 'Decision'], list.map(u => { const L = S.learners?.[u.id] || {}; const st = learnerState(u);
      return `<tr><td><div class="person">${avatar(u.id)}<div><b>${esc(u.name)}</b><div class="small muted">${esc(u.email)}</div></div></div></td><td class="small">${esc(L.phone || '—')}<div class="muted">${esc(L.country || '')}</div></td><td class="small">${fmtWhen(L.registeredAt || u.createdAt)}</td>
        <td>${L.receipt ? `<a class="btn sm" href="${fileHref(L.receipt)}" download>Receipt</a><div class="small muted">${fmtWhen(L.receiptAt)}${L.payRef ? '<br>Ref: ' + esc(L.payRef) : ''}</div>` : '<span class="muted small">Not uploaded</span>'}</td>
        <td><span class="pill ${st[0]}">${st[1]}</span>${L.decision?.note ? `<div class="small muted">${esc(L.decision.note)}</div>` : ''}</td>
        <td><div class="stack" style="gap:6px;min-width:220px"><input type="text" id="note-${esc(u.id)}" placeholder="Note to learner (optional)" value="">
          <div class="row" style="gap:6px">${u.access !== 'approved' ? `<button class="btn sm primary" data-act="reg-approve" data-v="${esc(u.id)}">Approve</button>` : ''}${u.access !== 'rejected' ? `<button class="btn sm danger" data-act="reg-reject" data-v="${esc(u.id)}">${u.access === 'approved' ? 'Suspend access' : 'Reject'}</button>` : ''}</div></div></td></tr>`; }))
      : `<div class="empty">${tab === 'check' ? 'No receipts waiting. New registrations appear here when the learner uploads a receipt.' : 'Nobody in this list.'}</div>`}</section>`;
};

/* ---------------- staff: certificates ---------------- */
VIEWS.certificates = () => {
  const ls = students().filter(u => u.access === 'approved').map(u => ({ u, P: progressOf(u.id), L: S.learners?.[u.id] || {} }))
    .sort((a, b) => (+!!a.L.certificate - +!!b.L.certificate) || (+b.P.eligible - +a.P.eligible) || b.P.passed - a.P.passed);
  const up = S.upload; const year = new Date().getFullYear();
  return `<div class="page-head"><div><span class="label">Online program</span><h1>Certificates</h1><p class="muted">Learners who pass every course practical (${passMark()}% or more) become eligible. Prepare the certificate (you can print the ready-made template to PDF), then issue it with a number; the learner downloads it from <b>Progress & certificate</b>.</p></div></div>
    <section class="panel">${ls.length ? tbl(['Learner', 'Progress', 'Status', 'Certificate number', 'Certificate file', ''], ls.map(({ u, P: p, L }, i) => { const c = L.certificate; const f = S.certForm?.[u.id] || {};
      return `<tr><td><div class="person">${avatar(u.id)}<div><b>${esc(u.name)}</b><div class="small muted">${esc(u.email)}</div></div></div></td>
        <td style="min-width:140px"><div class="row" style="flex-wrap:nowrap"><div class="bar" style="width:80px"><i style="width:${p.total ? p.passed / p.total * 100 : 0}%"></i></div><span class="mono small">${p.passed}/${p.total}</span></div></td>
        <td>${c ? `<span class="pill ok">Issued ${fmtDate(new Date(c.issuedAt).toISOString().slice(0, 10))}</span>` : p.eligible ? '<span class="pill warn">Eligible</span>' : '<span class="pill">In progress</span>'}</td>
        <td><input type="text" id="cn-${esc(u.id)}" data-act="cert-num" data-v="${esc(u.id)}" value="${esc(f.number ?? c?.number ?? `CL-${year}-${String(1000 + i + 1)}`)}" style="width:150px" ${c ? 'disabled' : ''}></td>
        <td>${c?.fid ? fileRow(c) : f.file ? fileRow(f.file) : up?.slot === 'cert-' + u.id ? '<span class="small muted">Uploading…</span>' : c ? '<span class="small muted">No file</span>' : `<label class="btn sm"><input type="file" id="up-cert-${esc(u.id)}" data-act="upload" data-slot="cert-${esc(u.id)}" accept=".pdf,.png,.jpg,.jpeg" hidden>Upload PDF</label>`}</td>
        <td><div class="row" style="gap:6px;flex-wrap:nowrap"><button class="btn sm" data-act="cert-print" data-v="${esc(u.id)}">Print template</button>${c ? `<button class="btn sm danger" data-act="cert-revoke" data-v="${esc(u.id)}">Withdraw</button>` : `<button class="btn sm primary" data-act="cert-issue" data-v="${esc(u.id)}" ${p.eligible ? '' : 'title="Not all practicals are passed yet"'}>Issue</button>`}</div></td></tr>`; }))
      : '<div class="empty">No approved learners yet.</div>'}</section>
    ${S.certPrint ? certTemplate(S.certPrint) : ''}`;
};
function certTemplate(sid) {
  const u = S.students[sid]; if (!u) return ''; const pr = S.program; const num = S.certForm?.[sid]?.number || S.learners?.[sid]?.certificate?.number || document.getElementById('cn-' + sid)?.value || '';
  const d = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }); const p = progressOf(sid);
  return `<div class="cert-print"><div class="cert-frame"><div class="cert-org">${esc(S.org?.name || 'CodeLab')}</div><div class="cert-h">Certificate of Completion</div><p>This certifies that</p><div class="cert-name">${esc(u.name)}</div>
    <p>has successfully completed</p><div class="cert-title">${esc(pr.title)}</div><p>passing all ${p.total} hands-on ICD-10 coding practicals with a score of ${passMark()}% or higher.</p>
    <div class="cert-foot"><div><span>${esc(d)}</span><small>Date</small></div><div><span>${esc(num)}</span><small>Certificate number</small></div><div><span>&nbsp;</span><small>Program director</small></div></div></div></div>`;
}

/* ---------------- admin: program settings ---------------- */
VIEWS.program = () => {
  const pr = S.program; const f = S.form?.prog ? S.form : (S.form = { prog: true, ...pr });
  const nAsg = Object.keys(S.assignments).length;
  return `<div class="page-head"><div><span class="label">Online program</span><h1>Program settings</h1><p class="muted">Public registration page: <span class="mono">${esc(location.host)}/register</span></p></div><a class="btn" href="/register" target="_blank" rel="noopener">View registration page ↗</a></div>
    <section class="panel panel-pad stack" style="max-width:860px">
      <label class="row" style="gap:8px"><input type="checkbox" id="pg-open" data-bind="open" ${f.open ? 'checked' : ''}> <b>Registration is open</b> <span class="small muted">(new learners can register from the front page)</span></label>
      <label class="field"><span>Program title (also printed on the certificate)</span><input type="text" id="pg-title" data-bind="title" value="${esc(f.title)}"></label>
      <div class="grid2"><label class="field"><span>Registration fee</span><input type="text" id="pg-fee" data-bind="fee" value="${esc(f.fee)}"></label><label class="field"><span>Currency</span><input type="text" id="pg-cur" data-bind="currency" value="${esc(f.currency)}"></label>
        <label class="field"><span>Pass mark for each practical (%)</span><input type="number" min="0" max="100" id="pg-pass" data-bind="passMark" value="${esc(f.passMark)}"></label></div>
      <label class="field"><span>Short description (front page and registration page)</span><textarea id="pg-sum" data-bind="summary" rows="2">${esc(f.summary)}</textarea></label>
      <label class="field"><span>Payment instructions shown to learners (bank account, wallet, reference to use)</span><textarea id="pg-ins" data-bind="instructions" rows="4">${esc(f.instructions)}</textarea></label>
      <label class="field"><span>Online payment link (optional, e.g. a PayPal, Stripe or bank payment link)</span><input type="text" id="pg-link" data-bind="link" value="${esc(f.link || '')}" placeholder="https://"></label>
      <label class="field"><span>Certificate note shown to learners</span><textarea id="pg-cert" data-bind="certNote" rows="2">${esc(f.certNote)}</textarea></label>
      <div class="row"><button class="btn primary" data-act="prog-save">Save settings</button></div></section>
    <section class="panel panel-pad stack" style="max-width:860px"><h2>Course practicals <span class="count">${nAsg}</span></h2>
      <p class="small muted">Every activity assigned to <b>All students</b> is a course practical: learners must pass all of them for the certificate. Add practicals from the Assignment library (the due date is optional for the online program). Remove one under Assigned work.</p>
      <div class="row"><button class="btn" data-act="go" data-v="library">Add practicals from the library</button><button class="btn" data-act="go" data-v="assignments">Manage course practicals</button></div></section>`;
};

/* ---------------- events ---------------- */
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]'); if (!el) return; const a = el.dataset.act, v = el.dataset.v;
  if (a === 'reg-tab') { S.regTab = v; render(); }
  if (a === 'reg-approve' || a === 'reg-reject') { const note = document.getElementById('note-' + v)?.value || '';
    if (await write(() => api('POST', `/api/learners/${encodeURIComponent(v)}/decision`, { approve: a === 'reg-approve', note }))) { toast(a === 'reg-approve' ? 'Approved: practicals are now open for this learner' : 'Marked as not approved'); render(); } }
  if (a === 'rcpt-clear') { S.form.receipt = null; render(); }
  if (a === 'rcpt-send') { const f = S.form || {}; if (!f.receipt) return;
    if (await write(() => api('PUT', '/api/learner/receipt', { fileId: f.receipt.fid, payRef: f.payRef || '' }))) { S.form = {}; toast('Receipt sent. We will confirm your payment soon.'); render(); } }
  if (a === 'prog-save') { const f = S.form; if (await write(() => api('PUT', '/api/program', { open: !!f.open, title: f.title, fee: f.fee, currency: f.currency, passMark: +f.passMark, summary: f.summary, instructions: f.instructions, link: f.link || '', certNote: f.certNote }))) { S.form = null; toast('Program settings saved'); render(); } }
  if (a === 'cert-issue') { const num = document.getElementById('cn-' + v)?.value.trim(); if (!num) return toast('Enter a certificate number.');
    if (!el.dataset.confirm) { el.dataset.confirm = '1'; el.textContent = progressOf(v).eligible ? 'Click again to issue' : 'Not all passed: click again'; return; }
    const file = S.certForm?.[v]?.file; if (await write(() => api('POST', `/api/learners/${encodeURIComponent(v)}/certificate`, { number: num, fileId: file?.fid }))) { if (S.certForm) delete S.certForm[v]; toast('Certificate issued'); render(); } }
  if (a === 'cert-revoke') { if (!el.dataset.confirm) { el.dataset.confirm = '1'; el.textContent = 'Click again to withdraw'; return; }
    if (await write(() => api('POST', `/api/learners/${encodeURIComponent(v)}/certificate`, { revoke: true }))) { toast('Certificate withdrawn'); render(); } }
  if (a === 'cert-print') { (S.certForm ||= {})[v] = { ...(S.certForm[v] || {}), number: document.getElementById('cn-' + v)?.value }; S.certPrint = v; render(); document.body.classList.add('printing-cert'); setTimeout(() => { window.print(); }, 250); }
});
document.addEventListener('input', e => { const el = e.target; if (el.dataset.act === 'cert-num') { ((S.certForm ||= {})[el.dataset.v] ||= {}).number = el.value; } });
window.addEventListener('afterprint', () => { document.body.classList.remove('printing-cert'); if (S.certPrint) { S.certPrint = null; render(); } });
