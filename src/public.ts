import type { Context } from 'hono';
import { z } from 'zod';
import { filtersSchema, type Listing } from './model';
import { publicCss } from './public-css';
import { activeSql, lookup, publicSiteOrigin, search, type Env } from './store';

type PublicContext = Context<{ Bindings: Env }>;
type Page = {
  path: string;
  title: string;
  description: string;
  content: string;
  jobPosting?: object;
  status?: 200 | 400 | 404;
};

const homeDescription = 'Browse verified government and private job listings in West Bengal and across India, with job alerts on Telegram.';
const pageSize = 20;
const maxOffset = 10000;
const offsetSchema = z.coerce.number().int().min(0).max(maxOffset).default(0);
const jobId = /^[a-f0-9]{64}$/;
const employmentTypes = ['full-time', 'part-time', 'contract', 'internship', 'temporary', 'volunteer'];
const legalLinks = [
  ['/about', 'About'], ['/privacy-policy', 'Privacy Policy'], ['/terms', 'Terms'], ['/contact', 'Contact']
] as const;

function escapeHtml(value: string | number) {
  const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(value).replace(/[&<>"']/g, character => entities[character]);
}

function baseUrl(c: PublicContext) {
  return publicSiteOrigin(c.env.PUBLIC_SITE_URL, c.req.url) ?? new URL(c.req.url).origin;
}

function botUrl(env: Env) {
  const username = env.TELEGRAM_BOT_USERNAME;
  return username && /^[a-zA-Z0-9_]{5,32}$/.test(username) ? `https://t.me/${username}` : '';
}

function link(url: string, label: string, className = '') {
  return `<a${className ? ` class="${escapeHtml(className)}"` : ''} href="${escapeHtml(url)}">${escapeHtml(label)}</a>`;
}

function telegramButton(env: Env, className = 'button primary') {
  const url = botUrl(env);
  return url ? link(url, 'Get job alerts on Telegram', className) : '';
}

function page(c: PublicContext, data: Page) {
  const canonical = escapeHtml(baseUrl(c) + data.path);
  const title = escapeHtml(data.title);
  const description = escapeHtml(data.description);
  const telegram = botUrl(c.env);
  // JSON-LD is a data block. Escape markup delimiters in the raw script text.
  const structuredData = data.jobPosting
    ? `<script type="application/ld+json">${JSON.stringify(data.jobPosting).replace(/</g, '\\u003c')}</script>` : '';
  return c.html(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <meta name="description" content="${description}">
  <link rel="canonical" href="${canonical}">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:type" content="${data.jobPosting ? 'article' : 'website'}">
  <meta property="og:url" content="${canonical}">
  <link rel="stylesheet" href="/public/style.css">
  ${structuredData}
</head>
<body>
  <a class="skip" href="#main">Skip to content</a>
  <header class="site-header">
    <div class="wrap header-inner">
      <a class="wordmark" href="/">JobRadar<span> AI</span></a>
      <nav aria-label="Main navigation">
        <a href="/">Latest jobs</a><a href="/search">Search</a>
      </nav>
    </div>
  </header>
  <main class="wrap" id="main">${data.content}</main>
  <footer class="site-footer">
    <div class="wrap footer-inner">
      <a class="wordmark" href="/">JobRadar<span> AI</span></a>
      <nav aria-label="Footer navigation">
        ${legalLinks.map(([path, title]) => link(path, title)).join('')}
        ${telegram ? link(telegram, 'Telegram bot') : ''}
      </nav>
    </div>
  </footer>
</body>
</html>`, data.status ?? 200);
}

const countryNames = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'code' });
const numbers = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 20 });
const dates = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'UTC' });

function location(job: Listing) {
  const country = job.country ? countryNames.of(job.country) : null;
  return [job.city, job.state, country].filter(Boolean).join(', ');
}

function salary(job: Listing) {
  const { minSalary, maxSalary, currency, salaryPeriod } = job;
  if (minSalary == null && maxSalary == null) return '';
  const amount = minSalary != null && maxSalary != null && minSalary !== maxSalary
    ? `${numbers.format(minSalary)}–${numbers.format(maxSalary)}`
    : `${minSalary == null ? 'Up to ' : maxSalary == null ? 'From ' : ''}${numbers.format((minSalary ?? maxSalary)!)}`;
  return [amount, currency, salaryPeriod].filter(Boolean).join(' ');
}

function time(value: string) {
  return `<time datetime="${escapeHtml(value)}">${escapeHtml(dates.format(new Date(value)))}</time>`;
}

function jobList(jobs: Listing[]) {
  if (!jobs.length) return '<p class="empty">No matching jobs yet.</p>';
  return `<ul class="job-list">${jobs.map(job => {
    const place = location(job);
    const pay = salary(job);
    return `<li><article class="job-card">
      <h3>${link(`/jobs/${job.id}`, job.title)}</h3>
      <p class="company">${escapeHtml(job.company)}</p>
      ${place ? `<p class="muted">${escapeHtml(place)}</p>` : ''}
      ${pay ? `<p class="muted">${escapeHtml(pay)}</p>` : ''}
      ${job.applicationDeadline ? `<p class="deadline">Last date to apply ${time(job.applicationDeadline)}</p>` : ''}
    </article></li>`;
  }).join('')}</ul>`;
}

function pagination(path: string, query: Record<string, string>, offset: number, hasMore: boolean) {
  function url(nextOffset: number) {
    const params = new URLSearchParams(query);
    if (nextOffset) params.set('offset', String(nextOffset));
    return params.size ? `${path}?${params}` : path;
  }
  const previous = offset > 0 ? link(url(Math.max(0, offset - pageSize)), 'Previous page', 'button') : '';
  const next = hasMore && offset + pageSize <= maxOffset ? link(url(offset + pageSize), 'Next page', 'button') : '';
  return previous || next ? `<nav class="actions pagination" aria-label="Pagination">${previous}${next}</nav>` : '';
}

function searchForm(query: Record<string, string>) {
  function input(name: string, label: string, placeholder = '', maxLength = 180) {
    return `<label>${label}<input name="${name}" value="${escapeHtml(query[name] ?? '')}"
      maxlength="${maxLength}" placeholder="${escapeHtml(placeholder)}"></label>`;
  }
  function select(name: string, label: string, options: string[], text = options) {
    return `<label>${label}<select name="${name}">
      <option value="">Any</option>${options.map((value, index) =>
        `<option value="${escapeHtml(value)}"${query[name] === value ? ' selected' : ''}>${escapeHtml(text[index])}</option>`
      ).join('')}</select></label>`;
  }
  return `<form class="search-form" action="/search" method="get">
    <div class="keyword">${input('q', 'Keyword', 'Job title, company or description')}</div>
    <div class="filters">
      ${input('country', 'Country code', 'e.g. IN', 2)}
      ${input('state', 'State', 'e.g. West Bengal')}
      ${input('city', 'City')}
      ${select('category', 'Category', ['government', 'private'], ['Government', 'Private'])}
      ${select('employmentType', 'Employment type', employmentTypes, ['Full-time', 'Part-time', 'Contract', 'Internship', 'Temporary', 'Volunteer'])}
      ${select('remote', 'Remote', ['true', 'false'], ['Yes', 'No'])}
    </div>
    <div class="actions"><button class="button primary" type="submit">Search jobs</button><a href="/search">Clear filters</a></div>
  </form>`;
}

async function home(c: PublicContext) {
  const offset = offsetSchema.safeParse(c.req.query('offset'));
  const jobs = offset.success ? await search(c.env.DB, {}, { limit: pageSize + 1, offset: offset.data }) : [];
  return page(c, {
    path: '/',
    title: 'JobRadar AI — Latest West Bengal & India Govt Jobs',
    description: homeDescription,
    status: offset.success ? 200 : 400,
    content: `<section class="hero">
      <h1>Jobs in West Bengal and across India</h1>
      <p>Find government and private openings, check the official notification, and keep track of application deadlines.</p>
      <div class="actions">${link('/search', 'Search jobs', 'button')}${telegramButton(c.env)}</div>
    </section>
    <section class="listing" aria-labelledby="latest">
      <h2 id="latest">Latest jobs</h2>
      <nav class="actions chips" aria-label="Browse jobs">
        <a href="/" aria-current="page">All jobs</a>
        <a href="/search?category=government">Government</a>
        <a href="/search?category=private">Private</a>
        <a href="/search?country=IN&amp;state=West+Bengal">West Bengal</a>
      </nav>
      ${offset.success ? jobList(jobs.slice(0, pageSize)) + pagination('/', {}, offset.data, jobs.length > pageSize)
        : '<p class="notice">The page offset is invalid. <a href="/">View the latest jobs</a>.</p>'}
    </section>`
  });
}

async function searchPage(c: PublicContext) {
  const { offset: rawOffset, ...rawQuery } = c.req.query();
  const query = Object.fromEntries(Object.entries(rawQuery).filter(([, value]) => value.trim()));
  const filters = filtersSchema.safeParse(query);
  const offset = offsetSchema.safeParse(rawOffset);
  const valid = filters.success && offset.success;
  const jobs = valid ? await search(c.env.DB, filters.data, { limit: pageSize + 1, offset: offset.data }) : [];
  return page(c, {
    path: '/search',
    title: `Search jobs${query.q ? ` for ${query.q}` : ''} | JobRadar AI`,
    description: 'Search JobRadar AI listings by keyword, location, category, employment type and remote availability.',
    status: valid ? 200 : 400,
    content: `<section class="page-heading"><h1>Search jobs</h1></section>
      ${searchForm(query)}
      <section class="listing" aria-labelledby="results">
        <h2 id="results">Search results</h2>
        ${valid ? jobList(jobs.slice(0, pageSize)) + pagination('/search', query, offset.data, jobs.length > pageSize)
          : '<p class="notice">Check the search filters and try again. Use a two-letter country code such as IN.</p>'}
      </section>`
  });
}

const salaryUnits = { hourly: 'HOUR', daily: 'DAY', weekly: 'WEEK', monthly: 'MONTH', yearly: 'YEAR' } as const;

function jobPosting(job: Listing) {
  const hasLocation = job.city || job.state || job.country;
  const hasSalary = job.minSalary != null && job.maxSalary != null && job.currency;
  const address = {
    '@type': 'PostalAddress',
    addressLocality: job.city ?? undefined,
    addressRegion: job.state ?? undefined,
    addressCountry: job.country ?? undefined
  };
  return {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: job.title,
    description: job.description ? escapeHtml(job.description) : undefined,
    datePosted: job.publicationDate ?? undefined,
    validThrough: job.applicationDeadline ?? undefined,
    hiringOrganization: { '@type': 'Organization', name: job.company },
    jobLocation: hasLocation ? { '@type': 'Place', address } : undefined,
    employmentType: job.employmentType?.toUpperCase().replaceAll('-', '_'),
    baseSalary: hasSalary ? {
      '@type': 'MonetaryAmount',
      currency: job.currency,
      value: {
        '@type': 'QuantitativeValue',
        minValue: job.minSalary,
        maxValue: job.maxSalary,
        unitText: job.salaryPeriod ? salaryUnits[job.salaryPeriod] : undefined
      }
    } : undefined
  };
}

function jobFacts(job: Listing) {
  const facts: [string, string | number | null | undefined][] = [
    ['Location', location(job)],
    ['Category', job.category],
    ['Employment type', job.employmentType],
    ['Qualification', job.qualification],
    ['Skills', job.skills?.join(', ')],
    ['Experience (years)', job.experience],
    ['Salary', salary(job)],
    ['Remote', job.remote == null ? null : job.remote ? 'Yes' : 'No'],
    ['Visa sponsorship', job.visaSponsorship == null ? null : job.visaSponsorship ? 'Yes' : 'No']
  ];
  const rows = facts.flatMap(([label, value]) => value == null || value === '' ? [] : [
    `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`
  ]);
  if (job.publicationDate) rows.push(`<div><dt>Published</dt><dd>${time(job.publicationDate)}</dd></div>`);
  return rows.length ? `<dl class="facts">${rows.join('')}</dl>` : '';
}

function notificationLink(url: string | null | undefined, label: string, className: string) {
  const target = url ? URL.parse(url) : null;
  return target?.protocol === 'https:' && !target.username && !target.password ? link(target.href, label, className) : '';
}

async function jobPage(c: PublicContext) {
  const id = c.req.param('id');
  const job = id && jobId.test(id) ? await lookup(c.env.DB, id) : null;
  if (!job || job.status !== 'active') {
    return page(c, {
      path: c.req.path,
      title: 'Job not found | JobRadar AI',
      description: 'Browse current job listings on JobRadar AI.',
      status: 404,
      content: '<section class="page-heading"><h1>Job not found</h1><p><a href="/">Browse the latest jobs</a></p></section>'
    });
  }
  const bot = botUrl(c.env);
  const deadline = job.applicationDeadline;
  const expired = deadline && Date.parse(deadline) <= Date.now();
  const path = `/jobs/${job.id}`;
  const plainDescription = job.description?.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() ?? '';
  return page(c, {
    path,
    title: `${job.title} — ${job.company} | JobRadar AI`,
    description: Array.from(plainDescription).slice(0, 155).join(''),
    jobPosting: jobPosting(job),
    content: `<article class="detail">
      <header class="page-heading">
        <a href="/">Latest jobs</a>
        <h1>${escapeHtml(job.title)}</h1>
        <p class="company">${escapeHtml(job.company)}</p>
        ${deadline ? `<p class="deadline">Last date to apply ${time(deadline)}</p>` : ''}
        ${expired ? '<p class="notice">Applications closed</p>' : ''}
      </header>
      ${jobFacts(job)}
      ${job.description ? `<section class="description"><h2>Job description</h2>
        <p>${escapeHtml(job.description)}</p></section>` : ''}
      <div class="actions job-actions">
        ${notificationLink(job.applicationUrl, 'Apply on official site', 'button primary')}
        ${notificationLink(job.officialSourceUrl, 'Official notification', 'button')}
        ${bot ? link(`${bot}?start=j_${job.id.slice(0, 60)}`, 'Open this job in Telegram', 'button') : ''}
        ${telegramButton(c.env, 'button')}
      </div>
    </article>`
  });
}

function contactLink(env: Env) {
  const email = env.PUBLIC_CONTACT_EMAIL?.trim() || 'boosad.96.abhi@gmail.com';
  return link(`mailto:${email}`, email);
}

const staticPages = {
  '/about': {
    title: 'About',
    description: 'Learn who runs JobRadar AI and how job listings are verified.',
    content: () => `<p>JobRadar AI lists government and private job openings for job seekers in West Bengal and across India. You can browse openings on the website and receive alerts through Telegram.</p>
      <h2>Who runs JobRadar AI</h2><p>Abhishek Debsharma operates JobRadar AI as a sole proprietor based in West Bengal, India.</p>
      <h2>How jobs are verified</h2><p>Listings use official recruitment notices and employer sources. Each job page links to the official notification so you can confirm eligibility, dates and application instructions.</p>`
  },
  '/privacy-policy': {
    title: 'Privacy Policy',
    description: 'Read how JobRadar AI handles website visits and Telegram bot data.',
    content: (env: Env) => `<h2>Website visits</h2><p>The website collects only standard server logs used to operate the service.</p>
      <h2>Telegram bot</h2><p>If you use the bot, JobRadar AI stores your Telegram user identifier and the settings, saved jobs and searches you use so the bot can provide those features and deliver alerts. You can use <code>/delete_me</code> in the bot to remove your stored data. Telegram handles messages and account information under its own privacy policy.</p>
      <h2>Privacy questions</h2><p>Email ${contactLink(env)}.</p>`
  },
  '/terms': {
    title: 'Terms',
    description: 'Read the terms for using JobRadar AI listings.',
    content: () => `<p>JobRadar AI provides job listings for information only. Always check the official notification before applying, including the employer’s eligibility rules, fees, deadlines and application instructions.</p>
      <p>Employers make their own recruitment decisions. JobRadar AI cannot guarantee a job, interview or selection.</p>`
  },
  '/contact': {
    title: 'Contact',
    description: 'Contact JobRadar AI about a listing or the Telegram bot.',
    content: (env: Env) => `<p>Email ${contactLink(env)} for questions or corrections. When reporting an issue with a listing, include its JobRadar AI link.</p>
      <div class="actions">${telegramButton(env)}</div>`
  }
};

async function sitemap(c: PublicContext) {
  const { results } = await c.env.DB.prepare(`SELECT id FROM jobs WHERE ${activeSql}
    ORDER BY created_at DESC, id DESC LIMIT 1000`).all<{ id: string }>();
  const paths = ['/', ...legalLinks.map(([path]) => path), ...results.map(({ id }) => `/jobs/${id}`)];
  const origin = baseUrl(c);
  const urls = paths.map(path => `  <url><loc>${escapeHtml(origin + path)}</loc></url>`).join('\n');
  return c.body(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`, 200, { 'Content-Type': 'application/xml; charset=utf-8' });
}

export const publicPages: Record<string, (c: PublicContext) => Response | Promise<Response>> = {
  '/': home,
  '/jobs/:id': jobPage,
  '/search': searchPage,
  '/sitemap.xml': sitemap,
  '/robots.txt': c => c.text(`User-agent: *
Allow: /
Disallow: /admin
Disallow: /api/
Sitemap: ${baseUrl(c)}/sitemap.xml
`),
  '/ads.txt': c => c.env.ADS_TXT?.trim() ? c.text(c.env.ADS_TXT) : c.text('Not found', 404)
};

for (const [path, details] of Object.entries(staticPages)) {
  publicPages[path] = c => page(c, {
    path,
    title: `${details.title} | JobRadar AI`,
    description: details.description,
    content: `<article class="prose page-heading"><h1>${details.title}</h1>${details.content(c.env)}</article>`
  });
}

export function publicStyles(c: PublicContext) {
  return c.body(publicCss, 200, { 'Content-Type': 'text/css; charset=utf-8' });
}
