import {createStore,safeStorage} from '../store.js';
import {EPOCH,TABLES,mergeSyncRows} from '../logic.js';
const empty=()=>Object.fromEntries(TABLES.map(t=>[t,[]]));
const json=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
const storage=()=>{const memory=new Map();return {get:k=>memory.get(k),set:(k,v)=>{memory.set(k,v);return true;}};};
export async function clientTests(test,ok,equal) {
  const library=[{id:'tomato',life:'annual'},{id:'garlic',life:'overwinter'},{id:'rose',life:'perennial'}];
  const stores=[];
  const make=(fetchImpl=async()=>new Response('',{status:404}),extra={})=>{
    const s=createStore(library,null,{storage:storage(),autoSync:false,fetchImpl,...extra});stores.push(s);return s;
  };
  try {
    await test('first-run seed is epoch, not dirty, with only carry-over crops in 2027',()=>{
      const s=make();equal(s.dirtyCount,0);ok(s.state.years.every(r=>r.updated_at===EPOCH));ok(s.state.plantings.every(r=>r.updated_at===EPOCH));
      equal(s.state.plantings.filter(r=>r.year===2027).map(r=>r.plant_id),['garlic','rose']);
    });
    await test('v1 migration keeps real edits and physical-delete tombstones without dirtying defaults',()=>{
      const disk=storage(),seed='2026-06-01T00:00:00Z',edit='2026-06-02T01:00:00+01:00';
      disk.set('gangarapu-garden-v1',JSON.stringify({years:[{year:2026,created_at:seed}],plantings:[{year:2026,plant_id:'tomato',status:'growing',variety:'',location:'',updated_at:seed},{year:2026,plant_id:'rose',status:'harvesting',variety:'',location:'',updated_at:edit}],custom:[],notes:[],checks:[{year:2026,task_id:'gone',_deleted:true,updated_at:edit}],outbox:[]}));
      const s=make(undefined,{storage:disk});equal(s.dirtyCount,2);equal(s.state.plantings[0].updated_at,EPOCH);equal(s.state.plantings[1].updated_at,'2026-06-02T00:00:00.000Z');equal(s.state.checks[0].deleted,1);
    });
    await test('remote newer wins, local dirty newer survives, soft deletes persist across reload',async()=>{
      let remote=empty();const disk=storage();
      const s=make(async path=>path==='/api/me'?json({email:'owner@test.example'}):json({serverTime:new Date().toISOString(),rows:remote}),{storage:disk});
      const n=s.put('notes',{id:crypto.randomUUID(),plant_id:'tomato',year:2026,tag:'note',body:'local',observed_on:'2026-06-01',created_at:new Date().toISOString()});
      remote.notes=[{...n,body:'remote newer',updated_at:new Date(Date.parse(n.updated_at)+1000).toISOString(),deleted:1}];
      await s.sync();equal(s.state.notes[0].body,'remote newer');equal(s.state.notes[0].deleted,1);equal(s.dirtyCount,0);
      const local=s.put('notes',{...s.state.notes[0],body:'new local',deleted:0});
      const stored=make(undefined,{storage:disk});equal(stored.dirtyCount,1);equal(stored.state.notes[0].body,'new local');
      equal(mergeSyncRows([local],remote.notes,'notes')[0].body,'new local');
      equal(s.dirtyCount,1);
    });
    await test('an edit during sync remains dirty and runs again with its latest value',async()=>{
      let release,entered,posts=0;const gate=new Promise(resolve=>entered=resolve),bodies=[];
      const s=make(async(path,init)=>{
        if(path==='/api/me')return json({email:'owner@test.example'});
        posts++;bodies.push(JSON.parse(init.body));
        if(posts===1){entered();return new Promise(resolve=>release=resolve);}
        equal(s.dirtyCount,1);equal(bodies[1].changes[0].row.body,'second');
        return json({serverTime:new Date().toISOString(),rows:empty()});
      });
      const first=s.put('notes',{id:crypto.randomUUID(),plant_id:'tomato',year:2026,tag:'note',body:'first',observed_on:'2026-06-01',created_at:new Date().toISOString()});
      const flight=s.sync();await gate;s.put('notes',{...first,body:'second'});
      release(json({serverTime:new Date().toISOString(),rows:empty()}));await flight;
      equal(posts,2);equal(s.dirtyCount,0);equal(s.status,'ready');
    });
    await test('all deletes are rows with new timestamps, including unchecked jobs',()=>{
      const s=make(),first=s.put('checks',{year:2026,task_id:'a'}),removed=s.put('checks',first,'delete');
      equal(s.state.checks.length,1);equal(removed.deleted,1);ok(Date.parse(removed.updated_at)>Date.parse(first.updated_at));
      const restored=s.put('checks',{year:2026,task_id:'a'});equal(restored.deleted,0);
    });
    await test('404 is local; expired Access responses preserve dirty data',async()=>{
      for(const response of [new Response('',{status:401}),new Response('',{status:403}),new Response('<html>Login</html>',{headers:{'Content-Type':'text/html'}}),{type:'opaqueredirect',status:0}]) {
        const s=make(async()=>response);s.put('checks',{year:2026,task_id:'one'});await s.sync();equal(s.status,'signin');equal(s.dirtyCount,1);
      }
      const local=make();await local.sync();equal(local.status,'local');
    });
    await test('offline and blocked storage keep edits usable in memory',async()=>{
      const descriptor=Object.getOwnPropertyDescriptor(window,'localStorage');
      try {
        Object.defineProperty(window,'localStorage',{configurable:true,get(){throw new Error('Blocked');}});
        equal(safeStorage.get('x'),null);equal(safeStorage.set('x','y'),false);safeStorage.remove('x');
        const s=make(undefined,{storage:safeStorage,online:()=>false});s.put('checks',{year:2026,task_id:'offline'});await s.sync();
        equal(s.status,'offline');equal(s.storageOK,false);equal(s.dirtyCount,1);
      }finally{Object.defineProperty(window,'localStorage',descriptor);}
    });
    await test('sync batches at 40 and uses same-origin credentials with manual redirects',async()=>{
      const batches=[],s=make(async(path,init)=>{
        equal(init.credentials,'same-origin');equal(init.redirect,'manual');
        if(path==='/api/me')return json({email:'test@example.test'});
        const body=JSON.parse(init.body);batches.push(body.changes.length);
        return json({serverTime:new Date().toISOString(),rows:empty()});
      });
      for(let i=0;i<81;i++)s.put('checks',{year:2026,task_id:`job-${i}`});
      await s.sync();equal(batches,[40,40,1]);equal(s.dirtyCount,0);
    });
  }finally{stores.forEach(s=>s.dispose());}
}
