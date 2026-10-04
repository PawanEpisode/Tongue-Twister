/** Google refuses OAuth inside embedded webviews (Instagram, Facebook, LinkedIn, TikTok...). */
export function isInAppBrowser(ua: string): boolean {
  return /(FBAN|FBAV|Instagram|LinkedInApp|Line\/|MicroMessenger|TikTok|Snapchat|Twitter)/i.test(
    ua,
  )
}
