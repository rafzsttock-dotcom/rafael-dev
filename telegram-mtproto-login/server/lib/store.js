"use strict";

/**
 * Minimal local JSON-file store for saved sessions.
 *
 * Single user, single file, no network DB. The StringSession value
 * itself is always encrypted (see crypto.js) before it touches disk.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

class SessionStore {
  constructor(filePath) {
    this.filePath = filePath;
    this._ensureFile();
  }

  _ensureFile() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, JSON.stringify({ sessions: [] }, null, 2));
    }
  }

  _read() {
    try {
      return JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    } catch {
      return { sessions: [] };
    }
  }

  _write(data) {
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
  }

  list() {
    return this._read().sessions.map(({ encryptedSession, ...rest }) => rest);
  }

  get(id) {
    return this._read().sessions.find((s) => s.id === id) || null;
  }

  add({ label, maskedPhone, encryptedSession }) {
    const data = this._read();
    const entry = {
      id: crypto.randomUUID(),
      label: label || maskedPhone || "akun",
      maskedPhone,
      encryptedSession,
      createdAt: new Date().toISOString(),
    };
    data.sessions.push(entry);
    this._write(data);
    const { encryptedSession: _omit, ...pub } = entry;
    return pub;
  }

  remove(id) {
    const data = this._read();
    const before = data.sessions.length;
    data.sessions = data.sessions.filter((s) => s.id !== id);
    this._write(data);
    return data.sessions.length < before;
  }
}

module.exports = { SessionStore };
