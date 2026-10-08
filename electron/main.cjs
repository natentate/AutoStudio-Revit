// Electron main process: window, native menus, file dialogs and the
// unsaved-changes prompt.

const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

const isMac = process.platform === 'darwin';
const PROJECT_FILTER = { name: 'AutoStudio Project', extensions: ['asbim'] };

let win = null;
let rendererReady = false;
let isQuitting = false;
let forceClose = false;
let quitAfterSave = false;
const pendingFiles = [];
const docState = { title: 'Project 1', dirty: false, path: null };

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

async function readProject(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  return { path: filePath, name: path.basename(filePath), content };
}

async function openPath(filePath) {
  try {
    const file = await readProject(filePath);
    app.addRecentDocument(filePath);
    if (win && rendererReady) send('open-file', file);
    else {
      pendingFiles.push(file);
      if (!win) createWindow();
    }
  } catch (err) {
    dialog.showErrorBox('Cannot Open Project', `${filePath}\n\n${err.message}`);
  }
}

function createWindow() {
  rendererReady = false;
  forceClose = false;
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'AutoStudio',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 12, y: 10 },
    backgroundColor: '#e9ebee',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win.show());

  if (process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  // Never navigate away from the app; open web links in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  win.on('close', async (e) => {
    if (forceClose || !docState.dirty) return;
    e.preventDefault();
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      message: `Do you want to save the changes you made to “${docState.title}”?`,
      detail: "Your changes will be lost if you don't save them.",
    });
    if (response === 0) {
      // The renderer saves, then asks to close; if the save is cancelled nothing quits.
      quitAfterSave = isQuitting;
      isQuitting = false;
      send('menu', 'saveAndClose');
    }
    else if (response === 1) {
      forceClose = true;
      win.close();
    } else isQuitting = false;
  });
  win.on('closed', () => {
    win = null;
  });
}

function buildMenu() {
  const cmd = (label, command, accelerator) => ({ label, accelerator, click: () => send('menu', command) });
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        cmd('About AutoStudio', 'about'),
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: 'File',
      submenu: [
        cmd('New Project', 'new', 'CmdOrCtrl+N'),
        cmd('Open…', 'open', 'CmdOrCtrl+O'),
        ...(isMac ? [{ role: 'recentDocuments', submenu: [{ role: 'clearRecentDocuments' }] }] : []),
        cmd('Open Sample Project', 'openSample'),
        { type: 'separator' },
        cmd('Save', 'save', 'CmdOrCtrl+S'),
        cmd('Save As…', 'saveAs', 'Shift+CmdOrCtrl+S'),
        { type: 'separator' },
        {
          label: 'Export',
          submenu: [
            cmd('IFC (Industry Foundation Classes)…', 'exportIFC', 'CmdOrCtrl+E'),
            cmd('Image (PNG) of Current View…', 'exportPNG'),
            cmd('Schedule (CSV)…', 'exportCSV'),
          ],
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        cmd('Undo', 'undo', 'CmdOrCtrl+Z'),
        cmd('Redo', 'redo', 'Shift+CmdOrCtrl+Z'),
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        cmd('Select All', 'selectAll', 'CmdOrCtrl+A'),
      ],
    },
    {
      label: 'View',
      submenu: [
        cmd('Default 3D View', 'view3d', 'CmdOrCtrl+3'),
        cmd('Zoom to Fit', 'zoomFit', 'CmdOrCtrl+0'),
        cmd('Visibility/Graphics…', 'visibility'),
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }]),
      ],
    },
    {
      label: 'Manage',
      submenu: [
        cmd('Project Information…', 'projectInfo'),
        cmd('Levels…', 'levels'),
        cmd('Types…', 'types'),
        cmd('Project Units…', 'units'),
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        cmd('Keyboard Shortcuts', 'shortcuts', 'CmdOrCtrl+/'),
        ...(isMac ? [] : [cmd('About AutoStudio', 'about')]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// --- IPC -------------------------------------------------------------------------

ipcMain.handle('project:open', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [PROJECT_FILTER] });
  if (r.canceled || !r.filePaths.length) return null;
  app.addRecentDocument(r.filePaths[0]);
  return readProject(r.filePaths[0]);
});

ipcMain.handle('project:save', async (_e, { path: filePath, content, saveAs, suggestedName }) => {
  let target = filePath;
  if (saveAs || !target) {
    const r = await dialog.showSaveDialog(win, {
      defaultPath: `${suggestedName || 'Project'}.asbim`,
      filters: [PROJECT_FILTER],
    });
    if (r.canceled || !r.filePath) return null;
    target = r.filePath.endsWith('.asbim') ? r.filePath : `${r.filePath}.asbim`;
  }
  // Write to a temporary file first so a failed write never truncates the project.
  const tmp = `${target}.tmp-${process.pid}`;
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, target);
  app.addRecentDocument(target);
  return target;
});

ipcMain.handle('file:export', async (_e, { suggestedName, extension, filterName, content, dataUrl }) => {
  const r = await dialog.showSaveDialog(win, {
    defaultPath: `${suggestedName}.${extension}`,
    filters: [{ name: filterName, extensions: [extension] }],
  });
  if (r.canceled || !r.filePath) return null;
  const data = dataUrl ? Buffer.from(dataUrl.split(',')[1], 'base64') : content;
  await fs.writeFile(r.filePath, data);
  return r.filePath;
});

ipcMain.on('doc:state', (_e, state) => {
  Object.assign(docState, state);
  if (!win) return;
  win.setTitle(`${state.title}${state.dirty ? ' — Edited' : ''}`);
  if (isMac) {
    win.setDocumentEdited(!!state.dirty);
    win.setRepresentedFilename(state.path || '');
  }
});

ipcMain.on('window:close', () => {
  forceClose = true;
  isQuitting = quitAfterSave;
  win?.close();
});

ipcMain.on('renderer:ready', () => {
  rendererReady = true;
  while (pendingFiles.length) send('open-file', pendingFiles.shift());
});

// --- app lifecycle -------------------------------------------------------------------

// Finder "Open With" / double-clicking a .asbim file (may fire before ready).
app.on('open-file', (e, filePath) => {
  e.preventDefault();
  if (app.isReady()) openPath(filePath);
  else app.whenReady().then(() => openPath(filePath));
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.whenReady().then(() => {
  app.setAboutPanelOptions({ applicationName: 'AutoStudio', applicationVersion: app.getVersion() });
  buildMenu();
  if (!win) createWindow();
  const arg = process.argv.slice(1).find((a) => a.endsWith('.asbim'));
  if (arg) openPath(path.resolve(arg));
  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac || isQuitting) app.quit();
});
