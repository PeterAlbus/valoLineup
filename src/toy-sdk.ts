type ToyNavigateRequest = {
  type: 'video' | 'space';
  id: string;
};

type ToySdk = {
  isSupport(ability: 'navigate' | 'getUserProfile'): Promise<boolean>;
  getUserProfile(): Promise<{ avatar: string; nickname: string; toyOpenId?: string }>;
  navigate(request: ToyNavigateRequest): Promise<void>;
};

declare global {
  interface Window {
    toy?: ToySdk;
  }
}

export async function getToyUploader() {
  const toy = window.toy;
  if (!toy || !await toy.isSupport('getUserProfile')) throw new Error('当前环境无法获取 B站身份，请在 Toy 页面授权后编辑');
  const profile = await toy.getUserProfile();
  if (!profile.nickname?.trim()) throw new Error('未获得有效的 B站用户资料');
  return { name: profile.nickname, source: 'toy' as const, ...(profile.toyOpenId ? { toyOpenId: profile.toyOpenId } : {}) };
}

export async function openBilibiliProfile(uid: string) {
  if (!/^[1-9][0-9]{0,19}$/.test(uid)) throw new Error('无效的 B站 UID');
  if (window.toy && await window.toy.isSupport('navigate')) {
    await window.toy.navigate({ type: 'space', id: uid });
  } else window.location.assign(`https://space.bilibili.com/${uid}`);
}

export async function openBilibiliVideo(videoBvid: string) {
  const toy = window.toy;
  if (!toy) throw new Error('Toy SDK 未加载，暂时无法打开教学视频');

  const supported = await toy.isSupport('navigate');
  if (!supported) throw new Error('当前环境不支持 Toy 视频跳转');

  await toy.navigate({ type: 'video', id: videoBvid });
}
