/* ============================================================
   Cadran — emploi du temps par blocs
   Vanilla JS, aucune dépendance. Données locales (localStorage).
   ============================================================ */
(() => {
'use strict';

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const JOURS = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
const JJ    = ['D','L','M','M','J','V','S'];
const MOIS  = ['JANVIER','FEVRIER','MARS','AVRIL','MAI','JUIN','JUILLET','AOUT','SEPTEMBRE','OCTOBRE','NOVEMBRE','DECEMBRE'];

const PALETTE = [
  { hex:'#ff1f14', dark:false }, { hex:'#ff7a00', dark:false },
  { hex:'#ffc400', dark:true  }, { hex:'#33d17a', dark:true  },
  { hex:'#00b8d4', dark:true  }, { hex:'#4d6bff', dark:false },
  { hex:'#a855f7', dark:false }, { hex:'#f2f2f2', dark:true  }
];
const isDark = hex => (PALETTE.find(p => p.hex === hex) || {}).dark === true;

/* ————————————————— État ————————————————— */
const KEY = 'cadran.v1';
const DEFAULTS = {
  events: [],
  templates: [
    { id:'t1', title:'Réunion', mins:60, color:'#ff1f14', desc:'' },
    { id:'t2', title:'Travail concentré', mins:90, color:'#4d6bff', desc:'' },
    { id:'t3', title:'Pause', mins:30, color:'#ffc400', desc:'' },
    { id:'t4', title:'Sport', mins:60, color:'#33d17a', desc:'' }
  ],
  settings: { dayStart:8, dayEnd:20, snap:15, half:true,
              mailTo:'', mailSubject:'Cadran — mise à jour', mailRange:'week' },
  rev: 0
};

let S = load();
let sel = null;            // id du bloc sélectionné
let clip = null;           // presse-papier interne
let query = '';
let past = [], future = [];
let drag = null;           // état du geste en cours

const todayISO = () => iso(new Date());
let view = todayISO();     // date affichée

function iso(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function fromISO(s){ const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); }
function shiftDay(s, n){ const d = fromISO(s); d.setDate(d.getDate()+n); return iso(d); }
function hm(min){ return `${String(Math.floor(min/60)).padStart(2,'0')}:${String(min%60).padStart(2,'0')}`; }
function dur(m){ const h = Math.floor(m/60), r = m%60; return h ? (r ? `${h}h${String(r).padStart(2,'0')}` : `${h}h`) : `${r} min`; }

function load(){
  try{
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (!raw) return structuredClone(DEFAULTS);
    return {
      events: Array.isArray(raw.events) ? raw.events : [],
      templates: Array.isArray(raw.templates) ? raw.templates : structuredClone(DEFAULTS.templates),
      settings: Object.assign({}, DEFAULTS.settings, raw.settings || {}),
      rev: Number(raw.rev) || 0
    };
  }catch(e){ return structuredClone(DEFAULTS); }
}
function save(){
  try{ localStorage.setItem(KEY, JSON.stringify(S)); }
  catch(e){ toast("Stockage indisponible : les données ne seront pas conservées."); }
  markDirty();
}
function snapshot(){ past.push(JSON.stringify({ e:S.events, t:S.templates })); if (past.length > 80) past.shift(); future = []; }
function undo(){ if (!past.length) return toast('Rien à annuler'); future.push(JSON.stringify({e:S.events,t:S.templates}));
  const p = JSON.parse(past.pop()); S.events = p.e; S.templates = p.t; after('Annulé'); }
function redo(){ if (!future.length) return toast('Rien à rétablir'); past.push(JSON.stringify({e:S.events,t:S.templates}));
  const p = JSON.parse(future.pop()); S.events = p.e; S.templates = p.t; after('Rétabli'); }
function after(msg){ save(); render(); if (msg) toast(msg); }

/* ================================================================
   Synchronisation GitHub — data/schedule.json comme coffre central
   ================================================================ */
const SYNC_KEY = 'cadran.sync.v1';
let SYNC = loadSync();
let dirtyT = null;

function loadSync(){
  try{
    const raw = JSON.parse(localStorage.getItem(SYNC_KEY));
    return Object.assign({ owner:'', repo:'', branch:'main', path:'data/schedule.json',
                            token:'', auto:false, sha:null, dirty:false, lastSync:0 }, raw || {});
  }catch(e){
    return { owner:'', repo:'', branch:'main', path:'data/schedule.json',
             token:'', auto:false, sha:null, dirty:false, lastSync:0 };
  }
}
function saveSync(){ try{ localStorage.setItem(SYNC_KEY, JSON.stringify(SYNC)); }catch(e){} }
const syncConfigured = () => !!(SYNC.owner && SYNC.repo && SYNC.token);

function markDirty(){
  SYNC.dirty = true; saveSync(); setSyncDot('busy');
  if (!syncConfigured() || !SYNC.auto) return;
  clearTimeout(dirtyT);
  dirtyT = setTimeout(() => pushToGitHub().catch(() => {}), 2500);
}

function setSyncDot(state, label){
  const dot = $('#syncDot'), lab = $('#syncLabel');
  if (!dot) return;
  dot.className = 'syncdot' + (state ? ' ' + state : '');
  if (lab) lab.textContent = label || 'Sync';
}

async function ghApi(path, opts = {}){
  const r = await fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Authorization': `Bearer ${SYNC.token}`,
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.headers || {})
    }
  });
  return r;
}

function utf8ToB64(str){ const b = new TextEncoder().encode(str); let s=''; b.forEach(x=>s+=String.fromCharCode(x)); return btoa(s); }
function b64ToUtf8(b64){ const bin = atob(b64.replace(/\n/g,'')); const arr = Uint8Array.from(bin, c=>c.charCodeAt(0)); return new TextDecoder().decode(arr); }

async function ghGetFile(){
  const p = `/repos/${SYNC.owner}/${SYNC.repo}/contents/${SYNC.path}?ref=${encodeURIComponent(SYNC.branch)}`;
  const r = await ghApi(p);
  if (r.status === 404) return { exists:false, sha:null, data:null };
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  const j = await r.json();
  let data = null;
  try{ data = JSON.parse(b64ToUtf8(j.content)); }catch(e){ data = null; }
  return { exists:true, sha:j.sha, data };
}

async function ghPutFile(data, sha){
  const body = { message:`Cadran : mise à jour (${new Date().toLocaleString('fr-FR')})`,
                 content: utf8ToB64(JSON.stringify(data, null, 2)), branch:SYNC.branch };
  if (sha) body.sha = sha;
  const p = `/repos/${SYNC.owner}/${SYNC.repo}/contents/${SYNC.path}`;
  const r = await ghApi(p, { method:'PUT', body:JSON.stringify(body) });
  if (r.status === 409) return { conflict:true };
  if (!r.ok){ const t = await r.text().catch(()=> ''); throw new Error(`GitHub ${r.status} ${t.slice(0,140)}`); }
  const j = await r.json();
  return { conflict:false, sha:j.content.sha };
}

