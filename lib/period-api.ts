import { todayKst } from './date';
import { dashboardRanges, type DashboardRange } from './goal-dashboard';
import { readGoalDashboard, readProgress, saveProgress, summarizeGoals } from './goal-progress';
import { HttpError, json } from './errors';
import { periodFor } from './period';
import { createManualPeriod, saveGoalOpinion, editGoal, editPeriod, generatePeriod, proposeGoal, publicGoals, readPeriod, reportHistory } from './period-reviews';
import { limitWrites } from './report-storage';

export async function periodApi(request:Request,path:string[], readBody:()=>Promise<Record<string,unknown>>) {
  const [area,id,action] = path;
  const method = request.method;
  if (area === 'goals' && method === 'GET' && id === 'dashboard' && path.length === 2) {
    const range = new URL(request.url).searchParams.get('range') as DashboardRange;
    if (!dashboardRanges.includes(range)) throw new HttpError(400,'조회 기간을 선택해 주세요.');
    return json(await readGoalDashboard(range,todayKst()));
  }
  if (area === 'goals' && method === 'GET' && id === 'progress-summary' && path.length === 2) {
    const params = new URL(request.url).searchParams;
    return json(await summarizeGoals(periodFor(params.get('type'),params.get('key')),todayKst(),params.get('latest') === '1'));
  }
  if (area === 'goals' && action === 'progress' && path.length === 3) {
    if (method === 'GET') return json(await readProgress(id,new URL(request.url).searchParams.get('day')));
    if (method === 'POST') {
      const body = await readBody();
      await limitWrites(body.action === 'draft' ? 'progress-ai' : 'progress',body.action === 'draft' ? 4 : 25,60);
      return json(await saveProgress(id,body));
    }
  }
  if (method === 'GET') {
    if (area === 'reports' && path.length === 1) {
      const params = new URL(request.url).searchParams;
      return json(await readPeriod(periodFor(params.get('type'),params.get('key'))));
    }
    if (area === 'reports' && path.length === 3 && action === 'history') return json(await reportHistory(id));
    if (area === 'goals' && path.length === 1) return json(await publicGoals());
  }
  if (area === 'reports' && path.length === 1 && method === 'POST') {
    const body = await readBody();
    const period = periodFor(body.type,body.key);
    await limitWrites('review',25,60);
    return json(await createManualPeriod(period,body),201);
  }
  if (area === 'reports' && path.length === 2 && id === 'generate' && method === 'POST') {
    const body = await readBody();
    const period = periodFor(body.type,body.key);
    await limitWrites('generate',4,60);
    return json(await generatePeriod(period,body.regenerate === true,body.expectedVersion));
  }
  if (area === 'reports' && ((path.length === 2 && method === 'PATCH') ||
      (path.length === 3 && action === 'confirm' && method === 'POST'))) {
    const body = await readBody();
    await limitWrites('review',25,60);
    return json(await editPeriod(id,body,action === 'confirm'));
  }
  if (area === 'goals' && path.length === 1 && method === 'POST') {
    const body = await readBody();
    await limitWrites('goal',20,60);
    return json(await proposeGoal(body));
  }
  if (area === 'goals' && path.length === 3 && action === 'opinion' && method === 'POST') {
    const body = await readBody();
    await limitWrites('goal',20,60);
    return json(await saveGoalOpinion(id,body));
  }
  if (area === 'goals' && path.length === 2 && method === 'PATCH') {
    const body = await readBody();
    await limitWrites('goal',20,60);
    return json(await editGoal(id,body));
  }
  throw new HttpError(404,'요청한 페이지를 찾을 수 없습니다.');
}
