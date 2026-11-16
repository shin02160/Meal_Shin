import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { HttpError, required } from './errors';
import { isPublicHost, publicHost } from './public-host';

const derivePassword = promisify(scrypt);
export const publicOrigin = 'https://' + publicHost;
const siteSessionSeconds = 8 * 60 * 60;
const rateCounter = "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],300) end; return n";

export function isPublicRequest(request: Request) {
  return isPublicHost(request.headers.get('host') ?? '') || isPublicHost(new URL(request.url).host);
}

function siteVerifier() {
  const verifier = process.env.OWNER_PASSWORD_HASH;
  if (!verifier || !/^[a-f0-9]{32}:[a-f0-9]{64}$/.test(verifier)) {
    throw new HttpError(503, '접속 비밀번호 설정을 확인해 주세요.');
  }
  return verifier;
}

export const cookieName = 'meal_note_session';
const sessionSeconds = 28800;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export async function redis<T>(...command: (string | number)[]): Promise<T> {
  try {
    const response = await fetch(required('AUTH_STORE_URL'), {
      method: 'POST', headers: {Authorization: 'Bearer ' + required('AUTH_STORE_TOKEN'), 'Content-Type': 'application/json'},
      body: JSON.stringify(command), cache: 'no-store', signal: AbortSignal.timeout(5000),
    });
    const body = await response.json();
    if (!response.ok || body.error) throw new Error();
    return body.result;
  } catch {
    throw new HttpError(503, '접근 확인 또는 저장 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.');
  }
}

export function sessionKey(request: Request) {
  const token = request.headers.get('cookie')?.match(/(?:^|;\s*)meal_note_session=([^;]*)/)?.[1];
  return token && tokenPattern.test(token) ? 'meal:session:' + digest(token) : null;
}

export async function authenticate(request: Request) {
  const key = sessionKey(request);
  if (isPublicRequest(request)) {
    if (!key) throw new HttpError(401, '접속 비밀번호로 로그인해 주세요.');
    const session = await redis<string | null>('GET', key);
    if (session !== 'site:' + digest(siteVerifier())) {
      throw new HttpError(401, '로그인이 만료되었습니다. 다시 로그인해 주세요.');
    }
    return;
  }
  if (!key) throw new HttpError(401, '강사 전용 링크로 접속해 주세요.');
  const [session, active] = await redis<[string | null, string | null]>('MGET', key, 'meal:link');
  if (!session) throw new HttpError(401, '접속 시간이 만료되었습니다. 전용 링크를 다시 열어 주세요.');
  if (session !== active) throw new HttpError(403, '접근 권한이 만료되었습니다. 새 링크를 요청해 주세요.');
}

export function checkOrigin(request: Request) {
  const expected = isPublicRequest(request) ? publicOrigin : new URL(required('APP_ORIGIN')).origin;
  if (request.headers.get('origin') !== expected) {
    throw new HttpError(403, '허용되지 않은 요청입니다.');
  }
}

export function cookie(value: string, seconds: number, requestOrigin = required('APP_ORIGIN')) {
  const origin = new URL(requestOrigin);
  if (origin.protocol !== 'https:' && !['localhost','127.0.0.1','[::1]'].includes(origin.hostname)) {
    throw new HttpError(503, 'HTTPS 서비스 주소를 설정해 주세요.');
  }
  const secure = origin.protocol === 'https:' ? '; Secure' : '';
  return cookieName + '=' + value + '; Max-Age=' + seconds + '; Path=/; HttpOnly; SameSite=Lax' + secure;
}

export async function exchange(token: unknown) {
  const failures = await redis<number | null>('GET', 'meal:link:failures');
  if (Number(failures) >= 30) throw new HttpError(429, '시도 횟수가 초과되었습니다. 잠시 후 다시 시도해 주세요.');
  const active = await redis<string | null>('GET', 'meal:link');
  const hash = typeof token === 'string' && tokenPattern.test(token) ? digest(token) : digest('');
  if (!active || !/^[a-f0-9]{64}$/.test(active) || !timingSafeEqual(Buffer.from(hash), Buffer.from(active))) {
    await redis('EVAL', "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],300) end; return n", 1, 'meal:link:failures');
    throw new HttpError(403, '링크가 만료되었거나 유효하지 않습니다.');
  }
  const session = randomBytes(32).toString('base64url');
  await redis('SET', 'meal:session:' + digest(session), active, 'EX', sessionSeconds);
  return cookie(session, sessionSeconds);
}

export async function exchangeSitePassword(password: unknown) {
  const verifier = siteVerifier();
  const attempts = await redis<number>('EVAL', rateCounter, 1, 'meal:site:attempts');
  if (attempts > 10) throw new HttpError(429, '로그인 시도 횟수를 초과했습니다. 잠시 후 다시 시도해 주세요.');
  const [salt, expected] = verifier.split(':');
  if (typeof password !== 'string' || password.length === 0 || password.length > 256) {
    throw new HttpError(400, '접속 비밀번호를 확인해 주세요.');
  }
  const hash = await derivePassword(password, Buffer.from(salt, 'hex'), 32) as Buffer;
  if (!timingSafeEqual(hash, Buffer.from(expected, 'hex'))) {
    throw new HttpError(403, '접속 비밀번호가 일치하지 않습니다.');
  }
  const session = randomBytes(32).toString('base64url');
  await redis('SET', 'meal:session:' + digest(session), 'site:' + digest(verifier), 'EX', siteSessionSeconds);
  return cookie(session, siteSessionSeconds, publicOrigin);
}