function applyRemote(data){
  S.events = Array.isArray(data.events) ? data.events : [];
  S.templates = Array.isArray(data.templates) ? data.templates : structuredClone(DEFAULTS.templates);
  // Les préférences propres à cet appareil (plage horaire, envoi mail…) restent locales.
  if (data.settings) S.settings = Object.assign({}, S.settings, {
    dayStart:data.settings.dayStart, dayEnd:data.settings.dayEnd,
    snap:data.settings.snap, half:data.settings.half
  });
  save(); render();
}

async function pullFromGitHub(){
  setSyncDot('busy', 'Sync…');
  const r = await ghGetFile();
  SYNC.sha = r.sha; SYNC.dirty = false; SYNC.lastSync = Date.now(); saveSync();
  if (r.exists && r.data) applyRemote(r.data);
  setSyncDot('ok', 'Sync');
  return r;
}

async function pushToGitHub(){
  if (!syncConfigured()) return;
  setSyncDot('busy', 'Sync…');
  try{
    // Vérifie que personne d'autre n'a modifié le fichier depuis notre dernier point de repère
    const cur = await ghGetFile();
    if (cur.exists && SYNC.sha && cur.sha !== SYNC.sha){
      setSyncDot('err', 'Conflit');
      openConflict(cur);
      return;
    }
    const payload = { events:S.events, templates:S.templates,
                       settings:{ dayStart:S.settings.dayStart, dayEnd:S.settings.dayEnd,
                                  snap:S.settings.snap, half:S.settings.half } };
    const res = await ghPutFile(payload, cur.exists ? cur.sha : null);
    if (res.conflict){ setSyncDot('err','Conflit'); openConflict(await ghGetFile()); return; }
    SYNC.sha = res.sha; SYNC.dirty = false; SYNC.lastSync = Date.now(); saveSync();
    setSyncDot('ok', 'Sync');
  }catch(err){
    setSyncDot('err', 'Erreur');
    toast('Synchronisation impossible : ' + (err.message || 'erreur réseau'));
  }
}

const dConflict = $('#dlgConflict');
function openConflict(remote){
  $('#conflictMsg').textContent =
    `Le fichier a été modifié ailleurs (un autre appareil, ou directement sur GitHub) depuis votre ` +
    `dernière synchronisation. Recharger reprend la version distante (vos changements non envoyés ` +
    `seront perdus). Forcer l'envoi remplace la version distante par celle de cet appareil.`;
  dConflict._remote = remote;
  dConflict.showModal();
}
$('#cfReload').onclick = async () => {
  dConflict.close();
  try{ await pullFromGitHub(); toast('Rechargé depuis GitHub'); }
  catch(e){ toast('Rechargement impossible'); }
};
$('#cfForce').onclick = async () => {
  const remote = dConflict._remote;
  dConflict.close();
  try{
    const payload = { events:S.events, templates:S.templates,
                       settings:{ dayStart:S.settings.dayStart, dayEnd:S.settings.dayEnd,
                                  snap:S.settings.snap, half:S.settings.half } };
    const res = await ghPutFile(payload, remote && remote.exists ? remote.sha : null);
    if (res.conflict) return toast('Toujours en conflit — réessayez');
    SYNC.sha = res.sha; SYNC.dirty = false; SYNC.lastSync = Date.now(); saveSync();
    setSyncDot('ok','Sync'); toast('Version locale envoyée, le distant a été remplacé');
  }catch(e){ toast('Envoi forcé impossible : ' + (e.message||'')); }
};
$('#cfCancel').onclick = () => dConflict.close();

/* Réglages du dialogue de synchronisation */
const dSync = $('#dlgSync');
function openSyncDialog(){
  $('#gOwner').value = SYNC.owner; $('#gRepo').value = SYNC.repo;
  $('#gBranch').value = SYNC.branch || 'main'; $('#gPath').value = SYNC.path || 'data/schedule.json';
  $('#gToken').value = SYNC.token; $('#gAuto').checked = !!SYNC.auto;
  refreshSyncStatusMsg();
  dSync.showModal();
}
function readSyncForm(){
  SYNC.owner = $('#gOwner').value.trim();
  SYNC.repo = $('#gRepo').value.trim();
  SYNC.branch = $('#gBranch').value.trim() || 'main';
  SYNC.path = $('#gPath').value.trim() || 'data/schedule.json';
  SYNC.token = $('#gToken').value.trim();
  SYNC.auto = $('#gAuto').checked;
  saveSync();
}
function refreshSyncStatusMsg(){
  const p = $('#syncStatusMsg');
  if (!syncConfigured()){ p.textContent = 'Non configuré.'; return; }
  p.textContent = SYNC.lastSync
    ? `Dernière synchronisation : ${new Date(SYNC.lastSync).toLocaleString('fr-FR')}.`
    : 'Configuré, jamais synchronisé.';
}
$('#syncBtn').onclick = openSyncDialog;
$('#gClose').onclick = () => dSync.close();
$('#gAuto').addEventListener('change', readSyncForm);
$('#gTest').onclick = async () => {
  readSyncForm();
  if (!syncConfigured()) return toast('Renseignez propriétaire, dépôt et jeton');
  const btn = $('#gTest'); btn.disabled = true; btn.textContent = 'Test…';
  try{
    const r = await ghApi(`/repos/${SYNC.owner}/${SYNC.repo}`);
    if (r.status === 404) toast('Dépôt introuvable ou jeton sans accès à ce dépôt');
    else if (r.status === 401) toast('Jeton invalide ou expiré');
    else if (!r.ok) toast(`Réponse GitHub inattendue (${r.status})`);
    else toast('Connexion au dépôt réussie');
  }catch(e){ toast('Connexion impossible : vérifiez le réseau'); }
  finally{ btn.disabled = false; btn.textContent = 'Tester la connexion'; }
};
$('#gSyncNow').onclick = async () => {
  readSyncForm();
  if (!syncConfigured()) return toast('Renseignez propriétaire, dépôt et jeton');
  const btn = $('#gSyncNow'); btn.disabled = true; btn.textContent = 'Synchronisation…';
  try{
    if (SYNC.dirty) await pushToGitHub(); else await pullFromGitHub();
    refreshSyncStatusMsg();
  } finally { btn.disabled = false; btn.textContent = 'Synchroniser maintenant'; }
};

/* Synchronisation automatique : au démarrage, à la reconnexion, et sur focus */
async function autoSyncTick(){
  if (!syncConfigured() || !navigator.onLine) return;
  try{ SYNC.dirty ? await pushToGitHub() : await pullFromGitHub(); }catch(e){}
}
addEventListener('online', autoSyncTick);
addEventListener('focus', () => { if (SYNC.auto) autoSyncTick(); });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && SYNC.auto) autoSyncTick();
});

