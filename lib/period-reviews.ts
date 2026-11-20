import { randomUUID } from 'node:crypto';
import { collectPeriod, type PeriodInput } from './analysis-input';
import { feedbackLimit } from './contracts';
import { HttpError } from './errors';
import { importedReportScope } from './imported-report-scope';
import { readReportBody } from './report-body';
import { NotionError, mealSource, queryNotion } from './notion';
import { kstDate, periodFor, type Period } from './period';
import { generateDraft } from './report-ai';
import { goalStates, type Goal, type ReportVersion } from './report-contracts';
import { createGoal, getGoal, getReport, listGoals, race, updateGoal, updateReport, versions, withReportLock, writeDraft } from './report-storage';

function scope(period: Period) { return period.type + ':' + period.key; }
function refKey(ref:PeriodInput['refs'][number]) { return ref.kind + ':' + ref.id + ':' + ref.date; }

function makeSourceCheck() {
  const lookups = new Map<string,Promise<Set<string>>>();
  const imports = new Map<string,Promise<boolean>>();
  return async (row:Pick<ReportVersion,'sources'|'imported'>,period:Period,input:PeriodInput) => {
    if (row.imported) {
      const scope = importedReportScope(period,row.imported.evidence);
      const key = scope.start+':'+scope.until;
      if (!imports.has(key)) imports.set(key,(async()=>{
        if (!input.meals.some(meal=>meal.date>=scope.start && meal.date<scope.until)) return false;
        const privateMeals = await queryNotion(mealSource(),{'공유 여부':'checkbox'}, {and:[
          {property:'공유 여부',checkbox:{equals:false}},
          {property:'식사 시작',date:{on_or_after:scope.start+'T00:00:00+09:00'}},
          {property:'식사 시작',date:{before:scope.until+'T00:00:00+09:00'}},
        ]},1);
        return privateMeals.length===0;
      })());
      return imports.get(key)!;
    }
    const available = new Set(input.refs.map(refKey));
    const external = row.sources.filter(ref=>ref.date < period.start || ref.date >= period.until);
    const missingInside = row.sources.some(ref=>ref.date >= period.start && ref.date < period.until && !available.has(refKey(ref)));
    if (missingInside) return false;
    const valid = await Promise.all(external.map(async ref=> {
      const key = ref.date.slice(0,7);
      if (!lookups.has(key)) lookups.set(key,collectPeriod(periodFor('monthly',key)).then(result=>new Set(result.refs.map(refKey))));
      return (await lookups.get(key)!).has(refKey(ref));
    }));
    return valid.every(Boolean);
  };
}
export async function readPeriod(period: Period) {
  const [input, rows] = await Promise.all([collectPeriod(period),versions(period)]);
  const final = rows.find(row => row.state === '확정');
  const current = rows[0];
  const visible = makeSourceCheck();
  const [showCurrent,showFinal] = await Promise.all([
    current && visible(current,period,input), final && visible(final,period,input),
  ]);
  let analysis:ReportVersion|null = null;
  for (const row of rows) {
    if (!row.draft) continue;
    if (row === current ? showCurrent : row === final ? showFinal : await visible(row,period,input)) {
      analysis = row;
      break;
    }
  }
  if (analysis?.imported) analysis.imported.body = await readReportBody(analysis.id);
  return {period,stats:input.stats,daily:input.daily,analysis,historyId:final?.id,
    needsReview:!!(current && !showCurrent || final && !showFinal) || [current,final,analysis].some(row => row && !row.imported && row.fingerprint !== input.fingerprint),
    currentStale:!!current && current.fingerprint !== input.fingerprint,
    current:showCurrent ? current : null,
    final:showFinal ? final : null,
    latestVersion:current?.version ?? 0,
  };
}

async function weeklyReferences(period: Period, input:PeriodInput) {
  if (period.type === 'weekly') return [];
  const visible = makeSourceCheck();
  const reports = await Promise.all(input.stats.weeks.map(async ({key}) => {
    const week = periodFor('weekly',key);
    if (week.start < period.start || week.end > period.end) return null;
    const row = (await versions(week)).find(entry => entry.state === '확정');
    if (!row) return null;
    const original = await collectPeriod(week);
    if (row.fingerprint !== original.fingerprint || !await visible(row,week,original)) return null;
    return row;
  }));
  return reports.filter(row => row !== null);
}

