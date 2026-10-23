'use strict';
const TODAY = new Date().toISOString().slice(0,10);
const FILE_EXT = ['docx','pdf','xlsx','pptx','txt','csv','zip','png','jpg','jpeg'];
const MAX_FILE = 20*1024*1024;

/* ---------- state ---------- */
const S = {
  auth:'loading', // loading | setup | login | ready
  me:{id:'', name:'', role:'student', section:''},
  faculty:{}, students:{}, patients:{}, assignments:{}, library:{}, work:{}, grades:{},
  route:{name:null, p:{}}, form:null, upload:null,
  chartTab:'overview', ehrOnly:null,
  acct:{q:'', section:'', mine:false, results:null, created:null},
  lib:{cat:'All', q:'', tag:'', readyOnly:false}, sel:new Set(), busy:false,
  cb:{q:'', sel:null, ext:null, hist:[], open:false}, codesOnly:false,
};

/* ---------- utils ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);
const clone = o => JSON.parse(JSON.stringify(o ?? null));
const fmtDate = d => { if(!d) return '—'; if(!/^\d{4}-\d{2}-\d{2}$/.test(d)) return d; return new Date(d+'T00:00:00').toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'}); };
const fmtWhen = t => t ? new Date(t).toLocaleString(undefined,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : '—';
const fmtSize = n => n>=1048576? (n/1048576).toFixed(1)+' MB' : Math.max(1,Math.round(n/1024))+' KB';
const age = dob => { const b=new Date(dob+'T00:00:00'), n=new Date(); if(isNaN(b)) return '?'; let a=n.getFullYear()-b.getFullYear(); if(n < new Date(n.getFullYear(), b.getMonth(), b.getDate())) a--; return a; };
const lines = t => String(t||'').split('\n').map(s=>s.trim()).filter(Boolean);
function getPath(o,p){ return p.split('.').reduce((a,k)=> a==null? a : a[k], o); }
function setPath(o,p,v){ const ks=p.split('.'); let c=o; ks.slice(0,-1).forEach((k,i)=>{ if(c[k]==null) c[k] = /^\d+$/.test(ks[i+1])? [] : {}; c=c[k]; }); c[ks[ks.length-1]] = v; }
function toast(msg){ const t=document.getElementById('toast'); t.textContent=msg; t.hidden=false; clearTimeout(toast._t); toast._t=setTimeout(()=>t.hidden=true,4200); }
const palette=['#1D5C8F','#2C7A4B','#9A5800','#7A3E9D','#B42318','#0F6E78','#5B6B2A'];
function colorFor(id){ let h=0; for(const c of String(id)) h=(h*31+c.charCodeAt(0))>>>0; return palette[h%palette.length]; }
function person(id){ return S.students[id] || S.faculty[id] || S.guests?.[id] || null; }
function name(id){ if(id===S.me.id) return S.me.name || 'You'; return person(id)?.name || 'Former user'; }
function avatar(id){ const n=name(id); const ini=n.split(/\s+/).map(w=>w[0]).filter(Boolean).slice(0,2).join('').toUpperCase()||'?'; return `<span class="avatar" style="background:${colorFor(id)}">${esc(ini)}</span>`; }
function tbl(head, rows, cls=''){ return `<div class="tbl-wrap"><table class="${cls}"><thead><tr>${head.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')||`<tr><td colspan="${head.length}" class="muted">No entries</td></tr>`}</tbody></table></div>`; }
const ext = n => (String(n).split('.').pop()||'').toLowerCase();
const isLate = (a, t) => a.due && t && new Date(t) > new Date(a.due+'T23:59:59');

/* ---------- server calls ---------- */
async function api(method, url, body, raw){
  const opt={method, headers:{'X-CodeLab':'1'}, credentials:'same-origin'};
  if(raw){ opt.body=raw.body; Object.assign(opt.headers, raw.headers); }
  else if(body!==undefined){ opt.body=JSON.stringify(body); opt.headers['Content-Type']='application/json'; }
  let res; try{ res=await fetch(url, opt); }catch(e){ throw new Error('Cannot reach the server. Check your connection.'); }
  const data = await res.json().catch(()=>({}));
  if(!res.ok){ const err=new Error(data.error||('Request failed ('+res.status+')')); err.status=res.status; if(res.status===401 && S.auth==='ready'){ S.auth='login'; render(); } throw err; }
  return data;
}
async function refresh(){
  const d=await api('GET','/api/bootstrap');
  S.me=d.me; S.faculty=d.faculty; S.students=d.students; S.patients=d.patients; S.assignments=d.assignments; S.library=d.library; S.work=d.work; S.grades=d.grades; S.guests=d.guests||{}; S.org=d.org||null; S.orgs=d.orgs||[]; S.abstracts=d.abstracts||{}; S.team=d.team||[]; S.joincodes=d.joincodes||{};
  S.program=d.program||null; S.learner=d.learner||null; S.learners=d.learners||{};
}
async function write(fn, okMsg){
  try{ await fn(); await refresh(); if(okMsg) toast(okMsg); return true; }
  catch(e){ toast(e.message); return false; }
}

/* ---------- documents ---------- */
// base: 'files' (activity), 'keyfiles' (answer key), 'work/..' (student submission), 'grades/<sid>/f' (marked copy)
async function putFile(base, file, onProgress){
  if(!FILE_EXT.includes(ext(file.name))) throw new Error('Use a .docx, .pdf, .xlsx, .pptx or image file.');
  if(file.size>MAX_FILE) throw new Error('That file is larger than 20 MB.');
  let kind='activity', extra='';
  if(base==='keyfiles') kind='key'; else if(base.startsWith('work/')) kind='submission'; else if(base.startsWith('grades/')){ kind='marked'; extra='&student='+encodeURIComponent(base.split('/')[1]); }
  else if(base==='receipt') kind='receipt'; else if(base.startsWith('cert/')){ kind='certificate'; extra='&student='+encodeURIComponent(base.split('/')[1]); }
  onProgress?.(0.3);
  const meta=await api('POST', `/api/files?kind=${kind}${extra}`, undefined, {body:file, headers:{'X-File-Name':encodeURIComponent(file.name),'Content-Type':'application/octet-stream'}});
  onProgress?.(1);
  return meta;
}
const fileHref = f => `/api/files/${encodeURIComponent(f.fid)}`;
const fileRow = (f, extra='') => `<div class="file"><div class="row" style="gap:10px;min-width:0"><span class="doc-ico">${esc(ext(f.name).toUpperCase())}</span><div style="min-width:0"><div class="fname">${esc(f.name)}</div><div class="small muted">${fmtSize(f.size||0)}${f.at?' · '+fmtWhen(f.at):''}</div></div></div><div class="row">${extra}<a class="btn sm" href="${fileHref(f)}" download>Download</a></div></div>`;

/* ---------- EHR link (opens this site's own EHR in a new tab) ---------- */
const chartOf = a => (a?.ehr?.type==='chart' && S.patients[a.ehr.chartId]) ? a.ehr.chartId : null;
function ehrHref(a){ const c=chartOf(a); return c? `/ehr/${encodeURIComponent(c)}${a.id && S.assignments[a.id] && S.me.role==='student'? '?a='+encodeURIComponent(a.id) : ''}` : ''; }
function ehrLabel(a){ const c=chartOf(a); return c? 'CodeLab EHR · '+S.patients[c].name : ''; }

/* ---------- themes (chosen by the admin for the whole site) ---------- */
const THEMES={
  navy:{label:'Clinical Navy', note:'Navy header, blue menu', t:{'bg':'#EEF2F5','surface':'#FFFFFF','sunken':'#E3E9EE','ink':'#14222A','muted':'#586972','line':'#D3DCE3','accent':'#1565A8',
    'topbar-bg':'#0B2F4E','topbar-ink':'#FFFFFF','rail-bg':'#123A5C','rail-ink':'#DCE7F1','rail-active-bg':'#FFFFFF','rail-active-ink':'#0B2F4E','band-bg':'#DCE6EE','band-ink':'#14222A','sec-head-bg':'#3B4A57','sec-head-ink':'#FFFFFF','ehrnav-bg':'#2B3640','ehrnav-ink':'#E4EAEF','stripe':'#1565A8'}},
  charcoal:{label:'EHR Classic', note:'Charcoal menu, red accents', t:{'bg':'#F4F4F4','surface':'#FFFFFF','sunken':'#ECECEC','ink':'#222222','muted':'#666666','line':'#D9D9D9','accent':'#C62839',
    'topbar-bg':'#FFFFFF','topbar-ink':'#222222','rail-bg':'#333333','rail-ink':'#F2F2F2','rail-active-bg':'#4A4A4A','rail-active-ink':'#FFFFFF','band-bg':'#E6E6E6','band-ink':'#222222','sec-head-bg':'#555555','sec-head-ink':'#FFFFFF','ehrnav-bg':'#333333','ehrnav-ink':'#F2F2F2','stripe':'#E8573F'}},
  teal:{label:'Care Teal', note:'Teal header, light menu', t:{'bg':'#EEF5F5','surface':'#FFFFFF','sunken':'#E1ECEC','ink':'#12262A','muted':'#55696C','line':'#CFDDDE','accent':'#00798C',
    'topbar-bg':'#005F6B','topbar-ink':'#FFFFFF','rail-bg':'#E2EFF0','rail-ink':'#12363C','rail-active-bg':'#00798C','rail-active-ink':'#FFFFFF','band-bg':'#D6EAEC','band-ink':'#12262A','sec-head-bg':'#2F5D63','sec-head-ink':'#FFFFFF','ehrnav-bg':'#E2EFF0','ehrnav-ink':'#12363C','stripe':'#2BB3C0'}},
  green:{label:'Evergreen', note:'Green header, forest menu', t:{'bg':'#F0F4EF','surface':'#FFFFFF','sunken':'#E4EBE3','ink':'#18241A','muted':'#5A6A5C','line':'#D2DDD1','accent':'#2E7D32',
    'topbar-bg':'#1E4D2B','topbar-ink':'#FFFFFF','rail-bg':'#24573A','rail-ink':'#E2EEE5','rail-active-bg':'#FFFFFF','rail-active-ink':'#1E4D2B','band-bg':'#DDE9DD','band-ink':'#18241A','sec-head-bg':'#3D5A44','sec-head-ink':'#FFFFFF','ehrnav-bg':'#2C3B30','ehrnav-ink':'#E2EEE5','stripe':'#6DBE45'}},
  plum:{label:'Plum Clinic', note:'Plum header, soft menu', t:{'bg':'#F4F1F6','surface':'#FFFFFF','sunken':'#EAE4EE','ink':'#231A2A','muted':'#665C6E','line':'#DCD3E2','accent':'#6A3D8F',
    'topbar-bg':'#4A2C5E','topbar-ink':'#FFFFFF','rail-bg':'#EDE5F2','rail-ink':'#3A2549','rail-active-bg':'#6A3D8F','rail-active-ink':'#FFFFFF','band-bg':'#E8DFEE','band-ink':'#231A2A','sec-head-bg':'#4F3D5C','sec-head-ink':'#FFFFFF','ehrnav-bg':'#EDE5F2','ehrnav-ink':'#3A2549','stripe':'#B57EDC'}},
  night:{label:'Night Shift', note:'Dark mode for low light', dark:true, t:{'bg':'#0F151B','surface':'#17212A','sunken':'#1E2A34','ink':'#E3EAEF','muted':'#94A5B0','line':'#2A3843','accent':'#6AB0EA',
    'topbar-bg':'#090E13','topbar-ink':'#E3EAEF','rail-bg':'#111A22','rail-ink':'#C9D5DE','rail-active-bg':'#1F3B55','rail-active-ink':'#FFFFFF','band-bg':'#1E2A34','band-ink':'#E3EAEF','sec-head-bg':'#26333E','sec-head-ink':'#E3EAEF','ehrnav-bg':'#111A22','ehrnav-ink':'#C9D5DE','stripe':'#3B82C4',
    'ok':'#6CC892','ok-soft':'#173326','warn':'#E9AE5B','warn-soft':'#382A14','bad':'#F2877A','bad-soft':'#3D1D1A'}},
};
const DEFAULT_SITE={theme:'navy', custom:{}, siteName:'CodeLab', institution:'ICD-10 coding practicum for Health Information Management', logo:'', showName:true, logoTile:true, topbarHeight:60, stripeWidth:3};
S.site={...DEFAULT_SITE};
function hexRgb(h){ const m=/^#?([0-9a-f]{6})$/i.exec(h||''); if(!m) return null; const n=parseInt(m[1],16); return [n>>16&255,n>>8&255,n&255]; }
function lum(h){ const c=hexRgb(h); if(!c) return 1; const [r,g,b]=c.map(v=>{ v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4); }); return 0.2126*r+0.7152*g+0.0722*b; }
function mix(h, w, t){ const a=hexRgb(h), b=hexRgb(w); if(!a||!b) return h; return '#'+a.map((v,i)=>Math.round(v*(1-t)+b[i]*t).toString(16).padStart(2,'0')).join(''); }
const inkOn = bg => lum(bg)>0.45? '#14222A' : '#FFFFFF';
const LIGHT_STATUS={'ok':'#2C7A4B','ok-soft':'#E1F1E7','warn':'#9A5800','warn-soft':'#FBEEDB','bad':'#B42318','bad-soft':'#FBE4E1'};
function themeTokens(site){
  const base=THEMES[site.theme]||THEMES.navy; const t={...LIGHT_STATUS, ...base.t}; const c=site.custom||{};
  if(hexRgb(c.accent)){ t.accent=c.accent; t.stripe=c.accent; }
  if(hexRgb(c.topbar)){ t['topbar-bg']=c.topbar; t['topbar-ink']=inkOn(c.topbar); }
  if(hexRgb(c.rail)){ t['rail-bg']=c.rail; t['rail-ink']=inkOn(c.rail)==='#FFFFFF'? '#EEF2F5':'#1B2A33';
    if(lum(c.rail)>0.45){ t['rail-active-bg']=t.accent; t['rail-active-ink']=inkOn(t.accent); } else { t['rail-active-bg']='#FFFFFF'; t['rail-active-ink']=c.rail; } }
  if(hexRgb(c.ehrnav)){ t['ehrnav-bg']=c.ehrnav; t['ehrnav-ink']=inkOn(c.ehrnav)==='#FFFFFF'? '#EEF2F5':'#1B2A33'; }
  t['accent-ink']=inkOn(t.accent);
  t['accent-soft']= base.dark? mix(t.accent,'#000000',0.7) : mix(t.accent,'#FFFFFF',0.86);
  return {t, dark:!!base.dark};
}
function applyTheme(site){
  const {t,dark}=themeTokens(site); const r=document.documentElement;
  for(const [k,v] of Object.entries(t)) r.style.setProperty('--'+k, v);
  r.style.colorScheme = dark? 'dark' : 'light';
  const meta=document.querySelector('meta[name=theme-color]'); if(meta) meta.content=t['topbar-bg'];
  r.style.setProperty('--topbar-h', (+site.topbarHeight||60)+'px'); r.style.setProperty('--stripe-w', (site.stripeWidth??3)+'px');
  const ico=document.querySelector('link[rel=icon]'); if(ico){ ico.href=site.logo||'/favicon.svg'; ico.type=site.logo? site.logo.slice(5,site.logo.indexOf(';')) : 'image/svg+xml'; }
  document.title = (site.siteName||'CodeLab')+' ICD-10 Coding Practicum';
}
async function loadSite(slug){ try{ const s=await api('GET','/api/settings'+(slug?'?org='+encodeURIComponent(slug):'')); S.site={...DEFAULT_SITE, ...s, custom:{...(s.custom||{})}}; }catch(_){ } applyTheme(S.site); }

/* ---------- patient model ---------- */
const OV_DEFAULT={info:true,encounters:true,alerts:true,prevention:true,problems:true,vitals:true,labs:true,orders:true,meds:true,notes:true,advance:false,principal:false};
/* chronological key for MM/DD/YYYY [HH:MM] or YYYY-MM-DD dates; unknown formats sort last */
function timeKey(v){ const s=String(v||''); let m=s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/); if(m) return m[3]+m[1]+m[2]+(m[4]||'00').padStart(2,'0')+(m[5]||'00');
  m=s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/); if(m) return m[1]+m[2]+m[3]+(m[4]||'00')+(m[5]||'00'); return '~'+s; }
function sortByTime(list,k){ return list.map((x,i)=>[timeKey(x[k]),i,x]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:a[1]-b[1]).map(r=>r[2]); }
function P(p){
  if(!p) return null; const x=clone(p);
  x.facility=x.facility||'General Hospital';
  x.allergies=(x.allergies||[]).map(a=> typeof a==='string'? {subject:a,date:'',status:'Active',type:'Adverse Reaction/Allergy'} : a);
  x.problems=(x.problems||[]).map(a=> typeof a==='string'? {priority:'',status:'Active',desc:a,immediacy:'',onset:'',provider:''} : a);
  x.meds=(x.meds||[]).map(a=> typeof a==='string'? {category:'Scheduled Meds',drug:a,route:'',status:'Active',frequency:'',when:''} : a);
  ['vitals','labs','orders','encounters','insurance','prevention','docs'].forEach(k=>x[k]=x[k]||[]);
  if(!x.insurance.length && x.payer) x.insurance=[{priority:'Primary',plan:x.payer,number:'',active:'Y'}];
  x.docs=x.docs.map(d=>({location:x.facility,...d}));
  x.docs=sortByTime(x.docs,'date'); x.vitals=sortByTime(x.vitals,'t');
  x.overview={...OV_DEFAULT, ...(x.overview||{})}; x.advanceDirective=x.advanceDirective||''; x.principalDx=x.principalDx||'';
  x.kind=x.kind||'patient'; x.reports=(x.reports||[]).map(r=>({title:'',note:'',table:'',columns:[],rows:[],...r}));
  return x;
}
const TABLES={
  allergies:{label:'Allergies / alerts', cols:['subject','date','status','type'], head:'Subject | Date & time | Status | Alert type'},
  problems:{label:'Problem list', cols:['priority','status','desc','immediacy','onset','provider'], head:'Priority | Status | Description | Immediacy | Date of onset | Provider'},
  vitals:{label:'Vital signs', cols:['t','temp','hr','rr','bp','spo2','pain'], head:'Date & time | Temperature | Pulse | Respiration | Blood pressure | Pulse ox % | Pain'},
  labs:{label:'Labs', cols:['date','panel','name','value','unit','flag','ref'], head:'Date & time | Panel | Test | Value | Unit | Flag (H/L) | Reference range'},
  orders:{label:'Orders', cols:['category','item','frequency','status','when'], head:'Category | Order item | Frequency | Status | When'},
  meds:{label:'Medications', cols:['category','drug','route','status','frequency','when'], head:'Category | Drug & dose | Route | Status | Frequency | When'},
  encounters:{label:'Encounters', cols:['date','location','provider','status','description'], head:'Check-in | Location | Provider | Status | Description'},
  insurance:{label:'Insurance', cols:['priority','plan','number','active'], head:'Priority | Plan name | Plan number | Active'},
  prevention:{label:'Prevention', cols:['date','subject','details','type'], head:'Date & time | Subject | Details | Prevention type'},
};
const toRowsText=(rows,cols)=>rows.map(r=>cols.map(c=>r[c]??'').join(' | ')).join('\n');
const fromRowsText=(t,cols)=>lines(t).map(l=>{ const parts=l.split('|').map(s=>s.trim()); const o={}; cols.forEach((c,i)=>o[c]=parts[i]||''); return o; });

