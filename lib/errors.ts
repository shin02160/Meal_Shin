export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
export function required(name: string) {
  const value = process.env[name];
  if (!value) throw new HttpError(503, '서비스 설정을 확인해 주세요.');
  return value;
}
export function json(data: unknown, status = 200, headers?: HeadersInit) {
  const resultHeaders = new Headers(headers);
  resultHeaders.set('Cache-Control', 'private, no-store');
  return Response.json(data, {status, headers: resultHeaders});
}
