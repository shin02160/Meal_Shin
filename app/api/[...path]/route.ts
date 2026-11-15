import { authenticate, checkOrigin, cookie, exchange, redis, sessionKey } from '../../../lib/auth';
import { feedbackLimit } from '../../../lib/contracts';
import { isDate } from '../../../lib/date';
import { HttpError, json } from '../../../lib/errors';
import { mealsFor, NotionError, photoFor, projectReview, reviewPage } from '../../../lib/notion';
import { saveReview } from '../../../lib/reviews';

export const runtime = 'nodejs';
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

async function readBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, '입력 내용을 확인해 주세요.');
  const decoder = new TextDecoder();
  let size = 0;
  let raw = '';
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > 40000) {
      await reader.cancel();
      throw new HttpError(400, '입력 내용이 너무 깁니다.');
    }
    raw += decoder.decode(chunk.value, {stream:true});
  }
  try {
    const data = JSON.parse(raw + decoder.decode());
    if (!data || typeof data !== 'object') throw new Error();
    return data;
  } catch {
    throw new HttpError(400, '입력 내용을 확인해 주세요.');
  }
}

function validDate(date = '') {
  if (!isDate(date) || date === '9999-12-31') throw new HttpError(400, '올바른 날짜를 선택해 주세요.');
  return date;
}

async function media(date: string, id: string, index: string) {
  if (!uuid.test(id) || !/^\d{1,4}$/.test(index)) throw new HttpError(404, '사진을 찾을 수 없습니다.');
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const url = await photoFor(date, id, Number(index));
      if (!url) break;
      const response = await fetch(url, {redirect:'error', cache:'no-store', signal:AbortSignal.timeout(7000)});
      const type = response.headers.get('content-type')?.split(';')[0];
      if (response.ok && type && /^image\/(jpeg|png|gif|webp|avif|heic|heif)$/.test(type)) {
        return new Response(response.body, {headers:{
          'Content-Type':type, 'Cache-Control':'private, no-store', 'Cross-Origin-Resource-Policy':'same-origin',
        }});
      }
      await response.body?.cancel();
      if (response.status !== 401 && response.status !== 403) break;
    }
  } catch (error) {
    if (error instanceof NotionError && error.upstreamStatus === 404) {
      throw new HttpError(404, '사진을 찾을 수 없습니다.');
    }
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, '사진을 불러올 수 없습니다.');
  }
  throw new HttpError(404, '사진을 찾을 수 없습니다.');
}

async function handler(request: Request, context: {params: Promise<{path: string[]}>}) {
  try {
    const {path} = await context.params;
    const route = path.join('/');
    if (request.method !== 'GET') checkOrigin(request);
    if (route === 'auth/link' && request.method === 'POST') {
      const {token} = await readBody(request);
      return json({ok:true}, 200, {'Set-Cookie':await exchange(token)});
    }
    if (route === 'auth/logout' && request.method === 'POST') {
      const key = sessionKey(request);
      if (key) await redis('DEL', key);
      return json({ok:true}, 200, {'Set-Cookie':cookie('', 0)});
    }

    await authenticate(request);
    if (route === 'meals' && request.method === 'GET') {
      const date = validDate(new URL(request.url).searchParams.get('date') ?? '');
      return json({date, meals:await mealsFor(date)});
    }
    if (path[0] === 'reviews' && path.length === 2) {
      const date = validDate(path[1]);
      if (request.method === 'GET') return json(projectReview(date, await reviewPage(date)));
      if (request.method === 'PUT') {
        const {feedback} = await readBody(request);
        if (typeof feedback !== 'string' || !feedback.trim() || feedback.length > feedbackLimit) {
          throw new HttpError(400, '총평을 1자 이상 6,000자 이하로 입력해 주세요.');
        }
        return json(await saveReview(date, feedback.trim()));
      }
    }
    if (path[0] === 'media' && path.length === 4 && request.method === 'GET') {
      return await media(validDate(path[1]), path[2], path[3]);
    }
    throw new HttpError(404, '요청한 페이지를 찾을 수 없습니다.');
  } catch (error) {
    if (error instanceof HttpError) return json({error:error.message}, error.status);
    return json({error:'요청을 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.'}, 503);
  }
}
export {handler as GET, handler as POST, handler as PUT};
