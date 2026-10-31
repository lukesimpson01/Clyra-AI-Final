import React from 'react';
import './clyra-source/studioStyles.css';
import './clyra-studio-theme.css';

// Clyra CreatorStudio's four theme cards and their source class structure.
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icon = name => `<svg class="i lg" aria-hidden="true"><use href="#${name}"></use></svg>`;
function makeThemeCard(theme, label, selected, profile, first, second) {
  const ios = theme.startsWith('ios');
  return `<button type="button" class="themeCard ${selected === theme ? 'selected' : ''}" data-theme="${theme}" aria-pressed="${selected === theme}"><span class="themeShot ${theme}"><span class="themeTop"><span class="themeBack">‹</span><span class="themeContact"><span class="miniAvatar">${escapeHtml(profile[0].toUpperCase())}</span><span><span class="name">${escapeHtml(profile)}</span>${ios ? '' : '<br><span class="online">Online</span>'}</span></span><span class="themeContactsButtons">${icon('video')}${ios ? '' : icon('phone-call')}</span></span><span class="sampleMessages"><span class="sampleLine"><span class="sampleBub in">${escapeHtml(first)}</span></span><span class="sampleLine out"><span class="sampleBub out">${escapeHtml(second)}</span></span></span></span><strong>${label}</strong></button>`;
}
export default function ClyraStudioTheme({ theme, onChange, name, messages }) {
  const profile = name.trim() || 'Unknown';
  const first = messages.find(m => m.side === 'left' && m.text.trim())?.text || 'Hey, you got a minute?';
  const second = messages.find(m => m.side === 'right' && m.text.trim())?.text || 'Yeah, what’s up?';
  const selected = ({ 'imessage-light': 'ios-light', 'imessage-dark': 'ios-dark' }[theme] || theme);
  const html = makeThemeCard('whatsapp-light', 'WhatsApp Light', selected, profile, first, second) + makeThemeCard('whatsapp-dark', 'WhatsApp Dark', selected, profile, first, second) + makeThemeCard('ios-light', 'iOS Light', selected, profile, first, second) + makeThemeCard('ios-dark', 'iOS Dark', selected, profile, first, second);
  return <div className="cs-root cst-root" onClick={event => { const card = event.target.closest('[data-theme]'); if (card) onChange(card.dataset.theme); }}><div className="themeGrid" dangerouslySetInnerHTML={{ __html: html }}/></div>;
}