function makeVisibilityCheck() {
  const visible = makeSourceCheck();
  const inputs = new Map<string,Promise<PeriodInput>>();
  const reports = new Map<string,Promise<Awaited<ReturnType<typeof getReport>> | null>>();
  return (id:string) => {
    if (!id) return Promise.resolve(null);
    if (!reports.has(id)) reports.set(id,(async () => {
      try {
        const report = await getReport(id);
        if (report.row.state !== '확정') return null;
        const key = scope(report.period);
        if (!inputs.has(key)) inputs.set(key,collectPeriod(report.period));
        return await visible(report.row,report.period,await inputs.get(key)!) ? report : null;
      } catch (error) {
        if ((error instanceof HttpError && error.status === 404) ||
            (error instanceof NotionError && error.upstreamStatus === 404)) return null;
        throw error;
      }
    })());
    return reports.get(id)!;
  };
}

async function visibleGoal(goal:Goal, visible:ReturnType<typeof makeVisibilityCheck>) {
  if (goal.reportId && !await visible(goal.reportId)) return null;
  const history = (await Promise.all(goal.history.map(async event =>
    !event.reportId || await visible(event.reportId) ? event : null))).filter(event => event !== null);
  return {...goal,history,evaluation:history.filter(event=>event.opinion === undefined).at(-1)?.evaluation ?? ''};
}
export async function publicGoals() {
  const visible = makeVisibilityCheck();
  const safe = await Promise.all((await listGoals()).map(goal=>visibleGoal(goal,visible)));
  return safe.filter(goal=>goal !== null);
}

export async function generatePeriod(period: Period, regenerate: boolean, expectedVersion: unknown) {
  return withReportLock(scope(period),async guard => {
    const [input, rows] = await Promise.all([collectPeriod(period),versions(period)]);
    if (!input.stats.mealCount) throw new HttpError(422,'공유된 식단 기록이 있는 기간을 선택해 주세요.');
    const latest = rows[0];
    if (regenerate && expectedVersion !== (latest?.version ?? 0)) throw race();
    if (!regenerate && latest?.fingerprint === input.fingerprint && await makeSourceCheck()(latest,period,input)) return latest;
    if (!regenerate && latest) throw race();
    const [goals, weekly] = await Promise.all([publicGoals(),weeklyReferences(period,input)]);
    const activeGoals = goals.filter(goal => {
      const activeAt = Date.parse(goal.history.find(event => !event.legacy && event.opinion === undefined && ['진행중','유지'].includes(event.status))?.at ?? goal.proposedAt);
      return !!goal.reportId && ['진행중','유지'].includes(goal.status) &&
        Number.isFinite(activeAt) && kstDate(activeAt) < period.start;
    });
    const visibleGoals = makeVisibilityCheck();
    const goalReports = await Promise.all(activeGoals.map(goal=>visibleGoals(goal.reportId)));
    if (goalReports.some(report=>!report)) throw race();
    const dependencies = [...weekly,...goalReports.flatMap(report=>report ? [report.row] : [])];
    const sources = [...new Map([...input.refs,...dependencies.flatMap(row=>row.sources)].map(ref=>[refKey(ref),ref])).values()];
    const result = await generateDraft(period,input,activeGoals,weekly.map(row => ({id:row.id,feedback:row.feedback})));
    const fresh = await collectPeriod(period);
    if (fresh.fingerprint !== input.fingerprint || !await makeSourceCheck()({sources},period,fresh)) throw race();
    const version = (latest?.version ?? 0) + 1;
    return guard.create(scope(period) + ':' + version,() => writeDraft(period,{
      version,state:'AI 초안',createdAt:new Date().toISOString(),feedback:result.draft.summary.text,
      ...result,sources,fingerprint:input.fingerprint,stats:input.stats,weeklyRefs:weekly.map(row=>row.id),actor:'anonymous',
    }));
  });
}

export async function reportHistory(id:string) {
  const {period} = await getReport(id);
  const [rows,input] = await Promise.all([versions(period),collectPeriod(period)]);
  const visible = makeSourceCheck();
  return Promise.all(rows.filter(row=>row.state === '확정').map(async row =>
    await visible(row,period,input) ? row : {id:row.id,version:row.version,confirmedAt:row.confirmedAt,hidden:true as const}));
}

function validFeedback(value:unknown) {
  if (typeof value !== 'string' || !value.trim() || value.length > feedbackLimit) {
    throw new HttpError(400,'강사 의견을 1자 이상 6,000자 이하로 입력해 주세요.');
  }
  return value.trim();
}

export async function createManualPeriod(period:Period,body:Record<string,unknown>) {
  const feedback = validFeedback(body.feedback);
  return withReportLock(scope(period),async guard => {
    const [input,rows] = await Promise.all([collectPeriod(period),versions(period)]);
    const latest = rows[0];
    if (body.expectedVersion !== (latest?.version ?? 0)) throw race();
    if (latest && latest.state !== '확정' && latest.fingerprint === input.fingerprint &&
        await makeSourceCheck()(latest,period,input)) throw race();
    const version = (latest?.version ?? 0) + 1;
    return guard.create(scope(period) + ':' + version,() => writeDraft(period,{
      version,state:'검토중',createdAt:new Date().toISOString(),feedback,draft:null,model:'',
      sources:input.refs,fingerprint:input.fingerprint,stats:input.stats,weeklyRefs:[],actor:'anonymous',
    }));
  });
}