/* ————————————————— Géométrie ————————————————— */
const D0 = () => S.settings.dayStart * 60;
const D1 = () => S.settings.dayEnd * 60;
const SPAN = () => D1() - D0();
const snapTo = m => Math.round(m / S.settings.snap) * S.settings.snap;

const canvas = $('#canvas');
function minutesAt(clientY){
  const r = canvas.getBoundingClientRect();
  return D0() + ((clientY - r.top) / r.height) * SPAN();
}
function pxToMin(px){
  const r = canvas.getBoundingClientRect();
  return (px / r.height) * SPAN();
}
const pct = m => ((m - D0()) / SPAN()) * 100;

const dayEvents = d => S.events.filter(e => e.date === d).sort((a,b) => a.s - b.s || a.e - b.e);
const evt = id => S.events.find(e => e.id === id);

/* Colonnes pour les blocs qui se chevauchent */
function layout(list){
  const out = new Map(); let group = [], groupEnd = -1;
  const flush = () => {
    const cols = [];
    group.forEach(e => {
      let i = cols.findIndex(c => c[c.length-1].e <= e.s);
      if (i === -1){ cols.push([e]); i = cols.length-1; } else cols[i].push(e);
      out.set(e.id, { col:i, of:0 });
    });
    group.forEach(e => out.get(e.id).of = cols.length);
    group = []; groupEnd = -1;
  };
  list.forEach(e => {
    if (group.length && e.s >= groupEnd) flush();
    group.push(e); groupEnd = Math.max(groupEnd, e.e);
  });
  if (group.length) flush();
  return out;
}

/* ————————————————— Rendu ————————————————— */
function render(){
  if (!drag) $('#ghost').hidden = true;
  renderStrip(); renderDay(); renderLib(); renderInspector(); renderStats(); renderNow();
}

function renderStrip(){
  const d = fromISO(view), y = d.getFullYear(), m = d.getMonth();
  $('#monthLabel').textContent = MOIS[m];
  const n = new Date(y, m+1, 0).getDate();
  const counts = {}, hits = {};
  S.events.forEach(e => {
    counts[e.date] = (counts[e.date]||0)+1;
    if (query && `${e.title} ${e.desc} ${e.place}`.toLowerCase().includes(query))
      hits[e.date] = (hits[e.date]||0)+1;
  });
  const strip = $('#strip'); strip.innerHTML = '';
  for (let i = 1; i <= n; i++){
    const key = `${y}-${String(m+1).padStart(2,'0')}-${String(i).padStart(2,'0')}`;
    const dd = new Date(y, m, i), w = dd.getDay();
    const match = !query || !!hits[key];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = [w === 0 || w === 6 ? 'we' : '', key === todayISO() ? 'today' : '',
                   query && hits[key] ? 'hit' : ''].filter(Boolean).join(' ');
    if (key === view) b.setAttribute('aria-current','date');
    b.setAttribute('aria-label',
      `${JOURS[w]} ${i} ${MOIS[m].toLowerCase()} — ${counts[key]||0} bloc(s)` +
      (query ? `, ${hits[key]||0} résultat(s)` : ''));
    const dots = Math.min(counts[key]||0, 3);
    b.innerHTML = `<span class="w">${JJ[w]}</span><span class="d">${i}</span>
      <span class="dots${match ? '' : ' off'}">${'<i></i>'.repeat(dots)}</span>`;
    b.onclick = () => { view = key; sel = null; render(); };
    strip.appendChild(b);
  }
  const cur = strip.querySelector('[aria-current]');
  if (cur) cur.scrollIntoView({ block:'nearest', inline:'center' });
  updateStripFade();
}

function updateStripFade(){
  const strip = $('#strip'), wrap = strip.parentElement;
  if (!wrap || !wrap.classList.contains('strip-wrap')) return;
  const max = strip.scrollWidth - strip.clientWidth;
  wrap.classList.toggle('fade-l', strip.scrollLeft > 4);
  wrap.classList.toggle('fade-r', strip.scrollLeft < max - 4);
}
$('#strip').addEventListener('scroll', updateStripFade, { passive:true });
addEventListener('resize', updateStripFade);

function renderDay(){
  const d = fromISO(view);
  $('#dayName').textContent = JOURS[d.getDay()];
  $('#dayDate').textContent = `(${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')})`;

  // Gouttière + filets : une ligne par heure, jamais de débordement
  const hours = S.settings.dayEnd - S.settings.dayStart;
  const g = $('#gutter'), r = $('#rules');
  g.innerHTML = ''; r.innerHTML = '';
  for (let i = 0; i < hours; i++){
    const h = S.settings.dayStart + i;
    const s = document.createElement('span');
    s.innerHTML = `<b>${String(h).padStart(2,'0')}</b>h`;
    g.appendChild(s);
    const line = document.createElement('i');
    if (S.settings.half) line.className = 'half';
    r.appendChild(line);
  }

  // Blocs
  const list = dayEvents(view), pos = layout(list), layer = $('#layer');
  layer.innerHTML = '';

  let outside = 0;
  list.forEach(e => {
    const top = clamp(pct(e.s), 0, 100), bot = clamp(pct(e.e), 0, 100);
    if (bot <= 0 || top >= 100){ outside++; return; }
    const p = pos.get(e.id) || { col:0, of:1 };
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'blk'; b.dataset.id = e.id;
    b.style.top = top + '%';
    b.style.height = Math.max(1.2, bot - top) + '%';
    const w = 100 / p.of;
    b.style.left = `calc(${p.col * w}% + 6px)`;
    b.style.width = `calc(${w}% - 12px)`;
    b.style.background = e.color;
    if (isDark(e.color)) b.classList.add('ink-dark');
    if (e.done) b.classList.add('done');
    if (e.id === sel) b.classList.add('sel');
    if (query && !(`${e.title} ${e.desc} ${e.place}`.toLowerCase().includes(query))) b.classList.add('dim');
    if (e.e - e.s < 35) b.classList.add('tiny');
    b.setAttribute('aria-label', `${e.title || 'Sans titre'}, ${hm(e.s)} à ${hm(e.e)}${e.done ? ', terminé' : ''}`);
    b.innerHTML = `<span class="grip top"></span>
      <span class="t">${esc(e.title || 'Sans titre')}</span>
      <span class="h">${hm(e.s)} – ${hm(e.e)} · ${dur(e.e - e.s)}</span>
      ${e.place ? `<span class="p">${esc(e.place)}</span>` : ''}
      <span class="grip bot"></span>`;
    layer.appendChild(b);
  });

  const busy = list.reduce((a,e) => a + (e.e - e.s), 0);
  $('#dayLoad').innerHTML = `<i style="width:${clamp(busy / SPAN() * 100, 0, 100)}%"></i>`;
  $('#emptyHint').hidden = list.length > 0;
  if (outside){
    $('#emptyHint').hidden = false;
    $('#emptyHint').textContent =
      `${outside} bloc${outside>1?'s':''} hors des heures affichées — élargissez la plage dans les réglages`;
  } else if (!list.length){
    $('#emptyHint').textContent = 'Glissez ici pour créer un bloc';
  }
}

