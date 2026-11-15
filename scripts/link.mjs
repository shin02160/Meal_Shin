import { createHash, randomBytes } from 'node:crypto';

async function run() {
  const action = process.argv[2];
  if (!['rotate','revoke'].includes(action)) throw new Error('npm run link -- rotate 또는 revoke를 지정해 주세요.');
  const {AUTH_STORE_URL, AUTH_STORE_TOKEN, APP_ORIGIN} = process.env;
  if (!AUTH_STORE_URL || !AUTH_STORE_TOKEN || !APP_ORIGIN) throw new Error('인증 저장소와 서비스 주소를 설정해 주세요.');
  const origin = new URL(APP_ORIGIN);
  if (origin.protocol !== 'https:' && !['localhost','127.0.0.1','[::1]'].includes(origin.hostname)) {
    throw new Error('HTTPS 서비스 주소를 사용해 주세요.');
  }
  const token = randomBytes(32).toString('base64url');
  const digest = createHash('sha256').update(token).digest('hex');
  const command = action === 'rotate' ? ['SET','meal:link',digest,'EX',2592000] : ['DEL','meal:link'];
  const response = await fetch(AUTH_STORE_URL, {
    method:'POST', headers:{Authorization:'Bearer ' + AUTH_STORE_TOKEN, 'Content-Type':'application/json'},
    body:JSON.stringify(command), signal:AbortSignal.timeout(5000),
  });
  const body = await response.json();
  if (!response.ok || body.error || body.result === undefined) throw new Error('링크 설정을 변경하지 못했습니다.');
  if (action === 'rotate') process.stdout.write(origin.origin + '/review#token=' + token + '\n');
  else process.stdout.write('강사 링크를 폐기했습니다.\n');
}
run().catch(error => {
  const expected = ['Error'].includes(error.name) && !error.cause;
  process.stderr.write((expected ? error.message : '인증 저장소에 연결할 수 없습니다.') + '\n');
  process.exitCode = 1;
});
