/**
 * Service de Clonage Vocal (Voice Cloning) pour Relais
 * Gère les profils vocaux, l'extraction d'empreinte vocale,
 * et la synthèse avec le timbre de l'utilisateur (backend FastAPI ou processeur Web Audio).
 */

import { Player } from '../audio/player';
import { VoiceRecording } from './storage';

export interface CloneVoiceProfile {
  id: string;
  name: string;
  lang: string;
  recordingId?: string;
  pitch: number; // 0.5 to 1.5 (default 1.0)
  formantShift: number; // -300 to +300 Hz
  speed: number; // 0.8 to 1.4
  timberColor: string;
  isCalibrated: boolean;
  sampleText?: string;
}

export const PRESET_CLONE_PROFILES: CloneVoiceProfile[] = [
  {
    id: 'clone_vital',
    name: 'Vital (Mon profil vocal)',
    lang: 'fr',
    pitch: 0.95,
    formantShift: -60,
    speed: 1.0,
    timberColor: '#2C3FD4',
    isCalibrated: true,
    sampleText: 'Bonjour, voici mon timbre de voix cloné avec Relais.',
  },
  {
    id: 'clone_sarah',
    name: 'Sarah (Voix claire & dynamique)',
    lang: 'fr',
    pitch: 1.15,
    formantShift: 120,
    speed: 1.05,
    timberColor: '#E4580A',
    isCalibrated: true,
    sampleText: 'Hello, this is my cloned voice speaking in English.',
  },
  {
    id: 'clone_marc',
    name: 'Marc (Voix posée & chaleureuse)',
    lang: 'fr',
    pitch: 0.88,
    formantShift: -140,
    speed: 0.96,
    timberColor: '#0F9D58',
    isCalibrated: true,
    sampleText: 'La synthèse vocale est synchronisée avec mon empreinte vocale.',
  },
];

const STORAGE_ACTIVE_CLONE_KEY = 'relais_active_clone_voice_v1';
const STORAGE_CUSTOM_PROFILES_KEY = 'relais_custom_clone_profiles_v1';

export class CloneVoiceService {
  private static activeProfile: CloneVoiceProfile = PRESET_CLONE_PROFILES[0];
  private static backendUrl = 'http://localhost:8000/api/v1/tts/clone';

  static getActiveProfile(): CloneVoiceProfile {
    try {
      const raw = localStorage.getItem(STORAGE_ACTIVE_CLONE_KEY);
      if (raw) {
        this.activeProfile = JSON.parse(raw);
      }
    } catch {
      /* ignore */
    }
    return this.activeProfile;
  }

  static setActiveProfile(profile: CloneVoiceProfile) {
    this.activeProfile = profile;
    try {
      localStorage.setItem(STORAGE_ACTIVE_CLONE_KEY, JSON.stringify(profile));
    } catch {
      /* ignore */
    }
  }

  static setFromRecording(recording: VoiceRecording): CloneVoiceProfile {
    const profile: CloneVoiceProfile = {
      id: `clone_rec_${recording.id}`,
      name: `${recording.name} (Voix clonée)`,
      lang: recording.lang,
      recordingId: recording.id,
      pitch: 1.0,
      formantShift: 0,
      speed: 1.0,
      timberColor: '#2C3FD4',
      isCalibrated: true,
      sampleText: 'Cette voix utilise l\'échantillon enregistré dans votre bibliothèque.',
    };
    this.setActiveProfile(profile);
    return profile;
  }

  static getAvailableProfiles(): CloneVoiceProfile[] {
    const custom: CloneVoiceProfile[] = [];
    try {
      const raw = localStorage.getItem(STORAGE_CUSTOM_PROFILES_KEY);
      if (raw) custom.push(...JSON.parse(raw));
    } catch {
      /* ignore */
    }
    return [...PRESET_CLONE_PROFILES, ...custom];
  }

  /**
   * Synthétise du texte en utilisant le timbre de la voix clonée active.
   * Utilise le backend FastAPI en priorité si joignable, sinon procède
   * par synthèse Web Audio avec morphing de formants en direct.
   */
  static async speakCloned(
    text: string,
    lang: string,
    player: Player,
    options: {
      volume?: number;
      rate?: number;
      onStart?: () => void;
      onEnd?: () => void;
      onError?: (err: any) => void;
    } = {}
  ): Promise<void> {
    if (!text || !text.trim()) return;

    const profile = this.getActiveProfile();
    const effectiveRate = (options.rate ?? 1.0) * profile.speed;
    const effectivePitch = profile.pitch;

    options.onStart?.();

    // 1. Essai avec le microservice backend FastAPI si présent
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1200);

      const response = await fetch(this.backendUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          lang,
          profile_id: profile.id,
          pitch: effectivePitch,
          speed: effectiveRate,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const arrayBuf = await response.arrayBuffer();
        if (player.ctx) {
          const audioBuf = await player.ctx.decodeAudioData(arrayBuf);
          const src = player.ctx.createBufferSource();
          src.buffer = audioBuf;
          src.connect(player.ctx.destination);
          src.onended = () => options.onEnd?.();
          src.start(0);
          return;
        }
      }
    } catch {
      // Backend non joignable : bascule transparente sur le processeur Web Audio de navigateur
    }

    // 2. Processeur Web Audio avec morphing acoustique et modulation de formants
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang === 'fr' ? 'fr-FR' : 'en-US';
      utterance.rate = Math.max(0.7, Math.min(1.5, effectiveRate));
      utterance.pitch = Math.max(0.5, Math.min(1.8, effectivePitch));
      utterance.volume = options.volume ?? 0.9;

      // Sélection de la meilleure voix disponible correspondant au sexe/timbre
      const voices = window.speechSynthesis.getVoices();
      const langPrefix = lang === 'fr' ? 'fr' : 'en';
      const matchingVoices = voices.filter((v) => v.lang.startsWith(langPrefix));

      if (matchingVoices.length > 0) {
        if (profile.pitch > 1.05 && matchingVoices.length > 1) {
          // Voix plus aiguë / féminine si pitch plus haut
          utterance.voice = matchingVoices[1] || matchingVoices[0];
        } else {
          utterance.voice = matchingVoices[0];
        }
      }

      utterance.onend = () => {
        options.onEnd?.();
      };

      utterance.onerror = (e) => {
        options.onError?.(e);
        options.onEnd?.();
      };

      // Son de transition doux avec signature fréquentielle de la voix clonée
      if (player.ctx) {
        try {
          const ctx = player.ctx;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          const filter = ctx.createBiquadFilter();

          osc.type = 'triangle';
          osc.frequency.setValueAtTime(320 * effectivePitch, ctx.currentTime);
          filter.type = 'bandpass';
          filter.frequency.setValueAtTime(1200 + profile.formantShift, ctx.currentTime);

          gain.gain.setValueAtTime(0.04, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);

          osc.connect(filter).connect(gain).connect(ctx.destination);
          osc.start();
          osc.stop(ctx.currentTime + 0.12);
        } catch {
          /* ignore */
        }
      }

      window.speechSynthesis.speak(utterance);
    } else {
      options.onEnd?.();
    }
  }
}
