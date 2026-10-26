import type { Metadata } from "next";
import { Jua } from "next/font/google";
import "./globals.css";

const jua = Jua({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-jua",
});

export const metadata: Metadata = {
  title: "럭키팡 (LUCKY-PANG) | 실시간 수학 퀴즈 게임",
  description: "초등 5학년 1학기 [약수와 배수] 단원을 재미있는 럭키팡 추첨 게임으로 학습하는 실시간 수학 퀴즈 플랫폼입니다.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${jua.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-jua">
        {children}
      </body>
    </html>
  );
}
