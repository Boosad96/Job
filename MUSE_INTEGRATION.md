# Muse AI integration

Use the deployed HTTPS origin and base path `/api/v1`. Send `Authorization: Bearer <raw-token>` for scoped requests and `Content-Type: application/json` for JSON bodies. Ask the operator for the Worker origin and a dedicated credential. Store the token in Muse's secret store. Never put it in a URL, job description, or log.

## Endpoint contract

Successful responses use `{"data":...}`. Failures use `{"error":"..."}` and validation failures may include `issues`, an array of objects with `path` and `message`. JSON fields are case sensitive. [openapi.json](openapi.json) provides the machine-readable contract.

| Method and path | Scope | Request and successful `data` |
| --- | --- | --- |
| GET `/health` | Public | No body. Returns `{"status":"ok"}` after a D1 read. |
| GET `/jobs` | Public | No body. Optional filters and pagination. Returns an array of active Job listings. |
| GET `/jobs/search` | Public | No body. Same filters and response as GET /jobs. |
| POST `/jobs` | `jobs:write` | One Job object and required `Idempotency-Key`. Returns `{"ids":["<job-id>"],"replayed":false}`. |
| POST `/jobs/bulk` | `jobs:write` | `{"jobs":[<Job>, ...]}`, 1–30 jobs and required `Idempotency-Key`. Returns `{"ids":["<job-id>", "..."],"replayed":false}` in input order. |
| PATCH `/jobs/{id}` | `jobs:manage` | One nonempty partial Job object. Send `If-Match: "3"` to assert version 3. Returns the updated listing and an ETag header. |
| GET `/admin/jobs` | `jobs:manage` | No body. Accepts `q`, `status`, `limit`, `offset`. Returns all matching listings including drafts and closed jobs. |
| GET `/admin/stats` | `stats:read` | No body. Returns `jobs` (counts by status), `totals` (aggregate users, referrals, saves, searches and publications), `sources`, and `reports`. Reports store JSON strings in their `payload` field. |
| GET `/admin/publications` | `channel:approve` | No body. Returns up to 50 publication records with job titles. |
| POST `/channel/publish` | `channel:request` for request, `channel:approve` for approve/reject | Returns a publication record with `job_id`, `state`, `text`, `job_version`, `message_id`, and `updated_at`. |

Listing responses include normalized job fields, a 64-character lowercase hex `id`, integer `version`, and UTC `createdAt` and `updatedAt`. Public endpoints permit 60 requests per minute per connecting IP at each Cloudflare location. Pagination defaults to 20, with `limit` 1–50 and `offset` 0–10000.

## Job examples and validation

The following examples are API fixtures using a reserved domain. Use real evidence for every production request.

```http
POST /api/v1/jobs
Authorization: Bearer <raw-token>
Content-Type: application/json
Idempotency-Key: authorized-source-481-v1
```

```json
{
  "title": "Finance Assistant",
  "company": "Example Organization",
  "country": "IN",
  "state": "West Bengal",
  "city": "Kolkata",
  "category": "government",
  "employmentType": "full-time",
  "qualification": "BCom",
  "skills": ["Excel"],
  "experience": 0,
  "minSalary": null,
  "maxSalary": null,
  "currency": null,
  "salaryPeriod": null,
  "remote": false,
  "visaSponsorship": null,
  "description": null,
  "officialSourceUrl": "https://example.test/careers/481",
  "applicationUrl": null,
  "publicationDate": "2026-01-01",
  "applicationDeadline": "2026-12-11T17:00:00+05:30",
  "verifiedAt": "2026-11-20T04:00:00Z",
  "status": "draft",
  "sourceName": "Example official board"
}
```

Bulk JSON example with a separate idempotency key.

```json
{"jobs":[{"title":"Finance Assistant","company":"Example Organization","officialSourceUrl":"https://example.test/careers/481","sourceName":"Example official board","status":"draft"}]}
```

PATCH JSON example for a confirmed closure.

```json
{"status":"closed"}
```

