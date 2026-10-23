'use strict';
/* Public pages: the CodeLab front page (/), each college's sign-in page (/c/slug) and first-time setup.
   Rendered by app.js when nobody is signed in. */
const LP_LOGIN_FORM = (btn = 'Sign in') => `<form class="stack" data-form="login">
    <label class="field"><span>Email</span><input type="text" id="li-email" name="email" autocomplete="username" inputmode="email" required placeholder="you@college.edu"></label>
    <label class="field"><span>Password</span><input type="password" id="li-pw" name="password" autocomplete="current-password" required></label>
    <button class="btn primary lp-wide" type="submit">${btn}</button>
    <p class="hint">First time? Use the temporary password from your faculty (students) or your college admin (faculty). You will choose your own password straight away.</p>
    <p class="hint">Forgot your password? Students ask their faculty; faculty ask the college admin to reset it.</p>
  </form>`;
const lpIcon = (k) => ({
  ehr: '<path d="M4 5h16v14H4z M4 9h16 M9 9v10"/>', book: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z M5 17a3 3 0 0 1 3-3h11"/>',
  code: '<path d="M8 8l-4 4 4 4 M16 8l4 4-4 4 M13.5 6l-3 12"/>', team: '<path d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M2 20c0-3 3-5 6-5s6 2 6 5 M14 15c3 0 8 1 8 5"/>',
  grade: '<path d="M4 4h16v16H4z M8 12l3 3 5-6"/>', lib: '<path d="M4 4h4v16H4z M10 4h4v16h-4z M16 5l4 1-3 14-4-1z"/>', org: '<path d="M3 21h18 M5 21V8l7-4 7 4v13 M9 21v-6h6v6"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z M9 12l2 2 4-4"/>' }[k] || '');
const lpSvg = (k) => `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${lpIcon(k)}</svg>`;
const LP_STEPS = [
  ['Faculty assign', 'Faculty choose activities from the library and assign them to a class, a section or teams, with a due date.'],
  ['Students open the EHR', 'Each assignment opens its own patient record in a hospital-style EHR: storyboard, chart review, results, notes and forms.'],
  ['Code and submit', 'Students look up codes in the ICD-10-CM code book, enter them in the Coding activity with automatic edits, complete the Word activity and submit.'],
  ['Faculty grade', 'Faculty see the document, the codes entered in the EHR and the answer key on one page, then return a grade and feedback.']];
function lpNav(signIn = true) {
  const n = S.site.siteName || 'CodeLab';
  return `<header class="lp-nav"><div class="lp-in"><a class="lp-brand" href="/"><span class="brand-mark">${MARK_SVG}</span><b>${esc(n)}</b><span>ICD-10 Coding Practicum</span></a>
    <nav aria-label="Front page"><a href="/#features">Features</a><a href="/#how">How it works</a><a href="/#roles">Who it is for</a><a href="/#library">Activities</a><a href="/join">Join a class</a>${S.pubProgram?.open ? '<a href="/register"><b>Get certified</b></a>' : ''}${signIn ? '<a class="btn primary sm" href="#signin" data-act="lp-signin">Sign in</a>' : ''}</nav></div></header>`;
}
const lpFoot = () => `<footer class="lp-foot"><div class="lp-in"><div><b>${esc(S.site.siteName || 'CodeLab')}</b><span>ICD-10 coding practicum for Health Information Management programs.</span></div>
  <div class="small">All patient records are fictional and for education only. ICD-10-CM data: CDC/NCHS Tabular List, FY2026 (April 1, 2026 release).</div></div></footer>`;

const lpProgram = () => { const pr = S.pubProgram; if (!pr?.open) return '';
  const st = [['Register online', 'No college needed. Create your own account in a minute.'], ['Pay ' + pr.fee + ' ' + pr.currency, 'Pay the one-time fee and upload your receipt. We confirm it and open your practicals.'], ['Do the practicals', `${pr.practicals} hands-on coding practicals in the EHR. Upload your completed sheet for each one.`], ['Get your certificate', `Pass every practical with ${pr.passMark}% or more (resubmit any you miss) and download your certificate.`]];
  return `<section class="lp-band lp-program" id="program"><div class="lp-in">
    <div class="lp-head"><span class="lp-eyebrow">Online certificate program · open to everyone</span><h2>${esc(pr.title)}</h2><p>${esc(pr.summary)}</p></div>
    <ol class="lp-steps">${st.map(([t, d], i) => `<li><span class="lp-num">${i + 1}</span><h3>${esc(t)}</h3><p>${esc(d)}</p></li>`).join('')}</ol>
    <div class="row" style="justify-content:center;margin-top:24px"><a class="btn primary lg" href="/register">Register for ${esc(pr.fee + ' ' + pr.currency)}</a><a class="btn lg" href="#signin" data-act="lp-signin">Already registered? Sign in</a></div>
  </div></section>`; };
