import { progressFields } from '../lib/goal-progress';
import { progressStates } from '../lib/progress-contracts';
import { mealFields, mealSource, notion, reviewFields, reviewSource } from '../lib/notion';

async function check(id: string, expected: Record<string,string>, label: string) {
  const source = await notion<{properties:Record<string,{type:string; relation?:{data_source_id?:string}; select?:{options:{name:string}[]}}>}>('/data_sources/' + encodeURIComponent(id));
  const errors = Object.entries(expected).filter(([field,type]) => source.properties[field]?.type !== type).map(([field,type]) => field + ' (' + type + ')');
  if (label === 'Daily Review' && !source.properties['리뷰 상태']?.select?.options.some(option => option.name === '완료')) {
    errors.push('리뷰 상태 (완료 옵션)');
  }
  if (label === 'Goal Progress') {
    for (const [name,values] of Object.entries({'달성 상태':progressStates,'평가 출처':['AI 초안','사용자 입력','강사 평가']})) {
      const configured = source.properties[name]?.select?.options.map(option=>option.name) ?? [];
      if (values.some(value=>!configured.includes(value))) errors.push(name + ' (선택지 확인)');
    }
    for (const [name,target] of Object.entries({'개선 목표':process.env.NOTION_IMPROVEMENT_TRACKER_DATA_SOURCE_ID || '41a6d8c5-8de1-81f4-ad1a-000b48430769','관련 식단':mealSource()})) {
      if (source.properties[name]?.relation?.data_source_id !== target) errors.push(name + ' (관계 확인)');
    }
  }
  if (errors.length) throw new Error(label + ' 속성 확인 필요 · ' + errors.join(', '));
  process.stdout.write(label + ' 속성 확인 완료\n');
}

Promise.resolve().then(async () => {
  await check(mealSource(), {...mealFields, '식사 메모':'rich_text'}, 'Meal Log');
  await check(reviewSource(), reviewFields, 'Daily Review');
  const progress = process.env.NOTION_GOAL_PROGRESS_DATA_SOURCE_ID;
  if (progress) await check(progress,{...progressFields,'기록명':'title','강사 확정':'checkbox','작성 일시':'created_time','수정 일시':'last_edited_time'},'Goal Progress');
}).catch(error => {
  process.stderr.write((error instanceof Error ? error.message : '스키마를 확인할 수 없습니다.') + '\n');
  process.exitCode = 1;
});
