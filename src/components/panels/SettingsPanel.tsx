import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { Icon } from '../Icon';

export const SettingsPanel: React.FC = () => {
  const {
    t,
    settings,
    updateSetting,
    resetSettings,
    schema,
    profiles,
    saveProfile,
    applyProfile,
    deleteProfile,
    langName,
    sheetSection,
    showToast,
  } = useApp();

  const [selectedProfile, setSelectedProfile] = useState('');
  const [newProfileName, setNewProfileName] = useState('');
  const [audioDevices, setAudioDevices] = useState<{ inputs: any[]; outputs: any[] }>({
    inputs: [],
    outputs: [],
  });

  useEffect(() => {
    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
      navigator.mediaDevices.enumerateDevices().then((devices) => {
        const ins = devices
          .filter((d) => d.kind === 'audioinput')
          .map((d, i) => ({ value: d.deviceId, label: d.label || `${t('set.listen.device')} ${i + 1}` }));
        const outs = devices
          .filter((d) => d.kind === 'audiooutput')
          .map((d, i) => ({ value: d.deviceId, label: d.label || `${t('set.speak.device')} ${i + 1}` }));
        setAudioDevices({ inputs: ins, outputs: outs });
      }).catch(() => {});
    }
  }, []);

  // Scroll to targeted section if passed
  useEffect(() => {
    if (sheetSection) {
      const el = document.getElementById(`set-${sheetSection}`);
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    }
  }, [sheetSection]);

  const handleExport = () => {
    const s = { ...settings };
    delete s['caps.on'];
    delete s['listen.device'];
    delete s['speak.device'];
    const url = URL.createObjectURL(
      new Blob([JSON.stringify({ settings: s }, null, 2)], { type: 'application/json' })
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'relais-reglages.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    file.text().then((content) => {
      try {
        const data = JSON.parse(content);
        const imported = data.settings || data;
        if (typeof imported !== 'object' || imported === null) throw new Error();
        updateSetting(imported);
        showToast(t('settings.imported'));
      } catch {
        showToast(t('settings.import_bad'));
      }
    });
  };

  const getOptionsForField = (f: any) => {
    if (f.options) {
      return f.options.map((o: any) => ({
        value: o.value,
        label: o.label ?? t(o.label_key),
      }));
    }

    const me = settings['pair.me'] || 'b';
    switch (f.options_from) {
      case 'pair':
        return [
          { value: 'a', label: langName('a') },
          { value: 'b', label: langName('b') },
        ];
      case 'who':
        return [
          { value: 'auto', label: t('who.auto') },
          { value: 'a', label: langName('a') },
          { value: 'b', label: langName('b') },
        ];
      case 'me_other':
        return [
          { value: 'me', label: t('settings.me_label', { name: langName(me) }) },
          { value: 'other', label: t('settings.other_label', { name: langName(me === 'a' ? 'b' : 'a') }) },
        ];
      case 'voices.a':
        return [
          { value: '', label: t('opt.auto') },
          { value: 'en_US-lessac-medium', label: 'Lessac (US)' },
          { value: 'en_US-amy-medium', label: 'Amy (US)' },
          { value: 'en_GB-alan-medium', label: 'Alan (UK)' },
        ];
      case 'voices.b':
        return [
          { value: '', label: t('opt.auto') },
          { value: 'fr_FR-siwis-medium', label: 'Siwis' },
          { value: 'fr_FR-tom-medium', label: 'Tom' },
        ];
      case 'client.audioinputs':
        return [{ value: '', label: t('settings.default_device') }, ...audioDevices.inputs];
      case 'client.audiooutputs':
        return [{ value: '', label: t('settings.default_device') }, ...audioDevices.outputs];
      default:
        return [];
    }
  };

  const formatRangeVal = (f: any, val: number) => {
    if (f.format === 'percent') return `${Math.round(val * 100)} %`;
    if (f.format === 'rate') return `×${Number(val).toFixed(2)}`;
    return f.unit ? `${val} ${f.unit}` : String(val);
  };

  return (
    <div className="panel" id="panel-settings">
      {/* Profiles */}
      <section className="set-section" id="set-profile">
        <h3>{t('settings.profile')}</h3>
        <p className="lede">{t('settings.profile.hint')}</p>
        <div className="row">
          <select
            value={selectedProfile}
            onChange={(e) => setSelectedProfile(e.target.value)}
            aria-label={t('settings.profile')}
          >
            <option value="">{t('settings.profile.none')}</option>
            {profiles.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>

          <button
            className="btn"
            type="button"
            disabled={!selectedProfile}
            onClick={() => applyProfile(selectedProfile)}
          >
            {t('btn.apply')}
          </button>

          <button
            className="btn quiet"
            type="button"
            disabled={!selectedProfile}
            onClick={() => {
              deleteProfile(selectedProfile);
              setSelectedProfile('');
            }}
          >
            {t('btn.delete')}
          </button>
        </div>

        <div className="row">
          <input
            type="text"
            placeholder={t('settings.profile.name')}
            maxLength={40}
            value={newProfileName}
            onChange={(e) => setNewProfileName(e.target.value)}
            aria-label={t('settings.profile.name')}
          />
          <button
            className="btn primary"
            type="button"
            onClick={() => {
              if (newProfileName.trim()) {
                saveProfile(newProfileName.trim());
                setNewProfileName('');
              }
            }}
          >
            {t('btn.save_as')}
          </button>
        </div>
      </section>

      {/* Sections from Schema */}
      {schema.sections.map((sec: any) => {
        const secKeys = sec.fields.map((f: any) => f.key);

        return (
          <section key={sec.id} className="set-section" id={`set-${sec.id}`}>
            <h3>{t(sec.label)}</h3>

            {sec.fields.map((f: any) => {
              const val = settings[f.key] ?? f.default;
              const langParam = f.lang_label ? { lang: langName(f.lang_label) } : undefined;

              return (
                <div key={f.key} className="field">
                  <span className="field-label">{t(f.label, langParam)}</span>
                  {f.hint && <span className="field-hint">{t(f.hint)}</span>}

                  <div className="field-control">
                    {f.type === 'toggle' && (
                      <button
                        className="switch"
                        type="button"
                        role="switch"
                        aria-checked={!!val}
                        onClick={() => updateSetting({ [f.key]: !val })}
                      />
                    )}

                    {f.type === 'select' && (
                      <select
                        value={String(val)}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const typed =
                            typeof f.default === 'number'
                              ? Number(raw)
                              : typeof f.default === 'boolean'
                              ? raw === 'true'
                              : raw;
                          updateSetting({ [f.key]: typed });
                        }}
                      >
                        {getOptionsForField(f).map((opt: any) => (
                          <option key={String(opt.value)} value={String(opt.value)}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    )}

                    {f.type === 'range' && (
                      <>
                        <input
                          type="range"
                          min={f.min}
                          max={f.max}
                          step={f.step}
                          value={val}
                          onChange={(e) => updateSetting({ [f.key]: parseFloat(e.target.value) })}
                        />
                        <span className="range-val">{formatRangeVal(f, val)}</span>
                      </>
                    )}

                    {f.type === 'color' && (
                      <>
                        <input
                          type="color"
                          value={val}
                          onChange={(e) => updateSetting({ [f.key]: e.target.value.toUpperCase() })}
                        />
                        <button
                          className="icon-btn sm"
                          type="button"
                          title={t('settings.reset_section')}
                          onClick={() => updateSetting({ [f.key]: f.default })}
                        >
                          <Icon name="reset" className="ic sm" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}

            <div className="row">
              <button
                className="btn quiet"
                type="button"
                onClick={() => resetSettings(secKeys)}
              >
                {t('settings.reset_section')}
              </button>
            </div>
          </section>
        );
      })}

      {/* Import / Export JSON */}
      <section className="set-section">
        <div className="row">
          <button className="btn quiet" type="button" onClick={handleExport}>
            {t('settings.export')}
          </button>
          <label className="btn quiet" style={{ cursor: 'pointer' }}>
            {t('settings.import')}
            <input
              type="file"
              accept="application/json"
              hidden
              onChange={handleImport}
            />
          </label>
        </div>
      </section>
    </div>
  );
};
