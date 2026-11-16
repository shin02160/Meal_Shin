import { scryptSync } from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GET, POST, PUT } from '../app/api/[...path]/route';
import { digest } from '../lib/auth';
import { dateBounds, isDate } from '../lib/date';

const mealSource = '11111111-1111-1111-1111-111111111111';
const reviewSource = '22222222-2222-2222-2222-222222222222';
const mealId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const date = '2026-11-16';
const origin = 'https://meal.test';
const image = 'https://prod-files-secure.s3.us-west-2.amazonaws.com/fixture?signature=private';
const token = 'a'.repeat(43);
const rotated = 'b'.repeat(43);
const rich = (plain_text: string) => [{plain_text}];

function meal(id: string, start: string, shared: boolean, end?: string) {
  return {id, parent:{data_source_id:mealSource}, properties:{
    '기록명':{title:rich('가상 식단')}, '식사 시작':{date:{start}}, '식사 종료':{date:end ? {start:end} : null},
    '공유 여부':{checkbox:shared}, '식사 메모':{rich_text:rich('식사 메모 ' + id)}, '공유 메모':{rich_text:rich('공개 메모')},
    '식단 사진':{files:[{type:'file',file:{url:image}},{type:'file',file:{url:'https://evil.test/photo'}}]},
  }};
}
const fakeMeals = [
  meal('late', '2026-11-16T23:59:00+09:00', true, '2026-11-16T23:58:00+09:00'),
  meal('following', '2026-11-17T00:00:00+09:00', true),
  meal('previous', '2026-11-15T23:59:00+09:00', true),
  meal(mealId, '2026-11-15T15:00:00Z', true),
  meal('restricted', '2026-11-16T10:00:00+09:00', false),
];
type ReviewPage = {id:string; properties:Record<string, {date?:{start:string}; rich_text?:{plain_text:string}[]}>};

test('KST day boundaries and calendar validation', () => {
  assert.equal(isDate('2026-02-29'), false);
  assert.equal(isDate('2028-02-29'), true);
  assert.deepEqual(dateBounds('2026-12-31'), ['2026-12-31T00:00:00+09:00','2027-01-01T00:00:00+09:00']);
});

