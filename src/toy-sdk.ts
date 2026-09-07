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

export const anonymousUploader = { name: '匿名编辑者', source: 'local' as const };

export async function getToyUploader() {
  try {
    const toy = window.toy;
    if (!toy || !await toy.isSupport('getUserProfile')) return anonymousUploader;
    const profile = await toy.getUserProfile();
    if (!profile.nickname?.trim()) return anonymousUploader;
    return { name: profile.nickname.trim(), source: 'toy' as const, ...(profile.toyOpenId ? { toyOpenId: profile.toyOpenId } : {}) };
  } catch {
    return anonymousUploader;
  }
}

export async function openBilibiliProfile(uid: string) {
  if (!/^[1-9][0-9]{0,19}$/.test(uid)) throw new Error('无法识别这位作者的 B站主页');
  if (window.toy && await window.toy.isSupport('navigate')) {
    await window.toy.navigate({ type: 'space', id: uid });
  } else window.location.assign(`https://space.bilibili.com/${uid}`);
}

export async function openBilibiliVideo(videoBvid: string) {
  const toy = window.toy;
  if (!toy) throw new Error('暂时无法打开教学视频，请刷新页面后重试');

  const supported = await toy.isSupport('navigate');
  if (!supported) throw new Error('请在 B站 Toy 页面打开教学视频');

  await toy.navigate({ type: 'video', id: videoBvid });
}
