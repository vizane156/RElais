import React, { createContext, useContext, useState, useEffect, useRef, useMemo } from 'react';
import frDict from '../i18n/fr.json';
import enDict from '../i18n/en.json';
import schemaData from '../data/schema.json';
import { StorageService, HistoryItem, VoiceRecording, getDefaultSettings } from '../services/storage';
import { GlossaryRule } from '../services/glossary';
import { translateText } from '../services/translator';
import { Player } from '../audio/player';
import { Capture } from '../audio/capture';
import { SpeechService } from '../services/speech';
import { TypeSpeaker } from '../audio/speakchunk';
import { CloneVoiceService } from '../services/cloneVoiceService';

export interface UtteranceItem {
  key: string;
  side: 'a' | 'b';
  text: string;
  translation?: string;
  to?: string;
  state: 'live' | 'pending' | 'final';
  ts: number;
}

export interface ToastItem {
  id: number;
  message: string;
}

export interface CapState {
  id: string;
  enabled: boolean;
  state: 'off' | 'ready' | 'loading' | 'unavailable' | 'error';
  detail?: any;
}

export interface AppContextType {
  // Settings & Theme
  settings: Record<string, any>;
  updateSetting: (patch: Record<string, any>) => void;
  resetSettings: (keys?: string[]) => void;
  lang: 'fr' | 'en';
  t: (key: string, params?: Record<string, any>) => string;
  hasKey: (key: string) => boolean;

  // Language pair & sides
  pair: { a: string; b: string; names: Record<string, string> };
  sideLang: (side: 'a' | 'b') => string;
  langName: (side: 'a' | 'b') => string;
  swapPair: () => void;
  who: string;
  setWho: (val: string) => void;

  // Capabilities
  caps: Record<string, CapState>;
  capOn: (id: string) => boolean;
  toggleCap: (id: string) => void;

  // Latencies & Connection
  lat: { stt?: number; mt?: number; tts?: number };
  conn: 'open' | 'connecting' | 'closed';

  // Utterances & Folio
  utterances: UtteranceItem[];
  addOrUpdateUtterance: (item: Partial<UtteranceItem> & { key: string }) => void;
  clearFolio: () => void;

  // Audio & Services
  player: Player;
  capture: Capture;
  speechService: SpeechService;
  typeSpeaker: TypeSpeaker;
  meterLevel: number;
  meterMode: 'idle' | 'live' | 'speech' | 'muted';
  speaking: boolean;
  speakText: (text: string, lang: string) => void;
  stopVoice: () => void;
  spokenFeedback: string;
  setSpokenFeedback: (msg: string) => void;

  // Sheet drawer
  sheetOpen: boolean;
  sheetTab: 'settings' | 'library' | 'history' | 'glossary' | 'system' | 'meeting';
  sheetSection?: string;
  openSheet: (tab: 'settings' | 'library' | 'history' | 'glossary' | 'system' | 'meeting', section?: string) => void;
  closeSheet: () => void;
  setSheetTab: (tab: 'settings' | 'library' | 'history' | 'glossary' | 'system' | 'meeting') => void;

  // Profiles & Data
  profiles: string[];
  saveProfile: (name: string) => void;
  applyProfile: (name: string) => void;
  deleteProfile: (name: string) => void;

  // Glossary
  glossaryRules: GlossaryRule[];
  saveGlossaryRules: (rules: GlossaryRule[]) => void;

  // History
  historyItems: HistoryItem[];
  clearHistory: () => void;
  exportHistoryTxt: () => void;

  // Recordings
  recordings: VoiceRecording[];
  saveRecording: (rec: VoiceRecording) => void;
  updateRecordingName: (id: string, name: string) => void;
  deleteRecording: (id: string) => void;

  // Toasts
  toasts: ToastItem[];
  showToast: (message: string, duration?: number) => void;

  // Schema
  schema: typeof schemaData;
}

const AppContext = createContext<AppContextType | null>(null);

