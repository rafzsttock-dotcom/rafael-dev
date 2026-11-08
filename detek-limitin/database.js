const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

function cloneData(obj) {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj !== 'object') return obj;
    try {
        return JSON.parse(JSON.stringify(obj));
    } catch (e) {
        return { ...obj };
    }
}

function matchQuery(doc, query) {
    if (!query || Object.keys(query).length === 0) return true;

    for (const [key, val] of Object.entries(query)) {
        if (key === '$or' && Array.isArray(val)) {
            const anyMatch = val.some(subQ => matchQuery(doc, subQ));
            if (!anyMatch) return false;
            continue;
        }

        const docVal = doc[key];

        if (val !== null && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date)) {
            for (const [op, opVal] of Object.entries(val)) {
                if (op === '$ne') {
                    if (docVal === opVal) return false;
                } else if (op === '$gt') {
                    if (!(docVal > opVal)) return false;
                } else if (op === '$gte') {
                    const dTime = docVal instanceof Date ? docVal.getTime() : new Date(docVal).getTime();
                    const oTime = opVal instanceof Date ? opVal.getTime() : new Date(opVal).getTime();
                    if (isNaN(dTime) || isNaN(oTime)) {
                        if (!(docVal >= opVal)) return false;
                    } else {
                        if (!(dTime >= oTime)) return false;
                    }
                } else if (op === '$lt') {
                    if (!(docVal < opVal)) return false;
                } else if (op === '$lte') {
                    if (!(docVal <= opVal)) return false;
                } else if (op === '$in') {
                    if (!Array.isArray(opVal) || !opVal.includes(docVal)) return false;
                } else if (op === '$nin') {
                    if (Array.isArray(opVal) && opVal.includes(docVal)) return false;
                }
            }
        } else if (val instanceof Date) {
            const dTime = docVal instanceof Date ? docVal.getTime() : new Date(docVal).getTime();
            if (dTime !== val.getTime()) return false;
        } else {
            if (val === undefined) continue;
            if (docVal !== val && String(docVal) !== String(val)) {
                return false;
            }
        }
    }

    return true;
}

function applyUpdate(doc, update) {
    let modified = false;

    for (const [op, fields] of Object.entries(update)) {
        if (op === '$set') {
            for (const [k, v] of Object.entries(fields)) {
                doc[k] = cloneData(v);
                modified = true;
            }
        } else if (op === '$inc') {
            for (const [k, v] of Object.entries(fields)) {
                doc[k] = (Number(doc[k]) || 0) + Number(v);
                modified = true;
            }
        } else if (op === '$push') {
            for (const [k, v] of Object.entries(fields)) {
                if (!Array.isArray(doc[k])) doc[k] = [];
                doc[k].push(cloneData(v));
                modified = true;
            }
        } else if (op === '$unset') {
            for (const k of Object.keys(fields)) {
                delete doc[k];
                modified = true;
            }
        } else {
            doc[op] = cloneData(fields);
            modified = true;
        }
    }

    return modified;
}

class QueryCursor {
    constructor(collection, query) {
        this.collection = collection;
        this.query = query;
        this._sort = null;
        this._limit = null;
        this._select = null;
    }

    sort(s) {
        this._sort = s;
        return this;
    }

    limit(l) {
        this._limit = l;
        return this;
    }

    select(fields) {
        this._select = fields;
        return this;
    }

    lean() {
        return this;
    }

    then(resolve, reject) {
        try {
            const results = this.collection._executeFind(this.query, this._sort, this._limit, this._select);
            resolve(results);
        } catch (e) {
            reject(e);
        }
    }
}

class SingleQueryCursor {
    constructor(collection, query) {
        this.collection = collection;
        this.query = query;
        this._isLean = false;
    }

    lean() {
        this._isLean = true;
        return this;
    }

    then(resolve, reject) {
        try {
            const doc = this.collection._executeFindOne(this.query, this._isLean);
            resolve(doc);
        } catch (e) {
            reject(e);
        }
    }
}

class DocumentWrapper {
    constructor(collection, data) {
        Object.defineProperty(this, '_collection', {
            value: collection,
            enumerable: false,
            writable: true,
            configurable: true
        });
        Object.assign(this, cloneData(data));
    }

    async save() {
        return this._collection._saveDoc(this);
    }

    toObject() {
        return cloneData(this);
    }
}