VIEWS.landing = () => { if (S.pubProgram === undefined) setTimeout(loadPubProgram); return lpLanding(); };
const lpLanding = () => `<div class="lp">${lpNav()}
  <section class="lp-hero"><div class="lp-in lp-hero-grid">
    <div class="lp-hero-text"><span class="lp-eyebrow">For HIM and medical coding programs</span>
      <h1>Real coding practice in a real-feeling EHR.</h1>
      <p class="lp-lead">${esc(S.site.siteName || 'CodeLab')} gives every student a hospital-style electronic health record, the complete ICD-10-CM code book and a coding workspace with automatic edits, so they code from documentation the way professional coders do.</p>
      <div class="row"><a class="btn primary lg" href="#signin" data-act="lp-signin">Sign in</a><a class="btn lg" href="#how">See how it works</a></div>
      <ul class="lp-proof"><li><b>30</b> ready-to-assign activities</li><li><b>30</b> fictional patient records and data sets</li><li><b>FY2026</b> ICD-10-CM Tabular List</li></ul></div>
    <figure class="lp-shot lp-shot-hero"><div class="lp-shot-bar"><i></i><i></i><i></i><span>CodeLab EHR · Coding</span></div><img src="/img/ehr_coding.jpg" alt="The CodeLab EHR Coding activity: a coding summary with edits beside the ICD-10-CM code book" width="1280" height="800"></figure>
  </div></section>

  ${lpProgram()}
  <section class="lp-band" id="features"><div class="lp-in">
    <div class="lp-head"><span class="lp-eyebrow">Features</span><h2>Everything a coding practicum needs, in one place</h2><p>No software to install for students. Faculty assign, students code, faculty grade.</p></div>
    <div class="lp-feat">${[
      ['ehr', 'Hospital-style EHR', 'Patient storyboard, Chart Review with a preview pane, results and vital-sign flowsheets, MAR, notes, problem list and forms, laid out like the systems students will use at work.'],
      ['book', 'ICD-10-CM code book', 'The complete Tabular List with Includes, Excludes1 and Excludes2, Code first, Use additional code, Code also and 7th-character notes, searchable by words or code.'],
      ['code', 'Coding activity with edits', 'Students enter and sequence ICD-10-CM and ICD-10-PCS codes with POA indicators. Edits flag invalid codes, missing 7th characters, Excludes1 conflicts and principal-diagnosis errors.'],
      ['lib', 'Activity library', 'Orientation sessions, conventions, chapter-specific guidelines, inpatient coding, ICD-10-PCS, audits and billing, each with a Word activity, an answer key and its own record.'],
      ['team', 'Group billing activities', 'Teams take a claim from registration to payment: UB-04 and CMS-1500 claims, denials and appeals, with one shared submission and one team grade.'],
      ['grade', 'Grading in one view', 'The student\'s document, the codes they entered in the EHR (with edit results) and the answer key on the same page. Return scores, feedback and marked copies.'],
      ['org', 'For many colleges', 'Each college has its own address, logo, colours, faculty, students and records, with student limits and subscription dates managed by the provider.'],
      ['shield', 'Private and secure', 'Role-based access, hashed passwords, read-only guest previews and fictional patient data only. Runs on your own server with no external services.'],
    ].map(([i, t, d]) => `<article class="lp-card"><span class="lp-ico">${lpSvg(i)}</span><h3>${t}</h3><p>${d}</p></article>`).join('')}</div>
  </div></section>

  <section class="lp-band alt" id="how"><div class="lp-in">
    <div class="lp-head"><span class="lp-eyebrow">How it works</span><h2>From assignment to grade in four steps</h2></div>
    <ol class="lp-steps">${LP_STEPS.map(([t, d], i) => `<li><span class="lp-num">${i + 1}</span><h3>${t}</h3><p>${d}</p></li>`).join('')}</ol>
    <div class="lp-gallery">
      <figure class="lp-shot"><div class="lp-shot-bar"><i></i><i></i><i></i><span>Chart Review</span></div><img src="/img/ehr_chart.jpg" alt="Chart Review with a note shown in the preview pane" loading="lazy" width="1280" height="800"><figcaption>Read the documentation: notes, results, imaging and procedures with a preview pane.</figcaption></figure>
      <figure class="lp-shot"><div class="lp-shot-bar"><i></i><i></i><i></i><span>Code Book</span></div><img src="/img/codebook_page.jpg" alt="The ICD-10-CM code book showing a code with its instructional notes" loading="lazy" width="1280" height="800"><figcaption>Verify every code in the Tabular List and read its instructional notes.</figcaption></figure>
      <figure class="lp-shot"><div class="lp-shot-bar"><i></i><i></i><i></i><span>Grading</span></div><img src="/img/grade.jpg" alt="The faculty grading page with the student's coding summary" loading="lazy" width="1280" height="800"><figcaption>Grade with the student's codes, the edit results and the answer key together.</figcaption></figure>
    </div>
  </div></section>

  <section class="lp-band" id="roles"><div class="lp-in">
    <div class="lp-head"><span class="lp-eyebrow">Who it is for</span><h2>One platform, a clear job for each role</h2></div>
    <div class="lp-roles">${[
      ['Students', ['Sign in with the email and temporary password from your faculty, then choose your own password.', 'Open each assignment, download the activity document and open the EHR.', 'Read the record, verify codes in the code book and enter them in Coding.', 'Upload your completed document; see grades and feedback under My grades.']],
      ['Faculty', ['Add students one at a time or import a class list; place them in sections and teams.', 'Assign activities from the library, or build your own with your own records.', 'Review submissions and the codes students entered in the EHR.', 'Grade with the answer key on the same page; grade a whole team at once.']],
      ['College admins', ['Set your college\'s logo, colours and name.', 'Create faculty accounts and time-limited guest previews.', 'Follow completion across every assignment on the Overview page.', 'Keep built-in content up to date after each release.']],
    ].map(([t, items]) => `<article class="lp-role"><h3>${t}</h3><ul>${items.map(x => `<li>${esc(x)}</li>`).join('')}</ul></article>`).join('')}</div>
  </div></section>

  <section class="lp-band alt" id="library"><div class="lp-in lp-split">
    <div><span class="lp-eyebrow">Activity library</span><h2>30 activities, ready to assign</h2>
      <p>Every activity comes with a student Word document, a faculty answer key and its own fictional patient record. Faculty can edit any record or add their own.</p>
      <table class="lp-table"><tbody>${[['Orientation sessions', 2], ['ICD-10-CM foundations', 4], ['Chapter-specific coding', 13], ['Inpatient coding', 4], ['ICD-10-PCS', 2], ['Coding quality and compliance', 2], ['Billing and reimbursement (group activities)', 3]].map(([g, n]) => `<tr><td>${g}</td><td class="num"><b>${n}</b></td></tr>`).join('')}</tbody></table></div>
    <figure class="lp-shot"><div class="lp-shot-bar"><i></i><i></i><i></i><span>Assignment library</span></div><img src="/img/library.jpg" alt="The assignment library" loading="lazy" width="1280" height="800"></figure>
  </div></section>

  <section class="lp-band lp-signin-band" id="signin"><div class="lp-in lp-split">
    <div><span class="lp-eyebrow">Sign in</span><h2>Welcome back</h2>
      <p>Sign in with the email address and password your college gave you.</p>
      <a class="btn lg lp-join-btn" href="/join">New student? Create your account with a class code</a>
      <ol class="lp-mini">${[...(S.pubProgram?.open ? [['Independent learner?', 'Register yourself for the online certificate program at <a href="/register">Get certified</a>. No college needed.']] : []), ['New student?', 'Get a class code from your faculty and create your own account at Join a class, or use the temporary password your faculty gave you.'], ['New faculty member?', 'Your college admin creates your account.'], ['New college?', 'Contact your CodeLab provider to set up your college and its admin account.']].map(([t, d]) => `<li><b>${t}</b> ${d}</li>`).join('')}</ol></div>
    <div class="lp-form panel panel-pad">${LP_LOGIN_FORM()}</div>
  </div></section>
  ${lpFoot()}</div>`;

