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

import Clutter from 'gi://Clutter';
import St from 'gi://St';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Layout from 'resource:///org/gnome/shell/ui/layout.js';

import * as AuxiliaryPanel from './auxiliaryPanel.js';
import * as PanelSettings from './panelSettings.js';

export const SHOW_PANEL_ID = 'show-panel';
export const ENABLE_HOT_CORNERS = 'enable-hot-corners';

// Store reference to mmPanel array set by extension.js
let _mmPanelArrayRef = null;

// Helper function to set the mmPanel reference
export function setMMPanelArrayRef(mmPanelArray) {
	_mmPanelArrayRef = mmPanelArray;
}

// Helper function to safely access mmPanel array
function getMMPanelArray() {
	// First try Main.mmPanel if it exists
	if ('mmPanel' in Main && Main.mmPanel) {
		return Main.mmPanel;
	}
	// Fall back to stored reference
	return _mmPanelArrayRef;
}

function isDisposedActor(actor) {
	if (!actor)
		return true;

	if (actor._mmDisposed === true)
		return true;

	try {
		void actor.visible;
		return false;
	} catch (_e) {
		return true;
	}
}

function trackActorDispose(actor) {
	if (!actor?.connect)
		return;

	actor._mmDisposed = false;
	actor.connect('destroy', () => {
		actor._mmDisposed = true;
	});
}

function disconnectSignal(source, signalId) {
	if (!source || !signalId)
		return;

	try {
		source.disconnect(signalId);
	} catch (_e) {
	}
}

function removeActorFromParent(actor) {
	try {
		if (actor?.get_parent())
			actor.get_parent().remove_child(actor);
	} catch (_e) {
	}
}

function getMonitorId(index, monitor) {
	return `i${index}x${monitor.x}y${monitor.y}w${monitor.width}h${monitor.height}`;
}

export class MultiMonitorsPanelBox {
	constructor(monitor, settings) {
		this._backgroundClones = [];
		this._settings = settings;

		this.panelBox = new St.Widget({
			name: 'panelBox',
			layout_manager: new Clutter.BinLayout(),
			clip_to_allocation: true,
			visible: true
		});
		trackActorDispose(this.panelBox);
		Main.layoutManager.addChrome(this.panelBox, { affectsStruts: true, trackFullscreen: true });
		this.panelBox.set_position(monitor.x, monitor.y);

		this._setPanelBoxSize(monitor);

		Main.uiGroup.set_child_below_sibling(this.panelBox, Main.layoutManager.panelBox);
	}

	destroy() {
		this._clearBackgroundClones();
		if (!isDisposedActor(this.panelBox)) {
			this.panelBox._mmDisposed = true;
			this.panelBox.destroy();
		}
		this.panelBox = null;
	}

	updatePanel(monitor) {
		if (isDisposedActor(this.panelBox))
			return;

		this.panelBox.set_position(monitor.x, monitor.y);
		this._setPanelBoxSize(monitor);
	}

	_setPanelBoxSize(monitor) {
		const mainPanelHeight = Main.layoutManager.panelBox.height;
	const configuredHeight = PanelSettings.getPanelHeight(this._settings);
		const height = configuredHeight > 0 ? configuredHeight : (mainPanelHeight > 0 ? mainPanelHeight : 30);
		this.panelBox.set_size(monitor.width, height);
	}

	_syncPanelBoxAppearance(mainPanelBox) {
		try {
			this.panelBox.visible = mainPanelBox.visible;
			this.panelBox.opacity = mainPanelBox.opacity;
			this.panelBox.reactive = mainPanelBox.reactive;

			const styleClass = mainPanelBox.get_style_class_name?.() ?? '';
			if (this.panelBox.get_style_class_name?.() !== styleClass)
				this.panelBox.set_style_class_name(styleClass);

			const style = PanelSettings.sanitizeInlineStyle(mainPanelBox.get_style?.() ?? null);
			if (this.panelBox.get_style?.() !== style)
				this.panelBox.set_style(style);
		} catch (_e) {
			return false;
		}

		return true;
	}

	syncFromMainPanel() {
		const mainPanelBox = Main.layoutManager.panelBox;
		if (!mainPanelBox || isDisposedActor(mainPanelBox) || isDisposedActor(this.panelBox))
			return;

		if (!this._syncPanelBoxAppearance(mainPanelBox))
			return;

		const blurMyShellActors = global.blur_my_shell?._panel_blur?.actors_list ?? [];
		const hasDirectBlur = blurMyShellActors.some(actors => actors?.widgets?.panel_box === this.panelBox);
		if (hasDirectBlur) {
			this._clearBackgroundClones();
			return;
		}

		this._syncBackgroundClones(mainPanelBox);
	}

	_syncBackgroundCloneVisibility(entry) {
		const {source, clone} = entry;
		if (isDisposedActor(clone) || isDisposedActor(source))
			return;

		try {
			const alloc = source.get_allocation_box();
			const width = alloc.get_width();
			const height = alloc.get_height();
			clone.visible = width > 0 && height > 0;
		} catch (_e) {
			clone.visible = false;
		}
	}

	_createBackgroundCloneEntry(source, index) {
		const clone = new Clutter.Clone({
			source,
			reactive: false,
			x_expand: true,
			y_expand: true,
			x_align: Clutter.ActorAlign.FILL,
			y_align: Clutter.ActorAlign.FILL,
		});
		clone.visible = false;
		trackActorDispose(clone);

		const entry = {
			source,
			clone,
			allocationSignalId: 0,
		};

		entry.allocationSignalId = source.connect
			? source.connect('notify::allocation', () => this._syncBackgroundCloneVisibility(entry))
			: 0;

		this.panelBox.insert_child_at_index(clone, index);
		this._backgroundClones.push(entry);
		this._syncBackgroundCloneVisibility(entry);
	}

	_destroyBackgroundCloneEntry(entry) {
		if (!entry)
			return;

		disconnectSignal(entry.source, entry.allocationSignalId);
		removeActorFromParent(entry.clone);
		entry.clone?.destroy?.();
	}

	_createBackgroundClone(child, index) {
		this._createBackgroundCloneEntry(child, index);
	}

	_syncBackgroundClones(mainPanelBox) {
		const sourceChildren = mainPanelBox.get_children()
			.filter(child => child && child !== Main.panel);

		const currentSources = this._backgroundClones.map(entry => entry.source);
		const unchanged = sourceChildren.length === currentSources.length &&
			sourceChildren.every((child, index) => child === currentSources[index]);

		if (unchanged)
			return;

		this._clearBackgroundClones();

		sourceChildren.forEach((child, index) => this._createBackgroundClone(child, index));
	}

	_clearBackgroundClones() {
		this._backgroundClones.forEach(entry => this._destroyBackgroundCloneEntry(entry));
		this._backgroundClones = [];
	}
}

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
				this._showAppMenuId = this._settings.connect('changed::' + AuxiliaryPanel.SHOW_APP_MENU_ID, this._showAppMenu.bind(this));
			}
			if (!this._panelHeightChangedId) {
				this._panelHeightChangedId = this._settings.connect(
					`changed::${PanelSettings.PANEL_HEIGHT_ID}`,
					this._syncExternalPanelHeights.bind(this)
				);
			}

			if (!this.statusIndicatorsController) {
				this.statusIndicatorsController = new AuxiliaryPanel.StatusIndicatorsController(this._settings);
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
		let panel = new AuxiliaryPanel.MultiMonitorsPanel(i, mmPanelBox, this._settings);

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
