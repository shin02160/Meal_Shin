import type { Period } from './period';
import type { PeriodInput } from './analysis-input';

export const goalKinds = ['식사 시간','음식 구성','식사 습관','기타'] as const;
export const goalStates = ['제안','진행중','유지','보류','종료'] as const;
export type Claim = {text:string; evidence:string[]};
export type ProposedGoal = Claim & {title:string; kind:typeof goalKinds[number]};
export type Draft = {
  summary:Claim; observations:Claim[]; strengths:Claim[]; interpretations:Claim[]; improvements:Claim[];
  goalAssessments:(Claim & {goalId:string})[]; proposedGoals:ProposedGoal[]; limitations:string[];
};
export type ReportState = 'AI 초안' | '검토중' | '확정';
export type ReportVersion = {
  id:string; version:number; revision:string; state:ReportState; createdAt:string; confirmedAt?:string;
  feedback:string; draft:Draft|null; sources:PeriodInput['refs']; fingerprint:string;
  model:string; actor:'anonymous'; stats:PeriodInput['stats']; weeklyRefs:string[];
};
export type Goal = {
  id:string; key:string; title:string; kind:string; criteria:string; source:string;
  status:string; approved:boolean; reportId:string; proposedAt:string; revision:string;
  evaluation:string; evaluatedAt:string; history:GoalEvent[];
};
export type GoalEvent = {revision?:string; legacy?:true; opinion?:string; at:string; status:string; approved:boolean; evaluation:string; reportId:string; actor:'anonymous'};
export type ReportView = {period:Period; stats:PeriodInput['stats']; current:ReportVersion|null; final:ReportVersion|null; needsReview:boolean; currentStale:boolean; historyId?:string; daily:PeriodInput['daily']};
