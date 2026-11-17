import { scryptSync } from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GET, PATCH, POST } from '../app/api/[...path]/route';
import { periodFor, periodKey } from '../lib/period';
import type { Draft, Goal, ReportVersion } from '../lib/report-contracts';

test('KST reporting calendar follows ISO weeks and actual month lengths',()=>{
  assert.equal(periodKey('weekly','2027-01-01'),'2026-W53');
  assert.deepEqual(periodFor('weekly','2026-W53'),{
    type:'weekly', key:'2026-W53',start:'2026-12-28',end:'2027-01-03',until:'2027-01-04',
  });
  assert.equal(periodFor('monthly','2028-02').until,'2028-03-01');
  assert.equal(periodFor('monthly','2028-02').end,'2028-02-29');
  assert.throws(()=>periodFor('weekly','2027-W53'));
  assert.throws(()=>periodFor('weekly','2027-00'));
  assert.throws(()=>periodFor('monthly','2027-13'));
});

const origin = 'https://mealshin-nine.vercel.app';
const key = '2026-W47';
const weekPath = 'reports?type=weekly&key=' + key;
const monthPath = 'reports?type=monthly&key=2026-11';
const day = '2026-11-16';
const mealsId = 'meal-source';
const dailyId = 'daily-source';
const reportsId = 'period-source';
const goalsId = 'goal-source';
const progressId = 'progress-source';
const text = (value:string) => [{plain_text:value}];
type Row = {id:string; parent?:{data_source_id:string}; last_edited_time:string; properties:Record<string,unknown>};
const at = '2026-11-16T13:01:00Z';

function meal(id:string, start:string, end:string|null, shared:boolean):Row {
  return {id,last_edited_time:at,properties:{
    '기록명':{title:text(id === 'tea' ? '차 한 잔' : '공유 식단')},'식사 시작':{date:{start}},
    '식사 종료':{date:end ? {start:end} : null},'식사 구분':{select:{name:'간식'}},
    '음식 내용':{rich_text:text('공유 내용')},'식사 메모':{rich_text:text('PRIVATE-MEMO')},
    '공유 메모':{rich_text:text('공유 메모')},'공유 여부':{checkbox:shared},
  }};
}
function daily(id:string,date:string,status:string):Row {
  return {id,last_edited_time:at,properties:{
    '리뷰 날짜':{date:{start:date}},'리뷰 상태':{select:{name:status}},
    '강사 총평':{rich_text:text(id)},'수정 일시':{date:{start:at}},
  }};
}

