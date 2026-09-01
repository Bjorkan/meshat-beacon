import '@testing-library/jest-dom/vitest';
import i18n from '../src/i18n';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Production defaults to Swedish (src/i18n.ts), but the component suites assert on English copy.
// Pin the test language to English up front; tests that exercise language switching set their own.
await i18n.changeLanguage('en');

// jsdom doesn't implement matchMedia. Provide a default stub so components that read media queries
// mount as "desktop" by default — a hover-capable pointer, not below the mobile width. Individual
// tests can override window.matchMedia with their own controllable mock to drive a query.
// (hover: …) → true keeps hover-driven UI (tooltips, the path popover) in hover mode by default;
// width queries → false keep the desktop layout.
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: /hover/.test(query),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

// Radix floating primitives observe their trigger/content geometry. jsdom has no layout engine, so
// a no-op observer is sufficient for interaction tests while production uses the browser native API.
class ResizeObserverMock implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverMock;

// Radix DismissableLayer uses PointerEvent/capture APIs that jsdom does not expose.
window.PointerEvent = MouseEvent as typeof PointerEvent;
HTMLElement.prototype.hasPointerCapture = () => false;
HTMLElement.prototype.setPointerCapture = () => {};
HTMLElement.prototype.releasePointerCapture = () => {};
HTMLElement.prototype.scrollIntoView = () => {};

afterEach(() => {
  cleanup();
});
