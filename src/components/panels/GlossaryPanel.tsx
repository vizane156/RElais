import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Icon } from '../Icon';
import { GlossaryRule } from '../../services/glossary';

export const GlossaryPanel: React.FC = () => {
  const {
    t,
    sideLang,
    langName,
    glossaryRules,
    saveGlossaryRules,
  } = useApp();

  const [rules, setRules] = useState<GlossaryRule[]>(() => [...glossaryRules]);

  const handleAddRule = () => {
    setRules((prev) => [
      ...prev,
      { src: sideLang('a'), term: '', target: '', mode: 'keep' },
    ]);
  };

  const handleRemoveRule = (index: number) => {
    setRules((prev) => prev.filter((_, i) => i !== index));
  };

  const handleChangeRule = (index: number, patch: Partial<GlossaryRule>) => {
    setRules((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  };

  const handleSave = () => {
    saveGlossaryRules(rules.filter((r) => r.term.trim().length > 0));
  };

  return (
    <div className="panel" id="panel-glossary">
      <p className="lede">{t('glossary.intro')}</p>

      {rules.length === 0 ? (
        <p className="empty-note">{t('glossary.empty')}</p>
      ) : (
        <div>
          {rules.map((rule, idx) => (
            <div key={idx} className="gloss-row">
              <select
                value={rule.src}
                onChange={(e) => handleChangeRule(idx, { src: e.target.value })}
                aria-label={t('glossary.lang')}
              >
                <option value={sideLang('a')}>{langName('a')}</option>
                <option value={sideLang('b')}>{langName('b')}</option>
              </select>

              <input
                type="text"
                value={rule.term}
                maxLength={80}
                placeholder={t('glossary.term')}
                onChange={(e) => handleChangeRule(idx, { term: e.target.value })}
                aria-label={t('glossary.term')}
              />

              <select
                value={rule.mode}
                onChange={(e) =>
                  handleChangeRule(idx, { mode: e.target.value as 'keep' | 'replace' })
                }
                aria-label={t('glossary.mode')}
              >
                <option value="keep">{t('glossary.keep')}</option>
                <option value="replace">{t('glossary.replace')}</option>
              </select>

              <input
                type="text"
                value={rule.target}
                maxLength={120}
                disabled={rule.mode === 'keep'}
                placeholder={t('glossary.target')}
                onChange={(e) => handleChangeRule(idx, { target: e.target.value })}
                aria-label={t('glossary.target')}
              />

              <button
                className="icon-btn sm"
                type="button"
                title={t('glossary.remove')}
                aria-label={t('glossary.remove')}
                onClick={() => handleRemoveRule(idx)}
              >
                <Icon name="trash" className="ic sm" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="row">
        <button className="btn" type="button" onClick={handleAddRule}>
          <Icon name="plus" className="ic sm" />
          {t('glossary.add')}
        </button>

        <button className="btn primary" type="button" onClick={handleSave}>
          <Icon name="check" className="ic sm" />
          {t('btn.save')}
        </button>
      </div>
    </div>
  );
};
