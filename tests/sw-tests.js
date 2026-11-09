// Run the actual service-worker entry against browser-native requests and a fake
// network/cache boundary. No registration, account or live backend is touched.
export async function serviceWorkerTests(test,ok,equal) {
  const source=await (await fetch('../sw.js')).text();
  function harness(network) {
    const listeners={},saved=new Map(),timers=[];let skipped=false,claimed=false;
    const cache={async put(key,value){saved.set(typeof key==='string'?key:key.url,value);},async match(key){return saved.get(key);}};
    const self={location:{origin:'https://garden.example'},registration:{scope:'https://garden.example/'},addEventListener(type,fn){listeners[type]=fn;},async skipWaiting(){skipped=true;},clients:{async claim(){claimed=true;}}};
    const caches={async open(){return cache;},async keys(){return ['gangarapu-garden-old'];},async delete(key){saved.set('deleted-cache',key);}};
    new Function('self','caches','fetch','setTimeout','clearTimeout',source)(self,caches,network,fn=>{timers.push(fn);return timers.length;},()=>{});
    function dispatch(path,method='GET') {
      const pending=[];let response;
      listeners.fetch({request:new Request('https://garden.example'+path,{method}),respondWith(value){response=value;},waitUntil(value){pending.push(value);}});
      return {get response(){return response;},pending};
    }
    return {listeners,saved,timers,dispatch,get skipped(){return skipped;},get claimed(){return claimed;}};
  }
  const response=(type='basic',ok=true)=>({type,ok,clone(){return this;}});
  await test('service worker leaves API, Access, external and non-shell requests alone',()=>{
    const h=harness(async()=>{throw new Error('Unexpected fetch');});
    for(const path of ['/api/me','/cdn-cgi/access/logout','/classic/','/unknown'])equal(h.dispatch(path).response,undefined);
    equal(h.dispatch('/app.js','POST').response,undefined);
  });
  await test('service worker returns Access redirects unchanged and caches only ok basic responses',async()=>{
    for(const [type,okValue] of [['opaqueredirect',false],['basic',false],['cors',true],['basic',true]]) {
      const network=response(type,okValue),h=harness(async()=>network),event=h.dispatch('/index.html');
      equal(await event.response,network);equal(h.saved.has('https://garden.example/index.html'),type==='basic'&&okValue);
    }
  });
  await test('service worker falls back offline and after four-second timeout, then refreshes late cache',async()=>{
    const cached=response(),h=harness(async()=>{throw new TypeError('offline');});h.saved.set('https://garden.example/index.html',cached);
    equal(await h.dispatch('/index.html').response,cached);
    let release;const late=response(),slow=harness(()=>new Promise(resolve=>release=resolve));slow.saved.set('https://garden.example/app.js',cached);
    const event=slow.dispatch('/app.js');
    // Let the cache open and network race register before firing its timeout.
    await Promise.resolve();await Promise.resolve();equal(slow.timers.length,1);slow.timers[0]();
    equal(await event.response,cached);release(late);await Promise.all(event.pending);equal(slow.saved.get('https://garden.example/app.js'),late);
  });
  await test('service worker installation skips waiting and activation deletes old caches and claims clients',async()=>{
    const h=harness(async()=>response());let promise;
    h.listeners.install({waitUntil(p){promise=p;}});await promise;ok(h.skipped);ok(h.saved.has('https://garden.example/index.html'));
    h.listeners.activate({waitUntil(p){promise=p;}});await promise;ok(h.claimed);equal(h.saved.get('deleted-cache'),'gangarapu-garden-old');
  });
}
