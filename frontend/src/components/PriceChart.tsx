"use client";

import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const BLUE = "#1e9eff";

export type PricePoint = {
  ts: number; // timestamp (ms)
  price: number;
  note?: string | null; // 세트 정보 (예: "완결 세트 · 총 13권") — 툴팁 표시용
};

const DAY_MS = 86_400_000;

function fmtShort(ts: number) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}.${d.getDate()}`;
}

function fmtLong(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
}

export default function PriceChart({
  data,
  fullPrice,
  allTimeLow,
}: {
  data: PricePoint[];
  fullPrice: number | null;
  allTimeLow: number | null;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (data.length === 0) {
    return (
      <div
        style={{
          padding: "60px 20px",
          textAlign: "center",
          color: "#6e6e73",
          fontSize: 14,
        }}
      >
        가격 히스토리가 없습니다.
      </div>
    );
  }

  if (!mounted) {
    return <div style={{ width: "100%", height: 360 }} aria-hidden />;
  }

  const prices = data.map((d) => d.price);
  const maxPrice = Math.max(...prices, fullPrice ?? 0);
  const topPadding = Math.max(Math.round(maxPrice * 0.05), 500);

  return (
    <div style={{ width: "100%", height: 360 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 16, right: 24, bottom: 8, left: 8 }}>
          <CartesianGrid stroke="rgba(0,0,0,0.06)" vertical={false} />
          <XAxis
            dataKey="ts"
            type="number"
            scale="time"
            domain={[
              (dataMin: number) => dataMin - DAY_MS,
              (dataMax: number) => dataMax + DAY_MS,
            ]}
            tick={{ fontSize: 11, fill: "#6e6e73" }}
            tickLine={false}
            axisLine={{ stroke: "rgba(0,0,0,0.1)" }}
            tickFormatter={fmtShort}
          />
          <YAxis
            domain={[0, maxPrice + topPadding]}
            type="number"
            allowDataOverflow={true}
            tick={{ fontSize: 11, fill: "#6e6e73" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) =>
              v >= 10000
                ? `${(v / 10000).toFixed(1)}만`
                : v.toLocaleString()
            }
            width={52}
          />
          <Tooltip
            contentStyle={{
              background: "#fff",
              border: "1px solid rgba(0,0,0,0.08)",
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(v: number, _name, item) => {
              const note = (item?.payload as PricePoint | undefined)?.note;
              return [`${v.toLocaleString()}원${note ? ` · ${note}` : ""}`, "가격"];
            }}
            labelFormatter={(ts: number) => fmtLong(ts)}
            labelStyle={{ color: "#1d1d1f", fontWeight: 600 }}
          />
          {fullPrice != null && (
            <ReferenceLine
              y={fullPrice}
              stroke="#a1a1a6"
              strokeDasharray="4 4"
              label={{
                value: `정가 ${fullPrice.toLocaleString()}원`,
                fill: "#6e6e73",
                fontSize: 11,
                position: "insideTopRight",
              }}
            />
          )}
          {allTimeLow != null && (
            <ReferenceLine
              y={allTimeLow}
              stroke={BLUE}
              strokeDasharray="4 4"
              label={{
                value: `최저가 ${allTimeLow.toLocaleString()}원`,
                fill: BLUE,
                fontSize: 11,
                position: "insideBottomRight",
              }}
            />
          )}
          <Line
            type="stepAfter"
            dataKey="price"
            stroke={BLUE}
            strokeWidth={2.5}
            dot={{ r: 3, fill: BLUE }}
            activeDot={{ r: 5 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
