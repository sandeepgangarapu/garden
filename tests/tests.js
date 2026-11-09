import {clientTests} from './client-tests.js';
import {workerTests} from './worker-tests.js';
import {serviceWorkerTests} from './sw-tests.js';
import {taskVisible,taskLead,activePlants,carryOver,defaultStatus,mergeRows,createCalendarEvent,foldICal,escapeICal} from '../logic.js';
// Headless Chrome's virtual clock can exhaust its budget while WebCrypto is
// still working on a real thread. Local network I/O holds virtual time until
// these asynchronous tests settle; this never contacts an external service.
const heartbeat=new AbortController();
void (async()=>{while(!heartbeat.signal.aborted){try{await fetch('./index.html?test-heartbeat',{cache:'no-store',signal:heartbeat.signal});}catch{break;}}})();
const output=[];let passed=0,failed=0;
async function test(name,fn){try{await fn();passed++;output.push('PASS '+name);}catch(e){failed++;output.push('FAIL '+name+': '+e.message);}document.querySelector('#results').textContent=output.join('\n');document.querySelector('#summary').textContent=`Running… ${passed} passed, ${failed} failed`;}
function ok(value){if(!value)throw new Error('assertion failed');}
function equal(actual,expected){if(JSON.stringify(actual)!==JSON.stringify(expected))throw new Error(JSON.stringify(actual)+' ≠ '+JSON.stringify(expected));}
const ps=[{id:'tomato',name:'Tomato',area:'front',kind:'vegetable',life:'annual'},{id:'garlic',name:'Garlic',area:'front',kind:'vegetable',life:'overwinter'},{id:'hosta',name:'Hosta',area:'ornamental',kind:'ornamental',life:'perennial'},{id:'rose',name:'Rose',area:'ornamental',kind:'ornamental',life:'perennial'}];
const planting=[{year:2026,plant_id:'tomato',status:'done'},{year:2026,plant_id:'garlic',status:'growing'},{year:2026,plant_id:'hosta',status:'skipped'},{year:2026,plant_id:'rose',status:'growing'}];
await test('small garden shows only matching tasks',()=>{ok(taskVisible({plants:['tomato']},[ps[0]]));ok(!taskVisible({plants:['garlic']},[ps[0]]));});
await test('multi-plant lead rewrites to grown names',()=>equal(taskLead({plants:['tomato','garlic'],lead:'Tomato, garlic'},[ps[0]]),'Tomato'));
await test('full multi-plant lead stays intact',()=>equal(taskLead({plants:['tomato','garlic'],lead:'Heat-lovers'},ps),'Heat-lovers'));
await test('area keys match front, vegetables, and ornamentals',()=>{ok(taskVisible({plants:['area:front']},[ps[0]]));ok(taskVisible({plants:['area:vegetables']},[ps[0]]));ok(taskVisible({plants:['area:ornamental']},[ps[2]]));ok(!taskVisible({plants:['area:back']},[ps[0]]));ok(!taskVisible({plants:['area:vegetables']},[ps[2]]));});
await test('skipped plants and removed rows are excluded',()=>{const g=activePlants(ps,[...planting,{year:2026,plant_id:'x',_deleted:true}],2026);equal(g.map(p=>p.id),['tomato','garlic','rose']);ok(!taskVisible({plants:['hosta']},g));});
await test('carry-over keeps overwinter and perennial, excludes skipped and annual',()=>equal(carryOver(ps,planting,2026),['garlic','rose']));
await test('default status: past annual is done',()=>equal(defaultStatus('annual',2025,new Date(2026,5,1)),'done'));
await test('default status: annual grows through October',()=>equal(defaultStatus('annual',2026,new Date(2026,9,31)),'growing'));
await test('default status: annual done in November',()=>equal(defaultStatus('annual',2026,new Date(2026,10,1)),'done'));
await test('default status: future annual planned; carry-over growing',()=>{equal(defaultStatus('annual',2027,new Date(2026,5,1)),'planned');equal(defaultStatus('perennial',2027,new Date(2026,5,1)),'growing');equal(defaultStatus('overwinter',2025,new Date(2026,5,1)),'growing');});
const older={id:'a',body:'old',updated_at:'2026-01-01T00:00:00Z',deleted:false},newer={...older,body:'new',updated_at:'2026-01-02T00:00:00Z'};
await test('note merge unions ids and newer wins',()=>{equal(mergeRows([older],[newer,{...older,id:'b'}]).length,2);equal(mergeRows([newer],[older])[0].body,'new');});
await test('newer note soft delete survives stale copy',()=>{const deleted={...newer,deleted:true};ok(mergeRows([older],[deleted])[0].deleted);ok(mergeRows([deleted],[older])[0].deleted);});
const event={id:'apr-tomato',title:'Tomato, basil; sow\\pot\nWater',category:'Start indoors'};
await test('all-day ICS has exclusive next-day end and escaped text',()=>{const s=createCalendarEvent(event,'2026-12-31');ok(s.includes('DTSTART;VALUE=DATE:20261231\r\n'));ok(s.includes('DTEND;VALUE=DATE:20270101\r\n'));ok(s.includes('SUMMARY:Tomato\\, basil\\; sow\\\\pot\\nWater'));ok(s.endsWith('END:VCALENDAR\r\n'));});
await test('timed ICS uses floating local time and 30-minute duration',()=>{const s=createCalendarEvent(event,'2026-06-05','23:45');ok(s.includes('DTSTART:20260605T234500'));ok(s.includes('DTEND:20260606T001500'));ok(!s.includes('DTSTART:20260605T234500Z'));});
await test('ICS rejects invalid calendar date/time',()=>{for(const [d,t] of [['2026-02-30',''],['2026-06-01','25:00']]){let threw=false;try{createCalendarEvent(event,d,t);}catch{threw=true;}ok(threw);}});
await test('ICS folds Unicode within 75 UTF-8 octets',()=>{const lines=foldICal('SUMMARY:'+('🌱 garden '.repeat(40))).split('\r\n');ok(lines.length>1);ok(lines.every(l=>new TextEncoder().encode(l).length<=75));equal(escapeICal('a,b;c\nd'),'a\\,b\\;c\\nd');});
try{
  const lib=await (await fetch('../data/plants.json')).json();
  await test('library has 45 plants, 266 jobs, unique ids, and valid references',()=>{equal(lib.plants.length,45);equal(lib.tasks.length,266);equal(new Set(lib.tasks.map(t=>t.id)).size,266);ok(lib.tasks.every(t=>t.plants.length&&t.plants.every(id=>id.startsWith('area:')||lib.plants.some(p=>p.id===id))));});
}catch(e){failed++;output.push('FAIL library fetch: '+e.message);}
try { await clientTests(test,ok,equal); await workerTests(test,ok,equal); await serviceWorkerTests(test,ok,equal); } catch(error) { failed++;output.push('FAIL sync harness: '+error.message); }
document.querySelector('#results').textContent=output.join('\n');
const summary=document.querySelector('#summary');summary.textContent=`${failed?'FAIL':'PASS'}: ${passed} passed, ${failed} failed`;summary.className=failed?'fail':'pass';

heartbeat.abort();
