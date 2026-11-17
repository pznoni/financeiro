// db.js — acesso ao IndexedDB: abertura, migrações de schema, CRUD, dados padrão e backup.
// Wrapper pequeno escrito à mão, sem dependências.

const DB_NAME = 'financeiro';

/** Versão do schema. Para mudar a estrutura: incremente e adicione uma entrada em MIGRATIONS. */
export const SCHEMA_VERSION = 1;

/** Stores com dados do usuário (entram no backup). */
export const DATA_STORES = ['categories', 'accounts', 'cards', 'recurring', 'transactions'];

/**
 * Migrações: cada função leva o banco da versão (n - 1) para a versão n.
 * Rodam em sequência dentro da transação de upgrade; se qualquer uma falhar,
 * o IndexedDB desfaz tudo e o banco continua na versão anterior (seguro).
 */
const MIGRATIONS = {
  1(db) {
    db.createObjectStore('categories', { keyPath: 'id' });
    db.createObjectStore('accounts', { keyPath: 'id' });
    db.createObjectStore('cards', { keyPath: 'id' });
    db.createObjectStore('recurring', { keyPath: 'id' });
    db.createObjectStore('meta', { keyPath: 'key' });

    const tx = db.createObjectStore('transactions', { keyPath: 'id' });
    tx.createIndex('data', 'data');
    tx.createIndex('categoryId', 'categoryId');
    tx.createIndex('cardId', 'cardId');
    tx.createIndex('recurringId', 'recurringId');
    tx.createIndex('groupId', 'groupId');
  },
  // 2(db, tx) { tx.objectStore('transactions').createIndex('fatura', 'fatura'); },
};

// ---------- Dados padrão (primeira execução) ----------

const DEFAULT_CATEGORIES = [
  { id: 'cat-salario', nome: 'Salário', tipo: 'receita', cor: '#22c55e', icone: '💰' },
  { id: 'cat-outras-receitas', nome: 'Outras receitas', tipo: 'receita', cor: '#14b8a6', icone: '💵' },
  { id: 'cat-alimentacao', nome: 'Alimentação', tipo: 'despesa', cor: '#f97316', icone: '🍽️' },
  { id: 'cat-moradia', nome: 'Moradia', tipo: 'despesa', cor: '#3b82f6', icone: '🏠' },
  { id: 'cat-transporte', nome: 'Transporte', tipo: 'despesa', cor: '#eab308', icone: '🚗' },
  { id: 'cat-saude', nome: 'Saúde', tipo: 'despesa', cor: '#ef4444', icone: '🩺' },
  { id: 'cat-lazer', nome: 'Lazer', tipo: 'despesa', cor: '#a855f7', icone: '🎉' },
  { id: 'cat-educacao', nome: 'Educação', tipo: 'despesa', cor: '#06b6d4', icone: '📚' },
  { id: 'cat-assinaturas', nome: 'Assinaturas', tipo: 'despesa', cor: '#ec4899', icone: '📺' },
  { id: 'cat-outros', nome: 'Outros', tipo: 'despesa', cor: '#94a3b8', icone: '📦' },
];

const DEFAULT_ACCOUNTS = [
  { id: 'acc-corrente', nome: 'Conta corrente', saldoInicial: 0 },
  { id: 'acc-carteira', nome: 'Carteira', saldoInicial: 0 },
];

// ---------- Erros amigáveis ----------

const MESSAGES = {
  QuotaExceededError: 'Sem espaço para salvar. Libere espaço no iPhone e tente de novo.',
  ConstraintError: 'Já existe um registro com esse identificador.',
  DataError: 'Dados inválidos para salvar.',
  DataCloneError: 'Dados inválidos para salvar.',
  VersionError: 'Os dados são de uma versão mais nova do app. Atualize o app.',
  AbortError: 'A operação foi cancelada. Tente novamente.',
  InvalidStateError: 'A conexão com o banco de dados foi perdida. Tente novamente.',
  TransactionInactiveError: 'A operação expirou. Tente novamente.',
  UnknownError: 'Erro inesperado no armazenamento. Feche e abra o app.',
  NotFoundError: 'Registro não encontrado.',
};

/** Converte erros do IndexedDB em mensagens em português (preserva o erro original em `cause`). */
export function friendlyError(err) {
  if (err?.friendly) return err;
  const e = new Error(MESSAGES[err?.name] || err?.message || 'Erro ao acessar os dados.');
  e.friendly = true;
  e.cause = err;
  return e;
}

// ---------- Conexão ----------

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(friendlyError(new Error('Este navegador não permite salvar dados (IndexedDB indisponível).')));
      return;
    }
    const req = indexedDB.open(DB_NAME, SCHEMA_VERSION);

    req.onupgradeneeded = (ev) => {
      const db = req.result;
      for (let v = ev.oldVersion + 1; v <= SCHEMA_VERSION; v++) {
        MIGRATIONS[v]?.(db, req.transaction);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // Outra aba abriu uma versão mais nova: fecha para não bloquear a migração.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
        document.dispatchEvent(new CustomEvent('db-versionchange'));
      };
      // O iOS pode encerrar a conexão com o app em segundo plano.
      db.onclose = () => { dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(friendlyError(req.error));
    };
    req.onblocked = () => document.dispatchEvent(new CustomEvent('db-blocked'));
  });
  return dbPromise;
}

