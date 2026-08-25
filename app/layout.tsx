import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? 'https://lineup-atlas-cn.peteralbus.chatgpt.site'),
  title: 'Lineup Atlas｜无畏契约点位图鉴',
  description: '按地图与英雄浏览无畏契约技能 Lineup，查看落点、站位、瞄点和操作方法。',
  icons: { icon: '/agents/sova/recon-bolt.png' },
  openGraph: {
    title: 'Lineup Atlas｜无畏契约点位图鉴',
    description: '落点 · 站位 · 瞄点，一张地图找到可用的 Lineup。',
    images: [{ url: '/og.png', width: 1680, height: 945, alt: 'Lineup Atlas 社交分享卡' }],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Lineup Atlas｜无畏契约点位图鉴',
    description: '落点 · 站位 · 瞄点，一张地图找到可用的 Lineup。',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
