import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRange } from "../worker/range.js";

test("intervalos válidos", () => {
  assert.deepEqual(parseRange("bytes=0-1", 100), { start: 0, end: 1 });   // sonda do Safari
  assert.deepEqual(parseRange("bytes=10-", 100), { start: 10, end: 99 });
  assert.deepEqual(parseRange("bytes=-10", 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange("bytes=50-500", 100), { start: 50, end: 99 });
});

test("intervalos inválidos", () => {
  for (const h of ["bytes=100-", "bytes=5-2", "bytes=-0", "bytes=-", "items=0-1", "bytes=0-1,5-6"]) {
    assert.equal(parseRange(h, 100), null, h);
  }
});