/** Promessa para um IDBRequest. */
export function req2p(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Avisa a interface que os dados mudaram (ela se redesenha). */
export function emitChange() {
  document.dispatchEvent(new CustomEvent('data-changed'));
}

/**
 * Executa `fn(stores, tx)` numa transação. Resolve com o retorno de `fn` quando a transação
 * completa; se `fn` lançar erro, a transação é abortada (nada é gravado).
 * Dentro de `fn`, só aguarde (await) requisições do próprio IndexedDB.
 */
export async function withTx(storeNames, mode, fn, { silent = false } = {}, retry = true) {
  const names = [].concat(storeNames);
  const db = await openDB();
  let tx;
  try {
    tx = db.transaction(names, mode);
  } catch (err) {
    // Conexão encerrada pelo sistema: reabre uma vez.
    if (retry && err.name === 'InvalidStateError') {
      dbPromise = null;
      return withTx(storeNames, mode, fn, { silent }, false);
    }
    throw friendlyError(err);
  }

  return new Promise((resolve, reject) => {
    let result;
    let failure = null;
    tx.oncomplete = () => {
      if (mode === 'readwrite' && !silent) emitChange();
      resolve(result);
    };
    tx.onabort = () => reject(friendlyError(failure || tx.error));

    const stores = Object.fromEntries(names.map((n) => [n, tx.objectStore(n)]));
    try {
      Promise.resolve(fn(stores, tx)).then(
        (r) => { result = r; },
        (err) => { failure = err; try { tx.abort(); } catch { /* já finalizada */ } },
      );
    } catch (err) {
      failure = err;
      tx.abort();
    }
  });
}

// ---------- CRUD simples ----------

export function getAll(store) {
  return withTx(store, 'readonly', (s) => req2p(s[store].getAll()));
}

export function get(store, id) {
  return withTx(store, 'readonly', (s) => req2p(s[store].get(id)));
}

export function getByIndex(store, index, query) {
  return withTx(store, 'readonly', (s) => req2p(s[store].index(index).getAll(query)));
}

export function put(store, obj) {
  return withTx(store, 'readwrite', (s) => { s[store].put(obj); return obj; });
}

export function putMany(store, list) {
  return withTx(store, 'readwrite', (s) => { list.forEach((o) => s[store].put(o)); return list; });
}

export function remove(store, id) {
  return withTx(store, 'readwrite', (s) => { s[store].delete(id); });
}

export async function metaGet(key) {
  const rec = await get('meta', key);
  return rec?.value;
}

export function metaSet(key, value, opts) {
  return withTx('meta', 'readwrite', (s) => { s.meta.put({ key, value }); }, opts);
}

/** Lê todas as stores de dados numa única transação (visão consistente). */
export function readAll() {
  return withTx(DATA_STORES, 'readonly', async (s) => {
    const lists = await Promise.all(DATA_STORES.map((n) => req2p(s[n].getAll())));
    return Object.fromEntries(DATA_STORES.map((n, i) => [n, lists[i]]));
  });
}

// ---------- Primeira execução ----------

/** Cria categorias e contas padrão uma única vez. */
export async function ensureSeed() {
  if (await metaGet('seeded')) return false;
  await withTx(['categories', 'accounts', 'meta'], 'readwrite', (s) => {
    DEFAULT_CATEGORIES.forEach((c) => s.categories.put(c));
    DEFAULT_ACCOUNTS.forEach((a) => s.accounts.put(a));
    s.meta.put({ key: 'seeded', value: true });
    s.meta.put({ key: 'schemaVersion', value: SCHEMA_VERSION });
  }, { silent: true });
  return true;
}

// ---------- Backup ----------

export async function exportData() {
  return {
    app: 'financeiro',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    data: await readAll(),
  };
}

/**
 * Grava dados já validados. mode = 'replace' apaga tudo antes; 'merge' sobrescreve
 * apenas registros com o mesmo id e mantém o resto. Tudo numa transação: ou entra tudo ou nada.
 */
export function importData(data, mode) {
  return withTx([...DATA_STORES, 'meta'], 'readwrite', (s) => {
    for (const name of DATA_STORES) {
      if (mode === 'replace') s[name].clear();
      (data[name] || []).forEach((item) => s[name].put(item));
    }
    s.meta.put({ key: 'seeded', value: true });
  });
}

/** Apaga absolutamente tudo (inclusive meta). */
export function clearAll() {
  return withTx([...DATA_STORES, 'meta'], 'readwrite', (s) => {
    [...DATA_STORES, 'meta'].forEach((n) => s[n].clear());
  });
}