function esc(s){ return String(s ?? '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c])); }

function renderLib(){
  const lib = $('#lib'); lib.innerHTML = '';
  S.templates.forEach(t => {
    const b = document.createElement('div');
    b.className = 'tpl' + (isDark(t.color) ? ' ink-dark' : '');
    b.dataset.tpl = t.id; b.style.background = t.color;
    b.tabIndex = 0; b.setAttribute('role','button');
    b.setAttribute('aria-label', `Modèle ${t.title}, ${dur(t.mins)}. Entrée pour placer au prochain créneau libre.`);
    b.title = 'Glisser sur la grille, ou cliquer pour placer au prochain créneau libre';
    b.innerHTML = `${esc(t.title)}<small>${dur(t.mins)}</small>
      <button type="button" class="x" data-del="${t.id}" title="Retirer le modèle"
        aria-label="Retirer le modèle ${esc(t.title)}">×</button>`;
    b.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' || ev.key === ' '){
        ev.preventDefault();
        const s = firstFreeSlot(t.mins);
        create(s, s + t.mins, { title:t.title, color:t.color, desc:t.desc });
      }
    });
    lib.appendChild(b);
  });
}

function renderStats(){
  const list = dayEvents(view);
  const busy = list.reduce((a,e) => a + (e.e - e.s), 0);
  const now = new Date();
  const next = view === todayISO()
    ? list.find(e => e.s > now.getHours()*60 + now.getMinutes())
    : list[0];
  $('#stats').innerHTML =
    `<span><b>${list.length}</b> bloc${list.length>1?'s':''} · <b>${dur(busy)}</b> occupé</span>
     <span><b>${dur(Math.max(0, SPAN()-busy))}</b> libre</span>
     <span>${next ? `Suivant : <b>${esc(next.title||'Sans titre')}</b> ${hm(next.s)}` : 'Aucun bloc à venir'}</span>`;
}

function renderNow(){
  const line = $('#nowLine'), n = new Date(), m = n.getHours()*60 + n.getMinutes();
  const on = view === todayISO() && m >= D0() && m <= D1();
  line.hidden = !on;
  if (on){ line.style.top = pct(m) + '%'; $('#nowTag').textContent = hm(m); }
}

/* ————————————————— Inspecteur ————————————————— */
const F = {
  title:$('#fTitle'), start:$('#fStart'), end:$('#fEnd'), desc:$('#fDesc'),
  place:$('#fPlace'), done:$('#fDone')
};
let repDays = new Set();   // jours cochés dans le sélecteur de répétition

function buildSwatches(){
  const w = $('#swatches'); w.innerHTML = '';
  PALETTE.forEach(p => {
    const b = document.createElement('button');
    b.type = 'button'; b.role = 'radio'; b.dataset.color = p.hex;
    b.style.background = p.hex; b.setAttribute('aria-label', 'Couleur ' + p.hex);
    b.onclick = () => { const e = evt(sel); if (!e) return; snapshot(); e.color = p.hex; after(); };
    w.appendChild(b);
  });
  const chips = $('#durChips');
  [15,30,45,60,90,120].forEach(m => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = dur(m);
    b.onclick = () => { const e = evt(sel); if (!e) return; snapshot(); e.e = clamp(e.s + m, e.s + 5, D1()); after(); };
    chips.appendChild(b);
  });
}

function renderInspector(){
  const e = evt(sel), on = !!e;
  document.body.classList.toggle('sheet-open', on);
  $('#sheetScrim').hidden = !on;
  [...Object.values(F), ...$$('#swatches button'), ...$$('#durChips button'),
   ...$$('#repDays button'), $('#repWeeks'), $('#repApply'),
   $('#btnDup'), $('#btnDel'), $('#btnTpl')].forEach(el => el.disabled = !on);
  $('#inspHint').textContent = on
    ? 'Suppr pour supprimer · ↑↓ déplacer · ⇧↑↓ ajuster la durée'
    : 'Sélectionnez un bloc, ou glissez sur la grille pour en créer un.';
  F.title.value = on ? (e.title || '') : '';
  F.desc.value  = on ? (e.desc  || '') : '';
  F.place.value = on ? (e.place || '') : '';
  F.start.value = on ? hm(e.s) : '';
  F.end.value   = on ? hm(e.e) : '';
  F.done.checked = on ? !!e.done : false;
  $$('#swatches button').forEach(b =>
    b.setAttribute('aria-checked', String(on && b.dataset.color === e.color)));

  // Jours cochés : ceux de la série si elle existe, sinon le jour du bloc
  const fam = on ? family(e) : [];
  if (on){
    repDays = new Set(fam.length > 1
      ? fam.map(x => fromISO(x.date).getDay())
      : [fromISO(e.date).getDay()]);
  } else repDays = new Set();
  $$('#repDays button').forEach(b =>
    b.setAttribute('aria-pressed', String(repDays.has(+b.dataset.wd))));

  const box = $('#seriesBox');
  box.hidden = fam.length < 2;
  if (!box.hidden){
    const last = fam.map(x => x.date).sort().pop();
    $('#seriesCount').textContent = fam.length;
    $('#seriesLast').textContent = last.split('-').reverse().join('/');
  }
}

/* Séries de blocs répétés */
function family(e){ return e && e.rid ? S.events.filter(x => x.rid === e.rid) : (e ? [e] : []); }

function buildRepeatDays(){
  const w = $('#repDays');
  [1,2,3,4,5,6,0].forEach(d => {
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.wd = d; b.textContent = JJ[d];
    b.setAttribute('aria-pressed','false');
    b.setAttribute('aria-label', JOURS[d]);
    b.onclick = () => {
      repDays.has(d) ? repDays.delete(d) : repDays.add(d);
      b.setAttribute('aria-pressed', String(repDays.has(d)));
    };
    w.appendChild(b);
  });
}

function applyRepeat(){
  const e = evt(sel); if (!e) return;
  const days = repDays.size ? [...repDays] : [fromISO(e.date).getDay()];
  const weeks = +$('#repWeeks').value;
  snapshot();

  // On repart d'une série propre : les autres occurrences sont remplacées
  const rid = e.rid || uid();
  S.events = S.events.filter(x => x.rid !== rid || x.id === e.id);
  e.rid = rid;

  const start = fromISO(e.date), end = new Date(start);
  end.setDate(end.getDate() + weeks * 7);
  const seen = new Set([e.date]);
  const cur = new Date(start);
  while (cur <= end){
    const key = iso(cur);
    if (days.includes(cur.getDay()) && !seen.has(key)){
      seen.add(key);
      S.events.push({ ...e, id:uid(), date:key, rid, done:false });
    }
    cur.setDate(cur.getDate() + 1);
  }
  const n = seen.size;
  after(n > 1 ? `Répété sur ${n} jours` : 'Aucune occurrence supplémentaire');
}

