import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { validate } from "../src/runtime/schema-resolver.js";

describe("schema-resolver", () => {
  it("接受合法的对象", () => {
    const schema = {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        count: { type: "integer" },
      },
    };
    const r = validate({ name: "a", count: 1 }, schema);
    assert.equal(r.valid, true, r.errors.join("; "));
  });

  it("报出缺失的必填字段", () => {
    const schema = { type: "object", required: ["name"], properties: { name: { type: "string" } } };
    const r = validate({}, schema);
    assert.equal(r.valid, false);
    assert.match(r.errors[0] ?? "", /缺少必填字段/);
  });

  it("报出类型不匹配", () => {
    const schema = { type: "object", properties: { name: { type: "string" } } };
    const r = validate({ name: 42 }, schema);
    assert.equal(r.valid, false);
    assert.match(r.errors[0] ?? "", /期望类型 string/);
  });

  it("递归校验数组元素", () => {
    const schema = {
      type: "object",
      properties: {
        items: { type: "array", items: { type: "object", required: ["id"], properties: { id: { type: "string" } } } },
      },
    };
    const r = validate({ items: [{ id: "1" }, { id: 2 }] }, schema);
    assert.equal(r.valid, false);
    assert.match(r.errors.join(" "), /items\[1\]\.id/);
  });

  it("校验枚举", () => {
    const schema = { type: "object", properties: { level: { type: "string", enum: ["a", "b"] } } };
    assert.equal(validate({ level: "a" }, schema).valid, true);
    assert.equal(validate({ level: "c" }, schema).valid, false);
  });

  it("校验数值上下界", () => {
    const schema = { type: "object", properties: { n: { type: "integer", minimum: 1, maximum: 3 } } };
    assert.equal(validate({ n: 2 }, schema).valid, true);
    assert.equal(validate({ n: 9 }, schema).valid, false);
  });

  it("additionalProperties=false 时拒绝额外字段", () => {
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: { a: { type: "string" } },
    };
    const r = validate({ a: "x", b: "y" }, schema);
    assert.equal(r.valid, false);
    assert.match(r.errors.join(" "), /不允许的额外字段/);
  });
});
