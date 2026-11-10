import React, { useEffect, useState } from 'react';
import {
  Power,
  MapPin,
  Save,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  RotateCcw
} from 'lucide-react';
import api from '../../services/api';

const EMPTY_FORM = {
  registration_open: true,
  registration_closed_title: '',
  registration_closed_message: '',
  max_units_per_student: 1
};

export default function SettingsPage() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [saved, setSaved] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    async function loadSettings() {
      try {
        const res = await api.get('/settings');
        if (res.data.success) {
          setForm(res.data.settings);
          setSaved(res.data.settings);
        }
      } catch (err) {
        setError(err.response?.data?.message || 'Failed to load settings.');
      } finally {
        setLoading(false);
      }
    }
    loadSettings();
  }, []);

  const isDirty = JSON.stringify(form) !== JSON.stringify(saved);

  const update = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSuccess('');
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    const maxUnits = Number(form.max_units_per_student);
    if (!Number.isInteger(maxUnits) || maxUnits < 1 || maxUnits > 50) {
      setError('Maximum units per student must be a whole number between 1 and 50.');
      return;
    }

    try {
      setSaving(true);
      const res = await api.put('/settings', { ...form, max_units_per_student: maxUnits });
      if (res.data.success) {
        setForm(res.data.settings);
        setSaved(res.data.settings);
        setSuccess(res.data.message || 'Settings saved successfully.');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 p-12 text-sm text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>Loading settings...</span>
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="max-w-3xl space-y-6">
      {/* Title */}
      <div>
        <h1 className="text-xl font-bold tracking-tight md:text-2xl text-slate-900">
          System Settings
        </h1>
        <p className="text-xs md:text-sm text-slate-500">
          Control public registration and unit allotment rules. Changes apply immediately for students.
        </p>
      </div>

      {/* Registration Status */}
      <section className="p-5 space-y-4 bg-white border shadow-sm rounded-xl border-slate-200 md:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className={`p-2 rounded-lg ${form.registration_open ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
              <Power className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">Registration Status</h2>
              <p className="text-xs text-slate-500">
                {form.registration_open
                  ? 'Registration is open. Students can submit the registration form.'
                  : 'Registration is closed. Students see the closed message below instead of the form.'}
              </p>
            </div>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={form.registration_open}
            aria-label="Registration open"
            onClick={() => update('registration_open', !form.registration_open)}
            className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition ${
              form.registration_open ? 'bg-emerald-600' : 'bg-slate-300'
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                form.registration_open ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        <div className="pt-4 space-y-3 border-t border-slate-100">
          <div className="space-y-1.5">
            <label htmlFor="closedTitle" className="block text-xs font-bold text-slate-800">
              Closed Page Title
            </label>
            <input
              id="closedTitle"
              type="text"
              maxLength={150}
              value={form.registration_closed_title}
              onChange={(e) => update('registration_closed_title', e.target.value)}
              className="w-full px-3 py-2 text-sm font-medium border rounded-lg bg-slate-50 border-slate-200 text-slate-900 focus:outline-none focus:ring-1 focus:ring-markaz-600 focus:bg-white"
              required
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="closedMessage" className="block text-xs font-bold text-slate-800">
              Closed Page Message
            </label>
            <textarea
              id="closedMessage"
              rows={4}
              maxLength={2000}
              value={form.registration_closed_message}
              onChange={(e) => update('registration_closed_message', e.target.value)}
              className="w-full px-3 py-2 text-sm font-medium border rounded-lg bg-slate-50 border-slate-200 text-slate-900 focus:outline-none focus:ring-1 focus:ring-markaz-600 focus:bg-white"
              required
            />
            <p className="text-[11px] text-slate-500">
              Shown on the home and registration pages while registration is closed. Line breaks are kept; Malayalam is supported.
            </p>
          </div>
          <a
            href="/register"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-markaz-700 hover:underline"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>Open the public registration page</span>
          </a>
        </div>
      </section>

      {/* Unit Allotment */}
      <section className="p-5 space-y-4 bg-white border shadow-sm rounded-xl border-slate-200 md:p-6">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-violet-50 text-violet-700">
            <MapPin className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900">Unit Allotment</h2>
            <p className="text-xs text-slate-500">
              How many Inside Kerala units one student can select. Each unit can still be taken by only one student.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 pt-4 border-t sm:flex-row sm:items-center sm:justify-between border-slate-100">
          <label htmlFor="maxUnits" className="text-xs font-bold text-slate-800">
            Maximum units per student
          </label>
          <input
            id="maxUnits"
            type="number"
            min={1}
            max={50}
            step={1}
            value={form.max_units_per_student}
            onChange={(e) => update('max_units_per_student', e.target.value === '' ? '' : Number(e.target.value))}
            className="w-28 px-3 py-2 text-sm font-bold text-center border rounded-lg bg-slate-50 border-slate-200 text-slate-900 focus:outline-none focus:ring-1 focus:ring-markaz-600 focus:bg-white"
            required
          />
        </div>
        <p className="text-[11px] text-slate-500">
          Lowering this limit does not affect students who have already registered more units.
        </p>
      </section>

      {/* Feedback */}
      {error && (
        <div className="flex items-center gap-2 p-3 text-xs text-red-700 border border-red-200 rounded-lg bg-red-50 md:text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 p-3 text-xs border rounded-lg border-emerald-200 bg-emerald-50 text-emerald-800 md:text-sm">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving || !isDirty}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-markaz-700 hover:bg-markaz-800 disabled:bg-slate-400 text-white text-sm font-semibold shadow-sm transition"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          <span>{saving ? 'Saving...' : 'Save Settings'}</span>
        </button>
        {isDirty && !saving && (
          <button
            type="button"
            onClick={() => {
              setForm(saved);
              setError('');
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100 transition"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Discard changes</span>
          </button>
        )}
      </div>
    </form>
  );
}