- Required fields are `title`, `company`, `officialSourceUrl`, and `sourceName`. Use a listing-specific, credential-free HTTPS URL. Application URLs, when known, follow the same URL rules. Maximum URL length is 2048 characters.
- Optional unknown facts may be omitted or null. Default status is `active`. Valid statuses are `active`, `draft`, `closed`, and `expired`. An active job past its deadline becomes expired. Use `draft` until you can verify a role for publication.
- Short fields use 1–180 characters and are trimmed and Unicode-normalized. A description can be up to 12,000 characters. Skills contain up to 25 short strings. Experience records minimum years required as a number from 0 to 100. Use zero only for explicitly entry-level roles with no experience requirement.
- Country uses recognized two-letter region codes, normalized to uppercase. Use `GB` for the UK, `US` for the USA and `AE` for UAE. Use `West Bengal` in the state field for the West Bengal category. Category is `government` or `private`. Employment is `full-time`, `part-time`, `contract`, `internship`, `temporary`, or `volunteer`. Remote and visa sponsorship are JSON booleans when known.
- Salary amounts are numbers from 0 to 1 trillion, with maximum at least minimum. Use an uppercase supported three-letter currency code and one of `hourly`, `daily`, `weekly`, `monthly`, or `yearly` if known. Do not estimate, convert, or infer salary.
- Publication date is YYYY-MM-DD. Deadline and verification use ISO 8601 datetimes with a time zone, stored in UTC. The deadline cannot precede publication. The verification timestamp can be at most five minutes in the future to allow clock skew. Leave an ambiguous deadline null.
- Unknown JSON properties fail validation. PATCH merges and validates the entire job. A canonical source URL cannot be changed. Hash fragments, tracking parameters and trailing path slashes are ignored by canonicalization.

Public GET example.

```text
/api/v1/jobs/search?country=IN&state=West%20Bengal&city=Kolkata&category=government&qualification=BCom&skills=Excel,SQL&experience=0&minSalary=20000&currency=INR&salaryPeriod=monthly&limit=10
```

Public filters are `q` (literal substring of title, company or description), `country`, `state`, `city`, `category`, `employmentType`, `qualification`, `skills` (all of up to 25 comma-separated terms), `experience` (maximum required years), `currency`, `salaryPeriod`, `minSalary`, `maxSalary`, `remote` and `visaSponsorship` (true/false). Salary ranges require currency and period and match by overlap. Location, qualification and skills use exact comparisons with ASCII case folding. Unknown values do not satisfy explicit filters.

## Channel workflow

Only submit original Bengali copy for active verified West Bengal government roles. Include the correct application details from the source. The Worker appends the official URL and only posts to its configured channel.

```json
{"jobId":"<64-character-job-id>","action":"request","text":"পশ্চিমবঙ্গের সরকারি নিয়োগ। যোগ্যতা ও আবেদনের তথ্য অফিসিয়াল বিজ্ঞপ্তিতে দেখুন।"}
```

The text must contain Bengali letters and be 5–1800 characters. By default, the request creates a `pending` publication. An administrator can send the following JSON, or use `"action":"reject"`.

```json
{"jobId":"<64-character-job-id>","action":"approve"}
```

Approval is bound to the job revision. A changed job requires a fresh request. The minute cron processes approved records. Publication states are `pending`, `approved`, `rejected`, `sending`, and `published`. A `sending` record may require operator reconciliation. Do not resubmit it. A published record is final for that job ID.

## Automation and retries

1. Use official, permitted job sources. Record the origin and verify the role is real, open, and has an authoritative listing URL.
2. Use one deterministic batch key per exact normalized batch and preserve input order. Keys are 8–128 ASCII letters, digits, dots, underscores, colons or hyphens. POST returns 201 for a newly accepted receipt and 200 for a replay. Retries with the same principal, key and normalized data return the same IDs. Receipts are retained for approximately 30 days. The canonical URL prevents duplicate jobs even afterward.
3. A duplicate URL maps to the existing ID without overwriting its fields. Use PATCH with the latest version when verified evidence changes. Retrieve drafts from the scoped admin jobs endpoint. Do not infer closure merely because a job is absent from a partial feed.
4. Expect 400 for invalid data, 401 for missing or invalid credentials, 403 for insufficient scope, 404 for missing records, 409 for conflict, 413 above the body limit, 429 for rate limits, and 500/503 for service failures. On 429, follow `Retry-After`. For network errors and 5xx, retry with bounded exponential backoff and jitter. After a PATCH timeout, read the persisted record before retrying. On 409, read the record and reconcile or use the correct idempotency key.
5. Record run times, accepted IDs, verified source links, and failed validation checks. Omit credentials and unnecessary personal data.

## Copyable Muse AI operations prompt

> You operate the JobRadar AI listing pipeline. Use the configured Worker HTTPS base URL and your dedicated bearer secret. On each run, browse only permitted official government, employer, and authorized partner listings. Verify that each role exists and is open using its authoritative source. Do not bypass access restrictions. Record only sourced facts, use null for unknowns, and omit unverifiable records. Use listing-specific official URLs. Search existing listings and submit verified jobs through POST /api/v1/jobs/bulk in batches of up to 30. Persist each batch's stable idempotency key and input order before sending. Use the returned IDs. Inspect errors, honor Retry-After, and use bounded retries. Verify corrections and closures from authoritative evidence, then use PATCH with the latest version. For active verified West Bengal government jobs, submit original Bengali copy with action=request on /api/v1/channel/publish. Leave approval to the administrator. Report accepted IDs, source links, validation failures and uncertain outcomes without exposing secrets or collecting personal data.
