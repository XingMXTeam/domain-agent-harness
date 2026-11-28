// finance 域执行器：纯代码。计算与对账不经模型的手。
// 事实由取数阶段经 save_fact 落盘（过 facts.schema.json 校验），本文件只按键取值计算。

export interface Fact {
  id: string;
  name: string;
  value: number; // 单位：百万元（落盘时已统一）
  unit: string;
  period: string;
  source: string;
}

export interface ReconcileResult {
  pass: boolean;
  roa: string; // 如 "1.28"
  roae: string; // 如 "14.49"
  missing: string[]; // 缺失的事实键（缺键直接报错，绝不用模型猜的数顶替）
  detail: string; // 失败分类：缺键 / 取错行 / 口径漂移，供模型解释与重取定位
}

const NEED = [
  "ni_attr",
  "assets_end",
  "assets_beg",
  "eq_end",
  "eq_beg",
  "other_eq_end",
  "other_eq_beg",
  "div_pref",
  "int_perp",
] as const;

// 披露值 = 外部真值，来自年报主要会计数据章节；换公司/年份时改这里，不许运行时现查现信
const DISCLOSED = { roa: "1.28", roae: "14.49" };

const pct = (x: number) => (x * 100).toFixed(2);

export function computeAndReconcile(facts: Fact[]): ReconcileResult {
  const byId = new Map(facts.map((f) => [f.id, f.value]));
  const missing = NEED.filter((k) => !byId.has(k));
  if (missing.length) {
    return {
      pass: false,
      roa: "",
      roae: "",
      missing: [...missing],
      detail: `缺键：${missing.join(", ")}——回图谱重取，不许估算`,
    };
  }
  const v = (k: (typeof NEED)[number]) => byId.get(k)!;

  // 逐项口径（与 spec.md 一一对应，改口径两处同步改）
  const avgAssets = (v("assets_end") + v("assets_beg")) / 2;
  const roa = pct(v("ni_attr") / avgAssets); // 分子不扣股息/利息

  const avgEq = (v("eq_end") + v("eq_beg")) / 2;
  const avgOtherEq = (v("other_eq_end") + v("other_eq_beg")) / 2;
  const ordinaryProfit = v("ni_attr") - v("div_pref") - v("int_perp");
  const roae = pct(ordinaryProfit / (avgEq - avgOtherEq));

  const pass = roa === DISCLOSED.roa && roae === DISCLOSED.roae;
  const detail = pass
    ? "对账通过：与年报披露值一致"
    : [
        roa !== DISCLOSED.roa
          ? `ROA 算得 ${roa}，披露 ${DISCLOSED.roa}——优先怀疑取错行（净利润总数 vs 归母）`
          : "",
        roae !== DISCLOSED.roae
          ? `ROAE 算得 ${roae}，披露 ${DISCLOSED.roae}——优先怀疑分子未扣股息/利息，或分母未扣其他权益工具`
          : "",
      ]
        .filter(Boolean)
        .join("；");
  return { pass, roa, roae, missing: [], detail };
}
