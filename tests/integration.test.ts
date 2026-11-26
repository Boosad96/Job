import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { after, before, mock, test } from 'node:test';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { app } from '../src/index';
import { publishApproved } from '../src/channel';
import { scheduled } from '../src/cron';
import { refreshFeeds } from '../src/feeds';
import { hash } from '../src/model';
import type { Env } from '../src/store';

const mf = new Miniflare(convertV4MiniflareOptions({
  workers:[{name:'jobradar-test', modules:true, script:'export default { fetch() { return new Response("ok") } }',
  d1Databases:{DB:'jobradar-test'}, compatibilityDate:'2026-01-15'}]
}));
const muse='test-muse-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const admin='test-admin-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const secret='telegram-secret-for-test-only';
const env = {} as Env;
const job={title:'Finance Assistant',company:'Integration fixture',officialSourceUrl:'https://example.test/public/1',sourceName:'Fixture',
  country:'IN',state:'West Bengal',city:'Kolkata',category:'government',qualification:'BCom',skills:['Excel','SQL'],experience:0,
  minSalary:30000,maxSalary:45000,currency:'INR',salaryPeriod:'monthly',verifiedAt:'2026-01-01T12:00:00Z'};
let id:string;
before(async()=>{
  env.DB = await mf.getD1Database('DB') as unknown as D1Database;
  const sql = await readFile(new URL('../migrations/0001_initial.sql',import.meta.url),'utf8');
  const statements = sql.match(/CREATE TRIGGER[\s\S]*?\nEND;|CREATE [\s\S]*?;/g) ?? [];
  await env.DB.batch(statements.map(statement=>env.DB.prepare(statement)));
  env.PUBLIC_LIMIT={limit:async()=>({success:true})};
  env.API_CREDENTIALS=JSON.stringify([
    {id:'muse',sha256:await hash(muse),scopes:['jobs:write','channel:request']},
    {id:'admin',sha256:await hash(admin),scopes:['jobs:write','jobs:manage','stats:read','channel:approve']}
  ]);
  env.TELEGRAM_WEBHOOK_SECRET=secret;
  env.TELEGRAM_BOT_USERNAME='JobRadarTestBot';
});
after(async()=>mf.dispose());
function call(path:string,options:{method?:string;token?:string;body?:unknown;key?:string;headers?:Record<string,string>}={}) {
  const {method='GET',token,body,key,headers}=options;
  return app.request(path,{method,headers:{
    ...(token?{Authorization:'Bearer '+token}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{}),
    ...(key?{'Idempotency-Key':key}:{}),...headers
  },body:body===undefined?undefined:JSON.stringify(body)},env);
}
async function putJob(body:unknown,key='integration-primary') {
  return call('/api/v1/jobs',{method:'POST',token:muse,body,key});
}

