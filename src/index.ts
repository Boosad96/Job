import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import { z } from 'zod';
import { dashboard, script, styles } from './admin';
import { managePublication } from './channel';
import { scheduled } from './cron';
import { constantTime, filtersSchema, hash, jobSchema, patchSchema } from './model';
import { Conflict, ingest, lookup, search, stats, unpack, updateJob, type Env, type JobRow } from './store';
import { handleUpdate } from './telegram';

const scopes = ['jobs:write','jobs:manage','stats:read','channel:request','channel:approve'] as const;
type Scope = (typeof scopes)[number];
type App = {Bindings:Env; Variables:{actor:string;scopes:Scope[]}};
type C = Context<App>;
const app = new Hono<App>();
const credentials = z.array(z.strictObject({
  id:z.string().regex(/^[a-zA-Z0-9_-]{1,50}$/), sha256:z.string().regex(/^[0-9a-f]{64}$/),
  scopes:z.array(z.enum(scopes)).min(1)
})).max(50).refine(rows=>new Set(rows.map(row=>row.id)).size===rows.length && new Set(rows.map(row=>row.sha256)).size===rows.length);
const error = (c:C,message:string,status:400|401|403|404|409|413|429|500|503) => c.json({error:message},status);
const envelope = (c:C,data:unknown,status:200|201=200) => c.json({data},status);
const auth = (scope?:Scope):MiddlewareHandler<App> => async (c,next) => {
  const token = c.req.header('Authorization')?.match(/^Bearer ([A-Za-z0-9._~-]{32,256})$/i)?.[1];
  if (!token || !c.env.API_CREDENTIALS) return error(c,'Unauthorized',401);
  const digest = await hash(token);
  const rows = credentials.parse(JSON.parse(c.env.API_CREDENTIALS));
  const credential = rows.find(row=>constantTime(digest,row.sha256));
  if (!credential) return error(c,'Unauthorized',401);
  if (scope && !credential.scopes.includes(scope)) return error(c,'Forbidden',403);
  c.set('actor',credential.id);
  c.set('scopes',credential.scopes);
  await next();
};
const limit:MiddlewareHandler<App> = async (c,next)=>{
  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
  const result = await c.env.PUBLIC_LIMIT.limit({key:ip});
  if (!result.success) {
    c.header('Retry-After','60');
    return error(c,'Rate limit exceeded',429);
  }
  await next();
};
async function json(c:C) {
  if (!/^application\/json(?:\s*;|$)/i.test(c.req.header('Content-Type')??'')) throw new SyntaxError('Expected JSON');
  return c.req.json();
}
const pagination = z.object({
  limit:z.coerce.number().int().min(1).max(50).default(20),
  offset:z.coerce.number().int().min(0).max(10000).default(0)
});
const jobId = z.string().regex(/^[0-9a-f]{64}$/);
app.use('*',secureHeaders({contentSecurityPolicy:{defaultSrc:["'none'"],scriptSrc:["'self'"],styleSrc:["'self'"],connectSrc:["'self'"],frameAncestors:["'none'"],baseUri:["'none'"],formAction:["'self'"]}}));
app.use('/api/*',async(c,next)=>{ await next(); c.header('Cache-Control','no-store'); });
app.use('/api/v1/*',bodyLimit({maxSize:512*1024,onError:c=>c.json({error:'Request too large'},413)}));
app.get('/api/v1/health',limit,async c=>{
  try { await c.env.DB.prepare('SELECT id FROM jobs LIMIT 1').first(); }
  catch { return error(c,'Database unavailable',503); }
  return envelope(c,{status:'ok'});
});
const publicJobs = async(c:C)=>{
  const {limit,offset,...query} = c.req.query();
  return envelope(c,await search(c.env.DB,filtersSchema.parse(query),pagination.parse({limit,offset})));
};
app.get('/api/v1/jobs',limit,publicJobs);
app.get('/api/v1/jobs/search',limit,publicJobs);
async function submit(c:C,bulk:boolean) {
  const key = z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/).parse(c.req.header('Idempotency-Key'));
  const body = await json(c);
  const jobs = bulk ? z.strictObject({jobs:z.array(jobSchema).min(1).max(30)}).parse(body).jobs : [jobSchema.parse(body)];
  const result = await ingest(c.env.DB,jobs,c.get('actor'),key);
  return envelope(c,result,result.replayed ? 200 : 201);
}
app.post('/api/v1/jobs',auth('jobs:write'),c=>submit(c,false));
app.post('/api/v1/jobs/bulk',auth('jobs:write'),c=>submit(c,true));
app.patch('/api/v1/jobs/:id',auth('jobs:manage'),async c=>{
  const id = jobId.parse(c.req.param('id'));
  const patch = patchSchema.parse(await json(c));
  const current = await lookup(c.env.DB,id);
  if (!current) return error(c,'Job not found',404);
  const expected = c.req.header('If-Match');
  if (expected && expected !== `"${current.version}"`) return error(c,'Job changed. Reload and retry',409);
  const updated = await updateJob(c.env.DB,current,patch,c.get('actor'));
  c.header('ETag',`"${updated.version}"`);
  return envelope(c,updated);
});
app.get('/api/v1/admin/stats',auth('stats:read'),async c=>envelope(c,await stats(c.env.DB)));
app.get('/api/v1/admin/jobs',auth('jobs:manage'),async c=>{
  const query = z.object({q:z.string().trim().max(180).optional(),status:z.enum(['active','closed','draft','expired']).optional()}).parse(c.req.query());
  const {limit,offset} = pagination.parse(c.req.query());
  const q = query.q?.toLowerCase() ?? '';
  const rows=await c.env.DB.prepare(`SELECT * FROM jobs WHERE (? IS NULL OR status=?)
    AND (instr(lower(json_extract(payload,'$.title')),?)>0 OR instr(lower(json_extract(payload,'$.company')),?)>0)
    ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`).bind(query.status??null,query.status??null,q,q,limit,offset).all<JobRow>();
  return envelope(c,rows.results.map(unpack));
});
app.get('/api/v1/admin/publications',auth('channel:approve'),async c=>{
  const rows=await c.env.DB.prepare(`SELECT publications.*,json_extract(jobs.payload,'$.title') AS title FROM publications JOIN jobs ON jobs.id=job_id
    ORDER BY publications.state IN ('pending','sending','approved') DESC,publications.updated_at DESC LIMIT 50`).all();
  return envelope(c,rows.results);
});
app.post('/api/v1/channel/publish',auth(),async c=>{
  const input=z.discriminatedUnion('action',[
    z.strictObject({jobId,action:z.literal('request'),text:z.string().trim().min(5).max(1800)}),
    z.strictObject({jobId,action:z.enum(['approve','reject'])})
  ]).parse(await json(c));
  const required=input.action==='request' ? 'channel:request' : 'channel:approve';
  if (!c.get('scopes').includes(required)) return error(c,'Forbidden',403);
  const post=await managePublication(c.env,input,c.get('actor'));
  return post ? envelope(c,post) : error(c,'Job or publication not found',404);
});
app.post('/telegram/webhook',bodyLimit({maxSize:128*1024}),async c=>{
  if (!constantTime(c.req.header('X-Telegram-Bot-Api-Secret-Token'),c.env.TELEGRAM_WEBHOOK_SECRET)) return error(c,'Unauthorized',401);
  await handleUpdate(c.env,await json(c));
  return c.json({ok:true});
});
app.get('/',c=>c.redirect('/admin',302));
app.get('/admin',c=>c.html(dashboard));
app.get('/admin/style.css',c=>c.body(styles,200,{'Content-Type':'text/css; charset=utf-8'}));
app.get('/admin/app.js',c=>c.body(script,200,{'Content-Type':'text/javascript; charset=utf-8'}));
app.notFound(c=>error(c,'Not found',404));
app.onError((issue,c)=>{
  if (issue instanceof z.ZodError) return c.json({error:'Validation failed',issues:issue.issues.map(value=>({path:value.path,message:value.message}))},400);
  if (issue instanceof SyntaxError) return error(c,'Malformed JSON or configuration',400);
  if (issue instanceof Conflict) return error(c,issue.message,409);
  console.error('Request failed',c.req.method,c.req.routePath,issue.name);
  return error(c,'Internal server error',500);
});
export default {
  fetch: app.fetch,
  scheduled(controller:ScheduledController,env:Env,ctx:ExecutionContext) {
    ctx.waitUntil(scheduled(env,controller.cron,controller.scheduledTime));
  }
};
export {app};
