import React, { useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { Icon } from './Icon';
import { SettingsPanel } from './panels/SettingsPanel';
import { LibraryPanel } from './panels/LibraryPanel';
import { HistoryPanel } from './panels/HistoryPanel';
import { GlossaryPanel } from './panels/GlossaryPanel';
import { SystemPanel } from './panels/SystemPanel';
import { MeetingPanel } from './panels/MeetingPanel';

const TABS: Array<{
  id: 'settings' | 'library' | 'history' | 'glossary' | 'system' | 'meeting';
  icon: string;
  key: string;
}> = [
  { id: 'meeting', icon: 'meeting', key: 'top.meeting' },
  { id: 'settings', icon: 'settings', key: 'top.settings' },
  { id: 'library', icon: 'wave', key: 'top.library' },
  { id: 'history', icon: 'clock', key: 'top.history' },
  { id: 'glossary', icon: 'book', key: 'top.glossary' },
  { id: 'system', icon: 'system', key: 'top.system' },
];

export const Sheet: React.FC = () => {
  const { t, sheetOpen, sheetTab, setSheetTab, closeSheet } = useApp();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && sheetOpen) {
        closeSheet();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [sheetOpen, closeSheet]);

  const activeTabDef = TABS.find((x) => x.id === sheetTab) || TABS[0];

  return (
    <>
      <div
        className="scrim"
        id="scrim"
        data-open={sheetOpen ? 'true' : undefined}
        onClick={closeSheet}
      />

      <aside
        className="sheet"
        id="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheetTitle"
        data-open={sheetOpen ? 'true' : undefined}
      >
        <div className="sheet-head">
          <h2 id="sheetTitle">{t(activeTabDef.key)}</h2>
          <button
            className="icon-btn"
            type="button"
            id="sheetClose"
            onClick={closeSheet}
            aria-label={t('sheet.close')}
            title={t('sheet.close')}
          >
            <Icon name="x" />
          </button>
        </div>

        <div className="tabs" id="tabs" role="tablist">
          {TABS.map((tab) => {
            const isSelected = sheetTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`tab-${tab.id}`}
                aria-controls={`panel-${tab.id}`}
                aria-selected={isSelected}
                tabIndex={isSelected ? 0 : -1}
                title={t(tab.key)}
                onClick={() => setSheetTab(tab.id)}
              >
                <Icon name={tab.icon} className="ic sm" />
                <span className="tab-label">{t(tab.key)}</span>
              </button>
            );
          })}
        </div>

        <div className="sheet-body" id="sheetBody">
          {sheetTab === 'meeting' && <MeetingPanel />}
          {sheetTab === 'settings' && <SettingsPanel />}
          {sheetTab === 'library' && <LibraryPanel />}
          {sheetTab === 'history' && <HistoryPanel />}
          {sheetTab === 'glossary' && <GlossaryPanel />}
          {sheetTab === 'system' && <SystemPanel />}
        </div>
      </aside>
    </>
  );
};