VIEWS.collegeLogin = () => {
  const s = S.site; const org = s.orgName || 'your college';
  const logo = s.logo ? `<span class="lp-logo"><img src="${esc(s.logo)}" alt="${esc(org)} logo"></span>` : `<span class="lp-logo mark">${MARK_SVG}</span>`;
  return `<div class="lp lp-college">
    <aside class="lp-side"><div class="lp-side-in">
      <a class="lp-side-brand" href="/">${logo}<div><b>${esc(s.siteName || 'CodeLab')}</b><span>${esc(org)}</span></div></a>
      <h1>ICD-10 coding practicum</h1><p class="lp-lead">Code real-world cases from documentation in a hospital-style EHR, verify every code in the ICD-10-CM code book, and get feedback from your faculty.</p>
      <ol class="lp-steps vertical">${LP_STEPS.map(([t, d], i) => `<li><span class="lp-num">${i + 1}</span><div><h3>${t}</h3><p>${d}</p></div></li>`).join('')}</ol>
      <p class="lp-side-foot">Fictional patient data for education only. <a href="/">About CodeLab</a></p></div></aside>
    <main class="lp-main"><div class="lp-main-in">
      <h2>Sign in to ${esc(org)}</h2><p class="muted">Use the email and password your college gave you.</p>
      ${LP_LOGIN_FORM()}
      <a class="btn lp-wide lp-join-alt" href="/join">New student? Create your account with a class code</a>
      <div class="lp-help"><h3>First time here?</h3>
        <dl><dt>Students</dt><dd>Use the class code from your faculty to create your own account, or sign in with the temporary password your faculty gave you. You will then see <b>My assignments</b>.</dd>
        <dt>Faculty</dt><dd>Your college admin creates your account. After signing in you can add students, assign activities and grade.</dd>
        <dt>Admins</dt><dd>Your CodeLab provider sends your first sign-in details. Set your college's look under <b>Appearance</b> and add faculty.</dd></dl></div>
    </div></main></div>`;
};
VIEWS.collegeMissing = () => `<div class="lp">${lpNav()}<section class="lp-band"><div class="lp-in" style="max-width:640px">
  <div class="panel empty"><b>College not found</b><span>The address /c/${esc(S.orgSlug)} does not match a college on CodeLab. Check the link your college sent you, or sign in on the front page.</span><a class="btn primary" href="/#signin">Go to sign in</a></div></div></section>${lpFoot()}</div>`;
