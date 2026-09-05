type ToyNavigateRequest = {
  type: 'video';
  id: string;
};

type ToySdk = {
  isSupport(ability: 'navigate'): Promise<boolean>;
  navigate(request: ToyNavigateRequest): Promise<void>;
};

declare global {
  interface Window {
    toy?: ToySdk;
  }
}

export async function openBilibiliVideo(videoBvid: string) {
  const toy = window.toy;
  if (!toy) throw new Error('Toy SDK 未加载，暂时无法打开教学视频');

  const supported = await toy.isSupport('navigate');
  if (!supported) throw new Error('当前环境不支持 Toy 视频跳转');

  await toy.navigate({ type: 'video', id: videoBvid });
}
