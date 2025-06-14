const { app, BrowserWindow, dialog, shell, Menu, Tray, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { startServer, stopServer, getServerPort, isServerRunning } = require('./server');

// Set app name immediately for CMD+Tab on macOS - must be before app.whenReady()
app.setName('Hyperclay Local');
// Also set the name property directly
app.name = 'Hyperclay Local';

// Set app info for About panel on macOS
if (process.platform === 'darwin') {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  const aboutOptions = {
    applicationName: 'Hyperclay Local',
    applicationVersion: '1.0.0',
    version: '1.0.0',
    copyright: 'Made with ❤️ for Hyperclay'
  };
  
  // Add icon if it exists
  if (fs.existsSync(iconPath)) {
    aboutOptions.iconPath = iconPath;
  }
  
  app.setAboutPanelOptions(aboutOptions);
}

// Storage utilities
const userData = app.getPath('userData');
const settingsPath = path.join(userData, 'settings.json');

function loadSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
  return {};
}

function saveSettings(settings) {
  try {
    // Ensure userData directory exists
    if (!fs.existsSync(userData)) {
      fs.mkdirSync(userData, { recursive: true });
    }
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  } catch (error) {
    console.error('Failed to save settings:', error);
  }
}

let mainWindow;
let tray;
let serverRunning = false;
let selectedFolder = null;
let settings = {};

// Enable live reload for development
if (process.argv.includes('--dev')) {
  require('electron-reload')(__dirname, {
    electron: path.join(__dirname, 'node_modules', '.bin', 'electron'),
    hardResetMethod: 'exit'
  });
}

function createWindow() {
  // Try to load icon, with fallback options
  let iconPath = null;
  const possibleIcons = [
    path.join(__dirname, 'assets', 'icon.png'),
    path.join(__dirname, 'assets', 'icon.svg'),
  ];
  
  for (const iconFile of possibleIcons) {
    if (fs.existsSync(iconFile)) {
      iconPath = iconFile;
      break;
    }
  }
  
  const windowOptions = {
    title: 'Hyperclay Local',
    width: 720,
    height: 600,
    resizable: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false
  };
  
  // Add icon only if we found one
  if (iconPath) {
    windowOptions.icon = iconPath;
  }
  
  mainWindow = new BrowserWindow(windowOptions);

  mainWindow.loadFile('app.html');

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    
    // Focus the window on macOS
    if (process.platform === 'darwin') {
      app.focus();
    }
    
    // Update UI with loaded settings
    updateUI();
  });

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Add context menu with copy functionality
  mainWindow.webContents.on('context-menu', (event, params) => {
    const { selectionText, isEditable } = params;
    
    if (selectionText || isEditable) {
      const contextMenu = Menu.buildFromTemplate([
        {
          label: 'Copy',
          role: 'copy',
          enabled: selectionText.length > 0
        },
        {
          label: 'Cut',
          role: 'cut',
          enabled: isEditable && selectionText.length > 0
        },
        {
          label: 'Paste',
          role: 'paste',
          enabled: isEditable
        },
        { type: 'separator' },
        {
          label: 'Select All',
          role: 'selectAll'
        }
      ]);
      
      contextMenu.popup();
    }
  });

  // Create system tray
  createTray();

  // Create menu
  createMenu();
}

function createTray() {
  // Create tray icon
  // Try to use tray-icon.png first, then fall back to main icon
  const trayIconPath = path.join(__dirname, 'assets', 'tray-icon.png');
  const mainIconPath = path.join(__dirname, 'assets', 'icon.png');
  let trayIcon;
  
  try {
    // Try tray-specific icon first
    if (fs.existsSync(trayIconPath)) {
      trayIcon = nativeImage.createFromPath(trayIconPath);
    } else if (fs.existsSync(mainIconPath)) {
      // Fall back to main icon and resize it for tray
      trayIcon = nativeImage.createFromPath(mainIconPath);
      // Resize to 16x16 for tray on most platforms (22x22 on macOS)
      const size = process.platform === 'darwin' ? 22 : 16;
      trayIcon = trayIcon.resize({ width: size, height: size });
    }
    if (!trayIcon || trayIcon.isEmpty()) {
      // Fallback to a simple icon if file doesn't exist
      trayIcon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAdgAAAHYBTnsmCAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAFYSURBVDiNpZM9SwNBEIafgwQSCxsLwcJCG1sLG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sL');
    }
  } catch (error) {
    // Create a simple colored square as fallback
    trayIcon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAdgAAAHYBTnsmCAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAFYSURBVDiNpZM9SwNBEIafgwQSCxsLwcJCG1sLG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sLwcJCG1sL');
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('Hyperclay Local Server');
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show App',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow();
        }
      }
    },
    {
      label: serverRunning ? 'Stop Server' : 'Start Server',
      click: () => {
        if (serverRunning) {
          handleStopServer();
        } else {
          handleStartServer();
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      }
    }
  ]);
  
  tray.setContextMenu(contextMenu);
  
  // Double click to show/hide window
  tray.on('double-click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Select Folder...',
          accelerator: 'CmdOrCtrl+O',
          click: handleSelectFolder
        },
        { type: 'separator' },
        {
          label: 'Start Server',
          accelerator: 'CmdOrCtrl+R',
          click: handleStartServer,
          enabled: !serverRunning
        },
        {
          label: 'Stop Server',
          accelerator: 'CmdOrCtrl+S',
          click: handleStopServer,
          enabled: serverRunning
        },
        { type: 'separator' },
        process.platform === 'darwin' ? 
          { label: 'Close', accelerator: 'CmdOrCtrl+W', role: 'close' } :
          { label: 'Quit', accelerator: 'CmdOrCtrl+Q', role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', role: 'redo' },
        { type: 'separator' },
        { label: 'Cut', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: 'Copy', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: 'Paste', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: 'Select All', accelerator: 'CmdOrCtrl+A', role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', role: 'reload' },
        { label: 'Force Reload', accelerator: 'CmdOrCtrl+Shift+R', role: 'forceReload' },
        { label: 'Toggle Developer Tools', accelerator: 'F12', role: 'toggleDevTools' },
        { type: 'separator' },
        { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', role: 'zoomIn' },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { type: 'separator' },
        { label: 'Toggle Fullscreen', accelerator: 'F11', role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Hyperclay Local',
          click: () => {
            const iconPath = path.join(__dirname, 'assets', 'icon.png');
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About Hyperclay Local',
              message: 'Hyperclay Local Server v1.0.0',
              detail: 'A local server for running your Hyperclay HTML apps offline.\n\nMade with ❤️ for the Hyperclay platform.',
              buttons: ['OK'],
              icon: fs.existsSync(iconPath) ? iconPath : undefined
            });
          }
        },
        {
          label: 'Visit Hyperclay.com',
          click: () => {
            shell.openExternal('https://hyperclay.com');
          }
        }
      ]
    }
  ];

  // macOS specific menu adjustments
  if (process.platform === 'darwin') {
    template.unshift({
      label: app.getName(),
      submenu: [
        { label: 'About ' + app.getName(), role: 'about' },
        { type: 'separator' },
        { label: 'Services', role: 'services', submenu: [] },
        { type: 'separator' },
        { label: 'Hide ' + app.getName(), accelerator: 'Command+H', role: 'hide' },
        { label: 'Hide Others', accelerator: 'Command+Alt+H', role: 'hideothers' },
        { label: 'Show All', role: 'unhide' },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'Command+Q', role: 'quit' }
      ]
    });
  }

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