VIEWS.setup = () => `<div class="lp lp-college"><aside class="lp-side"><div class="lp-side-in"><a class="lp-side-brand" href="/"><span class="lp-logo mark">${MARK_SVG}</span><div><b>CodeLab</b><span>ICD-10 Coding Practicum</span></div></a>
    <h1>Set up your CodeLab site</h1><p class="lp-lead">You are the owner of this installation. After creating your account you will:</p>
    <ol class="lp-steps vertical">${[['Add a college', 'Give it a name and a web address, for example /c/kfu, and enter its admin\'s name and email.'], ['Send the admin their sign-in details', 'CodeLab shows a temporary password once. The admin chooses their own password at first sign-in.'], ['The college sets itself up', 'The admin adds a logo and faculty; faculty add students and assign activities.'], ['Manage plans', 'Set student limits and subscription dates, renew, pause or resume colleges.']].map(([t, d], i) => `<li><span class="lp-num">${i + 1}</span><div><h3>${t}</h3><p>${d}</p></div></li>`).join('')}</ol></div></aside>
  <main class="lp-main"><div class="lp-main-in"><h2>Create the owner account</h2><p class="muted">This account manages colleges and plans. It cannot see students or their work.</p>
    <form class="stack" data-form="setup">
      <label class="field"><span>Your name</span><input type="text" id="su-name" name="name" required></label>
      <label class="field"><span>Email</span><input type="text" id="su-email" name="email" autocomplete="username" inputmode="email" required></label>
      <label class="field"><span>Password (at least 8 characters)</span><input type="password" id="su-pw" name="password" autocomplete="new-password" required></label>
      <button class="btn primary lp-wide" type="submit">Create owner account</button></form></div></main></div>`;

