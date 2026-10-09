import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '选股 coPilot',
  description: '可追溯、可重复执行的银行股筛选工作台。',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
