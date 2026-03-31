/*
Copyright (C) 2014  spin83
Copyright (C) 2026  inasis

This program is free software; you can redistribute it and/or
modify it under the terms of the GNU General Public License
as published by the Free Software Foundation; either version 2
of the License, or (at your option) any later version.
*/

export function composeSpacingStyle(baseStyle, gap) {
    const gapStyle = `spacing: ${gap}px;`;
    return `${baseStyle || ''}${baseStyle && gapStyle ? ' ' : ''}${gapStyle}`.trim() || null;
}

export function sanitizeInlineStyle(style) {
    if (!style || typeof style !== 'string')
        return null;

    const lengthLikeProperty = /^(?:padding|margin|spacing|width|height|min-width|min-height|max-width|max-height|icon-size|border(?:-(?:top|right|bottom|left))?-width|-natural-hpadding|-minimum-hpadding)$/i;
    const validLengthValue = /^(?:-?\d+(?:\.\d+)?(?:px|pt|em|rem|%)?|0|auto|inherit|initial|unset|calc\(.+\)|var\(.+\))$/i;

    const sanitized = style
        .split(';')
        .map(part => part.trim())
        .filter(Boolean)
        .filter(part => part.includes(':'))
        .map(part => {
            const [property, ...valueParts] = part.split(':');
            const name = property.trim();
            const value = valueParts.join(':').trim();
            return {name, value};
        })
        .filter(({name, value}) => name && value)
        .filter(({value}) => !/(?:^|[\s:(-])(NaN|undefined|null)(?:$|[\s);-])/i.test(value))
        .filter(({name, value}) => !lengthLikeProperty.test(name) || validLengthValue.test(value))
        .map(({name, value}) => `${name}: ${value}`)
        .join('; ');

    return sanitized || null;
}

export function applyManagedStyle(actor, key, buildStyle) {
    if (!actor?.set_style)
        return;

    const originalStyle = actor[key] ?? actor.get_style?.() ?? null;
    if (actor[key] === undefined)
        actor[key] = originalStyle;

    const nextStyle = buildStyle(actor[key] || '');
    actor.set_style(nextStyle || null);
}

export function restoreManagedStyle(actor, key) {
    if (!actor?.set_style || actor[key] === undefined)
        return;

    actor.set_style(actor[key] || null);
    delete actor[key];
}

export function applyHorizontalPaddingStyle(actor, key, leftPadding, rightPadding) {
    applyManagedStyle(actor, key, baseStyle => {
        const paddingStyle = `padding-left: ${leftPadding}px; padding-right: ${rightPadding}px;`;
        return `${baseStyle}${baseStyle && paddingStyle ? ' ' : ''}${paddingStyle}`.trim();
    });
}

export function applyGapStyle(actor, key, gap) {
    applyManagedStyle(actor, key, baseStyle => composeSpacingStyle(baseStyle, gap));
}
