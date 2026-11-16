export const publicHost = 'mealshin-nine.vercel.app';

export function isPublicHost(host: string) {
  return host.toLowerCase() === publicHost;
}
