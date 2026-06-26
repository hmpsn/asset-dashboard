import { describe, expect, it } from 'vitest';

import {
  applyKeywordCommandCenterAction,
  applyKeywordCommandCenterBulkAction,
  deleteKeywordHard,
  isHardDeleteEligible,
} from '../../server/keyword-command-center.js';
import * as actionService from '../../server/domains/keyword-command-center/action-service.js';

describe('keyword command center action service facade compatibility', () => {
  it('re-exports action service functions from the public facade', () => {
    expect(applyKeywordCommandCenterAction).toBe(actionService.applyKeywordCommandCenterAction);
    expect(applyKeywordCommandCenterBulkAction).toBe(actionService.applyKeywordCommandCenterBulkAction);
    expect(deleteKeywordHard).toBe(actionService.deleteKeywordHard);
    expect(isHardDeleteEligible).toBe(actionService.isHardDeleteEligible);
  });
});
