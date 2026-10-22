import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseEvaluationConfig, type EvaluationConfig } from './evaluation-config.ts';

const ROOT = resolve(import.meta.dirname, '..');
const SHIPPED = readFileSync(join(ROOT, 'config', 'evaluation.json'), 'utf8');

const VALID: EvaluationConfig = {
  zeroGuardRuns: 3,
  hookP95Ms: { default: 1000, 'stop-gate': 1_800_000 },
  gateRemoveAtMinutes: 60,
  gateRemoveAtUsd: 5,
  gateTuneAboveFalseAlarmRate: 0.3,
  gateTuneAboveCouldNotRunRate: 0.1,
  roleTuneBelowFirstTryRate: 0.5,
  reviewerTuneBelowConfirmedRate: 0.3,
  substreamRemoveAtItems: 50,
  skillTuneAboveFailedRate: 0.5,
};
const text = (over: Record<string, unknown> = {}) => JSON.stringify({ ...VALID, ...over });

describe('config/evaluation.json: the thresholds the suggestions come from, fail-closed', () => {
  it('reads the shipped file', () => {
    expect(parseEvaluationConfig(SHIPPED)).toEqual({ ok: true, config: VALID });
  });

  it('takes one run as the zero guard window', () => {
    expect(parseEvaluationConfig(text({ zeroGuardRuns: 1 }))).toEqual({ ok: true, config: { ...VALID, zeroGuardRuns: 1 } });
  });

  it('keeps the $comment out and every threshold as given', () => {
    expect(parseEvaluationConfig(text({ $comment: 'x', gateRemoveAtUsd: 0 }))).toEqual({ ok: true, config: { ...VALID, gateRemoveAtUsd: 0 } });
  });

  it.each<[string, string, string]>([
    ['not json', '{', 'config/evaluation.json is not valid JSON'],
    ['not an object', '[]', 'config/evaluation.json is not a JSON object'],
    ['null', 'null', 'config/evaluation.json is not a JSON object'],
    ['a plain value', '3', 'config/evaluation.json is not a JSON object'],
    ['a rate as text', text({ gateTuneAboveFalseAlarmRate: '0.3' }), 'config/evaluation.json: gateTuneAboveFalseAlarmRate must be a number between 0 and 1'],
    ['a key missing', JSON.stringify({ ...VALID, gateRemoveAtUsd: undefined }), 'config/evaluation.json: gateRemoveAtUsd must be a number of 0 or more'],
    ['a negative number', text({ gateRemoveAtMinutes: -1 }), 'config/evaluation.json: gateRemoveAtMinutes must be a number of 0 or more'],
    ['a number as text', text({ substreamRemoveAtItems: '50' }), 'config/evaluation.json: substreamRemoveAtItems must be a number of 0 or more'],
    ['zero runs', text({ zeroGuardRuns: 0 }), 'config/evaluation.json: zeroGuardRuns must be a whole number of 1 or more'],
    ['part of a run', text({ zeroGuardRuns: 1.5 }), 'config/evaluation.json: zeroGuardRuns must be a whole number of 1 or more'],
    ['a rate of 1 or more', text({ roleTuneBelowFirstTryRate: 1 }), 'config/evaluation.json: roleTuneBelowFirstTryRate must be a number between 0 and 1'],
    ['a rate of 0', text({ skillTuneAboveFailedRate: 0 }), 'config/evaluation.json: skillTuneAboveFailedRate must be a number between 0 and 1'],
    ['no default hook threshold', text({ hookP95Ms: { 'stop-gate': 5 } }), 'config/evaluation.json: hookP95Ms must map default and hook names to milliseconds'],
    ['a hook threshold as text', text({ hookP95Ms: { default: 5, observe: '5' } }), 'config/evaluation.json: hookP95Ms must map default and hook names to milliseconds'],
    ['hook thresholds as a list', text({ hookP95Ms: [5] }), 'config/evaluation.json: hookP95Ms must map default and hook names to milliseconds'],
    ['an unknown key', text({ gateRemoveAtHours: 1 }), 'config/evaluation.json: unknown key gateRemoveAtHours'],
  ])('refuses %s, never a default', (_name, bad, error) => {
    expect(parseEvaluationConfig(bad)).toEqual({ ok: false, error });
  });
});
