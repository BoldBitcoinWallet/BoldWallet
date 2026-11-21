import {
  beginAirgapImportSession,
  endAirgapImportSession,
  isAirgapImportSessionActive,
  resetAirgapImportSessionForTests,
} from '../services/airgapImportSession';

describe('airgapImportSession', () => {
  afterEach(() => {
    resetAirgapImportSessionForTests();
  });

  it('stays active until every holder ends', () => {
    expect(isAirgapImportSessionActive()).toBe(false);
    beginAirgapImportSession();
    beginAirgapImportSession();
    endAirgapImportSession();
    expect(isAirgapImportSessionActive()).toBe(true);
    endAirgapImportSession();
    expect(isAirgapImportSessionActive()).toBe(false);
  });
});