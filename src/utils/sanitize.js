import DOMPurify from 'dompurify'

// Erlaubte CSS-Properties (Quill-Formatierung), alles andere wird entfernt
const ALLOWED_CSS_PROPERTIES = [
    'color', 'background-color', 'font-size', 'font-weight', 'font-style',
    'text-decoration', 'text-align', 'margin', 'margin-left', 'margin-right',
    'padding', 'padding-left', 'padding-right', 'line-height', 'list-style-type'
]

// CSS-Property-Filter: entfernt gefährliche Properties wie background-image, position, content
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.hasAttribute('style')) {
        const style = node.style
        for (let i = style.length - 1; i >= 0; i--) {
            if (!ALLOWED_CSS_PROPERTIES.includes(style[i])) {
                style.removeProperty(style[i])
            }
        }
        // Leeres style-Attribut entfernen
        if (!node.getAttribute('style')?.trim()) {
            node.removeAttribute('style')
        }
    }
    // href/src: nur http(s) und relative URLs erlauben
    for (const attr of ['href', 'src']) {
        if (node.hasAttribute(attr)) {
            const val = node.getAttribute(attr) || ''
            if (val && !val.match(/^(https?:\/\/|\/|#|mailto:)/i)) {
                node.removeAttribute(attr)
            }
        }
    }
})

/**
 * Sanitize HTML to prevent XSS attacks.
 * Allows basic formatting tags but strips scripts, event handlers, etc.
 * CSS properties are filtered to a safe allowlist (Quill formatting only).
 */
export function sanitizeHtml(dirty) {
    if (!dirty) return ''
    return DOMPurify.sanitize(dirty, {
        ALLOWED_TAGS: [
            'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
            'p', 'br', 'hr',
            'strong', 'b', 'em', 'i', 'u', 's', 'del',
            'ul', 'ol', 'li',
            'a', 'img',
            'table', 'thead', 'tbody', 'tr', 'th', 'td',
            'blockquote', 'pre', 'code',
            'span', 'div', 'sub', 'sup',
            'mark', 'small'
        ],
        ALLOWED_ATTR: [
            'href', 'target', 'rel', 'src', 'alt', 'title',
            'class', 'style', 'id',
            'colspan', 'rowspan'
        ],
        ALLOW_DATA_ATTR: false,
        ADD_ATTR: ['target'],
        // Links immer in neuem Tab öffnen
        FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'select', 'button'],
        FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur']
    })
}
