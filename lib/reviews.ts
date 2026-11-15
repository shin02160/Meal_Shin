import { randomUUID } from 'node:crypto';
import { redis } from './auth';
import { HttpError } from './errors';
import { mealsFor, NotionError, projectReview, reviewPage, writeReview } from './notion';

const release = "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0";
const claim = "if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end if redis.call('SET',KEYS[2],ARGV[1],'NX') then return 1 end return 0";
const renew = "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('PEXPIRE',KEYS[1],ARGV[2]) end return 0";
const busy = () => new HttpError(503, '이 날짜의 총평 저장을 확인 중입니다. 잠시 후 다시 시도해 주세요.');

export async function saveReview(date: string, feedback: string) {
  const lock = 'meal:review:lock:' + date;
  // Keep the creation marker after success to tolerate stale Notion queries.
  const pending = 'meal:review:create:' + date;
  const owner = randomUUID();
  const lease = 60000;
  if (!await redis('SET', lock, owner, 'NX', 'PX', lease)) throw busy();
  try {
    const existing = await reviewPage(date);
    if (existing) {
      if (!await redis('EVAL', renew, 1, lock, owner, lease)) throw busy();


      return await writeReview(date, feedback, existing);
    }
    if (!(await mealsFor(date)).length) throw new HttpError(409, '공유된 식단이 없는 날에는 새 총평을 작성할 수 없습니다.');
    if (!await redis('EVAL', renew, 1, lock, owner, lease)) throw busy();
    if (!await redis('EVAL', claim, 2, lock, pending, owner)) throw busy();
    try {
      return await writeReview(date, feedback);
    } catch (error) {
      const confirmedRejected = error instanceof NotionError &&
        [400, 401, 403, 404, 429].includes(error.upstreamStatus ?? 0);
      if (confirmedRejected) {
        await redis('EVAL', release, 1, pending, owner);
        throw error;
      }
      const recovered = await reviewPage(date);
      if (!recovered) throw busy();
      if (projectReview(date, recovered).feedback !== feedback) throw busy();

      return projectReview(date, recovered);
    }
  } finally {
    await redis('EVAL', release, 1, lock, owner).catch(() => {});
  }
}
