'use strict';
// Unit tests for server/lib/bkt.js — the canonical BKT implementation.
// These are pure-function tests: no mocks, no DB, no Express.

const { bktUpdate, DEFAULT_PARAMS, clamp } = require('./bkt');

describe('canonical BKT implementation (server/lib/bkt.js)', () => {
  describe('clamp', () => {
    test('clamp: below epsilon -> epsilon', () => {
      expect(clamp(0)).toBe(0.01);
    });

    test('clamp: above 1-epsilon -> 1-epsilon', () => {
      expect(clamp(1)).toBe(0.99);
    });

    test('clamp: midpoint passes through', () => {
      expect(clamp(0.5)).toBe(0.5);
    });

    test('clamp: negative clamped to epsilon', () => {
      expect(clamp(-1)).toBe(0.01);
    });

    test('clamp: >1 clamped to 1-epsilon', () => {
      expect(clamp(2)).toBe(0.99);
    });

    test('clamp: custom lo/hi, value in range', () => {
      expect(clamp(0.3, 0.2, 0.8)).toBe(0.3);
    });

    test('clamp: custom lo, value below lo', () => {
      expect(clamp(0.1, 0.2, 0.8)).toBe(0.2);
    });

    test('clamp: custom hi, value above hi', () => {
      expect(clamp(0.9, 0.2, 0.8)).toBe(0.8);
    });
  });

  describe('validateParams', () => {
    test('bktUpdate: pGuess=0.5 throws degenerate error', () => {
      expect(() => bktUpdate(0.5, true, { ...DEFAULT_PARAMS, pGuess: 0.5 })).toThrow(/Degenerate/);
    });

    test('bktUpdate: pSlip=0.5 throws degenerate error', () => {
      expect(() => bktUpdate(0.5, true, { ...DEFAULT_PARAMS, pSlip: 0.5 })).toThrow(/Degenerate/);
    });
  });

  describe('bktUpdate - correct answer', () => {
    test('correct answer raises posterior above prior and clamps bounds', () => {
      const { posterior, pMasteryNext } = bktUpdate(0.3, true);
      expect(posterior).toBeGreaterThan(0.3);
      expect(pMasteryNext).toBeGreaterThan(posterior);
      expect(pMasteryNext).toBeLessThanOrEqual(0.99);
      expect(pMasteryNext).toBeGreaterThanOrEqual(0.01);
    });
  });

  describe('bktUpdate - incorrect answer', () => {
    test('incorrect answer lowers posterior below prior and transit stays >= posterior', () => {
      const { posterior, pMasteryNext } = bktUpdate(0.7, false);
      expect(posterior).toBeLessThan(0.7);
      expect(pMasteryNext).toBeGreaterThanOrEqual(posterior);
    });
  });

  describe('Concept playground level solve (#290)', () => {
    test('level solve (isCorrect=true) raises mastery more than isCorrect=false at same prior', () => {
      const prior = 0.3;
      const { pMasteryNext: afterSolve } = bktUpdate(prior, true);
      const { pMasteryNext: afterWrongFlag } = bktUpdate(prior, false);
      expect(afterSolve).toBeGreaterThan(prior);
      expect(afterSolve).toBeGreaterThan(afterWrongFlag);
    });
  });

  describe('bktUpdate - smoothing factor', () => {
    test('smoothing factor caps single-answer jump', () => {
      const { pMasteryNext } = bktUpdate(0.01, true);
      expect(pMasteryNext).toBeLessThan(0.20);
    });
  });

  describe('bktUpdate - convergence', () => {
    test('repeated correct answers raise mastery above 0.8', () => {
      let p = DEFAULT_PARAMS.pInit;
      for (let i = 0; i < 30; i++) {
        ({ pMasteryNext: p } = bktUpdate(p, true));
      }
      expect(p).toBeGreaterThan(0.8);
    });

    test('repeated wrong answers lower high mastery below 0.7', () => {
      let p = 0.9;
      for (let i = 0; i < 20; i++) {
        ({ pMasteryNext: p } = bktUpdate(p, false));
      }
      expect(p).toBeLessThan(0.7);
    });
  });

  describe('DEFAULT_PARAMS', () => {
    test('DEFAULT_PARAMS are non-degenerate', () => {
      expect(DEFAULT_PARAMS.pGuess).toBeLessThan(0.5);
      expect(DEFAULT_PARAMS.pSlip).toBeLessThan(0.5);
    });
  });
});
