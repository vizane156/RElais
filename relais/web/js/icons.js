const NS = 'http://www.w3.org/2000/svg';

/** <svg><use href="…/icons.svg#i-nom"></svg> : les icônes viennent de assets/icons.svg. */
export function icon(name, cls = 'ic') {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(NS, 'use');
  use.setAttribute('href', `/assets/icons.svg#i-${name}`);
  svg.append(use);
  return svg;
}
