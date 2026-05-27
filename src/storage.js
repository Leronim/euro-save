'use strict';

const fs = require('node:fs');
const path = require('node:path');

function createJsonStore(filePath) {
  const resolvedPath = path.resolve(filePath);
  ensureStoreFile(resolvedPath);

  return {
    path: resolvedPath,
    read() {
      return readJson(resolvedPath);
    },
    write(data) {
      fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
      fs.writeFileSync(resolvedPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    },
    update(updater) {
      const current = readJson(resolvedPath);
      const next = updater(current);
      this.write(next);
      return next;
    },
  };
}

function ensureStoreFile(filePath) {
  if (fs.existsSync(filePath)) return;

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(createEmptyStore(), null, 2)}\n`, 'utf8');
}

function readJson(filePath) {
  try {
    return { ...createEmptyStore(), ...JSON.parse(fs.readFileSync(filePath, 'utf8')) };
  } catch (error) {
    if (error.code === 'ENOENT') return createEmptyStore();
    throw error;
  }
}

function createEmptyStore() {
  return {
    incomingBankMessages: [],
    pendingExpenses: [],
    savedExpenses: [],
    ignoredExpenses: [],
  };
}

module.exports = {
  createEmptyStore,
  createJsonStore,
};
