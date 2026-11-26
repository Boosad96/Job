import { z } from 'zod';
import { hash, jobSchema } from './model';
import { ingest, type Env } from './store';

const feedSchema = z.discriminatedUnion('kind',[
  z.object({kind:z.literal('greenhouse'),board:z.string().regex(/^[a-z0-9_-]{1,80}$/i)}),
  z.object({kind:z.literal('lever'),board:z.string().regex(/^[a-z0-9_-]{1,80}$/i),eu:z.boolean().optional()}),
  z.object({kind:z.literal('usajobs'),keyword:z.string().trim().min(1).max(80)}),
  z.object({kind:z.literal('remotive')}),
  z.object({kind:z.literal('authorized-json'),name:z.string().trim().min(1).max(80),url:z.url({protocol:/^https$/})})
]);
type Feed = z.infer<typeof feedSchema>;
const plain = (value?: string) => value?.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim().slice(0,12000) || null;
const text = z.string().nullish().transform(value=>value??undefined);
const greenhouse = z.object({jobs:z.array(z.object({title:z.string(),absolute_url:z.string(),content:text})),name:text});
const lever = z.array(z.object({
  text:z.string(),hostedUrl:z.string(),applyUrl:text,descriptionPlain:text,workplaceType:text
}));
const remotive = z.object({jobs:z.array(z.object({
  title:z.string(),company_name:z.string(),url:z.string(),description:text,publication_date:text
}))});
const usa = z.object({SearchResult:z.object({SearchResultItems:z.array(z.object({MatchedObjectDescriptor:z.object({
  PositionTitle:z.string(),OrganizationName:z.string(),PositionURI:z.string(),ApplyURI:z.array(z.string()).optional(),
  PositionStartDate:text,ApplicationCloseDate:text,UserArea:z.object({Details:z.object({JobSummary:text})}).optional()
})}))})});
function feedName(feed:Feed) {
  switch(feed.kind) {
    case 'greenhouse': return `Greenhouse · ${feed.board}`;
    case 'lever': return `Lever${feed.eu ? ' EU' : ''} · ${feed.board}`;
    case 'usajobs': return `USAJOBS · ${feed.keyword}`;
    case 'remotive': return 'Remotive';
    case 'authorized-json': return feed.name;
  }
}
async function fetchFeed(url:string,headers?:Record<string,string>) {
  const response = await fetch(url,{headers,redirect:'error',signal:AbortSignal.timeout(10000)});
  if (!response.ok) throw new Error(`Feed HTTP ${response.status}`);
  return response.json();
}
async function readFeed(env:Env,feed:Feed):Promise<unknown[]> {
  switch(feed.kind) {
    case 'greenhouse': {
      const base = `https://boards-api.greenhouse.io/v1/boards/${feed.board}`;
      const [board, listings] = await Promise.all([fetchFeed(base),fetchFeed(`${base}/jobs?content=true`)]);
      const {name} = z.object({name:z.string()}).parse(board);
      return greenhouse.parse(listings).jobs.map(job=>({
        title:job.title,company:name,officialSourceUrl:job.absolute_url,
        description:plain(job.content)
      }));
    }
    case 'lever': {
      const region = feed.eu ? '.eu' : '';
      // Lever does not consistently expose the employer display name. Require it as configuration.
      const host = `https://api${region}.lever.co/v0/postings/${feed.board}?mode=json`;
      return lever.parse(await fetchFeed(host)).map(job=>({
        title:job.text,company:null,officialSourceUrl:job.hostedUrl,applicationUrl:job.applyUrl,
        description:plain(job.descriptionPlain),remote:job.workplaceType==='remote' ? true : job.workplaceType==='on-site' ? false : null
      }));
    }
    case 'remotive':
      return remotive.parse(await fetchFeed('https://remotive.com/api/remote-jobs')).jobs.map(job=>({
        title:job.title,company:job.company_name,officialSourceUrl:job.url,description:plain(job.description),
        publicationDate:job.publication_date?.slice(0,10),remote:true
      }));
    case 'usajobs': {
      if (!env.USAJOBS_API_KEY || !env.USAJOBS_USER_AGENT) throw new Error('USAJOBS is unconfigured');
      const endpoint = new URL('https://data.usajobs.gov/api/search');
      endpoint.searchParams.set('Keyword',feed.keyword);
      endpoint.searchParams.set('ResultsPerPage','100');
      return usa.parse(await fetchFeed(endpoint.href,{'Authorization-Key':env.USAJOBS_API_KEY,'User-Agent':env.USAJOBS_USER_AGENT}))
        .SearchResult.SearchResultItems.map(({MatchedObjectDescriptor:job})=>({
          title:job.PositionTitle,company:job.OrganizationName,officialSourceUrl:job.PositionURI,applicationUrl:job.ApplyURI?.[0],
          country:'US',category:'government',publicationDate:job.PositionStartDate?.slice(0,10),
          applicationDeadline:job.ApplicationCloseDate && Number.isFinite(Date.parse(job.ApplicationCloseDate)) ? new Date(job.ApplicationCloseDate).toISOString() : null,
          description:plain(job.UserArea?.Details?.JobSummary)
        }));
    }
    case 'authorized-json': {
      const url = new URL(feed.url);
      if (url.username || url.password) throw new Error('Feed credentials in URLs are unsupported');
      return z.array(z.unknown()).parse(await fetchFeed(url.href));
    }
  }
}
const config = z.array(feedSchema.and(z.object({company:z.string().trim().min(1).max(180).optional()}))).max(7);
export async function refreshFeeds(env:Env) {
  if (!env.FEEDS_JSON) return;
  const feeds = config.parse(JSON.parse(env.FEEDS_JSON));
  for (const feed of feeds) {
    const name = feedName(feed);
    let imported = 0;
    let ok = 1;
    try {
      if (feed.kind==='lever' && !feed.company) throw new Error('Lever requires the employer display name');
      const rows = await readFeed(env,feed);
      const jobs = rows.slice(0,100).flatMap(row=>{
        const parsed = jobSchema.safeParse({...row as object,sourceName:name,...(feed.kind==='lever' ? {company:feed.company} : {})});
        return parsed.success ? [parsed.data] : [];
      });
      if (rows.length && !jobs.length) throw new Error('No valid records');
      for (let i=0;i<jobs.length;i+=20) {
        const batch=jobs.slice(i,i+20);
        const result = await ingest(env.DB,batch,`feed:${name}`,await hash(JSON.stringify(batch)));
        if (!result.replayed) imported+=batch.length;
      }
    } catch {
      ok = 0;
    }
    await env.DB.prepare(`INSERT INTO source_health(name,ok,imported) VALUES(?,?,?)
      ON CONFLICT(name) DO UPDATE SET ok=excluded.ok,imported=excluded.imported,checked_at=CURRENT_TIMESTAMP`).bind(name,ok,imported).run();
  }
}