class JsonCollection {
    constructor(name, filename, defaults, uniqueKey = null) {
        this.name = name;
        this.filePath = path.join(DATA_DIR, filename);
        this.defaults = defaults;
        this.uniqueKey = uniqueKey;
        this.docs = [];
        this.saveTimer = null;
        this.isDirty = false;

        this.load();
    }

    load() {
        try {
            if (fs.existsSync(this.filePath)) {
                const raw = fs.readFileSync(this.filePath, 'utf-8');
                if (raw.trim()) {
                    this.docs = JSON.parse(raw);
                } else {
                    this.docs = [];
                }
            } else {
                this.docs = [];
                this.persistSync();
            }
        } catch (err) {
            console.error(`[DB-JSON] Gagal memuat ${this.name}: ${err.message}`);
            this.docs = [];
        }
    }

    scheduleSave() {
        this.isDirty = true;
        if (this.saveTimer) return;
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null;
            this.persistSync();
        }, 50);
    }

    persistSync() {
        try {
            const tmpFile = `${this.filePath}.tmp.${Date.now()}`;
            fs.writeFileSync(tmpFile, JSON.stringify(this.docs, null, 2), 'utf-8');
            fs.renameSync(tmpFile, this.filePath);
            this.isDirty = false;
        } catch (err) {
            console.error(`[DB-JSON] Gagal menyimpan ${this.name}: ${err.message}`);
        }
    }

    _createInstance(data) {
        const fullData = { ...cloneData(this.defaults), ...cloneData(data) };
        return new DocumentWrapper(this, fullData);
    }

    _saveDoc(docInstance) {
        const plain = docInstance.toObject();
        let index = -1;

        if (this.uniqueKey && plain[this.uniqueKey] !== undefined) {
            index = this.docs.findIndex(d => String(d[this.uniqueKey]) === String(plain[this.uniqueKey]));
        }

        if (index >= 0) {
            this.docs[index] = plain;
        } else {
            this.docs.push(plain);
        }

        this.scheduleSave();
        return docInstance;
    }

    _executeFindOne(query, isLean = false) {
        const found = this.docs.find(d => matchQuery(d, query));
        if (!found) return null;
        if (isLean) return cloneData(found);
        return this._createInstance(found);
    }

    _executeFind(query, sortObj, limit, selectFields) {
        let matches = this.docs.filter(d => matchQuery(d, query)).map(d => cloneData(d));

        if (sortObj && typeof sortObj === 'object') {
            matches.sort((a, b) => {
                for (const [k, dir] of Object.entries(sortObj)) {
                    const valA = a[k] ?? 0;
                    const valB = b[k] ?? 0;
                    if (valA !== valB) {
                        const isDesc = dir === -1 || dir === 'desc';
                        return isDesc ? (valB > valA ? 1 : -1) : (valA > valB ? 1 : -1);
                    }
                }
                return 0;
            });
        }

        if (typeof limit === 'number' && limit > 0) {
            matches = matches.slice(0, limit);
        }

        if (selectFields && typeof selectFields === 'string') {
            const keys = selectFields.trim().split(/\s+/).filter(Boolean);
            if (keys.length > 0) {
                matches = matches.map(m => {
                    const projected = {};
                    for (const k of keys) {
                        if (m[k] !== undefined) projected[k] = m[k];
                    }
                    return projected;
                });
            }
        }

        return matches;
    }

    findOne(query) {
        return new SingleQueryCursor(this, query);
    }

    find(query = {}) {
        return new QueryCursor(this, query);
    }

    countDocuments(query = {}) {
        const count = this.docs.filter(d => matchQuery(d, query)).length;
        return {
            lean() { return this; },
            then(resolve) { resolve(count); }
        };
    }

    async updateOne(query, update) {
        const idx = this.docs.findIndex(d => matchQuery(d, query));
        if (idx === -1) return { matchedCount: 0, modifiedCount: 0 };
        const modified = applyUpdate(this.docs[idx], update);
        if (modified) this.scheduleSave();
        return { matchedCount: 1, modifiedCount: modified ? 1 : 0 };
    }

    async updateMany(query, update) {
        let count = 0;
        for (let i = 0; i < this.docs.length; i++) {
            if (matchQuery(this.docs[i], query)) {
                const mod = applyUpdate(this.docs[i], update);
                if (mod) count++;
            }
        }
        if (count > 0) this.scheduleSave();
        return { matchedCount: count, modifiedCount: count };
    }

    async findOneAndUpdate(query, update, options = {}) {
        let idx = this.docs.findIndex(d => matchQuery(d, query));
        if (idx === -1) {
            if (options.upsert) {
                const newObj = { ...cloneData(this.defaults) };
                for (const [k, v] of Object.entries(query)) {
                    if (!k.startsWith('$')) newObj[k] = v;
                }
                applyUpdate(newObj, update);
                this.docs.push(newObj);
                this.scheduleSave();
                return options.new ? cloneData(newObj) : null;
            }
            return null;
        }

        const oldDoc = cloneData(this.docs[idx]);
        const mod = applyUpdate(this.docs[idx], update);
        if (mod) this.scheduleSave();

        return options.new ? cloneData(this.docs[idx]) : oldDoc;
    }

    async deleteOne(query) {
        const idx = this.docs.findIndex(d => matchQuery(d, query));
        if (idx === -1) return { deletedCount: 0 };
        this.docs.splice(idx, 1);
        this.scheduleSave();
        return { deletedCount: 1 };
    }

    async deleteMany(query) {
        const initialLen = this.docs.length;
        this.docs = this.docs.filter(d => !matchQuery(d, query));
        const deleted = initialLen - this.docs.length;
        if (deleted > 0) this.scheduleSave();
        return { deletedCount: deleted };
    }
}

