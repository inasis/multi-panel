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

import GObject from 'gi://GObject';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as Panel from 'resource:///org/gnome/shell/ui/panel.js';

import { AppMenuMonitorModel } from '../../services/appMenuMonitor.js';

export function hasNativeAppMenuButton() {
    return !!Panel.AppMenuButton?.prototype?._init;
}

export const MultiPanelAppMenuButton = GObject.registerClass(
    class MultiPanelAppMenuButton extends PanelMenu.Button {
        _init(panel) {
            if (panel.monitorIndex == undefined)
                this._monitorIndex = Main.layoutManager.primaryIndex;
            else
                this._monitorIndex = panel.monitorIndex;
            this._monitorModel = new AppMenuMonitorModel(this._monitorIndex);

            if (hasNativeAppMenuButton()) {
                Panel.AppMenuButton.prototype._init.call(this, panel);
            } else {
                super._init(0.0, null, false);
                this.visible = false;
                this.reactive = false;
                this.can_focus = false;
                return;
            }

            this._windowEnteredMonitorId = global.display.connect('window-entered-monitor',
                this._windowEnteredMonitor.bind(this));
            this._windowLeftMonitorId = global.display.connect('window-left-monitor',
                this._windowLeftMonitor.bind(this));
        }

        _windowEnteredMonitor(_metaScreen, monitorIndex, metaWin) {
            if (this._monitorModel.shouldSyncForWindow(monitorIndex, metaWin))
                this._sync();
        }

        _windowLeftMonitor(_metaScreen, monitorIndex, metaWin) {
            if (this._monitorModel.shouldSyncForWindow(monitorIndex, metaWin))
                this._sync();
        }

        _findTargetApp() {
            return this._monitorModel.findTargetApp({
                currentTargetApp: this._targetApp,
                startingApps: this._startingApps,
                onTargetGroupActionChanged: this._sync.bind(this),
            });
        }

        _sync() {
            if (!this._switchWorkspaceNotifyId)
                return;

            if (Panel.AppMenuButton?.prototype?._sync)
                Panel.AppMenuButton.prototype._sync.call(this);
        }

        destroy() {
            if (this._actionGroupNotifyId) {
                this._targetApp.disconnect(this._actionGroupNotifyId);
                this._actionGroupNotifyId = 0;
            }

            this._monitorModel?.destroy();
            this._monitorModel = null;

            if (this._windowEnteredMonitorId)
                global.display.disconnect(this._windowEnteredMonitorId);
            if (this._windowLeftMonitorId)
                global.display.disconnect(this._windowLeftMonitorId);

            if (this._busyNotifyId) {
                this._targetApp.disconnect(this._busyNotifyId);
                this._busyNotifyId = 0;
            }

            if (this.menu?._windowsChangedId) {
                this.menu._app.disconnect(this.menu._windowsChangedId);
                this.menu._windowsChangedId = 0;
            }
            super.destroy();
        }
    });
