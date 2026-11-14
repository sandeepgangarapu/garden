import {MONTHS,activePlants,taskVisible,taskLead,carryOver,createCalendarEvent,plantMatcher,splitMentions,mentionedIds} from './logic.js';
import {createStore,safeStorage} from './store.js';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today = new Date(), THIS_YEAR = today.getFullYear(), THIS_MONTH = today.getMonth();
const isoDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
// Notes aren't filed under a plant when written. The API still needs a plant_id and tag.
const GENERAL_NOTE = 'garden';
const AREAS = [['front','Front yard · Full sun'],['back','Backyard · Part shade'],['ornamental','Shrubs, bulbs & flowers']];
const TYPES = [['start','Start indoors'],['sow','Direct sow'],['plant','Plant out'],['train','Train & pollinate'],['prune','Prune'],['water','Water'],['feed','Feed & mulch'],['pests','Pest patrol'],['harvest','Harvest'],['care','Seasonal care'],['soil','Soil & cleanup']];
const CODES = {indoor:'Indoor start',sow:'Direct sow',transplant:'Transplant',grow:'Growing',harvest:'Harvest',bloom:'Bloom / fruit',prune:'Prune',plant:'Plant bulbs',feed:'Feed'};
const calendarIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 2v6m8-6v6m-4 5v6m-3-3h6"/></svg>';
let library, guides, store, year, month = THIS_MONTH, tab = 'jobs', filter = 'all', sheetType = '', plantId = '', plantTab = 'care', toastTimer;
function notify(message) { $('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,4000); }
function plants() { return [...library.plants,...store.state.custom.filter(p=>!p.deleted).map(p=>({...p,kind:p.area==='ornamental'?'ornamental':'vegetable',localName:'',variety:'',category:'My own plants',timeline:Array(12).fill(''),care:[],traits:[],tip:''}))]; }
function plant(id) { return plants().find(p=>p.id===id); }
function garden() { return activePlants(plants(),store.state.plantings,year); }
function planting(id,y=year) { return store.state.plantings.find(r=>r.year===y&&r.plant_id===id&&!r.deleted); }
function yearPlants(y=year) { return plants().filter(p=>planting(p.id,y)); }
function notes() { return store.state.notes.filter(n=>!n.deleted).sort((a,b)=>b.observed_on.localeCompare(a.observed_on)||Date.parse(b.created_at)-Date.parse(a.created_at)); }
let matcherCache={key:'',matcher:null};
function matcher() { const ps=plants(),key=ps.map(p=>`${p.id}=${p.name}=${p.localName}`).join('|');if(matcherCache.key!==key)matcherCache={key,matcher:plantMatcher(ps)};return matcherCache.matcher; }
const mentionCache=new WeakMap();
function mentions(n) { const m=matcher();let c=mentionCache.get(n);if(!c||c.m!==m){c={m,ids:mentionedIds(n.body,m)};mentionCache.set(n,c);}return c.ids; }
// A plant's notes: ones filed under it, plus any note that names it.
function plantNotes(id) { return notes().filter(n=>n.plant_id===id||mentions(n).has(id)); }
// Escapes text and turns plant names into links to that plant's page.
// Inline links, not buttons, so the tap area is just the word and names can wrap.
function linkify(text,except='') { return splitMentions(text,matcher()).map(s=>s.id&&s.id!==except?`<a class="plink" href="#plant-${encodeURIComponent(s.id)}" data-plant="${esc(s.id)}">${esc(s.text)}</a>`:esc(s.text)).join(''); }
function checked(id) { return store.state.checks.some(r=>r.year===year&&r.task_id===id&&!r.deleted); }
function byName(a,b) { return a.name.localeCompare(b.name); }
function label(s) { return s.charAt(0).toUpperCase()+s.slice(1); }
function dateLabel(d) { return new Date(d+'T12:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric'}); }
function heading(title,sub) { return `<div class="vhead"><h1>${esc(title)}</h1><p class="sub">${esc(sub)}</p></div>`; }
function strip(p,mini=false) { return `<div class="strip${mini?' mini':''}" role="img" aria-label="${esc(p.timeline.map((c,i)=>c?`${MONTHS[i]}: ${CODES[c]}`:'').filter(Boolean).join('; ')||'No schedule yet')}">${p.timeline.map((c,i)=>`<i class="${c?'c-'+esc(c):''}${year===THIS_YEAR&&i===THIS_MONTH?' now':''}" title="${MONTHS[i]}: ${CODES[c]||'—'}"></i>`).join('')}</div>`; }
function legend() { return `<div class="legend">${Object.entries(CODES).map(([c,t])=>`<span><i class="c-${c}"></i>${t}</span>`).join('')}</div>`; }
function jobText(task,g=garden()) { const lead=taskLead(task,g); return (lead?lead+' — ':'')+task.text; }
function renderJobs() {
  const g=garden(), list=library.tasks.filter(t=>t.month===month&&taskVisible(t,g));
  const done=list.filter(t=>checked(t.id)).length;
  let h=`<div class="stepper"><button class="iconbtn" data-step="-1" aria-label="${month?'Previous month':'Previous garden year'}" ${month===0&&!hasYear(year-1)?'disabled':''}>‹</button><div class="mtitle"><h1>${MONTHS[month]} <span class="yr">${year}</span></h1></div><button class="iconbtn" data-step="1" aria-label="${month<11?'Next month':'Next garden year'}" ${month===11&&!hasYear(year+1)?'disabled':''}>›</button></div>
  <div class="mdots" role="group" aria-label="Month">${MONTHS.map((m,i)=>`<button class="mdot${i===month?' on':''}${year===THIS_YEAR&&i===THIS_MONTH?' now':''}" data-month="${i}" aria-label="${m}" aria-pressed="${i===month}">${m.slice(0,3)}</button>`).join('')}</div>
  ${month===0&&hasYear(year-1)?`<button class="linkbtn" data-adjacent="${year-1}" data-endmonth="11">← December ${year-1}</button>`:''}${month===11&&hasYear(year+1)?`<button class="linkbtn" data-adjacent="${year+1}" data-endmonth="0">January ${year+1} →</button>`:''}
  <div class="meter" role="progressbar" aria-label="Jobs completed" aria-valuemin="0" aria-valuemax="${list.length||1}" aria-valuenow="${done}"><i style="width:${list.length?100*done/list.length:0}%"></i></div><p class="sub" id="progressLabel">${done} of ${list.length} jobs done · ${g.length} plants</p>`;
  for (const [type,title] of TYPES) {
    const rows=list.filter(t=>t.type===type); if(!rows.length)continue;
    h+=`<section class="group" data-jobgroup><h2 class="gh"><i class="dot t-${type}"></i>${title}<span class="cnt">${rows.filter(t=>checked(t.id)).length}/${rows.length}</span></h2><ul class="jobs">${rows.map(t=>{
      const lead=taskLead(t,g);
      return `<li class="job${checked(t.id)?' done':''}"><label class="checkwrap"><input type="checkbox" id="check-${esc(t.id)}" data-check="${esc(t.id)}" ${checked(t.id)?'checked':''} aria-label="${esc(jobText(t,g))}"></label><label class="jobtext" for="check-${esc(t.id)}"><span>${lead?`<b>${linkify(lead)}</b> — `:''}${linkify(t.text)}</span></label><button class="iconbtn" data-calendar="${esc(t.id)}" aria-label="Add to Calendar: ${esc(lead||t.text)}">${calendarIcon}</button></li>`;
    }).join('')}</ul></section>`;
  }
  return h+(list.length?'':`<p class="empty">Nothing to do in ${MONTHS[month]} for the plants in your ${year} garden.</p><button class="btn full" data-action="picker">Choose plants for ${year}</button>`);
}
function plantRow(p) {
  const skipped=planting(p.id).status==='skipped', n=plantNotes(p.id).length;
  return `<li><button class="prow${skipped?' skipped':''}" data-plant="${esc(p.id)}"><span class="pmain"><span class="pname">${esc(p.name)}${p.localName?` <span class="local">${esc(p.localName)}</span>`:''}</span>${strip(p,true)}</span><span class="pside">${skipped?'<span class="pill st-skipped">Skipped</span>':''}${n?`<span class="ncount">${n} note${n===1?'':'s'}</span>`:''}</span></button></li>`;
}
function renderGarden() {
  const ps=yearPlants(), carried=ps.filter(p=>p.life!=='annual').length;
  let h=heading(`${year} garden`,`${ps.length} plants · ${ps.length-carried} annuals · ${carried} perennials & overwinter crops`)+`<button class="btn primary full" data-action="picker">Add or remove plants</button>`;
  for(const [area,title] of AREAS) {
    const rows=ps.filter(p=>p.area===area).sort(byName); if(!rows.length)continue;
    h+=`<section class="group"><h2 class="gh">${title}<span class="cnt">${rows.length}</span></h2><ul class="plist">${rows.map(plantRow).join('')}</ul></section>`;
  }
  return h+(ps.length?'':`<p class="empty">Choose what you’ll grow in ${year}. Your notes will stay with each plant.</p>`);
}
function renderYear() {
  const ps=garden();
  let h=heading(`${year} at a glance`,`Only your garden’s plants. Tap a month for jobs, or a plant for details.`)+legend()+`<div class="chead"><span class="sub">Plant</span>${MONTHS.map((m,i)=>`<button data-month="${i}" aria-label="${m} jobs" class="${year===THIS_YEAR&&i===THIS_MONTH?'now':''}">${m[0]}</button>`).join('')}</div>`;
  for(const [area,title] of AREAS) {
    const rows=ps.filter(p=>p.area===area).sort(byName);if(!rows.length)continue;
    h+=`<section class="group"><h2 class="gh">${title}</h2>${rows.map(p=>`<button class="crow" data-plant="${esc(p.id)}" aria-label="${esc(p.name)}"><span class="cn">${esc(p.name)}</span>${p.timeline.map((c,i)=>`<i class="${c?'c-'+esc(c):''}${year===THIS_YEAR&&i===THIS_MONTH?' now':''}"></i>`).join('')}</button>`).join('')}</section>`;
  }
  return h+(ps.length?'':'<p class="empty">Add plants to see your year here.</p>');
}
// `except` is the plant whose page is showing: no label or link back to it.
function noteItem(n,except='') {
  const p=n.plant_id!==except?plant(n.plant_id):null;
  return `<article class="note"><div class="nmeta">${p?`<button class="who" data-plant="${esc(p.id)}">${esc(p.name)}</button>`:''}<span>${dateLabel(n.observed_on)}</span><span class="note-actions"><button class="del" data-edit="${esc(n.id)}">Edit</button><button class="del" data-delete="${esc(n.id)}">Delete</button></span></div><p>${linkify(n.body,except)}</p></article>`;
}
function groupedNotes(list,except='') {
  return [...new Set(list.map(n=>n.year))].sort((a,b)=>b-a).map(y=>`<h3 class="yh">${y}</h3>${list.filter(n=>n.year===y).map(n=>noteItem(n,except)).join('')}`).join('');
}
function renderNotes() {
  const list=notes().filter(n=>filter!=='year'||n.year===year);
  return heading('Garden notes','Saved by year. Plant names you mention link to that plant.')+`<div class="chips" role="group" aria-label="Filter notes">${[['all','All years'],['year',`${year} only`]].map(([id,title])=>`<button class="chip" data-filter="${id}" aria-pressed="${filter===id}">${title}</button>`).join('')}</div>`+(list.length?groupedNotes(list):'<p class="empty">No notes yet. Tap ＋ Note and dictate what you notice.</p>');
}
function render() {
  if(!store)return;
  $('#yearBtn').textContent=`${year} ▾`;
  $('#planningPrompt').innerHTML=year===THIS_YEAR&&THIS_MONTH>=9&&safeStorage.get(`garden-dismiss-${year}`)!=='yes'?`<div class="banner"><button class="linkbtn" data-plan="${year+1}">Plan your ${year+1} garden →</button><button class="iconbtn" data-action="dismiss" aria-label="Dismiss planning reminder">×</button></div>`:'';
  $('#main').innerHTML=({jobs:renderJobs,garden:renderGarden,year:renderYear,notes:renderNotes}[tab]||renderJobs)();
  document.querySelectorAll('[data-tab]').forEach(b=>{if(b.dataset.tab===tab)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  renderSync();
}
function renderSync() {
  if(!store)return;
  $('#syncIndicator').textContent=!store.storageOK?'Device storage is unavailable. Export your changes before closing.':store.status==='offline'?'Offline. Changes will sync later.':'';
  $('#signinBanner').hidden=store.status!=='signin';
  const status=$('#accountStatus');if(status)status.textContent=accountStatus();
  const account=$('#accountEmail');if(account)account.textContent=store.user?`Signed in as ${store.user.email}`:'This device is ready for your garden account.';
}
function accountStatus() {
  if(!store.storageOK)return 'Device storage is unavailable. Keep this page open and export your data.';
  if(store.status==='local')return 'Saved on this device. Sync works on garden.sandeepgangarapu.com.';
  if(store.status==='offline')return 'Offline. Changes will sync later.';
  if(store.status==='signin')return 'Your sign-in expired. Sign in again to sync your garden.';
  if(store.status==='syncing')return 'Syncing your garden…';
  if(store.status==='error')return 'Sync could not finish. Your changes are saved on this device. Try again.';
  return `${store.dirtyCount?`${store.dirtyCount} changes waiting to sync.`:'Everything is synced.'}${store.lastSync?' Last synced '+store.lastSync+'.':''}`;
}
function hasYear(y) { return store.state.years.some(r=>r.year===y&&!r.deleted); }
function addYear(y) {
  if(hasYear(y))return;
  const prev=store.state.years.filter(r=>!r.deleted).map(r=>r.year).filter(v=>v<y).sort((a,b)=>b-a)[0];
  store.put('years',{year:y,created_at:new Date().toISOString()});
  if(prev)for(const id of carryOver(plants(),store.state.plantings,prev)) addPlant(id,y);
}
function addPlant(id,y=year) { if(plant(id))store.put('plantings',{year:y,plant_id:id,status:'planned',variety:'',location:''}); }
function switchYear(y) { year=y;safeStorage.set('garden-selected-year',String(year));month=year===THIS_YEAR?THIS_MONTH:0;render(); }
function route(next) { tab=next;location.hash=next;render();window.scrollTo({top:0,behavior:'instant'}); }
function sheetHeader(title,sub='',id='sheet-title') { return `<div class="sh-head"><div><h2 id="${id}">${esc(title)}</h2>${sub?`<span class="sub">${esc(sub)}</span>`:''}</div><button class="close" data-close aria-label="Close sheet">×</button></div>`; }
function openSheet(type,title,body,sub='') {
  sheetType=type;const d=$('#sheet');d.innerHTML=sheetHeader(title,sub)+`<div class="sh-body">${body}</div>`;if(!d.open)d.showModal();d.scrollTop=0;d.focus({preventScroll:true});
}
function openYears() {
  const ys=store.state.years.filter(r=>!r.deleted).map(r=>r.year).sort((a,b)=>b-a),next=ys[0]+1;
  openSheet('years','Garden years',`<div class="stack">${ys.map(y=>`<button class="yrow" data-year="${y}" aria-current="${y===year}"><b>${y}</b><span class="sub">${yearPlants(y).length} plants · ${y>THIS_YEAR?'Planning':y===THIS_YEAR?'This year':'Past'}</span></button>`).join('')}</div><p class="sub">A new year starts with your perennials and anything still in the ground. Then you pick the annuals.</p>${next<=2100?`<button class="btn full" data-plan="${next}">Start ${next} garden</button>`:''}`);
}
function openPicker() {
  openSheet('picker',`Plants for ${year}`,`<span class="sub" id="pickerCount"></span><label class="fl">Search plants<input type="search" id="pickerSearch" placeholder="Name or local name" autocomplete="off"></label><div id="pickerList"></div><details><summary class="who">Add a plant of your own</summary><form id="customForm" class="picker-form"><label class="fl">Plant name<input name="name" maxlength="120" required></label><div class="field-pair"><label class="fl">Area<select name="area">${AREAS.map(([id,t])=>`<option value="${id}">${t}</option>`).join('')}</select></label><label class="fl">Life<select name="life"><option value="annual">Annual</option><option value="perennial">Perennial</option></select></label></div><button class="btn primary">Add plant</button></form></details><button class="btn full" data-close>Done choosing plants</button>`);
  renderPicker();
}
function renderPicker() {
  const q=($('#pickerSearch')?.value||'').trim().toLowerCase();
  $('#pickerCount').textContent=`${yearPlants().length} plants selected`;
  const groups=[['annual','Annuals: pick what you’ll grow'],['overwinter','Still in the ground'],['perennial','Perennials'],['custom','My own plants']];
  $('#pickerList').innerHTML=groups.map(([id,title])=>{
    const list=plants().filter(p=>(id==='custom'?p.id.startsWith('custom-'):!p.id.startsWith('custom-')&&p.life===id)&&(!q||`${p.name} ${p.localName}`.toLowerCase().includes(q))).sort(byName);
    return list.length?`<section class="group"><h3 class="gh">${title}</h3>${list.map(p=>{
      const count=plantNotes(p.id).length;
      return `<label class="arow"><input type="checkbox" data-pick="${esc(p.id)}" ${planting(p.id)?'checked':''}><span><b>${esc(p.name)}</b> <span class="local">${esc(p.localName)}</span><small>${planting(p.id,year-1)?`Grew in ${year-1}`:'New'}${count?` · ${count} note${count===1?'':'s'}`:''}</small></span></label>`;
    }).join('')}</section>`:'';
  }).join('')||'<p class="empty">No plants match your search.</p>';
}
function composer(editing=null) {
  const date=editing?.observed_on||isoDate(),gardenYear=editing?.year||year;
  return `<form class="composer" data-composer="quick" data-edit-id="${esc(editing?.id||'')}">
  <label class="fl">${editing?'Edit note':'What did you notice?'}<textarea name="body" maxlength="10000" required placeholder="Tap the mic on your keyboard to dictate. Plant names you mention become links.">${esc(editing?.body||'')}</textarea></label>
  <details class="note-options"><summary><span data-note-summary>${esc(dateLabel(date))} · ${gardenYear} garden</span> · Change</summary><div class="field-pair"><label class="fl">Garden year<select name="year">${store.state.years.filter(r=>!r.deleted).map(r=>r.year).sort((a,b)=>b-a).map(y=>`<option ${y===gardenYear?'selected':''}>${y}</option>`).join('')}</select></label><label class="fl">Date<input type="date" name="observed_on" value="${esc(date)}" required></label></div></details>
  <button class="btn primary">${editing?'Save changes':'Save note'}</button></form>`;
}
function openNote(editId=null) {
  const n=editId?notes().find(n=>n.id===editId):null,d=$('#noteSheet');
  d.innerHTML=sheetHeader(n?'Edit note':`New note · ${year}`,'','note-title')+`<div class="sh-body">${composer(n)}</div>`;
  if(!d.open)d.showModal();
  // Keep focus in the original tap event so iOS opens its keyboard.
  (d.querySelector('textarea')||d).focus({preventScroll:true});
}
function openPlant(id,deepLink=true) {
  if(!plant(id))return;plantId=id;plantTab='care';renderPlant();
  if(deepLink)history.replaceState(null,'',`#plant-${encodeURIComponent(id)}`);
}
function renderPlant() {
  const p=plant(plantId), row=planting(p.id), list=plantNotes(p.id), skipped=row?.status==='skipped';
  const plan=row?`<div class="plan-toggle" role="group" aria-label="${year} garden">${[['planned','Planned'],['skipped','Skipped']].map(([s,t])=>`<button data-status="${s}" aria-pressed="${(s==='skipped')===skipped}">${t}</button>`).join('')}</div>`:'';
  let body=`<div class="badges"><span class="pill">${esc(AREAS.find(a=>a[0]===p.area)?.[1].split(' · ')[0])}</span><span class="pill st-planned">${p.life==='annual'?'Annual':p.life==='overwinter'?'Overwinters':'Perennial'}</span>${plan}</div><div>${strip(p)}<div class="mlabels">${MONTHS.map(m=>`<span>${m[0]}</span>`).join('')}</div></div>`;
  if(!row)body+=`<button class="btn primary" data-addplant="${esc(p.id)}">Add to ${year} garden</button>`;
  body+=`<div class="seg" role="group" aria-label="Plant details">${['care','jobs','notes'].map(t=>`<button data-plant-tab="${t}" aria-pressed="${plantTab===t}">${label(t)}${t==='notes'&&list.length?' ('+list.length+')':''}</button>`).join('')}</div>`;
  if(plantTab==='care')body+=(p.care.length?`<dl class="care">${p.care.map(c=>`<div><dt>${esc(c.label)}</dt><dd>${linkify(c.value,p.id)}</dd></div>`).join('')}</dl>`:'')+(p.traits.length?`<div class="badges">${p.traits.map(t=>`<span class="pill st-planned">${esc(t)}</span>`).join('')}</div>`:'')+(p.tip?`<div class="tipbox">${linkify(p.tip,p.id)}</div>`:'')+(!p.care.length&&!p.tip?'<p class="empty">No care details for this plant.</p>':'');
  // Only jobs for this plant. Yard-wide jobs (drip, soil, cleanup) stay on the Jobs tab.
  if(plantTab==='jobs')body+=MONTHS.map((m,i)=>{
    const jobs=library.tasks.filter(t=>t.month===i&&t.plants.includes(p.id));
    return jobs.length?`<section><h3 class="mh">${m}</h3><ul class="tl">${jobs.map(t=>`<li><i class="dot t-${t.type}"></i><span>${linkify(t.text,p.id)}</span></li>`).join('')}</ul></section>`:'';
  }).join('')||'<p class="empty">No jobs listed for this plant.</p>';
  if(plantTab==='notes')body+=list.length?`<div>${groupedNotes(list,p.id)}</div>`:`<p class="empty">No notes mention ${esc(p.name)} yet.</p>`;
  openSheet('plant',p.name,body,p.localName||'');
}
function openMenu() {
  openSheet('menu','Your garden',`<div class="menu-list"><button class="btn full" data-action="account">Account & sync</button><button class="btn full" data-action="guides">Care guides</button><button class="btn full" data-export="json">Export all data · JSON</button><button class="btn full" data-export="markdown">Export notes · Markdown</button><a class="btn full" href="classic/">Classic garden page ↗</a></div><p class="sub">Your garden is saved on this device, even when you’re offline.</p>`);
}
function openAccount() {
  openSheet('account','Account & sync',`<p class="sub" id="accountEmail">${store.user?`Signed in as ${esc(store.user.email)}`:'This device is ready for your garden account.'}</p><p class="notice" id="accountStatus" role="status">${esc(accountStatus())}</p><button class="btn primary" data-action="sync">Sync now</button>${store.status==='signin'?'<button class="btn" data-action="signin">Sign in again</button>':''}<a class="btn" href="/cdn-cgi/access/logout">Sign out</a>`);
}
function openGuides() { openSheet('guides','Care guides',guides.guides.map(g=>`<details class="guide"><summary>${esc(g.title)}</summary><ul>${g.items.map(t=>`<li>${linkify(t)}</li>`).join('')}</ul></details>`).join('')); }
let calendarTask;
function calendarFile() { const form=$('#calendarForm'),f=new FormData(form);return new File([createCalendarEvent({id:calendarTask.id,title:jobText(calendarTask),category:TYPES.find(t=>t[0]===calendarTask.type)?.[1]||'Garden care'},f.get('date'),f.get('allDay')?'':f.get('time'))],`garden-${f.get('date')}.ics`,{type:'text/calendar'}); }
function openCalendar(id) {
  calendarTask=library.tasks.find(t=>t.id===id);
  const d=`${year}-${String(month+1).padStart(2,'0')}-${String(year===THIS_YEAR&&month===THIS_MONTH?today.getDate():1).padStart(2,'0')}`;
  openSheet('calendar','Add to Calendar',`<p>${linkify(jobText(calendarTask))}</p><form id="calendarForm" class="stack-form"><label class="fl">Date<input type="date" name="date" value="${d}" required></label><label class="checklabel"><input type="checkbox" name="allDay" id="allDay" checked> All day</label><label class="fl" id="timeRow" hidden>Time<input type="time" name="time" value="09:00"></label><button class="btn primary">Download calendar event</button><button class="btn" type="button" id="shareEvent" hidden>Share to Calendar</button><p class="sub" id="calendarStatus" role="status">Open the file to confirm the event in Calendar.</p></form>`);
  try { $('#shareEvent').hidden=!(navigator.share&&navigator.canShare?.({files:[calendarFile()]})); }catch{}
}
function download(file) { const url=URL.createObjectURL(file),a=document.createElement('a');a.href=url;a.download=file.name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000); }
function exportData(format) {
  let text,type,name;
  if(format==='json') { text=JSON.stringify({version:1,exported_at:new Date().toISOString(),libraryVersion:library.version,...store.state},null,2);type='application/json';name='garden-backup.json'; }
  else {
    const md=s=>String(s).replace(/([\\`*_[\]<>#])/g,'\\$1');
    const ns=notes();
    text='# Gangarapu Garden notes\n\n'+[...new Set(ns.map(n=>n.year))].sort((a,b)=>b-a).map(y=>`## ${y}\n\n`+ns.filter(n=>n.year===y).map(n=>{
      const p=plant(n.plant_id);return `**${n.observed_on}${p?` · ${md(p.name)}`:''}**\n\n${md(n.body)}\n\n`;
    }).join('')).join('');type='text/markdown';name='garden-notes.md';
  }
  download(new File([text],name,{type}));notify('Export ready. Save it somewhere you can find it.');
}
function refreshAfterChange() { render();if($('#sheet').open&&sheetType==='plant')renderPlant(); }
let armedDelete=null,deleteTimer;
document.addEventListener('click',async e=>{
  const link=e.target.closest('a.plink');if(link){e.preventDefault();openPlant(link.dataset.plant);return;}
  const t=e.target.closest('button');if(!t)return;
  if(t.hasAttribute('data-close')) { t.closest('dialog').close();return; }
  if(t.dataset.tab) { $('#sheet').close();route(t.dataset.tab);return; }
  if(t.dataset.plant) { openPlant(t.dataset.plant);return; }
  if(t.dataset.month!==undefined) { month=Number(t.dataset.month);route('jobs');return; }
  if(t.dataset.step) { const next=month+Number(t.dataset.step);if(next<0||next>11){const y=year+(next<0?-1:1);if(hasYear(y)){switchYear(y);month=next<0?11:0;}}else month=next;render();return; }
  if(t.dataset.adjacent) { switchYear(Number(t.dataset.adjacent));month=Number(t.dataset.endmonth);render();return; }
  if(t.dataset.year) { switchYear(Number(t.dataset.year));$('#sheet').close();route(year>THIS_YEAR?'garden':'jobs');return; }
  if(t.dataset.plan) { const y=Number(t.dataset.plan);addYear(y);switchYear(y);route('garden');openPicker();return; }
  if(t.dataset.filter) {filter=t.dataset.filter;render();return;}
  if(t.dataset.plantTab) {plantTab=t.dataset.plantTab;renderPlant();return;}
  if(t.dataset.addplant) {addPlant(t.dataset.addplant);refreshAfterChange();return;}
  if(t.dataset.status) {const row=planting(plantId);if(row&&row.status!==t.dataset.status)store.put('plantings',{...row,status:t.dataset.status});refreshAfterChange();return;}
  if(t.dataset.edit) {openNote(t.dataset.edit);return;}
  if(t.dataset.delete) {
    if(armedDelete===t.dataset.delete) {const n=notes().find(n=>n.id===armedDelete);store.put('notes',{...n,deleted:true});armedDelete=null;clearTimeout(deleteTimer);refreshAfterChange();notify('Note deleted.');}
    else {document.querySelectorAll('[data-delete]').forEach(b=>{b.textContent='Delete';b.classList.remove('arm');});armedDelete=t.dataset.delete;t.textContent='Tap again to delete';t.classList.add('arm');clearTimeout(deleteTimer);deleteTimer=setTimeout(()=>{armedDelete=null;t.textContent='Delete';t.classList.remove('arm');},4000);}return;
  }
  if(t.dataset.calendar) {openCalendar(t.dataset.calendar);return;}
  if(t.dataset.export) {exportData(t.dataset.export);return;}
  if(t.id==='yearBtn') {openYears();return;}
  if(t.id==='menuBtn') {openMenu();return;}
  if(t.id==='fab') {openNote();return;}
  if(t.id==='shareEvent') {
    if(!$('#calendarForm').reportValidity())return;
    try{await navigator.share({files:[calendarFile()],title:'Garden chore'});$('#calendarStatus').textContent='Calendar file shared.';}catch(error){if(error.name!=='AbortError')$('#calendarStatus').textContent='Sharing is unavailable. Download the event instead.';}return;
  }
  switch(t.dataset.action) {
    case 'picker': $('#noteSheet').close();openPicker();break;
    case 'account':openAccount();break;
    case 'guides':openGuides();break;
    case 'dismiss':safeStorage.set(`garden-dismiss-${year}`,'yes');render();break;
    case 'sync':await store.sync();renderSync();break;
    case 'signin':location.reload();break;
  }
});
document.addEventListener('change',e=>{
  const t=e.target;
  if(t.dataset.check) {
    const row={year,task_id:t.dataset.check};store.put('checks',row,t.checked?'upsert':'delete');t.closest('.job').classList.toggle('done',t.checked);
    const checks=[...$('#main').querySelectorAll('[data-check]')],done=checks.filter(c=>c.checked).length;
    $('#progressLabel').textContent=`${done} of ${checks.length} jobs done · ${garden().length} plants`;
    $('.meter').setAttribute('aria-valuenow',done);$('.meter i').style.width=`${100*done/(checks.length||1)}%`;
    const group=t.closest('[data-jobgroup]'),items=[...group.querySelectorAll('[data-check]')];group.querySelector('.cnt').textContent=`${items.filter(i=>i.checked).length}/${items.length}`;return;
  }
  if(t.dataset.pick) {const row=planting(t.dataset.pick);if(t.checked)addPlant(t.dataset.pick);else if(row)store.put('plantings',row,'delete');$('#pickerCount').textContent=`${yearPlants().length} plants selected`;render();return;}
  if(t.closest('[data-composer]')&&['year','observed_on'].includes(t.name)) {const form=t.form;form.querySelector('[data-note-summary]').textContent=`${dateLabel(form.elements.observed_on.value)} · ${form.elements.year.value} garden`;}
  if(t.id==='allDay') {$('#timeRow').hidden=t.checked;$('#timeRow input').disabled=t.checked;}
});
document.addEventListener('input',e=>{if(e.target.id==='pickerSearch')renderPicker();});
document.addEventListener('submit',async e=>{
  e.preventDefault();const form=e.target,f=new FormData(form);
  if(form.dataset.composer) {
    const body=String(f.get('body')).trim();if(!body){form.querySelector('textarea').focus();return;}
    const old=store.state.notes.find(n=>n.id===form.dataset.editId);
    store.put('notes',{id:old?.id||crypto.randomUUID(),plant_id:old?.plant_id||GENERAL_NOTE,year:Number(f.get('year')),observed_on:f.get('observed_on'),tag:old?.tag||'note',body,created_at:old?.created_at||new Date().toISOString(),deleted:false});
    if(form.closest('#noteSheet'))$('#noteSheet').close();refreshAfterChange();notify('Note saved.');return;
  }
  if(form.id==='customForm') {
    const name=String(f.get('name')).trim();if(!name)return;
    const id='custom-'+crypto.randomUUID();store.put('custom',{id,name,area:f.get('area'),life:f.get('life')});addPlant(id);form.reset();renderPicker();render();notify(`${name} added to your garden.`);return;
  }
  if(form.id==='calendarForm') {try{download(calendarFile());$('#calendarStatus').textContent='Calendar file ready. Open it to confirm the event in Calendar.';}catch(error){$('#calendarStatus').textContent=error.message;}}
});
for(const d of document.querySelectorAll('dialog')) {
  d.addEventListener('click',e=>{if(e.target!==d)return;const r=d.getBoundingClientRect();if(e.clientY<r.top||e.clientY>r.bottom||e.clientX<r.left||e.clientX>r.right)d.close();});
  d.addEventListener('close',()=>{if(d.id==='sheet'){if(sheetType==='plant'&&location.hash.startsWith('#plant-'))history.replaceState(null,'','#'+tab);sheetType='';render();}});
}
window.addEventListener('hashchange',()=>{
  const hash=location.hash.slice(1);if(hash.startsWith('plant-'))openPlant(decodeURIComponent(hash.slice(6)),false);else if(['jobs','garden','year','notes'].includes(hash)&&tab!==hash){tab=hash;if($('#sheet').open)$('#sheet').close();render();}
});
async function init() {
  try {
    const results=await Promise.all(['data/plants.json','data/guides.json'].map(async url=>{const r=await fetch(url);if(!r.ok)throw new Error('Could not load garden data.');return r.json();}));
    [library,guides]=results;
    let changeTimer;
    store=createStore(library.plants,()=>{renderSync();clearTimeout(changeTimer);changeTimer=setTimeout(()=>{if(store?.status==='ready'){render();if($('#sheet').open&&sheetType==='plant'&&!$('#sheet').querySelector('textarea:focus,input:focus,select:focus')&&!$('#sheet').querySelector('textarea')?.value)renderPlant();}},100);});
    year=Number(safeStorage.get('garden-selected-year'))||THIS_YEAR;
    if(year<2000||year>2100)year=THIS_YEAR;
    if(!hasYear(year))addYear(year);
    const hash=location.hash.slice(1);tab=['jobs','garden','year','notes'].includes(hash)?hash:'jobs';render();
    if(hash.startsWith('plant-'))openPlant(decodeURIComponent(hash.slice(6)),false);
    if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
  } catch(error) {$('#main').innerHTML=`<p class="empty">${esc(error.message)} Reload when you’re online to finish opening your garden.</p>`;}
}
void init();
