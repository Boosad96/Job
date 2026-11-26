import { canonicalUrl, hash, jobSchema, normalize, type Filters, type Job, type Listing } from './model';

export type Env = {
  DB: D1Database; PUBLIC_LIMIT: RateLimit; TELEGRAM_BOT_TOKEN?: string; TELEGRAM_WEBHOOK_SECRET?: string;
  TELEGRAM_BOT_USERNAME?: string; API_CREDENTIALS?: string; CHANNEL_CHAT_ID?: string;
  CHANNEL_AUTO_PUBLISH?: string; FEEDS_JSON?: string; USAJOBS_API_KEY?: string; USAJOBS_USER_AGENT?: string;
  PREMIUM_ENABLED?: string;
};
export type JobRow = {id: string; payload: string; version: number; created_at: string; updated_at: string; visible_at: string};
export class Conflict extends Error {}
export const unpack = (row: JobRow): Listing => ({
  ...JSON.parse(row.payload), id: row.id, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at
});
export async function lookup(db: D1Database, id: string) {
  const row = await db.prepare('SELECT * FROM jobs WHERE id=?').bind(id).first<JobRow>();
  return row ? unpack(row) : null;
}
export const activeSql = "status='active' AND (deadline IS NULL OR deadline>strftime('%Y-%m-%dT%H:%M:%fZ','now'))";
export function isActive(job: Listing) {
  return job.status === 'active' && (!job.applicationDeadline || Date.parse(job.applicationDeadline) > Date.now());
}
export async function ingest(db: D1Database, jobs: Job[], actor: string, key: string) {
  const items = jobs.map(normalize);
  const digest = await hash(JSON.stringify(items.map(({status, ...rest}, index) => ({...rest, status: jobs[index].status ?? 'active'}))));
  const replay = async () => {
    const receipt = await db.prepare('SELECT digest,ids FROM receipts WHERE actor=? AND key=?').bind(actor,key)
      .first<{digest: string; ids: string}>();
    if (!receipt) return null;
    if (receipt.digest !== digest) throw new Conflict('Idempotency key has a different request body');
    return {ids: JSON.parse(receipt.ids) as string[], replayed: true};
  };
  const cached = await replay();
  if (cached) return cached;
  const identities = items.map(job => canonicalUrl(job.officialSourceUrl));
  const ids = await Promise.all(identities.map(hash));
  try {
    await db.batch([
      ...items.map((job, index) => db.prepare('INSERT INTO jobs(id,identity,payload,actor) VALUES(?,?,?,?) ON CONFLICT(identity) DO NOTHING')
        .bind(ids[index], identities[index], JSON.stringify(job), actor)),
      db.prepare('INSERT INTO receipts(actor,key,digest,ids) VALUES(?,?,?,?)').bind(actor,key,digest,JSON.stringify(ids))
    ]);
  } catch (error) {
    const concurrent = await replay();
    if (concurrent) return concurrent;
    throw error;
  }
  return {ids, replayed: false};
}
export async function updateJob(db: D1Database, current: Listing, patch: Partial<Job>, actor: string) {
  const { id, version, createdAt: _createdAt, updatedAt: _updatedAt, ...previous } = current;
  const payload = normalize(jobSchema.parse({...previous, ...patch}));
  if (canonicalUrl(payload.officialSourceUrl) !== canonicalUrl(previous.officialSourceUrl)) {
    throw new Conflict('The canonical source URL is immutable');
  }
  const result = await db.prepare(`UPDATE jobs SET payload=?,actor=?,version=version+1,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
    visible_at=CASE WHEN (?='active' AND status<>'active') THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE visible_at END
    WHERE id=? AND version=? RETURNING *`)
    .bind(JSON.stringify(payload),actor,payload.status!,id,version).first<JobRow>();
  if (!result) throw new Conflict('Job changed. Reload and retry');
  return unpack(result);
}
const jsonField = (key: string) => `json_extract(payload,'$.${key}')`;
export async function search(db: D1Database, filters: Filters, options: {limit?: number; offset?: number; cursor?: [string,string]; ascending?: boolean} = {}) {
  const clauses = [activeSql];
  const values: (string | number)[] = [];
  const add = (sql: string, ...params: (string | number)[]) => { clauses.push(sql); values.push(...params); };
  for (const key of ['country','state','city','category','employmentType','qualification','currency','salaryPeriod','remote','visaSponsorship'] as const) {
    const value = filters[key];
    if (value != null) {
      const field = key === 'country' ? 'country' : jsonField(key);
      add(typeof value === 'boolean' ? `${field}=?` : `${field}=? COLLATE NOCASE`, typeof value === 'boolean' ? Number(value) : value);
    }
  }
  if (filters.q) {
    const q = filters.q.toLowerCase();
    add(`(instr(lower(${jsonField('title')}),?)>0 OR instr(lower(${jsonField('company')}),?)>0 OR instr(lower(coalesce(${jsonField('description')},'')),?)>0)`,q,q,q);
  }
  for (const skill of filters.skills?.split(',').map(value => value.trim().toLowerCase()).filter(Boolean) ?? []) {
    add("EXISTS(SELECT 1 FROM json_each(payload,'$.skills') WHERE lower(value)=?)",skill);
  }
  if (filters.experience != null) add(`${jsonField('experience')}<=?`,filters.experience);
  if (filters.minSalary != null) add(`coalesce(${jsonField('maxSalary')},${jsonField('minSalary')})>=?`,filters.minSalary);
  if (filters.maxSalary != null) add(`coalesce(${jsonField('minSalary')},${jsonField('maxSalary')})<=?`,filters.maxSalary);
  if (options.cursor) add('(visible_at,id)>(?,?)', ...options.cursor);
  const order = options.ascending ? 'ASC' : 'DESC';
  const sortColumn = options.cursor ? 'visible_at' : 'created_at';
  const {results} = await db.prepare(`SELECT * FROM jobs WHERE ${clauses.join(' AND ')} ORDER BY ${sortColumn} ${order},id ${order} LIMIT ? OFFSET ?`)
    .bind(...values,options.limit ?? 10,options.offset ?? 0).all<JobRow>();
  return results.map(row=>({...unpack(row), ...(options.cursor ? {visibleAt:row.visible_at} : {})}));
}
export async function stats(db: D1Database) {
  const [jobs, totals, sources, reports] = await db.batch([
    db.prepare('SELECT status,count(*) AS count FROM jobs GROUP BY status'),
    db.prepare('SELECT (SELECT count(*) FROM users) AS users,(SELECT count(*) FROM users WHERE referred_by IS NOT NULL) AS referrals,(SELECT count(*) FROM saved_jobs) AS savedJobs,(SELECT count(*) FROM searches) AS savedSearches,(SELECT count(*) FROM publications WHERE state=\'published\') AS published'),
    db.prepare('SELECT * FROM source_health ORDER BY name LIMIT 50'),
    db.prepare('SELECT day,payload FROM operational_reports ORDER BY day DESC LIMIT 7')
  ]);
  return {jobs: jobs.results, totals: totals.results[0], sources: sources.results, reports: reports.results};
}
