import React from 'react';
import { useApp } from '../../context/AppContext';
import { Icon } from '../Icon';

export const HistoryPanel: React.FC = () => {
  const {
    t,
    historyItems,
    clearHistory,
    exportHistoryTxt,
    sideLang,
  } = useApp();

  const handleClear = () => {
    if (window.confirm(t('history.confirm_clear'))) {
      clearHistory();
    }
  };

  const reversed = [...historyItems].reverse();

  return (
    <div className="panel" id="panel-history">
      <div className="row">
        <button
          className="btn quiet"
          type="button"
          onClick={exportHistoryTxt}
          disabled={historyItems.length === 0}
        >
          <Icon name="download" className="ic sm" />
          {t('history.export')}
        </button>

        <button
          className="btn quiet"
          type="button"
          onClick={handleClear}
          disabled={historyItems.length === 0}
        >
          <Icon name="trash" className="ic sm" />
          {t('history.clear')}
        </button>
      </div>

      {reversed.length === 0 ? (
        <p className="empty-note">{t('history.empty')}</p>
      ) : (
        <div>
          {reversed.map((e, idx) => (
            <div key={`hist-${e.id || idx}-${idx}`} className="hist-item">
              <time>
                {new Date((e.ts || 0) * 1000).toLocaleString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                  day: '2-digit',
                  month: '2-digit',
                })}
              </time>
              <p data-side={e.side} lang={e.lang}>
                {e.text}
              </p>
              {e.translation && (
                <p
                  className="tr"
                  data-side={e.to === sideLang('a') ? 'a' : 'b'}
                  lang={e.to}
                >
                  {e.translation}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