VIEWS.join = () => {
  const j = S.join || (S.join = {}); const info = j.info;
  if (j.code && !j.checked && !info) { j.checked = true; setTimeout(() => joinCheck(j.code), 0); }
  const steps = [['Get your class code', 'Your faculty gives you a code such as K7QM-4XRA, or a link that already contains it.'], ['Create your account', 'Enter your name, your college email and a password you choose (at least 8 characters).'], ['Open your assignments', 'You are placed in your class automatically. Assignments from your faculty appear under My assignments.'], ['Practice in the EHR', 'Open each assignment\'s patient record, code it in the Coding activity and submit your work.']];
  const ok = info && info.ok;
  return `<div class="lp lp-college">
    <aside class="lp-side"><div class="lp-side-in"><a class="lp-side-brand" href="/"><span class="lp-logo mark">${MARK_SVG}</span><div><b>${esc(S.site.siteName || 'CodeLab')}</b><span>ICD-10 Coding Practicum</span></div></a>
      <h1>Join your class</h1><p class="lp-lead">Create your student account in two minutes and start practicing coding in a hospital-style EHR.</p>
      <ol class="lp-steps vertical">${steps.map(([t, d], i) => `<li><span class="lp-num">${i + 1}</span><div><h3>${t}</h3><p>${d}</p></div></li>`).join('')}</ol>
      <p class="lp-side-foot">Already have an account? <a href="/#signin">Sign in</a></p></div></aside>
    <main class="lp-main"><div class="lp-main-in">
      ${ok ? `<div class="join-org">${info.logo ? `<img src="${esc(info.logo)}" alt="">` : `<span class="lp-logo mark sm">${MARK_SVG}</span>`}<div><b>${esc(info.college)}</b><span>${info.section ? 'Section ' + esc(info.section) : 'All students'} · Class code <span class="mono">${esc(j.code)}</span></span></div></div>
        <h2>Create your student account</h2>
        <form class="stack" data-form="join"><input type="hidden" name="code" value="${esc(j.code)}">
          <label class="field"><span>Full name (as your college records it)</span><input type="text" id="jn-name" name="name" required autocomplete="name"></label>
          <label class="field"><span>College email</span><input type="text" id="jn-email" name="email" required inputmode="email" autocomplete="email" placeholder="you@college.edu"></label>
          <label class="field"><span>Choose a password (at least 8 characters)</span><input type="password" id="jn-pw" name="password" required autocomplete="new-password" minlength="8"></label>
          <label class="field"><span>Repeat the password</span><input type="password" id="jn-pw2" name="repeat" required autocomplete="new-password" minlength="8"></label>
          <button class="btn primary lp-wide" type="submit">Create my account</button>
          <p class="hint">Your email becomes your username. Your faculty can see your name, email, submissions and grades. All patient records are fictional.</p>
          <button class="btn sm" type="button" data-act="join-reset">Use a different class code</button></form>`
      : `<h2>Enter your class code</h2><p class="muted">Your faculty gives you this code. It is 8 letters and numbers, for example K7QM-4XRA.</p>
        <form class="stack" data-form="join-code"><label class="field"><span>Class code</span><input type="text" id="jn-code" name="code" value="${esc(j.code || '')}" required autocomplete="off" spellcheck="false" class="join-input" placeholder="XXXX-XXXX"></label>
          ${j.err ? `<p class="join-err" role="alert">${esc(j.err)}</p>` : ''}
          <button class="btn primary lp-wide" type="submit">Continue</button></form>
        <div class="lp-help"><h3>No code?</h3><dl><dt>Students</dt><dd>Ask your faculty for your class code or sign-in details.</dd><dt>Faculty</dt><dd>Create class codes on the <b>Students</b> page after you sign in.</dd></dl></div>`}
    </div></main></div>`;
};
document.addEventListener('click', e => {
  if (e.target.closest('[data-act="join-reset"]')) { S.join = { code: '', checked: true }; render(); return; }
  const el = e.target.closest('[data-act="lp-signin"]'); if (!el) return;
  e.preventDefault(); document.getElementById('signin')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); setTimeout(() => document.getElementById('li-email')?.focus({ preventScroll: true }), 450);
});
