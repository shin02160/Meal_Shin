export const ownerHost = 'mealshin-nine.vercel.app';

export function isOwnerHost(host: string) {
  return host.toLowerCase() === ownerHost;
}
