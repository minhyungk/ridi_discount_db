"use client";

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
  date: string;
  price: number;
};

export default function PriceChart({
  data,
  fullPrice,
  allTimeLow,
}: {
  data: PricePoint[];
  fullPrice: number | null;
  allTimeLow: number | null;
}) {
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

  const prices = data.map((d) => d.price);
  const maxPrice = Math.max(...prices, fullPrice ?? 0);
  const topPadding = Math.max(Math.round(maxPrice * 0.05), 500);

  return (
    <div style={{ width: "100%", height: 360 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 16, right: 24, bottom: 8, left: 8 }}>
          <CartesianGrid stroke="rgba(0,0,0,0.06)" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: "#6e6e73" }}
            tickLine={false}
            axisLine={{ stroke: "rgba(0,0,0,0.1)" }}
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
            formatter={(v: number) => [`${v.toLocaleString()}원`, "가격"]}
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
