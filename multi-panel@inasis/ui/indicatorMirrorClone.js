/*
Copyright (C) 2025-2026  Frederyk Abryan Palinoan
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

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const cloneSupportMethods = {
    _createClockDisplay(container) {
        const clockDisplay = new St.Label({
            style_class: 'clock',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._applyZeroSpacingStyle(clockDisplay);

        const updateClock = () => {
            if (this._sourceIndicator._clockDisplay)
                clockDisplay.text = this._sourceIndicator._clockDisplay.text;
        };

        updateClock();

        if (this._clockUpdateId) {
            GLib.source_remove(this._clockUpdateId);
            this._clockUpdateId = null;
        }

        this._clockUpdateId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            try {
                updateClock();
                return GLib.SOURCE_CONTINUE;
            } catch (_e) {
                this._clockUpdateId = null;
                return GLib.SOURCE_REMOVE;
            }
        });

        container.add_child(clockDisplay);
        this._clockDisplay = clockDisplay;
    },

    _createSimpleClone(parent, source) {
        const problematicExtensions = [
            'tiling', 'tilingshell', 'forge', 'pop-shell',
            'system-monitor', 'system_monitor', 'vitals', 'tophat', 'astra-monitor',
            'appindicator', 'ubuntu-appindicator', 'kstatusnotifier', 'tray',
            'arcmenu', 'arc-menu', 'arc',
        ];
        const isProblematic = problematicExtensions.some(name =>
            this._role && this._role.toLowerCase().includes(name)
        );

        if (isProblematic) {
            this._createStaticIconCopy(parent, source);
            return;
        }

        this._createAllocationSyncedClone(parent, source, `simple:${this._role ?? 'generic'}`);
    },

    _createQuickSettingsClone(parent, source) {
        const clone = new Clutter.Clone({ source });

        parent.add_child(clone);

        this._quickSettingsClone = clone;
        this._quickSettingsSource = source;
        this._quickSettingsContainer = parent;
        this._lastSourceW = 0;
        this._lastSourceH = 0;

        const syncSize = () => {
            if (!this._quickSettingsSource || !this._quickSettingsClone)
                return;
            try {
                const alloc = this._quickSettingsSource.get_allocation_box();
                const w = alloc.get_width();
                const h = alloc.get_height();

                if (w > 0 && h > 0 &&
                    (Math.abs(w - this._lastSourceW) > 0.5 ||
                        Math.abs(h - this._lastSourceH) > 0.5)) {
                    this._lastSourceW = w;
                    this._lastSourceH = h;
                    this._quickSettingsClone.set_size(w, h);
                }
            } catch (_e) {
            }
        };

        if (this._sourceSizeChangedId && this._quickSettingsSource) {
            this._quickSettingsSource.disconnect(this._sourceSizeChangedId);
            this._sourceSizeChangedId = null;
        }

        this._sourceSizeChangedId = source.connect('notify::allocation', syncSize);

        this._qsInitialSyncId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            try {
                syncSize();
            } catch (_e) {
            }
            this._qsInitialSyncId = null;
            return GLib.SOURCE_REMOVE;
        });

        this._fullscreenChangedId = global.display.connect(
            'in-fullscreen-changed',
            this._onQuickSettingsFullscreenChanged.bind(this)
        );
    },

    _createAllocationSyncedClone(parent, source, kind = 'generic') {
        const clone = new Clutter.Clone({
            source,
            y_align: Clutter.ActorAlign.CENTER,
        });
        clone.visible = false;

        parent.add_child(clone);

        if (!this._allocationSyncedClones)
            this._allocationSyncedClones = new Map();

        const syncKey = kind || 'generic';
        const previous = this._allocationSyncedClones.get(syncKey);
        if (previous?.signalId && previous?.source) {
            try {
                previous.source.disconnect(previous.signalId);
            } catch (_e) {
            }
        }
        if (previous?.timeoutId)
            GLib.source_remove(previous.timeoutId);

        const syncSize = () => {
            if (this._isDestroying || !source || !clone)
                return;

            try {
                const alloc = source.get_allocation_box();
                const width = alloc.get_width();
                const height = alloc.get_height();

                if (width > 0 && height > 0) {
                    clone.set_size(width, height);
                    clone.visible = true;
                } else {
                    clone.visible = false;
                }
            } catch (_e) {
                clone.visible = false;
            }
        };

        const signalId = source.connect('notify::allocation', syncSize);
        const timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            syncSize();
            const entry = this._allocationSyncedClones?.get(syncKey);
            if (entry)
                entry.timeoutId = null;
            return GLib.SOURCE_REMOVE;
        });

        this._allocationSyncedClones.set(syncKey, {
            clone,
            source,
            signalId,
            timeoutId,
        });
    },

    _onQuickSettingsFullscreenChanged() {
        if (!this._quickSettingsClone)
            return;
        this._quickSettingsClone.queue_relayout();
    },

    _applyNormalMode() {
    },

    _applyOverviewMode() {
    },

    _monitorSize(duration) {
        if (this._monitorTimeoutId) {
            GLib.source_remove(this._monitorTimeoutId);
            this._monitorTimeoutId = null;
        }

        const startTime = GLib.get_monotonic_time();
        const endTime = startTime + duration * 1000;

        const checkSize = () => {
            try {
                if (!this._quickSettingsSource)
                    return GLib.SOURCE_REMOVE;

                const [minW, natW] = this._quickSettingsSource.get_preferred_width(-1);
                const [actW] = this._quickSettingsSource.get_size();
                const sourceWidth = Math.max(natW, minW, actW);

                if (sourceWidth > (this._cachedWidth || 0))
                    this._cachedWidth = sourceWidth;

                if (GLib.get_monotonic_time() > endTime) {
                    this._monitorTimeoutId = null;
                    return GLib.SOURCE_REMOVE;
                }

                return GLib.SOURCE_CONTINUE;
            } catch (_e) {
                this._monitorTimeoutId = null;
                return GLib.SOURCE_REMOVE;
            }
        };

        this._monitorTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, checkSize);
    },

    _onSourceWidthChanged() {
        if (this._widthLocked)
            return;

        if (!this._monitorTimeoutId)
            this._monitorSize(500);
    },

    _detectAndLockWidth() {
    },

    _isPrimaryMonitorFullscreen() {
        const primaryIndex = Main.layoutManager.primaryIndex;
        const windows = global.get_window_actors();

        for (const actor of windows) {
            const metaWindow = actor.get_meta_window();
            if (metaWindow &&
                metaWindow.is_fullscreen() &&
                metaWindow.get_monitor() === primaryIndex)
                return true;
        }
        return false;
    },

    _createStaticIconCopy(parent, source) {
        const container = this._isQuickSettingsRole()
            ? parent
            : new St.BoxLayout({
                style_class: 'panel-status-menu-box',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                y_expand: false,
                reactive: false,
            });

        if (this._isQuickSettingsRole()) {
            this._applyContainerSpacing(container, this._getQuickSettingsGap());
            this._applyZeroSpacingStyle(container, this._getQuickSettingsGapStyle());
        } else {
            this._applyZeroSpacingStyle(container);
        }

        this._copyIconsFromSource(container, source);
        if (this._shouldSyncRoleContainerAppearance())
            this._syncMirroredContainerAppearance(container, source);
        if (!this._isQuickSettingsRole())
            parent.add_child(container);
        this._iconContainer = container;
        this._iconSource = source;
        if (this._isQuickSettingsRole())
            this._quickSettingsContainer = container;

        this._startIconSync();
    },

    _usesDirectLabelSync() {
        return this._isDirectSyncRole();
    },

    _getMirroredSourceInlineStyle(widget) {
        if (!widget?.get_style)
            return null;

        if (this._role === 'keyboard')
            return null;

        return widget.get_style?.() ?? null;
    },

    _shouldSyncRoleContainerAppearance() {
        return this._role === 'screenRecording' ||
            this._role === 'screencast' ||
            this._role === 'screenSharing';
    },

    _getActorDepth(actor) {
        let depth = 0;
        let current = actor;

        while (current) {
            depth++;
            current = current.get_parent?.() ?? null;
        }

        return depth;
    },

    _isPreferredRoleActionActor(actor) {
        if (!actor)
            return false;

        return actor.reactive === true ||
            actor.can_focus === true ||
            actor.track_hover === true ||
            actor instanceof St.Button ||
            typeof actor.clicked === 'function' ||
            typeof actor.toggle === 'function' ||
            typeof actor.stop === 'function' ||
            typeof actor.stopRecording === 'function' ||
            typeof actor.stopScreencast === 'function' ||
            typeof actor.stopSharing === 'function';
    },

    _findPreferredRoleActor(root, predicate) {
        if (!root)
            return null;

        const queue = [root];
        const visited = new Set();
        let bestMatch = null;
        let bestDepth = -1;

        while (queue.length > 0) {
            const actor = queue.shift();
            if (!actor || visited.has(actor))
                continue;

            visited.add(actor);

            if (predicate(actor)) {
                const depth = this._getActorDepth(actor);
                if (depth > bestDepth) {
                    bestMatch = actor;
                    bestDepth = depth;
                }
            }

            const children = actor.get_children?.() ?? [];
            for (const child of children)
                queue.push(child);
        }

        return bestMatch;
    },

    _getRoleAppearanceSource(root) {
        if (!this._shouldSyncRoleContainerAppearance())
            return root;

        return this._findPreferredRoleActor(root, actor =>
            this._isPreferredRoleActionActor(actor) ||
            actor.has_style_pseudo_class?.('active') ||
            actor.has_style_pseudo_class?.('checked') ||
            Boolean(actor.get_style_class_name?.()) ||
            Boolean(actor.get_style?.())) ?? root;
    },

    _syncMirroredContainerAppearance(container, source) {
        if (!container || !source)
            return;

        const syncAppearance = () => {
            if (this._isDestroying)
                return;

            try {
                const appearanceSource = this._getRoleAppearanceSource(source) ?? source;
                const nextStyleClass = appearanceSource.get_style_class_name?.() || 'panel-status-menu-box';
                if (container.get_style_class_name?.() !== nextStyleClass)
                    container.set_style_class_name(nextStyleClass);

                this._applyZeroSpacingStyle(container, appearanceSource.get_style?.() ?? '');

                const nextVisible = this._isEffectivelyVisible(appearanceSource, this._sourceIndicator);
                if (container.visible !== nextVisible)
                    container.visible = nextVisible;

                if (appearanceSource.has_style_pseudo_class?.('active')) {
                    container.add_style_pseudo_class('active');
                    this.add_style_pseudo_class('active');
                } else {
                    container.remove_style_pseudo_class('active');
                    this.remove_style_pseudo_class('active');
                }

                if (appearanceSource.has_style_pseudo_class?.('checked')) {
                    container.add_style_pseudo_class('checked');
                    this.add_style_pseudo_class('checked');
                } else {
                    container.remove_style_pseudo_class('checked');
                    this.remove_style_pseudo_class('checked');
                }
            } catch (_e) {
            }
        };

        syncAppearance();
        this._trackWidgetSignals(source, ['notify::style', 'notify::visible'], syncAppearance);
    },

    _findDirectActionTarget(actionNames) {
        const target = this._findPreferredRoleActor(this._sourceIndicator, actor =>
            actionNames.some(actionName => typeof actor[actionName] === 'function'));
        if (!target)
            return null;

        const actionName = actionNames.find(name => typeof target[name] === 'function');
        return actionName ? { target, actionName } : null;
    },

    _findClickableTarget() {
        return this._findPreferredRoleActor(this._sourceIndicator, actor =>
            typeof actor?.clicked === 'function' ||
            actor instanceof St.Button ||
            actor.reactive === true);
    },

    _clearTrackedWidgetSignals() {
        if (!this._trackedWidgetSignals)
            return;

        for (const {sourceWidget, signalId} of this._trackedWidgetSignals) {
            if (!sourceWidget || !signalId)
                continue;

            try {
                sourceWidget.disconnect(signalId);
            } catch (_e) {
            }
        }

        this._trackedWidgetSignals = [];
    },

    _isEffectivelyVisible(widget, stopActor = null) {
        let current = widget;

        while (current) {
            if (current.visible === false)
                return false;

            if (current === stopActor)
                return true;

            current = current.get_parent?.() ?? null;
        }

        return true;
    },

    _copyIconsFromSource(container, source) {
        this._clearTrackedWidgetSignals();
        container.remove_all_children();

        const widgets = this._findAllDisplayWidgets(source);

        if (widgets.length > 0) {
            for (const widget of widgets) {
                if (widget instanceof St.Icon) {
                    const iconCopy = new St.Icon({
                        gicon: widget.gicon,
                        icon_name: widget.icon_name,
                        icon_size: widget.icon_size || 16,
                        style_class: widget.get_style_class_name() || 'system-status-icon',
                        y_align: Clutter.ActorAlign.CENTER,
                    });
                    this._trackMirroredCopySignals(
                        widget,
                        [
                            'notify::gicon',
                            'notify::icon-name',
                            'notify::icon-size',
                            'notify::style',
                            'notify::visible',
                        ],
                        iconCopy,
                        source,
                        () => {
                            iconCopy.gicon = widget.gicon;
                            iconCopy.icon_name = widget.icon_name;
                            iconCopy.icon_size = widget.icon_size || 16;
                        },
                        'system-status-icon'
                    );

                    container.add_child(iconCopy);
                } else if (widget instanceof St.Label) {
                    if (this._role && this._role.toLowerCase().includes('arc'))
                        continue;

                    const labelCopy = new St.Label({
                        text: widget.text,
                        style_class: widget.get_style_class_name() || '',
                        x_expand: false,
                        y_expand: false,
                        y_align: Clutter.ActorAlign.CENTER,
                    });
                    if (labelCopy.clutter_text)
                        labelCopy.clutter_text.y_align = Clutter.ActorAlign.CENTER;

                    this._trackMirroredCopySignals(
                        widget,
                        ['notify::text', 'notify::style', 'notify::visible'],
                        labelCopy,
                        source,
                        () => {
                            labelCopy.text = widget.text;
                        }
                    );

                    labelCopy._sourceLabel = widget;
                    container.add_child(labelCopy);
                }
            }
        } else {
            this._createAllocationSyncedClone(container, source, `fallback:${this._role ?? 'generic'}`);
        }
    },

    _findAllDisplayWidgets(actor, stopActor = actor) {
        const widgets = [];
        if (!actor || !this._isEffectivelyVisible(actor, stopActor))
            return widgets;

        if (actor instanceof St.Icon || actor instanceof St.Label) {
            widgets.push(actor);
            return widgets;
        }

        const children = actor.get_children ? actor.get_children() : [];
        for (const child of children)
            widgets.push(...this._findAllDisplayWidgets(child, stopActor));
        return widgets;
    },

    _startIconSync() {
        if (this._iconSyncId) {
            GLib.source_remove(this._iconSyncId);
            this._iconSyncId = null;
        }
        if (this._labelSyncId) {
            GLib.source_remove(this._labelSyncId);
            this._labelSyncId = null;
        }

        this._iconSyncId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
            try {
                if (this._isDestroying) {
                    this._iconSyncId = null;
                    return GLib.SOURCE_REMOVE;
                }

                if (this._iconContainer && this._iconSource) {
                    this._copyIconsFromSource(this._iconContainer, this._iconSource);
                    if (this._shouldSyncRoleContainerAppearance())
                        this._syncMirroredContainerAppearance(this._iconContainer, this._iconSource);
                }
                return GLib.SOURCE_CONTINUE;
            } catch (_e) {
                this._iconSyncId = null;
                return GLib.SOURCE_REMOVE;
            }
        });

        if (this._usesDirectLabelSync())
            return;

        this._labelSyncId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
            try {
                if (this._isDestroying) {
                    this._labelSyncId = null;
                    return GLib.SOURCE_REMOVE;
                }

                if (this._iconContainer)
                    this._syncLabelTexts(this._iconContainer);
                return GLib.SOURCE_CONTINUE;
            } catch (_e) {
                this._labelSyncId = null;
                return GLib.SOURCE_REMOVE;
            }
        });
    },

    _syncLabelTexts(container) {
        const children = container.get_children();
        for (const child of children) {
            if (child instanceof St.Label && child._sourceLabel) {
                try {
                    child.text = child._sourceLabel.text;
                } catch (_e) {
                }
            }
        }
    },

    _createFillClone(parent, source) {
        const container = new St.BoxLayout({
            style_class: source.get_style_class_name ? source.get_style_class_name() : 'panel-status-menu-box',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            y_expand: true,
            reactive: false,
        });
        this._applyZeroSpacingStyle(container);

        const icon = this._findIconInActor(source);
        if (icon) {
            const iconCopy = new St.Icon({
                gicon: icon.gicon,
                icon_name: icon.icon_name || 'starred-symbolic',
                icon_size: icon.icon_size || 16,
                style_class: icon.get_style_class_name() || 'system-status-icon',
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._applyZeroSpacingStyle(iconCopy);
            container.add_child(iconCopy);
        } else {
            const fallbackIcon = new St.Icon({
                icon_name: 'starred-symbolic',
                style_class: 'system-status-icon',
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._applyZeroSpacingStyle(fallbackIcon);
            container.add_child(fallbackIcon);
        }

        parent.add_child(container);
        this._favoritesContainer = container;
    },

    _findIconInActor(actor) {
        if (actor instanceof St.Icon)
            return actor;
        const children = actor.get_children ? actor.get_children() : [];
        for (const child of children) {
            const found = this._findIconInActor(child);
            if (found)
                return found;
        }
        return null;
    },

    _createFallbackIcon() {
        const label = new St.Label({
            text: '⚙',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._applyZeroSpacingStyle(label);
        this.add_child(label);
    },
};

export function installMirroredIndicatorCloneSupport(prototype) {
    Object.assign(prototype, cloneSupportMethods);
}
