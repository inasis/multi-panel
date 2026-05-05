/*
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

export class AppMenuMonitorModel {
    constructor(monitorIndex) {
        this.monitorIndex = monitorIndex;
        this._actionOnWorkspaceGroupNotifyId = 0;
        this._targetAppGroup = null;
        this._lastFocusedWindow = null;
    }

    destroy() {
        this._disconnectTargetAppGroup();
        this._lastFocusedWindow = null;
    }

    shouldSyncForWindow(monitorIndex, window) {
        return monitorIndex === this.monitorIndex &&
            this._isApplicationWindow(window);
    }

    findTargetApp({currentTargetApp, startingApps = [], onTargetGroupActionChanged = null} = {}) {
        this._disconnectTargetAppGroup();

        const workspace = global.workspace_manager.get_active_workspace();
        const tracker = Shell.WindowTracker.get_default();
        const focusedApp = tracker.focus_app;
        const focusedAppResult = this._findFocusedAppTarget(
            focusedApp,
            workspace,
            currentTargetApp,
            onTargetGroupActionChanged
        );
        if (focusedAppResult)
            return focusedAppResult;

        const startingApp = startingApps.find(app => app.is_on_workspace(workspace));
        if (startingApp)
            return startingApp;

        const lastFocusedApp = this._findLastFocusedApp(workspace, tracker);
        if (lastFocusedApp)
            return lastFocusedApp;

        return this._findAnyMonitorApp(workspace, tracker);
    }

    _disconnectTargetAppGroup() {
        if (!this._actionOnWorkspaceGroupNotifyId)
            return;

        this._targetAppGroup.disconnect(this._actionOnWorkspaceGroupNotifyId);
        this._actionOnWorkspaceGroupNotifyId = 0;
        this._targetAppGroup = null;
    }

    _isApplicationWindow(window) {
        if (!window)
            return false;

        switch (window.get_window_type()) {
        case Meta.WindowType.NORMAL:
        case Meta.WindowType.DIALOG:
        case Meta.WindowType.MODAL_DIALOG:
        case Meta.WindowType.SPLASHSCREEN:
            return true;
        default:
            return false;
        }
    }

    _findFocusedAppTarget(focusedApp, workspace, currentTargetApp, onTargetGroupActionChanged) {
        if (!focusedApp || !focusedApp.is_on_workspace(workspace))
            return null;

        let hasWindowOnMonitor = false;
        let hasFocusedWindowElsewhere = false;

        for (const window of focusedApp.get_windows()) {
            if (!window.located_on_workspace(workspace))
                continue;

            if (window.get_monitor() === this.monitorIndex) {
                if (window.has_focus()) {
                    this._lastFocusedWindow = window;
                    return focusedApp;
                }

                hasWindowOnMonitor = true;
            } else if (window.has_focus()) {
                hasFocusedWindowElsewhere = true;
            }

            if (hasFocusedWindowElsewhere && hasWindowOnMonitor) {
                this._trackGroupedFocusedApp(
                    focusedApp,
                    currentTargetApp,
                    onTargetGroupActionChanged
                );
                break;
            }
        }

        return null;
    }

    _trackGroupedFocusedApp(focusedApp, currentTargetApp, onTargetGroupActionChanged) {
        if (focusedApp === currentTargetApp || !onTargetGroupActionChanged)
            return;

        this._targetAppGroup = focusedApp;
        this._actionOnWorkspaceGroupNotifyId = this._targetAppGroup.connect(
            'notify::action-group',
            onTargetGroupActionChanged
        );
    }

    _findLastFocusedApp(workspace, tracker) {
        if (!this._lastFocusedWindow ||
            !this._lastFocusedWindow.located_on_workspace(workspace) ||
            this._lastFocusedWindow.get_monitor() !== this.monitorIndex)
            return null;

        return tracker.get_window_app(this._lastFocusedWindow);
    }

    _findAnyMonitorApp(workspace, tracker) {
        const window = global.display.get_tab_list(Meta.TabList.NORMAL_ALL, workspace)
            .find(candidate => candidate.get_monitor() === this.monitorIndex);
        if (!window)
            return null;

        this._lastFocusedWindow = window;
        return tracker.get_window_app(window);
    }
}