function createModel(collection) {
    function Model(data = {}) {
        return collection._createInstance(data);
    }

    Model.findOne = (q) => collection.findOne(q);
    Model.find = (q) => collection.find(q);
    Model.countDocuments = (q) => collection.countDocuments(q);
    Model.updateOne = (q, u) => collection.updateOne(q, u);
    Model.updateMany = (q, u) => collection.updateMany(q, u);
    Model.findOneAndUpdate = (q, u, o) => collection.findOneAndUpdate(q, u, o);
    Model.deleteOne = (q) => collection.deleteOne(q);
    Model.deleteMany = (q) => collection.deleteMany(q);
    Model._collection = collection;

    return Model;
}

// User Schema Defaults
const userDefaults = {
    userId: 0,
    username: '',
    firstName: '',
    limit: 5,
    lastReset: '',
    lastInteraction: 0,
    isBanned: false,
    totalChecked: 0,
    totalCekBio: 0,
    totalCekBioSessions: 0,
    totalDetect: 0,
    totalLimitin: 0,
    premium: false,
    premiumUntil: null,
    refCode: '',
    invitedBy: null,
    referralCount: 0,
    referralProgress: 0,
    referralBonusLimit: 0,
    apiKey: '',
    apiKeyCreatedAt: null,
    apiPlanId: '',
    apiPlanExpiry: null,
    apiUsage: null
};

// Setting Schema Defaults
const settingDefaults = {
    key: '',
    value: null
};

// Invoice Schema Defaults
const invoiceDefaults = {
    invoiceId: '',
    referenceId: '',
    merchantReferenceId: '',
    userId: 0,
    planId: '',
    planName: '',
    days: 0,
    amount: 0,
    payAmount: 0,
    uniqueCode: 0,
    qrisUrl: '',
    qrisString: '',
    checkoutUrl: '',
    status: 'PENDING',
    chatId: null,
    messageId: null,
    createdAt: null,
    expiredAt: null,
    paidAt: null
};

// RedeemCode Schema Defaults
const redeemCodeDefaults = {
    code: '',
    type: 'limit', // 'limit' | 'premium'
    amount: 0,
    maxUses: 1, // 0 = unlimited
    usedCount: 0,
    usedBy: [], // [{ userId, username, usedAt }]
    createdAt: null,
    createdBy: null
};

const userCollection = new JsonCollection('User', 'users.json', userDefaults, 'userId');
const settingCollection = new JsonCollection('Setting', 'settings.json', settingDefaults, 'key');
const invoiceCollection = new JsonCollection('Invoice', 'invoices.json', invoiceDefaults, 'invoiceId');
const redeemCollection = new JsonCollection('RedeemCode', 'redeems.json', redeemCodeDefaults, 'code');

const User = createModel(userCollection);
const Setting = createModel(settingCollection);
const Invoice = createModel(invoiceCollection);
const RedeemCode = createModel(redeemCollection);

// Ensure all dirty data is flushed on process termination
function flushAllSync() {
    userCollection.persistSync();
    settingCollection.persistSync();
    invoiceCollection.persistSync();
    redeemCollection.persistSync();
}

process.on('beforeExit', flushAllSync);
process.on('SIGINT', flushAllSync);
process.on('SIGTERM', flushAllSync);

module.exports = {
    User,
    Setting,
    Invoice,
    RedeemCode,
    flushAllSync
};
