/**
 * Glossaire : termes à garder tels quels ou à toujours traduire d'une façon précise.
 * Technique : avant la traduction, chaque terme est remplacé par un jeton opaque (GLS0, GLS1…)
 * que le modèle recopie ; après, on remet la forme voulue.
 */

export interface GlossaryRule {
  src: string;        // langue du terme (« en » ou « fr »)
  term: string;
  target: string;     // vide = garder tel quel
  mode: 'keep' | 'replace';
}

const TOKEN_RE = /(?<![A-Za-z])G\s?L\s?S\s?[-_]?\s?(\d+)(?!\d)/gi;

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class Glossary {
  rules: GlossaryRule[];

  constructor(rules: GlossaryRule[]) {
    this.rules = rules.filter((r) => r.term && r.term.trim().length > 0);
  }

  protect(text: string, src: string): { protectedText: string; slots: Array<[number, string]> } {
    const slots: Array<[number, string]> = [];
    const srcRules = this.rules
      .filter((r) => r.src === src)
      .sort((a, b) => b.term.length - a.term.length);

    let currentText = text;
    for (const rule of srcRules) {
      const escaped = escapeRegExp(rule.term.trim());
      const regex = new RegExp(`(?<!\\w)${escaped}(?!\\w)`, 'gi');
      currentText = currentText.replace(regex, (matched) => {
        const idx = slots.length;
        const replacement = rule.mode === 'keep' || !rule.target.trim() ? matched : rule.target.trim();
        slots.push([idx, replacement]);
        return `GLS${idx}`;
      });
    }

    return { protectedText: currentText, slots };
  }

  restore(translated: string, slots: Array<[number, string]>): string {
    if (!slots.length) return translated;
    const byIdx = new Map(slots);
    const seen = new Set<number>();

    const out = translated.replace(TOKEN_RE, (original, numStr) => {
      const idx = parseInt(numStr, 10);
      if (byIdx.has(idx)) {
        seen.add(idx);
        return byIdx.get(idx)!;
      }
      return original;
    });

    // Si un jeton est manquant, on renvoie out ou au moins ce qui a pu être remplacé
    return out;
  }
}
