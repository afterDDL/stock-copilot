import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '选股 coPilot',
  description: '可追溯、可重复执行的沪深北 A 股选股工作台。',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
