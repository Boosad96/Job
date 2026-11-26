import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { app } from '../src/index';
import { ingest, type Env } from '../src/store';

const mf = new Miniflare(convertV4MiniflareOptions({
  workers: [{
    name: 'public-site-test', modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    d1Databases: { DB: 'public-site-test' }, compatibilityDate: '2026-01-15'
  }]
}));
const base = 'https://jobradar.example.test';
const requestOrigin = 'https://worker.example.test';
const deadline = new Date(Date.now() + 7 * 86400000).toISOString();
const seed = {
  company: 'Example & Co.', sourceName: 'Fixture', country: 'IN', state: 'West Bengal', city: 'Kolkata',
  category: 'government' as const, employmentType: 'full-time' as const, remote: false
};
const unsafeText = '</script><script>example text</script>';
const title = 'Analyst & Assistant';
let env: Env;
let active: string;
let draft: string;
let expired: string;
const call = (path: string, overrides: Partial<Env> = {}) =>
  app.request(requestOrigin + path, {}, { ...env, ...overrides });

before(async () => {
  const db = await mf.getD1Database('DB') as unknown as D1Database;
  const sql = await readFile(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8');
  const statements = sql.match(/CREATE TRIGGER[\s\S]*?\nEND;|CREATE [\s\S]*?;/g) ?? [];
  await db.batch(statements.map(statement => db.prepare(statement)));
  env = {
    DB: db, PUBLIC_LIMIT: { limit: async () => ({ success: true }) },
    PUBLIC_SITE_URL: base + '/', TELEGRAM_BOT_USERNAME: 'FixtureBot'
  };
  const { ids } = await ingest(db, [
    ...Array.from({ length: 20 }, (_, index) => ({
      ...seed, title: `Analyst fixture ${index}`, officialSourceUrl: `https://example.test/listings/${index}`
    })),
    { ...seed, title, officialSourceUrl: 'https://example.test/active', applicationUrl: 'https://example.test/apply',
      description: `Read the official posting. ${unsafeText}`, minSalary: 13000, maxSalary: 32000, currency: 'INR',
      salaryPeriod: 'monthly', applicationDeadline: deadline, experience: 0 },
    { ...seed, title: 'Draft fixture', officialSourceUrl: 'https://example.test/draft', status: 'draft' },
    { ...seed, title: 'Passed deadline', officialSourceUrl: 'https://example.test/passed',
      applicationDeadline: '2000-01-01T00:00:00.000Z' }
  ], 'fixture', 'public-site-fixtures');

  [active, draft, expired] = ids.slice(-3);
  // Model the interval between the deadline passing and scheduled status maintenance.
  await db.prepare("UPDATE jobs SET payload=json_set(payload,'$.status','active') WHERE id=?").bind(expired).run();
  await db.prepare("UPDATE jobs SET created_at='2001-01-01T00:00:00.000Z' WHERE id<>?").bind(active).run();
});

after(() => mf.dispose());

test('home lists up to 20 active jobs newest first and links to the next page', async () => {
  const response = await call('/');
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.equal(html.match(/class="job-card"/g)?.length, 20);
  assert.ok(html.indexOf(active) < html.indexOf('Analyst fixture'));
  assert.match(html, /Analyst &amp; Assistant/);
  assert.match(html, /13,000–32,000 INR monthly/);
  assert.match(html, /Last date to apply/);
  assert.match(html, /Get job alerts on Telegram/);
  assert.match(html, /href="\/\?offset=20"/);
  assert.ok(!html.includes(draft) && !html.includes(expired));
  assert.equal((await (await call('/?offset=20')).text()).match(/class="job-card"/g)?.length, 1);
});

test('search applies the shared filters and preserves them in pagination', async () => {
  const route = '/search?q=Analyst&country=in&state=West+Bengal&city=Kolkata&category=government&employmentType=full-time&remote=false';
  const response = await call(route);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>Search jobs for Analyst \| JobRadar AI<\/title>/);
  assert.match(html, /remote=false&amp;offset=20/);
  assert.ok(html.includes(active) && !html.includes(draft) && !html.includes(expired));
  assert.match(await (await call('/search?category=private')).text(), /No matching jobs yet\./);
  assert.equal((await call('/search?remote=invalid')).status, 400);
});

test('job page renders the known active job and its structured data safely', async () => {
  const response = await call('/jobs/' + active);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Content-Security-Policy') ?? '', /script-src 'self'/);
  const html = await response.text();
  assert.match(html, /<h1>Analyst &amp; Assistant<\/h1>/);
  assert.match(html, /13,000–32,000 INR monthly/);
  assert.ok(html.includes(`datetime="${deadline}"`));
  assert.ok(html.includes(`href="${base}/jobs/${active}"`));
  assert.ok(html.includes(`https://t.me/FixtureBot?start=j_${active.slice(0, 60)}`));
  assert.match(html, /Official notification/);
  assert.match(html, /Apply on official site/);
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;script&gt;example text&lt;\/script&gt;/);
  const data = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)?.[1] ?? '');
  assert.equal(data['@type'], 'JobPosting');
  assert.equal(data.title, title);
  assert.equal(data.validThrough, deadline);
  assert.equal(data.baseSalary.value.minValue, 13000);
  assert.ok(!('datePosted' in data));
});

test('unknown, malformed and draft jobs return a public 404', async () => {
  for (const id of ['f'.repeat(64), 'A'.repeat(64), 'short', draft]) {
    const response = await call('/jobs/' + id);
    assert.equal(response.status, 404);
    assert.match(await response.text(), /<h1>Job not found<\/h1>/);
  }
  const pastDeadline = await call('/jobs/' + expired);
  assert.equal(pastDeadline.status, 200);
  assert.match(await pastDeadline.text(), /Applications closed/);
});

test('sitemap contains only current jobs and robots excludes internal paths', async () => {
  const response = await call('/sitemap.xml');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Content-Type') ?? '', /^application\/xml/);
  const xml = await response.text();
  assert.equal(xml.match(/<loc>[^<]*\/jobs\//g)?.length, 21);
  assert.ok(xml.includes(`${base}/jobs/${active}`) && !xml.includes(draft) && !xml.includes(expired));
  assert.ok(xml.includes(`${base}/privacy-policy`));
  const robots = await (await call('/robots.txt', { PUBLIC_SITE_URL: undefined })).text();
  assert.match(robots, /^Disallow: \/admin$/m);
  assert.match(robots, /^Disallow: \/api\/$/m);
  assert.ok(robots.includes(`Sitemap: ${requestOrigin}/sitemap.xml`));
});

test('public configuration, text assets and HTML rate limits', async () => {
  assert.equal((await call('/ads.txt')).status, 404);
  assert.equal((await call('/ads.txt', { ADS_TXT: '  ' })).status, 404);
  const ads = '# Example ads configuration\n';
  assert.equal(await (await call('/ads.txt', { ADS_TXT: ads })).text(), ads);
  const contact = await call('/contact', { TELEGRAM_BOT_USERNAME: undefined, PUBLIC_CONTACT_EMAIL: 'contact@example.test' });
  const html = await contact.text();
  assert.match(html, /mailto:contact@example\.test/);
  assert.ok(!html.includes('t.me/'));
  const css = await call('/public/style.css');
  assert.match(css.headers.get('Content-Type') ?? '', /^text\/css/);
  const rateLimited = { PUBLIC_LIMIT: { limit: async () => ({ success: false }) } };
  for (const path of ['/', '/search', '/jobs/' + active, '/about', '/sitemap.xml', '/robots.txt']) {
    const response = await call(path, rateLimited);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('Retry-After'), '60');
  }
});
