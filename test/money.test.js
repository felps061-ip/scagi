import test from "node:test";
import assert from "node:assert/strict";
import { isValidPortalAmount } from "../src/money.js";

test("valida margem brasileira com limite de tamanho e agrupamento correto", () => {
  for (const value of ["0,00", "2,20", "-2,20", "1234,56", "1.234,56", "-1.234.567,89"]) {
    assert.equal(isValidPortalAmount(value), true, value);
  }
  for (const value of [null, 2.2, "", "..,20", "1..234,56", "12.34,56", "1234.567,89", "1,2", "1,234", "1,23\n", "1,23,45", "1e3,00", "9".repeat(100000) + ",00"]) {
    assert.equal(isValidPortalAmount(value), false);
  }
});
