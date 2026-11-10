import React, { useEffect, useState } from 'react';
import { CalendarX2, Phone } from 'lucide-react';
import api from '../services/api';

// Defaults match the backend; used until /settings/public responds (or if it fails)
const DEFAULT_PUBLIC_SETTINGS = {
  registrationOpen: true,
  closedTitle: 'Registration Closed',
  closedMessage: 'Calendar distribution registration is currently closed. Please contact the Markaz administration for more information.',
  maxUnitsPerStudent: 1
};

/**
 * Loads the public registration settings (open/closed, closed message, unit limit).
 */
export function usePublicSettings() {
  const [settings, setSettings] = useState(DEFAULT_PUBLIC_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/settings/public')
      .then((res) => {
        if (!cancelled && res.data.success) {
          setSettings({ ...DEFAULT_PUBLIC_SETTINGS, ...res.data.settings });
        }
      })
      .catch((err) => console.error('Failed to load registration settings:', err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { settings, setSettings, loading };
}

/**
 * Full-width notice shown in place of the registration form while registration is closed.
 */
export default function RegistrationClosed({ title, message }) {
  return (
    <div className="overflow-hidden bg-white border shadow-sm rounded-3xl border-slate-200/90">
      <div className="relative px-6 py-10 overflow-hidden text-center text-white bg-gradient-to-br from-markaz-800 via-markaz-700 to-markaz-900 md:py-14">
        <div className="absolute w-64 h-64 rounded-full pointer-events-none -top-16 -right-16 bg-white/10 blur-3xl" />
        <div className="absolute w-64 h-64 rounded-full pointer-events-none -bottom-16 -left-16 bg-markaz-400/20 blur-2xl" />

        <div className="relative z-10 max-w-xl mx-auto space-y-4">
          <div className="inline-flex items-center justify-center w-16 h-16 border rounded-2xl bg-white/15 border-white/25">
            <CalendarX2 className="w-8 h-8 text-amber-300" />
          </div>
          <h2 className="text-2xl font-black tracking-tight md:text-3xl">
            {title || DEFAULT_PUBLIC_SETTINGS.closedTitle}
          </h2>
          <span className="inline-flex items-center gap-2 px-3 py-1 text-xs font-bold tracking-wider uppercase border rounded-full bg-red-500/20 border-red-300/40 text-red-50">
            <span className="w-2 h-2 bg-red-400 rounded-full" />
            Not accepting registrations
          </span>
        </div>
      </div>

      <div className="max-w-xl p-6 mx-auto space-y-5 text-center md:p-8">
        <p className="text-sm leading-relaxed whitespace-pre-line text-slate-700 md:text-base">
          {message || DEFAULT_PUBLIC_SETTINGS.closedMessage}
        </p>
        <div className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium border rounded-xl bg-slate-50 border-slate-200 text-slate-600">
          <Phone className="w-3.5 h-3.5 text-markaz-700" />
          <span>For queries, please contact the Markaz administration office.</span>
        </div>
      </div>
    </div>
  );
}
