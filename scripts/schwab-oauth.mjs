import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const envPath = path.join(root, '.env.local');
const authUrl = 'https://api.schwabapi.com/v1/oauth/authorize';
const tokenUrl = 'https://api.schwabapi.com/v1/oauth/token';
const args = new Set(process.argv.slice(2));
const timeoutMs = 10 * 60 * 1000;

const env = {
  ...readEnvFile(path.join(root, '.env')),
  ...readEnvFile(envPath),
  ...process.env,
};

const clientId = requireEnv('SCHWAB_CLIENT_ID');
const clientSecret = requireEnv('SCHWAB_CLIENT_SECRET');
const redirectUri = env.SCHWAB_REDIRECT_URI?.trim() || 'http://localhost:8787/api/schwab/oauth/callback';
const redirect = new URL(redirectUri);

if (!['localhost', '127.0.0.1'].includes(redirect.hostname)) {
  console.error(`SCHWAB_REDIRECT_URI must point to localhost for this script to capture the callback. Current host: ${redirect.hostname}`);
  console.error('Use a Schwab Developer Portal callback like http://localhost:8787/api/schwab/oauth/callback, or use the Worker callback flow manually.');
  process.exit(1);
}

const state = randomBytes(16).toString('hex');
const authorize = new URL(authUrl);
authorize.search = new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: 'code',
  state,
}).toString();

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', redirect.origin);
    if (url.pathname !== redirect.pathname) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    if (url.searchParams.get('state') !== state) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('invalid OAuth state');
      return;
    }
    const code = url.searchParams.get('code');
    if (!code) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`missing code: ${url.searchParams.get('error_description') ?? url.searchParams.get('error') ?? 'unknown_error'}`);
      return;
    }

    const token = await exchangeCode(code);
    if (!token.refresh_token) throw new Error('Schwab token response did not include refresh_token');

    writeEnvValue(envPath, 'SCHWAB_REDIRECT_URI', redirectUri);
    writeEnvValue(envPath, 'SCHWAB_REFRESH_TOKEN', token.refresh_token);
    if (args.has('--wrangler-secrets')) {
      putWranglerSecrets({
        SCHWAB_CLIENT_ID: clientId,
        SCHWAB_CLIENT_SECRET: clientSecret,
        SCHWAB_REDIRECT_URI: redirectUri,
        SCHWAB_REFRESH_TOKEN: token.refresh_token,
      });
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><meta charset="utf-8"><title>Schwab OAuth complete</title><body>Schwab OAuth complete. You can close this tab.</body>');
    console.log(JSON.stringify({
      ok: true,
      envUpdated: true,
      workerSecretsUpdated: args.has('--wrangler-secrets'),
      accessTokenExpiresIn: token.expires_in ?? null,
      refreshTokenStored: true,
    }, null, 2));
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Schwab OAuth failed. Check the terminal output.');
    console.error(sanitizeForLog(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  } finally {
    setTimeout(() => server.close(), 250);
  }
});

server.listen(Number(redirect.port || 80), redirect.hostname, () => {
  console.log('Open this Schwab authorization URL in your browser:');
  console.log(authorize.toString());
  console.log(`Waiting for callback on ${redirect.origin}${redirect.pathname}`);
});

const timer = setTimeout(() => {
  console.error('Timed out waiting for Schwab OAuth callback.');
  server.close();
  process.exitCode = 1;
}, timeoutMs);
server.on('close', () => clearTimeout(timer));

async function exchangeCode(code) {
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`schwab_token_error ${response.status}: ${sanitizeForLog(text)}`);
  return JSON.parse(text);
}

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

function putWranglerSecrets(values) {
  for (const [key, value] of Object.entries(values)) {
    const result = spawnSync('npx', ['wrangler', 'secret', 'put', key], {
      cwd: path.join(root, 'workers/quote'),
      input: `${value}\n`,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (result.status !== 0) {
      throw new Error(sanitizeForLog(result.stderr || result.stdout));
    }
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
