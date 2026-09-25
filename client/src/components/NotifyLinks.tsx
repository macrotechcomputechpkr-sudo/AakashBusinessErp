// =============================================
// NotifyLinks.tsx
// After saving a task / darta, WhatsApp and Viber in "link" mode (no paid
// API configured in Messaging > Settings) cannot send by themselves: these
// buttons open the app with the message ready for the person who saved.
// =============================================
import React from 'react';
import type { NotifyLink } from '../types/erp';

export default function NotifyLinks({ links, onClose }: { links: NotifyLink[]; onClose: () => void }) {
    if (!links.length) return null;
    return (
        <div className="border border-green-300 bg-green-50 rounded-lg p-3 text-sm mb-3">
            <div className="flex justify-between items-start gap-2">
                <p className="font-medium text-green-900">Also tell them on WhatsApp / Viber (message is ready):</p>
                <button type="button" className="text-gray-500" onClick={onClose} aria-label="Close">×</button>
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
                {links.map((l, i) => (
                    <a key={i} href={l.link} target="_blank" rel="noreferrer"
                        className={`px-3 py-1 rounded text-white text-xs ${l.channel === 'whatsapp' ? 'bg-green-600' : 'bg-purple-600'}`}>
                        {l.channel === 'whatsapp' ? 'WhatsApp' : 'Viber'} → {l.user_name}
                    </a>
                ))}
            </div>
        </div>
    );
}
