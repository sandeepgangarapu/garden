import {rowKey,rowTime,mergeSyncRows,acknowledgeRows,seedRows,TABLES,EPOCH} from './logic.js';
const KEY='gangarapu-garden-v2', LEGACY_KEY='gangarapu-garden-v1';
// Matches the Worker's MAX_CHANGES (Cloudflare D1 free plan query limit).
export const SYNC_BATCH=40;
export const safeStorage={
  get(key){try{return localStorage.getItem(key);}catch{return null;}},
  set(key,value){try{localStorage.setItem(key,value);return true;}catch{return false;}},
  remove(key){try{localStorage.removeItem(key);}catch{}}
};
const parse=value=>{try{return JSON.parse(value);}catch{return null;}};
const normalTime=value=>Number.isFinite(Date.parse(value))?new Date(value).toISOString():EPOCH;
function migrate(old,library) {
  if(!old || !TABLES.every(t=>Array.isArray(old[t])))return null;
  const state={...seedRows(library),dirty:Object.fromEntries(TABLES.map(t=>[t,[]]))};
  for(const table of TABLES) {
    state[table]=old[table].map(input=>{
      const row={...input};delete row.owner;delete row._deleted;
      row.deleted=Number(Boolean(input.deleted||input._deleted));
      const queued=old.outbox?.some(o=>o.table===table&&rowKey(table,o.row)===rowKey(table,row));
      const seedStamp=old.years.find(y=>y.year===row.year)?.created_at;
      const real=queued || input._deleted || ['notes','custom','checks'].includes(table) || (table==='years' && ![2026,2027].includes(row.year)) || (table==='plantings' && (row.variety||row.location||row.updated_at!==seedStamp));
      row.updated_at=real?normalTime(input.updated_at||input.checked_at||input.created_at):EPOCH;
      if(table==='years'||table==='notes')row.created_at=normalTime(row.created_at);
      delete row.checked_at;
      if(real)state.dirty[table].push(rowKey(table,row));
      return row;
    });
  }
  return state;
}
export function createStore(library,onChange,options={}) {
  const storage=options.storage||safeStorage, fetchImpl=options.fetchImpl||globalThis.fetch.bind(globalThis);
  const online=options.online||(()=>globalThis.navigator?.onLine!==false);
  let state=parse(storage.get(KEY));
  if(!state || !TABLES.every(t=>Array.isArray(state[t])))state=migrate(parse(storage.get(LEGACY_KEY)),library)||{...seedRows(library),dirty:{}};
  const dirty=Object.fromEntries(TABLES.map(t=>[t,new Set(state.dirty?.[t]||[])]));
  let busy=null,again=false,timer,disposed=false,status='local',storageOK=true;
  let user=state.email?{email:state.email}:null;
  const emit=()=>onChange?.();
  const save=()=>{
    state.dirty=Object.fromEntries(TABLES.map(t=>[t,[...dirty[t]]]));
    try{storageOK=storage.set(KEY,JSON.stringify(state))!==false;}catch{storageOK=false;}
  };
  const dirtyRows=()=>TABLES.flatMap(table=>state[table].filter(row=>dirty[table].has(rowKey(table,row))).map(row=>({table,row:{...row}})));
  function schedule() {clearTimeout(timer);if(options.autoSync!==false&&!disposed)timer=setTimeout(()=>void sync(),1000);}
  function put(table,input,action='upsert') {
    if(!TABLES.includes(table))throw new Error('Unknown table');
    const key=rowKey(table,input),old=state[table].find(r=>rowKey(table,r)===key);
    const stamp=new Date(Math.max(Date.now(),rowTime(old)+1)).toISOString();
    const row={...old,...input,updated_at:stamp,deleted:action==='delete'?1:Number(Boolean(input.deleted))};
    delete row.synced_at;delete row._deleted;delete row.owner;
    if(table==='years'||table==='notes')row.created_at=normalTime(row.created_at||stamp);
    state[table]=state[table].filter(r=>rowKey(table,r)!==key);state[table].push(row);
    dirty[table].add(key);if(busy)again=true;
    save();emit();schedule();return row;
  }
  async function request(path,init={}) {
    const response=await fetchImpl(path,{...init,credentials:'same-origin',redirect:'manual'});
    if(response.status===404){status='local';return null;}
    if(response.type==='opaqueredirect'||[401,403].includes(response.status)||!response.headers.get('Content-Type')?.includes('application/json')){status='signin';return null;}
    if(!response.ok)throw new Error('Sync request failed');
    return response.json();
  }
  async function run() {
    if(!online()){status='offline';emit();return;}
    status='syncing';emit();
    try {
      const me=await request('/api/me');
      if(!me)return;
      if(typeof me.email!=='string'||!me.email.trim())throw new Error('Invalid account response');
      state.email=me.email;user={email:me.email};save();
      do {
        again=false;
        const pending=dirtyRows(),sent=[];let bytes=100;
        // Also respect the 1 MB body limit when notes are large.
        for(const change of pending) {
          const size=new TextEncoder().encode(JSON.stringify(change)).length+1;
          if(sent.length>=SYNC_BATCH||bytes+size>950000)break;
          sent.push(change);bytes+=size;
        }
        if(pending.length && !sent.length)throw new Error('A change is too large to sync');
        const body={changes:sent};if(state.cursor)body.since=state.cursor;
        const data=await request('/api/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
        if(!data)return;
        if(!Number.isFinite(Date.parse(data.serverTime))||!TABLES.every(t=>Array.isArray(data.rows?.[t])))throw new Error('Invalid sync response');
        acknowledgeRows(state,dirty,sent);
        for(const table of TABLES) {
          const remote=data.rows[table].map(input=>{
            const row={...input,updated_at:normalTime(input.updated_at),deleted:Number(Boolean(input.deleted))};delete row.owner;return row;
          });
          // Only an actually newer remote write retires a newer in-flight local edit.
          for(const row of remote) {
            const key=rowKey(table,row),local=state[table].find(r=>rowKey(table,r)===key);
            if(local && rowTime(row)>rowTime(local))dirty[table].delete(key);
          }
          state[table]=mergeSyncRows(state[table],remote,table);
        }
        state.cursor=normalTime(data.serverTime);state.lastSync=new Date().toISOString();save();
        if(dirtyRows().length)again=true;
      }while(again&&online()&&!disposed);
      if(!online()){status='offline';return;}
      status='ready';save();
    }catch{status=online()?'error':'offline';}
    finally{emit();}
  }
  function sync() {
    clearTimeout(timer);
    if(disposed)return Promise.resolve();
    if(busy){again=true;return busy;}
    busy=run().finally(()=>{busy=null;});return busy;
  }
  const visible=()=>{if(document.visibilityState==='visible')void sync();};
  const connection=()=>{if(online())void sync();else{status='offline';emit();}};
  if(options.autoSync!==false) {
    globalThis.addEventListener?.('online',connection);globalThis.addEventListener?.('offline',connection);
    globalThis.document?.addEventListener('visibilitychange',visible);
    queueMicrotask(()=>{if(!disposed)void sync();});
  }
  save();
  return {
    get state(){return state;},get user(){return user;},get status(){return online()?status:'offline';},
    get lastSync(){return state.lastSync?new Date(state.lastSync).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):'';},
    get storageOK(){return storageOK;},get dirtyCount(){return TABLES.reduce((n,t)=>n+dirty[t].size,0);},
    put,sync,
    dispose(){disposed=true;clearTimeout(timer);globalThis.removeEventListener?.('online',connection);globalThis.removeEventListener?.('offline',connection);globalThis.document?.removeEventListener('visibilitychange',visible);}
  };
}
