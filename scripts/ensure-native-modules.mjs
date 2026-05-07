#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const nativeModules = [
  {
    name: 'better-sqlite3',
    probe() {
      const Database = require('better-sqlite3');
      const db = new Database(':memory:');
      db.close();
    },
  },
  {
    name: 'sharp',
    probe() {
      require('sharp');
    },
  },
];

function needsRebuild(error) {
  const message = String(error?.message ?? error);
  return error?.code === 'ERR_DLOPEN_FAILED' || message.includes('NODE_MODULE_VERSION');
}

const modulesToRebuild = [];

for (const nativeModule of nativeModules) {
  try {
    nativeModule.probe();
  } catch (error) {
    if (!needsRebuild(error)) {
      throw error;
    }

    console.warn(
      `Native module ${nativeModule.name} is not compatible with Node ${process.version}; rebuilding before start.`,
    );
    modulesToRebuild.push(nativeModule.name);
  }
}

if (modulesToRebuild.length > 0) {
  const result = spawnSync('npm', ['rebuild', ...modulesToRebuild], {
    stdio: 'inherit',
    env: process.env,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