$('#repApply').onclick = applyRepeat;
$('#seriesDel').onclick = () => { const e = evt(sel); if (e) delEvents(family(e), 'série supprimée'); };
$('#seriesDetach').onclick = () => {
  const e = evt(sel); if (!e || !e.rid) return;
  snapshot(); delete e.rid; after('Bloc détaché de la série');
};
$('#seriesSync').onclick = () => {
  const e = evt(sel); if (!e || !e.rid) return;
  snapshot();
  family(e).forEach(x => {
    if (x.id === e.id) return;
    Object.assign(x, { title:e.title, desc:e.desc, place:e.place, color:e.color, s:e.s, e:e.e });
  });
  after('Série alignée sur ce bloc');
};

function patch(fn, msg){ const e = evt(sel); if (!e) return; snapshot(); fn(e); after(msg); }

F.title.oninput = () => { const e = evt(sel); if (e){ e.title = F.title.value; save(); renderDay(); } };
F.desc.oninput  = () => { const e = evt(sel); if (e){ e.desc  = F.desc.value; save(); } };
F.place.oninput = () => { const e = evt(sel); if (e){ e.place = F.place.value; save(); renderDay(); } };
// L'annulation doit revenir à l'état d'avant la saisie, pas d'après
let preEdit = null;
const snap = () => JSON.stringify({ e:S.events, t:S.templates });
[F.title, F.desc, F.place].forEach(el => {
  el.addEventListener('focus', () => preEdit = snap());
  el.addEventListener('blur', () => {
    if (preEdit && preEdit !== snap()){ past.push(preEdit); future = []; }
    preEdit = null;
  });
});
F.done.onchange = () => patch(e => e.done = F.done.checked);
F.start.onchange = () => patch(e => {
  const [h,m] = F.start.value.split(':').map(Number); const d = e.e - e.s;
  e.s = clamp(h*60+m, D0(), D1()-5); e.e = clamp(e.s + d, e.s + 5, D1());
});
F.end.onchange = () => patch(e => {
  const [h,m] = F.end.value.split(':').map(Number);
  e.e = clamp(h*60+m, e.s + 5, D1());
});
$('#btnDel').onclick = () => removeSelected();
$('#btnDup').onclick = () => duplicate();
$('#btnTpl').onclick = () => {
  const e = evt(sel); if (!e) return; snapshot();
  S.templates.push({ id:uid(), title:e.title || 'Sans titre', mins:e.e - e.s, color:e.color, desc:e.desc || '' });
  after('Modèle enregistré');
};
$('#addTemplate').onclick = () => {
  if (sel) return $('#btnTpl').onclick();
  snapshot();
  S.templates.push({ id:uid(), title:'Nouveau modèle', mins:60, color:PALETTE[5].hex, desc:'' });
  after('Modèle ajouté');
};

/* ————————————————— Création / suppression ————————————————— */
function create(s, e, extra = {}){
  const ev = {
    id:uid(), date:view, s:clamp(snapTo(s), D0(), D1()-5), e:0,
    title:'', desc:'', place:'', color:PALETTE[0].hex, done:false, ...extra
  };
  ev.e = clamp(snapTo(e), ev.s + 5, D1());
  snapshot(); S.events.push(ev); sel = ev.id; after();
  requestAnimationFrame(() => F.title.focus());
  return ev;
}
function delEvents(list, label){
  if (!list.length) return;
  snapshot();
  const backup = list.map(e => ({ ...e }));
  const ids = new Set(backup.map(e => e.id));
  S.events = S.events.filter(e => !ids.has(e.id));
  sel = null; save(); render();
  const msg = label
    ? `${backup.length} blocs supprimés — ${label}`
    : `« ${backup[0].title || 'Sans titre'} » supprimé`;
  toast(msg, 'Annuler', () => { S.events.push(...backup); sel = backup[0].id; after(); });
}

const dSeries = $('#dlgSeries');
function removeSelected(){
  const e = evt(sel); if (!e) return;
  const fam = family(e);
  if (fam.length < 2) return delEvents([e]);
  $('#seriesMsg').textContent =
    `« ${e.title || 'Sans titre'} » se répète sur ${fam.length} jours. Que faut-il supprimer ?`;
  dSeries.returnValue = '';
  dSeries.showModal();
  $('#delOne').onclick   = () => { dSeries.close(); delEvents([e]); };
  $('#delAll').onclick   = () => { dSeries.close(); delEvents(fam, 'série supprimée'); };
  $('#delCancel').onclick = () => dSeries.close();
}
function duplicate(){
  const e = evt(sel); if (!e) return; snapshot();
  const d = e.e - e.s;
  const ns = clamp(e.e, D0(), D1() - d);
  const c = { ...e, id:uid(), s:ns, e:clamp(ns + d, ns + 5, D1()) };
  delete c.rid;
  S.events.push(c); sel = c.id; after('Dupliqué');
}
function firstFreeSlot(mins){
  const list = dayEvents(view);
  let t = D0();
  const now = new Date();
  if (view === todayISO()) t = Math.max(t, snapTo(now.getHours()*60 + now.getMinutes()));
  for (const e of list){
    if (e.e <= t) continue;
    if (t + mins <= e.s) break;
    t = e.e;
  }
  return clamp(t, D0(), Math.max(D0(), D1() - mins));
}

/* ————————————————— Gestes sur la grille ————————————————— */
canvas.addEventListener('pointerdown', ev => {
  if (ev.button !== 0) return;
  if (typing(document.activeElement)) document.activeElement.blur();
  const blk = ev.target.closest('.blk');
  canvas.setPointerCapture(ev.pointerId);

  if (blk){
    const e = evt(blk.dataset.id); if (!e) return;
    sel = e.id; renderDay(); renderInspector();
    const grip = ev.target.closest('.grip');
    drag = {
      mode: grip ? (grip.classList.contains('top') ? 'top' : 'bot') : 'move',
      id:e.id, y0:ev.clientY, s0:e.s, e0:e.e, moved:false
    };
    blk.focus({ preventScroll:true });
  } else {
    const m = snapTo(minutesAt(ev.clientY));
    drag = { mode:'new', anchor:clamp(m, D0(), D1()), cur:clamp(m, D0(), D1()), moved:false };
    showGhost(drag.anchor, drag.anchor);
  }
  ev.preventDefault();
});

