import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/database.js';

function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crms-'));
  const db = openDatabase(path.join(dir, 'test.sqlite'));
  db.applyMigrations();
  db.bootstrap();
  return db;
}

test('creates searchable records and writes audit/change logs', () => {
  const db = tempDb();
  const actor = { user: 'tester', role: 'admin', device: 'station-main', ip: 'test' };
  const record = db.createRecord({
    first_name: 'Test',
    last_name: 'Subject',
    national_id: 'QA-123',
    fingerprint_id: 'FP-QA-123',
    aliases: ['Subject One']
  }, actor);

  const results = db.listRecords({ search: 'QA-123' });
  assert.equal(results.some((item) => item.id === record.id), true);
  assert.equal(db.auditLog().some((row) => row.entity_id === record.id && row.action === 'create'), true);
  assert.ok(db.stats().changes > 0);
  db.close();
});

test('exports changes and imports newer field-device updates', () => {
  const db = tempDb();
  const actor = { user: 'tester', role: 'admin', device: 'station-main', ip: 'test' };
  const record = db.createRecord({ first_name: 'Sync', last_name: 'Case' }, actor);
  const exported = db.exportChanges(0, 'tablet-alpha');
  assert.ok(exported.high_watermark >= 1);

  const row = db.getRecord(record.id);
  row.notes = 'Updated offline';
  row.updated_at = new Date(Date.now() + 1000).toISOString();
  const result = db.importChanges({
    device_id: 'tablet-alpha',
    changes: [{
      table_name: 'records',
      row_id: row.id,
      operation: 'update',
      record_json: JSON.stringify(row)
    }]
  }, { user: 'field-user', role: 'field-officer', device: 'tablet-alpha', ip: 'test' });

  assert.equal(result.accepted.length, 1);
  assert.equal(db.getRecord(record.id).notes, 'Updated offline');
  db.close();
});
