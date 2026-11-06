import { Player } from '../audio/player';

export interface TTSOptions {
  voice?: string;
  rate?: number;
  volume?: number;
  onStart?: () => void;
  onEnd?: (msFirst: number) => void;
  onError?: (err: any) => void;
}

export class SpeechService {
  player: Player;
  speaking: boolean = false;
  currentUtterance: SpeechSynthesisUtterance | null = null;
  recognition: any = null;
  listening: boolean = false;

  constructor(player: Player) {
    this.player = player;
  }

  speak(text: string, lang: string, options: TTSOptions = {}) {
    if (!text || !text.trim()) return;

    this.player.ensure();
    const t0 = performance.now();
    let firstSoundSent = false;

    // 1. Play soft cue tone in Web Audio
    if (this.player.ctx) {
      try {
        const ctx = this.player.ctx;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(lang === 'fr' ? 440 : 520, ctx.currentTime);
        gain.gain.setValueAtTime((options.volume ?? 0.8) * 0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.15);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.15);
      } catch {
        /* ignore */
      }
    }

    // 2. Web Speech API SpeechSynthesis
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      this.currentUtterance = utterance;

      utterance.lang = lang === 'fr' ? 'fr-FR' : 'en-US';
      utterance.rate = options.rate ?? 1.0;
      utterance.volume = options.volume ?? 0.9;

      // Pick best matching voice
      const voices = window.speechSynthesis.getVoices();
      const targetLangPrefix = lang === 'fr' ? 'fr' : 'en';
      const matchedVoice = voices.find((v) => v.lang.startsWith(targetLangPrefix));
      if (matchedVoice) {
        utterance.voice = matchedVoice;
      }

      utterance.onstart = () => {
        this.speaking = true;
        const msFirst = Math.round(performance.now() - t0);
        firstSoundSent = true;
        if (options.onStart) options.onStart();
      };

      utterance.onend = () => {
        this.speaking = false;
        this.currentUtterance = null;
        const msFirst = Math.round(performance.now() - t0);
        if (options.onEnd) options.onEnd(msFirst);
      };

      utterance.onerror = (e) => {
        this.speaking = false;
        this.currentUtterance = null;
        if (options.onError) options.onError(e);
      };

      window.speechSynthesis.speak(utterance);
    } else {
      // Fallback timer if synthesis not supported
      this.speaking = true;
      if (options.onStart) options.onStart();
      setTimeout(() => {
        this.speaking = false;
        if (options.onEnd) options.onEnd(Math.round(performance.now() - t0));
      }, Math.max(800, text.length * 50));
    }
  }

  cancel() {
    this.speaking = false;
    this.currentUtterance = null;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    this.player.cancel();
  }

  // Speech Recognition (STT)
  startRecognition({
    lang,
    onResult,
    onError,
    onEnd,
  }: {
    lang: string;
    onResult: (text: string, isFinal: boolean) => void;
    onError: (err: any) => void;
    onEnd: () => void;
  }) {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.warn('SpeechRecognition API non supportée dans ce navigateur.');
      return null;
    }

    try {
      if (this.recognition) {
        try { this.recognition.stop(); } catch { /* ignore */ }
      }

      const rec = new SpeechRecognition();
      this.recognition = rec;
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = lang === 'fr' ? 'fr-FR' : 'en-US';

      rec.onresult = (e: any) => {
        let interimText = '';
        let finalText = '';

        for (let i = e.resultIndex; i < e.results.length; i++) {
          const transcript = e.results[i][0].transcript;
          if (e.results[i].isFinal) {
            finalText += transcript;
          } else {
            interimText += transcript;
          }
        }

        if (finalText) {
          onResult(finalText.trim(), true);
        } else if (interimText) {
          onResult(interimText.trim(), false);
        }
      };

      rec.onerror = (e: any) => {
        if (e.error !== 'no-speech') {
          onError(e);
        }
      };

      rec.onend = () => {
        this.listening = false;
        onEnd();
      };

      rec.start();
      this.listening = true;
      return rec;
    } catch (err) {
      onError(err);
      return null;
    }
  }

  stopRecognition() {
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        /* ignore */
      }
      this.recognition = null;
      this.listening = false;
    }
  }
}