canvas.addEventListener('pointermove', ev => {
  if (!drag) return;
  drag.moved = true;
  if (drag.mode === 'new'){
    drag.cur = clamp(snapTo(minutesAt(ev.clientY)), D0(), D1());
    showGhost(Math.min(drag.anchor, drag.cur), Math.max(drag.anchor, drag.cur));
    return;
  }
  const e = evt(drag.id); if (!e) return;
  const d = snapTo(pxToMin(ev.clientY - drag.y0));
  const len = drag.e0 - drag.s0;
  if (drag.mode === 'move'){
    e.s = clamp(drag.s0 + d, D0(), D1() - len); e.e = e.s + len;
  } else if (drag.mode === 'top'){
    e.s = clamp(drag.s0 + d, D0(), drag.e0 - 5);
  } else {
    e.e = clamp(drag.e0 + d, drag.s0 + 5, D1());
  }
  renderDay(); status(`${hm(e.s)} – ${hm(e.e)} · ${dur(e.e - e.s)}`);
});

['pointerup','pointercancel'].forEach(t => canvas.addEventListener(t, () => {
  if (!drag) return;
  const d = drag; drag = null; $('#ghost').hidden = true;
  if (d.mode === 'new'){
    const a = Math.min(d.anchor, d.cur), b = Math.max(d.anchor, d.cur);
    if (b - a >= S.settings.snap) create(a, b);
    else { sel = null; render(); }
    return;
  }
  const e = evt(d.id);
  if (e && d.moved && (e.s !== d.s0 || e.e !== d.e0)){
    const s0 = d.s0, e0 = d.e0, cur = { s:e.s, e:e.e };
    e.s = s0; e.e = e0; snapshot(); e.s = cur.s; e.e = cur.e;
  }
  save(); render(); status('Prêt');
}));

function abortDrag(){
  if (!drag) return;
  if (drag.mode !== 'new'){
    const e = evt(drag.id);
    if (e){ e.s = drag.s0; e.e = drag.e0; }
  }
  drag = null; $('#ghost').hidden = true; render(); status('Prêt');
}
addEventListener('blur', abortDrag);
document.addEventListener('visibilitychange', () => { if (document.hidden) abortDrag(); });

canvas.addEventListener('dblclick', ev => {
  if (ev.target.closest('.blk')) { F.title.focus(); return; }
  const m = snapTo(minutesAt(ev.clientY));
  create(m, m + 60);
});

function showGhost(a, b){
  const g = $('#ghost');
  g.hidden = false;
  g.style.top = pct(a) + '%';
  g.style.height = Math.max(0.8, pct(b) - pct(a)) + '%';
  g.style.left = '6px'; g.style.right = '6px';
  g.textContent = b - a >= 20 ? `${hm(a)} – ${hm(b)}` : '';
  status(`${hm(a)} – ${hm(b)} · ${dur(b - a)}`);
}

/* Sélection au focus clavier (Tab) */
$('#layer').addEventListener('focusin', ev => {
  const b = ev.target.closest('.blk');
  if (b && b.dataset.id !== sel){ sel = b.dataset.id; renderDay(); renderInspector();
    document.querySelector(`.blk[data-id="${sel}"]`)?.focus({preventScroll:true}); }
});

/* ————————————————— Modèles : glisser vers la grille ————————————————— */
$('#lib').addEventListener('pointerdown', ev => {
  const x = ev.target.closest('[data-del]');
  if (x){
    snapshot(); S.templates = S.templates.filter(t => t.id !== x.dataset.del); after('Modèle retiré'); return;
  }
  const el = ev.target.closest('.tpl'); if (!el) return;
  const t = S.templates.find(v => v.id === el.dataset.tpl); if (!t) return;
  let dragged = false;
  const move = m => {
    const r = canvas.getBoundingClientRect();
    if (m.clientY < r.top || m.clientY > r.bottom || m.clientX < r.left || m.clientX > r.right){
      $('#ghost').hidden = true; return;
    }
    dragged = true;
    const s = clamp(snapTo(minutesAt(m.clientY)), D0(), D1() - t.mins);
    showGhost(s, s + t.mins);
  };
  const up = m => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    $('#ghost').hidden = true;
    const r = canvas.getBoundingClientRect();
    const inside = m.clientY >= r.top && m.clientY <= r.bottom && m.clientX >= r.left && m.clientX <= r.right;
    if (inside && dragged){
      const s = clamp(snapTo(minutesAt(m.clientY)), D0(), D1() - t.mins);
      create(s, s + t.mins, { title:t.title, color:t.color, desc:t.desc });
    } else if (!dragged){
      const s = firstFreeSlot(t.mins);
      create(s, s + t.mins, { title:t.title, color:t.color, desc:t.desc });
    }
  };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up);
});

/* ————————————————— Clavier ————————————————— */
const typing = el => /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);

document.addEventListener('keydown', ev => {
  const k = ev.key, mod = ev.ctrlKey || ev.metaKey;

  if (typing(ev.target)){
    if (k === 'Escape'){ ev.target.blur(); canvas.focus(); }
    if (k === 'Enter' && ev.target.tagName !== 'TEXTAREA'){ ev.target.blur(); }
    if (mod && k.toLowerCase() === 'z'){ /* laisser l'édition de texte */ }
    return;
  }

  if (mod && k.toLowerCase() === 'z'){ ev.preventDefault(); ev.shiftKey ? redo() : undo(); return; }
  if (mod && k.toLowerCase() === 'y'){ ev.preventDefault(); redo(); return; }
  if (mod && k.toLowerCase() === 'd'){ ev.preventDefault(); duplicate(); return; }
  if (mod && k.toLowerCase() === 'c'){ const e = evt(sel); if (e){ clip = {...e}; toast('Bloc copié'); } return; }
  if (mod && k.toLowerCase() === 'v'){
    if (!clip) return;
    const len = clip.e - clip.s, s = firstFreeSlot(len);
    create(s, s + len, { title:clip.title, desc:clip.desc, place:clip.place, color:clip.color });
    return;
  }
  if (mod && k.toLowerCase() === 'f'){ ev.preventDefault(); $('#search').focus(); return; }
  if (mod) return;

  switch (k){
    case 'Delete': case 'Backspace':
      if (sel){ ev.preventDefault(); removeSelected(); } break;
    case 'Escape':
      if (drag) abortDrag(); else if (!menu.hidden) setMenu(false); else { sel = null; render(); }
      break;
    case 'ArrowLeft': view = shiftDay(view, -1); sel = null; render(); break;
    case 'ArrowRight': view = shiftDay(view, 1); sel = null; render(); break;
    case 'ArrowUp': case 'ArrowDown': {
      const e = evt(sel); if (!e) break;
      ev.preventDefault();
      const step = (k === 'ArrowUp' ? -1 : 1) * S.settings.snap;
      snapshot();
      if (ev.shiftKey) e.e = clamp(e.e + step, e.s + 5, D1());
      else { const len = e.e - e.s; e.s = clamp(e.s + step, D0(), D1() - len); e.e = e.s + len; }
      after(); document.querySelector(`.blk[data-id="${sel}"]`)?.focus({preventScroll:true});
      break;
    }
    case 'Enter': if (sel){ ev.preventDefault(); F.title.focus(); F.title.select(); } break;
    case 'n': case 'N': { const s = firstFreeSlot(60); create(s, s + 60); break; }
    case 't': case 'T': view = todayISO(); sel = null; render(); break;
    case 'd': case 'D': patch(e => e.done = !e.done); break;
    case 'e': case 'E': openSend(); break;
    case '?': openHelp(); break;
    case '/': ev.preventDefault(); $('#search').focus(); break;
  }
  if (/^[1-8]$/.test(k) && sel) patch(e => e.color = PALETTE[+k - 1].hex);
});