/* ---------- roles ---------- */
function role(){ return S.me.role; }
function realRole(){ return S.me.role; }
function mySection(){ return S.me.section || ''; }
function students(){ return Object.values(S.students).filter(u=>u.role==='student'); }
function facultyList(){ return Object.values(S.faculty).filter(u=>u.role==='faculty'); }
function joinPanel(){
  const codes=Object.entries(S.joincodes||{}).sort((a,b)=>(b[1].createdAt||0)-(a[1].createdAt||0));
  const st=j=> !j.active? '<span class="pill">Off</span>' : j.expiresAt && j.expiresAt<=Date.now()? '<span class="pill bad">Expired</span>' : j.maxUses && j.uses>=j.maxUses? '<span class="pill warn">Full</span>' : '<span class="pill ok">Open</span>';
  return `<section class="panel panel-pad stack"><div><h2>Class codes: let students create their own accounts</h2>
    <p class="small muted">Create a code for a class and share the link or the code. Students open <span class="mono">${esc(location.host)}/join</span>, enter the code and choose their own password. They are placed in the section you choose and count toward your plan's student limit. Turn a code off when the class has joined.</p></div>
    <form class="row" data-form="new-joincode" style="align-items:flex-end">
      <label class="field"><span>Section</span><input type="text" id="jc-sec" name="section" list="sec-list" placeholder="e.g. HIM-301 A" style="width:170px"></label>
      <label class="field"><span>Label (optional)</span><input type="text" id="jc-label" name="label" placeholder="e.g. Fall 2026 coding lab" style="width:200px"></label>
      <label class="field"><span>Code works for</span><select id="jc-days" name="days">${[[7,'7 days'],[14,'14 days'],[30,'30 days'],[90,'90 days'],[0,'No end date']].map(([v,l])=>`<option value="${v}" ${v===14?'selected':''}>${l}</option>`).join('')}</select></label>
      <label class="field"><span>Maximum students</span><input type="number" id="jc-max" name="maxUses" min="0" placeholder="No limit" style="width:120px"></label>
      <button class="btn primary" type="submit">Create class code</button></form>
    ${codes.length? tbl(['Code','Section','Label','Joined','Status','Ends',''], codes.map(([c,j])=>`<tr class="${S.acct.newCode===c?'hl':''}"><td><b class="mono join-code">${esc(c)}</b></td><td>${esc(j.section||'—')}</td><td>${esc(j.label||'')}</td><td class="num">${j.uses||0}${j.maxUses?' / '+j.maxUses:''}</td><td>${st(j)}</td><td class="small">${j.expiresAt? fmtWhen(j.expiresAt) : 'No end date'}</td>
      <td><div class="row" style="flex-wrap:nowrap;gap:6px"><button class="btn sm" data-act="copy-join" data-v="${esc(c)}">Copy link</button><button class="btn sm" data-act="join-print" data-v="${esc(c)}">Print</button>${j.active?`<button class="btn sm" data-act="join-off" data-v="${esc(c)}">Turn off</button>`:`<button class="btn sm" data-act="join-on" data-v="${esc(c)}" ${j.expiresAt&&j.expiresAt<=Date.now()?'data-exp="1"':''}>Turn on</button>`}<button class="btn sm danger" data-act="join-del" data-v="${esc(c)}">Delete</button></div></td></tr>`))
      : '<p class="hint">No class codes yet.</p>'}
    ${S.acct.printCode && S.joincodes?.[S.acct.printCode]? `<div class="join-print"><h1>Join ${esc(S.org?.name||'')} on ${esc(S.site.siteName||'CodeLab')}</h1><p>1. Go to <b>${esc(location.host)}/join</b></p><p>2. Enter the class code</p><div class="join-big">${esc(S.acct.printCode)}</div><p>3. Enter your name, college email and a password you choose.</p><p class="small">Section: ${esc(S.joincodes[S.acct.printCode].section||'—')}</p></div>`:''}
  </section>`;
}
async function joinCheck(code){
  S.join=S.join||{}; S.join.code=String(code||'').toUpperCase().replace(/[^A-Z0-9]/g,'').replace(/^(.{4})(.{4})$/,'$1-$2'); S.join.info=null; S.join.err='';
  if(!S.join.code){ S.join.err='Enter the class code from your faculty.'; render(); return; }
  try{ S.join.info=await api('GET','/api/join/'+encodeURIComponent(S.join.code)); if(!S.join.info.ok) S.join.err=S.join.info.why; }catch(e){ S.join.err=e.message; }
  render(); setTimeout(()=>document.getElementById(S.join.info?.ok?'jn-name':'jn-code')?.focus(),0);
}
function teams(){ return [...new Set(students().map(s=>s.team).filter(Boolean))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})); }
function sections(){ return [...new Set(students().map(s=>s.section).filter(Boolean))].sort(); }
function targetStudents(a){ return students().filter(s=> s.active && (a.target==='all' || s.section===a.target)); }
function sub(sid, aid){ return S.work[sid]?.[aid]; }
function grade(sid, aid){ return S.grades[sid]?.[aid]; }
function myAssignments(){ return Object.entries(S.assignments).map(([id,a])=>({id,...a})).sort((x,y)=>(x.due||'').localeCompare(y.due||'')); }
function allAssignments(){ return Object.entries(S.assignments).map(([id,a])=>({id,...a})).sort((x,y)=>(y.createdAt||0)-(x.createdAt||0)); }
function studentStatus(sid, a){
  const s=sub(sid,a.id), g=grade(sid,a.id);
  if(g && S.program) return passed(g)? {k:'graded', label:`Passed ${pct(g)}%`, cls:'ok'} : {k:'resubmit', label:`Not passed (${pct(g)}%): resubmit`, cls:'bad'};
  if(g) return {k:'graded', label:`Graded ${g.score}/${a.points||100}`, cls:'ok'};
  if(s?.status==='submitted') return {k:'submitted', label: isLate(a,s.submittedAt)?'Submitted late':'Submitted', cls: isLate(a,s.submittedAt)?'warn':'info'};
  if(a.due && a.due < TODAY) return {k:'overdue', label:'Missing', cls:'bad'};
  return {k:'new', label:'Not submitted', cls:''};
}

/* ---------- data layer ---------- */
const API = {
  saveAssignment:(id,a)=>write(()=>api('PUT','/api/assignments/'+encodeURIComponent(id),a)),
  deleteAssignment:(id)=>write(()=>api('DELETE','/api/assignments/'+encodeURIComponent(id))),
  saveTemplate:(id,t)=>write(()=>api('PUT','/api/library/'+encodeURIComponent(id),t)),
  deleteTemplate:(id)=>write(()=>api('DELETE','/api/library/'+encodeURIComponent(id))),
  savePatient:(id,p)=>write(()=>api('PUT','/api/patients/'+encodeURIComponent(id),p)),
  deletePatient:(id)=>write(()=>api('DELETE','/api/patients/'+encodeURIComponent(id))),
  saveWork:(aid,s)=>write(()=>api('PUT','/api/work/'+encodeURIComponent(aid),{fileId:s.file.fid, note:s.note})),
  saveGrade:(sid,aid,g)=>write(()=>api('PUT',`/api/grades/${encodeURIComponent(aid)}/${encodeURIComponent(sid)}`,{score:g.score, feedback:g.feedback, fileId:g.file?.fid, applyTeam:!!g.applyTeam})),
};

/* ---------- render scheduling ---------- */
let pending=false;
function typing(){ const a=document.activeElement; return a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && !['checkbox','radio','file'].includes(a.type) && document.getElementById('main').contains(a); }
function scheduleRender(){ if(typing() || S.busy){ pending=true; return; } render(); }
document.addEventListener('focusout', e=>{ const rr=e.target?.dataset?.rerender!=null; setTimeout(()=>{ if(typing()) return; if(rr || pending){ pending=false; render(); } }, 0); });

/* ---------- navigation ---------- */
function navFor(r){
  const n=[];
  if(r==='owner') return [['colleges','Colleges',(S.orgs||[]).length],['appearance','Platform appearance'],['account','My account']];
  if(r==='admin') n.push(['overview','Overview'],['people','Faculty',facultyList().length]);
  if((r==='admin'||r==='faculty') && S.program) n.push(['registrations','Registrations',students().filter(u=>u.access==='pending' && S.learners?.[u.id]?.receipt).length],['certificates','Certificates',students().filter(u=>u.access==='approved' && progressOf(u.id).eligible && !S.learners?.[u.id]?.certificate).length]);
  if(r==='admin' && S.program) n.push(['program','Program settings']);
  if(r==='admin'||r==='faculty') n.push(['students','Students',students().length],['library','Assignment library',Object.keys(S.library).length],['assignments','Assigned work',Object.keys(S.assignments).length],['cases','EHR patient charts',Object.keys(S.patients).length],['codes','ICD-10-CM code book']);
  if(r==='student' && S.program){ if(S.me.access==='pending'||S.me.access==='rejected') n.push(['registration','Registration & payment']);
    else n.push(['my','My practicals',myAssignments().length],['progress','Progress & certificate'],['codes','ICD-10-CM code book'],['registration','Registration & payment']); }
  else if(r==='student') n.push(['my','My assignments',myAssignments().length],['grades','My grades'],['codes','ICD-10-CM code book']);
  if(r==='guest') n.push(['library','Activity library',Object.keys(S.library).length],['cases','EHR patient charts',Object.keys(S.patients).length],['codes','ICD-10-CM code book']);
  if(r==='admin') n.push(['guests','Guests',Object.keys(S.guests||{}).length],['appearance','Appearance']);
  n.push(['account','My account']);
  return n;
}
function go(name, p={}){ S.route={name, p}; S.form=null; S.upload=null; S.chartTab='overview'; if(name==='people'||name==='students'||name==='guests') S.acct.created=null; render(); window.scrollTo(0,0); if(S.auth==='ready') refresh().then(()=>scheduleRender()).catch(()=>{}); }
function isSection(k){
  const n=S.route.name;
  if(n==='builder') return k===(S.form?.kind==='template'?'library':'assignments');
  const map={library:['library','assign'], assignments:['assignments','review','grade'], cases:['cases','case-edit','case-view'], my:['my','work'], grades:['grades'], overview:['overview'], people:['people'], students:['students'], account:['account'], appearance:['appearance'], guests:['guests'], colleges:['colleges','college'], codes:['codes']};
  return (map[k]||[k]).includes(n);
}
const MARK_SVG='<svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true"><path d="M7 5.5h13.5a4 4 0 0 1 4 4V27H11a4 4 0 0 1-4-4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M7 23a4 4 0 0 1 4-4h13.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12.5 10.5l-2 2.5 2 2.5M18.5 10.5l2 2.5-2 2.5M16.3 9.8l-1.6 6.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function brandSrc(){ return (S.route.name==='appearance' && S.form && S.form.theme!==undefined)? S.form : S.site; }
function brandHTML(sub){ const src=brandSrc(); const n=src.siteName||'CodeLab';
  const mark= src.logo? `<span class="brand-logo ${src.logoTile===false?'':'tile'}"><img src="${esc(src.logo)}" alt="${esc(n)} logo"></span>` : `<span class="brand-mark">${MARK_SVG}</span>`;
  const text= src.showName===false && src.logo? '' : `<div class="brand-text"><b>${esc(n)}</b>${(sub??src.institution)?`<span>${esc(sub??src.institution)}</span>`:''}</div>`;
  return `<div class="brand">${mark}${text}</div>`; }
