import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(rootDir, 'data');
const migrationsDir = path.join(rootDir, 'migrations');
const defaultDbPath = path.join(dataDir, 'crms.sqlite');
const trackedTables = new Set(['records', 'aliases', 'charges', 'cases', 'evidence', 'warrants']);

export function now() {
  return new Date().toISOString();
}

export function openDatabase(filePath = process.env.CRMS_DB_PATH || defaultDbPath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const sqlite = new DatabaseSync(filePath);
  sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  return new CrmsDatabase(sqlite);
}

export class CrmsDatabase {
  constructor(sqlite) {
    this.sqlite = sqlite;
  }

  close() {
    this.sqlite.close();
  }

  applyMigrations() {
    this.sqlite.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
    const appliedRows = this.sqlite.prepare('SELECT id FROM schema_migrations').all();
    const applied = new Set(appliedRows.map((row) => row.id));
    const files = fs.readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort();
    const newlyApplied = [];

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      this.sqlite.exec('BEGIN');
      try {
        this.sqlite.exec(sql);
        this.sqlite.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(file, now());
        this.sqlite.exec('COMMIT');
        newlyApplied.push(file);
      } catch (error) {
        this.sqlite.exec('ROLLBACK');
        throw error;
      }
    }

    return newlyApplied;
  }

  bootstrap() {
    const existingDevice = this.sqlite.prepare('SELECT id FROM devices WHERE id = ?').get('station-main');
    const timestamp = now();
    if (!existingDevice) {
      this.sqlite.prepare(`
        INSERT INTO devices (id, name, type, trust_level, last_seen_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('station-main', 'Main Station Server', 'station', 'trusted', timestamp, timestamp, timestamp);
    }

    const count = this.sqlite.prepare('SELECT COUNT(*) AS count FROM records').get().count;
    if (count === 0) {
      this.seed();
    }
  }

  seed() {
    const actor = { user: 'system-seed', role: 'administrator', device: 'station-main', ip: '127.0.0.1' };
    const recordA = this.createRecord({
      first_name: 'Musa',
      middle_name: 'A.',
      last_name: 'Kamara',
      date_of_birth: '1989-02-14',
      gender: 'Male',
      nationality: 'Sierra Leonean',
      national_id: 'SL-43019-882',
      fingerprint_id: 'FP-FRT-002918',
      status: 'active',
      risk_level: 'high',
      address: 'East End, Freetown',
      notes: 'Known associate in vehicle theft network. Verify warrant status before field contact.',
      aliases: ['Black Musa', 'M.K. North']
    }, actor);
    this.createChild('charges', recordA.id, {
      statute_code: 'SL-PC-19.42',
      offense: 'Armed robbery',
      severity: 'felony',
      charge_date: '2025-11-03',
      disposition: 'pending',
      notes: 'Linked to Kingtom warehouse incident.'
    }, actor);
    const caseA = this.createChild('cases', recordA.id, {
      case_number: 'FCP-2026-0041',
      title: 'Kingtom Warehouse Robbery',
      agency: 'Freetown Central Police',
      lead_officer: 'Inspector Conteh',
      opened_at: '2026-01-08',
      status: 'open',
      summary: 'Suspect identified by two witnesses and matching vehicle plate intelligence.'
    }, actor);
    this.createChild('evidence', recordA.id, {
      case_id: caseA.id,
      tag: 'EVD-0041-A',
      type: 'CCTV',
      description: 'Exterior camera clip from south gate.',
      chain_of_custody: 'Collected by Sgt. Bangura; logged at central evidence room.',
      storage_location: 'Locker C-12'
    }, actor);
    this.createChild('warrants', recordA.id, {
      warrant_number: 'WRN-FRT-26019',
      issuing_court: 'Freetown Magistrate Court No. 2',
      issued_at: '2026-02-02',
      expires_at: '2026-12-31',
      status: 'active',
      details: 'Arrest warrant for failure to appear.'
    }, actor);

    const recordB = this.createRecord({
      first_name: 'Adama',
      last_name: 'Sesay',
      date_of_birth: '1995-07-20',
      gender: 'Female',
      nationality: 'Sierra Leonean',
      national_id: 'SL-90811-221',
      fingerprint_id: 'FP-BO-000774',
      status: 'monitored',
      risk_level: 'medium',
      address: 'Bo District',
      notes: 'Prior fraud conviction; monitor cross-district complaints.',
      aliases: ['Ada S.']
    }, actor);
    this.createChild('charges', recordB.id, {
      statute_code: 'SL-PC-41.08',
      offense: 'Identity fraud',
      severity: 'misdemeanor',
      charge_date: '2024-09-18',
      disposition: 'convicted',
      notes: 'Restitution order completed.'
    }, actor);
  }

  listRecords(filters = {}) {
    const where = ['deleted_at IS NULL'];
    const params = [];
    if (filters.search) {
      const query = `%${filters.search.toLowerCase()}%`;
      where.push(`(
        lower(crn) LIKE ? OR lower(first_name) LIKE ? OR lower(last_name) LIKE ? OR
        lower(COALESCE(national_id, '')) LIKE ? OR lower(COALESCE(fingerprint_id, '')) LIKE ?
      )`);
      params.push(query, query, query, query, query);
    }
    if (filters.status && filters.status !== 'all') {
      where.push('status = ?');
      params.push(filters.status);
    }
    if (filters.risk && filters.risk !== 'all') {
      where.push('risk_level = ?');
      params.push(filters.risk);
    }

    return this.sqlite.prepare(`
      SELECT
        r.*,
        (SELECT COUNT(*) FROM charges c WHERE c.record_id = r.id AND c.deleted_at IS NULL) AS charge_count,
        (SELECT COUNT(*) FROM cases ca WHERE ca.record_id = r.id AND ca.deleted_at IS NULL AND ca.status != 'closed') AS open_case_count,
        (SELECT COUNT(*) FROM warrants w WHERE w.record_id = r.id AND w.deleted_at IS NULL AND w.status = 'active') AS active_warrant_count
      FROM records r
      WHERE ${where.join(' AND ')}
      ORDER BY r.updated_at DESC
      LIMIT 250
    `).all(...params);
  }

  getRecord(id) {
    const record = this.sqlite.prepare('SELECT * FROM records WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!record) return null;
    return {
      ...record,
      aliases: this.sqlite.prepare('SELECT * FROM aliases WHERE record_id = ? AND deleted_at IS NULL ORDER BY alias_name').all(id),
      charges: this.sqlite.prepare('SELECT * FROM charges WHERE record_id = ? AND deleted_at IS NULL ORDER BY charge_date DESC').all(id),
      cases: this.sqlite.prepare('SELECT * FROM cases WHERE record_id = ? AND deleted_at IS NULL ORDER BY opened_at DESC').all(id),
      evidence: this.sqlite.prepare('SELECT * FROM evidence WHERE record_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC').all(id),
      warrants: this.sqlite.prepare('SELECT * FROM warrants WHERE record_id = ? AND deleted_at IS NULL ORDER BY issued_at DESC').all(id),
      audit: this.sqlite.prepare('SELECT * FROM audit_log WHERE entity_id = ? ORDER BY id DESC LIMIT 25').all(id)
    };
  }

  createRecord(input, actor) {
    const timestamp = now();
    const id = input.id || randomUUID();
    const crn = input.crn || `CRN-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 899999)}`;
    const record = {
      id,
      crn,
      first_name: required(input.first_name, 'first_name'),
      middle_name: input.middle_name || '',
      last_name: required(input.last_name, 'last_name'),
      date_of_birth: input.date_of_birth || '',
      gender: input.gender || '',
      nationality: input.nationality || '',
      national_id: input.national_id || '',
      fingerprint_id: input.fingerprint_id || '',
      photo_url: input.photo_url || '',
      status: input.status || 'active',
      risk_level: input.risk_level || 'medium',
      address: input.address || '',
      notes: input.notes || '',
      origin_device_id: actor.device,
      version: input.version || 1,
      created_at: input.created_at || timestamp,
      updated_at: input.updated_at || timestamp,
      deleted_at: input.deleted_at || null
    };

    this.sqlite.prepare(`
      INSERT INTO records (
        id, crn, first_name, middle_name, last_name, date_of_birth, gender, nationality,
        national_id, fingerprint_id, photo_url, status, risk_level, address, notes,
        origin_device_id, version, created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(...recordValues(record));
    this.recordChange('records', id, 'insert', actor);
    this.audit(actor, 'create', 'records', id, { crn });

    for (const alias of input.aliases || []) {
      if (String(alias).trim()) {
        this.createChild('aliases', id, { alias_name: String(alias).trim() }, actor);
      }
    }
    return this.getRecord(id);
  }

  updateRecord(id, input, actor) {
    const current = this.sqlite.prepare('SELECT * FROM records WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!current) return null;
    const updated = { ...current, ...input, id, version: current.version + 1, updated_at: now() };
    this.sqlite.prepare(`
      UPDATE records SET
        crn = ?, first_name = ?, middle_name = ?, last_name = ?, date_of_birth = ?, gender = ?,
        nationality = ?, national_id = ?, fingerprint_id = ?, photo_url = ?, status = ?,
        risk_level = ?, address = ?, notes = ?, version = ?, updated_at = ?, deleted_at = ?
      WHERE id = ?
    `).run(
      updated.crn, updated.first_name, updated.middle_name || '', updated.last_name, updated.date_of_birth || '',
      updated.gender || '', updated.nationality || '', updated.national_id || '', updated.fingerprint_id || '',
      updated.photo_url || '', updated.status, updated.risk_level, updated.address || '', updated.notes || '',
      updated.version, updated.updated_at, updated.deleted_at || null, id
    );
    this.recordChange('records', id, 'update', actor);
    this.audit(actor, 'update', 'records', id, { fields: Object.keys(input) });
    return this.getRecord(id);
  }

  deleteRecord(id, actor) {
    const current = this.sqlite.prepare('SELECT * FROM records WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!current) return false;
    this.sqlite.prepare('UPDATE records SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(now(), now(), id);
    this.recordChange('records', id, 'delete', actor);
    this.audit(actor, 'delete', 'records', id, {});
    return true;
  }

  createChild(table, recordId, input, actor) {
    if (!trackedTables.has(table) || table === 'records') throw new Error(`Unsupported table: ${table}`);
    const timestamp = now();
    const id = input.id || randomUUID();
    let insert;
    if (table === 'aliases') {
      insert = {
        sql: 'INSERT INTO aliases (id, record_id, alias_name, origin_device_id, version, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        values: [id, recordId, required(input.alias_name, 'alias_name'), actor.device, input.version || 1, input.created_at || timestamp, input.updated_at || timestamp, input.deleted_at || null]
      };
    } else if (table === 'charges') {
      insert = {
        sql: 'INSERT INTO charges (id, record_id, statute_code, offense, severity, charge_date, disposition, notes, origin_device_id, version, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        values: [id, recordId, required(input.statute_code, 'statute_code'), required(input.offense, 'offense'), input.severity || 'felony', input.charge_date || timestamp.slice(0, 10), input.disposition || 'pending', input.notes || '', actor.device, input.version || 1, input.created_at || timestamp, input.updated_at || timestamp, input.deleted_at || null]
      };
    } else if (table === 'cases') {
      insert = {
        sql: 'INSERT INTO cases (id, record_id, case_number, title, agency, lead_officer, opened_at, status, summary, origin_device_id, version, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        values: [id, recordId, required(input.case_number, 'case_number'), required(input.title, 'title'), input.agency || 'Unassigned', input.lead_officer || 'Unassigned', input.opened_at || timestamp.slice(0, 10), input.status || 'open', input.summary || '', actor.device, input.version || 1, input.created_at || timestamp, input.updated_at || timestamp, input.deleted_at || null]
      };
    } else if (table === 'evidence') {
      insert = {
        sql: 'INSERT INTO evidence (id, record_id, case_id, tag, type, description, chain_of_custody, storage_location, origin_device_id, version, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        values: [id, recordId, input.case_id || null, required(input.tag, 'tag'), input.type || 'document', required(input.description, 'description'), input.chain_of_custody || 'Pending intake', input.storage_location || 'Unassigned', actor.device, input.version || 1, input.created_at || timestamp, input.updated_at || timestamp, input.deleted_at || null]
      };
    } else if (table === 'warrants') {
      insert = {
        sql: 'INSERT INTO warrants (id, record_id, warrant_number, issuing_court, issued_at, expires_at, status, details, origin_device_id, version, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        values: [id, recordId, required(input.warrant_number, 'warrant_number'), input.issuing_court || 'Unknown court', input.issued_at || timestamp.slice(0, 10), input.expires_at || '', input.status || 'active', input.details || '', actor.device, input.version || 1, input.created_at || timestamp, input.updated_at || timestamp, input.deleted_at || null]
      };
    }

    this.sqlite.prepare(insert.sql).run(...insert.values);
    this.sqlite.prepare('UPDATE records SET updated_at = ?, version = version + 1 WHERE id = ?').run(timestamp, recordId);
    this.recordChange(table, id, 'insert', actor);
    this.recordChange('records', recordId, 'update', actor);
    this.audit(actor, 'create', table, id, { record_id: recordId });
    return this.sqlite.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  }

  stats() {
    const scalar = (sql) => this.sqlite.prepare(sql).get().value;
    return {
      records: scalar('SELECT COUNT(*) AS value FROM records WHERE deleted_at IS NULL'),
      activeWarrants: scalar("SELECT COUNT(*) AS value FROM warrants WHERE deleted_at IS NULL AND status = 'active'"),
      openCases: scalar("SELECT COUNT(*) AS value FROM cases WHERE deleted_at IS NULL AND status != 'closed'"),
      highRisk: scalar("SELECT COUNT(*) AS value FROM records WHERE deleted_at IS NULL AND risk_level = 'high'"),
      changes: scalar('SELECT COUNT(*) AS value FROM change_log'),
      lastChangeId: scalar('SELECT COALESCE(MAX(id), 0) AS value FROM change_log')
    };
  }

  auditLog(limit = 100) {
    return this.sqlite.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit);
  }

  exportChanges(since = 0, deviceId = 'field-device') {
    const timestamp = now();
    this.touchDevice(deviceId, 'Field Device', 'field');
    const changes = this.sqlite.prepare('SELECT * FROM change_log WHERE id > ? ORDER BY id ASC LIMIT 1000').all(Number(since) || 0);
    const highWatermark = this.sqlite.prepare('SELECT COALESCE(MAX(id), 0) AS value FROM change_log').get().value;
    this.sqlite.prepare('UPDATE devices SET last_exported_change_id = ?, last_seen_at = ?, updated_at = ? WHERE id = ?').run(highWatermark, timestamp, timestamp, deviceId);
    return { device_id: deviceId, high_watermark: highWatermark, changes };
  }

  importChanges(payload, actor) {
    const deviceId = payload.device_id || actor.device || 'field-device';
    this.touchDevice(deviceId, payload.device_name || 'Field Device', 'field');
    const accepted = [];
    const skipped = [];
    for (const change of payload.changes || []) {
      try {
        const row = JSON.parse(change.record_json || '{}');
        const result = this.applyIncomingRow(change.table_name, change.operation, row, actor);
        (result.accepted ? accepted : skipped).push({ row_id: change.row_id, table_name: change.table_name, reason: result.reason });
      } catch (error) {
        skipped.push({ row_id: change.row_id, table_name: change.table_name, reason: error.message });
      }
    }
    const last = Math.max(0, ...accepted.map((item) => Number(item.row_id) || 0));
    this.sqlite.prepare('UPDATE devices SET last_imported_change_id = ?, last_seen_at = ?, updated_at = ? WHERE id = ?').run(last, now(), now(), deviceId);
    return { accepted, skipped };
  }

  applyIncomingRow(table, operation, row, actor) {
    if (!trackedTables.has(table)) return { accepted: false, reason: 'untracked-table' };
    const current = this.sqlite.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(row.id);
    if (current && String(current.updated_at) > String(row.updated_at)) {
      return { accepted: false, reason: 'local-newer' };
    }
    if (table === 'records') {
      const values = recordValues({ ...row, origin_device_id: row.origin_device_id || actor.device });
      this.sqlite.prepare(`
        INSERT INTO records (
          id, crn, first_name, middle_name, last_name, date_of_birth, gender, nationality,
          national_id, fingerprint_id, photo_url, status, risk_level, address, notes,
          origin_device_id, version, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          crn = excluded.crn, first_name = excluded.first_name, middle_name = excluded.middle_name,
          last_name = excluded.last_name, date_of_birth = excluded.date_of_birth, gender = excluded.gender,
          nationality = excluded.nationality, national_id = excluded.national_id, fingerprint_id = excluded.fingerprint_id,
          photo_url = excluded.photo_url, status = excluded.status, risk_level = excluded.risk_level,
          address = excluded.address, notes = excluded.notes, version = excluded.version,
          updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
      `).run(...values);
    } else {
      this.upsertChild(table, row, actor);
    }
    this.recordChange(table, row.id, operation || 'sync-upsert', actor);
    this.audit(actor, 'sync-import', table, row.id, { operation });
    return { accepted: true, reason: 'applied' };
  }

  upsertChild(table, row, actor) {
    const columnMap = {
      aliases: ['id', 'record_id', 'alias_name', 'origin_device_id', 'version', 'created_at', 'updated_at', 'deleted_at'],
      charges: ['id', 'record_id', 'statute_code', 'offense', 'severity', 'charge_date', 'disposition', 'notes', 'origin_device_id', 'version', 'created_at', 'updated_at', 'deleted_at'],
      cases: ['id', 'record_id', 'case_number', 'title', 'agency', 'lead_officer', 'opened_at', 'status', 'summary', 'origin_device_id', 'version', 'created_at', 'updated_at', 'deleted_at'],
      evidence: ['id', 'record_id', 'case_id', 'tag', 'type', 'description', 'chain_of_custody', 'storage_location', 'origin_device_id', 'version', 'created_at', 'updated_at', 'deleted_at'],
      warrants: ['id', 'record_id', 'warrant_number', 'issuing_court', 'issued_at', 'expires_at', 'status', 'details', 'origin_device_id', 'version', 'created_at', 'updated_at', 'deleted_at']
    };
    const columns = columnMap[table];
    const values = columns.map((column) => row[column] ?? (column === 'origin_device_id' ? actor.device : null));
    const updateColumns = columns.filter((column) => column !== 'id').map((column) => `${column} = excluded.${column}`).join(', ');
    this.sqlite.prepare(`
      INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})
      ON CONFLICT(id) DO UPDATE SET ${updateColumns}
    `).run(...values);
  }

  touchDevice(id, name, type) {
    const timestamp = now();
    this.sqlite.prepare(`
      INSERT INTO devices (id, name, type, trust_level, last_seen_at, created_at, updated_at)
      VALUES (?, ?, ?, 'trusted', ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, type = excluded.type, last_seen_at = excluded.last_seen_at, updated_at = excluded.updated_at
    `).run(id, name, type, timestamp, timestamp, timestamp);
  }

  devices() {
    return this.sqlite.prepare('SELECT * FROM devices ORDER BY updated_at DESC').all();
  }

  recordChange(table, id, operation, actor) {
    const row = this.sqlite.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
    if (!row) return;
    this.sqlite.prepare(`
      INSERT INTO change_log (table_name, row_id, operation, record_json, origin_device_id, actor, changed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(table, id, operation, JSON.stringify(row), actor.device, actor.user, now());
  }

  audit(actor, action, table, id, metadata) {
    this.sqlite.prepare(`
      INSERT INTO audit_log (actor, role, action, entity_table, entity_id, device_id, ip_address, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(actor.user, actor.role, action, table, id, actor.device, actor.ip || '', JSON.stringify(metadata || {}), now());
  }
}

function required(value, field) {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new Error(`${field} is required`);
  }
  return String(value).trim();
}

function recordValues(record) {
  return [
    record.id,
    record.crn,
    record.first_name,
    record.middle_name || '',
    record.last_name,
    record.date_of_birth || '',
    record.gender || '',
    record.nationality || '',
    record.national_id || '',
    record.fingerprint_id || '',
    record.photo_url || '',
    record.status || 'active',
    record.risk_level || 'medium',
    record.address || '',
    record.notes || '',
    record.origin_device_id,
    record.version || 1,
    record.created_at,
    record.updated_at,
    record.deleted_at || null
  ];
}
