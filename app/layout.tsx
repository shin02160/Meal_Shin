import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './styles.css';

export const metadata: Metadata = {
  title: '하루 식단 리뷰 | Meal Note',
  description: '공유된 식단을 확인하고 하루 총평을 남겨주세요.',
  robots: {index:false, follow:false},
};
export default function Layout({children}: {children:ReactNode}) {
  return <html lang="ko"><body>{children}</body></html>;
}
