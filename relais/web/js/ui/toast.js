import { h } from '../dom.js';

export function toast(message, ms = 6500) {
  const box = document.getElementById('toasts');
  if (!box) return;
  while (box.children.length >= 3) box.firstChild.remove();
  const el = h('div', { class: 'toast', role: 'status' }, message);
  box.append(el);
  setTimeout(() => el.remove(), ms);
}
