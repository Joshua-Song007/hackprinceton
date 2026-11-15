// Minimal DOM for exercising the actual player/PearUI/panel without adding a browser dependency.
export class PreviewElement extends EventTarget {
  children: (PreviewElement | string)[] = [];
  parent: PreviewElement | null = null;
  attrs: Record<string, string> = {};
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  className = '';
  value = '';
  disabled = false;
  hidden = false;
  checked = false;
  private content = '';
  private captures = new Set<number>();
  classList = { add: (name: string) => { this.className += ` ${name}`; } };
  constructor(readonly tagName: string, readonly ownerDocument: PreviewDocument) { super(); }
  set textContent(value: string) { this.content = value; this.children = []; }
  get textContent(): string { return this.content + this.children.map((c) => typeof c === 'string' ? c : c.textContent).join(''); }
  setAttribute(name: string, value: string): void {
    this.attrs[name] = value;
    if (name === 'class') this.className = value;
    if (name === 'value') this.value = value;
    if (name === 'disabled') this.disabled = true;
    if (name === 'hidden') this.hidden = true;
    if (name === 'checked') this.checked = true;
  }
  append(...children: (PreviewElement | string)[]): void { children.forEach((c) => this.appendChild(c)); }
  appendChild(child: PreviewElement | string): PreviewElement | string {
    if (typeof child !== 'string') child.parent = this;
    this.children.push(child);
    return child;
  }
  replaceChildren(...children: (PreviewElement | string)[]): void { this.content = ''; this.children = []; this.append(...children); }
  remove(): void { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); }
  click(): void { if (!this.disabled) this.dispatchEvent(new Event('click')); }
  getBoundingClientRect() { return { left: 10, top: 20, width: 200, height: 100 }; }
  setPointerCapture(id: number): void { this.captures.add(id); }
  hasPointerCapture(id: number): boolean { return this.captures.has(id); }
  releasePointerCapture(id: number): void { this.captures.delete(id); this.dispatchEvent(new Event('lostpointercapture')); }
  find(predicate: (el: PreviewElement) => boolean): PreviewElement[] {
    return [this, ...this.children.flatMap((c) => typeof c === 'string' ? [] : c.find(() => true))].filter(predicate);
  }
  asElement(): HTMLElement { return this as unknown as HTMLElement; }
}
export class PreviewDocument extends EventTarget {
  hidden = false;
  head = new PreviewElement('head', this);
  root = new PreviewElement('main', this);
  createElement(tag: string): PreviewElement { return new PreviewElement(tag, this); }
  getElementById(id: string): PreviewElement | null { return id === 'player' ? this.root : null; }
}
export const pointerEvent = (type: string, values: Record<string, unknown> = {}): Event =>
  Object.assign(new Event(type, { cancelable: true }), { pointerId: 1, pointerType: 'pen', clientX: 110, clientY: 70, pressure: .5, tiltX: 20, tiltY: -10, buttons: 1, ...values });