/* ————————————————— Navigation ————————————————— */
$('#prevDay').onclick = () => { view = shiftDay(view, -1); sel = null; render(); };
$('#nextDay').onclick = () => { view = shiftDay(view, 1); sel = null; render(); };
$('#todayBtn').onclick = () => { view = todayISO(); sel = null; render(); };
$('#prevMonth').onclick = () => monthJump(-1);
$('#nextMonth').onclick = () => monthJump(1);
function monthJump(n){
  const d = fromISO(view); const day = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();
  d.setDate(Math.min(day, last));
  view = iso(d); sel = null; render();
}
$('#search').addEventListener('input', e => {
  query = e.target.value.trim().toLowerCase();
  renderDay(); renderStrip();
  const total = query ? S.events.filter(x =>
    `${x.title} ${x.desc} ${x.place}`.toLowerCase().includes(query)).length : 0;
  status(query ? `${total} résultat${total>1?'s':''} dans le calendrier` : 'Prêt');
});

/* ————————————————— Menu & outils ————————————————— */
const menu = $('#menu');
function setMenu(open){
  menu.hidden = !open;
  $('#menuBtn').setAttribute('aria-expanded', String(open));
  if (open) menu.querySelector('button')?.focus();
}
$('#menuBtn').onclick = e => { e.stopPropagation(); setMenu(menu.hidden); };
// pointerdown : fonctionne même quand un geste sur la grille annule le clic
document.addEventListener('pointerdown', e => {
  if (!menu.hidden && !menu.contains(e.target) && e.target !== $('#menuBtn')) setMenu(false);
}, true);
menu.addEventListener('keydown', e => { if (e.key === 'Escape'){ setMenu(false); $('#menuBtn').focus(); } });
menu.addEventListener('click', e => {
  const act = e.target.dataset.act; if (!act) return;
  setMenu(false);
  ({ sync:openSyncDialog, send:openSend, export:doExport, import:doImport, ics:doICS, print:() => window.print(),
     copyday:copyDay, settings:openSettings, help:openHelp, clear:clearDay })[act]?.();
});

function doExport(){
  dl(new Blob([JSON.stringify(S, null, 2)], { type:'application/json' }), `cadran-${todayISO()}.json`);
  toast('Export terminé');
}
function doImport(){ $('#filePick').click(); }
$('#filePick').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try{
    const data = JSON.parse(await f.text());
    if (!Array.isArray(data.events)) throw 0;
    snapshot();
    const ids = new Set(S.events.map(x => x.id));
    data.events.forEach(x => { if (!ids.has(x.id)) S.events.push(x); });
    if (Array.isArray(data.templates)) {
      const t = new Set(S.templates.map(x => x.id));
      data.templates.forEach(x => { if (!t.has(x.id)) S.templates.push(x); });
    }
    after(`${data.events.length} blocs importés`);
  }catch(err){ toast('Fichier illisible : un export Cadran (.json) est attendu'); }
  e.target.value = '';
};
/* ————————————————— Fichier .ics ————————————————— */
function icsStamp(date, min){
  return date.replace(/-/g,'') + 'T' +
    String(Math.floor(min/60)).padStart(2,'0') + String(min%60).padStart(2,'0') + '00';
}
function icsFold(line){                      // RFC 5545 : lignes repliées
  const out = []; let s = line;
  while (s.length > 73){ out.push(s.slice(0,73)); s = ' ' + s.slice(73); }
  out.push(s); return out.join('\r\n');
}
function icsSafe(v){ return String(v ?? '').replace(/([,;\\])/g,'\\$1').replace(/\r?\n/g,'\\n'); }

function buildICS(list){
  const now = new Date().toISOString().replace(/[-:]/g,'').split('.')[0] + 'Z';
  S.rev = (S.rev || 0) + 1; save();          // SEQUENCE : un renvoi met à jour l'existant
  const L = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Cadran//FR','CALSCALE:GREGORIAN',
             'METHOD:PUBLISH','X-WR-CALNAME:Cadran'];
  list.forEach(e => {
    L.push('BEGIN:VEVENT', `UID:${e.id}@cadran`, `DTSTAMP:${now}`, `SEQUENCE:${S.rev}`,
      `DTSTART:${icsStamp(e.date, e.s)}`, `DTEND:${icsStamp(e.date, e.e)}`,
      icsFold(`SUMMARY:${icsSafe(e.title || 'Sans titre')}`),
      icsFold(`DESCRIPTION:${icsSafe(e.desc)}`),
      icsFold(`LOCATION:${icsSafe(e.place)}`),
      `STATUS:${e.done ? 'CONFIRMED' : 'TENTATIVE'}`,
      'END:VEVENT');
  });
  L.push('END:VCALENDAR');
  return L.join('\r\n');
}

function rangeEvents(mode){
  if (mode === 'all') return [...S.events].sort((a,b) => a.date.localeCompare(b.date) || a.s - b.s);
  if (mode === 'day') return dayEvents(view);
  let from, to;
  if (mode === 'week'){
    const off = (fromISO(view).getDay() + 6) % 7;   // semaine du lundi au dimanche
    from = shiftDay(view, -off); to = shiftDay(from, 6);
  } else { from = view; to = shiftDay(view, 27); }
  return S.events.filter(e => e.date >= from && e.date <= to)
                 .sort((a,b) => a.date.localeCompare(b.date) || a.s - b.s);
}

function doICS(){
  const list = dayEvents(view);
  if (!list.length) return toast('Aucun bloc à exporter pour ce jour');
  dl(new Blob([buildICS(list)], { type:'text/calendar' }), `cadran-${view}.ics`);
  toast('Journée exportée (.ics)');
}

