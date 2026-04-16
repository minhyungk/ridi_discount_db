import type { Metadata } from "next";
import { Suspense } from "react";
import Nav from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "RidiDB — 리디북스 할인 트래커",
  description: "리디북스 세트도서 가격 변동을 한눈에 추적하세요",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">
        <Suspense fallback={null}>
          <Nav />
        </Suspense>
        {children}
        <footer
          style={{
            padding: "24px 24px 32px",
            textAlign: "center",
            fontSize: 11,
            color: "#a1a1a6",
            borderTop: "1px solid rgba(0,0,0,0.06)",
            marginTop: 40,
          }}
        >
          본 사이트는 리디북스와 관련 없는 제 3자 운영 비영리 사이트입니다.
        </footer>
      </body>
    </html>
  );
}