export async function editPeriod(id:string, body:Record<string,unknown>, confirm:boolean) {
  const {period} = await getReport(id);
  const feedback = validFeedback(body.feedback);
  return withReportLock(scope(period),async guard => {
    const [{row}, rows, input] = await Promise.all([getReport(id),versions(period),collectPeriod(period)]);
    if (rows[0]?.id !== id || body.expectedVersion !== row.version || body.expectedRevision !== row.revision ||
        row.state === '확정' || row.fingerprint !== input.fingerprint || !await makeSourceCheck()(row,period,input)) throw race();
    await guard.ensure();
    return updateReport(row,feedback.trim(),confirm);
  });
}

export async function proposeGoal(body: Record<string,unknown>) {
  const {reportId,index} = body;
  if (typeof reportId !== 'string' || typeof index !== 'number' || !Number.isInteger(index) || index < 0) {
    throw new HttpError(400,'목표 제안의 리포트와 항목을 확인해 주세요.');
  }
  return withReportLock('goal-proposal:' + reportId + ':' + index,async guard => {
    const visible = makeVisibilityCheck();
    const report = await visible(reportId);
    const proposed = report?.row.draft?.proposedGoals[index];
    if (!report || !proposed) throw new HttpError(404,'확정된 리포트의 목표를 찾을 수 없습니다.');
    const key = reportId + ':' + index;
    const existing = await listGoals(key);
    if (existing.length > 1) throw race();
    if (existing.length) return visibleGoal(existing[0],visible);
    return guard.create('goal:' + key,() => createGoal({key,title:proposed.title,kind:proposed.kind,
      criteria:proposed.text,status:'제안',approved:false,reportId,proposedAt:new Date().toISOString(),
      source:proposed.evidence.join(', '),
    }));
  });
}

export async function editGoal(id:string,body:Record<string,unknown>) {
  return withReportLock('goal:' + id,async guard => {
    const goal = await getGoal(id);
    if (body.expectedRevision !== goal.revision) throw race();
    const status = body.status;
    const evaluation = body.evaluation ?? '';
    const reportId = body.reportId ?? '';
    if (typeof status !== 'string' || !goalStates.includes(status as never) ||
      typeof evaluation !== 'string' || evaluation.length > 1200 || typeof reportId !== 'string') {
      throw new HttpError(400,'목표 상태와 평가 내용을 확인해 주세요.');
    }
    const visible = makeVisibilityCheck();
    if (goal.reportId && !await visible(goal.reportId)) throw new HttpError(404,'공유 근거가 남아 있는 목표를 찾을 수 없습니다.');
    if (evaluation.trim() && !reportId) throw new HttpError(400,'평가 근거로 확정 리포트를 선택해 주세요.');
    if (reportId && !await visible(reportId)) throw new HttpError(400,'공유 근거가 남아 있는 확정 리포트를 선택해 주세요.');
    if (goal.status === '종료') throw new HttpError(409,'종료된 목표입니다.');
    const event:Goal['history'][number] = {revision:randomUUID(),status,evaluation:evaluation.trim(),reportId,
      approved:goal.approved,at:new Date().toISOString(),actor:'anonymous'};
    await guard.ensure();
    return visibleGoal(await updateGoal(goal,event),visible);
  });
}

export async function saveGoalOpinion(id:string,body:Record<string,unknown>) {
  const opinion = body.opinion;
  if (typeof opinion !== 'string' || !opinion.trim() || opinion.length > 1200) {
    throw new HttpError(400,'강사 의견을 1자 이상 1,200자 이하로 입력해 주세요.');
  }
  return withReportLock('goal:' + id,async guard => {
    const goal = await getGoal(id);
    if (body.expectedRevision !== goal.revision) throw race();
    const visible = makeVisibilityCheck();
    if (goal.reportId && !await visible(goal.reportId)) throw new HttpError(404,'공유 근거가 남아 있는 목표를 찾을 수 없습니다.');
    const event:Goal['history'][number] = {
      revision:randomUUID(),at:new Date().toISOString(),actor:'anonymous',status:goal.status,
      approved:goal.approved,evaluation:'',reportId:'',opinion:opinion.trim(),
    };
    await guard.ensure();
    return visibleGoal(await updateGoal(goal,event),visible);
  });
}
