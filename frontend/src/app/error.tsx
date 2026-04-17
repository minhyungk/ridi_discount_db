"use client";

import { useEffect } from "react";

const BLUE = "#1e9eff";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // RSC 스트림 중단 등 일시적 에러는 자동 재시도
    const timer = setTimeout(() => reset(), 1000);
    return () => clearTimeout(timer);
  }, [error, reset]);

  return (
    <main
      style={{
        maxWidth: 480,
        margin: "120px auto",
        padding: "0 24px",
        textAlign: "center",
      }}
    >
      <h2 style={{ fontSize: 20, fontWeight: 700, color: "#1d1d1f", marginBottom: 8 }}>
        페이지를 불러오지 못했습니다
      </h2>
      <p style={{ fontSize: 14, color: "#6e6e73", marginBottom: 24 }}>
        잠시 후 자동으로 다시 시도합니다.
      </p>
      <button
        onClick={reset}
        style={{
          padding: "10px 24px",
          fontSize: 14,
          fontWeight: 600,
          color: "#fff",
          background: BLUE,
          border: "none",
          borderRadius: 999,
          cursor: "pointer",
        }}
      >
        다시 시도
      </button>
    </main>
  );
}
