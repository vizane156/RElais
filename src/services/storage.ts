import schemaData from '../data/schema.json';
import { GlossaryRule } from './glossary';

export interface HistoryItem {
  id: number;
  side: 'a' | 'b';
  lang: string;
  text: string;
  to?: string;
  translation?: string;
  kind?: string;
  ts: number;
}

export interface VoiceRecording {
  id: string;
  name: string;
  kind: 'voice' | 'clip';
  lang: string;
  duration: number;
  sampleRate: number;
  blobUrl?: string;
  bytes?: Uint8Array;
  ts: number;
}

const STORAGE_KEYS = {
  SETTINGS: 'relais_settings_v1',
  PROFILES: 'relais_profiles_v1',
  GLOSSARY: 'relais_glossary_v1',
  HISTORY: 'relais_history_v1',
  RECORDINGS: 'relais_recordings_v1',
};

// Default settings computed from schema.json
export function getDefaultSettings(): Record<string, any> {
  const defaults: Record<string, any> = {};
  for (const section of schemaData.sections) {
    for (const field of section.fields) {
      defaults[field.key] = (field as any).default;
    }
  }
  for (const hidden of schemaData.hidden) {
    defaults[hidden.key] = (hidden as any).default;
  }
  return defaults;
}

export class StorageService {
  static getSettings(): Record<string, any> {
    const defaults = getDefaultSettings();
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (stored) {
        return { ...defaults, ...JSON.parse(stored) };
      }
    } catch {
      /* ignore */
    }
    return defaults;
  }

  static saveSettings(settings: Record<string, any>) {
    try {
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
    } catch {
      /* ignore */
    }
  }

  static getProfiles(): Record<string, Record<string, any>> {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.PROFILES);
      if (stored) return JSON.parse(stored);
    } catch {
      /* ignore */
    }
    return {
      "Réunion": { ...getDefaultSettings(), "speak.volume": 0.8 },
      "Appel": { ...getDefaultSettings(), "speak.rate": 1.1 }
    };
  }

  static saveProfile(name: string, settings: Record<string, any>) {
    const profiles = this.getProfiles();
    profiles[name] = settings;
    try {
      localStorage.setItem(STORAGE_KEYS.PROFILES, JSON.stringify(profiles));
    } catch {
      /* ignore */
    }
    return Object.keys(profiles);
  }

  static deleteProfile(name: string) {
    const profiles = this.getProfiles();
    delete profiles[name];
    try {
      localStorage.setItem(STORAGE_KEYS.PROFILES, JSON.stringify(profiles));
    } catch {
      /* ignore */
    }
    return Object.keys(profiles);
  }

  static getGlossary(): GlossaryRule[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.GLOSSARY);
      if (stored) return JSON.parse(stored);
    } catch {
      /* ignore */
    }
    return [
      { src: 'fr', term: 'Relais', target: 'Relais', mode: 'keep' },
      { src: 'en', term: 'Relais', target: 'Relais', mode: 'keep' }
    ];
  }

  static saveGlossary(rules: GlossaryRule[]) {
    try {
      localStorage.setItem(STORAGE_KEYS.GLOSSARY, JSON.stringify(rules));
    } catch {
      /* ignore */
    }
  }

  static getHistory(): HistoryItem[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.HISTORY);
      if (stored) return JSON.parse(stored);
    } catch {
      /* ignore */
    }
    return [];
  }

  static saveHistory(items: HistoryItem[]) {
    try {
      localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(items.slice(-300)));
    } catch {
      /* ignore */
    }
  }

  static clearHistory() {
    try {
      localStorage.removeItem(STORAGE_KEYS.HISTORY);
    } catch {
      /* ignore */
    }
  }

  static getRecordings(): VoiceRecording[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.RECORDINGS);
      if (stored) return JSON.parse(stored);
    } catch {
      /* ignore */
    }
    return [];
  }

  static saveRecordings(recs: VoiceRecording[]) {
    try {
      // Save metadata without huge byte arrays in localStorage
      const meta = recs.map((r) => ({
        id: r.id,
        name: r.name,
        kind: r.kind,
        lang: r.lang,
        duration: r.duration,
        sampleRate: r.sampleRate,
        ts: r.ts,
      }));
      localStorage.setItem(STORAGE_KEYS.RECORDINGS, JSON.stringify(meta));
    } catch {
      /* ignore */
    }
  }
}