const DEFAULT_PAIR = { a: 'en', b: 'fr', names: { en: 'English', fr: 'Français' } };

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<Record<string, any>>(() => StorageService.getSettings());
  const [who, setWho] = useState<string>(() => settings['listen.who'] || 'auto');
  const [lat, setLat] = useState<{ stt?: number; mt?: number; tts?: number }>({ stt: 142, mt: 35, tts: 88 });
  const [conn, setConn] = useState<'open' | 'connecting' | 'closed'>('open');
  const [spokenFeedback, setSpokenFeedback] = useState<string>('');
  const [meterLevel, setMeterLevel] = useState<number>(0);
  const [meterMode, setMeterMode] = useState<'idle' | 'live' | 'speech' | 'muted'>('idle');
  const [speaking, setSpeaking] = useState<boolean>(false);

  // Sheet drawer state
  const [sheetOpen, setSheetOpen] = useState<boolean>(false);
  const [sheetTab, setSheetTab] = useState<'settings' | 'library' | 'history' | 'glossary' | 'system' | 'meeting'>('settings');
  const [sheetSection, setSheetSection] = useState<string | undefined>(undefined);

  // Capabilities
  const [caps, setCaps] = useState<Record<string, CapState>>({
    listen: { id: 'listen', enabled: false, state: 'off' },
    translate: { id: 'translate', enabled: true, state: 'ready' },
    speak: { id: 'speak', enabled: true, state: 'ready' },
    typespeak: { id: 'typespeak', enabled: true, state: 'ready' },
    record: { id: 'record', enabled: false, state: 'off' },
    clone: { id: 'clone', enabled: false, state: 'off' },
  });

  // Data
  const [profiles, setProfiles] = useState<string[]>(() => Object.keys(StorageService.getProfiles()));
  const [glossaryRules, setGlossaryRules] = useState<GlossaryRule[]>(() => StorageService.getGlossary());
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>(() => StorageService.getHistory());
  const [recordings, setRecordings] = useState<VoiceRecording[]>(() => StorageService.getRecordings());
  const [utterances, setUtterances] = useState<UtteranceItem[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  // Audio services singletons
  const playerRef = useRef<Player>(new Player());
  const captureRef = useRef<Capture>(new Capture());
  const speechRef = useRef<SpeechService>(new SpeechService(playerRef.current));
  const seqRef = useRef<number>(100);
  const toastSeqRef = useRef<number>(1);

  const player = playerRef.current;
  const capture = captureRef.current;
  const speechService = speechRef.current;

  // Language & i18n
  const currentLang = (settings['ui.lang'] === 'en' ? 'en' : 'fr') as 'fr' | 'en';
  const dict = currentLang === 'en' ? (enDict as Record<string, string>) : (frDict as Record<string, string>);

  const hasKey = (key: string) => key in dict;
  const t = (key: string, params?: Record<string, any>): string => {
    let str = dict[key] || key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      }
    }
    return str;
  };

  const showToast = (message: string, duration = 3000) => {
    const id = ++toastSeqRef.current;
    setToasts((prev) => [...prev, { id, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, duration);
  };

  // Sync Pair
  const pair = DEFAULT_PAIR;
  const sideLang = (side: 'a' | 'b'): string => pair[side];
  const langName = (side: 'a' | 'b'): string => pair.names[pair[side]] || pair[side];
  const otherSide = (s: 'a' | 'b'): 'a' | 'b' => (s === 'a' ? 'b' : 'a');

  const swapPair = () => {
    const curLeft = settings['pair.left'] || 'a';
    updateSetting({ 'pair.left': curLeft === 'a' ? 'b' : 'a' });
  };

  const capOn = (id: string) => {
    const c = caps[id];
    return !!(c && c.enabled && (c.state === 'ready' || c.state === 'loading'));
  };

  // Apply UI Themes to <html>
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = settings['ui.theme'] || 'auto';
    root.dataset.layout = settings['ui.layout'] || 'auto';
    root.dataset.density = settings['ui.density'] || 'comfortable';
    root.dataset.motion = settings['ui.motion'] || 'full';
    root.dataset.fontText = settings['ui.font_text'] || 'literata';
    root.dataset.showBoth = String(settings['ui.show_original'] !== false);
    root.style.setProperty('--scale', String(settings['ui.text_scale'] ?? 1));

    if (settings['ui.color_a']) root.style.setProperty('--a', settings['ui.color_a']);
    if (settings['ui.color_b']) root.style.setProperty('--b', settings['ui.color_b']);

    const latBox = document.getElementById('latBox');
    if (latBox) latBox.hidden = settings['ui.show_latency'] === false;
  }, [settings]);

  // Audio capture event listeners
  useEffect(() => {
    const handleLevel = (e: any) => {
      const { level, speaking: isSpeaking, muted: isMuted } = e.detail;
      setMeterLevel(level);
      const mode = isMuted ? 'muted' : isSpeaking ? 'speech' : 'live';
      setMeterMode(mode);
    };

    const handleSpeechStart = () => {
      if (!capOn('listen')) return;
      const uttKey = `u${++seqRef.current}`;
      const srcSide = who === 'auto' ? (settings['pair.me'] === 'a' ? 'b' : 'a') : (who as 'a' | 'b');
      addOrUpdateUtterance({
        key: uttKey,
        side: srcSide,
        text: '...',
        state: 'live',
        ts: Date.now(),
      });
    };

    const handleSpeechEnd = () => {
      // VAD ended speech phrase
    };

    const handleClose = () => {
      setMeterMode('idle');
      setMeterLevel(0);
    };

    capture.addEventListener('level', handleLevel);
    capture.addEventListener('speechstart', handleSpeechStart);
    capture.addEventListener('speechend', handleSpeechEnd);
    capture.addEventListener('close', handleClose);

    return () => {
      capture.removeEventListener('level', handleLevel);
      capture.removeEventListener('speechstart', handleSpeechStart);
      capture.removeEventListener('speechend', handleSpeechEnd);
      capture.removeEventListener('close', handleClose);
    };
  }, [caps, who, settings]);

  // Echo guard: pause capture while speaking
  const echoGuardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!settings['listen.echo_guard']) {
      capture.setMuted(false);
      return;
    }
    if (speaking) {
      if (echoGuardTimerRef.current) clearTimeout(echoGuardTimerRef.current);
      capture.setMuted(true);
    } else {
      echoGuardTimerRef.current = setTimeout(() => {
        capture.setMuted(false);
      }, 350);
    }
  }, [speaking, settings]);

  // Player state listener
  useEffect(() => {
    const handleStart = () => setSpeaking(true);
    const handleIdle = () => setSpeaking(false);
    player.addEventListener('start', handleStart);
    player.addEventListener('idle', handleIdle);
    return () => {
      player.removeEventListener('start', handleStart);
      player.removeEventListener('idle', handleIdle);
    };
  }, [player]);

  // TypeSpeaker instance
  const typeSpeaker = useMemo(() => {
    return new TypeSpeaker({
      rhythm: settings['type.rhythm'] || 'group',
      pauseMs: settings['type.pause_ms'] || 380,
      minWords: settings['type.min_words'] || 3,
      onChunk: async (text) => {
        player.ensure();
        const me = settings['pair.me'] || 'b';
        const typeSide = (settings['type.lang'] === 'me' ? me : otherSide(me)) as 'a' | 'b';
        const saySide = (settings['type.say'] === 'me' ? me : otherSide(me)) as 'a' | 'b';

        let toSpeak = text;
        const srcLang = sideLang(typeSide);
        const tgtLang = sideLang(saySide);

        if (typeSide !== saySide) {
          if (capOn('translate')) {
            const res = await translateText(text, srcLang, tgtLang, glossaryRules, settings['translate.glossary']);
            toSpeak = res.text;
            setLat((prev) => ({ ...prev, mt: res.ms }));
          }
        }

        if (capOn('speak')) {
          setSpokenFeedback(`${t('compose.said')} : ${toSpeak}`);
          speakText(toSpeak, tgtLang);
        }
      },
    });
  }, [settings, caps, glossaryRules]);

  const updateSetting = (patch: Record<string, any>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      StorageService.saveSettings(next);
      return next;
    });
  };

  const resetSettings = (keys?: string[]) => {
    const defaults = getDefaultSettings();
    if (!keys) {
      setSettings(defaults);
      StorageService.saveSettings(defaults);
    } else {
      setSettings((prev) => {
        const next = { ...prev };
        for (const k of keys) {
          if (k in defaults) next[k] = defaults[k];
        }
        StorageService.saveSettings(next);
        return next;
      });
    }
  };

  const toggleCap = async (id: string) => {
    if (id === 'clone') {
      const cur = caps.clone || { id: 'clone', enabled: false, state: 'off' };
      const nextOn = !cur.enabled;
      setCaps((prev) => ({
        ...prev,
        clone: { id: 'clone', enabled: nextOn, state: nextOn ? 'ready' : 'off' },
      }));
      const profile = CloneVoiceService.getActiveProfile();
      showToast(nextOn ? `${t('cap.clone.enabled')} (${profile.name})` : t('cap.clone.disabled'));
      return;
    }

    const cur = caps[id] || { id, enabled: false, state: 'off' };
    const nextOn = !cur.enabled;
    player.ensure();

    if (nextOn && id === 'listen') {
      try {
        await capture.open(settings['listen.device'] || '');
      } catch (err: any) {
        showToast(err && err.code === 'no_mic_api' ? t('err.no_mic_api') : t('err.mic_denied'));
        return;
      }
    } else if (!nextOn && id === 'listen') {
      capture.close();
    }

    if (!nextOn && (id === 'speak' || id === 'typespeak')) {
      stopVoice();
    }

    setCaps((prev) => ({
      ...prev,
      [id]: { id, enabled: nextOn, state: nextOn ? 'ready' : 'off' },
    }));
  };

  const speakText = (text: string, langToSpeak: string) => {
    if (!text || !capOn('speak')) return;
    setSpeaking(true);

    if (capOn('clone')) {
      CloneVoiceService.speakCloned(text, langToSpeak, player, {
        rate: settings['speak.rate'] ?? 1.0,
        volume: settings['speak.volume'] ?? 0.9,
        onStart: () => setSpeaking(true),
        onEnd: () => setSpeaking(false),
        onError: () => setSpeaking(false),
      });
      return;
    }

    speechService.speak(text, langToSpeak, {
      rate: settings['speak.rate'] ?? 1.0,
      volume: settings['speak.volume'] ?? 0.9,
      onStart: () => setSpeaking(true),
      onEnd: (msFirst) => {
        setSpeaking(false);
        setLat((prev) => ({ ...prev, tts: msFirst }));
      },
      onError: () => setSpeaking(false),
    });
  };

  const stopVoice = () => {
    speechService.cancel();
    player.cancel();
    setSpeaking(false);
  };

  const addOrUpdateUtterance = (item: Partial<UtteranceItem> & { key: string }) => {
    setUtterances((prev) => {
      const idx = prev.findIndex((u) => u.key === item.key);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], ...item };
        return next;
      }
      return [
        ...prev,
        {
          key: item.key,
          side: item.side || 'a',
          text: item.text || '',
          translation: item.translation,
          to: item.to,
          state: item.state || 'final',
          ts: item.ts || Date.now(),
        },
      ];
    });

    // If final and text exists, also record into history if enabled
    if (item.state === 'final' && item.text && settings['history.save'] !== false) {
      const histItem: HistoryItem = {
        id: ++seqRef.current,
        side: item.side || 'a',
        lang: sideLang(item.side || 'a'),
        text: item.text,
        to: item.to || sideLang(otherSide(item.side || 'a')),
        translation: item.translation,
        ts: Math.floor((item.ts || Date.now()) / 1000),
      };
      setHistoryItems((prev) => {
        const updated = [...prev, histItem];
        StorageService.saveHistory(updated);
        return updated;
      });
    }
  };

  const clearFolio = () => {
    setUtterances([]);
  };

  // Sheet Controls
  const openSheet = (tab: 'settings' | 'library' | 'history' | 'glossary' | 'system' | 'meeting', section?: string) => {
    setSheetTab(tab);
    setSheetSection(section);
    setSheetOpen(true);
  };

  const closeSheet = () => {
    setSheetOpen(false);
  };

  // Profiles
  const saveProfile = (name: string) => {
    const list = StorageService.saveProfile(name, settings);
    setProfiles(list);
    showToast(t('settings.profile_saved'));
  };

  const applyProfile = (name: string) => {
    const all = StorageService.getProfiles();
    if (all[name]) {
      updateSetting(all[name]);
      showToast(t('settings.imported'));
    }
  };

  const deleteProfile = (name: string) => {
    const list = StorageService.deleteProfile(name);
    setProfiles(list);
  };

  // Glossary
  const saveGlossaryRules = (rules: GlossaryRule[]) => {
    setGlossaryRules(rules);
    StorageService.saveGlossary(rules);
    showToast(t('glossary.saved'));
  };

  // History
  const clearHistory = () => {
    setHistoryItems([]);
    StorageService.clearHistory();
    clearFolio();
  };

  const exportHistoryTxt = () => {
    let txt = '';
    for (const h of historyItems) {
      const date = new Date(h.ts * 1000).toLocaleString();
      const langLabel = pair.names[h.lang] || h.lang;
      txt += `[${date}] ${langLabel}: ${h.text}\n`;
      if (h.translation && h.to) {
        const toLabel = pair.names[h.to] || h.to;
        txt += `       -> ${toLabel}: ${h.translation}\n`;
      }
      txt += '\n';
    }
    const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'relais-conversation.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Recordings
  const saveRecording = (rec: VoiceRecording) => {
    setRecordings((prev) => {
      const next = [rec, ...prev];
      StorageService.saveRecordings(next);
      return next;
    });
    showToast(t('library.saved'));
  };

  const updateRecordingName = (id: string, name: string) => {
    setRecordings((prev) => {
      const next = prev.map((r) => (r.id === id ? { ...r, name } : r));
      StorageService.saveRecordings(next);
      return next;
    });
  };

  const deleteRecording = (id: string) => {
    setRecordings((prev) => {
      const next = prev.filter((r) => r.id !== id);
      StorageService.saveRecordings(next);
      return next;
    });
  };

  return (
    <AppContext.Provider
      value={{
        settings,
        updateSetting,
        resetSettings,
        lang: currentLang,
        t,
        hasKey,
        pair,
        sideLang,
        langName,
        swapPair,
        who,
        setWho,
        caps,
        capOn,
        toggleCap,
        lat,
        conn,
        utterances,
        addOrUpdateUtterance,
        clearFolio,
        player,
        capture,
        speechService,
        typeSpeaker,
        meterLevel,
        meterMode,
        speaking,
        speakText,
        stopVoice,
        spokenFeedback,
        setSpokenFeedback,
        sheetOpen,
        sheetTab,
        sheetSection,
        openSheet,
        closeSheet,
        setSheetTab,
        profiles,
        saveProfile,
        applyProfile,
        deleteProfile,
        glossaryRules,
        saveGlossaryRules,
        historyItems,
        clearHistory,
        exportHistoryTxt,
        recordings,
        saveRecording,
        updateRecordingName,
        deleteRecording,
        toasts,
        showToast,
        schema: schemaData,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within an AppProvider');
  return context;
};
