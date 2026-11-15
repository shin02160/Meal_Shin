import { mealFields, mealSource, notion, reviewFields, reviewSource } from '../lib/notion';

async function check(id: string, expected: Record<string,string>, label: string) {
  const source = await notion<{properties:Record<string,{type:string; select?:{options:{name:string}[]}}>}>('/data_sources/' + encodeURIComponent(id));
  const errors = Object.entries(expected).filter(([field,type]) => source.properties[field]?.type !== type).map(([field,type]) => field + ' (' + type + ')');
  if (label === 'Daily Review' && !source.properties['리뷰 상태']?.select?.options.some(option => option.name === '완료')) {
    errors.push('리뷰 상태 (완료 옵션)');
  }
  if (errors.length) throw new Error(label + ' 속성 확인 필요 · ' + errors.join(', '));
  process.stdout.write(label + ' 속성 확인 완료\n');
}

Promise.resolve().then(async () => {
  await check(mealSource(), {...mealFields, '식사 메모':'rich_text'}, 'Meal Log');
  await check(reviewSource(), reviewFields, 'Daily Review');
}).catch(error => {
  process.stderr.write((error instanceof Error ? error.message : '스키마를 확인할 수 없습니다.') + '\n');
  process.exitCode = 1;
});
