export class ReviewError extends Error {
  constructor(public status:number,message:string) { super(message); }
}

export async function call<T>(path:string, method = 'GET', data?:unknown, signal?:AbortSignal):Promise<T> {
  const response = await fetch('/api/' + path,{
    method,cache:'no-store',signal,
    ...(data === undefined ? {} : {body:JSON.stringify(data),headers:{'Content-Type':'application/json'}}),
  });
  const body = await response.json();
  if (!response.ok) throw new ReviewError(response.status,body.error ?? '요청을 처리할 수 없습니다.');
  return body;
}
export function errorText(error:unknown) {
  return error instanceof ReviewError ? error.message : '연결 상태를 확인한 뒤 다시 시도해 주세요.';
}
