/*
Copyright (C) 2014  spin83
Copyright (C) 2026  inasis

This program is free software; you can redistribute it and/or
modify it under the terms of the GNU General Public License
as published by the Free Software Foundation; either version 2
of the License, or (at your option) any later version.
*/

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import * as Settings from './settings.js';
import {
    disconnectSignal,
    isDisposedActor,
    removeActorFromParent,
    trackActorDispose,
} from './panelRuntime.js';

export class MultiMonitorsPanelBox {
    constructor(monitor, settings) {
        this._backgroundClones = [];
        this._settings = settings;

        this.panelBox = new St.Widget({
            name: 'panelBox',
            layout_manager: new Clutter.BinLayout(),
            clip_to_allocation: true,
            visible: true,
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
        const configuredHeight = Settings.getPanelHeight(this._settings);
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

            const style = Settings.sanitizeInlineStyle(mainPanelBox.get_style?.() ?? null);
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