test('health and rate limiting',async()=>{
  assert.equal((await call('/api/v1/health')).status,200);
  env.PUBLIC_LIMIT={limit:async()=>({success:false})};
  try {
    const response=await call('/api/v1/jobs');
    assert.equal(response.status,429);
    assert.equal(response.headers.get('Retry-After'),'60');
  } finally {env.PUBLIC_LIMIT={limit:async()=>({success:true})};}
});
test('authenticated ingestion, atomic receipts, canonical deduplication and audit',async()=>{
  assert.equal((await call('/api/v1/jobs',{method:'POST',body:job})).status,401);
  const concurrent=await Promise.all([putJob(job),putJob(job)]);
  assert.deepEqual(concurrent.map(value=>value.status).sort(),[200,201]);
  id=(await concurrent[0].json() as {data:{ids:string[]}}).data.ids[0];
  assert.match(id,/^[a-f0-9]{64}$/);
  assert.equal((await putJob({...job,city:'Howrah'})).status,409);
  const duplicate=await putJob({...job,officialSourceUrl:job.officialSourceUrl+'?utm_source=mail'},'second-key');
  assert.deepEqual((await duplicate.json() as {data:{ids:string[]}}).data.ids,[id]);
  const badBulk=await call('/api/v1/jobs/bulk',{method:'POST',token:muse,key:'bad-bulk-01',body:{jobs:[{...job,officialSourceUrl:'https://example.test/invalid-bulk'},{title:''}]}});
  assert.equal(badBulk.status,400);
  assert.equal(await env.DB.prepare('SELECT count(*) AS count FROM jobs').first('count'),1);
  assert.equal(await env.DB.prepare("SELECT count(*) AS count FROM audit WHERE action='job.created'").first('count'),1);
});
test('searches using shared filters and protects private admin data',async()=>{
  const response=await call('/api/v1/jobs/search?country=in&city=kolkata&qualification=BCom&skills=excel,SQL&experience=0&minSalary=32000&currency=INR&salaryPeriod=monthly');
  assert.equal(response.status,200);
  assert.equal((await response.json() as {data:{id:string}[]}).data[0].id,id);
  assert.deepEqual(await (await call('/api/v1/jobs?visaSponsorship=false')).json(),{data:[]});
  assert.equal((await call('/api/v1/jobs?minSalary=32000')).status,400);
  assert.equal((await call('/api/v1/admin/stats',{token:muse})).status,403);
  assert.equal((await call('/api/v1/admin/stats',{token:admin})).status,200);
  assert.equal((await call('/admin')).status,200);
});
test('privileged PATCH checks version and excludes inactive listings',async()=>{
  const route='/api/v1/jobs/'+id;
  assert.equal((await call(route,{method:'PATCH',token:muse,body:{status:'draft'}})).status,403);
  assert.equal((await call(route,{method:'PATCH',token:admin,body:{status:'draft'},headers:{'If-Match':'"9"'}})).status,409);
  assert.equal((await call(route,{method:'PATCH',token:admin,body:{minSalary:90000}})).status,400);
  const result=await call(route,{method:'PATCH',token:admin,body:{status:'draft'},headers:{'If-Match':'"1"'}});
  assert.equal(result.headers.get('ETag'),'"2"');
  assert.deepEqual(await (await call('/api/v1/jobs')).json(),{data:[]});
  assert.equal((await call(route,{method:'PATCH',token:admin,body:{status:'active'}})).status,200);
});
test('Telegram webhook, saved jobs/searches, Bengali alerts, deletion and publication approval',async()=>{
  env.TELEGRAM_BOT_TOKEN='fixture-only';
  env.CHANNEL_CHAT_ID='@fixture_channel';
  const outbound:Record<string,unknown>[]=[];
  const stub=mock.method(globalThis,'fetch',async (url:RequestInfo|URL,init?:RequestInit)=>{
    assert.match(String(url),/^https:\/\/api\.telegram\.org\//);
    if (String(url).endsWith('/sendMessage')) outbound.push(JSON.parse(String(init?.body)));
    return Response.json({ok:true,result:{message_id:123}});
  });
  const from={id:12345,language_code:'bn'};
  const chat={id:12345,type:'private'};
  let seq=0;
  const webhook=(body:unknown,authorized=true)=>call('/telegram/webhook',{method:'POST',body,headers:authorized?{'X-Telegram-Bot-Api-Secret-Token':secret}:{}});
  const message=(text:string)=>({update_id:++seq,message:{chat,from,text}});
  const click=(data:string)=>webhook({update_id:++seq,callback_query:{id:'cb',from,data,message:{chat}}});
  try {
    assert.equal((await webhook(message('/start'),false)).status,401);
    const start=message('/start');
    assert.equal((await webhook(start)).status,200);
    assert.equal((await webhook(start)).status,200);
    assert.equal(outbound.length,1);
    assert.match(JSON.stringify(outbound),/WBChakriAlert/);
    assert.equal((await webhook(message('country=IN | city=Kolkata'))).status,200);
    assert.ok(JSON.stringify(outbound).includes('http://localhost/jobs/'+id));
    try {
      env.PUBLIC_SITE_URL='https://jobs.example.test/';
      assert.equal((await webhook(message('/start j_'+id.slice(0,60)))).status,200);
      assert.ok(JSON.stringify(outbound.at(-1)).includes('https://jobs.example.test/jobs/'+id));
    } finally {delete env.PUBLIC_SITE_URL;}
    assert.equal((await click('s:'+id.slice(0,60))).status,200);
    assert.equal((await click('cadence:instant:stale')).status,200);
    assert.equal(await env.DB.prepare('SELECT count(*) AS count FROM searches').first('count'),0);
    const token=await env.DB.prepare('SELECT search_token FROM users').first('search_token');
    assert.equal((await click('cadence:instant:'+token)).status,200);
    assert.equal(await env.DB.prepare('SELECT count(*) AS count FROM saved_jobs').first('count'),1);
    assert.equal(await env.DB.prepare('SELECT count(*) AS count FROM searches').first('count'),1);
    await new Promise(resolve=>setTimeout(resolve,15));
    assert.equal((await putJob({...job,officialSourceUrl:'https://example.test/public/alert'},'alert-later-01')).status,201);
    const time=Date.now()+1000;
    await scheduled(env,'* * * * *',time);
    assert.ok(outbound.some(item=>String(item.text).includes('মিলে যাওয়া চাকরির খবর')));
    const route='/api/v1/channel/publish';
    const requested=await call(route,{method:'POST',token:muse,body:{jobId:id,action:'request',text:'পশ্চিমবঙ্গের সরকারি চাকরি'}});
    assert.equal((await requested.json() as {data:{state:string}}).data.state,'pending');
    await publishApproved(env);
    assert.ok(!outbound.some(item=>item.chat_id===env.CHANNEL_CHAT_ID));
    assert.equal((await call(route,{method:'POST',token:muse,body:{jobId:id,action:'approve'}})).status,403);
    assert.equal((await call(route,{method:'POST',token:admin,body:{jobId:id,action:'approve'}})).status,200);
    await Promise.all([publishApproved(env),publishApproved(env)]);
    assert.equal(outbound.filter(item=>item.chat_id===env.CHANNEL_CHAT_ID).length,1);
    await webhook(message('/delete_me'));
    assert.equal((await click('delete')).status,200);
    for (const table of ['users','saved_jobs','searches']) {
      assert.equal(await env.DB.prepare('SELECT count(*) AS count FROM '+table).first('count'),0);
    }
  } finally {stub.mock.restore();delete env.TELEGRAM_BOT_TOKEN;delete env.CHANNEL_CHAT_ID;}
});
test('maintenance expires deadlines and records health and daily reports',async()=>{
  const result=await putJob({...job,officialSourceUrl:'https://example.test/public/expiry',applicationDeadline:'2020-01-01T00:00:00Z'},'expired-job-key');
  const expiredId=(await result.json() as {data:{ids:string[]}}).data.ids[0];
  await env.DB.prepare("UPDATE jobs SET payload=json_set(payload,'$.status','active') WHERE id=?").bind(expiredId).run();
  env.FEEDS_JSON=JSON.stringify([{kind:'authorized-json',name:'Fixture feed',url:'https://example.test/feed'}]);
  const stub=mock.method(globalThis,'fetch',async(url:RequestInfo|URL)=>{
    assert.equal(String(url),'https://example.test/feed');
    return Response.json([{...job,officialSourceUrl:'https://example.test/feed/one'}]);
  });
  try {
    await scheduled(env,'17 */6 * * *',Date.now());
    await refreshFeeds(env);
    assert.equal(await env.DB.prepare('SELECT status FROM jobs WHERE id=?').bind(expiredId).first('status'),'expired');
    assert.equal(await env.DB.prepare('SELECT ok FROM source_health').first('ok'),1);
    assert.equal(await env.DB.prepare('SELECT count(*) AS count FROM operational_reports').first('count'),1);
  } finally {stub.mock.restore();delete env.FEEDS_JSON;}
});
