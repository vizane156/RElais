import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { Icon } from './Icon';
import { translateText } from '../services/translator';

const other = (s: 'a' | 'b'): 'a' | 'b' => (s === 'a' ? 'b' : 'a');

export const Compose: React.FC = () => {
  const {
    t,
    settings,
    updateSetting,
    sideLang,
    langName,
    capOn,
    typeSpeaker,
    speakText,
    stopVoice,
    speaking,
    spokenFeedback,
    addOrUpdateUtterance,
    glossaryRules,
  } = useApp();

  const [text, setText] = useState('');
  const [previewText, setPreviewText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const me = (settings['pair.me'] || 'b') as 'a' | 'b';
  const typeSide = (settings['type.lang'] === 'me' ? me : other(me)) as 'a' | 'b';
  const saySide = (settings['type.say'] === 'me' ? me : other(me)) as 'a' | 'b';

  // Toggle type & say chips
  const toggleTypeLang = () => {
    updateSetting({ 'type.lang': settings['type.lang'] === 'me' ? 'other' : 'me' });
  };

  const toggleSayLang = () => {
    updateSetting({ 'type.say': settings['type.say'] === 'other' ? 'me' : 'other' });
  };

  // Autosize textarea
  const adjustHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight + 2, 144)}px`;
    }
  };

  // Live translation preview on typing
  useEffect(() => {
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    if (!text.trim() || !capOn('translate') || settings['translate.live'] === false) {
      setPreviewText('');
      return;
    }

    previewTimerRef.current = setTimeout(async () => {
      const srcLang = sideLang(typeSide);
      const tgtLang = sideLang(other(typeSide));
      const res = await translateText(
        text,
        srcLang,
        tgtLang,
        glossaryRules,
        settings['translate.glossary']
      );
      setPreviewText(res.text);
    }, 110);

    return () => {
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    };
  }, [text, typeSide, settings, glossaryRules, capOn]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);
    adjustHeight();

    if (capOn('typespeak')) {
      typeSpeaker.update(val);
    }
  };

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;

    if (capOn('typespeak')) {
      typeSpeaker.flush();
    }

    const mid = Date.now();
    const uttKey = `t${mid}`;
    const srcLang = sideLang(typeSide);
    const tgtLang = sideLang(other(typeSide));
    const isTranslateOn = capOn('translate');

    addOrUpdateUtterance({
      key: uttKey,
      side: typeSide,
      text: trimmed,
      state: isTranslateOn ? 'pending' : 'final',
      ts: mid,
    });

    if (isTranslateOn) {
      const res = await translateText(
        trimmed,
        srcLang,
        tgtLang,
        glossaryRules,
        settings['translate.glossary']
      );

      addOrUpdateUtterance({
        key: uttKey,
        side: typeSide,
        text: trimmed,
        translation: res.text,
        to: tgtLang,
        state: 'final',
        ts: mid,
      });

      if (capOn('speak') && !capOn('typespeak') && settings['speak.translations'] !== false) {
        speakText(res.text, tgtLang);
      }
    } else {
      if (capOn('speak') && !capOn('typespeak') && typeSide === saySide) {
        speakText(trimmed, srcLang);
      }
    }

    typeSpeaker.reset();
    setText('');
    setPreviewText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
    if (e.key === 'Escape') {
      stopVoice();
    }
  };

  return (
    <form
      className="compose"
      id="compose"
      autoComplete="off"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="compose-bar">
        <span className="group">
          <span>{t('compose.type_in')}</span>
          <button
            className="chip"
            type="button"
            id="typeLang"
            data-side={typeSide}
            onClick={toggleTypeLang}
          >
            <span className="swatch"></span>
            <span className="chip-text">{langName(typeSide)}</span>
          </button>
        </span>

        <span className="group">
          <span>{t('compose.say_in')}</span>
          <button
            className="chip"
            type="button"
            id="sayLang"
            data-side={saySide}
            onClick={toggleSayLang}
          >
            <span className="swatch"></span>
            <span className="chip-text">{langName(saySide)}</span>
          </button>
        </span>

        {speaking && (
          <button
            className="icon-btn sm"
            type="button"
            id="stopVoice"
            onClick={stopVoice}
            aria-label={t('library.stop')}
            title={t('library.stop')}
          >
            <Icon name="stop" className="ic sm" />
          </button>
        )}

        {spokenFeedback && (
          <span className="spoken" id="said" aria-live="polite">
            {spokenFeedback}
          </span>
        )}
      </div>

      <div className="compose-field">
        <textarea
          ref={textareaRef}
          className="input"
          id="input"
          rows={1}
          maxLength={2000}
          spellCheck="true"
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={t('compose.placeholder')}
          aria-label={t('compose.placeholder')}
        />
        <button
          className="btn primary"
          type="submit"
          id="send"
          disabled={!text.trim()}
        >
          <Icon name="return" />
          <span>{t('compose.send')}</span>
        </button>
      </div>

      <p className="preview" id="preview" data-side={other(typeSide)} aria-live="polite">
        {previewText && (
          <>
            <span className="label">
              {t('compose.preview', { lang: langName(other(typeSide)) })}
            </span>
            {previewText}
          </>
        )}
      </p>
    </form>
  );
};
