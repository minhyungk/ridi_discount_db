"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

type Chip =
  | { kind: "type"; value: "comic" | "novel"; label: string }
  | { kind: "cat"; value: string; count: number };

export default function CategoryChips({
  topCategories,
}: {
  topCategories: { name: string; count: number }[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();

  const currentType = params.get("type"); // "comic" | "novel" | null
  const currentCats = params.getAll("cat"); // string[]

  const buildHref = (next: { type?: string | null; cat?: string[] }) => {
    const sp = new URLSearchParams();
    const q = params.get("q");
    if (q) sp.set("q", q);

    const type = "type" in next ? next.type : currentType;
    if (type) sp.set("type", type);

    const cats = "cat" in next ? next.cat : currentCats;
    (cats ?? []).forEach((c) => sp.append("cat", c));

    const qs = sp.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };

  const onClickType = (value: "comic" | "novel") => {
    router.push(buildHref({ type: currentType === value ? null : value }));
  };

  const onClickCat = (value: string) => {
    const exists = currentCats.includes(value);
    const nextCats = exists
      ? currentCats.filter((c) => c !== value)
      : [...currentCats, value];
    router.push(buildHref({ cat: nextCats }));
  };

  const chips: Chip[] = [
    { kind: "type", value: "comic", label: "만화" },
    { kind: "type", value: "novel", label: "라노벨" },
    ...topCategories.map<Chip>((c) => ({
      kind: "cat",
      value: c.name,
      count: c.count,
    })),
  ];

  const hasAnyFilter = currentType !== null || currentCats.length > 0;

  return (
    <div className="chip-strip">
      {chips.map((chip) => {
        const active =
          chip.kind === "type"
            ? currentType === chip.value
            : currentCats.includes(chip.value);
        const onClick = () =>
          chip.kind === "type" ? onClickType(chip.value) : onClickCat(chip.value);
        const label =
          chip.kind === "type" ? chip.label : chip.value;

        return (
          <button
            key={`${chip.kind}:${chip.value}`}
            onClick={onClick}
            className={active ? "chip chip-active" : "chip"}
            type="button"
          >
            {label}
          </button>
        );
      })}
      {hasAnyFilter && (
        <button
          onClick={() => router.push(buildHref({ type: null, cat: [] }))}
          className="chip chip-clear"
          type="button"
          aria-label="필터 초기화"
        >
          초기화 ✕
        </button>
      )}
    </div>
  );
}