test('API integration with simulated Notion and Redis REST', async t => {
  Object.assign(process.env, {
    APP_ORIGIN:origin, AUTH_STORE_URL:'https://redis.test', AUTH_STORE_TOKEN:'test', NOTION_TOKEN:'test',
    NOTION_MEAL_LOG_DATA_SOURCE_ID:mealSource, NOTION_DAILY_REVIEW_DATA_SOURCE_ID:reviewSource,
  });
  const redisState = new Map<string,string>([['meal:link', digest(token)]]);
  const reviews: ReviewPage[] = [];
  let writes = 0;
  let notionRequests = 0;
  let imageRequests = 0;
  let hiddenReview = false;
  let failCreate = false;
  let failUpdate = false;
  let unshare = false;
  const originalFetch = global.fetch;
  t.after(() => {global.fetch = originalFetch;});
  global.fetch = async (input, options) => {
    const url = new URL(input.toString());
    const body = options?.body ? JSON.parse(String(options.body)) : {};
    if (url.hostname === 'redis.test') {
      const [command, a, b, c, d] = body;
      let result: unknown;
      if (command === 'SET') {
        result = c === 'NX' && redisState.has(a) ? null : 'OK';
        if (result) redisState.set(a, b);
      } else if (command === 'GET') result = redisState.get(a) ?? null;
      else if (command === 'MGET') result = [redisState.get(a) ?? null, redisState.get(b) ?? null];
      else if (command === 'DEL') result = Number(redisState.delete(a));
      else if (command === 'EVAL') {
        if (a.includes('INCR')) {
          result = Number(redisState.get(c) ?? 0) + 1;
          redisState.set(c, String(result));
        } else if (b === 2) {
          result = Number(redisState.get(c) === body[5] && !redisState.has(d));
          if (result) redisState.set(d, body[5]);
        } else if (a.includes('PEXPIRE')) result = Number(redisState.get(c) === d);
        else result = Number(redisState.get(c) === d && redisState.delete(c));
      } else assert.fail('Unexpected test Redis command');
      return Response.json({result});
    }
    if (url.hostname === 'prod-files-secure.s3.us-west-2.amazonaws.com') {
      assert.equal(options?.redirect, 'error');
      imageRequests++;
      return imageRequests === 1 ? new Response(null,{status:403}) :
        new Response('fixture image',{headers:{'content-type':'image/png'}});
    }
    assert.equal(url.hostname, 'api.notion.com');
    notionRequests++;
    if (url.pathname.includes(mealSource)) {
      assert.deepEqual(body.filter.and[0], {property:'공유 여부',checkbox:{equals:true}});
      assert.equal(body.filter.and[1].date.on_or_after, dateBounds(date)[0]);
      assert.equal(body.filter.and[2].date.before, dateBounds(date)[1]);
      const meals = unshare ? fakeMeals.map(row => ({...row, properties:{...row.properties, '공유 여부':{checkbox:false}}})) : fakeMeals;
      return Response.json({results:meals, next_cursor:null});
    }
    if (url.pathname.includes(reviewSource)) return Response.json({results:hiddenReview ? [] : reviews, next_cursor:null});
    if (url.pathname.endsWith(mealId)) {
      return Response.json(unshare ? meal(mealId, '2026-11-16T00:00:00+09:00', false) : fakeMeals[3]);
    }
    if (options?.method === 'POST') {
      writes++;
      const review = {id:'review-1', properties:{...body.properties}};
      review.properties['강사 총평'] = {rich_text:rich(body.properties['강사 총평'].rich_text.map((segment: {text:{content:string}}) => segment.text.content).join(''))};
      reviews.push(review);
      if (failCreate) return new Response(null,{status:503});
      return Response.json(review);
    }
    if (options?.method === 'PATCH') {
      if (failUpdate) return new Response(null,{status:503});
      assert.equal(url.pathname, '/v1/pages/review-1');
      assert(!('작성 일시' in body.properties));
      reviews[0].properties['강사 총평'] = {rich_text:rich(body.properties['강사 총평'].rich_text[0].text.content)};
      return Response.json(reviews[0]);
    }
    assert.fail('Unexpected test URL');
  };

  let cookie = '';
  const api = (route: string, method = 'GET', data?: unknown, authorized = true) => {
    const request = new Request(origin + '/api/' + route, {method, headers:{origin, cookie:authorized ? cookie : ''}, body:JSON.stringify(data)});
    const context = {params:Promise.resolve({path:route.split('?')[0].split('/')})};
    return (method === 'GET' ? GET : method === 'PUT' ? PUT : POST)(request, context);
  };
  const mealsPath = 'meals?date=' + date;
  const mediaPath = 'media/' + date + '/' + mealId + '/0';
  const reviewsPath = 'reviews/' + date;
  const save = (feedback: string) => api(reviewsPath, 'PUT', {feedback});

  assert.equal((await api(mediaPath)).status, 401);
  assert.equal(notionRequests, 0);
  assert.equal((await api('auth/link','POST',{token:'wrong'})).status, 403);
  const login = await api('auth/link','POST',{token});
  assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie')!, /HttpOnly; SameSite=Lax; Secure/);
  cookie = login.headers.get('set-cookie')!.split(';')[0];
  const response = await api(mealsPath);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const raw = await response.text();
  assert(!raw.includes('식사 메모 restricted') && !raw.includes('signature') && !raw.includes('evil.test'));
  const {meals} = JSON.parse(raw);
  assert.deepEqual(meals.map((row: {id:string}) => row.id), [mealId, 'late']);
  assert.equal(meals[0].mealNote,'식사 메모 ' + mealId);
  assert.equal(meals[0].displayDuration, '');
  assert.equal(meals[1].displayDuration, '시간 확인 필요');
  assert.deepEqual(meals[0].images, ['/api/' + mediaPath]);
  assert.equal(await (await api(mediaPath)).text(), 'fixture image');
  assert.equal(imageRequests, 2);
  assert.equal((await save('    ')).status, 400);

  unshare = true;
  assert.equal((await api(mealsPath)).status, 200);
  assert.deepEqual((await (await api(mealsPath)).json()).meals, []);
  assert.equal((await api(mediaPath)).status, 404);
  assert.equal((await save('새 총평')).status, 409);
  unshare = false;

  failCreate = true;
  const concurrent = await Promise.all([save('가상 총평'), save('가상 총평')]);
  assert.deepEqual(concurrent.map(result => result.status).sort(), [200,503]);
  assert.equal(writes, 1);
  hiddenReview = true;
  assert.equal((await save('다른 총평')).status, 503);
  assert.equal(writes, 1);
  hiddenReview = false;
  unshare = true;
  failUpdate = true;
  assert.equal((await save('수정 총평')).status, 502);
  failUpdate = false;
  assert.equal((await save('수정 총평')).status, 200);
  assert.equal((await (await api(reviewsPath)).json()).feedback, '수정 총평');
  reviews.push({...reviews[0], id:'duplicate'});
  assert.equal((await save('변경')).status, 409);
  redisState.set('meal:link', digest(rotated));
  assert.equal((await api(mealsPath)).status, 403);
  assert.equal((await api('auth/link','POST',{token})).status, 403);
  const rotatedLogin = await api('auth/link','POST',{token:rotated});
  assert.equal(rotatedLogin.status, 200);
  cookie = rotatedLogin.headers.get('set-cookie')!.split(';')[0];
  const password = 'fixture-site-password';
  const salt = Buffer.alloc(16,1);
  const passwordHash = salt.toString('hex') + ':' + scryptSync(password,salt,32).toString('hex');
  process.env.OWNER_PASSWORD_HASH = passwordHash;
  let siteCookie = '';
  const publicOrigin = 'https://mealshin-nine.vercel.app';
  const publicApi = (route: string, method = 'GET', data?: unknown, requestOrigin = publicOrigin) => {
    const request = new Request(publicOrigin + '/api/' + route, {
      method, headers:{origin:requestOrigin,cookie:siteCookie}, body:JSON.stringify(data),
    });
    const context = {params:Promise.resolve({path:route.split('?')[0].split('/')})};
    return (method === 'GET' ? GET : method === 'PUT' ? PUT : POST)(request, context);
  };
  assert.equal((await api(mealsPath, 'GET', undefined, false)).status, 401);
  unshare = false;
  assert.equal((await publicApi(mealsPath)).status,401);
  assert.equal((await publicApi(mediaPath)).status,401);
  assert.equal((await publicApi(reviewsPath,'PUT',{feedback:'비인가 요청'})).status,401);
  assert.equal((await publicApi('auth/link','POST',{token:rotated})).status,401);
  assert.equal((await publicApi('auth/password','POST',{password:'wrong'})).status,403);
  const siteLogin = await publicApi('auth/password','POST',{password});
  assert.equal(siteLogin.status,200);
  assert.match(siteLogin.headers.get('set-cookie')!,/Max-Age=28800.*HttpOnly; SameSite=Lax; Secure/);
  siteCookie = siteLogin.headers.get('set-cookie')!.split(';')[0];
  const publicMeals = await publicApi(mealsPath);
  assert.equal(publicMeals.status, 200);
  const publicData = await publicMeals.text();
  assert(publicData.includes(mealId) && !publicData.includes('restricted') && publicData.includes('식사 메모 ' + mealId));
  assert.equal((await publicApi(mediaPath)).status, 200);
  unshare = true;
  assert.equal((await publicApi(mediaPath)).status, 404);
  assert.equal((await publicApi(reviewsPath)).status, 409);
  reviews.pop();
  assert.equal((await publicApi(reviewsPath, 'PUT', {feedback:'외부 요청'}, 'https://other.test')).status, 403);
  assert.equal((await publicApi(reviewsPath, 'PUT', {feedback:'공개 총평'})).status, 200);
  assert.equal((await (await publicApi(reviewsPath)).json()).feedback, '공개 총평');
  process.env.OWNER_PASSWORD_HASH = passwordHash.replace(/^./,'9');
  assert.equal((await publicApi(mealsPath)).status,401);
  process.env.OWNER_PASSWORD_HASH = passwordHash;
  assert.equal((await publicApi('auth/logout','POST')).status,200);
  assert.equal((await publicApi(mealsPath)).status,401);
  redisState.delete('meal:session:' + digest(cookie.split('=')[1]));
  assert.equal((await api(mealsPath)).status, 401);
});
