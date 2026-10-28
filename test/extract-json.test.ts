import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { extractJson } from "../src/runtime/pipeline-engine.js";

describe("extractJson", () => {
  it("解析裸 JSON", () => {
    assert.deepEqual(extractJson('{"domain":"qa"}'), { domain: "qa" });
  });

  it("解析 ```json 代码块", () => {
    assert.deepEqual(extractJson('```json\n{"domain":"build"}\n```'), { domain: "build" });
  });

  it("解析带前后说明文字的 JSON", () => {
    const out = extractJson('好的，路由结果如下：\n{"domain":"gop"}\n希望有帮助。');
    assert.deepEqual(out, { domain: "gop" });
  });

  it("解析数组", () => {
    assert.deepEqual(extractJson('[1, 2, 3]'), [1, 2, 3]);
  });

  it("无法解析时抛错", () => {
    assert.throws(() => extractJson("这里没有 JSON"), /无法解析为 JSON/);
  });

  it("空输出抛错", () => {
    assert.throws(() => extractJson("   "), /模型输出为空/);
  });
});
