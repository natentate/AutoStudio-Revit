import { App } from './ui/app.js';

const app = new App();
window.addEventListener('DOMContentLoaded', () => app.start());
if (import.meta.env?.DEV) window.__app = app;
