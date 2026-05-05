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

const cloneSupportMethods = {

    // Clone factory
    _createSimpleClone(parent, source) {
        if (this._isDescriptorKind?.('simple-visual', 'menu-forward', 'activation-forward') ||
            this._hasCapability?.('external')) {
            this._createStaticIconCopy(parent, source);
            return;
        }

        this._createAllocationSyncedClone(parent, source, `simple:${this._role ?? 'generic'}`);
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

    // Static icon copy
    _createStaticIconCopy(parent, source) {
        const container = new St.BoxLayout({
            style_class: 'panel-status-menu-box',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            y_expand: false,
            reactive: false,
        });
        this._applyZeroSpacingStyle(container);

        this._copyIconsFromSource(container, source);
        if (this._shouldSyncRoleContainerAppearance())
            this._syncMirroredContainerAppearance(container, source);
        parent.add_child(container);
        this._iconContainer = container;
        this._iconSource = source;

        this._startIconSync();
    },

    // Role predicates (delegating to shared constants)
    _shouldSyncRoleContainerAppearance() {
        return this._hasCapability?.('appearance-sync') ?? false;
    },

    _getMirroredSourceInlineStyle(widget) {
        if (!widget?.get_style)
            return null;

        if (this._role === 'keyboard')
            return null;

        return widget.get_style?.() ?? null;
    },

    // Actor tree helpers
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

    // Appearance sync
    _syncPseudoClass(container, appearanceSource, pseudoClass) {
        if (appearanceSource.has_style_pseudo_class?.(pseudoClass)) {
            container.add_style_pseudo_class(pseudoClass);
            this.add_style_pseudo_class(pseudoClass);
        } else {
            container.remove_style_pseudo_class(pseudoClass);
            this.remove_style_pseudo_class(pseudoClass);
        }
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

                this._syncPseudoClass(container, appearanceSource, 'active');
                this._syncPseudoClass(container, appearanceSource, 'checked');
            } catch (_e) {
            }
        };

        syncAppearance();
        this._trackWidgetSignals(source, ['notify::style', 'notify::visible'], syncAppearance);
    },

    // Action target finders
    _findDirectActionTarget(actionNames) {
        const target = this._findForwardTarget(actor =>
            actionNames.some(actionName => typeof actor[actionName] === 'function'));
        if (!target)
            return null;

        const actionName = actionNames.find(name => typeof target[name] === 'function');
        return actionName ? { target, actionName } : null;
    },

    _findClickableTarget() {
        return this._findForwardTarget(actor =>
            typeof actor?.activate === 'function' ||
            typeof actor?.clicked === 'function' ||
            typeof actor?.toggle === 'function' ||
            actor instanceof St.Button ||
            actor.reactive === true);
    },

    _findForwardTarget(predicate) {
        let bestTarget = null;
        let bestDepth = -1;

        for (const root of this._getForwardSearchRoots()) {
            const target = this._findPreferredRoleActor(root, predicate);
            if (!target)
                continue;

            const depth = this._getActorDepth(target);
            if (depth > bestDepth) {
                bestTarget = target;
                bestDepth = depth;
            }
        }

        return bestTarget;
    },

    _getForwardSearchRoots() {
        return [
            this._sourceIndicator,
            this._sourceIndicator?.container,
            this._descriptor?.actor,
        ].filter((actor, index, actors) =>
            actor && actors.indexOf(actor) === index);
    },

    // Signal tracking
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

    // Icon copy
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
        if (!actor)
            return widgets;

        if (this._role !== 'keyboard' && !this._isEffectivelyVisible(actor, stopActor))
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

    // Icon sync timer
    _makeDestroyGuardedTimer(timeoutKey, body) {
        return () => {
            try {
                if (this._isDestroying) {
                    this[timeoutKey] = null;
                    return GLib.SOURCE_REMOVE;
                }
                return body();
            } catch (_e) {
                this[timeoutKey] = null;
                return GLib.SOURCE_REMOVE;
            }
        };
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

        this._iconSyncId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            5,
            this._makeDestroyGuardedTimer('_iconSyncId', () => {
                if (this._iconContainer && this._iconSource) {
                    this._copyIconsFromSource(this._iconContainer, this._iconSource);
                    if (this._shouldSyncRoleContainerAppearance())
                        this._syncMirroredContainerAppearance(this._iconContainer, this._iconSource);
                }
                return GLib.SOURCE_CONTINUE;
            })
        );

        if (this._isDirectSyncRole())
            return;

        this._labelSyncId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            2,
            this._makeDestroyGuardedTimer('_labelSyncId', () => {
                if (this._iconContainer)
                    this._syncLabelTexts(this._iconContainer);
                return GLib.SOURCE_CONTINUE;
            })
        );
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

};

export function installMirroredIndicatorCloneSupport(prototype) {
    Object.assign(prototype, cloneSupportMethods);
}
