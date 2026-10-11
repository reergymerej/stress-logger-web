// The deployed site's API URL, read from config.js, so it's written down in one place.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const config = readFileSync(join(import.meta.dirname, '..', 'config.js'), 'utf8');
const match = config.match(/const API_URL = '([^']+)';/);
if (!match) throw new Error("config.js doesn't set API_URL");
export const API_URL = match[1];
