CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'station',
  trust_level TEXT NOT NULL DEFAULT 'trusted',
  last_seen_at TEXT,
  last_exported_change_id INTEGER NOT NULL DEFAULT 0,
  last_imported_change_id INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY,
  crn TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  middle_name TEXT,
  last_name TEXT NOT NULL,
  date_of_birth TEXT,
  gender TEXT,
  nationality TEXT,
  national_id TEXT,
  fingerprint_id TEXT,
  photo_url TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  risk_level TEXT NOT NULL DEFAULT 'medium',
  address TEXT,
  notes TEXT,
  origin_device_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS aliases (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  alias_name TEXT NOT NULL,
  origin_device_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS charges (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  statute_code TEXT NOT NULL,
  offense TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'felony',
  charge_date TEXT NOT NULL,
  disposition TEXT NOT NULL DEFAULT 'pending',
  notes TEXT,
  origin_device_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  case_number TEXT NOT NULL,
  title TEXT NOT NULL,
  agency TEXT NOT NULL,
  lead_officer TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  summary TEXT,
  origin_device_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  case_id TEXT REFERENCES cases(id) ON DELETE SET NULL,
  tag TEXT NOT NULL,
  type TEXT NOT NULL,
  description TEXT NOT NULL,
  chain_of_custody TEXT NOT NULL,
  storage_location TEXT NOT NULL,
  origin_device_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS warrants (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  warrant_number TEXT NOT NULL,
  issuing_court TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  details TEXT,
  origin_device_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  role TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_table TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  ip_address TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS change_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  row_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  record_json TEXT NOT NULL,
  origin_device_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  changed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_records_search ON records(last_name, first_name, crn, national_id, fingerprint_id);
CREATE INDEX IF NOT EXISTS idx_records_status ON records(status, risk_level);
CREATE INDEX IF NOT EXISTS idx_charges_record ON charges(record_id);
CREATE INDEX IF NOT EXISTS idx_cases_record ON cases(record_id);
CREATE INDEX IF NOT EXISTS idx_evidence_record ON evidence(record_id);
CREATE INDEX IF NOT EXISTS idx_warrants_record ON warrants(record_id);
CREATE INDEX IF NOT EXISTS idx_change_log_id ON change_log(id);
