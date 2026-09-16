// Hand-drawn glyphs (avatars, mode icons) and the flame mark, built as SVG
// nodes so no markup string ever touches the page.

const NS = 'http://www.w3.org/2000/svg';

/** Each glyph is a list of [tag, attributes] inside a 24×24 box. `cut` parts take the background colour. */
const GLYPHS = {
    flame: [['path', { d: 'M12 2c1.2 4.2 5.5 5.6 5.5 10.4a5.5 5.5 0 0 1-11 0c0-2.3 1.1-3.6 2.4-4.8-.1 2.1.9 3.4 2.1 3.6 1.4-3.2-1.2-6.4 1-9.2z' }]],
    spade: [['path', { d: 'M12 2c-3.2 5-8 7.2-8 11.2a4 4 0 0 0 7 2.6c-.3 1.7-1 2.9-2.5 3.7h7c-1.5-.8-2.2-2-2.5-3.7a4 4 0 0 0 7-2.6C20 9.2 15.2 7 12 2z' }]],
    heart: [['path', { d: 'M12 21s-8.2-5.4-8.2-11.2A4.6 4.6 0 0 1 12 7.4a4.6 4.6 0 0 1 8.2 2.4C20.2 15.6 12 21 12 21z' }]],
    club: [['path', { d: 'M12 2.5a3.6 3.6 0 0 0-2.9 5.7A3.6 3.6 0 1 0 10.6 15c.3 1.7-.4 3.2-1.6 4.5h6c-1.2-1.3-1.9-2.8-1.6-4.5a3.6 3.6 0 1 0 1.5-6.8A3.6 3.6 0 0 0 12 2.5z' }]],
    diamond: [['path', { d: 'M12 2l7.5 10L12 22 4.5 12z' }]],
    crown: [['path', { d: 'M3 17.5h18l1.2-11-5.4 4.2L12 3.5l-4.8 7.2L1.8 6.5z' }], ['rect', { x: 3, y: 18.8, width: 18, height: 2.4, rx: 0.8 }]],
    star: [['path', { d: 'M12 2l2.9 6.4 7 .8-5.2 4.8 1.4 6.9L12 17.4l-6.1 3.5 1.4-6.9L2.1 9.2l7-.8z' }]],
    bolt: [['path', { d: 'M13.5 2L4 14h6.2l-1.4 8L20 10h-6.3z' }]],
    moon: [['path', { d: 'M20.5 15.2A8.8 8.8 0 0 1 8.8 3.5a8.8 8.8 0 1 0 11.7 11.7z' }]],
    dice: [
        ['rect', { x: 3, y: 3, width: 18, height: 18, rx: 4 }],
        ['circle', { cx: 8, cy: 8, r: 1.7, class: 'cut' }],
        ['circle', { cx: 16, cy: 8, r: 1.7, class: 'cut' }],
        ['circle', { cx: 12, cy: 12, r: 1.7, class: 'cut' }],
        ['circle', { cx: 8, cy: 16, r: 1.7, class: 'cut' }],
        ['circle', { cx: 16, cy: 16, r: 1.7, class: 'cut' }],
    ],
    joker: [
        ['path', { d: 'M4 14.5c2.2-1 3.1-5.5 4-9.5 1.9 3.2 3 3.2 4 0 1 3.2 2.1 3.2 4 0 .9 4 1.8 8.5 4 9.5v3.5H4z' }],
        ['circle', { cx: 4, cy: 14.5, r: 1.6 }],
        ['circle', { cx: 12, cy: 5, r: 1.6 }],
        ['circle', { cx: 20, cy: 14.5, r: 1.6 }],
        ['rect', { x: 4, y: 19, width: 16, height: 2.6, rx: 1, class: 'cut' }],
    ],
    ace: [['path', { d: 'M12 3l7.5 18h-3.6l-1.5-4h-4.8l-1.5 4H4.5zm0 6.2L10.4 14h3.2z' }]],
    // Two fanned cards: the Classic mode icon.
    cards: [
        ['rect', { x: 2.5, y: 5.5, width: 11, height: 15, rx: 2, transform: 'rotate(-14 8 13)' }],
        ['rect', { x: 8.6, y: 2.6, width: 13.4, height: 17.4, rx: 2.8, transform: 'rotate(8 15.5 11.5)', class: 'cut' }],
        ['rect', { x: 10, y: 4, width: 11, height: 15, rx: 2, transform: 'rotate(8 15.5 11.5)' }],
    ],
};

