export const progressStates = ['달성','부분달성','미달성','판단불가'] as const;
export type ProgressState = typeof progressStates[number];
export type Progress = {
  id:string; day:string; goalId:string; revision:string; status:ProgressState;
  mealIds:string[]; evidence:string; memo:string; opinion:string; confirmed:boolean;
  source:'AI 초안'|'사용자 입력'|'강사 평가'; historyCount:number;
};
export type ProgressSummary = {
  eligible:boolean; achieved:number; partial:number; missed:number; unknown:number;
  unrecorded:number; drafts:number; confirmed:number; rate:number|null; lastDay:string|null; days:{day:string;status:ProgressState|null;draft:boolean}[];
};
export type ProgressView = {record:Progress|null; history:Omit<Progress,'historyCount'>[]; hidden:boolean; meals:{id:string;title:string;category:string;startAt:string}[]};
export type GoalProgressSummary = {goalId:string; title:string; summary:ProgressSummary; latest?:{day:string;status:ProgressState;confirmed:boolean}|null};

export type ProgressDraft = {id:string;status:ProgressState;evidence:string;mealIds:string[]};
