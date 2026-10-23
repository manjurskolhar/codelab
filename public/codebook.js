'use strict';
/* ICD-10-CM code book: Tabular List browser and search, built from the official CDC/NCHS tabular file (public/icd10cm.json).
   Used three ways: a page in the menu, a drawer beside an EHR chart, and a stand-alone window at /codes. */
const CB = {
  data:null, loading:null, error:'',
  byCode:new Map(), kids:new Map(), order:new Map(), list:[], chapters:[],
  NOTE_LABEL:{incl:'Includes', inc:'Inclusion terms', x1:'Excludes1', x2:'Excludes2', cf:'Code first', ua:'Use additional code', ca:'Code also', n:'Note', s7n:'7th character'},
  NOTE_HINT:{x1:'Not coded here: never report with the code above (except as the guidelines allow).', x2:'Not included here: both codes may be reported together if the patient has both conditions.',
    cf:'Sequence the underlying condition first.', ua:'Add another code to describe the condition fully.', ca:'Another code may be needed; sequence depends on the circumstances of the encounter.'},
  load(){
    if(this.data) return Promise.resolve(this.data);
    if(this.loading) return this.loading;
    this.loading = fetch('/icd10cm.json', {credentials:'same-origin'}).then(r=>{ if(!r.ok) throw new Error('The code book could not be loaded ('+r.status+').'); return r.json(); }).then(d=>{
      d.nodes.forEach((n,i)=>{ this.byCode.set(n.c, n); this.order.set(n.c, i); if(n.p){ if(!this.kids.has(n.p)) this.kids.set(n.p, []); this.kids.get(n.p).push(n.c); }
        if(n.k==='ch') this.chapters.push(n);
        if(!n.k){ n._d=n.d.toLowerCase(); n._i=(n.inc||[]).join(' · ').toLowerCase(); n._n=n.c.replace('.','').toLowerCase(); this.list.push(n); } });
      this.data=d; this.error=''; return d;
    }).catch(e=>{ this.error=e.message; this.loading=null; throw e; });
    return this.loading;
  },
  label:n=>n.k==='sec'? n.c.replace(/^sec:/,'') : n.c,
  norm:c=>String(c||'').toUpperCase().replace(/[^A-Z0-9]/g,''),
  dot(c){ c=this.norm(c); return c.length>3? c.slice(0,3)+'.'+c.slice(3) : c; },
  /* find a code typed by the user, including full codes with a 7th character (S72.001A, T36.0X1A, S00.00XA) */
  resolve(raw){
    const c=this.norm(raw); if(c.length<3) return null;
    const d=this.dot(c); if(this.byCode.has(d)) return {node:this.byCode.get(d)};
    if(c.length===7){ let base=c.slice(0,6); const x=c[6];
      while(base.length>=3){ const n=this.byCode.get(this.dot(base)); if(n){ const s7=this.seventh(n); if(s7 && s7.def.some(([ch])=>ch===x)) return {node:n, ext:x}; break; } if(!base.endsWith('X')) break; base=base.slice(0,-1); } }
    return null;
  },
  chain(n){ const out=[]; let x=n; while(x && out.length<12 && !out.includes(x)){ out.unshift(x); x=x.p? this.byCode.get(x.p) : null; } return out; },
  seventh(n){ const ch=this.chain(n); for(let i=ch.length-1;i>=0;i--) if(ch[i].s7) return {at:ch[i], def:ch[i].s7, note:(ch[i].s7n||[])[0]||''}; return null; },
  full(n, x){ let b=this.norm(n.c); while(b.length<6) b+='X'; return this.dot(b+x); },
  status(n){
    if(n.k) return {cls:'', text: n.k==='ch'? 'Chapter' : 'Block of categories'};
    if(!n.leaf) return {cls:'warn', text:'Not billable: choose a more specific code'};
    if(this.seventh(n)) return {cls:'warn', text:'Needs a 7th character'};
    return {cls:'ok', text:'Billable code'};
  },
  search(q){
    q=String(q||'').trim(); if(!q) return [];
    const one=q.replace(/\s+/g,'');
    if(/^[A-Za-z]\d[0-9A-Za-z.]*$/.test(one) && !/\s/.test(q.trim())){
      const r=this.resolve(one); const pre=this.norm(one).toLowerCase();
      const hits=this.list.filter(n=>n._n.startsWith(pre.slice(0,6)));
      const out=hits.slice(0,120).map(n=>({n}));
      if(r && r.ext) out.unshift({n:r.node, ext:r.ext});
      return out;
    }
    const words=q.toLowerCase().split(/[\s,;]+/).filter(w=>w.length>0);
    const res=words.map(w=>new RegExp('(^|[^a-z0-9])'+w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
    const out=[];
    for(const n of this.list){
      let inD=true, all=true;
      for(const re of res){ if(re.test(n._d)) continue; inD=false; if(!re.test(n._i)){ all=false; break; } }
      if(all) out.push({n, s: inD? (res[0].test(n._d.slice(0, words[0].length+1))? 0 : 1) : 2});
    }
    out.sort((a,b)=>a.s-b.s || this.order.get(a.n.c)-this.order.get(b.n.c));
    return out;
  },
};

/* ---------- rendering ---------- */
function cbMark(text, q){
  let out=esc(text); const ws=String(q||'').toLowerCase().split(/[\s,;]+/).filter(w=>w.length>1 && !/^[a-z]\d/.test(w));
  ws.forEach(w=>{ const re=new RegExp('(^|[^A-Za-z0-9])('+esc(w).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')','gi'); out=out.replace(re,'$1<mark>$2</mark>'); });
  return out;
}
function cbNotes(n, own){
  const keys=['incl','inc','n','x1','x2','cf','ua','ca'];
  return keys.filter(k=>(n[k]||[]).length).map(k=>`<div class="cb-note cb-${k}"><div class="cb-nh"><b>${CB.NOTE_LABEL[k]}</b>${own&&CB.NOTE_HINT[k]?`<span class="hint">${esc(CB.NOTE_HINT[k])}</span>`:''}</div><ul>${n[k].map(t=>`<li>${cbLinks(t)}</li>`).join('')}</ul></div>`).join('');
}
/* make code references inside notes clickable: "(E11.-)", "J44.1", "C00-D49" */
function cbLinks(t){
  return esc(t).replace(/\b([A-Z]\d[0-9A-Z](?:\.[0-9A-Z]{1,4})?)(?=[\s,;)\].\-]|$)/g, (m,c)=> CB.byCode.has(c)? `<button class="cb-ref" data-act="cb-open" data-v="${c}">${m}</button>` : m);
}
function cbRow(n, ext, q){
  const st=CB.status(n); const code= ext? CB.full(n,ext) : n.c;
  let inc='';
  if(q && n._i && !/^[A-Za-z]\d/.test(String(q).trim())){ const ws=String(q).toLowerCase().split(/[\s,;]+/).filter(Boolean);
    if(!ws.every(w=>n._d.includes(w))){ const t=(n.inc||[]).map(t=>[t, ws.filter(w=>t.toLowerCase().includes(w)).length]).sort((a,b)=>b[1]-a[1])[0]; if(t&&t[1]) inc=`<span class="cb-inc">Includes: ${cbMark(t[0], q)}</span>`; } }
  return `<li><button class="cb-hit" data-act="cb-open" data-v="${esc(n.c)}"${ext?` data-x="${esc(ext)}"`:''}><span class="cb-code">${esc(n.k? CB.label(n) : code)}</span><span class="cb-desc">${cbMark(n.d, q)}${ext?` <span class="muted">· 7th character ${esc(ext)}</span>`:''}${inc}</span><span class="pill ${st.cls}">${st.cls==='ok'?'Billable':st.cls==='warn'?(st.text.startsWith('Needs')?'7th char':'Header'):''}</span></button></li>`;
}
function cbDetail(code, ext){
  const n=CB.byCode.get(code); if(!n) return `<p class="muted">Code ${esc(code)} is not in this code book.</p>`;
  const chain=CB.chain(n); const st=CB.status(n); const s7=!n.k && CB.seventh(n); const kids=CB.kids.get(n.c)||[];
  const crumbs=chain.slice(0,-1).map(x=>`<button class="cb-crumb" data-act="cb-open" data-v="${esc(x.c)}">${esc(x.k==='ch'? 'Ch. '+x.c.slice(2) : CB.label(x))}</button>`).join('<span aria-hidden="true">›</span>');
  const higher=chain.slice(0,-1).reverse().filter(x=>['incl','inc','n','x1','x2','cf','ua','ca'].some(k=>(x[k]||[]).length));
  return `<div class="cb-detail">
    <nav class="cb-crumbs" aria-label="Location in the Tabular List">${crumbs}</nav>
    <div class="cb-title"><span class="cb-big">${esc(ext? CB.full(n,ext) : (n.k==='ch'? 'Chapter '+n.c.slice(2) : CB.label(n)))}</span><h3>${esc(n.d)}${ext?` <span class="muted">· ${esc(s7?.def.find(d=>d[0]===ext)?.[1]||'')}</span>`:''}</h3></div>
    <div class="row"><span class="pill ${ext?'ok':st.cls}">${ext?'Billable code (with 7th character)':esc(st.text)}</span>${S.ehrOnly && S.ew?.act==='coding' && (ext || st.cls==='ok') ? `<button class="btn sm primary" data-act="ew-add-code" data-v="${esc(ext? CB.full(n,ext) : n.c)}">+ Add to diagnoses</button>` : ''}${n.k==='ch'||n.k==='sec'?'':`<span class="small muted">Level ${chain.length-2} in chapter ${esc(chain[0].c.slice(2))}</span>`}</div>
    ${cbNotes(n,true)}
    ${s7? `<div class="cb-note cb-s7"><div class="cb-nh"><b>7th character</b><span class="hint">${esc(s7.note||'Required for this code.')}${s7.at!==n?` (defined at ${esc(s7.at.c)})`:''}</span></div>
      <table class="cb-7"><tbody>${s7.def.map(([c,t])=>`<tr class="${c===ext?'on':''}"><td class="num">${n.leaf?`<b>${esc(CB.full(n,c))}</b>`:esc(c)}</td><td>${esc(t)}</td></tr>`).join('')}</tbody></table>${n.leaf&&CB.norm(n.c).length<6?'<p class="hint">Use the placeholder X so the 7th character stays in the 7th position.</p>':''}</div>`:''}
    ${kids.length? `<div class="cb-note"><div class="cb-nh"><b>${n.k==='ch'?'Blocks':n.k==='sec'?'Categories':'More specific codes'}</b><span class="hint">${n.k?'' : 'Report the most specific code the documentation supports.'}</span></div><ul class="cb-hits">${kids.map(k=>{ const x=CB.byCode.get(k); return cbRow(x); }).join('')}</ul></div>`:''}
    ${higher.length? `<details class="cb-higher" open><summary>Notes from higher levels that also apply (${higher.length})</summary>${higher.map(x=>`<div class="cb-lvl"><div class="cb-lvl-h"><button class="cb-ref" data-act="cb-open" data-v="${esc(x.c)}">${esc(x.k==='ch'?'Chapter '+x.c.slice(2):CB.label(x))}</button> ${esc(x.d)}</div>${cbNotes(x,false)}</div>`).join('')}</details>`:''}
  </div>`;
}
function codeBookHTML(mode){
  const st=S.cb;
  if(!CB.data){
    if(!CB.loading && !CB.error) CB.load().then(()=>render()).catch(()=>render());
    return `<div class="cb cb-${mode}">${cbHead(mode)}<div class="empty">${CB.error? esc(CB.error)+' <button class="btn sm" data-act="cb-retry">Try again</button>' : 'Loading the ICD-10-CM code book…'}</div></div>`;
  }
  let body='';
  if(st.q.trim()){
    const hits=CB.search(st.q);
    body=`<p class="small muted">${hits.length? `${hits.length>200?'200+':hits.length} result${hits.length===1?'':'s'} for “${esc(st.q)}”${hits.length>80?' · showing the first 80; add a word to narrow':''}` : `No Tabular List entries match “${esc(st.q)}”. Try the main term (the condition, not the body site), a synonym, or fewer words.`}</p>
      <ul class="cb-hits">${hits.slice(0,80).map(h=>cbRow(h.n,h.ext,st.q)).join('')}</ul>`;
  } else if(st.sel){ body=cbDetail(st.sel, st.ext); }
  else body=`<p class="small muted">Browse the 22 chapters of the Tabular List, or search by code or by words.</p><ul class="cb-hits">${CB.chapters.map(ch=>{ const secs=CB.kids.get(ch.c)||[]; const a=CB.byCode.get(secs[0]), b=CB.byCode.get(secs[secs.length-1]); const range=a&&b? (CB.label(a).split('-')[0]+'–'+(CB.label(b).split('-')[1]||CB.label(b))) : '';
      return `<li><button class="cb-hit" data-act="cb-open" data-v="${esc(ch.c)}"><span class="cb-code">${esc(range)}</span><span class="cb-desc"><b>Chapter ${esc(ch.c.slice(2))}</b> · ${esc(ch.d)}</span></button></li>`; }).join('')}</ul>`;
  return `<div class="cb cb-${mode}">${cbHead(mode)}<div class="cb-body">${(st.q.trim()||!st.sel)?'':`<div class="row" style="margin-bottom:8px"><button class="btn sm" data-act="cb-home">Chapters</button>${st.hist.length?'<button class="btn sm" data-act="cb-back">← Back</button>':''}</div>`}${body}</div>
    <p class="cb-foot">${esc(CB.data.version)}. Tabular List only — locate terms in the Alphabetic Index first, then verify here. Check against the code book and guidelines in force for the date of service.</p></div>`;
}
function cbHead(mode){
  return `<div class="cb-head">${mode==='drawer'?`<div class="row" style="justify-content:space-between"><b>ICD-10-CM code book</b><div class="row"><a class="btn sm" href="/codes${S.cb.sel?'/'+encodeURIComponent(S.cb.sel):''}" target="_blank" rel="noopener" title="Open in its own tab">↗</a><button class="btn sm" data-act="cb-toggle" aria-label="Close code book">×</button></div></div>`:''}
    <input type="search" id="cb-q-${mode}" data-act="cb-q" placeholder="Search a code (E11.22) or words (diabetes kidney)" aria-label="Search ICD-10-CM" value="${esc(S.cb.q)}" autocomplete="off" spellcheck="false"></div>`;
}
function cbOpen(code, ext){
  if(S.cb.sel && S.cb.sel!==code) S.cb.hist.push([S.cb.sel, S.cb.ext]); S.cb.hist=S.cb.hist.slice(-30);
  S.cb.sel=code; S.cb.ext=ext||null; S.cb.q='';
  if(S.codesOnly) history.replaceState(null,'','/codes/'+encodeURIComponent(code));
  render(); document.querySelector('.cb-body')?.scrollTo?.(0,0); if(S.codesOnly||S.route.name==='codes') window.scrollTo(0,0);
}
document.addEventListener('click', e=>{
  const el=e.target.closest('[data-act^="cb-"]'); if(!el || el.tagName==='INPUT') return;
  const act=el.dataset.act;
  if(act==='cb-open'){ e.preventDefault(); cbOpen(el.dataset.v, el.dataset.x); }
  if(act==='cb-home'){ S.cb.sel=null; S.cb.ext=null; S.cb.q=''; S.cb.hist=[]; if(S.codesOnly) history.replaceState(null,'','/codes'); render(); }
  if(act==='cb-back'){ const p=S.cb.hist.pop(); if(p){ S.cb.sel=p[0]; S.cb.ext=p[1]; render(); } }
  if(act==='cb-toggle'){ S.cb.open=!S.cb.open; try{ localStorage.setItem('cdl_cb_open', S.cb.open?'1':''); }catch(_){} render(); if(S.cb.open) setTimeout(()=>document.getElementById('cb-q-drawer')?.focus(),0); }
  if(act==='cb-retry'){ CB.error=''; render(); }
});
document.addEventListener('input', e=>{
  const el=e.target; if(el.dataset.act!=='cb-q') return;
  S.cb.q=el.value; clearTimeout(S._cbt);
  S._cbt=setTimeout(()=>{ const id=el.id, pos=el.selectionStart; render(); const n=document.getElementById(id); if(n){ n.focus(); try{ n.setSelectionRange(pos,pos); }catch(_){} } }, 180);
});
document.addEventListener('keydown', e=>{
  if(e.target?.dataset?.act==='cb-q' && e.key==='Enter'){ const r=CB.data && CB.resolve(e.target.value); if(r){ e.preventDefault(); cbOpen(r.node.c, r.ext); } }
});