/* ————————————————— Envoi vers l'iPhone ————————————————— */
const dSend = $('#dlgSend');
function openSend(){
  $('#mTo').value      = S.settings.mailTo || '';
  $('#mSubject').value = S.settings.mailSubject || 'Cadran — mise à jour';
  $('#mRange').value   = S.settings.mailRange || 'week';
  dSend.showModal();
}
function mailState(){
  const to = $('#mTo').value.trim();
  const subject = $('#mSubject').value.trim() || 'Cadran — mise à jour';
  const range = $('#mRange').value;
  Object.assign(S.settings, { mailTo:to, mailSubject:subject, mailRange:range });
  save();
  const list = rangeEvents(range);
  return { to, subject, range, list, ics:list.length ? buildICS(list) : '' };
}
const mailName = range => `cadran-${range === 'day' ? view : range}-${todayISO()}.ics`;

$('#sendBtn').onclick = openSend;
$('#mClose').onclick  = () => dSend.close();

$('#mShare').onclick = async () => {
  const m = mailState();
  if (!m.list.length) return toast('Aucun bloc sur cette période');
  const file = new File([m.ics], mailName(m.range), { type:'text/calendar' });
  try{
    if (navigator.canShare && navigator.canShare({ files:[file] })){
      await navigator.share({ files:[file], title:m.subject });
      toast('Partagé');
    } else {
      dl(new Blob([m.ics], { type:'text/calendar' }), mailName(m.range));
      toast('Partage indisponible ici — fichier téléchargé');
    }
  }catch(err){ if (err.name !== 'AbortError') toast('Partage interrompu'); }
};

$('#mMail').onclick = async () => {
  const m = mailState();
  if (!m.list.length) return toast('Aucun bloc sur cette période');
  const body = encodeURIComponent(m.ics);
  // La plupart des clients mail tronquent silencieusement au-delà d'environ 1800-2000 caractères
  // d'URL totale ; au-delà, on bascule sur le presse-papiers pour ne rien perdre.
  const url = `mailto:${encodeURIComponent(m.to)}?subject=${encodeURIComponent(m.subject)}&body=${body}`;
  if (url.length > 1900){
    try{ await navigator.clipboard.writeText(m.ics); }catch(e){}
    toast(`Période trop longue pour tenir dans l'URL du brouillon (${m.list.length} blocs) — ` +
          `le .ics a été copié, collez-le dans le mail, ou réduisez la période`);
    return;
  }
  location.href = url;
};

$('#mDownload').onclick = () => {
  const m = mailState();
  if (!m.list.length) return toast('Aucun bloc sur cette période');
  dl(new Blob([m.ics], { type:'text/calendar' }), mailName(m.range));
  toast(`${m.list.length} blocs exportés`);
};

$('#mCopy').onclick = async () => {
  const m = mailState();
  if (!m.list.length) return toast('Aucun bloc sur cette période');
  try{ await navigator.clipboard.writeText(m.ics); toast('Contenu .ics copié'); }
  catch(e){ toast('Copie refusée par le navigateur'); }
};


function copyDay(){
  const list = dayEvents(view);
  if (!list.length) return toast('Journée vide');
  const target = prompt('Copier cette journée vers quelle date ? (AAAA-MM-JJ)', shiftDay(view, 1));
  if (!target || !/^\d{4}-\d{2}-\d{2}$/.test(target)) return;
  snapshot();
  list.forEach(e => S.events.push({ ...e, id:uid(), date:target }));
  view = target; after(`${list.length} blocs copiés`);
}
function clearDay(){
  const list = dayEvents(view);
  if (!list.length) return toast('Journée déjà vide');
  delEvents(list, 'journée vidée');
}
function dl(blob, name){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* Réglages */
const dS = $('#dlgSettings');
function openSettings(){
  $('#sStart').value = S.settings.dayStart; $('#sEnd').value = S.settings.dayEnd;
  $('#sSnap').value = S.settings.snap; $('#sDense').checked = S.settings.half;
  dS.showModal();
}
dS.addEventListener('close', () => {
  const a = clamp(+$('#sStart').value || 8, 0, 22);
  const b = clamp(+$('#sEnd').value || 20, a + 2, 24);
  Object.assign(S.settings,
    { dayStart:a, dayEnd:b, snap:+$('#sSnap').value, half:$('#sDense').checked });
  after('Affichage mis à jour');   // les blocs hors plage sont conservés, pas rognés
});

/* Aide */
const HELP = [
  ['Glisser sur la grille','Créer un bloc'],
  ['Double-clic','Créer un bloc d\'une heure'],
  ['Glisser un bloc','Déplacer · bords haut/bas pour la durée'],
  ['Suppr / Retour arr.','Supprimer le bloc sélectionné'],
  ['↑ ↓','Déplacer du pas d\'accrochage'],
  ['Maj + ↑ ↓','Allonger ou raccourcir'],
  ['← →','Jour précédent / suivant'],
  ['Entrée','Renommer le bloc'],
  ['N','Nouveau bloc au prochain créneau libre'],
  ['D','Marquer terminé'],
  ['1 – 8','Changer la couleur'],
  ['Ctrl + D','Dupliquer'],
  ['Ctrl + C / V','Copier / coller'],
  ['Ctrl + Z / Ctrl + Maj + Z','Annuler / rétablir'],
  ['T','Revenir à aujourd\'hui'],
  ['E','Envoyer vers l\'iPhone'],
  ['/ ou Ctrl + F','Rechercher'],
  ['Échap','Désélectionner']
];
function openHelp(){
  $('#helpList').innerHTML = HELP.map(([k,v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
  $('#dlgHelp').showModal();
}

/* ————————————————— Retours d'information ————————————————— */
let toastT;
function toast(msg, label, fn){
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>`;
  if (label){
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = () => { t.hidden = true; fn(); };
    t.appendChild(b);
  }
  t.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => t.hidden = true, label ? 6000 : 2600);
}
function status(s){ $('#status').textContent = s; }

const netDot = $('#net');
function net(){ netDot.classList.toggle('off', !navigator.onLine);
  netDot.title = navigator.onLine ? 'En ligne' : 'Hors ligne — les données restent sur cet appareil'; }
addEventListener('online', net); addEventListener('offline', net);

/* ————————————————— Démarrage ————————————————— */
buildSwatches();
buildRepeatDays();
net();

/* Tiroir mobile : poignée, voile, bouton d'ajout rapide (n'agissent que sur petit écran,
   inoffensifs sur PC puisque la feuille mobile seule leur donne une apparence) */
$('#sheetClose').addEventListener('click', () => { sel = null; render(); canvas.focus(); });
$('#sheetScrim').addEventListener('click', () => { sel = null; render(); });
$('#fab').addEventListener('click', () => {
  const s = firstFreeSlot(60);
  create(s, s + 60);
});

render();
setSyncDot(syncConfigured() ? '' : '', 'Sync');
if (syncConfigured() && navigator.onLine) autoSyncTick();
setInterval(() => { renderNow(); renderStats(); }, 30000);
addEventListener('resize', () => renderDay());

if ('serviceWorker' in navigator){
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
})();
