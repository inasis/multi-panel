/*
Copyright (C) 2014  spin83
Copyright (C) 2026  inasis

This program is free software; you can redistribute it and/or
modify it under the terms of the GNU General Public License
as published by the Free Software Foundation; either version 2
of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program; if not, visit https://www.gnu.org/licenses/.
*/

import Shell from 'gi://Shell';
import Meta from 'gi://Meta';
import GObject from 'gi://GObject';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as Panel from 'resource:///org/gnome/shell/ui/panel.js';

export const MultiMonitorsAppMenuButton = GObject.registerClass(
    class MultiMonitorsAppMenuButton extends PanelMenu.Button {
        _init(panel) {
            if (panel.monitorIndex == undefined)
                this._monitorIndex = Main.layoutManager.primaryIndex;
            else
                this._monitorIndex = panel.monitorIndex;
            this._actionOnWorkspaceGroupNotifyId = 0;
            this._targetAppGroup = null;
            this._lastFocusedWindow = null;

            if (typeof Panel !== 'undefined' && Panel.AppMenuButton && Panel.AppMenuButton.prototype._init) {
                Panel.AppMenuButton.prototype._init.call(this, panel);
            } else {
                super._init(0.0, null, false);
                this._startingApps = [];
                this._targetApp = null;
                this._busyNotifyId = 0;
                this._actionGroupNotifyId = 0;
            }

            this._windowEnteredMonitorId = global.display.connect('window-entered-monitor',
                this._windowEnteredMonitor.bind(this));
            this._windowLeftMonitorId = global.display.connect('window-left-monitor',
                this._windowLeftMonitor.bind(this));
        }

        _windowEnteredMonitor(_metaScreen, monitorIndex, metaWin) {
            if (monitorIndex == this._monitorIndex) {
                switch (metaWin.get_window_type()) {
                case Meta.WindowType.NORMAL:
                case Meta.WindowType.DIALOG:
                case Meta.WindowType.MODAL_DIALOG:
                case Meta.WindowType.SPLASHSCREEN:
                    this._sync();
                    break;
                }
            }
        }

        _windowLeftMonitor(_metaScreen, monitorIndex, metaWin) {
            if (monitorIndex == this._monitorIndex) {
                switch (metaWin.get_window_type()) {
                case Meta.WindowType.NORMAL:
                case Meta.WindowType.DIALOG:
                case Meta.WindowType.MODAL_DIALOG:
                case Meta.WindowType.SPLASHSCREEN:
                    this._sync();
                    break;
                }
            }
        }

        _findTargetApp() {
            if (this._actionOnWorkspaceGroupNotifyId) {
                this._targetAppGroup.disconnect(this._actionOnWorkspaceGroupNotifyId);
                this._actionOnWorkspaceGroupNotifyId = 0;
                this._targetAppGroup = null;
            }
            let groupWindow = false;
            let groupFocus = false;

            const workspaceManager = global.workspace_manager;
            const workspace = workspaceManager.get_active_workspace();
            const tracker = Shell.WindowTracker.get_default();
            const focusedApp = tracker.focus_app;
            if (focusedApp && focusedApp.is_on_workspace(workspace)) {
                for (const win of focusedApp.get_windows()) {
                    if (win.located_on_workspace(workspace)) {
                        if (win.get_monitor() == this._monitorIndex) {
                            if (win.has_focus()) {
                                this._lastFocusedWindow = win;
                                return focusedApp;
                            } else {
                                groupWindow = true;
                            }
                        } else if (win.has_focus()) {
                            groupFocus = true;
                        }

                        if (groupFocus && groupWindow) {
                            if (focusedApp != this._targetApp) {
                                this._targetAppGroup = focusedApp;
                                this._actionOnWorkspaceGroupNotifyId = this._targetAppGroup.connect(
                                    'notify::action-group',
                                    this._sync.bind(this)
                                );
                            }
                            break;
                        }
                    }
                }
            }

            const startingApp = this._startingApps.find(app => app.is_on_workspace(workspace));
            if (startingApp)
                return startingApp;

            if (this._lastFocusedWindow &&
                this._lastFocusedWindow.located_on_workspace(workspace) &&
                this._lastFocusedWindow.get_monitor() == this._monitorIndex) {
                return tracker.get_window_app(this._lastFocusedWindow);
            }

            const windowOnMonitor = global.display.get_tab_list(Meta.TabList.NORMAL_ALL, workspace)
                .find(window => window.get_monitor() == this._monitorIndex);
            if (windowOnMonitor) {
                this._lastFocusedWindow = windowOnMonitor;
                return tracker.get_window_app(windowOnMonitor);
            }

            return null;
        }

        _sync() {
            if (!this._switchWorkspaceNotifyId)
                return;

            if (typeof Panel !== 'undefined' && Panel.AppMenuButton && Panel.AppMenuButton.prototype._sync)
                Panel.AppMenuButton.prototype._sync.call(this);
        }

        destroy() {
            if (this._actionGroupNotifyId) {
                this._targetApp.disconnect(this._actionGroupNotifyId);
                this._actionGroupNotifyId = 0;
            }

            global.display.disconnect(this._windowEnteredMonitorId);
            global.display.disconnect(this._windowLeftMonitorId);

            if (this._busyNotifyId) {
                this._targetApp.disconnect(this._busyNotifyId);
                this._busyNotifyId = 0;
            }

            if (this.menu._windowsChangedId) {
                this.menu._app.disconnect(this.menu._windowsChangedId);
                this.menu._windowsChangedId = 0;
            }
            super.destroy();
        }
    });