function whoHTML(withSignOut=true){ return `<div class="who">${avatar(S.me.id)}<div class="who-text"><b>${esc(S.me.name)}</b><span>${esc(ROLE_LABEL[role()]||'')}</span></div>${withSignOut?'<button class="btn sm signout" data-act="logout">Sign out</button>':''}</div>`; }
const ROLE_LABEL={owner:'Owner',admin:'Admin',faculty:'Faculty',student:'Student',guest:'Guest'};
const isGuest=()=>S.me.role==='guest';
const fmtEnd=t=>new Date(t).toLocaleString(undefined,{weekday:'short',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
function daysLeft(t){ const ms=t-Date.now(); if(ms<=0) return 'ended'; const d=Math.floor(ms/864e5), h=Math.floor(ms%864e5/36e5); return d? `${d} day${d>1?'s':''}${h?` ${h} h`:''} left` : `${Math.max(1,h)} hour${h>1?'s':''} left`; }
function guestStatus(g){ if(!g.active) return '<span class="pill bad">Deactivated</span>'; if(g.expiresAt && g.expiresAt<=Date.now()) return '<span class="pill bad">Expired</span>'; return g.mustChange? '<span class="pill warn">Not signed in yet</span>' : '<span class="pill ok">Active</span>'; }
function renderTop(){
  const top=document.getElementById('top'), rail=document.getElementById('rail'), shell=document.querySelector('.shell');
  document.getElementById('banner').innerHTML='';
  if(S.auth==='login' || S.auth==='setup'){ top.innerHTML=''; top.hidden=true; rail.hidden=true; shell.classList.add('solo'); return; }
  top.hidden=false;
  if(S.auth!=='ready' || S.me.mustChange){
    top.innerHTML=`${brandHTML()}${S.auth==='ready'?'<button class="btn sm" data-act="logout">Sign out</button>':''}`;
    rail.hidden=true; shell.classList.add('solo'); return;
  }
  top.hidden=false;
  if(S.codesOnly){
    top.innerHTML=`${brandHTML('ICD-10-CM code book · Tabular List')}${whoHTML(false)}`; top.classList.add('ehr-top');
    rail.hidden=true; shell.classList.add('solo'); return;
  }
  if(S.ehrOnly){
    top.innerHTML=''; top.hidden=true;
    rail.hidden=true; shell.classList.add('solo'); return;
  }
  rail.hidden=false; shell.classList.remove('solo');
  const r=role();
  if(r==='guest' && S.me.expiresAt) document.getElementById('banner').innerHTML=`<div class="guest-banner"><b>Guest preview</b> · read-only access to the activity library and EHR charts · ends ${esc(fmtEnd(S.me.expiresAt))} (${esc(daysLeft(S.me.expiresAt))})</div>`;
  const og=S.org; if(og){ const bn=document.getElementById('banner');
    if(og.readOnly) bn.insertAdjacentHTML('beforeend',`<div class="org-banner bad"><b>Subscription ended ${esc(fmtDay(og.expiresAt))}.</b> CodeLab is read-only for ${esc(og.name)}: you can sign in and view, but nothing can be added or changed until the subscription is renewed.${r==='admin'?' Contact your CodeLab provider to renew.':' Contact your college administrator.'}</div>`);
    else if(r==='admin' && og.expiresAt && og.expiresAt-Date.now()<30*864e5) bn.insertAdjacentHTML('beforeend',`<div class="org-banner warn"><b>Subscription ends ${esc(fmtDay(og.expiresAt))}</b> (in ${Math.max(1,Math.ceil((og.expiresAt-Date.now())/864e5))} days). Contact your CodeLab provider to renew so your faculty and students can keep working.</div>`); }
  top.innerHTML=`${brandHTML()}${whoHTML()}`;
  rail.innerHTML=`<div class="label">${ROLE_LABEL[r]}</div>`+navFor(r).map(([k,l,c])=>`<button data-act="go" data-v="${k}" aria-current="${isSection(k)?'page':'false'}"><span>${esc(l)}</span>${c!=null?`<span class="count">${c}</span>`:''}</button>`).join('');
}
/* ---- guided tour of the EHR window ---- */
const TOUR=[
  ['.ew-story','Storyboard','Who the patient is and the key facts for this encounter: MRN, allergies, code status, encounter type, admission and discharge, attending and payer. It stays on screen whatever you open.'],
  ['.ew-acts','Activities','Each activity is one part of the record. Summary gives the overview; Chart Review lists encounters, notes, labs, imaging and procedures with a preview pane; Results Review and Flowsheets show trends over time.'],
  ['#chart-q','Search chart','Type a word, name or date (for example "potassium" or 09/21) to find it anywhere in this record, including inside notes.'],
  ['.ew-acts [data-v="notes"]','Notes','The provider documentation you code from: H&P, progress notes, operative reports and the discharge summary. Unsigned notes are marked.'],
  ['.ew-acts [data-v="coding"]','Coding','Enter your ICD-10-CM and ICD-10-PCS codes here, in sequence, with POA indicators for inpatients. Edits check every code against the code book, and your work is saved to your assignment.'],
  ['.ew-acts [data-v="codebook"]','Code Book','The ICD-10-CM Tabular List with all its instructional notes. It also opens beside the Coding activity.'],
  ['#tour-help','Help','Open this tour again at any time.']];
function startTour(){ S.chartTab='overview'; S.chartQ=''; if(S.ew) S.ew.act='summary'; S.tour=0; render(); }
function endTour(){ S.tour=null; document.getElementById('tour')?.remove(); try{ localStorage.setItem('cdl_tour_v2','1'); }catch(_){} }
function drawTour(){
  document.getElementById('tour')?.remove(); if(S.tour==null) return;
  let i=S.tour, el=null; while(i<TOUR.length && !(el=document.querySelector(TOUR[i][0]))) i++;
  if(!el){ endTour(); return; } S.tour=i; const [,title,text]=TOUR[i];
  window.scrollTo(0,0); if(el.getBoundingClientRect().top>innerHeight-140) el.scrollIntoView({block:'center'});
  const r=el.getBoundingClientRect(), pad=6, vw=innerWidth, vh=innerHeight;
  const top=Math.max(8,r.top-pad), h=Math.min(r.height+pad*2, vh-top-8);
  const card={w:Math.min(340,vw-24)}; let cy=top+h+12; if(cy+190>vh) cy=Math.max(12,top-200); let cx=Math.min(Math.max(12,r.left), vw-card.w-12);
  if(r.height>vh*0.5 && r.width<vw*0.4){ cx=Math.min(r.right+14, vw-card.w-12); cy=Math.max(12,Math.min(r.top+20, vh-220)); }
  const d=document.createElement('div'); d.id='tour'; d.setAttribute('role','dialog'); d.setAttribute('aria-label','EHR tour');
  d.innerHTML=`<div class="tour-spot" style="top:${top}px;left:${Math.max(4,r.left-pad)}px;width:${Math.min(r.width+pad*2,vw-8)}px;height:${h}px"></div>
    <div class="tour-card" style="top:${cy}px;left:${cx}px;width:${card.w}px"><span class="small muted">${i+1} of ${TOUR.length}</span><h3>${esc(title)}</h3><p>${esc(text)}</p>
    <div class="row" style="justify-content:space-between"><button class="btn sm" data-act="tour-end">Skip tour</button><div class="row">${i?'<button class="btn sm" data-act="tour-prev">Back</button>':''}<button class="btn sm primary" data-act="tour-next">${i===TOUR.length-1?'Done':'Next'}</button></div></div></div>`;
  document.body.appendChild(d); d.querySelector('[data-act="tour-next"]').focus();
}
addEventListener('resize',()=>{ if(S.tour!=null) drawTour(); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape' && S.tour!=null) endTour(); });
function render(){
  renderTop();
  const m=document.getElementById('main');
  if(S.auth==='loading'){ m.innerHTML='<div class="empty">Loading…</div>'; return; }
  m.classList.toggle('lp-window', S.auth==='login' || S.auth==='setup');
  if(S.auth==='setup'){ m.innerHTML=VIEWS.setup(); return; }
  if(S.auth==='login' && S.joinOnly){ m.innerHTML=VIEWS.join(); return; }
  if(S.auth==='login' && S.registerOnly){ m.innerHTML=VIEWS.register(); return; }
  if(S.auth==='login'){ m.innerHTML= S.orgSlug? (S.site.orgFound===false? VIEWS.collegeMissing() : VIEWS.collegeLogin()) : VIEWS.landing(); return; }
  if(S.me.mustChange){ m.innerHTML=VIEWS.forcePw(); return; }
  m.classList.toggle('ehr-window', !!(S.ehrOnly||S.codesOnly)); m.classList.toggle('ew-window', !!S.ehrOnly);
  if(S.codesOnly){ m.innerHTML=`<section class="panel cb-window">${codeBookHTML('window')}</section>`; return; }
  if(S.ehrOnly){ const p=S.patients[S.ehrOnly]; const keep=document.activeElement?.id, pos=document.activeElement?.selectionStart, sc=document.querySelector('.ew-content')?.scrollTop;
    m.innerHTML = p? ehrWorkstationHTML(p) : `<div class="panel empty"><b>EHR record not found</b><span>The link may be out of date. Ask your faculty for the current assignment.</span></div>`;
    if(sc) { const c=document.querySelector('.ew-content'); if(c) c.scrollTop=sc; }
    if(keep && /^(chart-q|cb-q-|ew-add-)/.test(keep)){ const n=document.getElementById(keep); if(n){ n.focus(); try{ n.setSelectionRange(pos,pos); }catch(_){} } }
    if(p && p.kind!=='dataset' && S.tour===undefined){ let seen=false; try{ seen=!!localStorage.getItem('cdl_tour_v2'); }catch(_){ seen=true; } S.tour=seen? null : 0; }
    if(S.tour!=null) requestAnimationFrame(drawTour); return; }
  if(!S.route.name || !navFor(role()).some(([k])=>isSection(k))) S.route={name:navFor(role())[0][0], p:{}};
  const v=VIEWS[S.route.name]; m.innerHTML = v? v(S.route.p) : '';
}
const VIEWS={};
VIEWS.codes=()=>`<div class="page-head"><div><span class="label">Reference</span><h1>ICD-10-CM code book</h1><p class="muted">The official Tabular List with its instructional notes. Search by code or by words, open a code to see Excludes, Code first and Use additional code notes, and check 7th characters.</p></div><a class="btn" href="/codes${S.cb.sel?'/'+encodeURIComponent(S.cb.sel):''}" target="_blank" rel="noopener">Open in new tab ↗</a></div>
  <section class="panel cb-page-wrap">${codeBookHTML('page')}</section>`;

/* ================= sign in ================= */
const authCard=(title, sub, body)=>`<section class="auth panel panel-pad stack"><div class="stack" style="gap:4px"><h1>${title}</h1><p class="muted">${sub}</p></div>${body}</section>`;
VIEWS.login=()=>(S.orgSlug && S.site.orgFound===false? `<div class="panel empty" style="max-width:520px;margin:24px auto"><b>College not found</b><span>The address /c/${esc(S.orgSlug)} does not match a college on CodeLab. Check the link your college sent you, or sign in below.</span></div>` : '')+authCard(S.site.orgName? `Sign in to ${esc(S.site.orgName)}` : 'Sign in','Use the email and password your college gave you.',`
  <form class="stack" data-form="login">
    <label class="field"><span>Email</span><input type="text" id="li-email" name="email" autocomplete="username" inputmode="email" required></label>
    <label class="field"><span>Password</span><input type="password" id="li-pw" name="password" autocomplete="current-password" required></label>
    <div class="row"><button class="btn primary" type="submit">Sign in</button></div>
    <p class="hint">Forgot your password? Ask your faculty (students) or the admin (faculty) to reset it.</p>
  </form>`);
VIEWS.setup=()=>authCard('Set up CodeLab','Create the owner account. You will add colleges, each with its own admin, after signing in.',`
  <form class="stack" data-form="setup">
    <label class="field"><span>Your name</span><input type="text" id="su-name" name="name" required></label>
    <label class="field"><span>Email</span><input type="text" id="su-email" name="email" autocomplete="username" inputmode="email" required></label>
    <label class="field"><span>Password (at least 8 characters)</span><input type="password" id="su-pw" name="password" autocomplete="new-password" required></label>
    <div class="row"><button class="btn primary" type="submit">Create owner account</button></div>
  </form>`);
const pwForm=(btn)=>`<form class="stack" data-form="password">
    <label class="field"><span>Current password</span><input type="password" id="pw-cur" name="current" autocomplete="current-password" required></label>
    <label class="field"><span>New password (at least 8 characters)</span><input type="password" id="pw-new" name="next" autocomplete="new-password" required></label>
    <label class="field"><span>Repeat new password</span><input type="password" id="pw-rep" name="repeat" autocomplete="new-password" required></label>
    <div class="row"><button class="btn primary" type="submit">${btn}</button></div></form>`;
VIEWS.forcePw=()=>authCard(`Welcome, ${esc(S.me.name)}`,'You signed in with a temporary password. Choose your own password to continue.', pwForm('Save password and continue'));
VIEWS.account=()=>`
  <div class="page-head"><div><span class="label">${ROLE_LABEL[role()]}</span><h1>My account</h1></div></div>
  <section class="panel panel-pad stack" style="max-width:640px"><dl class="kv" style="padding:0"><dt>Name</dt><dd>${esc(S.me.name)}</dd><dt>Email</dt><dd>${esc(S.me.email)}</dd><dt>Role</dt><dd>${ROLE_LABEL[role()]}</dd>${role()==='student'?`<dt>Section</dt><dd>${esc(S.me.section||'Not assigned')}</dd>`:''}${S.me.expiresAt?`<dt>Organization</dt><dd>${esc(S.me.section||'—')}</dd><dt>Access ends</dt><dd>${esc(fmtEnd(S.me.expiresAt))} (${esc(daysLeft(S.me.expiresAt))})</dd>`:''}</dl></section>
  <section class="panel panel-pad stack" style="max-width:640px"><h2>Change password</h2>${pwForm('Change password')}</section>`;

/* ================= accounts ================= */
function credsBox(){
  const c=S.acct.created; if(!c || !c.length) return '';
  const ok=c.filter(r=>r.ok!==false), bad=c.filter(r=>r.ok===false);
  return `<section class="panel panel-pad stack creds"><div class="row" style="justify-content:space-between"><h2>Sign-in details to share</h2><div class="row"><button class="btn sm" data-act="dl-creds">Download as CSV</button><button class="btn sm" data-act="close-creds">Done</button></div></div>
    <p class="hint">These temporary passwords are shown only now. Each person will be asked to choose their own password at first sign-in. Share them privately.</p>
    ${ok.length? (ok.some(r=>r.user.expiresAt)
      ? tbl(['Name','Email','Organization','Access ends','Temporary password'], ok.map(r=>`<tr><td>${esc(r.user.name)}</td><td>${esc(r.user.email)}</td><td>${esc(r.user.section||'—')}</td><td>${r.user.expiresAt?esc(fmtEnd(r.user.expiresAt)):'—'}</td><td class="mono"><b>${esc(r.tempPassword)}</b></td></tr>`))
      : tbl(['Name','Email','Section','Temporary password'], ok.map(r=>`<tr><td>${esc(r.user.name)}</td><td>${esc(r.user.email)}</td><td>${esc(r.user.section||'—')}</td><td class="mono"><b>${esc(r.tempPassword)}</b></td></tr>`))):''}
    ${bad.length? `<p class="flag-H small">${bad.length} not created:</p>`+tbl(['Name','Email','Problem'], bad.map(r=>`<tr><td>${esc(r.name||'')}</td><td>${esc(r.email||'')}</td><td>${esc(r.error)}</td></tr>`)):''}
  </section>`;
}
const signInUrl=(slug=S.org?.slug)=>location.origin+(slug? '/c/'+slug : '/');
VIEWS.people=()=>{
  const fac=facultyList().sort((a,b)=>a.name.localeCompare(b.name));
  return `
  <div class="page-head"><div><span class="label">Admin</span><h1>Faculty</h1><p class="muted">Only the admin can create faculty accounts. Faculty then create their own students' accounts.</p></div><button class="btn" data-act="go" data-v="students">View students</button></div>
  ${credsBox()}
  <section class="panel panel-pad stack"><h2>Add a faculty member</h2>
    <form class="grid2" data-form="add-faculty" style="align-items:end">
      <label class="field"><span>Full name</span><input type="text" id="af-name" name="name" required></label>
      <label class="field"><span>Email (used to sign in)</span><input type="text" id="af-email" name="email" inputmode="email" required></label>
      <div><button class="btn primary" type="submit">Create faculty account</button></div>
    </form>
    <p class="hint">CodeLab creates a temporary password for you to share. Sign-in address: <span class="mono">${esc(signInUrl())}</span></p></section>
  <section class="panel"><div class="panel-pad" style="padding-bottom:6px"><h2>Faculty <span class="count">${fac.length}</span></h2></div>
    ${fac.length? tbl(['Name','Email','Status','Students created',''], fac.map(f=>`<tr><td><div class="person">${avatar(f.id)}<span>${esc(f.name)}</span></div></td><td>${esc(f.email)}</td>
      <td>${f.active? (f.mustChange?'<span class="pill warn">Not signed in yet</span>':'<span class="pill ok">Active</span>') : '<span class="pill bad">Deactivated</span>'}</td>
      <td class="num">${students().filter(s=>s.createdBy===f.id).length}</td>
      <td><div class="row" style="flex-wrap:nowrap"><button class="btn sm" data-act="reset-pw" data-v="${esc(f.id)}">Reset password</button><button class="btn sm" data-act="toggle-active" data-v="${esc(f.id)}">${f.active?'Deactivate':'Reactivate'}</button><button class="btn sm danger" data-act="rm-user" data-v="${esc(f.id)}">Delete</button></div></td></tr>`))
      : `<div class="empty">No faculty yet. Use the form above to create the first faculty account.</div>`}</section>`;
};
VIEWS.students=()=>{
  const isAdmin=role()==='admin'; const mine=S.acct.mine && !isAdmin; const q=S.acct.q.toLowerCase();
  const all=students().filter(s=>(!mine || s.createdBy===S.me.id || S.joincodes?.[String(s.createdBy||'').slice(5)]?.createdBy===S.me.id) && (!q || (s.name+' '+s.email+' '+s.section).toLowerCase().includes(q))).sort((a,b)=>((a.section||'~')+a.name).localeCompare((b.section||'~')+b.name));
  return `
  <div class="page-head"><div><span class="label">${ROLE_LABEL[role()]}</span><h1>Students</h1><p class="muted">Create student accounts and place them in sections. Assignments go to all students or to one section.${S.org&&S.org.maxStudents? ` <b>${S.org.students} of ${S.org.maxStudents}</b> active students used on your plan.`:''}</p></div></div>
  ${credsBox()}
  <div class="grid2" style="align-items:start">
  <section class="panel panel-pad stack"><h2>Add one student</h2>
    <form class="stack" data-form="add-student">
      <label class="field"><span>Full name</span><input type="text" id="as-name" name="name" required></label>
      <label class="field"><span>Email (used to sign in)</span><input type="text" id="as-email" name="email" inputmode="email" required></label>
      <div class="grid2"><label class="field"><span>Section</span><input type="text" id="as-sec" name="section" placeholder="e.g. HIM-301 A" list="sec-list" value="${esc(S.acct.section)}"></label>
      <label class="field"><span>Team (for group activities, optional)</span><input type="text" id="as-team" name="team" placeholder="e.g. Team 1" list="team-list"></label></div>
      <div><button class="btn primary" type="submit">Create student account</button></div>
    </form></section>
  <section class="panel panel-pad stack"><h2>Import a class list</h2>
    <p class="small muted">Upload a CSV file saved from Excel with the columns <b>Name, Email, Section, Team</b> (Team is optional; header row optional), or paste the rows below.</p>
    <label class="btn sm" style="align-self:flex-start"><input type="file" id="imp-file" data-act="import-file" accept=".csv,text/csv" hidden>Choose CSV file</label>
    <form class="stack" data-form="import">
      <label class="field"><span>Or paste rows (Name, Email, Section, Team)</span><textarea id="imp-text" name="rows" rows="5" placeholder="Sara Ahmed, sara.ahmed@university.edu, HIM-301 A, Team 1"></textarea></label>
      <div><button class="btn primary" type="submit">Create accounts</button></div>
    </form></section>
  </div>
  <datalist id="sec-list">${sections().map(s=>`<option value="${esc(s)}">`).join('')}</datalist><datalist id="team-list">${teams().map(t=>`<option value="${esc(t)}">`).join('')}</datalist>
  ${joinPanel()}
  <section class="panel panel-pad stack"><h2>Teams for group activities</h2>
    <p class="small muted">Group activities (for example the Billing activities) are done in teams: one member submits for the whole team and the grade can be given to every member. Type a team name next to each student in the roster, or make teams automatically.</p>
    <div class="row" style="align-items:flex-end"><label class="field"><span>Section</span><select id="mt-sec"><option value="">All students</option>${sections().map(x=>`<option>${esc(x)}</option>`).join('')}</select></label>
      <label class="field"><span>Students per team</span><select id="mt-size">${[2,3,4,5,6].map(n=>`<option ${n===3?'selected':''}>${n}</option>`).join('')}</select></label>
      <button class="btn" data-act="make-teams">Make teams</button><button class="btn" data-act="clear-teams">Clear teams</button></div>
    ${teams().length? `<div class="row small">${teams().map(t=>{ const m=students().filter(x=>x.team===t); return `<span class="pill info">${esc(t)}: ${m.length}</span>`; }).join('')}</div>`:''}</section>
  <section class="panel"><div class="panel-pad row" style="padding-bottom:6px;justify-content:space-between"><h2>Roster <span class="count">${all.length}</span></h2>
      <div class="row">${isAdmin?'':`<label class="row small" style="gap:6px"><input type="checkbox" id="stu-mine" data-act="stu-mine" ${mine?'checked':''}> Only students I created</label>`}
      <input type="search" id="stu-q" data-act="stu-q" placeholder="Search name, email, section" value="${esc(S.acct.q)}" style="max-width:240px"></div></div>
    ${all.length? tbl(['Student','Email','Section','Team','Status','Created by','Submitted',''], all.map(p=>`<tr><td><div class="person">${avatar(p.id)}<span>${esc(p.name)}</span></div></td><td class="small">${esc(p.email)}</td>
      <td><input type="text" id="sec-${esc(p.id)}" data-act="set-sec" data-v="${esc(p.id)}" value="${esc(p.section||'')}" placeholder="Unassigned" style="width:130px" list="sec-list"></td>
      <td><input type="text" id="team-${esc(p.id)}" data-act="set-team" data-v="${esc(p.id)}" value="${esc(p.team||'')}" placeholder="No team" style="width:100px" list="team-list"></td>
      <td>${p.active? (p.mustChange?'<span class="pill warn">Not signed in yet</span>':'<span class="pill ok">Active</span>') : '<span class="pill bad">Deactivated</span>'}</td>
      <td class="small">${p.createdBy===S.me.id?'You':/^join:/.test(p.createdBy||'')?`Signed up with code <span class="mono">${esc(p.createdBy.slice(5))}</span>`:esc(name(p.createdBy))}</td>
      <td class="num">${Object.values(S.work[p.id]||{}).filter(s=>s.status==='submitted').length}</td>
      <td><div class="row" style="flex-wrap:nowrap"><button class="btn sm" data-act="reset-pw" data-v="${esc(p.id)}">Reset password</button><button class="btn sm" data-act="toggle-active" data-v="${esc(p.id)}">${p.active?'Deactivate':'Reactivate'}</button><button class="btn sm danger" data-act="rm-user" data-v="${esc(p.id)}">Delete</button></div></td></tr>`))
      : `<div class="empty">No students match. Create accounts above or import a class list.</div>`}</section>`;
};
VIEWS.guests=()=>{
  const gs=Object.values(S.guests||{}).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  return `
  <div class="page-head"><div><span class="label">Admin</span><h1>Guest accounts</h1><p class="muted">Give a client or visitor time-limited, read-only access to preview CodeLab. Guests see the activity library and EHR patient charts and can download activity documents. They cannot see students, submissions, grades or answer keys, and cannot change anything.</p></div></div>
  ${credsBox()}
  <section class="panel panel-pad stack"><h2>Add a guest</h2>
    <form class="grid2" data-form="add-guest" style="align-items:end">
      <label class="field"><span>Full name</span><input type="text" id="ag-name" name="name" required></label>
      <label class="field"><span>Email (used to sign in)</span><input type="text" id="ag-email" name="email" inputmode="email" required></label>
      <label class="field"><span>Organization (optional)</span><input type="text" id="ag-org" name="section" placeholder="e.g. Riverside College"></label>
      <label class="field"><span>Access lasts</span><select id="ag-days" name="days">${[1,3,7,14,30].map(d=>`<option value="${d}" ${d===7?'selected':''}>${d} day${d>1?'s':''}</option>`).join('')}</select></label>
      <div><button class="btn primary" type="submit">Create guest account</button></div>
    </form>
    <p class="hint">Access ends automatically at the same time of day after the chosen number of days, even if the guest is signed in. Sign-in address: <span class="mono">${esc(signInUrl())}</span></p></section>
  <section class="panel"><div class="panel-pad" style="padding-bottom:6px"><h2>Guests <span class="count">${gs.length}</span></h2></div>
    ${gs.length? tbl(['Name','Email','Organization','Status','Access ends',''], gs.map(g=>{ const live=g.active && g.expiresAt>Date.now();
      return `<tr><td><div class="person">${avatar(g.id)}<span>${esc(g.name)}</span></div></td><td class="small">${esc(g.email)}</td><td>${esc(g.section||'—')}</td><td>${guestStatus(g)}</td>
      <td class="small">${g.expiresAt? esc(fmtEnd(g.expiresAt))+`<div class="muted">${esc(daysLeft(g.expiresAt))}</div>`:'—'}</td>
      <td><div class="row" style="gap:6px"><button class="btn sm" data-act="extend-guest" data-v="${esc(g.id)}">${live?'Extend 7 days':'Renew 7 days'}</button>${live?`<button class="btn sm" data-act="end-guest" data-v="${esc(g.id)}">End now</button>`:''}<button class="btn sm" data-act="reset-pw" data-v="${esc(g.id)}">Reset password</button><button class="btn sm danger" data-act="rm-user" data-v="${esc(g.id)}">Delete</button></div></td></tr>`; }))
      : `<div class="empty">No guests yet. Use the form above to give a client 7 days of access.</div>`}</section>`;
};
function parseCsv(text){
  const rows=[]; for(const line of String(text).split(/\r?\n/)){ if(!line.trim()) continue;
    const cells=[]; let cur='', inq=false; for(let i=0;i<line.length;i++){ const ch=line[i]; if(inq){ if(ch==='"'){ if(line[i+1]==='"'){ cur+='"'; i++; } else inq=false; } else cur+=ch; } else if(ch==='"') inq=true; else if(ch===','||ch==='\t'||ch===';'){ cells.push(cur.trim()); cur=''; } else cur+=ch; }
    cells.push(cur.trim()); rows.push(cells); }
  if(rows.length && /name/i.test(rows[0][0]||'') && /mail/i.test(rows[0][1]||'')) rows.shift();
  return rows.filter(r=>r.length>=2).map(r=>({name:r[0], email:r[1], section:r[2]||S.acct.section||'', team:r[3]||''}));
}
async function importRows(rows){
  if(!rows.length) return toast('No rows found. Use: Name, Email, Section.');
  try{ const r=await api('POST','/api/users/import',{rows}); S.acct.created=r.results; await refresh(); toast(`${r.results.filter(x=>x.ok).length} of ${rows.length} accounts created`); render(); window.scrollTo(0,0); }
  catch(e){ toast(e.message); }
}
function downloadCreds(){
  const rows=(S.acct.created||[]).filter(r=>r.ok!==false);
  const csv=['Name,Email,Section or organization,Temporary password,Sign-in address,Access ends', ...rows.map(r=>[r.user.name,r.user.email,r.user.section||'',r.tempPassword,signInUrl(),r.user.expiresAt?fmtEnd(r.user.expiresAt):''].map(v=>`"${String(v).replace(/"/g,'""')}"`).join(','))].join('\r\n');
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'})); a.download='codelab-sign-in-details.csv'; document.body.appendChild(a); a.click(); a.remove();
}


/* ================= owner console ================= */
const dayMs=864e5;
const fmtDay=t=>t? new Date(t).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'}) : 'No end date';
const isoDay=t=>{ if(!t) return ''; const d=new Date(t); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
function orgState(o){
  if(o.status!=='active') return {k:'paused',label:'Paused',cls:'bad'};
  if(o.expiresAt && o.expiresAt<=Date.now()) return {k:'expired',label:'Ended: read-only',cls:'bad'};
  if(o.expiresAt && o.expiresAt-Date.now()<30*dayMs) return {k:'soon',label:`Ends in ${Math.max(1,Math.ceil((o.expiresAt-Date.now())/dayMs))} days`,cls:'warn'};
  return {k:'ok',label:'Active',cls:'ok'};
}
function orgLogo(o){ return o.logo? `<img class="org-logo" src="${esc(o.logo)}" alt="">` : `<span class="org-logo ph">${esc(o.name.split(/\s+/).map(w=>w[0]).filter(c=>/[A-Za-z]/.test(c)).slice(0,2).join('').toUpperCase()||'C')}</span>`; }
function ownerCreds(){
  const c=S.ocreds; if(!c) return '';
  return `<section class="panel panel-pad stack creds"><div class="row" style="justify-content:space-between"><h2>Sign-in details for ${esc(c.org)}</h2><button class="btn sm" data-act="close-ocreds">Done</button></div>
    <p class="hint">Send these to the college admin privately. The temporary password is shown only now; they choose their own at first sign-in.</p>
    ${tbl(['College sign-in address','Admin','Email','Temporary password'],[`<tr><td class="mono">${esc(signInUrl(c.slug))}</td><td>${esc(c.name)}</td><td>${esc(c.email)}</td><td class="mono"><b>${esc(c.temp)}</b></td></tr>`])}</section>`;
}
VIEWS.colleges=()=>{
  const os=S.orgs||[]; const f=S.form&&S.form.newOrg? S.form : (S.form={newOrg:true,name:'',slug:'',adminName:'',adminEmail:'',maxStudents:'',expiresOn:''});
  const act=os.filter(o=>orgState(o).k!=='paused'), soon=os.filter(o=>['soon','expired'].includes(orgState(o).k));
  if(S.ostat===undefined){ S.ostat=null; api('GET','/api/owner/content-status').then(r=>{ S.ostat=r; scheduleRender(); }).catch(()=>{}); }
  return `
  <div class="page-head"><div><h1>Colleges</h1><p class="muted">Every college has its own address, admin, students, EHR records, look and plan. You see each college's numbers, not its students' work.</p></div></div>
  ${ownerCreds()}
  <div class="stats">
    <div class="panel stat"><span class="label">Colleges</span><b>${os.length}</b><span class="small muted">${act.length} active</span></div>
    <div class="panel stat"><span class="label">Active students</span><b>${os.reduce((a,o)=>a+o.students,0)}</b><span class="small muted">across all colleges</span></div>
    <div class="panel stat"><span class="label">Need renewal</span><b>${soon.length}</b><span class="small muted">ending within 30 days or ended</span></div>
    <div class="panel stat"><span class="label">Submissions</span><b>${os.reduce((a,o)=>a+o.submissions,0)}</b><span class="small muted">all time</span></div>
  </div>
  ${S.ostat&&S.ostat.differing? `<section class="panel panel-pad row" style="justify-content:space-between"><div><h2>Built-in content update available</h2><p class="small muted">${S.ostat.differing} built-in EHR records or activities differ from the latest version across your colleges. Updating replaces them with the latest version; colleges' own work is not changed.</p></div><button class="btn primary" data-act="owner-refresh">Update all colleges</button></section>`:''}
  <section class="panel">${os.length? tbl(['College','Status','Students','End date','Faculty','Last sign-in',''], os.map(o=>{ const st=orgState(o);
      return `<tr><td><div class="person">${orgLogo(o)}<div><b>${esc(o.name)}</b><div class="small muted mono">/c/${esc(o.slug)}${o.program?' <span class="pill info">Online program</span>':''}</div></div></div></td>
        <td><span class="pill ${st.cls}">${esc(st.label)}</span></td><td class="num">${o.students}${o.maxStudents?` / ${o.maxStudents}`:' <span class="muted small">(no limit)</span>'}</td>
        <td class="num">${esc(fmtDay(o.expiresAt))}</td><td class="num">${o.faculty}</td><td class="num">${o.lastSignIn? esc(fmtDay(o.lastSignIn)) : '<span class="muted">Never</span>'}</td>
        <td><button class="btn sm" data-act="open-college" data-v="${esc(o.id)}">Manage</button></td></tr>`; }))
    : `<div class="empty"><b>No colleges yet</b><span>Add your first college below. Its admin receives a sign-in link and a temporary password.</span></div>`}</section>
  <section class="panel panel-pad stack"><h2>Add a college</h2>
    <form class="grid2" data-form="add-org" style="align-items:end">
      <label class="field"><span>College name</span><input type="text" id="no-name" data-bind="name" data-act="org-name" value="${esc(f.name)}" required></label>
      <label class="field"><span>Web address</span><div class="addr"><span class="mono small muted">${esc(location.host)}/c/</span><input type="text" id="no-slug" data-bind="slug" value="${esc(f.slug)}" placeholder="kfu" required></div></label>
      <label class="field"><span>College admin's name</span><input type="text" id="no-an" data-bind="adminName" value="${esc(f.adminName)}" required></label>
      <label class="field"><span>College admin's email</span><input type="text" id="no-ae" data-bind="adminEmail" inputmode="email" value="${esc(f.adminEmail)}" required></label>
      <label class="field"><span>Student limit (leave empty for no limit)</span><input type="number" id="no-max" min="0" data-bind="maxStudents" value="${esc(f.maxStudents)}" placeholder="e.g. 300"></label>
      <label class="field"><span>Subscription end date (leave empty for no end date)</span><input type="date" id="no-exp" data-bind="expiresOn" value="${esc(f.expiresOn)}"></label>
      <label class="row small" style="gap:8px"><input type="checkbox" id="no-prog" data-bind="program" ${f.program?'checked':''}> Run an online certificate program (independent learners register and pay at /register)</label>
      <div><button class="btn primary" type="submit">Create college</button></div>
    </form>
    <p class="hint">CodeLab copies all built-in EHR records and activities into the new college. The admin can then change the college's logo and colours, and add faculty and students.</p></section>`;
};
VIEWS.college=({id})=>{
  const o=(S.orgs||[]).find(x=>x.id===id); if(!o) return `<div class="empty">College not found.</div>`;
  const f=S.form&&S.form.orgId===id? S.form : (S.form={orgId:id,name:o.name,slug:o.slug,maxStudents:o.maxStudents||'',expiresOn:isoDay(o.expiresAt),contact:o.contact,notes:o.notes,newAdmin:'',newAdminEmail:''});
  const st=orgState(o);
  return `
  <div class="page-head"><div><button class="btn sm" data-act="go" data-v="colleges">← Colleges</button><div class="person" style="margin-top:10px">${orgLogo(o)}<h1>${esc(o.name)}</h1></div>
    <div class="meta"><span class="pill ${st.cls}">${esc(st.label)}</span><span class="mono">${esc(signInUrl(o.slug))}</span></div></div>
    <div class="row"><a class="btn" href="/c/${esc(o.slug)}" target="_blank" rel="noopener">Open sign-in page ↗</a></div></div>
  ${ownerCreds()}
  <div class="stats">
    <div class="panel stat"><span class="label">Students</span><b>${o.students}</b><span class="small muted">${o.maxStudents? `of ${o.maxStudents} allowed` : 'no limit'}${o.studentsTotal>o.students?` · ${o.studentsTotal-o.students} deactivated`:''}</span></div>
    <div class="panel stat"><span class="label">Faculty</span><b>${o.faculty}</b><span class="small muted">${o.guests} guest${o.guests===1?'':'s'}</span></div>
    <div class="panel stat"><span class="label">Assignments</span><b>${o.assignments}</b><span class="small muted">${o.submissions} submissions</span></div>
    <div class="panel stat"><span class="label">Subscription</span><b style="font-size:1.1rem">${esc(fmtDay(o.expiresAt))}</b><span class="small muted">${esc(st.label)}</span></div>
  </div>
  <section class="panel panel-pad stack"><div class="row" style="justify-content:space-between"><h2>Plan and details</h2>
      <div class="row"><button class="btn sm" data-act="org-extend" data-v="1">+1 month</button><button class="btn sm" data-act="org-extend" data-v="12">+12 months</button></div></div>
    <div class="grid2">
      <label class="field"><span>College name</span><input type="text" id="oe-name" data-bind="name" value="${esc(f.name)}"></label>
      <label class="field"><span>Web address</span><div class="addr"><span class="mono small muted">${esc(location.host)}/c/</span><input type="text" id="oe-slug" data-bind="slug" value="${esc(f.slug)}"></div></label>
      <label class="field"><span>Student limit (empty = no limit)</span><input type="number" id="oe-max" min="0" data-bind="maxStudents" value="${esc(f.maxStudents)}"></label>
      <label class="field"><span>Subscription end date (empty = no end date)</span><input type="date" id="oe-exp" data-bind="expiresOn" value="${esc(f.expiresOn)}"></label>
      <label class="field"><span>Billing contact</span><input type="text" id="oe-contact" data-bind="contact" value="${esc(f.contact)}" placeholder="Name, email or phone"></label>
      <label class="field"><span>Notes (only you see these)</span><input type="text" id="oe-notes" data-bind="notes" value="${esc(f.notes)}" placeholder="Invoice number, agreement, …"></label>
    </div>
    <div class="row"><button class="btn primary" data-act="org-save">Save changes</button></div>
    <p class="hint">When the end date passes, everyone at the college can still sign in and view, but nothing can be added or changed until you extend it. Changing the web address changes the college's sign-in link.</p></section>
  <section class="panel"><div class="panel-pad" style="padding-bottom:6px"><h2>College admins</h2></div>
    ${tbl(['Name','Email','Status',''], o.admins.map(a=>`<tr><td>${esc(a.name)}</td><td>${esc(a.email)}</td><td>${a.mustChange?'<span class="pill warn">Not signed in yet</span>':'<span class="pill ok">Active</span>'}</td><td><button class="btn sm" data-act="org-reset-admin" data-v="${esc(a.id)}">Reset password</button></td></tr>`))}
    <form class="grid2 panel-pad" data-form="add-org-admin" style="align-items:end">
      <label class="field"><span>Add another admin: name</span><input type="text" id="oa-n" data-bind="newAdmin" value="${esc(f.newAdmin)}" required></label>
      <label class="field"><span>Email</span><input type="text" id="oa-e" data-bind="newAdminEmail" inputmode="email" value="${esc(f.newAdminEmail)}" required></label>
      <div><button class="btn" type="submit">Add admin</button></div></form></section>
  <section class="panel panel-pad stack danger-zone"><h2>Pause or delete</h2>
    <div class="row" style="justify-content:space-between"><p class="small" style="max-width:70ch">${o.status==='active'? 'Pausing signs everyone at this college out and stops sign-in until you resume. Nothing is deleted.' : 'This college is paused. Resume to let its people sign in again.'}</p>
      <button class="btn ${o.status==='active'?'danger':'primary'}" data-act="org-pause">${o.status==='active'?'Pause college':'Resume college'}</button></div>
    ${o.status!=='active'? `<div class="row" style="justify-content:space-between;align-items:flex-end"><label class="field" style="max-width:360px"><span>To delete this college and all its data permanently, type <b class="mono">${esc(o.slug)}</b></span><input type="text" id="oe-del" data-bind="confirm" value="${esc(f.confirm||'')}"></label>
      <button class="btn danger" data-act="org-delete">Delete college permanently</button></div>`:''}</section>`;
};

/* ================= appearance (admin) ================= */
function themeCard(key){
  const th=THEMES[key]; const t=themeTokens({theme:key, custom:{}}).t; const on=(S.form?.theme||S.site.theme)===key;
  return `<button class="theme-card" data-act="theme-pick" data-v="${key}" aria-pressed="${on}">
    <div class="mini" style="background:${t.bg}"><div class="t" style="background:${t['topbar-bg']};border-bottom:3px solid ${t.stripe}"></div><div style="background:${t['rail-bg']}"></div>
      <div class="c"><i style="background:${t['sec-head-bg']};width:90%"></i><i style="background:${t.surface};border:1px solid ${t.line};height:14px"></i><i style="background:${t.accent};width:45%"></i></div></div>
    <span class="nm"><span>${esc(th.label)}</span>${on?'<span class="pill info">Selected</span>':''}</span>
    <span class="small muted" style="padding:0 10px 10px">${esc(th.note)}</span></button>`;
}
const APPEAR_KEYS=['theme','custom','siteName','institution','logo','showName','logoTile','topbarHeight','stripeWidth'];
function openAppearance(){ S.form={...Object.fromEntries(APPEAR_KEYS.map(k=>[k,S.site[k]])), custom:{...(S.site.custom||{})}}; }
VIEWS.appearance=()=>{
  if(!S.form || S.form.theme===undefined) openAppearance();
  const f=S.form; const cur=themeTokens(f).t; const c=f.custom||{};
  const sw=(k,label,val)=>`<label class="swatch"><input type="color" id="tc-${k}" data-act="theme-color" data-k="${k}" value="${esc(c[k]||val)}"><span><b class="small">${label}</b><br><span class="small muted mono">${esc(c[k]||val)}</span>${c[k]?` · <button class="btn sm" style="padding:0 6px" data-act="theme-color-reset" data-k="${k}">reset</button>`:''}</span></label>`;
  const pick=o=>JSON.stringify(APPEAR_KEYS.map(k=>k==='custom'?(o.custom||{}):o[k]));
  const dirty=pick(f)!==pick(S.site);
  return `
  <div class="page-head"><div><span class="label">Admin</span><h1>${role()==='owner'?'Platform appearance':'Appearance'}</h1><p class="muted">${role()==='owner'? 'The look of your owner console and the general sign-in page. Each college chooses its own look under its admin\'s Appearance page.' : 'Choose how CodeLab looks for everyone at your college. Changes preview immediately; click Save to apply them.'}</p></div>
    <div class="row">${dirty?'<button class="btn" data-act="theme-cancel">Discard changes</button>':''}<button class="btn primary" data-act="theme-save" ${dirty?'':'disabled'}>Save for everyone</button></div></div>
  <section class="panel panel-pad stack"><h2>Theme</h2><div class="themes">${Object.keys(THEMES).map(themeCard).join('')}</div></section>
  <section class="panel panel-pad stack"><h2>Fine-tune colors</h2><p class="hint">Optional. Start from a theme, then match your institution's colors. Text colors adjust automatically for readability.</p>
    <div class="swatches">${sw('topbar','Top bar',cur['topbar-bg'])}${sw('rail','Side menu',cur['rail-bg'])}${sw('accent','Buttons and highlights',cur.accent)}${sw('ehrnav','EHR chart menu',cur['ehrnav-bg'])}</div></section>
  <section class="panel panel-pad stack"><h2>Logo and top bar</h2>
    <div class="logo-row"><div class="logo-prev ${f.logo&&f.logoTile!==false?'tile':''}" style="background:var(--topbar-bg)">${f.logo?`<img src="${esc(f.logo)}" alt="Current logo">`:`<span class="brand-mark">${MARK_SVG}</span>`}</div>
      <div class="stack" style="gap:8px"><div class="row"><label class="btn sm"><input type="file" id="ap-logo" data-act="logo-file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden>${f.logo?'Replace logo':'Upload logo'}</label>${f.logo?'<button class="btn sm" data-act="logo-remove">Remove logo</button>':''}</div>
        <p class="hint">PNG, JPG, WebP or SVG. A wide logo with a transparent background works best; large images are resized automatically.</p>
        ${f.logo?`<label class="row small" style="gap:6px"><input type="checkbox" id="ap-tile" data-act="theme-bool" data-k="logoTile" ${f.logoTile!==false?'checked':''}> Show the logo on a white background (use for dark logos)</label>
        <label class="row small" style="gap:6px"><input type="checkbox" id="ap-showname" data-act="theme-bool" data-k="showName" ${f.showName!==false?'checked':''}> Show the site name next to the logo</label>`:''}</div></div>
    <div class="grid2">
      <label class="field"><span>Top bar height <b class="small" id="v-topbarHeight">${+f.topbarHeight||60} px</b></span><input type="range" id="ap-h" min="48" max="96" step="2" data-act="theme-num" data-k="topbarHeight" value="${+f.topbarHeight||60}"><span class="hint">48 px is compact; 60 px is standard; 80 px and above suits a tall logo.</span></label>
      <label class="field"><span>Accent line under the top bar <b class="small" id="v-stripeWidth">${f.stripeWidth??3} px</b></span><input type="range" id="ap-s" min="0" max="8" step="1" data-act="theme-num" data-k="stripeWidth" value="${f.stripeWidth??3}"><span class="hint">Set to 0 to remove the line.</span></label></div></section>
  <section class="panel panel-pad stack" style="max-width:760px"><h2>Name shown in the top bar</h2>
    <div class="grid2"><label class="field"><span>Site name</span><input type="text" id="ap-name" data-act="theme-text" data-k="siteName" maxlength="40" value="${esc(f.siteName||'')}"></label>
      <label class="field"><span>Institution or program</span><input type="text" id="ap-inst" data-act="theme-text" data-k="institution" maxlength="90" value="${esc(f.institution||'')}" placeholder="e.g. King Faisal University · HIM Program"></label></div></section>
  <section class="panel"><div class="panel-pad" style="padding-bottom:0"><h2>Preview</h2><p class="hint">Sample EHR record as students will see it.</p></div>
    <div class="panel-pad">${S.patients['o-clinic']||Object.values(S.patients)[0]? chartHTML(S.patients['o-clinic']||Object.values(S.patients)[0]) : ''}</div></section>`;
};

/* ================= EHR viewer (used for CodeLab charts) ================= */
const EHR_TABS=[['Health',[['overview','Overview'],['alerts','Alerts'],['prevention','Prevention'],['problems','Problems'],['vitals','Vitals'],['orders','Orders'],['meds','Meds'],['notes','Notes'],['labs','Labs']]],['Account',[['registration','Registration'],['encounters','Encounters'],['insurance','Insurance']]]];
function flagCell(f){ const v=String(f||''); const lab=v==='H'?'High':v==='L'?'Low':v; return `<td class="${/^[HL]/.test(v)?'flag-H':''}">${esc(lab)}</td>`; }
const ICON_TABLE='<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14.5h18M9 9v11"/></svg>';
const sect=(title, body, tab, cls='')=>`<section class="sec ${cls}"><header><span>${esc(title)}</span>${tab?`<button data-act="chart-tab" data-v="${tab}">Open ${esc(title.toLowerCase())}</button>`:''}</header>${body}</section>`;
const T={
  info:p=>tbl(['Name','Contact information','Language','Race / ethnicity'],[`<tr><td>${esc(p.name)}</td><td>${esc(p.contact||'—')}</td><td>${esc(p.language||'—')}</td><td>${esc(p.race||'—')}</td></tr>`]),
  alerts:p=>tbl(['Date & time','Subject','Status','Alert type'], p.allergies.map(a=>`<tr><td class="num">${esc(a.date)}</td><td>${esc(a.subject)}</td><td>${esc(a.status)}</td><td>${esc(a.type)}</td></tr>`)),
  prevention:p=>tbl(['Date & time','Subject','Details','Prevention type'], p.prevention.map(a=>`<tr><td class="num">${esc(a.date)}</td><td>${esc(a.subject)}</td><td>${esc(a.details)}</td><td>${esc(a.type)}</td></tr>`)),
  problems:(p,lim)=>tbl(['Priority','Status','Description','Immediacy','Date of onset','Provider'], [...(p.principalDx?[{priority:'Principal',status:'Active',desc:p.principalDx,immediacy:'',onset:'',provider:p.attending||''}]:[]), ...p.problems].slice(0,lim||999).map(a=>`<tr><td>${esc(a.priority)}</td><td>${esc(a.status)}</td><td>${esc(a.desc)}</td><td>${esc(a.immediacy)}</td><td class="num">${esc(a.onset)}</td><td>${esc(a.provider)}</td></tr>`)),
  vitals:(p,lim)=>tbl(['Date','Temp','Pulse','Resp','Blood pressure','Pulse ox','Pain'], p.vitals.slice(0,lim||999).map(v=>`<tr><td class="num">${esc(v.t)}</td><td class="num">${esc(v.temp)}</td><td class="num">${esc(v.hr)}</td><td class="num">${esc(v.rr)}</td><td class="num">${esc(v.bp)}</td><td class="num">${esc(v.spo2)}${v.spo2&&!/%/.test(v.spo2)?' %':''}</td><td class="num">${esc(v.pain||'')}</td></tr>`)),
  labs:p=>{ const rows=[]; let last=''; p.labs.forEach(l=>{ const k=(l.date||'')+'|'+(l.panel||''); if(l.panel && k!==last){ rows.push(`<tr class="panel-row"><td colspan="6">${esc(l.panel)} <span class="muted mono">${esc(l.date||'')}</span></td></tr>`); last=k; } rows.push(`<tr><td>${esc(l.name)}</td><td class="num">${esc(l.value)}</td><td>${esc(l.unit||'')}</td>${flagCell(l.flag)}<td class="num muted">${esc(l.ref)}</td><td class="num muted">${l.panel?'':esc(l.date||'')}</td></tr>`); }); return tbl(['Lab test','Value','Unit','Abnormal flag','Reference range','Date & time'], rows); },
  orders:(p,lim)=>tbl(['Category','Order item','Frequency','Status','When'], p.orders.slice(0,lim||999).map(o=>`<tr><td>${esc(o.category)}</td><td>${esc(o.item)}</td><td>${esc(o.frequency)}</td><td>${esc(o.status)}</td><td class="num">${esc(o.when)}</td></tr>`)),
  meds:(p,lim)=>tbl(['Category','Drug description','Route','Order status','Frequency','When'], p.meds.slice(0,lim||999).map(m=>`<tr><td>${esc(m.category)}</td><td>${esc(m.drug)}</td><td>${esc(m.route)}</td><td>${esc(m.status)}</td><td>${esc(m.frequency)}</td><td class="num">${esc(m.when)}</td></tr>`)),
  noteList:p=>tbl(['Date & time','Note title','Author','Location'], p.docs.map(d=>`<tr><td class="num">${esc(d.date)}</td><td><button class="btn sm" data-act="open-note" data-v="${esc(d.id)}">${esc(d.title)}</button></td><td>${esc(d.author)}</td><td>${esc(d.location||'')}</td></tr>`)),
  encounters:p=>{ const start=timeKey(p.admit).slice(0,8); const cur=e=>!/^~/.test(start) && timeKey(e.date).slice(0,8)>=start;
    return tbl(['Check-in','Location','Provider','Status','Description','Stay'], p.encounters.map(e=>`<tr class="${cur(e)?'enc-cur':'enc-prev'}"><td class="num">${esc(e.date)}</td><td>${esc(e.location)}</td><td>${esc(e.provider)}</td><td>${esc(e.status)}</td><td>${esc(e.description)}</td><td>${p.admit? (cur(e)?'<span class="pill info">This stay</span>':'<span class="pill">Previous</span>') : ''}</td></tr>`)); },
  insurance:p=>tbl(['Priority','Plan name','Plan number','Active'], p.insurance.map(i=>`<tr><td>${esc(i.priority)}</td><td>${esc(i.plan)}</td><td class="num">${esc(i.number)}</td><td>${esc(i.active)}</td></tr>`)),
};
function reportsHTML(p){ if(!p.reports.length) return '<p class="muted">No reports or forms in this record.</p>';
  return p.reports.map(r=>sect(r.title, (r.table?`<p class="none">Table name: <b class="mono">${esc(r.table)}</b></p>`:'')+(r.note?`<p class="none">${esc(r.note)}</p>`:'')+tbl(r.columns, r.rows.map(row=>`<tr>${r.columns.map((c,i)=>{ const v=String(row[i]??''); return `<td${v.length<=24 && !/\s/.test(v)?' class="nw"':''}>${esc(v)}</td>`; }).join('')}</tr>`), 'rpt'))).join(''); }
function notesFull(p){
  if(!p.docs.length) return '<p class="muted">No notes in this record.</p>';
  const cur=p.docs.find(d=>d.id===S.openNote) || p.docs[0];
  return `<div class="notes-split">
    <nav class="note-list" aria-label="Notes">${p.docs.map(d=>`<button data-act="open-note" data-v="${esc(d.id)}" aria-current="${d.id===cur.id}"><span class="nt">${esc(d.title)}</span><span class="nm2">${esc(d.author||'')}</span><span class="nd">${esc(d.date||'')}${d.signed?'':' <span class="stamp unsigned">Unsigned</span>'}</span></button>`).join('')}</nav>
    <article class="note-view" id="note-${esc(cur.id)}"><header><div><h3>${esc(cur.title)}</h3><p class="small muted">${esc(cur.author||'')}${cur.location?` · ${esc(cur.location)}`:''}</p></div><div class="note-meta"><span class="num">${esc(cur.date||'')}</span><span class="stamp ${cur.signed?'signed':'unsigned'}">${cur.signed?'Signed':'Unsigned'}</span></div></header><pre>${esc(cur.body||'')}</pre></article>
  </div>`;
}
/* ---- patient banner ---- */
const usDate=d=>{ const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d||'')); return m? `${m[2]}/${m[3]}/${m[1]}` : (d||''); };
const lastFirst=n=>{ const w=String(n||'').trim().split(/\s+/); return w.length>1? `${w[w.length-1]}, ${w.slice(0,-1).join(' ')}` : n; };
const initials=n=>String(n||'').split(/\s+/).map(w=>w[0]).filter(Boolean).slice(0,2).join('').toUpperCase();
const fact=(k,v,cls='')=>`<div class="fact ${cls}"><dt>${esc(k)}</dt><dd>${v? esc(v) : '<span class="muted">—</span>'}</dd></div>`;
function bannerHTML(p){
  const al=p.allergies.map(a=>a.subject).filter(x=>x && !/^no known/i.test(x));
  return `<header class="pt-banner">
    <div class="pt-id"><span class="pt-photo" aria-hidden="true">${esc(initials(p.name))}</span>
      <div><h1 class="pt-name">${esc(lastFirst(p.name))}</h1>
      <p class="pt-sub"><span>${age(p.dob)} yrs</span><span>${esc(p.sex||'')}</span><span>DOB ${esc(usDate(p.dob))}</span></p></div></div>
    <dl class="pt-facts">${fact('MRN',p.mrn,'num')}${fact('Encounter',[p.encounterType,p.unit].filter(Boolean).join(', '))}${fact('Admitted',p.admit,'num')}${fact('Discharged',p.discharge,'num')}${fact('Attending',p.attending)}${fact('Payer',p.payer||p.insurance[0]?.plan)}</dl>
    <div class="pt-flags">${al.length? `<span class="flag allergy" title="Allergies"><b>Allergies</b> ${esc(al.join('; '))}</span>` : `<span class="flag nka"><b>Allergies</b> No known allergies</span>`}<span class="flag facility">${esc(p.facility)}</span></div>
  </header>`;
}
/* ---- tab hints ---- */
const TAB_HINT={overview:'A summary of the most important information. Use the "Open" links for the full lists.',
  alerts:'Allergies and adverse reactions, with the date each was recorded.', prevention:'Immunizations and screenings.',
  problems:'Diagnoses and conditions. "Admitting" marks the reasons for this stay.',
  vitals:'Temperature, pulse, breathing rate, blood pressure, oxygen saturation and pain, oldest first.',
  orders:'What providers ordered, how often, and whether it is complete.',
  meds:'Medications with route, status (Active, Complete, On hold, Discontinued) and frequency.',
  notes:'Provider and nursing documents, oldest first. Choose a note on the left to read it on the right.',
  labs:'Results grouped by date and panel. High and low results are flagged.',
  registration:'Demographics and the details of this stay.',
  encounters:'Every visit and transfer for this patient, oldest first. Rows for the current stay are marked "This stay".',
  insurance:'Payers and plan numbers.', reports:'Forms, logs and data tables attached to this record.', search:''};
const withHint=(tab,body)=>TAB_HINT[tab]? body.replace(/^<h2>(.*?)<\/h2>/, m=>`${m}<p class="tab-hint">${esc(TAB_HINT[tab])}</p>`) : body;
/* ---- search inside one record ---- */
function chartIndex(p){
  const it=[]; const add=(section,tab,label,text,extra={})=>{ if(String(text||'').trim()) it.push({section,tab,label,text:String(text),...extra}); };
  if(p.kind!=='dataset'){
    [['Name',p.name],['MRN',p.mrn],['Date of birth',usDate(p.dob)],['Contact',p.contact],['Language',p.language],['Race / ethnicity',p.race],['Unit',p.unit],['Encounter type',p.encounterType],['Attending',p.attending],['Admitted',p.admit],['Discharged',p.discharge],['Advance directive',p.advanceDirective],['Principal diagnosis',p.principalDx]].forEach(([k,v])=>add('Registration','registration',k,v));
    p.allergies.forEach(a=>add('Alerts','alerts',a.subject,[a.subject,a.date,a.status,a.type].join(' · ')));
    p.problems.forEach(a=>add('Problems','problems',a.desc,[a.priority,a.status,a.desc,a.immediacy,a.onset,a.provider].filter(Boolean).join(' · ')));
    p.vitals.forEach(v=>add('Vitals','vitals',v.t,`${v.t} · Temp ${v.temp} · Pulse ${v.hr} · Resp ${v.rr} · BP ${v.bp} · SpO2 ${v.spo2}${v.pain?` · Pain ${v.pain}`:''}`));
    p.labs.forEach(l=>add('Labs','labs',l.name,[l.date,l.panel,l.name,`${l.value} ${l.unit||''}`.trim(),l.flag==='H'?'High':l.flag==='L'?'Low':l.flag,l.ref&&`ref ${l.ref}`].filter(Boolean).join(' · ')));
    p.orders.forEach(o=>add('Orders','orders',o.item,[o.category,o.item,o.frequency,o.status,o.when].filter(Boolean).join(' · ')));
    p.meds.forEach(m=>add('Meds','meds',m.drug,[m.drug,m.route,m.status,m.frequency,m.when].filter(Boolean).join(' · ')));
    p.prevention.forEach(a=>add('Prevention','prevention',a.subject,[a.date,a.subject,a.details].filter(Boolean).join(' · ')));
    p.encounters.forEach(e=>add('Encounters','encounters',e.date,[e.date,e.location,e.provider,e.status,e.description].filter(Boolean).join(' · ')));
    p.insurance.forEach(i=>add('Insurance','insurance',i.plan,[i.priority,i.plan,i.number].filter(Boolean).join(' · ')));
  }
  p.docs.forEach(d=>add('Notes','notes',d.title,`${d.title} · ${d.author} · ${d.date}\n${d.body||''}`,{note:d.id}));
  p.reports.forEach(r=>{ add('Reports & forms','reports',r.title,[r.title,r.note].filter(Boolean).join(' · ')); r.rows.forEach(row=>add('Reports & forms','reports',r.title,r.columns.map((c,i)=>`${c}: ${row[i]??''}`).join(' · '))); });
  return it;
}
function snippet(text,words){
  const low=text.toLowerCase(); let at=Math.min(...words.map(w=>low.indexOf(w)).filter(i=>i>=0)); if(!isFinite(at)) at=0;
  let a=Math.max(0,at-70), b=Math.min(text.length,at+150); let t=(a?'…':'')+text.slice(a,b).replace(/\n+/g,' · ')+(b<text.length?'…':'');
  let out=esc(t); words.forEach(w=>{ if(!w) return; const re=new RegExp('('+esc(w).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')','gi'); out=out.replace(re,'<mark>$1</mark>'); }); return out;
}
function searchHTML(p){
  const q=(S.chartQ||'').trim(); const words=q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits=chartIndex(p).filter(x=>words.every(w=>x.text.toLowerCase().includes(w)));
  const groups={}; hits.forEach(h=>(groups[h.section]||=[]).push(h));
  return `<h2>Search results</h2><p class="tab-hint">${hits.length? `${hits.length} match${hits.length>1?'es':''} for "${esc(q)}" in this record.` : `Nothing in this record matches "${esc(q)}". Check the spelling, or try a shorter word or a date such as 10/05.`}</p>`
    + Object.entries(groups).map(([sec,hs])=>sect(`${sec} (${hs.length})`, `<ul class="hits">${hs.slice(0,40).map(h=>`<li><button class="hit" ${h.note?`data-act="open-note" data-v="${esc(h.note)}"`:`data-act="chart-tab" data-v="${h.tab}"`}><b>${esc(h.label)}</b><span>${snippet(h.text,words)}</span></button></li>`).join('')}</ul>${hs.length>40?`<p class="none">Showing the first 40. Add another word to narrow the search.</p>`:''}`)).join('');
}
const searchBox=()=>`<div class="nav-search"><input type="search" id="chart-q" data-act="chart-q" placeholder="Search this record" aria-label="Search this record" value="${esc(S.chartQ||'')}" autocomplete="off"></div>`;
function datasetHTML(p){
  const tab=['reports','notes','search'].includes(S.chartTab)? S.chartTab : 'reports';
  const body= tab==='search'&&S.chartQ? searchHTML(p) : tab==='notes'? `<h2>Notes & memos</h2>`+notesFull(p) : `<h2>Reports & data tables</h2>`+reportsHTML(p);
  return `<div class="chart"><header class="pt-banner ds">
    <div class="pt-id"><span class="pt-photo ds" aria-hidden="true">${ICON_TABLE}</span><div><h1 class="pt-name">${esc(p.name)}</h1><p class="pt-sub"><span>Data set ${esc(p.mrn)}</span><span>${esc(p.facility)}</span></p></div></div>
    ${p.description?`<p class="pt-desc">${esc(p.description)}</p>`:''}</header>
    <div class="ehr"><nav class="ehr-nav" aria-label="Sections">${searchBox()}<div class="grp">Data</div><button data-act="chart-tab" data-v="reports" aria-selected="${tab==='reports'}">Reports (${p.reports.length})</button><button data-act="chart-tab" data-v="notes" aria-selected="${tab==='notes'}">Notes (${p.docs.length})</button></nav><div class="ehr-main">${body}</div></div></div>`;
}
function chartHTML(raw){
  const p=P(raw); if(!p) return `<div class="empty">Patient chart not found.</div>`;
  if(p.kind==='dataset') return datasetHTML(p);
  const tab=S.chartTab||'overview'; const ov=p.overview; let body='';
  if(tab==='overview'){
    /* [title, html, tab, half-width?] — half-width panels pair up in two columns on wide screens */
    const parts=[ov.info&&['Patient info',T.info(p),'registration',0], ov.encounters&&['Encounters',T.encounters(p),'encounters',0],
      ov.alerts&&['Alerts',T.alerts(p),'alerts',1], ov.prevention&&['Prevention',T.prevention(p),'prevention',1],
      ov.principal&&p.principalDx&&['Principal diagnosis',`<p class="none" style="color:var(--ink)">${esc(p.principalDx)}</p>`,'',1],
      ov.advance&&['Advance directive',`<p class="none" style="color:var(--ink)">${esc(p.advanceDirective||'None on file')}</p>`,'registration',1],
      ov.problems&&['Problems',T.problems(p,5),'problems',0], ov.vitals&&['Vitals',T.vitals(p,1),'vitals',0], ov.labs&&['Labs',T.labs(p),'labs',0],
      ov.orders&&['Orders',T.orders(p,4),'orders',0], ov.meds&&['Meds',T.meds(p,4),'meds',0], ov.notes&&['Notes',T.noteList(p),'notes',0]].filter(Boolean);
    const halves=parts.filter(x=>x[3]); if(halves.length%2) halves[halves.length-1][3]=0;
    body=`<h2>Overview</h2><div class="ov-grid">${parts.map(([t,h,k,half])=>sect(t,h,k,half?'half':'')).join('')}</div>`;
  }
  const simple={alerts:'Alerts',prevention:'Prevention',problems:'Problems',vitals:'Vitals',orders:'Orders',meds:'Meds',labs:'Labs',encounters:'Encounters',insurance:'Insurance'};
  if(simple[tab]) body=`<h2>${simple[tab]}</h2>`+T[tab](p);
  if(tab==='notes') body=`<h2>Notes</h2>`+notesFull(p);
  if(tab==='reports') body=`<h2>Reports & forms</h2>`+reportsHTML(p);
  if(tab==='search' && S.chartQ) body=searchHTML(p);
  if(tab==='registration') body=`<h2>Registration</h2><dl class="kv"><dt>Name</dt><dd>${esc(p.name)}</dd><dt>MRN</dt><dd class="num">${esc(p.mrn)}</dd><dt>Date of birth</dt><dd class="num">${esc(usDate(p.dob))} (${age(p.dob)} yrs)</dd><dt>Sex</dt><dd>${esc(p.sex)}</dd><dt>Contact</dt><dd>${esc(p.contact||'—')}</dd><dt>Language</dt><dd>${esc(p.language||'—')}</dd><dt>Race / ethnicity</dt><dd>${esc(p.race||'—')}</dd><dt>Facility</dt><dd>${esc(p.facility)}</dd><dt>Unit</dt><dd>${esc(p.unit||'—')}</dd><dt>Encounter type</dt><dd>${esc(p.encounterType||'—')}</dd><dt>Attending</dt><dd>${esc(p.attending||'—')}</dd><dt>Admitted</dt><dd class="num">${esc(p.admit||'—')}</dd><dt>Discharged</dt><dd class="num">${esc(p.discharge||'—')}</dd><dt>Advance directive</dt><dd>${p.advanceDirective? esc(p.advanceDirective) : '<span class="muted">None on file</span>'}</dd></dl>`;
  body=withHint(tab,body);
  return `<div class="chart">${bannerHTML(p)}
    <div class="ehr"><nav class="ehr-nav" aria-label="Chart sections">${searchBox()}${EHR_TABS.map(([g,ts])=>`<div class="grp">${g}</div>`+[...ts, ...(g==='Account'&&p.reports.length?[['reports',`Reports & forms (${p.reports.length})`]]:[])].map(([k,l])=>`<button data-act="chart-tab" data-v="${k}" aria-selected="${tab===k}">${l}</button>`).join('')).join('')}</nav><div class="ehr-main">${body}</div></div></div>`;
}

/* ================= Admin ================= */
function contentPanel(){
  const c=S.cstat;
  if(c===undefined){ S.cstat=null; api('GET','/api/admin/content-status').then(r=>{ S.cstat=r; scheduleRender(); }).catch(()=>{ S.cstat={error:true}; scheduleRender(); }); }
  const n=c&&!c.error? c.patients+c.library+c.files : 0;
  return `<section class="panel panel-pad stack"><div class="row" style="justify-content:space-between;align-items:flex-start"><div><h2>Built-in content</h2>
    <p class="small muted" style="max-width:70ch">The EHR records, library activities and documents that come with CodeLab. After installing an update, use this to bring them up to the latest version. Your accounts, assignments, submissions, grades and any charts or activities you created are not changed.</p></div>
    ${!c? '<span class="small muted">Checking…</span>' : c.error? '<span class="small muted">Could not check.</span>' : n? `<button class="btn primary" data-act="refresh-content">Update built-in content</button>` : '<span class="pill ok">Up to date</span>'}</div>
    ${c&&!c.error&&n? `<p class="small">${[c.patients&&`${c.patients} EHR record${c.patients>1?'s':''}`, c.library&&`${c.library} library activit${c.library>1?'ies':'y'}`, c.files&&`${c.files} document${c.files>1?'s':''}`].filter(Boolean).join(', ')} differ from the latest version. <span class="muted">If you edited a built-in chart or activity yourself, updating replaces your edit with the latest version.</span></p>`:''}</section>`;
}
VIEWS.overview=()=>{
  const st=students(), fac=facultyList(), asg=allAssignments();
  let toGrade=0, submitted=0; const recent=[];
  for(const [sid,subs] of Object.entries(S.work)) for(const [aid,s] of Object.entries(subs)){ if(s.status==='submitted'){ submitted++; if(!grade(sid,aid)) toGrade++; if(S.assignments[aid]) recent.push({sid,aid,s}); } }
  recent.sort((a,b)=>b.s.submittedAt-a.s.submittedAt);
  return `
  <div class="page-head"><div><span class="label">Program overview</span><h1>${esc(S.org?.name||'ICD-10 Coding Practicum')}</h1><p class="muted">Every student, assignment and submission in one place. Sign-in address for your college: <span class="mono">${esc(signInUrl())}</span></p></div>
    <div class="row"><button class="btn" data-act="go" data-v="people">Manage people</button><button class="btn primary" data-act="go" data-v="library">Assign from library</button></div></div>
  <div class="stats">
    <div class="panel stat"><span class="label">Students</span><b>${st.length}</b><span class="small muted">${sections().length} section${sections().length===1?'':'s'}</span></div>
    <div class="panel stat"><span class="label">Faculty</span><b>${fac.length}</b><span class="small muted">plus you as admin</span></div>
    <div class="panel stat"><span class="label">Library activities</span><b>${Object.keys(S.library).length}</b><span class="small muted">${asg.length} assigned</span></div>
    <div class="panel stat"><span class="label">Awaiting grading</span><b>${toGrade}</b><span class="small muted">of ${submitted} submitted</span></div>
  </div>
  <section class="panel"><div class="panel-pad" style="padding-bottom:6px"><h2>Completion by assignment</h2></div>
    ${asg.length? tbl(['Assignment','Section','Due','Submitted','Graded',''], asg.map(a=>{ const ts=targetStudents(a); const n=ts.length; const sb=ts.filter(s=>sub(s.id,a.id)?.status==='submitted'||grade(s.id,a.id)).length; const gr=ts.filter(s=>grade(s.id,a.id)).length;
      return `<tr><td>${esc(a.title)}</td><td>${a.target==='all'?'All':esc(a.target)}</td><td class="num">${fmtDate(a.due)}</td><td><div class="row" style="flex-wrap:nowrap"><div class="bar" style="width:90px"><i style="width:${n?sb/n*100:0}%"></i></div><span class="mono small">${sb}/${n}</span></div></td><td class="num">${gr}/${n}</td><td><button class="btn sm" data-act="review" data-v="${a.id}">Review</button></td></tr>`; })) : `<div class="empty">Nothing assigned yet. Pick an activity from the library to assign it.</div>`}</section>
  <section class="panel"><div class="panel-pad" style="padding-bottom:6px"><h2>Recent submissions</h2></div>
    ${recent.length? tbl(['Student','Assignment','Submitted','Status',''], recent.slice(0,8).map(({sid,aid,s})=>{ const a={id:aid,...S.assignments[aid]}; const st=studentStatus(sid,a);
      return `<tr><td><div class="person">${avatar(sid)}${esc(name(sid))}</div></td><td>${esc(a.title)}</td><td class="num">${fmtWhen(s.submittedAt)}</td><td><span class="pill ${st.cls}">${esc(st.label)}</span></td><td><button class="btn sm" data-act="grade" data-v="${aid}" data-s="${sid}">${st.k==='graded'?'Open':'Grade'}</button></td></tr>`; })) : `<div class="empty">Submissions will appear here as students upload their completed documents.</div>`}</section>
  ${role()==='admin'? contentPanel() : ''}`;
};
/* ================= Library ================= */
function libList(){ return Object.entries(S.library).map(([id,t])=>({id,...t})).sort((a,b)=>(a.order??9999)-(b.order??9999) || (a.title||'').localeCompare(b.title||'')); }
function ehrBtn(a, cls='btn sm'){ const h=ehrHref(a); return h? `<a class="${cls}" href="${esc(h)}" target="_blank" rel="noopener">Open EHR ↗</a>` : ''; }
const ready = t => (t.docs||[]).length>0 && !!chartOf(t);
function libFiltered(){
  const q=S.lib.q.toLowerCase();
  return libList().filter(t=>(S.lib.cat==='All'||(t.group||'Other')===S.lib.cat) && (!S.lib.tag || (t.tags||[]).includes(S.lib.tag)) && (!S.lib.readyOnly || ready(t)) && (!q || (t.title+' '+(t.description||'')+' '+(t.tags||[]).join(' ')).toLowerCase().includes(q)));
}
VIEWS.library=()=>{
  const all=libList(); const groups=['All',...new Set(all.map(t=>t.group||'Other'))];
  const tags=[...new Set(all.flatMap(t=>t.tags||[]))].sort();
  const list=libFiltered(); const sel=S.sel; const nReady=all.filter(ready).length;
  return `
  <div class="page-head"><div><span class="label">${isGuest()?'Guest preview':'Faculty'}</span><h1>${isGuest()?'Activity library':'Assignment library'}</h1><p class="muted">${isGuest()?'Each practical activity comes with a Word activity document for students and its own EHR record. Download a document or open the EHR to see what students work with.':'Tick the activities you want, then assign them. Each student gets the EHR link and the activity document for every box you choose.'}</p></div>
    ${isGuest()?'':'<button class="btn" data-act="new-tpl">New activity</button>'}</div>
  <div class="stack" style="gap:10px">
    <div class="row" style="justify-content:space-between">
      <div class="chips" role="group" aria-label="Group">${groups.map(c=>`<button class="chip" data-act="lib-cat" data-v="${esc(c)}" aria-pressed="${S.lib.cat===c}">${esc(c)} <span class="count">${c==='All'?all.length:all.filter(t=>(t.group||'Other')===c).length}</span></button>`).join('')}</div>
      <input type="search" id="lib-q" data-act="lib-q" placeholder="Search title, topic or tag" value="${esc(S.lib.q)}" style="max-width:280px" autocomplete="off">
    </div>
    <div class="row small"><span class="muted">Tag</span><select id="lib-tag" data-act="lib-tag" style="width:auto"><option value="">Any</option>${tags.map(t=>`<option ${S.lib.tag===t?'selected':''}>${esc(t)}</option>`).join('')}</select>
      ${isGuest()?'':`<label class="row small" style="gap:6px"><input type="checkbox" id="lib-ready" data-act="lib-ready" ${S.lib.readyOnly?'checked':''}> Ready to assign only <span class="count">${nReady}</span></label>`}
      <span class="muted">· ${list.length} shown</span>
      ${isGuest()?'':`${list.length? `<button class="btn sm" data-act="sel-all">Select all shown</button>`:''}${sel.size? `<button class="btn sm" data-act="sel-none">Clear selection</button>`:''}`}</div>
  </div>
  ${list.length? `<div class="lib">${list.map(t=>{ const on=sel.has(t.id); const used=Object.values(S.assignments).filter(a=>a.templateId===t.id).length; const ok=ready(t);
    return `<article class="card box ${on?'on':''}">
      ${isGuest()?'':`<label class="pick"><input type="checkbox" id="pick-${t.id}" data-act="pick" data-v="${t.id}" ${on?'checked':''}> <span>${on?'Selected':'Select'}</span></label>`}
      <div class="row">${t.group?`<span class="pill info">${esc(t.group.replace(' activities',''))}</span>`:''}${t.teamwork?'<span class="pill warn">Group activity</span>':''}${isGuest()?'':ok?'<span class="pill ok">Ready</span>':`<span class="pill warn">${[!(t.docs||[]).length&&'document',!chartOf(t)&&'EHR chart'].filter(Boolean).join(' + ').replace(/^./,c=>'Needs '+c)}</span>`}${used&&!isGuest()?`<span class="pill">Assigned ${used}×</span>`:''}</div>
      <h3>${esc(t.title)}</h3>
      ${t.description?`<p class="small muted clamp">${esc(t.description)}</p>`:''}
      ${(t.tags||[]).length?`<div class="tags">${t.tags.map(x=>`<span>${esc(x)}</span>`).join('')}</div>`:''}
      <div class="meta"><span>${(t.docs||[]).length? '📄 '+esc(t.docs[0].name) : 'No document yet'}</span><span>${chartOf(t)? '🩺 '+esc(S.patients[chartOf(t)].name) : 'No EHR chart yet'}</span></div>
      <div class="foot">${isGuest()? ((t.docs||[]).length?`<a class="btn sm" href="/api/files/${esc(t.docs[0].fid)}" download>Download document</a>`:'') : `<button class="btn sm" data-act="edit-tpl" data-v="${t.id}">${ready(t)?'Edit activity':'Set up'}</button>${chartOf(t)?`<button class="btn sm" data-act="edit-ehr" data-v="${esc(chartOf(t))}">Edit EHR</button>`:''}`}${ehrBtn(t)}</div></article>`; }).join('')}</div>`
  : `<div class="panel empty"><b>No activities match</b><span>Clear a filter, or create a new activity.</span></div>`}
  ${sel.size && !isGuest()? `<div class="selbar"><span><b>${sel.size}</b> selected${[...sel].some(id=>S.library[id]&&!ready(S.library[id]))?' · some need a document or link':''}</span><button class="btn primary" data-act="assign-sel">Assign selected</button></div>`:''}`;
};
function openAssign(tids){ S.form={tids, due:'', target:'all'}; S.route={name:'assign',p:{}}; render(); window.scrollTo(0,0); }
VIEWS.assign=()=>{
  const f=S.form; const items=f.tids.map(id=>({id,...S.library[id]})).filter(t=>t.title);
  const okN=items.filter(ready).length;
  return `
  <div class="page-head"><div><button class="btn sm" data-act="go" data-v="library">← Library</button><span class="label" style="margin-top:8px">Assign to students</span><h1>${items.length===1? esc(items[0].title) : `${items.length} activities`}</h1></div></div>
  <section class="panel panel-pad stack" style="max-width:860px">
    <div class="grid2">
      <label class="field"><span>Assign to</span><select id="as-target" data-bind="target"><option value="all">All students</option>${sections().map(s=>`<option value="${esc(s)}" ${f.target===s?'selected':''}>Section ${esc(s)}</option>`).join('')}</select></label>
      <label class="field"><span>Due date</span><input type="date" id="as-due" data-bind="due" value="${esc(f.due)}"></label>
    </div>
    <div class="stack" style="gap:6px"><span class="label">Each student will receive</span>
      ${tbl(['Activity','EHR patient chart','Document',''], items.map(t=>`<tr><td><b>${esc(t.title)}</b></td>
        <td>${ehrHref(t)? `<a href="${esc(ehrHref(t))}" target="_blank" rel="noopener">${esc(S.patients[chartOf(t)].name)}</a>` : '<span class="flag-H">Missing</span>'}</td>
        <td>${(t.docs||[]).length? esc(t.docs.map(d=>d.name).join(', ')) : '<span class="flag-H">Missing</span>'}</td>
        <td>${ready(t)? '<span class="pill ok">Ready</span>' : `<button class="btn sm" data-act="edit-tpl" data-v="${t.id}">Fix</button>`}</td></tr>`))}
      ${okN<items.length? `<p class="hint">${items.length-okN} activit${items.length-okN===1?'y is':'ies are'} missing a document or EHR patient chart and will be skipped. Use Fix to add it.</p>`:''}
    </div>
    <div class="row"><button class="btn" data-act="go" data-v="library">Cancel</button><button class="btn primary" data-act="do-assign" ${okN?'':'disabled'}>Assign ${okN} activit${okN===1?'y':'ies'}</button></div>
  </section>`;
};
async function doAssign(){
  const f=S.form; if(!f.due && !S.program) return toast('Choose a due date.');
  const items=f.tids.map(id=>({id,...S.library[id]})).filter(t=>t.title && ready(t));
  if(!items.length) return toast('None of the selected activities has both a document and an EHR patient chart yet.');
  let n=0;
  for(const t of items){
    const a={teamwork:!!t.teamwork, title:t.title, category:t.group||'', description:t.description||'', instructions:t.instructions||'', docs:t.docs, keyDocs:t.keyDocs||[], ehr:t.ehr, points:t.points||100, due:f.due, target:f.target||'all', templateId:t.id, createdAt:Date.now(), createdBy:S.me.id};
    if(await API.saveAssignment('a'+uid(), a)) n++; else break;
  }
  if(n){ toast(`Assigned ${n} activit${n===1?'y':'ies'}. Students can see ${n===1?'it':'them'} now.`); S.sel.clear(); go('assignments'); }
}

/* ================= Assigned work ================= */
VIEWS.assignments=()=>{
  const asg=allAssignments();
  return `
  <div class="page-head"><div><span class="label">Coursework</span><h1>Assigned work</h1><p class="muted">Activities currently assigned to students.</p></div>
    <div class="row"><button class="btn" data-act="new-asg">One-off assignment</button><button class="btn primary" data-act="go" data-v="library">Assign from library</button></div></div>
  <section class="panel">${asg.length? asg.map(a=>{
    const n=targetStudents(a).length;
    const subs=Object.keys(S.work).filter(sid=>sub(sid,a.id)?.status==='submitted').length;
    const toGrade=Object.keys(S.work).filter(sid=>sub(sid,a.id)?.status==='submitted' && !grade(sid,a.id)).length;
    return `<div class="asg"><div class="stack" style="gap:6px;min-width:0">
      <div class="row">${a.due&&a.due<TODAY?'<span class="pill">Closed</span>':'<span class="pill info">Open</span>'}${toGrade?`<span class="pill warn">${toGrade} to grade</span>`:''}</div>
      <h3>${esc(a.title)}</h3>
      <div class="meta"><span>Due ${fmtDate(a.due)}</span><span>${a.target==='all'?'All students':'Section '+esc(a.target)}</span><span>EHR: ${esc(ehrLabel(a)||'none')}</span><span>${a.points||100} pts</span><span>${subs}${n?'/'+n:''} submitted</span></div>
    </div><div class="row"><button class="btn" data-act="edit-asg" data-v="${a.id}">Edit</button><button class="btn primary" data-act="review" data-v="${a.id}">Submissions</button></div></div>`; }).join('')
  : `<div class="empty"><b>Nothing assigned yet</b><span>Pick an activity from the library and assign it to a section.</span><button class="btn primary" data-act="go" data-v="library">Open library</button></div>`}</section>`;
};

/* ---------- builder ---------- */
function openBuilder(kind, id){
  const src = id? clone(kind==='template'? S.library[id] : S.assignments[id]) : null;
  const base = src || {title:'', group:'My activities', tags:[], description:'', level:'All levels', instructions:'', docs:[], keyDocs:[], ehr:{type:'chart', chartId:''}, points:100, due:'', target:'all'};
  base.ehr = base.ehr?.type==='chart'? base.ehr : {type:'chart', chartId:''};
  S.form={kind, id:id||null, ...base, docs:base.docs||[], keyDocs:base.keyDocs||[]};
  S.route={name:'builder', p:{}}; render(); window.scrollTo(0,0);
}
VIEWS.builder=()=>{
  const f=S.form; const isT=f.kind==='template'; const pts=Object.entries(S.patients); const up=S.upload;
  const uploader=(slot,label,hint)=>`<label class="btn sm" style="align-self:flex-start"><input type="file" id="up-${slot}" data-act="upload" data-slot="${slot}" accept=".docx,.pdf,.xlsx,.pptx,.png,.jpg,.jpeg" hidden>${label}</label>${up?.slot===slot?`<span class="small muted">Uploading ${esc(up.name)}… ${Math.round(up.p*100)}%</span>`:''}<span class="hint">${hint}</span>`;
  return `
  <div class="page-head"><div><button class="btn sm" data-act="go" data-v="${isT?'library':'assignments'}">← ${isT?'Library':'Assigned work'}</button><span class="label" style="margin-top:8px">${isT?(f.id?'Edit library activity':'New library activity'):(f.id?'Edit assignment':'One-off assignment')}</span><h1>${esc(f.title)||'Untitled activity'}</h1></div>
    <div class="row">${f.id?'<button class="btn danger" data-act="del-built">Delete</button>':''}${!isT?'<button class="btn" data-act="save-as-tpl">Save copy to library</button>':''}<button class="btn primary" data-act="save-built">${isT?'Save to library':(f.id?'Save changes':'Assign to students')}</button></div></div>
  <section class="panel panel-pad stack">
    <label class="field"><span>Title</span><input type="text" id="b-title" data-bind="title" value="${esc(f.title)}" placeholder="e.g. Analyzing for Chart Deficiencies (BS)"></label>
    <div class="grid2">
      ${isT? `<label class="field"><span>Group</span><input type="text" id="b-grp" data-bind="group" value="${esc(f.group||'')}" list="grp-list"><datalist id="grp-list">${[...new Set(['Core activities','Application activities',...Object.values(S.library).map(t=>t.group).filter(Boolean)])].map(c=>`<option value="${esc(c)}">`).join('')}</datalist></label>
        <label class="field"><span>Tags (comma separated)</span><input type="text" id="b-tags" data-bind="tagsText" value="${esc(f.tagsText??(f.tags||[]).join(', '))}" placeholder="HIT/M, Inpatient, Coding"></label>`
      : `<label class="field"><span>Due date</span><input type="date" id="b-due" data-bind="due" value="${esc(f.due)}"></label>
        <label class="field"><span>Assign to</span><select id="b-target" data-bind="target"><option value="all">All students</option>${sections().map(s=>`<option value="${esc(s)}" ${f.target===s?'selected':''}>Section ${esc(s)}</option>`).join('')}</select></label>`}
      <label class="field"><span>Points</span><input type="number" min="1" id="b-pts" data-bind="points" value="${esc(f.points)}"></label>
      <label class="row small" style="gap:6px;align-self:end"><input type="checkbox" id="b-team" data-bind="teamwork" ${f.teamwork?'checked':''}> Group activity: students work in teams (set on the Students page); one member submits for the team</label>
    </div>
    ${isT?`<label class="field"><span>Description shown on the box</span><textarea id="b-desc" data-bind="description" rows="3">${esc(f.description||'')}</textarea></label>`:''}
    <label class="field"><span>Short instructions shown on the assignment page (optional)</span><textarea id="b-ins" data-bind="instructions" rows="3" placeholder="Download the activity document, open the EHR, answer in the document and upload it here.">${esc(f.instructions)}</textarea></label>
  </section>
  <section class="panel panel-pad stack"><h2>1 · Activity document</h2><p class="muted small">The Word file students download, complete and upload back. Answers go in this document only.</p>
    <div class="files">${f.docs.map((d,i)=>fileRow(d,`<button class="btn sm danger" data-act="rm-doc-file" data-slot="docs" data-v="${i}">Remove</button>`)).join('')}</div>
    ${uploader('docs','+ Upload document','Word (.docx) recommended. PDF, Excel, PowerPoint and images also work. Up to 15 MB.')}
  </section>
  <section class="panel panel-pad stack"><h2>2 · EHR patient chart</h2><p class="muted small">The CodeLab EHR record students review for this activity. It opens in a new tab. Build or edit records under EHR patient charts.</p>
    <div class="row" style="align-items:flex-end"><label class="field" style="flex:1;min-width:220px"><span>Patient chart</span><select id="b-chart" data-bind="ehr.chartId" data-rerender><option value="">Choose a patient…</option>${pts.map(([id,x])=>`<option value="${id}" ${id===f.ehr.chartId?'selected':''}>${esc(x.name)} · ${esc(x.mrn)}</option>`).join('')}</select></label>
      ${f.ehr.chartId&&S.patients[f.ehr.chartId]?`<a class="btn" href="${esc('/ehr/'+f.ehr.chartId)}" target="_blank" rel="noopener">Preview ↗</a><button class="btn" data-act="edit-ehr" data-v="${esc(f.ehr.chartId)}">Edit this EHR</button>`:''}<button class="btn" data-act="new-case">New EHR record</button></div>
    <p class="hint">Editing an EHR record changes it for every activity that uses it. Save this activity first so your changes here are not lost.</p>
  </section>
  <section class="panel panel-pad stack"><h2>3 · Answer key <span class="pill">Faculty only</span></h2><p class="muted small">Optional. Students never see this file.</p>
    <div class="files">${f.keyDocs.map((d,i)=>fileRow(d,`<button class="btn sm danger" data-act="rm-doc-file" data-slot="keyDocs" data-v="${i}">Remove</button>`)).join('')}</div>
    ${uploader('keyDocs','+ Upload answer key','Visible to faculty and admin when grading.')}
  </section>`;
};
function builtEhr(f){ return f.ehr?.chartId && S.patients[f.ehr.chartId]? {type:'chart', chartId:f.ehr.chartId} : null; }
async function saveBuilt(asTemplate){
  const f=S.form;
  if(!f.title.trim()) return toast('Add a title before saving.');
  if(S.upload) return toast('Wait for the upload to finish.');
  if(!f.docs.length) return toast('Upload the activity document students will complete.');
  const ehr=builtEhr(f);
  const common={title:f.title.trim(), instructions:f.instructions||'', docs:f.docs, keyDocs:f.keyDocs, ehr, points:+f.points||100, teamwork:!!f.teamwork};
  if(f.kind==='template' || asTemplate){
    const prev= f.kind==='template' && f.id? S.library[f.id] : null;
    const tags=(f.tagsText!=null? f.tagsText.split(',') : (f.tags||[])).map(x=>String(x).trim()).filter(Boolean);
    const t={...common, title:common.title+(asTemplate?' (copy)':''), group:f.group||prev?.group||'Other', description:f.description||'', tags, level:f.level||prev?.level||'', source:prev?.source||'', updatedAt:Date.now(), createdBy: prev?.createdBy||S.me.id};
    if(await API.saveTemplate((f.kind==='template' && f.id) || ('L'+uid()), t)){ toast(asTemplate?'Saved a copy to the library':'Saved to the library'); go('library'); }
    return;
  }
  if(!f.due && !S.program) return toast('Choose a due date.');
  if(!ehr) return toast('Choose the EHR patient chart students will use.');
  const prev=f.id? S.assignments[f.id] : null;
  const a={...common, category:prev?.category||'', due:f.due, target:f.target||'all', createdAt: prev?.createdAt||Date.now(), createdBy: prev?.createdBy||S.me.id};
  if(prev?.templateId) a.templateId=prev.templateId;
  if(await API.saveAssignment(f.id||('a'+uid()), a)){ toast(f.id?'Assignment saved':'Assigned to students'); go('assignments'); }
}

/* ---------- review & grade ---------- */
VIEWS.review=({aid})=>{
  const a={id:aid,...S.assignments[aid]}; if(!S.assignments[aid]) return `<div class="empty">This assignment was deleted.</div>`;
  const ids=new Set([...targetStudents(a).map(s=>s.id), ...Object.keys(S.work).filter(sid=>sub(sid,aid))]);
  const order={submitted:0,overdue:1,new:2,graded:3};
  const rows=[...ids].map(sid=>({sid, st:studentStatus(sid,a), s:sub(sid,aid), g:grade(sid,aid)})).sort((x,y)=> a.teamwork? ((S.students[x.sid]?.team||'~').localeCompare(S.students[y.sid]?.team||'~',undefined,{numeric:true}) || order[x.st.k]-order[y.st.k]) : order[x.st.k]-order[y.st.k]);
  return `
  <div class="page-head"><div><button class="btn sm" data-act="go" data-v="assignments">← Assigned work</button><h1 style="margin-top:8px">${esc(a.title)}</h1>
    <div class="meta"><span>Due ${fmtDate(a.due)}</span><span>${a.target==='all'?'All students':'Section '+esc(a.target)}</span><span>${a.points||100} points</span></div></div>
    <div class="row">${ehrBtn(a,'btn')}<button class="btn" data-act="edit-asg" data-v="${aid}">Edit assignment</button></div></div>
  ${(a.docs||[]).length||(a.keyDocs||[]).length? `<section class="panel panel-pad stack"><div class="grid2">
    <div class="stack" style="gap:6px"><span class="label">Activity document</span><div class="files">${(a.docs||[]).map(d=>fileRow(d)).join('')}</div></div>
    <div class="stack" style="gap:6px"><span class="label">Answer key</span><div class="files">${(a.keyDocs||[]).map(d=>fileRow(d)).join('')||'<p class="hint">None uploaded.</p>'}</div></div></div></section>`:''}
  <section class="panel">${rows.length? tbl(['Student','Section',...(a.teamwork?['Team']:[]),'Status','Submitted','Codes in EHR','Document','Grade',''], rows.map(r=>`<tr><td><div class="person">${avatar(r.sid)}${esc(name(r.sid))}</div></td><td>${esc(S.students[r.sid]?.section||'—')}</td>${a.teamwork?`<td>${esc(S.students[r.sid]?.team||'No team')}${r.s?.byName?`<div class="small muted">submitted by ${esc(r.s.byName)}</div>`:''}</td>`:''}
      <td><span class="pill ${r.st.cls}">${esc(r.st.label)}</span></td><td class="num">${fmtWhen(r.s?.submittedAt)}</td><td class="num">${(()=>{ const ab=S.abstracts?.[r.sid]?.[aid]; return ab? ((ab.dx||[]).length+(ab.px||[]).length)+' codes' : '—'; })()}</td>
      <td>${r.s?.file? `<button class="btn sm" data-act="dl" data-f='${esc(JSON.stringify(r.s.file))}'>Download</button>`:'<span class="muted">—</span>'}</td>
      <td class="num">${r.g? r.g.score+'/'+(a.points||100):'—'}</td>
      <td>${r.s?.file||S.abstracts?.[r.sid]?.[aid]? `<button class="btn sm ${r.g?'':'primary'}" data-act="grade" data-v="${aid}" data-s="${esc(r.sid)}">${r.g?'Open':'Grade'}</button>`:''}</td></tr>`)) : `<div class="empty">No students are assigned yet. Add students on the People page.</div>`}</section>`;
};
function openGrade(aid, sid){ const g=grade(sid,aid); S.form={aid, sid, score:g?.score??'', feedback:g?.feedback||'', file:g?.file||null}; S.route={name:'grade', p:{aid, sid}}; render(); window.scrollTo(0,0); }
VIEWS.grade=({aid,sid})=>{
  const a={id:aid,...S.assignments[aid]}, s=sub(sid,aid), g=grade(sid,aid), f=S.form, up=S.upload;
  return `
  <div class="page-head"><div><button class="btn sm" data-act="review" data-v="${aid}">← Submissions</button>
    <div class="person" style="margin-top:10px">${avatar(sid)}<h1>${esc(name(sid))}</h1></div>
    <div class="meta"><span>${esc(a.title)}</span><span>Submitted ${fmtWhen(s?.submittedAt)}</span>${isLate(a,s?.submittedAt)?'<span class="flag-H">Late</span>':''}${g?`<span>Graded ${fmtWhen(g.gradedAt)}</span>`:''}</div></div>${ehrBtn(a,'btn')}</div>
  <div class="grid2" style="align-items:start">
    <section class="panel panel-pad stack"><h2>Student's document</h2>
      <div class="files">${s?.file? fileRow(s.file) : '<p class="muted">No document submitted.</p>'}</div>
      ${s?.note?`<div><span class="label">Note from student</span><p class="answer" style="margin-top:6px">${esc(s.note)}</p></div>`:''}
      ${(a.keyDocs||[]).length?`<div class="stack" style="gap:6px"><span class="label">Answer key</span><div class="files">${a.keyDocs.map(d=>fileRow(d)).join('')}</div></div>`:''}
    </section>
    <section class="panel panel-pad stack"><h2>Grade</h2>
      ${a.teamwork && S.students[sid]?.team? `<label class="row small" style="gap:6px"><input type="checkbox" id="g-team" data-bind="applyTeam" ${f.applyTeam!==false?'checked':''}> Give this grade and feedback to all of ${esc(S.students[sid].team)}: ${esc(students().filter(x=>x.team===S.students[sid].team && x.active).map(x=>x.name).join(', '))}</label>`:''}
      <label class="field"><span>Score (out of ${a.points||100})</span><input type="number" min="0" max="${a.points||100}" step="0.5" id="g-score" data-bind="score" value="${esc(f.score)}" style="max-width:140px"></label>
      <label class="field"><span>Feedback to student</span><textarea id="g-fb" data-bind="feedback" rows="6" placeholder="What they did well, what to review">${esc(f.feedback)}</textarea></label>
      <div class="field"><span>Marked copy for the student (optional)</span>
        <div class="files">${f.file? fileRow(f.file,`<button class="btn sm danger" data-act="rm-graded-file">Remove</button>`):''}</div>
        ${f.file?'':`<label class="btn sm" style="align-self:flex-start"><input type="file" id="up-graded" data-act="upload" data-slot="graded" accept=".docx,.pdf" hidden>+ Upload marked copy</label>`}${up?.slot==='graded'?`<span class="small muted">Uploading ${esc(up.name)}… ${Math.round(up.p*100)}%</span>`:''}</div>
      <div class="row" style="justify-content:flex-end"><button class="btn primary" data-act="save-grade">${g?'Update grade':'Return grade to student'}</button></div>
    </section>
  </div>
  <section class="panel panel-pad stack"><div class="row" style="justify-content:space-between"><h2>Coding summary entered in the EHR</h2>${ehrHref(a)?`<a class="btn sm" href="${esc(ehrHref(a))}" target="_blank" rel="noopener">Open the record ↗</a>`:''}</div>${ewAbstractView(S.abstracts?.[sid]?.[aid], S.patients[chartOf(a)])}</section>`;
};
async function saveGrade(){
  const f=S.form, a=S.assignments[f.aid]; const max=a.points||100;
  if(f.score==='' || isNaN(+f.score)) return toast('Enter a score.');
  if(S.upload) return toast('Wait for the upload to finish.');
  const g={score:Math.min(Math.max(+f.score,0),max), max, feedback:f.feedback||'', gradedAt:Date.now(), gradedBy:S.me.id, applyTeam:!!(a.teamwork && S.students[f.sid]?.team && f.applyTeam!==false)}; if(f.file) g.file=f.file;
  if(await API.saveGrade(f.sid, f.aid, g)){ toast('Grade returned to '+name(f.sid)); go('review',{aid:f.aid}); }
}

/* ================= Patient charts ================= */
VIEWS.cases=()=>{
  const pts=Object.entries(S.patients);
  return `
  <div class="page-head"><div><span class="label">${isGuest()?'Guest preview':'Optional'}</span><h1>EHR patient charts</h1><p class="muted">${isGuest()?'Fictional training records. Students open the record for their activity in a new tab.':'Training records hosted in CodeLab. Choose one as the EHR for an activity and students open it in a new tab.'}</p></div>
    ${isGuest()?'':'<button class="btn primary" data-act="new-case">New patient chart</button>'}</div>
  <section class="panel">${pts.length? tbl(['Record','MR# / code','Type','Used by activities','Notes','Student link',''], pts.sort((a,b)=>String(a[1].name).localeCompare(String(b[1].name))).map(([id,raw])=>{ const p=P(raw); const used=Object.values(S.library).filter(t=>chartOf(t)===id).map(t=>t.title);
      return `<tr><td><b>${esc(p.name)}</b><div class="small muted">${p.kind==='dataset'? esc(p.facility) : `${age(p.dob)} y · ${esc(p.sex)}`}</div></td><td class="num">${esc(p.mrn)}</td><td>${p.kind==='dataset'?'Data set':esc(p.encounterType||'—')}</td><td class="small">${used.length? esc(used.slice(0,3).join('; '))+(used.length>3?` +${used.length-3} more`:'') : '<span class="muted">—</span>'}</td><td class="num">${p.docs.length}</td>
      <td><a class="btn sm" href="${esc('/ehr/'+id)}" target="_blank" rel="noopener">Open in new tab ↗</a></td>
      <td><div class="row" style="flex-wrap:nowrap"><button class="btn sm" data-act="view-case" data-v="${id}">View</button>${isGuest()?'':`<button class="btn sm" data-act="edit-case" data-v="${id}">Edit</button>`}</div></td></tr>`; })) : `<div class="empty"><b>No patient charts yet</b><span>You only need these if you are not using an external EHR.</span><button class="btn primary" data-act="new-case">New patient chart</button></div>`}</section>`;
};
VIEWS['case-view']=({pid})=>{ const p=S.patients[pid]; if(!p) return `<div class="empty">Chart not found.</div>`;
  return `<div class="page-head"><div><button class="btn sm" data-act="go" data-v="cases">← Patient charts</button></div><div class="row"><a class="btn" href="${esc('/ehr/'+pid)}" target="_blank" rel="noopener">Open as student ↗</a>${isGuest()?'':`<button class="btn" data-act="edit-case" data-v="${pid}">Edit chart</button>`}</div></div><section class="panel">${chartHTML(p)}</section>`; };
function openCaseEditor(pid){
  const p=P(pid? S.patients[pid] : {name:'', mrn:'MR'+String(Math.floor(10000+Math.random()*89999)), dob:'', sex:'Female', encounterType:'Inpatient', docs:[{id:'n1',title:'History & Physical',author:'',date:'',signed:true,body:''}]});
  const grid={}; Object.entries(TABLES).forEach(([k,d])=>grid[k]=(p[k]||[]).map(r=>d.cols.map(c=>String(r[c]??''))));
  const rgrid=p.reports.map(r=>({columns:[...r.columns], rows:r.rows.map(row=>r.columns.map((_,j)=>String(row[j]??'')))}));
  S.form={pid, p, grid, rgrid}; S.route={name:'case-edit', p:{}}; render(); window.scrollTo(0,0);
}
/* ---- spreadsheet-style grid editor ---- */
const GRID_WIDE=new Set(['desc','item','drug','description','details','subject','name','plan','location','provider','type','ref']);
const GRID_NARROW=new Set(['hr','rr','spo2','pain','flag','unit','status','active','priority','immediacy','frequency','route','number']);
function gridHTML(path, heads, rows, {cols=[], headPath=null, label=''}={}){
  const w=j=>GRID_WIDE.has(cols[j])?'g-wide':GRID_NARROW.has(cols[j])?'g-narrow':'';
  return `<div class="grid-ed" data-path="${path}">
    <div class="grid-scroll"><table><thead><tr><th class="g-n" aria-label="Row"></th>${heads.map((h,j)=>`<th class="${w(j)}">${headPath? `<div class="g-head"><input type="text" aria-label="Column ${j+1} heading" data-bind="${headPath}.${j}" value="${esc(h)}">${heads.length>1?`<button class="g-x" title="Remove this column" aria-label="Remove column ${esc(h)}" data-act="col-del" data-path="${headPath}" data-rows="${path}" data-c="${j}">×</button>`:''}</div>` : esc(h)}</th>`).join('')}${headPath?`<th class="g-act"><button class="btn sm" data-act="col-add" data-path="${headPath}" data-rows="${path}">+ Column</button></th>`:'<th class="g-act"></th>'}</tr></thead>
    <tbody>${rows.map((r,i)=>`<tr><td class="g-n">${i+1}</td>${heads.map((_,j)=>`<td class="${w(j)}"><input type="text" aria-label="${esc(label)} row ${i+1}, ${esc(heads[j])}" data-grid="${path}" data-r="${i}" data-c="${j}" data-bind="${path}.${i}.${j}" value="${esc(r[j]??'')}"></td>`).join('')}<td class="g-act"><button class="g-x" title="Delete row" aria-label="Delete row ${i+1}" data-act="grid-del" data-path="${path}" data-i="${i}">×</button></td></tr>`).join('')
      || `<tr><td></td><td colspan="${heads.length+1}" class="muted small" style="padding:10px">No rows yet.</td></tr>`}</tbody></table></div>
    <div class="row g-foot"><button class="btn sm" data-act="grid-add" data-path="${path}" data-n="${heads.length}">+ Add row</button><span class="hint">Tip: copy cells in Excel and paste them into any cell. Press Enter to move down.</span></div></div>`;
}
VIEWS['case-edit']=()=>{
  const {p,grid,pid}=S.form;
  const fld=(k,l,type='text',ph='')=>`<label class="field"><span>${l}</span><input type="${type}" id="c-${k}" data-bind="p.${k}" value="${esc(p[k]||'')}" placeholder="${esc(ph)}"></label>`;
  const area=k=>`<div class="field"><span>${TABLES[k].label}</span>${gridHTML('grid.'+k, TABLES[k].head.split(' | '), grid[k], {cols:TABLES[k].cols, label:TABLES[k].label})}</div>`;
  const OVL={info:'Patient info',encounters:'Encounters',alerts:'Alerts (allergies)',prevention:'Prevention',problems:'Problems',principal:'Principal diagnosis',vitals:'Vitals',labs:'Labs',orders:'Orders',meds:'Meds',notes:'Notes',advance:'Advance directive'};
  return `
  <div class="page-head"><div><button class="btn sm" data-act="go" data-v="cases">← Patient charts</button><span class="label" style="margin-top:8px">${pid?'Edit chart':'New patient chart'}</span><h1>${esc(p.name)||'Unnamed patient'}</h1><p class="muted">Use fictional training patients only. Edit tables like a spreadsheet, then save.</p></div>
    <div class="row">${pid?'<button class="btn danger" data-act="del-case">Delete</button>':''}<button class="btn primary" data-act="save-case">Save chart</button></div></div>
  <section class="panel panel-pad stack"><div class="grid2"><label class="field"><span>Record type</span><select id="c-kind" data-bind="p.kind" data-rerender><option value="patient" ${p.kind!=='dataset'?'selected':''}>Patient chart</option><option value="dataset" ${p.kind==='dataset'?'selected':''}>Data set (reports and tables only)</option></select></label>
    ${p.kind==='dataset'?`<label class="field"><span>Description shown to students</span><input type="text" id="c-desc" data-bind="p.description" value="${esc(p.description||'')}"></label>`:''}</div></section>
  ${p.kind==='dataset'? `<section class="panel panel-pad stack"><h2>Data set</h2><div class="grid2">${fld('name','Data set name')}${fld('mrn','Code')}${fld('facility','Organization')}</div></section>` : `
  <section class="panel panel-pad stack"><h2>Registration</h2>
    <div class="grid2">${fld('name','Patient name')}${fld('mrn','MR#')}${fld('dob','Date of birth','date')}
      <label class="field"><span>Sex</span><select id="c-sex" data-bind="p.sex">${['Female','Male','Unknown'].map(s=>`<option ${p.sex===s?'selected':''}>${s}</option>`).join('')}</select></label>
      ${fld('facility','Facility')}${fld('encounterType','Encounter type')}${fld('admit','Admit date & time','text','10/09/2026 21:38')}${fld('discharge','Discharge date','text','10/12/2026')}${fld('attending','Attending provider')}${fld('unit','Unit')}${fld('language','Language')}${fld('race','Race / ethnicity')}</div>
    ${fld('contact','Contact information')}
    <div class="grid2"><label class="field"><span>Advance directive (leave blank if none is on file)</span><textarea id="c-ad" data-bind="p.advanceDirective" rows="2">${esc(p.advanceDirective)}</textarea></label>
      <label class="field"><span>Principal diagnosis (leave blank if not designated)</span><textarea id="c-pd" data-bind="p.principalDx" rows="2">${esc(p.principalDx)}</textarea></label></div></section>
  <section class="panel panel-pad stack"><h2>What appears on the Overview tab</h2><p class="hint">Turn a section off to create an "Incomplete" scenario: the data stays on its own tab but is missing from Overview.</p>
    <div class="row">${Object.entries(OVL).map(([k,l])=>`<label class="row small" style="gap:6px"><input type="checkbox" id="c-ov-${k}" data-bind="p.overview.${k}" ${p.overview[k]?'checked':''}> ${l}</label>`).join('')}</div></section>
  <section class="panel panel-pad stack"><h2>Clinical record</h2>${area('allergies')}${area('problems')}${area('vitals')}${area('labs')}${area('orders')}${area('meds')}${area('prevention')}</section>
  <section class="panel panel-pad stack"><h2>Account</h2>${area('encounters')}${area('insurance')}</section>`}
  <section class="stack"><div class="row" style="justify-content:space-between"><h2>Reports, forms & data tables <span class="count">${p.reports.length}</span></h2><button class="btn sm" data-act="add-report">+ Add report</button></div>
    <p class="hint">Use for claim forms, request logs, audit results or data tables. Edit the headings in the top row; add columns and rows as needed.</p>
    ${p.reports.map((r,i)=>`<div class="builder-task"><div class="grid2">
      <label class="field"><span>Title</span><input type="text" id="c-rt-${i}" data-bind="p.reports.${i}.title" value="${esc(r.title)}"></label>
      <label class="field"><span>Table name for SQL (optional)</span><input type="text" id="c-rn-${i}" class="mono" data-bind="p.reports.${i}.table" value="${esc(r.table||'')}"></label></div>
      <label class="field"><span>Note shown above the table (optional)</span><input type="text" id="c-ro-${i}" data-bind="p.reports.${i}.note" value="${esc(r.note||'')}"></label>
      <div class="field"><span>Table</span>${gridHTML(`rgrid.${i}.rows`, S.form.rgrid[i].columns, S.form.rgrid[i].rows, {headPath:`rgrid.${i}.columns`, label:r.title||'Report'})}</div>
      <div class="row" style="justify-content:flex-end"><button class="btn sm danger" data-act="rm-report" data-v="${i}">Remove report</button></div></div>`).join('')}
  </section>
  <section class="stack"><div class="row" style="justify-content:space-between"><h2>Notes <span class="count">${p.docs.length}</span></h2><button class="btn sm" data-act="add-note">+ Add note</button></div>
    ${p.docs.map((d,i)=>`<div class="builder-task"><div class="grid2">
      <label class="field"><span>Note title</span><input type="text" id="c-dt-${i}" data-bind="p.docs.${i}.title" value="${esc(d.title)}"></label>
      <label class="field"><span>Author</span><input type="text" id="c-da-${i}" data-bind="p.docs.${i}.author" value="${esc(d.author)}"></label>
      <label class="field"><span>Date & time</span><input type="text" id="c-dd-${i}" data-bind="p.docs.${i}.date" value="${esc(d.date)}" placeholder="10/12/2026 13:38"></label></div>
      <label class="field"><span>Note text</span><textarea id="c-db-${i}" class="mono" data-bind="p.docs.${i}.body" rows="5">${esc(d.body)}</textarea></label>
      <div class="row" style="justify-content:space-between"><label class="row small"><input type="checkbox" id="c-ds-${i}" data-bind="p.docs.${i}.signed" ${d.signed?'checked':''}> Authenticated (signed)</label><button class="btn sm danger" data-act="rm-note" data-v="${i}">Remove note</button></div></div>`).join('')}
  </section>`;
};
async function saveCase(){
  const {p,grid,pid}=S.form;
  if(!String(p.name).trim()) return toast('Add the patient name.');
  const filled=row=>row.some(v=>String(v??'').trim());
  const out={...p}; Object.entries(TABLES).forEach(([k,d])=>out[k]=grid[k].filter(filled).map(row=>Object.fromEntries(d.cols.map((c,j)=>[c,String(row[j]??'').trim()]))));
  out.reports=p.reports.map((r,i)=>{ const g=S.form.rgrid[i]; const cols=g.columns.map(c=>String(c).trim()); return {title:r.title||'Report', note:r.note||'', table:r.table||'', columns:cols, rows:g.rows.filter(filled).map(row=>cols.map((_,j)=>String(row[j]??'').trim()))}; }).filter(r=>r.columns.some(Boolean));
  out.docs=p.docs.filter(d=>String(d.title).trim()).map(d=>({...d, id:d.id||('n'+uid().slice(-5))}));
  const id=pid||('p'+uid());
  if(await API.savePatient(id,out)){ toast('Chart saved'); go('case-view',{pid:id}); }
}

/* ================= Student ================= */
VIEWS.my=()=>{
  const list=myAssignments(); const me=S.me.id;
  const done=a=>['submitted','graded'].includes(studentStatus(me,a).k);
  const pg=!!S.program;
  const card=a=>{ const st=studentStatus(me,a); if(a.teamwork) a={...a, category:(a.category? a.category+' · ':'')+'Group activity'};
    return `<div class="asg"><div class="stack" style="gap:6px;min-width:0"><div class="row"><span class="pill ${st.cls}">${esc(st.label)}</span>${a.category?`<span class="pill">${esc(a.category)}</span>`:''}</div><h3>${esc(a.title)}</h3>
      <div class="meta">${a.due?`<span>Due ${fmtDate(a.due)}</span>`:''}<span>${a.points||100} pts</span></div></div><button class="btn ${done(a)?'':'primary'}" data-act="work" data-v="${a.id}">${done(a)?'View':'Open'}</button></div>`; };
  const open=list.filter(a=>!done(a)), fin=list.filter(done);
  return `
  <div class="page-head"><div><span class="label">${pg?esc(S.program.title):'Student'}${!pg&&mySection()? ' · Section '+esc(mySection()):''}</span><h1>${pg?'My practicals':'My assignments'}</h1><p class="muted">Download the activity document, do the practical in the EHR, then upload your completed document.${pg?` Each practical needs ${passMark()}% or more to pass; you can resubmit a practical you do not pass.`:''}</p></div></div>
  <section class="stack"><h2>To do <span class="count">${open.length}</span></h2><div class="panel">${open.length? open.map(card).join('') : `<div class="empty">You're all caught up. New assignments from your faculty will appear here.</div>`}</div></section>
  <section class="stack"><h2>Submitted <span class="count">${fin.length}</span></h2><div class="panel">${fin.length? fin.map(card).join('') : `<div class="empty">Nothing submitted yet.</div>`}</div></section>`;
};
VIEWS.work=({aid})=>{
  const a={id:aid,...S.assignments[aid]}; if(!S.assignments[aid]) return `<div class="empty">This assignment is no longer available.</div>`;
  const s=sub(S.me.id,aid), g=grade(S.me.id,aid), st=studentStatus(S.me.id,a), up=S.upload, f=S.form||{};
  const canSubmit=!g || (!!S.program && !passed(g));
  return `
  <div class="page-head"><div><button class="btn sm" data-act="go" data-v="my">← ${S.program?'My practicals':'My assignments'}</button><h1 style="margin-top:8px">${esc(a.title)}</h1>
    <div class="meta">${a.due?`<span>Due ${fmtDate(a.due)}</span>`:''}<span>${a.points||100} points</span><span class="pill ${st.cls}">${esc(st.label)}</span></div></div></div>
  ${a.description?`<p class="scenario muted">${esc(a.description)}</p>`:''}${a.instructions?`<p class="scenario">${esc(a.instructions)}</p>`:''}
  ${a.teamwork? `<div class="panel panel-pad team-box"><b>Group activity.</b> ${S.me.team? `You are in <b>${esc(S.me.team)}</b>: ${esc((S.team||[]).map(x=>x.name).join(', '))}. Work together on the document and in the EHR. <b>One member uploads and submits for the whole team</b>; the submission and the codes entered in the EHR Coding activity are shared with every member.${s?.byName?` Last submitted by ${esc(s.byName)}.`:''}` : 'You have not been placed in a team yet. Ask your faculty to add you to a team. Until then, you can submit on your own.'}</div>`:''}
  <ol class="steps">
    <li class="panel panel-pad stack"><div class="step-h"><span class="step-n">1</span><div><h2>Download the activity document</h2><p class="small muted">Answer every question in this document.</p></div></div>
      <div class="files">${(a.docs||[]).map(d=>fileRow(d)).join('')||'<p class="hint">Your faculty has not attached a document yet.</p>'}</div></li>
    <li class="panel panel-pad stack"><div class="step-h"><span class="step-n">2</span><div><h2>Code from the record in the EHR</h2><p class="small muted">The EHR opens in a new tab. Read the record, look up codes in the <b>Code Book</b>, and enter your codes in the <b>Coding</b> activity: they are saved to this assignment. Keep this page open so you can come back and upload.</p></div></div>
      <div>${ehrHref(a)? `<a class="btn primary" href="${esc(ehrHref(a))}" target="_blank" rel="noopener">Open EHR in new tab ↗</a> <span class="small muted">${esc(ehrLabel(a))}</span>` : '<p class="hint">Your faculty has not linked an EHR record to this assignment yet.</p>'}</div>
      ${(()=>{ const ab=S.abstracts?.[S.me.id]?.[aid]; const nd=(ab?.dx||[]).length, np=(ab?.px||[]).length; return `<p class="small ${ab?'':'muted'}">${ab? `<span class="pill ok">Coding saved</span> ${nd} diagnosis code${nd===1?'':'s'}, ${np} procedure code${np===1?'':'s'} · ${fmtWhen(ab.savedAt)}` : 'No codes entered in the EHR Coding activity yet.'}</p>`; })()}</li>
    <li class="panel panel-pad stack"><div class="step-h"><span class="step-n">3</span><div><h2>Upload your completed document</h2><p class="small muted">Save the document with your answers, then upload it here. ${g&&canSubmit?`<b>Your last attempt scored ${pct(g)}% (pass mark ${passMark()}%).</b> Read the feedback below, correct your work and codes, then submit again.`:canSubmit?'You can replace it until it is graded.':''}</p></div></div>
      ${s?.file? `<div class="stack" style="gap:6px"><span class="label">Submitted ${fmtWhen(s.submittedAt)}${isLate(a,s.submittedAt)?' · late':''}</span><div class="files">${fileRow(s.file)}</div></div>`:''}
      ${canSubmit? `${f.pending? `<div class="files">${fileRow(f.pending,`<button class="btn sm danger" data-act="clear-pending">Remove</button>`)}</div>`:''}
        ${up? `<span class="small muted">Uploading ${esc(up.name)}… ${Math.round(up.p*100)}%</span>` : (f.pending? '' : `<label class="btn" style="align-self:flex-start"><input type="file" id="up-sub" data-act="upload" data-slot="sub" accept=".docx,.pdf" hidden>${s?.file?'Choose a replacement file':'Choose your completed file'}</label>`)}
        <label class="field"><span>Note to faculty (optional)</span><input type="text" id="w-note" data-bind="note" value="${esc(f.note??s?.note??'')}"></label>
        <div class="row"><button class="btn primary" data-act="submit-file" ${f.pending?'':'disabled'}>${s?.file?'Replace submission':'Submit'}</button></div>` : ''}
    </li>
  </ol>
  ${g? `<section class="panel panel-pad stack"><div class="row" style="justify-content:space-between"><div><span class="label">Grade</span><div class="mono" style="font-size:2rem;font-weight:600">${g.score} <span class="muted" style="font-size:1rem">/ ${a.points||100}</span></div></div><span class="pill ok">Graded ${fmtWhen(g.gradedAt)}</span></div>
    ${g.feedback?`<div><span class="label">Feedback</span><p class="answer" style="margin-top:6px">${esc(g.feedback)}</p></div>`:''}
    ${g.file?`<div class="stack" style="gap:6px"><span class="label">Marked copy from faculty</span><div class="files">${fileRow(g.file)}</div></div>`:''}</section>`:''}`;
};
async function submitFile(){
  const f=S.form, a=S.assignments[S.route.p.aid]; if(!f?.pending) return;
  const prev=sub(S.me.id,S.route.p.aid);
  const s={status:'submitted', file:f.pending, note:(f.note??prev?.note??'').trim(), submittedAt:Date.now(), history:[...(prev?.history||[]), ...(prev?.file?[{file:prev.file, at:prev.submittedAt}]:[])].slice(-5)};
  if(await API.saveWork(S.route.p.aid, s)){ toast(isLate(a,s.submittedAt)?'Submitted (after the due date).':'Submitted. Your faculty can now grade it.'); S.form={}; render(); }
}
VIEWS.grades=()=>{
  const me=S.me.id; const list=myAssignments().filter(a=>grade(me,a.id));
  const got=list.reduce((s,a)=>s+grade(me,a.id).score,0), max=list.reduce((s,a)=>s+(a.points||100),0);
  return `
  <div class="page-head"><div><span class="label">Student</span><h1>My grades</h1></div></div>
  <div class="stats"><div class="panel stat"><span class="label">Overall</span><b>${max? Math.round(got/max*100)+'%':'—'}</b><span class="small muted mono">${got} / ${max} pts</span></div>
    <div class="panel stat"><span class="label">Graded</span><b>${list.length}</b><span class="small muted">of ${myAssignments().length} assignments</span></div></div>
  <section class="panel">${list.length? tbl(['Assignment','Score','%','Graded',''], list.map(a=>{ const g=grade(me,a.id); return `<tr><td>${esc(a.title)}</td><td class="num">${g.score}/${a.points||100}</td><td class="num">${Math.round(g.score/(a.points||100)*100)}%</td><td class="num">${fmtWhen(g.gradedAt)}</td><td><button class="btn sm" data-act="work" data-v="${a.id}">Feedback</button></td></tr>`; })) : `<div class="empty">No grades yet.</div>`}</section>`;
};


/* ================= events ================= */
document.addEventListener('click', async e=>{
  const el=e.target.closest('[data-act]'); if(!el || el.tagName==='INPUT' || el.tagName==='SELECT') return;
  const v=el.dataset.v, act=el.dataset.act;
  const confirmTwice=label=>{ if(el.dataset.confirm) return true; el.dataset.confirm='1'; el.textContent=label; return false; };
  switch(act){
    case 'go': if(S.route.name==='appearance') applyTheme(S.site); go(v); break;
    case 'logout': { const slug=S.org?.slug; try{ await api('POST','/api/logout',{}); }catch(_){} location.href= slug? '/c/'+encodeURIComponent(slug) : '/'; break; }
    case 'lib-cat': S.lib.cat=v; render(); break;
    case 'new-tpl': openBuilder('template', null); break;
    case 'edit-tpl': openBuilder('template', v); break;
    case 'dup-tpl': { const t=clone(S.library[v]); t.title+=' (copy)'; t.updatedAt=Date.now(); const id='L'+uid(); if(await API.saveTemplate(id,t)){ toast('Duplicated'); openBuilder('template', id); } break; }
    case 'assign-tpl': openAssign([v]); break;
    case 'assign-sel': openAssign([...S.sel].filter(id=>S.library[id])); break;
    case 'sel-all': libFiltered().forEach(t=>S.sel.add(t.id)); render(); break;
    case 'sel-none': S.sel.clear(); render(); break;
    case 'do-assign': doAssign(); break;
    case 'new-asg': openBuilder('assignment', null); break;
    case 'edit-asg': openBuilder('assignment', v); break;
    case 'rm-doc-file': S.form[el.dataset.slot].splice(+v,1); render(); break;
    case 'save-built': saveBuilt(false); break;
    case 'save-as-tpl': saveBuilt(true); break;
    case 'del-built': if(!confirmTwice('Click again to delete')) return;
      if(S.form.kind==='template'){ if(await API.deleteTemplate(S.form.id)){ toast('Removed from library'); go('library'); } } else { if(await API.deleteAssignment(S.form.id)){ toast('Assignment deleted'); go('assignments'); } } break;
    case 'review': go('review',{aid:v}); break;
    case 'grade': openGrade(v, el.dataset.s); break;
    case 'save-grade': saveGrade(); break;
    case 'rm-graded-file': S.form.file=null; render(); break;
    case 'new-case': openCaseEditor(null); break;
    case 'edit-case': openCaseEditor(v); break;
    case 'view-case': go('case-view',{pid:v}); break;
    case 'add-report': S.form.p.reports.push({title:'',note:'',table:'',columns:[],rows:[]}); S.form.rgrid.push({columns:['Column A','Column B'],rows:[['','']]}); render(); break;
    case 'rm-report': S.form.p.reports.splice(+v,1); S.form.rgrid.splice(+v,1); render(); break;
    case 'grid-add': { const rows=getPath(S.form, el.dataset.path); rows.push(Array(+el.dataset.n||getPath(S.form, el.dataset.path.replace(/\.rows$/,'.columns'))?.length||1).fill('')); render(); focusCell(el.dataset.path, rows.length-1, 0); break; }
    case 'grid-del': getPath(S.form, el.dataset.path).splice(+el.dataset.i,1); render(); break;
    case 'col-add': { const cols=getPath(S.form, el.dataset.path); cols.push('Column '+String.fromCharCode(65+cols.length%26)); getPath(S.form, el.dataset.rows).forEach(r=>r.push('')); render(); break; }
    case 'col-del': { const c=+el.dataset.c; getPath(S.form, el.dataset.path).splice(c,1); getPath(S.form, el.dataset.rows).forEach(r=>r.splice(c,1)); render(); break; }
    case 'edit-ehr': if(v && S.patients[v]) openCaseEditor(v); break;
    case 'add-note': S.form.p.docs.push({id:'n'+uid().slice(-5), title:'', author:'', date:'', signed:true, body:''}); render(); break;
    case 'rm-note': S.form.p.docs.splice(+v,1); render(); break;
    case 'save-case': saveCase(); break;
    case 'del-case': { const pid=S.form.pid; if([...Object.values(S.assignments),...Object.values(S.library)].some(a=>a.ehr?.type==='chart'&&a.ehr.chartId===pid)) return toast('An activity uses this chart as its EHR. Change that activity first.');
      if(!confirmTwice('Click again to delete')) return; if(await API.deletePatient(pid)){ toast('Chart deleted'); go('cases'); } break; }
    case 'chart-tab': S.chartTab=v; S.openNote=null; render(); break;
    case 'open-note': S.chartTab='notes'; S.openNote=v; render(); if(window.innerWidth<900) document.querySelector('.note-view')?.scrollIntoView({block:'start'}); break;
    case 'work': S.route={name:'work',p:{aid:v}}; S.form={}; S.upload=null; render(); window.scrollTo(0,0); break;
    case 'clear-pending': S.form.pending=null; render(); break;
    case 'submit-file': submitFile(); break;
    case 'theme-pick': S.form.theme=v; S.form.custom={}; applyTheme(S.form); render(); break;
    case 'theme-color-reset': delete S.form.custom[el.dataset.k]; applyTheme(S.form); render(); break;
    case 'theme-cancel': openAppearance(); applyTheme(S.site); render(); break;
    case 'tour': startTour(); break;
    case 'open-college': S.ocreds=null; go('college',{id:v}); break;
    case 'close-ocreds': S.ocreds=null; render(); break;
    case 'org-extend': { const id=S.route.p.id; if(await write(()=>api('PATCH','/api/owner/orgs/'+id,{extendMonths:+v}))){ S.form=null; toast(`Subscription extended by ${v} month${+v>1?'s':''}`); render(); } break; }
    case 'org-save': { const f=S.form, id=S.route.p.id; if(await write(()=>api('PATCH','/api/owner/orgs/'+id,{name:f.name,slug:f.slug,maxStudents:f.maxStudents===''?0:+f.maxStudents,expiresOn:f.expiresOn||null,contact:f.contact,notes:f.notes}))){ S.form=null; toast('College saved'); render(); } break; }
    case 'org-pause': { const o=S.orgs.find(x=>x.id===S.route.p.id); if(o.status==='active' && !confirmTwice('Click again to pause')) return;
      if(await write(()=>api('PATCH','/api/owner/orgs/'+o.id,{status:o.status==='active'?'suspended':'active'}))){ S.form=null; toast(o.status==='active'?'College paused':'College resumed'); render(); } break; }
    case 'org-delete': { const id=S.route.p.id; if(!confirmTwice('Click again to delete permanently')) return;
      try{ await api('DELETE','/api/owner/orgs/'+id,{confirm:S.form.confirm||''}); await refresh(); toast('College deleted'); go('colleges'); }catch(err){ toast(err.message); } break; }
    case 'org-reset-admin': { if(!confirmTwice('Click again to reset')) return; try{ const r=await api('POST',`/api/owner/users/${encodeURIComponent(v)}/reset-password`,{}); const o=S.orgs.find(x=>x.id===S.route.p.id);
      S.ocreds={org:o.name,slug:o.slug,name:r.user.name,email:r.user.email,temp:r.tempPassword}; await refresh(); render(); window.scrollTo(0,0); }catch(err){ toast(err.message); } break; }
    case 'owner-refresh': { if(!confirmTwice('Click again to update all colleges')) return; el.disabled=true; try{ const r=await api('POST','/api/owner/refresh-all',{}); S.ostat=undefined; await refresh(); toast(`Updated ${r.patients} EHR records and ${r.library} activities across ${r.colleges} colleges`); render(); }catch(err){ toast(err.message); } break; }
    case 'tour-next': if(S.tour>=TOUR.length-1) endTour(); else { S.tour++; drawTour(); } break;
    case 'tour-prev': S.tour=Math.max(0,S.tour-1); drawTour(); break;
    case 'tour-end': endTour(); break;
    case 'refresh-content': { if(!confirmTwice('Click again to update')) return; el.disabled=true;
      try{ const r=await api('POST','/api/admin/refresh-content',{}); S.cstat=undefined; await refresh(); toast(`Updated ${r.patients} EHR records, ${r.library} activities and ${r.files} documents`); render(); }catch(err){ toast(err.message); el.disabled=false; } break; }
    case 'logo-remove': S.form.logo=''; applyTheme(S.form); render(); break;
    case 'theme-save': try{ const saved=await api('PUT','/api/settings',Object.fromEntries(APPEAR_KEYS.map(k=>[k,S.form[k]]))); S.site={...DEFAULT_SITE,...saved}; applyTheme(S.site); toast('Appearance saved for everyone'); render(); }catch(err){ toast(err.message); } break;
    case 'dl-creds': downloadCreds(); break;
    case 'copy-join': { const link=location.origin+'/join/'+v; try{ await navigator.clipboard.writeText(link); toast('Link copied: '+link); }catch(_){ toast(link); } break; }
    case 'join-off': if(await write(()=>api('PATCH','/api/joincodes/'+encodeURIComponent(v),{active:false}))) { toast('Code turned off'); render(); } break;
    case 'join-on': if(await write(()=>api('PATCH','/api/joincodes/'+encodeURIComponent(v),{active:true, extendDays: el.dataset.exp? 14 : undefined}))) { toast('Code turned on'); render(); } break;
    case 'join-del': if(!confirmTwice('Click again to delete')) return; if(await write(()=>api('DELETE','/api/joincodes/'+encodeURIComponent(v)))) { toast('Code deleted'); render(); } break;
    case 'join-print': S.acct.printCode=v; render(); setTimeout(()=>window.print(),200); break;
    case 'make-teams': { const sec=document.getElementById('mt-sec').value, size=+document.getElementById('mt-size').value||3;
      const list=students().filter(x=>x.active && (!sec || x.section===sec)).sort((a,b)=>a.name.localeCompare(b.name)); if(!list.length) return toast('No active students to place in teams.');
      if(!confirmTwice(`Click again to make ${Math.ceil(list.length/size)} teams`)) return;
      const n=Math.max(1,Math.round(list.length/size)); const pre=sec? sec+' Team ' : 'Team ';
      try{ for(let i=0;i<list.length;i++) await api('PATCH','/api/users/'+encodeURIComponent(list[i].id),{team:pre+(i%n+1)}); await refresh(); toast(`${list.length} students placed in ${n} teams`); render(); }catch(err){ toast(err.message); } break; }
    case 'clear-teams': { const sec=document.getElementById('mt-sec').value; const list=students().filter(x=>x.team && (!sec || x.section===sec)); if(!list.length) return toast('No teams to clear.');
      if(!confirmTwice('Click again to clear teams')) return; try{ for(const x of list) await api('PATCH','/api/users/'+encodeURIComponent(x.id),{team:''}); await refresh(); toast('Teams cleared'); render(); }catch(err){ toast(err.message); } break; }
    case 'extend-guest': if(await write(()=>api('PATCH','/api/users/'+encodeURIComponent(v),{extendDays:7, active:true}))) { toast('Guest access extended by 7 days'); render(); } break;
    case 'end-guest': if(!confirmTwice('Click again to end access')) return; if(await write(()=>api('PATCH','/api/users/'+encodeURIComponent(v),{endNow:true}))) { toast('Guest access ended'); render(); } break;
    case 'close-creds': S.acct.created=null; render(); break;
    case 'reset-pw': { if(!confirmTwice('Click again to reset')) return;
      try{ const r=await api('POST',`/api/users/${encodeURIComponent(v)}/reset-password`,{}); S.acct.created=[{ok:true,user:r.user,tempPassword:r.tempPassword}]; await refresh(); render(); window.scrollTo(0,0); toast('New temporary password created'); }catch(err){ toast(err.message); } break; }
    case 'toggle-active': { const u=person(v); if(!u) return; if(u.active && !confirmTwice('Click again to deactivate')) return;
      if(await write(()=>api('PATCH','/api/users/'+encodeURIComponent(v),{active:!u.active}))) { toast(u.active?'Account deactivated':'Account reactivated'); render(); } break; }
    case 'rm-user': { if(!confirmTwice('Click again to delete')) return;
      if(await write(()=>api('DELETE','/api/users/'+encodeURIComponent(v)))) { toast('Account deleted'); render(); } break; }
  }
});
document.addEventListener('submit', async e=>{
  const f=e.target.closest('form[data-form]'); if(!f) return; e.preventDefault();
  const d=Object.fromEntries(new FormData(f).entries()); const btn=f.querySelector('button[type=submit]'); if(btn) btn.disabled=true;
  try{
    switch(f.dataset.form){
      case 'login': { const r=await api('POST','/api/login',{email:d.email,password:d.password}); await start(); break; }
      case 'setup': await api('POST','/api/setup',d); await start(); toast('Owner account created'); break;
      case 'password':
        if(d.next!==d.repeat){ toast('The new passwords do not match.'); break; }
        await api('POST','/api/password',{current:d.current,next:d.next}); await refresh(); toast('Password changed'); render(); break;
      case 'add-faculty': { const r=await api('POST','/api/users',{name:d.name,email:d.email,role:'faculty'}); S.acct.created=[{ok:true,...r}]; await refresh(); render(); window.scrollTo(0,0); toast('Faculty account created'); break; }
      case 'add-org': { const f=S.form; const r=await api('POST','/api/owner/orgs',{name:f.name,slug:f.slug,adminName:f.adminName,adminEmail:f.adminEmail,maxStudents:f.maxStudents===''?0:+f.maxStudents,expiresOn:f.expiresOn||null,program:!!f.program});
        S.ocreds={org:r.org.name,slug:r.org.slug,name:r.user.name,email:r.user.email,temp:r.tempPassword}; S.form=null; await refresh(); render(); window.scrollTo(0,0); toast('College created'); break; }
      case 'add-org-admin': { const f=S.form, o=S.orgs.find(x=>x.id===S.route.p.id); const r=await api('POST',`/api/owner/orgs/${o.id}/admins`,{name:f.newAdmin,email:f.newAdminEmail});
        S.ocreds={org:o.name,slug:o.slug,name:r.user.name,email:r.user.email,temp:r.tempPassword}; S.form=null; await refresh(); render(); window.scrollTo(0,0); toast('Admin added'); break; }
      case 'add-guest': { const r=await api('POST','/api/users',{name:d.name,email:d.email,section:d.section,days:+d.days||7,role:'guest'}); S.acct.created=[{ok:true,...r}]; await refresh(); render(); window.scrollTo(0,0); toast('Guest account created'); break; }
      case 'add-student': { S.acct.section=d.section||''; const r=await api('POST','/api/users',{name:d.name,email:d.email,section:d.section,team:d.team,role:'student'}); S.acct.created=[...(S.acct.created||[]),{ok:true,...r}]; await refresh(); render(); window.scrollTo(0,0); toast('Student account created'); break; }
      case 'import': await importRows(parseCsv(d.rows)); break;
      case 'join': { if(d.password!==d.repeat){ toast('The two passwords do not match.'); break; }
        const r=await api('POST','/api/join',{code:d.code,name:d.name,email:d.email,password:d.password}); S.joinOnly=false; history.replaceState(null,'','/c/'+encodeURIComponent(r.slug)); S.orgSlug=r.slug; await start(); toast('Welcome! Your account is ready.'); break; }
      case 'join-code': await joinCheck(d.code); break;
      case 'register': { if(d.password!==d.repeat){ toast('The two passwords do not match.'); break; }
        const r=await api('POST','/api/register',{name:d.name,email:d.email,phone:d.phone,country:d.country,password:d.password,agree:!!d.agree}); S.registerOnly=false; history.replaceState(null,'','/c/'+encodeURIComponent(r.slug)); S.orgSlug=r.slug; await start(); S.route={name:'registration',p:{}}; render(); toast('Account created. Next: pay the fee and upload your receipt.'); break; }
      case 'new-joincode': { const r=await api('POST','/api/joincodes',{section:d.section, days:+d.days||0, maxUses:+d.maxUses||0, label:d.label}); await refresh(); S.acct.newCode=r.code; render(); toast('Class code '+r.code+' created'); break; }
    }
  }catch(err){ toast(err.message); }
  if(btn && document.body.contains(btn)) btn.disabled=false;
});
document.addEventListener('input', e=>{
  const el=e.target;
  if(el.dataset.bind && el.type!=='radio'){ if(!S.form) S.form={}; setPath(S.form, el.dataset.bind, el.type==='checkbox'? el.checked : el.value); }
  const refocus=(id,fn)=>{ clearTimeout(S._t); S._t=setTimeout(()=>{ const pos=el.selectionStart; fn(); render(); const n=document.getElementById(id); if(n){ n.focus(); try{ n.setSelectionRange(pos,pos); }catch(_){} } }, 250); };
  if(el.dataset.act==='theme-color'){ S.form.custom={...S.form.custom,[el.dataset.k]:el.value}; applyTheme(S.form); const sp=el.parentElement.querySelector('.mono'); if(sp) sp.textContent=el.value; }
  if(el.dataset.act==='theme-text'){ S.form[el.dataset.k]=el.value; applyTheme(S.form); const tb=document.querySelector('.top .brand'); if(tb) tb.outerHTML=brandHTML(); }
  if(el.dataset.act==='theme-num'){ S.form[el.dataset.k]=+el.value; applyTheme(S.form); const lab=document.getElementById('v-'+el.dataset.k); if(lab) lab.textContent=el.value+' px'; }
  if(el.dataset.act==='org-name' && S.form && S.form.newOrg && !S.form.slugTouched){ S.form.slug=el.value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40); const sl=document.getElementById('no-slug'); if(sl) sl.value=S.form.slug; }
  if(el.id==='no-slug' && S.form) S.form.slugTouched=true;
  if(el.dataset.act==='chart-q'){ S.chartQ=el.value; if(el.value.trim()) S.chartTab='search'; else if(S.chartTab==='search') S.chartTab='overview'; refocus('chart-q',()=>{}); }
  if(el.dataset.act==='lib-q'){ S.lib.q=el.value; refocus('lib-q',()=>{}); }
  if(el.dataset.act==='stu-q'){ S.acct.q=el.value; refocus('stu-q',()=>{}); }
});
document.addEventListener('change', async e=>{
  const el=e.target;
  if(el.dataset.bind && el.type==='radio'){ setPath(S.form, el.dataset.bind, el.value); render(); }
  if(el.dataset.bind && el.type==='checkbox'){ setPath(S.form, el.dataset.bind, el.checked); }
  if(el.dataset.act==='pick'){ el.checked? S.sel.add(el.dataset.v) : S.sel.delete(el.dataset.v); render(); return; }
  if(el.dataset.act==='lib-tag'){ S.lib.tag=el.value; render(); return; }
  if(el.dataset.act==='lib-ready'){ S.lib.readyOnly=el.checked; render(); return; }
  if(el.dataset.act==='stu-mine'){ S.acct.mine=el.checked; render(); return; }
  if(el.dataset.act==='theme-color'){ render(); return; }
  if(el.dataset.act==='theme-num'){ render(); return; }
  if(el.dataset.act==='theme-bool'){ S.form[el.dataset.k]=el.checked; applyTheme(S.form); render(); return; }
  if(el.dataset.act==='logo-file' && el.files?.[0]){ const file=el.files[0]; el.value='';
    try{ S.form.logo=await logoDataUrl(file); applyTheme(S.form); render(); toast('Logo ready. Click Save for everyone to apply it.'); }catch(err){ toast(err.message); } return; }
  if(el.dataset.act==='set-team'){ if(await write(()=>api('PATCH','/api/users/'+encodeURIComponent(el.dataset.v),{team:el.value.trim()}))) toast('Team updated'); scheduleRender(); }
  if(el.dataset.act==='set-sec'){ if(await write(()=>api('PATCH','/api/users/'+encodeURIComponent(el.dataset.v),{section:el.value.trim()}))) toast('Section updated'); scheduleRender(); }
  if(el.dataset.act==='import-file' && el.files?.[0]){ const text=await el.files[0].text(); el.value=''; await importRows(parseCsv(text)); }
  if(el.dataset.act==='upload' && el.files?.[0]){
    const file=el.files[0], slot=el.dataset.slot;
    if(slot==='sub' && !['docx','pdf'].includes(ext(file.name))) return toast('Upload your completed document as .docx or .pdf.');
    if((slot==='receipt'||slot.startsWith('cert-')) && !['pdf','png','jpg','jpeg'].includes(ext(file.name))) return toast('Upload a PDF, PNG or JPG file.');
    if(!S.form) S.form={};
    const base= slot==='receipt'? 'receipt' : slot.startsWith('cert-')? 'cert/'+slot.slice(5) : slot==='sub'? `work/${S.me.id}/f` : slot==='graded'? `grades/${S.form.sid}/f` : slot==='keyDocs'? 'keyfiles' : 'files';
    const form=S.form; S.upload={slot, name:file.name, p:0}; S.busy=true; render();
    try{
      const meta=await putFile(base, file, p=>{ S.upload.p=p; render(); });
      if(slot==='receipt') form.receipt=meta; else if(slot.startsWith('cert-')){ ((S.certForm||={})[slot.slice(5)]||={}).file=meta; }
      else if(slot==='sub') form.pending=meta; else if(slot==='graded') form.file=meta; else form[slot].push(meta);
      toast('Uploaded '+file.name);
    }catch(err){ toast('Upload failed: '+err.message); }
    S.upload=null; S.busy=false; render();
  }
});
window.addEventListener('popstate', ()=>{ readPath(); render(); });
function focusCell(path,r,c){ const n=document.querySelector(`input[data-grid="${path}"][data-r="${r}"][data-c="${c}"]`); if(n){ n.focus(); n.select(); } }
/* paste a block of cells copied from Excel / Sheets into the grid */
document.addEventListener('paste', e=>{
  const el=e.target; if(!el.matches?.('input[data-grid]')) return;
  const text=(e.clipboardData||window.clipboardData).getData('text'); if(!/[\t\n]/.test(text)) return;
  e.preventDefault();
  const block=text.replace(/\r/g,'').replace(/\n$/,'').split('\n').map(l=>l.split('\t'));
  const path=el.dataset.grid, r0=+el.dataset.r, c0=+el.dataset.c, rows=getPath(S.form,path);
  const width=rows[0]?.length || el.closest('tr').querySelectorAll('input[data-grid]').length;
  block.forEach((cells,i)=>{ const r=r0+i; while(rows.length<=r) rows.push(Array(width).fill('')); cells.forEach((v,j)=>{ if(c0+j<width) rows[r][c0+j]=v.trim(); }); });
  render(); focusCell(path, r0+block.length-1, c0); toast(`Pasted ${block.length} row${block.length>1?'s':''}`);
});
/* Enter moves down a row (adding one at the end) */
document.addEventListener('keydown', e=>{
  const el=e.target; if(e.key!=='Enter' || !el.matches?.('input[data-grid]')) return;
  e.preventDefault(); const path=el.dataset.grid, r=+el.dataset.r, c=+el.dataset.c, rows=getPath(S.form,path);
  if(r===rows.length-1){ if(!rows[r].some(v=>String(v).trim())) return; rows.push(Array(rows[r].length).fill('')); render(); }
  focusCell(path, r+1, c);
});
async function logoDataUrl(file){
  const ok=['image/png','image/jpeg','image/webp','image/svg+xml']; if(!ok.includes(file.type)) throw new Error('Choose a PNG, JPG, WebP or SVG image.');
  const asData=f=>new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=()=>rej(new Error('Could not read the file.')); r.readAsDataURL(f); });
  if(file.type==='image/svg+xml'){ if(file.size>300*1024) throw new Error('The SVG is larger than 300 KB.'); return asData(file); }
  const src=await asData(file); const img=await new Promise((res,rej)=>{ const i=new Image(); i.onload=()=>res(i); i.onerror=()=>rej(new Error('That image could not be opened.')); i.src=src; });
  const k=Math.min(1, 480/img.naturalWidth, 192/img.naturalHeight); const c=document.createElement('canvas'); c.width=Math.max(1,Math.round(img.naturalWidth*k)); c.height=Math.max(1,Math.round(img.naturalHeight*k));
  c.getContext('2d').drawImage(img,0,0,c.width,c.height);
  const out=c.toDataURL('image/png'); if(out.length>420000) throw new Error('The logo is too detailed. Try a simpler or smaller image.'); return out;
}
function readPath(){ const m=/^\/ehr\/([^/]+)$/.exec(location.pathname); S.ehrOnly=m? decodeURIComponent(m[1]) : null;
  const cm=/^\/codes(?:\/([^/]*))?$/.exec(location.pathname); S.codesOnly=!!cm; if(cm && cm[1]) S.cb.sel=decodeURIComponent(cm[1]);
  S.ehrAid=new URLSearchParams(location.search).get('a')||null;
  const jm=/^\/join(?:\/([^/]*))?\/?$/.exec(location.pathname); S.joinOnly=!!jm; if(jm){ S.join=S.join||{}; if(jm[1] && !S.join.code) S.join.code=decodeURIComponent(jm[1]).toUpperCase(); } S.registerOnly=/^\/register\/?$/.test(location.pathname); const c=/^\/c\/([^/]+)\/?$/.exec(location.pathname); S.orgSlug=c? decodeURIComponent(c[1]).toLowerCase() : null; }

/* ================= boot ================= */
async function start(){
  readPath();
  try{ await refresh(); S.auth='ready'; await loadSite(); if(S.registerOnly){ S.registerOnly=false; history.replaceState(null,'', S.org?.slug? '/c/'+encodeURIComponent(S.org.slug) : '/'); } if(S.joinOnly){ S.joinOnly=false; history.replaceState(null,'', S.org?.slug? '/c/'+encodeURIComponent(S.org.slug) : '/'); } }
  catch(e){ await loadSite(S.orgSlug);
    if(e.status===401){ try{ const s=await api('GET','/api/setup-status'); S.auth=s.needsSetup?'setup':'login'; }catch(_){ S.auth='login'; } }
    else { S.auth='login'; toast(e.message); }
  }
  render();
}
start();
setInterval(async()=>{ if(S.auth!=='ready'||S.me.mustChange||document.hidden) return; try{ await refresh(); scheduleRender(); }catch(_){} }, 60000);
