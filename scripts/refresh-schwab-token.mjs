import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const envPath = path.join(root, '.env.local');
const tokenUrl = 'https://api.schwabapi.com/v1/oauth/token';
const args = new Set(process.argv.slice(2));

const env = {
  ...readEnvFile(path.join(root, '.env')),
  ...readEnvFile(envPath),
  ...process.env,
};

const clientId = requireEnv('SCHWAB_CLIENT_ID');
const clientSecret = requireEnv('SCHWAB_CLIENT_SECRET');
const currentRefreshToken = requireEnv('SCHWAB_REFRESH_TOKEN');

const response = await fetch(tokenUrl, {
  method: 'POST',
  headers: {
    Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  },
  body: new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: currentRefreshToken,
  }),
});

const text = await response.text();
if (!response.ok) {
  console.error(JSON.stringify({
    ok: false,
    status: response.status,
    message: sanitizeForLog(text),
    action: 'Run the Schwab OAuth login flow again and save the new SCHWAB_REFRESH_TOKEN.',
  }, null, 2));
  process.exit(1);
}

const token = JSON.parse(text);
const nextRefreshToken = typeof token.refresh_token === 'string' && token.refresh_token.trim()
  ? token.refresh_token.trim()
  : null;
const refreshTokenChanged = !!nextRefreshToken && nextRefreshToken !== currentRefreshToken;

if (nextRefreshToken && args.has('--write-env')) {
  writeEnvValue(envPath, 'SCHWAB_REFRESH_TOKEN', nextRefreshToken);
}

if (nextRefreshToken && args.has('--wrangler-secret')) {
  putWranglerSecret(nextRefreshToken);
}

console.log(JSON.stringify({
  ok: true,
  accessTokenExpiresIn: token.expires_in ?? null,
  refreshTokenReturned: !!nextRefreshToken,
  refreshTokenChanged,
  envUpdated: !!nextRefreshToken && args.has('--write-env'),
  workerSecretUpdated: !!nextRefreshToken && args.has('--wrangler-secret'),
  note: nextRefreshToken
    ? 'A refresh token was returned. Keep this script scheduled before the token expires.'
    : 'No new refresh token was returned. If Schwab enforces a fixed refresh-token lifetime, periodic access-token refresh cannot avoid manual OAuth.',
}, null, 2));

function requireEnv(key) {
  const value = env[key]?.trim();
  if (!value) {
    console.error(`${key} is required. Set it in .env.local or the process environment.`);
    process.exit(1);
  }
  return value;
}

function readEnvFile(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
    if (!match || line.trimStart().startsWith('#')) continue;
    out[match[1]] = unquote(match[2].trim());
  }
  return out;
}

function writeEnvValue(file, key, value) {
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/) : [];
  const next = `${key}=${quoteEnvValue(value)}`;
  let replaced = false;
  const updated = lines.map((line) => {
    if (line.match(new RegExp(`^\\s*${key}=`))) {
      replaced = true;
      return next;
    }
    return line;
  });
  if (!replaced) updated.push(next);
  writeFileSync(file, updated.join('\n').replace(/\n*$/, '\n'));
}

function putWranglerSecret(value) {
  const result = spawnSync('npx', ['wrangler', 'secret', 'put', 'SCHWAB_REFRESH_TOKEN'], {
    cwd: path.join(root, 'workers/quote'),
    input: `${value}\n`,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    console.error(sanitizeForLog(result.stderr || result.stdout));
    process.exit(result.status ?? 1);
  }
}

function unquote(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function quoteEnvValue(value) {
  return /^[A-Za-z0-9._~+/=-]+$/.test(value) ? value : JSON.stringify(value);
}

function sanitizeForLog(value) {
  return String(value)
    .replace(/(client_secret=)[^&\s]+/gi, '$1[redacted]')
    .replace(/(access_token=)[^&\s]+/gi, '$1[redacted]')
    .replace(/(refresh_token=)[^&\s]+/gi, '$1[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]');
}
