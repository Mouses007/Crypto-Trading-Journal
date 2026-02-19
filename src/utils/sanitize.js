import DOMPurify from 'dompurify'

/**
 * Sanitize HTML to prevent XSS attacks.
 * Allows basic formatting tags but strips scripts, event handlers, etc.
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
