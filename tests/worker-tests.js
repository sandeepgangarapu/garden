import {handleApi,validateRow,buildUpsert} from '../worker/api.js';
import {verifyAccessJwt} from '../worker/access.js';
import production from '../worker/index.js';
const keyPair=crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
export async function workerTests(test,ok,equal) {
  const stamp=new Date().toISOString(),base={updated_at:stamp,deleted:0};
  const valid={
    years:{...base,year:2026,created_at:stamp},
    plantings:{...base,year:2026,plant_id:'tomato',status:'growing',variety:'Cherry',location:'Bed 1'},
    custom:{...base,id:'custom-rose',name:'Rose',area:'ornamental',life:'perennial'},
    notes:{...base,id:crypto.randomUUID(),plant_id:'tomato',year:2026,tag:'note',body:'First flowers',observed_on:'2026-06-01',created_at:stamp},
    checks:{...base,year:2026,task_id:'tomato-prune'}
  };
  const rejects=async(fn,fragment)=>{let message='';try{await fn();}catch(e){message=e.message;}ok(message&&(!fragment||message.includes(fragment)));};
  for(const table of Object.keys(valid)) {
    await test(`Worker accepts valid ${table} and normalizes ISO timestamps`,()=>{
      const row=validateRow(table,{...valid[table],updated_at:'2026-01-01T01:00:00+01:00',owner:'forged'});
      equal(row.updated_at,'2026-01-01T00:00:00.000Z');ok(!('owner'in row));
    });
    await test(`Worker rejects bad ${table} rows and timestamps`,async()=>{
      await rejects(()=>validateRow(table,{...valid[table],updated_at:'invalid'}),'timestamp');
      await rejects(()=>validateRow(table,{...valid[table],updated_at:new Date(Date.now()+172800000).toISOString()}),'future');
      await rejects(()=>validateRow(table,{...valid[table],deleted:true}),'deleted');
    });
  }
  const bad={years:[{year:1999},{year:2101},{year:'2026'},{created_at:'bad'}],plantings:[{plant_id:''},{plant_id:'x'.repeat(121)},{status:'dead'},{variety:'x'.repeat(301)},{location:'x'.repeat(301)}],custom:[{id:'rose'},{id:'custom-'+'a'.repeat(80)},{name:''},{name:'x'.repeat(121)},{area:'vegetables'},{life:'forever'}],notes:[{id:'not-uuid'},{tag:'hello'},{body:''},{body:'x'.repeat(10001)},{observed_on:'2026-02-30'},{observed_on:'06/01/2026'},{created_at:'bad'}],checks:[{task_id:''},{task_id:'x'.repeat(121)},{year:2101}]};
  for(const table of Object.keys(bad))await test(`Worker validates each ${table} field`,async()=>{
    for(const patch of bad[table])await rejects(()=>validateRow(table,{...valid[table],...patch}));
  });
  await test('LWW SQL uses owner-scoped keys, bound values and strict newer comparison for all tables',()=>{
    for(const table of Object.keys(valid)) {
      const q=buildUpsert(table,validateRow(table,valid[table]),'owner@example.test',stamp),name=table==='custom'?'custom_plants':table;
      ok(q.sql.includes(`INSERT INTO ${name} `));ok(q.sql.includes('ON CONFLICT(owner, '));
      ok(q.sql.endsWith(`WHERE excluded.updated_at > ${name}.updated_at`));ok(q.sql.includes('synced_at=excluded.synced_at'));
      equal(q.values[0],'owner@example.test');equal(q.values.at(-1),stamp);equal((q.sql.match(/\?/g)||[]).length,q.values.length);
      ok(!q.sql.includes('owner@example.test'));
    }
  });
  const calls=[];
  const DB={prepare(sql){return {bind(...values){return {sql,values};}};},async batch(queries){calls.push(queries);return queries.map(q=>({results:q.sql.startsWith('SELECT')?[{updated_at:stamp,deleted:1}]:[]}));}};
  const request=(path='/api/sync',init={})=>{const req=new Request('https://garden.example'+path,init);if(init.headers)Object.defineProperty(req,'headers',{value:new Headers(init.headers)});return req;};
  const post=body=>request('/api/sync',{method:'POST',body:JSON.stringify(body)});
  await test('Origin, method and path checks occur before database work',async()=>{
    equal((await handleApi(request('/api/me',{headers:{Origin:'https://evil.example'}}),{},'owner')).status,403);
    equal((await handleApi(request('/api/me',{headers:{Origin:''}}),{},'owner')).status,403);
    equal((await handleApi(request('/api/me',{method:'POST'}),{},'owner')).status,405);
    equal((await handleApi(request('/api/unknown'),{},'owner')).status,404);
    const me=await handleApi(request('/api/me',{headers:{Origin:'https://garden.example'}}),{},'owner@example.test');
    equal(await me.json(),{email:'owner@example.test'});equal(me.headers.get('Cache-Control'),'no-store');equal(me.headers.get('X-Content-Type-Options'),'nosniff');
  });
  await test('POST validates everything before applying a batch, then returns only owner rows including tombstones',async()=>{
    const response=await handleApi(post({since:'2026-01-01',changes:Object.keys(valid).map(table=>({table,row:valid[table]}))}),{DB},'owner@example.test');
    equal(response.status,200);equal(calls.length,2);equal(calls[0].length,5);equal(calls[1].length,5);
    ok(calls[1].every(q=>q.sql.includes('WHERE owner = ? AND synced_at >= ?')&&q.values[0]==='owner@example.test'&&q.values[1]==='2026-01-01T00:00:00.000Z'&&!q.sql.includes('SELECT owner')));
    const result=await response.json();equal(Object.keys(result.rows),Object.keys(valid));equal(result.rows.notes[0].deleted,1);
    const before=calls.length;
    const invalid=await handleApi(post({changes:[{table:'years',row:valid.years},{table:'checks',row:{...valid.checks,task_id:''}}]}),{DB},'owner');
    equal(invalid.status,400);ok((await invalid.json()).error.includes('task_id'));equal(calls.length,before);
  });
  await test('GET incremental pull and body limits reject malformed inputs clearly',async()=>{
    const before=calls.length;
    equal((await handleApi(request('/api/sync?since=invalid'),{DB},'owner')).status,400);
    equal((await handleApi(post({changes:Array(41).fill({table:'years',row:valid.years})}),{DB},'owner')).status,400);
    equal((await handleApi(post({changes:[],padding:'x'.repeat(1024*1024)}),{DB},'owner')).status,400);
    equal((await handleApi(post({changes:[{table:'__proto__',row:{}}]}),{DB},'owner')).status,400);
    equal(calls.length,before);
    const response=await handleApi(request('/api/sync'),{DB},'second-owner');equal(response.status,200);ok(calls.at(-1).every(q=>q.values.length===1&&q.values[0]==='second-owner'));
  });
  await test('a shared owner scopes rows while /api/me still reports who signed in',async()=>{
    const me=await handleApi(request('/api/me'),{DB},'partner@example.test','household');
    equal(await me.json(),{email:'partner@example.test'});
    const response=await handleApi(post({changes:[{table:'checks',row:valid.checks}]}),{DB},'partner@example.test','household');
    equal(response.status,200);
    ok(calls.at(-2)[0].values[0]==='household'&&calls.at(-1).every(q=>q.values[0]==='household'));
  });
  const pair=await keyPair;
  const jwk={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'local-key',alg:'RS256'};
  const encode=bytes=>btoa(String.fromCharCode(...bytes)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  const encoded=data=>encode(new TextEncoder().encode(JSON.stringify(data)));
  const teamDomain='https://jwt-test.example',now=Date.now(),seconds=Math.floor(now/1000);
  const claims={iss:teamDomain,aud:['garden-aud'],exp:seconds+300,nbf:seconds-20,email:'OWNER@Example.Test'};
  async function token(patch={},header={}) {
    const data=encoded({alg:'RS256',kid:jwk.kid,...header})+'.'+encoded({...claims,...patch});
    const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(data));
    return data+'.'+encode(new Uint8Array(signature));
  }
  let fetches=0;
  const options={teamDomain,aud:'garden-aud',now,fetchImpl:async url=>{fetches++;equal(url,teamDomain+'/cdn-cgi/access/certs');return new Response(JSON.stringify({keys:[jwk]}),{headers:{'Content-Type':'application/json'}});}};
  await test('JWT valid RSA signature returns lowercase email; JWKS is cached',async()=>{
    equal(await verifyAccessJwt(await token(),options),'owner@example.test');equal(await verifyAccessJwt(await token({aud:'garden-aud'}),options),'owner@example.test');equal(fetches,1);
  });
  for(const [name,patch] of [['wrong aud',{aud:'wrong'}],['wrong iss',{iss:'https://wrong.example'}],['expired',{exp:seconds-61}],['missing email',{email:undefined}],['future nbf',{nbf:seconds+61}]])await test(`JWT rejects ${name}`,async()=>rejects(async()=>verifyAccessJwt(await token(patch),options)));
  await test('JWT unknown kid refetches once and rejects; forged signature is rejected',async()=>{
    const before=fetches;await rejects(async()=>verifyAccessJwt(await token({}, {kid:'unknown'}),options),'Unknown');equal(fetches,before+1);
    const signed=await token(),parts=signed.split('.');parts[1]=encoded({...claims,email:'attacker@example.test'});
    await rejects(()=>verifyAccessJwt(parts.join('.'),options),'signature');
    await rejects(async()=>verifyAccessJwt(await token({}, {alg:'HS256'}),options),'algorithm');
  });
  await test('JWT permits 60-second clock leeway and refreshes expired JWKS',async()=>{
    equal(await verifyAccessJwt(await token({exp:seconds-50,nbf:seconds+50}),options),'owner@example.test');
    const before=fetches;equal(await verifyAccessJwt(await token({exp:seconds+7200}),{...options,now:now+3600001}),'owner@example.test');equal(fetches,before+1);
  });
  await test('production verifies header and cookie tokens and enforces the email allowlist',async()=>{
    const jwt=await token(),env={ACCESS_TEAM_DOMAIN:teamDomain,ACCESS_AUD:'garden-aud',ALLOWED_EMAILS:' OWNER@EXAMPLE.TEST, other@example.test '};
    const header=await production.fetch(request('/api/me',{headers:{'Cf-Access-Jwt-Assertion':jwt}}),env);equal(header.status,200);equal(await header.json(),{email:'owner@example.test'});
    const cookie=await production.fetch(request('/api/me',{headers:{Cookie:`other=value; CF_Authorization=${jwt}; extra=1`}}),env);equal(cookie.status,200);
    equal((await production.fetch(request('/api/me',{headers:{'Cf-Access-Jwt-Assertion':jwt}}),{...env,ALLOWED_EMAILS:'other@example.test'})).status,401);
  });
  await test('production rejects a test identity header and missing Access token',async()=>{
    const response=await production.fetch(request('/api/me',{headers:{'X-Test-Email':'owner@example.test'}}),{ACCESS_TEAM_DOMAIN:teamDomain,ACCESS_AUD:'garden-aud'});equal(response.status,401);
  });
}
