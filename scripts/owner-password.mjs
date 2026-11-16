import { randomBytes, scryptSync } from 'node:crypto';

const password = randomBytes(24).toString('base64url');
const salt = randomBytes(16);
const hash = scryptSync(password, salt, 32).toString('hex');
console.log('소유자 비밀번호 = ' + password);
console.log('OWNER_PASSWORD_HASH=' + salt.toString('hex') + ':' + hash);
