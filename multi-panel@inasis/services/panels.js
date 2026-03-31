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

import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Layout from 'resource:///org/gnome/shell/ui/layout.js';

import * as PanelSettings from './settings.js';
import { MultiMonitorsPanelBox } from './panelBox.js';
import {
	getMMPanelArray,
	getMonitorId,
	setMMPanelArrayRef,
} from './panelRuntime.js';
import { MultiMonitorsPanel } from '../ui/panel.js';
import { StatusIndicatorsController } from '../ui/indicators.js';

export const SHOW_PANEL_ID = 'show-panel';
export const ENABLE_HOT_CORNERS = 'enable-hot-corners';
export { setMMPanelArrayRef };

export class MultiMonitorsLayoutManager {
	constructor(settings) {
		this._settings = settings;
		this._desktopSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });

		this._monitorIds = [];
		this.mmPanelBox = [];
		this.mmappMenu = false;

		this._showAppMenuId = null;
		this._monitorsChangedId = null;
		this._panelHeightChangedId = null;

		this.statusIndicatorsController = null;
		this._layoutManager_updateHotCorners = null;
		this._changedEnableHotCornersId = null;
	}

	_forEachExternalMonitor(callback) {
		Main.layoutManager.monitors.forEach((monitor, index) => {
			if (index !== Main.layoutManager.primaryIndex)
				callback(monitor, index);
		});
	}

	_patchHotCorners() {
		this._layoutManager_updateHotCorners = Main.layoutManager._updateHotCorners;

		Main.layoutManager._updateHotCorners = () => {
			Main.layoutManager.hotCorners.forEach(corner => corner?.destroy());
			Main.layoutManager.hotCorners = [];

			if (!this._desktopSettings.get_boolean(ENABLE_HOT_CORNERS)) {
				Main.layoutManager.emit('hot-corners-changed');
				return;
			}

			const size = Main.layoutManager.panelBox.height;
			this._forEachHotCornerMonitor((monitor, cornerX, cornerY) => {
				const corner = new Layout.HotCorner(Main.layoutManager, monitor, cornerX, cornerY);
				corner.setBarrierSize(size);
				Main.layoutManager.hotCorners.push(corner);
			});

			Main.layoutManager.emit('hot-corners-changed');
		};
	}

	_forEachHotCornerMonitor(callback) {
		Main.layoutManager.monitors.forEach(monitor => {
			const cornerX = Main.layoutManager._rtl ? monitor.x + monitor.width : monitor.x;
			const cornerY = monitor.y;
			callback(monitor, cornerX, cornerY);
		});
	}

	_ensureHotCornerSettingSync() {
		if (this._changedEnableHotCornersId)
			return;

		this._changedEnableHotCornersId = this._desktopSettings.connect(
			`changed::${ENABLE_HOT_CORNERS}`,
			Main.layoutManager._updateHotCorners.bind(Main.layoutManager)
		);
	}

	_clearPanels(count = this._monitorIds.length) {
		Array.from({length: count}).forEach(() => {
			this._monitorIds.pop();
			this._popPanel();
		});
	}

	showPanel() {
		if (this._settings.get_boolean(SHOW_PANEL_ID)) {
			if (!this._monitorsChangedId) {
				this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', this._monitorsChanged.bind(this));
				this._monitorsChanged();
			}
			if (!this._showAppMenuId) {
				this._showAppMenuId = this._settings.connect(`changed::${PanelSettings.SHOW_APP_MENU_ID}`, this._showAppMenu.bind(this));
			}
			if (!this._panelHeightChangedId) {
				this._panelHeightChangedId = this._settings.connect(
					`changed::${PanelSettings.PANEL_HEIGHT_ID}`,
					this._syncExternalPanelHeights.bind(this)
				);
			}

			if (!this.statusIndicatorsController) {
				this.statusIndicatorsController = new StatusIndicatorsController(this._settings);
			}

			if (!this._layoutManager_updateHotCorners) {
				this._patchHotCorners();
				this._ensureHotCornerSettingSync();
				Main.layoutManager._updateHotCorners();
			}
		}
		else {
			this.hidePanel();
		}
	}

	hidePanel() {
		if (this._changedEnableHotCornersId) {
			this._desktopSettings.disconnect(this._changedEnableHotCornersId);
			this._changedEnableHotCornersId = null;
		}

		if (this._layoutManager_updateHotCorners) {
			Main.layoutManager['_updateHotCorners'] = this._layoutManager_updateHotCorners;
			this._layoutManager_updateHotCorners = null;
			Main.layoutManager._updateHotCorners();
		}

		if (this.statusIndicatorsController) {
			this.statusIndicatorsController.destroy();
			this.statusIndicatorsController = null;
		}

		if (this._showAppMenuId) {
			this._settings.disconnect(this._showAppMenuId);
			this._showAppMenuId = null;
		}
		if (this._panelHeightChangedId) {
			this._settings.disconnect(this._panelHeightChangedId);
			this._panelHeightChangedId = null;
		}
		this._hideAppMenu();

		if (this._monitorsChangedId) {
			Main.layoutManager.disconnect(this._monitorsChangedId);
			this._monitorsChangedId = null;
		}

		this._clearPanels();
	}

	_monitorsChanged() {
		const monitorChange = Main.layoutManager.monitors.length - this._monitorIds.length - 1;
		if (monitorChange < 0) {
			this._clearPanels(-monitorChange);
		}

		let transferIndicators = false;
		let panelIndex = 0;
		this._forEachExternalMonitor((monitor, index) => {
			const monitorId = getMonitorId(index, monitor);
			if (monitorChange > 0 && panelIndex === this._monitorIds.length) {
				this._monitorIds.push(monitorId);
				this._pushPanel(index, monitor);
				transferIndicators = true;
			} else if (this._monitorIds[panelIndex] !== monitorId) {
				this._monitorIds[panelIndex] = monitorId;
				this.mmPanelBox[panelIndex].updatePanel(monitor);
			}

			panelIndex++;
		});

		this._showAppMenu();
		if (transferIndicators && this.statusIndicatorsController) {
			this.statusIndicatorsController.transferIndicators();
		}
	}

	_pushPanel(i, monitor) {
		if (i === Main.layoutManager.primaryIndex) {
			return;
		}

		let mmPanelBox = new MultiMonitorsPanelBox(monitor, this._settings);
		let panel = new MultiMonitorsPanel(i, mmPanelBox, this._settings);

		const mmPanelRef = getMMPanelArray();
		if (mmPanelRef) {
			mmPanelRef.push(panel);
		}
		this.mmPanelBox.push(mmPanelBox);
	}

	_popPanel() {
		const mmPanelRef = getMMPanelArray();
		let panel = mmPanelRef ? mmPanelRef.pop() : null;
		if (panel && this.statusIndicatorsController) {
			this.statusIndicatorsController.transferBack(panel);
		}
		let mmPanelBox = this.mmPanelBox.pop();
		if (mmPanelBox) {
			mmPanelBox.destroy();
		}
	}

	_showAppMenu() {
		// No-op for GNOME 45+
	}

	_hideAppMenu() {
		// No-op for GNOME 45+
	}

	_syncExternalPanelHeights() {
		this._forEachExternalMonitor((monitor, index) => {
			const panelIndex = index > Main.layoutManager.primaryIndex ? index - 1 : index;
			this.mmPanelBox[panelIndex]?.updatePanel?.(monitor);
			const panel = getMMPanelArray()?.find(candidate => candidate.monitorIndex === index);
			panel?._syncPanelAppearance?.();
			panel?.queue_relayout?.();
		});
	}
}
