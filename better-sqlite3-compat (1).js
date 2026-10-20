// better-sqlite3-compat.js
// Tiny drop-in replacement for the parts of "better-sqlite3" that index.js uses,
// built on Node's built-in node:sqlite (Node 22+). No native compilation needed.
const { DatabaseSync } = require('node:sqlite');

function clean(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}
function cleanAll(args) { return args.map(clean); }

class Statement {
  constructor(stmt) { this._s = stmt; }
  run(...a) {
    const r = this._s.run(...cleanAll(a));
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }
  get(...a) { return this._s.get(...cleanAll(a)); }
  all(...a) { return this._s.all(...cleanAll(a)); }
}

class Database {
  constructor(file, _opts) { this._db = new DatabaseSync(file); this._depth = 0; }
  prepare(sql) { return new Statement(this._db.prepare(sql)); }
  exec(sql) { this._db.exec(sql); return this; }
  pragma(str) { try { return this._db.prepare('PRAGMA ' + str).all(); } catch (_) { return []; } }
  close() { try { this._db.close(); } catch (_) {} }
  // db.transaction(fn) -> function that runs fn inside BEGIN/COMMIT (nested calls reuse the outer transaction)
  transaction(fn) {
    const self = this;
    return function (...args) {
      if (self._depth > 0) return fn.apply(this, args);
      self._db.exec('BEGIN');
      self._depth++;
      try {
        const out = fn.apply(this, args);
        self._db.exec('COMMIT');
        return out;
      } catch (e) {
        try { self._db.exec('ROLLBACK'); } catch (_) {}
        throw e;
      } finally { self._depth--; }
    };
  }
}

module.exports = Database;
