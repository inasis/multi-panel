/*
Copyright (C) 2014  spin83

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

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelModule from 'resource:///org/gnome/shell/ui/panel.js';

// Shell version for feature detection - centralized here and exported for other modules

import * as Common from './shared/common.js';
import * as AuxiliaryPanelManager from './services/auxiliaryPanelManager.js';
import * as AuxiliaryPanel from './ui/auxiliaryPanel.js';
import * as ScreenshotHandler from './services/screenshotHandler.js';

export const shellVersion = Common.shellVersion;
export const patchAddActorMethod = Common.patchAddActorMethod;
export const copyClass = Common.copyClass;

export let mmPanel = [];
export let mmLayoutManager = null;

function patchMainPanelEnsureIndicator() {
	Main.panel._ensureIndicator = function (role) {
		const existingIndicator = this.statusArea[role];
		if (existingIndicator) {
			existingIndicator.container.show();
			return null;
		}

		const constructor = PanelModule.PANEL_ITEM_IMPLEMENTATIONS[role];
		if (!constructor)
			return null;

		const indicator = new constructor(this);
		this.statusArea[role] = indicator;
		return indicator;
	};
}

export default class MultiMonitorsExtension extends Extension {
	constructor(metadata) {
		super(metadata);
		this._settings = null;
		this._showPanelId = null;
	}

	enable() {
        this._settings = this.getSettings();

        mmLayoutManager = new AuxiliaryPanelManager.MultiMonitorsLayoutManager(this._settings);

        this._showPanelId = this._settings.connect('changed::' + AuxiliaryPanelManager.SHOW_PANEL_ID, mmLayoutManager.showPanel.bind(mmLayoutManager));
        mmLayoutManager.showPanel();

        mmPanel.length = 0;
        AuxiliaryPanelManager.setMMPanelArrayRef(mmPanel);
        AuxiliaryPanel.setMMPanelArrayRef(mmPanel);

		patchMainPanelEnsureIndicator();

		// Patch screenshot UI to open on cursor's monitor (or all monitors based on setting)
        ScreenshotHandler.patchScreenshotUI(this._settings);
	}

	disable() {
        ScreenshotHandler.unpatchScreenshotUI();

		// Unpatch screenshot UI
		if (this._showPanelId) {
			this._settings.disconnect(this._showPanelId);
			this._showPanelId = null;
		}

		if (mmLayoutManager) {
			mmLayoutManager.hidePanel();
			mmLayoutManager = null;
		}

		mmPanel.length = 0;

		this._settings = null;
	}
}
