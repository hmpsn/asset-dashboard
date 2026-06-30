import fs from 'fs';
import path from 'path';

const ENV_PATH = path.resolve(process.cwd(), '.env');

export function readEnvFile(): Record<string, string> {
  const vars: Record<string, string> = {};
  if (fs.existsSync(ENV_PATH)) {
    for (const line of fs.readFileSync(ENV_PATH, 'utf-8').split('\n')) {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) vars[match[1].trim()] = match[2].trim();
    }
  }
  return vars;
}

export function writeEnvFile(vars: Record<string, string>) {
  const content = Object.entries(vars).map(([k, v]) => `${k}=${v.replace(/[\r\n]/g, '')}`).join('\n') + '\n';
  fs.writeFileSync(ENV_PATH, content);
}
