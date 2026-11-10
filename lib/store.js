'use strict';
/* Records live in one SQLite file on the service's disk. Documents are JSON addressed by a path such as jobs/o123. */
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');

function isObj(v){ return !!v && typeof v === 'object' && !Array.isArray(v); }
/* nested objects merge, arrays and plain values replace: the same rule the screens were built on */
function merge(a, b){
  for (const k of Object.keys(b)){
    const v = b[k];
    if (v === undefined) continue;
    if (isObj(v) && isObj(a[k])) merge(a[k], v); else a[k] = isObj(v) ? merge({}, v) : v;
  }
  return a;
}
const SEG = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;
function splitPath(p){
  const parts = String(p || '').split('/');
  if (!parts.length || parts.some(s => !SEG.test(s) || s === '.' || s === '..')) return null;
  return parts;
}
function docPath(p){ const s = splitPath(p); return s && s.length % 2 === 0 ? {path:s.join('/'), coll:s.slice(0, -1).join('/'), id:s[s.length - 1]} : null; }
function collPath(p){ const s = splitPath(p); return s && s.length % 2 === 1 ? s.join('/') : null; }

function open(dataDir){
  fs.mkdirSync(path.join(dataDir, 'assets'), {recursive:true});
  const db = new DatabaseSync(path.join(dataDir, 'ifd.sqlite'));
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS docs(path TEXT PRIMARY KEY, coll TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, version INTEGER NOT NULL, updated TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS docs_coll ON docs(coll);
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT NOT NULL, mobile TEXT NOT NULL UNIQUE, role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS codes(mobile TEXT PRIMARY KEY, hash TEXT NOT NULL, expires INTEGER NOT NULL, tries INTEGER NOT NULL, sent INTEGER NOT NULL, win INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, user TEXT NOT NULL, expires INTEGER NOT NULL, created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit(n INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, user TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY, type TEXT NOT NULL, size INTEGER NOT NULL, by TEXT NOT NULL, at TEXT NOT NULL);`);
  const q = {
    get: db.prepare('SELECT json, version FROM docs WHERE path = ?'),
    put: db.prepare('INSERT INTO docs(path, coll, id, json, version, updated) VALUES(?, ?, ?, ?, 1, ?) ON CONFLICT(path) DO UPDATE SET json = excluded.json, version = docs.version + 1, updated = excluded.updated'),
    del: db.prepare('DELETE FROM docs WHERE path = ?'),
    list: db.prepare('SELECT id, json, version FROM docs WHERE coll = ? ORDER BY id'),
    audit: db.prepare('INSERT INTO audit(at, user, action, detail) VALUES(?, ?, ?, ?)')
  };
  const now = () => new Date().toISOString();
  const tx = fn => { db.exec('BEGIN IMMEDIATE'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e){ db.exec('ROLLBACK'); throw e; } };
  return {
    db, dataDir,
    getDoc(p){ const r = q.get.get(p); return r ? {exists:true, data:JSON.parse(r.json), version:r.version} : {exists:false}; },
    setDoc(d, data){ q.put.run(d.path, d.coll, d.id, JSON.stringify(data), now()); },
    /* read, merge and write inside one transaction, so two people saving at once cannot lose each other's change */
    updateDoc(d, patch){ return tx(() => { const r = q.get.get(d.path); if (!r) return false; q.put.run(d.path, d.coll, d.id, JSON.stringify(merge(JSON.parse(r.json), patch)), now()); return true; }); },
    deleteDoc(p){ q.del.run(p); },
    list(coll, order, dir, limit){
      let rows = q.list.all(coll).map(r => ({id:r.id, data:JSON.parse(r.json), version:r.version}));
      if (order) rows.sort((a, b) => String(a.data[order] == null ? '' : a.data[order]).localeCompare(String(b.data[order] == null ? '' : b.data[order])) * (dir === 'desc' ? -1 : 1));
      return limit > 0 ? rows.slice(0, limit) : rows;
    },
    newId(){ return crypto.randomBytes(10).toString('hex'); },
    audit(user, action, detail){ q.audit.run(now(), user || '', action, typeof detail === 'string' ? detail : JSON.stringify(detail || {})); },
    close(){ db.close(); }
  };
}
module.exports = { open, merge, docPath, collPath };
