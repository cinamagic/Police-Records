import { openDatabase } from '../src/database.js';

const db = openDatabase();
const applied = db.applyMigrations();
console.log(applied.length ? `Applied migrations: ${applied.join(', ')}` : 'No pending migrations.');
db.close();
