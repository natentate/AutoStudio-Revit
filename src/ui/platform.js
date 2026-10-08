// Host integration: native dialogs and menus under Electron, with browser
// fallbacks (download links / file inputs) so the renderer also runs in a
// plain browser during development.

const native = typeof window !== 'undefined' ? window.autostudio : undefined;

export const isElectron = !!native;
export const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent);

function download(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = async () => {
      const file = input.files?.[0];
      resolve(file ? { path: null, name: file.name, content: await file.text() } : null);
    };
    input.click();
  });
}

const dataUrlToBlob = (dataUrl) => {
  const [head, b64] = dataUrl.split(',');
  const mime = head.match(/data:([^;]+)/)?.[1] ?? 'application/octet-stream';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
};

export const platform = {
  /** Returns { path, name, content } or null when cancelled. */
  async openProject() {
    if (native) return native.openProject();
    return pickFile('.asbim,application/json');
  },

  /** Save project text. Returns the saved path (or name in the browser), or null when cancelled. */
  async saveProject({ path, content, saveAs, suggestedName }) {
    if (native) return native.saveProject({ path, content, saveAs, suggestedName });
    download(`${suggestedName || 'Project'}.asbim`, new Blob([content], { type: 'application/json' }));
    return `${suggestedName || 'Project'}.asbim`;
  },

  /** Export a text file or a data: URL (images). */
  async exportFile({ suggestedName, extension, filterName, content, dataUrl }) {
    if (native) return native.exportFile({ suggestedName, extension, filterName, content, dataUrl });
    download(`${suggestedName}.${extension}`, dataUrl ? dataUrlToBlob(dataUrl) : new Blob([content], { type: 'text/plain' }));
    return `${suggestedName}.${extension}`;
  },

  setDocumentState(state) {
    native?.setDocumentState(state);
  },

  onMenu(fn) {
    native?.onMenu(fn);
  },

  onOpenFile(fn) {
    native?.onOpenFile(fn);
  },

  closeWindow() {
    native?.closeWindow();
  },

  rendererReady() {
    native?.rendererReady();
  },
};