test('public period workflow verifies reports, Notion snapshots and goals with simulated upstreams', async t => {
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-11-18T12:00:00Z')});
  const password = 'fixture-site-password';
  const salt = Buffer.alloc(16,1);
  const passwordHash = salt.toString('hex') + ':' + scryptSync(password,salt,32).toString('hex');
  Object.assign(process.env,{OWNER_PASSWORD_HASH:passwordHash,
    NOTION_TOKEN:'fake',NOTION_MEAL_LOG_DATA_SOURCE_ID:mealsId,NOTION_DAILY_REVIEW_DATA_SOURCE_ID:dailyId,
    NOTION_PERIOD_REVIEW_DATA_SOURCE_ID:reportsId,NOTION_IMPROVEMENT_TRACKER_DATA_SOURCE_ID:goalsId,NOTION_GOAL_PROGRESS_DATA_SOURCE_ID:progressId,
    AUTH_STORE_URL:'https://redis.test',AUTH_STORE_TOKEN:'fake',OPENAI_API_KEY:'fake',
    MEAL_AI_MODEL:'test-model',APP_ORIGIN:'https://instructor.test',
  });
  const rows:Record<string,Row[]> = {
    [mealsId]:[
      meal('first','2026-11-15T15:00:00Z','2026-11-16T00:30:00+09:00',true),
      meal('second','2026-11-16T09:10:00+09:00','2026-11-16T09:05:00+09:00',true),
      meal('tea','2026-11-18T11:20:00+09:00',null,true),
      meal('unshared-meal','2026-11-16T01:00:00+09:00',null,false),
      meal('before-week','2026-11-15T23:59:59+09:00',null,true),
      meal('after-week','2026-11-23T00:00:00+09:00',null,true),
      meal('missing-time','',null,true),
    ],
    [dailyId]:[daily('complete',day,'완료'),daily('incomplete',day,'검토중'),daily('no-meal','2026-11-17','완료')],
    [reportsId]:[],[goalsId]:[],[progressId]:[],
  };
  const store = new Map<string,string>();
  let calls = 0;
  let failAI = false;
  let badEvidence = false;
  const blockBodies = new Map<string, unknown[]>();
  let modelInput: {daily:{id:string}[];meals:{id:string}[];goals:unknown[];weekly:{id:string}[]} | undefined;
  const originalFetch = global.fetch;
  t.after(() => {global.fetch = originalFetch;});
  global.fetch = async (input, options) => {
    const url = new URL(input.toString());
    const body = options?.body ? JSON.parse(String(options.body)) : {};
    if (url.hostname === 'redis.test') {
      const [command,a,b,c,d,e] = body;
      let result:unknown;
      if (command === 'SET') {
        result = c === 'NX' && store.has(a) ? null : 'OK';
        if (result) store.set(a,b);
      } else if (command === 'GET') {
        result = store.get(a) ?? null;
      } else if (command === 'EVAL' && a.includes('INCR')) {
        result = Number(store.get(c) ?? 0) + 1;
        store.set(c,String(result));
      } else if (command === 'EVAL' && b === 2) {
        result = Number(store.get(c) === e && !store.has(d));
        if (result) store.set(d,e);
      } else if (command === 'EVAL' && a.includes('PEXPIRE')) {
        result = Number(store.get(c) === d);
      } else if (command === 'EVAL') {
        result = Number(store.get(c) === d && store.delete(c));
      } else assert.fail('unexpected Redis command');
      return Response.json({result});
    }
    if (url.hostname === 'api.openai.com') {
      if (body.response_format?.json_schema?.name === 'goal_progress') {
        const input=JSON.parse(body.messages[1].content);
        assert.equal(input.meals.some((meal:object)=>'sharedNote' in meal || 'mealNote' in meal),false);
        assert.equal(input.meals.length,1);
        return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({status:'부분달성',evidence:'가상 기록 근거'})}}]});
      }
      calls++;
      assert.equal(body.store,false);
      const serialized = body.messages[1].content;
      assert(!serialized.includes('PRIVATE-MEMO') && !serialized.includes('unshared-meal') &&
        !serialized.includes('incomplete') && !serialized.includes('no-meal'));
      modelInput = JSON.parse(serialized);
      if (failAI) return new Response(null,{status:503});
      const evidence = [badEvidence ? 'invented' : modelInput!.meals[0].id];
      const draft: Draft = {
        summary:{text:'기록에서 확인한 요약',evidence},observations:Array.from({length:8},()=>({text:'기록'.repeat(390),evidence})),
        strengths:Array.from({length:8},()=>({text:'공유'.repeat(390),evidence})),interpretations:[],improvements:[],goalAssessments:[],
        proposedGoals:[{title:'시간 기록하기',kind:'식사 시간',text:'시작 시각을 기록합니다.',evidence}],
        limitations:['기록이 부족합니다.'],
      };
      return Response.json({model:'fixture-model',choices:[{finish_reason:'stop',message:{content:JSON.stringify(draft)}}]});
    }
    assert.equal(url.hostname,'api.notion.com');
    const query = url.pathname.match(/^\/v1\/data_sources\/([^/]+)\/query$/);
    if (query) {
      const source = query[1];
      if (source === mealsId) {
        assert(!url.searchParams.getAll('filter_properties').includes('식사 메모'));
        assert.deepEqual(body.filter.and[0],{property:'공유 여부',checkbox:{equals:true}});
      }
      // Source adapters must recheck the scope even if upstream returns unexpected records.
      let results = rows[source];
      if (source === reportsId) {
        const periodKey = body.filter.and[0].rich_text.equals;
        const type = body.filter.and[1].select.equals;
        results = results.filter(row=>JSON.stringify(row.properties['기간 키']).includes(periodKey) &&
          JSON.stringify(row.properties['분석 단위']).includes(type));
      } else if (source === goalsId && body.filter) {
        results = results.filter(row=>JSON.stringify(row.properties['목표 ID']).includes(body.filter.rich_text.equals));
      }
      return Response.json({results,next_cursor:null});
    }
    const blocks = url.pathname.match(/^\/v1\/blocks\/([^/]+)\/children$/);
    if (blocks) return Response.json({results:blockBodies.get(blocks[1]) ?? [],next_cursor:null});
    const properties = () => Object.fromEntries(Object.entries(body.properties).map(([name,value])=>{
      const field = value as {rich_text?:{text:{content:string}}[]; title?:{text:{content:string}}[]};
      if (field.rich_text) return [name,{rich_text:field.rich_text.map(item=>({plain_text:item.text.content}))}];
      if (field.title) return [name,{title:field.title.map(item=>({plain_text:item.text.content}))}];
      return [name,value];
    }));
    if (options?.method === 'POST' && url.pathname === '/v1/pages') {
      const source = body.parent.data_source_id;
      assert(source === reportsId || source === goalsId || source === progressId);
      const id = '11111111-1111-1111-1111-' + String(rows[reportsId].length + rows[goalsId].length + rows[progressId].length + 1).padStart(12,'0');
      const row = {id,parent:{data_source_id:source},last_edited_time:at,properties:properties()};
      rows[source].push(row);
      if (body.children) blockBodies.set(id,body.children.map((block:{paragraph:{rich_text:{text:{content:string}}[]}})=>({
        type:'paragraph',paragraph:{rich_text:block.paragraph.rich_text.map(item=>({plain_text:item.text.content}))},
      })));
      return Response.json(row);
    }
    const row = [...rows[reportsId],...rows[goalsId],...rows[progressId]].find(row=>url.pathname.endsWith('/' + row.id));
    if (!row) return new Response(null,{status:404});
    if (options?.method === 'PATCH') row.properties = {...row.properties,...properties()};
    return Response.json(row);
  };
  let siteCookie = '';
  function api(path:string,method = 'GET',body?:unknown,host = origin, requestOrigin=host) {
    const request = new Request(host + '/api/' + path,{method,headers:{origin:requestOrigin,cookie:host === origin ? siteCookie : ""},
      ...(body === undefined ? {} : {body:JSON.stringify(body)})});
    return (method === 'GET' ? GET : method === 'PATCH' ? PATCH : POST)(request,
      {params:Promise.resolve({path:path.split('?')[0].split('/')})});
  }
  const generate = (regenerate=false,expectedVersion=0,type='weekly',periodKey=key) =>
    api('reports/generate','POST',{type,key:periodKey,regenerate,expectedVersion});
  const edit = (row:ReportVersion,feedback:string,confirm=false) =>
    api('reports/'+row.id+(confirm?'/confirm':''),confirm?'POST':'PATCH',
      {feedback,expectedVersion:row.version,expectedRevision:row.revision});
  const resetRate = () => {for (const k of store.keys()) if (k.startsWith('meal:v12:rate:')) store.delete(k);};

  assert.equal((await api(weekPath,'GET',undefined,'https://instructor.test')).status,401);
  assert.equal((await api(weekPath)).status,401);
  assert.equal((await api('goals')).status,401);
  assert.equal((await generate()).status,401);
  assert.equal((await api('goals','POST',{})).status,401);
  const login = await api('auth/password','POST',{password});
  assert.equal(login.status,200);
  siteCookie = login.headers.get('set-cookie')!.split(';')[0];
  const stats = (await (await api(weekPath)).json()).stats;
  assert.equal(stats.recordedDays,2);
  assert.equal(stats.mealCount,3);
  assert.equal(stats.reviewCount,1);
  assert.deepEqual(stats.durations,{count:1,min:30,max:30,average:30});
  assert.equal(stats.starts['간식']['00:00'],1);

  badEvidence = true;
  assert.equal((await generate()).status,502);
  assert.equal(rows[reportsId].length,0);
  badEvidence = false;
  const concurrent = await Promise.all([generate(),generate()]);
  assert.deepEqual(concurrent.map(result=>result.status).sort(),[200,409]);
  const draft:ReportVersion = await concurrent.find(result=>result.ok)!.json();
  assert.equal(draft.state,'AI 초안');
  assert(blockBodies.has(draft.id));
  assert.deepEqual(modelInput?.meals.map(item=>item.id),['first','second','tea']);
  assert.deepEqual(modelInput?.daily.map(item=>item.id),['complete']);
  assert.equal((await (await generate()).json()).id,draft.id);
  assert.equal(calls,2);
  assert.equal((await generate()).status,429);
  resetRate();

  const saved:ReportVersion = await (await edit(draft,'검토 내용')).json();
  assert.equal(saved.state,'검토중');
  assert.notEqual(saved.revision,draft.revision);
  assert.equal((await edit(draft,'기존 초안으로 덮기',true)).status,409);
  const final:ReportVersion = await (await edit(saved,'확정 내용',true)).json();
  assert.equal(final.state,'확정');
  assert.equal((await edit(final,'확정본 덮기')).status,409);

  const proposal = await api('goals','POST',{reportId:final.id,index:0});
  assert.equal(proposal.status,200);
  const goal:Goal = await proposal.json();
  assert.equal(goal.approved,false);
  assert.equal((await (await api('goals','POST',{reportId:final.id,index:0})).json()).id,goal.id);
  const approved:Goal = await (await api('goals/'+goal.id,'PATCH',
    {expectedRevision:goal.revision,status:'진행중'})).json();
  assert.equal(approved.approved,false);
  assert.equal(approved.status,'진행중');
  const goalUpdate = await api('goals/'+goal.id,'PATCH',
    {expectedRevision:approved.revision,status:'유지',evaluation:'실천이 확인됐습니다.',reportId:final.id});
  assert.equal(goalUpdate.status,200);
  const evaluated:Goal = await goalUpdate.json();
  assert.equal(evaluated.history.length,2);
  const opinionBody = {opinion:'목표를 계속 유지해 주세요.',expectedRevision:evaluated.revision};
  const commented = await api('goals/'+goal.id+'/opinion','POST',opinionBody);
  assert.equal(commented.status,200);
  const commentedGoal:Goal = await commented.json();
  assert.equal(commentedGoal.status,'유지');
  assert.equal(commentedGoal.evaluation,'실천이 확인됐습니다.');
  assert.equal(commentedGoal.evaluatedAt,evaluated.evaluatedAt);
  assert.equal(commentedGoal.history.at(-1)?.opinion,opinionBody.opinion);
  assert.equal((await api('goals/'+goal.id+'/opinion','POST',opinionBody)).status,409);
  const goalList:Goal[] = await (await api('goals')).json();
  assert.equal(goalList[0].history.at(-1)?.opinion,opinionBody.opinion);

  const progressPath = 'goals/'+goal.id+'/progress';
  const progressDay = '2026-11-18';
  const saveProgress = (action:string,expectedRevision='',extra={}) =>
    api(progressPath,'POST',{day:progressDay,action,expectedRevision,...extra});
  const preview = await saveProgress('draft');
  assert.equal(preview.status,200);
  const {draft:previewDraft} = await preview.json();
  assert.equal(previewDraft.status,'부분달성');
  assert.deepEqual(previewDraft.mealIds,['tea']);
  assert.equal(rows[progressId].length,0);
  assert.equal((await saveProgress('confirm')).status,409);
  assert.equal((await saveProgress('save','',{status:'부분달성',mealIds:['unshared-meal'],draftId:previewDraft.id})).status,400);
  const concurrentProgress = await Promise.all([
    saveProgress('save','',{status:previewDraft.status,mealIds:[],draftId:previewDraft.id,memo:'확인 메모'}),
    saveProgress('save','',{status:previewDraft.status,mealIds:[],draftId:previewDraft.id,memo:'확인 메모'}),
  ]);
  assert.deepEqual(concurrentProgress.map(item=>item.status).sort(),[200,409]);
  const {record:progressDraft} = await concurrentProgress.find(item=>item.ok)!.json();
  assert.equal(progressDraft.confirmed,false);
  assert.deepEqual(progressDraft.mealIds,[]);
  assert.equal(progressDraft.evidence,'가상 기록 근거');
  assert.equal(rows[progressId].length,1);
  const dashboardPath = 'goals/dashboard?range=week';
  assert.equal((await api('goals/dashboard?range=invalid')).status,400);
  const unconfirmedDashboard = await (await api(dashboardPath)).json();
  assert.equal(unconfirmedDashboard.totals.partial,1);
  assert.equal(unconfirmedDashboard.totals.evaluated,1);
  assert.equal(unconfirmedDashboard.managed,1);
  assert.equal(unconfirmedDashboard.unrecorded,2);
  assert.equal(unconfirmedDashboard.entries[0].latest.confirmed,false);
  const monthDashboard = await (await api('goals/dashboard?range=month')).json();
  assert.equal(monthDashboard.start,'2026-11-01');
  assert.equal(monthDashboard.end,'2026-11-18');
  const {record:progressFinal} = await (await saveProgress('confirm',progressDraft.revision,{status:'달성'})).json();
  assert.equal(progressFinal.status,'부분달성');
  assert.equal(progressFinal.confirmed,true);
  assert.equal(progressFinal.evidence,'가상 기록 근거');
  assert.equal((await saveProgress('save',progressFinal.revision,{status:'달성'})).status,409);
  const progressSummary = 'goals/progress-summary?type=weekly&key='+key;
  const summary = (await (await api(progressSummary)).json())[0].summary;
  assert.equal(summary.partial,1);
  assert.equal(summary.rate,0);
  const {record:reopenedProgress} = await (await saveProgress('restart',progressFinal.revision)).json();
  assert.equal(reopenedProgress.confirmed,false);
  assert.equal((await saveProgress('remove',reopenedProgress.revision)).status,409);
  const reopenedSummary = (await (await api(progressSummary)).json())[0].summary;
  assert.equal(reopenedSummary.partial,1);
  assert.equal(reopenedSummary.drafts,1);
  const tea = rows[mealsId].find(item=>item.id==='tea')!;
  tea.properties['공유 여부']={checkbox:false};
  assert.equal((await api(progressPath+'?day='+progressDay)).status,404);
  const privateDashboard = await (await api(dashboardPath)).json();
  assert.equal(privateDashboard.totals.partial,0);
  assert.equal(privateDashboard.entries[0]?.latest ?? null,null);
  tea.properties['공유 여부']={checkbox:true};
  const emptyProgressPath = progressPath+'?day=2026-11-17';
  const empty = await api(progressPath,'POST',{day:'2026-11-17',action:'save',status:'미달성'});
  assert.equal(empty.status,200);
  const {record:emptyRecord} = await empty.json();
  assert.equal(emptyRecord.status,'판단불가');
  assert.equal((await api(progressPath,'POST',{day:'2026-11-17',action:'remove',expectedRevision:emptyRecord.revision})).status,200);
  assert.equal((await (await api(emptyProgressPath)).json()).record,null);
  const selectedOnly=await api(progressPath,'POST',{day,action:'save',status:'달성',mealIds:['second']});
  assert.equal(selectedOnly.status,200);
  const selectedRead=await (await api(progressPath+'?day='+day)).json();
  assert.deepEqual(selectedRead.record.mealIds,['second']);
  const latestList=await (await api(progressSummary+'&latest=1')).json();
  assert.equal(latestList[0].latest.day,progressDay);
  const original=rows[progressId].find(row=>row.id===progressFinal.id)!;
  const duplicate={...original,id:'11111111-1111-1111-1111-000000000777',last_edited_time:'2026-11-18T12:20:00Z'};
  rows[progressId].push(duplicate);
  assert.equal((await (await api(progressSummary)).json())[0].summary.partial,1);
  assert.equal((await api(progressPath+'?day='+progressDay)).status,409);
  assert.equal((await (await api(dashboardPath)).json()).totals.partial,1);
  rows[progressId].pop();

  const month = await generate(false,0,'monthly','2026-11');
  assert.equal(month.status,200);
  assert.deepEqual(modelInput?.weekly.map(item=>item.id),[final.id]);
  assert.equal((await (await api(monthPath)).json()).stats.weeks.length,3);

  const first = rows[mealsId][0];
  first.properties['기록명'] = {title:text('수정한 공유 식단')};
  const stale = await (await api(weekPath)).json();
  assert.equal(stale.needsReview,true);
  assert.equal(stale.final.feedback,'확정 내용');
  failAI = true;
  assert.equal((await generate(true,1)).status,502);
  failAI = false;
  const regenerated = await generate(true,1);
  assert.equal(regenerated.status,200);
  const newDraft:ReportVersion = await regenerated.json();
  assert.equal(newDraft.version,2);
  const reopened = await (await api(weekPath)).json();
  assert.equal(reopened.currentStale,false);
  assert.equal(reopened.final.feedback,'확정 내용');
  assert.equal(reopened.analysis.id,newDraft.id);
  const confirmationRace = await Promise.all([edit(newDraft,'두 번째 확정',true),edit(newDraft,'오래된 화면의 초안')]);
  assert.deepEqual(confirmationRace.map(response=>response.status),[200,409]);
  const history = await (await api('reports/'+final.id+'/history')).json();
  assert.deepEqual(history.map((row:ReportVersion)=>row.feedback),['두 번째 확정','확정 내용']);

  resetRate();
  assert.equal((await generate(false,0,'weekly','2026-W48')).status,200);
  assert.equal(modelInput?.goals.length,1);

  first.properties['공유 여부'] = {checkbox:false};
  const hidden = await (await api(weekPath)).json();
  assert.equal(hidden.final,null);
  assert.equal(hidden.current,null);
  assert.equal(hidden.analysis,null);
  const hiddenHistory = await (await api('reports/'+final.id+'/history')).json();
  assert(hiddenHistory.every((row:{hidden:boolean})=>row.hidden));
  assert(!JSON.stringify(hiddenHistory).includes('확정 내용'));
  assert.deepEqual(await (await api('goals')).json(),[]);
  const statuses = ['제안','진행중','유지','보류','종료'];
  for (const [index,status] of statuses.entries()) {
    rows[goalsId].push({
      id:'11111111-1111-1111-1111-' + String(101 + index).padStart(12,'0'),
      parent:{data_source_id:goalsId},last_edited_time:at,properties:{
        '개선 목표':{title:text('단독 목표 ' + status)},'목표 상태':{select:{name:status}},
        '강사 확정 여부':{checkbox:index > 0},
      },
    });
  }
  const standalone:Goal[] = await (await api('goals')).json();
  assert.deepEqual(standalone.map(goal=>goal.status),statuses);
  const opinionResult = await api('goals/'+standalone[0].id+'/opinion','POST',{
    opinion:'단독 목표에 남긴 의견',expectedRevision:standalone[0].revision,
  });
  assert.equal(opinionResult.status,200);
  const updatedStandalone:Goal = await opinionResult.json();
  assert.equal(updatedStandalone.status,'제안');
  assert.equal(updatedStandalone.history.at(-1)?.opinion,'단독 목표에 남긴 의견');
  const later = await (await api('reports?type=weekly&key=2026-W48')).json();
  assert.equal(later.current,null);
  assert.equal(later.needsReview,true);
  assert.equal((await api('reports/generate','POST',{type:'weekly',key},origin,'https://foreign.test')).status,403);

  const beforeManual = calls;
  delete process.env.OPENAI_API_KEY;
  for (const [type,manualKey] of [['weekly','2026-W50'],['monthly','2026-12']]) {
    const body = {type,key:manualKey,feedback:'강사 직접 의견',expectedVersion:0};
    const created = await api('reports','POST',body);
    assert.equal(created.status,201);
    const manual:ReportVersion = await created.json();
    assert.equal(manual.draft,null);
    assert.equal(manual.state,'검토중');
    assert.equal((await api('reports','POST',body)).status,409);
    const updated:ReportVersion = await (await edit(manual,'직접 작성한 수정 의견')).json();
    assert.equal(updated.feedback,'직접 작성한 수정 의견');
    assert.equal((await edit(updated,'직접 작성한 확정 의견',true)).status,200);
    const read = await (await api('reports?type='+type+'&key='+manualKey)).json();
    assert.equal(read.final.feedback,'직접 작성한 확정 의견');
    const next = await api('reports','POST',{...body,expectedVersion:1});
    assert.equal(next.status,201);
    assert.equal((await next.json()).version,2);
    assert.equal((await (await api('reports/'+manual.id+'/history')).json())[0].feedback,'직접 작성한 확정 의견');
  }
  assert.equal(calls,beforeManual);
});