async function handleSelectFolder() {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select folder containing your HTML apps'
  });

  if (!result.canceled && result.filePaths.length > 0) {
    selectedFolder = result.filePaths[0];
    
    // Save to persistent storage
    settings.selectedFolder = selectedFolder;
    saveSettings(settings);
    
    updateUI();
  }
}

async function handleStartServer() {
  if (!selectedFolder) {
    await handleSelectFolder();
    if (!selectedFolder) return;
  }

  try {
    await startServer(selectedFolder);
    serverRunning = isServerRunning();
    updateUI();
    updateTrayMenu();
    
    // Auto-open browser
    shell.openExternal(`http://localhost:${getServerPort()}`);
    
  } catch (error) {
    dialog.showErrorBox('Server Error', `Failed to start server: ${error.message}`);
  }
}

async function handleStopServer() {
  try {
    await stopServer();
    serverRunning = isServerRunning();
    updateUI();
    updateTrayMenu();
  } catch (error) {
    console.error('Error stopping server:', error);
    serverRunning = isServerRunning(); // Ensure state is accurate
    updateUI();
    updateTrayMenu();
    dialog.showErrorBox('Server Error', `Failed to stop server: ${error.message}`);
  }
}

function updateUI() {
  if (mainWindow) {
    mainWindow.webContents.send('update-state', {
      selectedFolder,
      serverRunning,
      serverPort: getServerPort()
    });
  }
}

function updateTrayMenu() {
  if (tray) {
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Show App',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          } else {
            createWindow();
          }
        }
      },
      {
        label: serverRunning ? 'Stop Server' : 'Start Server',
        click: () => {
          if (serverRunning) {
            handleStopServer();
          } else {
            handleStartServer();
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          app.quit();
        }
      }
    ]);
    
    tray.setContextMenu(contextMenu);
  }
}

// App event handlers
app.whenReady().then(() => {
  // Ensure app name is set again after ready
  app.setName('Hyperclay Local');
  
  // Load settings on startup
  settings = loadSettings();
  selectedFolder = settings.selectedFolder || null;
  
  // Set app icon for dock/taskbar
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  if (fs.existsSync(iconPath)) {
    const icon = nativeImage.createFromPath(iconPath);
    app.dock?.setIcon(icon); // macOS dock
  }
  
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Keep app running in system tray on all platforms
  // Don't quit the app when all windows are closed
});

app.on('before-quit', async (event) => {
  if (isServerRunning()) {
    event.preventDefault(); // Prevent immediate quit
    try {
      await stopServer();
      serverRunning = isServerRunning();
      app.quit(); // Now quit after server is stopped
    } catch (error) {
      console.error('Error stopping server during quit:', error);
      app.quit(); // Quit anyway
    }
  }
});

// IPC handlers
const { ipcMain } = require('electron');

ipcMain.handle('select-folder', handleSelectFolder);
ipcMain.handle('start-server', handleStartServer);
ipcMain.handle('stop-server', handleStopServer);
ipcMain.handle('get-state', () => ({
  selectedFolder,
  serverRunning,
  serverPort: getServerPort()
}));
ipcMain.handle('open-folder', () => {
  if (selectedFolder) {
    shell.openPath(selectedFolder);
  }
});
ipcMain.handle('open-browser', (event, url) => {
  if (url) {
    shell.openExternal(url);
  } else if (serverRunning) {
    shell.openExternal(`http://localhost:${getServerPort()}`);
  }
});