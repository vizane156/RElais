// Construction du DOM sans innerHTML : tout texte (surtout ce que dit une personne) passe par
// textContent, donc rien de ce qui est transcrit ne peut injecter du HTML.

export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'selected' || k === 'disabled' || k === 'hidden') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function clear(el) { el.replaceChildren(); return el; }

let uid = 0;
export const nextId = (p = 'id') => `${p}-${++uid}`;

/** Bouton « destructif » en deux temps : un premier clic arme, le second confirme. */
export function confirmButton(btn, labelArmed, action, ms = 3000) {
  let timer = null, original = null;
  btn.addEventListener('click', () => {
    if (timer) { clearTimeout(timer); timer = null; btn.replaceChildren(...original); btn.classList.remove('danger'); action(); return; }
    original = [...btn.childNodes];
    btn.replaceChildren(document.createTextNode(labelArmed));
    btn.classList.add('danger');
    timer = setTimeout(() => { timer = null; btn.replaceChildren(...original); btn.classList.remove('danger'); }, ms);
  });
}