/** The glyphs a player may pick as an avatar; the rest are icons. */
export const AVATARS = ['flame', 'spade', 'heart', 'club', 'diamond', 'crown', 'star', 'bolt', 'moon', 'dice', 'joker', 'ace'];

function svg(children, className) {
    const el = document.createElementNS(NS, 'svg');
    el.setAttribute('viewBox', '0 0 24 24');
    el.setAttribute('aria-hidden', 'true');
    el.setAttribute('focusable', 'false');
    if (className) el.setAttribute('class', className);
    for (const [tag, attrs] of children) {
        const node = document.createElementNS(NS, tag);
        for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
        el.append(node);
    }
    return el;
}

/** A glyph as an SVG element, filled with the current text colour. */
export function avatarNode(id, className = '') {
    return svg(GLYPHS[id] ?? GLYPHS.flame, className);
}

let markCount = 0;

/**
 * The Pyre mark: three nested tongues of flame filled with theme-coloured
 * gradients (the stops take their colours from the stylesheet), plus three
 * sparks. The stylesheet gives it a slow, candle-like sway rather than a flicker.
 */
export function flameMark(className = 'mark') {
    const id = `pyre-fire-${++markCount}`;
    const el = document.createElementNS(NS, 'svg');
    el.setAttribute('viewBox', '0 0 24 24');
    el.setAttribute('aria-hidden', 'true');
    el.setAttribute('focusable', 'false');
    el.setAttribute('class', className);

    const gradient = (suffix, stops) => {
        const g = document.createElementNS(NS, 'linearGradient');
        g.id = `${id}-${suffix}`;
        for (const [key, value] of Object.entries({ x1: 0, y1: 1, x2: 0, y2: 0 })) g.setAttribute(key, String(value));
        for (const [offset, cls] of stops) {
            const stop = document.createElementNS(NS, 'stop');
            stop.setAttribute('offset', offset);
            stop.setAttribute('class', cls);
            g.append(stop);
        }
        return g;
    };
    const defs = document.createElementNS(NS, 'defs');
    defs.append(
        gradient('outer', [['0', 'stop-base'], ['0.55', 'stop-mid'], ['1', 'stop-tip']]),
        gradient('inner', [['0', 'stop-mid'], ['0.65', 'stop-tip'], ['1', 'stop-core']]),
    );

    const flame = document.createElementNS(NS, 'g');
    flame.setAttribute('class', 'flame');
    const parts = [
        ['path', { class: 'tongue tongue-a', fill: `url(#${id}-outer)`, d: 'M12 22c-4.4 0-7.5-3-7.5-7 0-3.3 2.3-5.3 3.4-7.5.5 2.3 1.6 3.1 2.5 3.4 0-2.8.6-6.2 4-8.4-.3 3.3 1.6 4.8 3.1 6.7 1.4 1.9 2 3.6 2 5.8 0 4-3.1 7-7.5 7z' }],
        ['path', { class: 'tongue tongue-b', fill: `url(#${id}-inner)`, d: 'M12 20.5c-2.6 0-4.4-1.9-4.4-4.4 0-2 1.3-3.2 2.1-4.6.3 1.4 1 2 1.7 2.3 0-1.7.4-3.8 2.5-5.2-.2 2 1 3 1.9 4.1.9 1.2 1.2 2.2 1.2 3.4 0 2.5-1.8 4.4-5 4.4z' }],
        ['path', { class: 'tongue tongue-c', d: 'M12 19c-1.3 0-2.2-1-2.2-2.2 0-1 .7-1.6 1.1-2.3.2.7.5 1 .9 1.1 0-.9.2-1.9 1.2-2.6-.1 1 .5 1.5.9 2.1.5.6.6 1.1.6 1.7 0 1.2-.9 2.2-2.5 2.2z' }],
        ['circle', { class: 'spark s1', cx: 9.2, cy: 7.5, r: 0.7 }, '-1.5px'],
        ['circle', { class: 'spark s2', cx: 12.6, cy: 4.5, r: 0.55 }, '1px'],
        ['circle', { class: 'spark s3', cx: 15.4, cy: 8.2, r: 0.6 }, '1.8px'],
    ];
    for (const [tag, attrs, drift] of parts) {
        const node = document.createElementNS(NS, tag);
        for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
        // Through the CSSOM, not a style attribute: the CSP forbids inline style text.
        if (drift) node.style.setProperty('--sx', drift);
        flame.append(node);
    }
    el.append(defs, flame);
    return el;
}
