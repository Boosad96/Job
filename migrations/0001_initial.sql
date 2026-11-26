CREATE TABLE jobs (
  id TEXT PRIMARY KEY, identity TEXT NOT NULL UNIQUE, payload TEXT NOT NULL CHECK(json_valid(payload)),
  status TEXT GENERATED ALWAYS AS (json_extract(payload,'$.status')) STORED,
  deadline TEXT GENERATED ALWAYS AS (json_extract(payload,'$.applicationDeadline')) STORED,
  country TEXT GENERATED ALWAYS AS (json_extract(payload,'$.country')) STORED,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  visible_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  version INTEGER NOT NULL DEFAULT 1, actor TEXT NOT NULL
);
CREATE INDEX jobs_active ON jobs(status, country, created_at DESC, id DESC);
CREATE INDEX jobs_visibility ON jobs(status, visible_at, id);
CREATE INDEX jobs_deadline ON jobs(status, deadline);
CREATE INDEX jobs_recent ON jobs(status, created_at DESC, id DESC);
CREATE TABLE audit (id INTEGER PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, subject TEXT NOT NULL, at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TRIGGER job_created AFTER INSERT ON jobs BEGIN
  INSERT INTO audit(actor, action, subject) VALUES(NEW.actor, 'job.created', NEW.id);
END;
CREATE TRIGGER job_updated AFTER UPDATE ON jobs BEGIN
  INSERT INTO audit(actor, action, subject) VALUES(NEW.actor, 'job.updated', NEW.id);
END;
CREATE TABLE receipts (actor TEXT NOT NULL, key TEXT NOT NULL, digest TEXT NOT NULL, ids TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(actor,key));
CREATE TABLE users (
  id TEXT PRIMARY KEY, language TEXT NOT NULL DEFAULT 'en', filters TEXT NOT NULL DEFAULT '{}',
  search_token TEXT, qualification TEXT, referral TEXT UNIQUE, referred_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE saved_jobs (user_id TEXT REFERENCES users(id) ON DELETE CASCADE, job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE, PRIMARY KEY(user_id,job_id));
CREATE TABLE searches (
  id INTEGER PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, filters TEXT NOT NULL,
  cadence TEXT NOT NULL CHECK(cadence IN ('off','daily','instant')), cursor_time TEXT NOT NULL, cursor_id TEXT NOT NULL DEFAULT '',
  due INTEGER NOT NULL, UNIQUE(user_id,filters)
);
CREATE INDEX searches_due ON searches(cadence,due,id);
CREATE TABLE updates (id INTEGER PRIMARY KEY, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE publications (
  job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE, state TEXT NOT NULL CHECK(state IN ('pending','approved','sending','published','rejected')),
  text TEXT NOT NULL, job_version INTEGER NOT NULL, message_id INTEGER, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE source_health (name TEXT PRIMARY KEY, ok INTEGER NOT NULL, imported INTEGER NOT NULL, checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE operational_reports (day TEXT PRIMARY KEY, payload TEXT NOT NULL);
CREATE TABLE subscriptions (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, plan TEXT NOT NULL, valid_until TEXT NOT NULL);
