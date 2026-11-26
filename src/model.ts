import { z } from 'zod';

const short = z.string().trim().normalize('NFKC').min(1).max(180);
const url = z.url({ protocol: /^https$/ }).max(2048).refine(value => {
  const target = new URL(value);
  return !target.username && !target.password;
}, 'URL must not contain credentials');
const timestamp = z.iso.datetime({ offset: true }).transform(value => new Date(value).toISOString());
const country = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).refine(code => {
  const region = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' }).of(code);
  return !!region && !['XX', 'ZZ', 'EU', 'UN'].includes(code);
}, 'Use a recognized two-letter country code');
const category = z.enum(['government', 'private']);
const employment = z.enum(['full-time', 'part-time', 'contract', 'internship', 'temporary', 'volunteer']);
const period = z.enum(['hourly', 'daily', 'weekly', 'monthly', 'yearly']);
const currency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).refine(code => Intl.supportedValuesOf('currency').includes(code));
const amount = z.number().nonnegative().max(1e12);
const unset = <T extends z.ZodType>(field: T) => field.nullable().optional();
export const jobFields = z.strictObject({
  title: short, company: short, country: unset(country), state: unset(short), city: unset(short),
  category: unset(category), employmentType: unset(employment), qualification: unset(short),
  skills: unset(z.array(short).max(25)), experience: unset(z.number().nonnegative().max(100)),
  minSalary: unset(amount), maxSalary: unset(amount), currency: unset(currency), salaryPeriod: unset(period),
  remote: unset(z.boolean()), visaSponsorship: unset(z.boolean()), description: unset(z.string().trim().min(1).max(12000)),
  officialSourceUrl: url, applicationUrl: unset(url), publicationDate: unset(z.iso.date()),
  applicationDeadline: unset(timestamp), verifiedAt: unset(timestamp),
  status: z.enum(['active', 'draft', 'closed', 'expired']).optional(), sourceName: short
});
export const jobSchema = jobFields.superRefine((job, ctx) => {
  if (job.minSalary != null && job.maxSalary != null && job.minSalary > job.maxSalary) {
    ctx.addIssue({code: 'custom', path: ['maxSalary'], message: 'Maximum salary must be at least the minimum'});
  }
  if (job.verifiedAt && Date.parse(job.verifiedAt) > Date.now() + 300000) {
    ctx.addIssue({code: 'custom', path: ['verifiedAt'], message: 'Verification cannot be in the future'});
  }
  if (job.publicationDate && job.applicationDeadline && job.publicationDate > job.applicationDeadline.slice(0, 10)) {
    ctx.addIssue({code: 'custom', path: ['applicationDeadline'], message: 'Deadline precedes publication'});
  }
});
export type Job = z.output<typeof jobSchema>;
export type Listing = Job & {id: string; version: number; createdAt: string; updatedAt: string};
export const patchSchema = jobFields.partial().refine(value => Object.keys(value).length > 0);
const queryNumber = z.preprocess(value => typeof value === 'string' && value.trim() ? Number(value) : value, amount);
const queryBool = z.preprocess(value => value === 'true' ? true : value === 'false' ? false : value, z.boolean());
export const filtersSchema = z.strictObject({
  q: short.optional(), country: country.optional(), state: short.optional(), city: short.optional(),
  category: category.optional(), employmentType: employment.optional(), qualification: short.optional(),
  skills: short.refine(value => {
    const terms = value.split(',').map(term => term.trim());
    return terms.length <= 25 && terms.every(Boolean);
  }, 'Use up to 25 comma-separated skills').optional(), experience: queryNumber.pipe(z.number().max(100)).optional(),
  minSalary: queryNumber.optional(), maxSalary: queryNumber.optional(), currency: currency.optional(),
  salaryPeriod: period.optional(), remote: queryBool.optional(), visaSponsorship: queryBool.optional()
}).superRefine((value, ctx) => {
  if ((value.minSalary != null || value.maxSalary != null) && (!value.currency || !value.salaryPeriod)) {
    ctx.addIssue({code: 'custom', path: ['currency'], message: 'Salary filters require currency and salaryPeriod'});
  }
  if (value.minSalary != null && value.maxSalary != null && value.minSalary > value.maxSalary) {
    ctx.addIssue({code: 'custom', path: ['maxSalary'], message: 'Maximum salary must be at least the minimum'});
  }
});
export type Filters = z.output<typeof filtersSchema>;
export function canonicalUrl(value: string) {
  const url = new URL(value);
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_.+|gclid|fbclid)$/i.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
  return url.href;
}
export function normalize(job: Job) {
  const fields = Object.fromEntries(Object.keys(jobFields.shape).map(key => [key, job[key as keyof Job] ?? null]));
  return {
    ...fields, ...job,
    skills: job.skills ? [...new Set(job.skills)] : null,
    status: job.applicationDeadline && Date.parse(job.applicationDeadline) <= Date.now() && (job.status === 'active' || !job.status)
      ? 'expired' : job.status ?? 'active'
  } as Job;
}
export async function hash(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function constantTime(a?: string, b?: string) {
  if (!a || !b) return false;
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let difference = left.length ^ right.length;
  for (let index = 0; index < right.length; index++) difference |= (left[index] ?? 0) ^ right[index];
  return difference === 0;
}
