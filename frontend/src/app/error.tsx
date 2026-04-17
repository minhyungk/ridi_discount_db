"use client";

const BLUE = "#1e9eff";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
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
      <p style={{ fontSize: 14, color: "#6e6e73", marginBottom: 8 }}>
        잠시 후 다시 시도해 주세요.
      </p>
      {process.env.NODE_ENV !== "production" && (
        <pre
          style={{
            fontSize: 11,
            color: "#e0483e",
            background: "#fff5f5",
            padding: 12,
            borderRadius: 8,
            textAlign: "left",
            overflow: "auto",
            marginBottom: 16,
          }}
        >
          {error.message}
          {error.digest && `\ndigest: ${error.digest}`}
        </pre>
      )}
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
