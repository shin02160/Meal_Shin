export type Meal = {
  id: string;
  title: string;
  category: string;
  startAt: string;
  endAt: string | null;
  durationMinutes: number | null;
  displayDuration: string;
  foods: string;
  sharedNote: string;
  mealNote?: string;
  images: string[];
};
export type Review = {
  date: string;
  feedback: string;
  status: 'missing' | 'saved';
  updatedAt?: string;
};
export const feedbackLimit = 6000;
