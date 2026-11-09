const TABLES = {
  years: {name:'years', keys:['year'], fields:['year','created_at']},
  plantings: {name:'plantings', keys:['year','plant_id'], fields:['year','plant_id','status','variety','location']},
  custom: {name:'custom_plants', keys:['id'], fields:['id','name','area','life']},
  notes: {name:'notes', keys:['id'], fields:['id','plant_id','year','tag','body','observed_on','created_at']},
  checks: {name:'checks', keys:['year','task_id'], fields:['year','task_id']}
};
export const MAX_CHANGES = 40;
export function json(data, status=200) {
  return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
function fail(message) { throw new Error(message); }
export function timestamp(value, name='timestamp', now=Date.now()) {
  if (typeof value !== 'string' || !value.trim() || !Number.isFinite(Date.parse(value))) fail(`${name} must be a parseable timestamp`);
  const date = new Date(value);
  if (+date > Number(now)+86400000) fail(`${name} cannot be more than one day in the future`);
  return date.toISOString();
}
export function validateRow(table, input, now=Date.now()) {
  if (!Object.prototype.hasOwnProperty.call(TABLES,table)) fail('Unknown table');
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(`${table}: row must be an object`);
  const r = {};
  const text = (key,min,max) => {
    const v=input[key];
    if (typeof v !== 'string' || v.length>max || v.trim().length<min) fail(`${table}.${key} must be ${min}–${max} characters`);
    r[key]=v; return v;
  };
  const choice = (key,values) => { if (!values.includes(input[key])) fail(`${table}.${key} must be one of ${values.join(', ')}`);r[key]=input[key]; };
  if (TABLES[table].fields.includes('year')) {
    if (!Number.isInteger(input.year) || input.year<2000 || input.year>2100) fail(`${table}.year must be 2000–2100`);
    r.year=input.year;
  }
  if (TABLES[table].fields.includes('plant_id')) text('plant_id',1,120);
  if (table==='checks') text('task_id',1,120);
  if (table==='plantings') {
    choice('status',['planned','started','growing','harvesting','done','skipped']);
    text('variety',0,300); text('location',0,300);
  }
  if (table==='custom') {
    if (!text('id',7,80).startsWith('custom-')) fail('custom.id must start with custom-');
    text('name',1,120); choice('area',['front','back','ornamental']);choice('life',['annual','overwinter','perennial']);
  }
  if (table==='notes') {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text('id',36,36))) fail('notes.id must be a UUID');
    choice('tag',['note','worked','problem','harvest','next']);text('body',1,10000);
    const date=text('observed_on',10,10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date+'T00:00:00Z')) || new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date) fail('notes.observed_on must be a valid YYYY-MM-DD date');
  }
  if (table==='years' || table==='notes') r.created_at=timestamp(input.created_at,`${table}.created_at`,now);
  r.updated_at=timestamp(input.updated_at,`${table}.updated_at`,now);
  if (input.deleted!==0 && input.deleted!==1) fail(`${table}.deleted must be 0 or 1`);
  r.deleted=input.deleted;
  return r;
}
// Identifiers come only from this fixed allowlist. Values always use bound parameters.
export function buildUpsert(table, row, owner, syncedAt) {
  if (!Object.prototype.hasOwnProperty.call(TABLES,table)) fail('Unknown table');
  const spec=TABLES[table];
  const columns=['owner',...spec.fields,'updated_at','deleted','synced_at'];
  const values={...row,owner,synced_at:syncedAt};
  const updates=columns.filter(c=>c!=='owner'&&!spec.keys.includes(c)).map(c=>`${c}=excluded.${c}`).join(', ');
  return {sql:`INSERT INTO ${spec.name} (${columns.join(', ')}) VALUES (${columns.map(()=>'?').join(', ')}) ON CONFLICT(owner, ${spec.keys.join(', ')}) DO UPDATE SET ${updates} WHERE excluded.updated_at > ${spec.name}.updated_at`,values:columns.map(c=>values[c])};
}
async function readBody(request) {
  const limit=1024*1024;
  if (Number(request.headers.get('Content-Length'))>limit) fail('Body must be at most 1 MB');
  if (!request.body) fail('JSON body required');
  const reader=request.body.getReader(),chunks=[];let size=0;
  for (;;) {
    const {done,value}=await reader.read();if(done)break;
    size+=value.byteLength;
    if(size>limit){await reader.cancel();fail('Body must be at most 1 MB');}
    chunks.push(value);
  }
  const data=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.byteLength;}
  try{return JSON.parse(new TextDecoder().decode(data));}catch{fail('Body must be valid JSON');}
}
// `email` is who signed in; `owner` scopes the rows (a shared household garden can pass one owner for everyone).
export async function handleApi(request, env, email, owner = email) {
  const url=new URL(request.url),origin=request.headers.get('Origin');
  if(origin!==null && origin!==url.origin)return json({error:'Cross-origin requests are not allowed'},403);
  if(!['/api/me','/api/sync'].includes(url.pathname))return json({error:'Not found'},404);
  const allowed=url.pathname==='/api/me'?['GET']:['GET','POST'];
  if(!allowed.includes(request.method)) {
    const response=json({error:'Method not allowed'},405);response.headers.set('Allow',allowed.join(', '));return response;
  }
  if(url.pathname==='/api/me')return json({email});
  const now=Date.now(), serverTime=new Date(now).toISOString();let since,changes=[];
  try {
    if(request.method==='POST') {
      const body=await readBody(request);
      if(!body || typeof body!=='object' || Array.isArray(body) || !Array.isArray(body.changes))fail('changes must be an array');
      // D1's free plan allows 50 queries per request, and each sync also runs 5 SELECTs.
      if(body.changes.length>MAX_CHANGES)fail(`At most ${MAX_CHANGES} changes are allowed`);
      if(body.since!==undefined)since=timestamp(body.since,'since',now);
      changes=body.changes.map(change=>{
        if(!change || typeof change!=='object')fail('Each change must contain table and row');
        return {table:change.table,row:validateRow(change.table,change.row,now)};
      });
    } else if(url.searchParams.has('since'))since=timestamp(url.searchParams.get('since'),'since',now);
  }catch(error){return json({error:error.message},400);}
  try {
    if(changes.length)await env.DB.batch(changes.map(({table,row})=>{
      const query=buildUpsert(table,row,owner,serverTime);return env.DB.prepare(query.sql).bind(...query.values);
    }));
    const names=Object.keys(TABLES);
    const queries=names.map(table=>{
      const spec=TABLES[table];
      const sql=`SELECT ${[...spec.fields,'updated_at','deleted','synced_at'].join(', ')} FROM ${spec.name} WHERE owner = ?${since?' AND synced_at >= ?':''}`;
      return env.DB.prepare(sql).bind(...(since?[owner,since]:[owner]));
    });
    const results=await env.DB.batch(queries);
    return json({serverTime,rows:Object.fromEntries(names.map((table,i)=>[table,results[i].results||[]]))});
  }catch {return json({error:'Database sync failed. Please try again.'},500);}
}
