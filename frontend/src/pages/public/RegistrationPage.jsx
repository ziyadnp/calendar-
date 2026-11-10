import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Search,
  User,
  CheckCircle2,
  AlertCircle,
  Loader2,
  MapPin,
  Globe,
  Phone,
  BookOpen,
  Building,
  Home,
  Check,
  RotateCcw,
  Printer,
  Plus,
  X
} from 'lucide-react';
import api from '../../services/api';
import RegistrationClosed, { usePublicSettings } from '../../components/RegistrationClosed';

const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat',
  'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Madhya Pradesh',
  'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan',
  'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi', 'Lakshadweep', 'Puducherry', 'Ladakh'
];

export default function RegistrationPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // Admin-managed settings: open/closed state and max units per student
  const { settings, setSettings, loading: loadingSettings } = usePublicSettings();
  const maxUnits = settings.maxUnitsPerStudent;

  // Search State
  const [searchNumber, setSearchNumber] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [student, setStudent] = useState(null);
  // Active registrations of the looked-up student (Inside Kerala and/or Outside Kerala)
  const [studentRegistrations, setStudentRegistrations] = useState([]);

  // Real-time Live Search State (triggers when 3 or more characters are entered)
  const [liveSuggestions, setLiveSuggestions] = useState([]);
  const [searchingLive, setSearchingLive] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const searchInputRef = useRef(null);
  const dropdownRef = useRef(null);

  // Workflow Category: 'inside_kerala' or 'outside_kerala'
  const [registrationType, setRegistrationType] = useState(() => {
    return searchParams.get('type') === 'outside_kerala' ? 'outside_kerala' : 'inside_kerala';
  });

  // Inside Kerala Location State
  const [districts, setDistricts] = useState([]);
  const [zones, setZones] = useState([]);
  const [circles, setCircles] = useState([]);
  const [units, setUnits] = useState([]);

  const [selectedDistrictId, setSelectedDistrictId] = useState(null);
  const [selectedZoneId, setSelectedZoneId] = useState(null);
  const [selectedCircleId, setSelectedCircleId] = useState(null);
  // Selected units ({ id, name, circleName }), kept across circle changes so a student
  // can pick units from more than one circle, up to maxUnits
  const [selectedUnits, setSelectedUnits] = useState([]);
  const [unitLimitNotice, setUnitLimitNotice] = useState('');

  // In-box filter search terms
  const [districtFilter, setDistrictFilter] = useState('');
  const [zoneFilter, setZoneFilter] = useState('');
  const [circleFilter, setCircleFilter] = useState('');
  const [unitFilter, setUnitFilter] = useState('');

  // Loading states for hierarchy
  const [loadingDistricts, setLoadingDistricts] = useState(false);
  const [loadingZones, setLoadingZones] = useState(false);
  const [loadingCircles, setLoadingCircles] = useState(false);
  const [loadingUnits, setLoadingUnits] = useState(false);

  // Outside Kerala Form State
  const [outsideForm, setOutsideForm] = useState({
    state_name: 'Karnataka',
    outside_district: '',
    outside_zone: '',
    outside_circle: '',
    outside_unit: ''
  });

  // Submission State
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  // Calendar Quantity State (student-selectable, default 100 Nos)
  const [calendarQuantity, setCalendarQuantity] = useState(100);
  const [quantityError, setQuantityError] = useState('');

  // A student can hold one Inside Kerala registration (several units) and one Outside Kerala
  // registration. They share the admin's unit limit: Kerala units + Outside Kerala (counts as 1).
  const insideReg = studentRegistrations.find((r) => r.registration_type === 'inside_kerala') || null;
  // Outside Kerala: one unit per registration, any number of registrations within the limit
  const outsideRegs = studentRegistrations.filter((r) => r.registration_type === 'outside_kerala');
  const isRegistered = studentRegistrations.length > 0;
  const heldUnits = (insideReg ? Number(insideReg.unit_count) || 0 : 0) + outsideRegs.length;
  const slotsLeft = Math.max(0, maxUnits - heldUnits);
  const canRegisterInside = slotsLeft > 0;
  const canRegisterOutside = slotsLeft > 0;
  const canSubmitSelected = registrationType === 'inside_kerala' ? canRegisterInside : canRegisterOutside;
  // A Kerala submission from a student who already has a Kerala registration adds units to it
  const canAddUnits = registrationType === 'inside_kerala' && Boolean(insideReg) && canRegisterInside;
  // How many Kerala units can be picked in this submission
  const unitLimit = slotsLeft;
  // First registration needs at least 100 calendars; later ones (student already holds
  // calendars) can request any amount from 0
  const minCalendars = isRegistered ? 0 : 100;
  const toQuantity = (value) => {
    const n = parseInt(value, 10);
    return Number.isNaN(n) ? minCalendars : n;
  };
  // Calendars already allotted to the student, across all their registrations
  const allottedOf = (reg) => Number(reg?.calendars_allotted ?? reg?.calendars_requested) || 0;
  const registeredCalendarTotal = studentRegistrations.reduce((sum, r) => sum + allottedOf(r), 0);
  // Per-registration breakdown, e.g. "Kerala 120 + Outside 20 + Outside 100"
  const calendarBreakdown = [
    ...(insideReg ? [`Kerala ${allottedOf(insideReg)}`] : []),
    ...outsideRegs.map((r) => `Outside ${allottedOf(r)}`)
  ].join(' + ');

  // Keep the selected category on one the student is still allowed to submit
  useEffect(() => {
    if (!isRegistered) return;
    if (registrationType === 'inside_kerala' && !canRegisterInside && canRegisterOutside) {
      setRegistrationType('outside_kerala');
    } else if (registrationType === 'outside_kerala' && !canRegisterOutside && canRegisterInside) {
      setRegistrationType('inside_kerala');
    }
  }, [isRegistered, registrationType, canRegisterInside, canRegisterOutside]);

  // Jump to step 3 with a category selected (used by the "already registered" panel)
  const startRegistration = (type) => {
    setRegistrationType(type);
    setTimeout(() => {
      document.getElementById('registration-step-3')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  };

  // Load districts on mount
  useEffect(() => {
    async function loadDistricts() {
      try {
        setLoadingDistricts(true);
        const res = await api.get('/locations/districts');
        if (res.data.success) {
          setDistricts(res.data.districts);
        }
      } catch (err) {
        console.error('Failed to load districts:', err);
      } finally {
        setLoadingDistricts(false);
      }
    }
    loadDistricts();
  }, []);

  // Fetch zones when district changes
  useEffect(() => {
    if (!selectedDistrictId) {
      setZones([]);
      setSelectedZoneId(null);
      setCircles([]);
      setSelectedCircleId(null);
      setUnits([]);
      return;
    }

    async function loadZones() {
      try {
        setLoadingZones(true);
        setSelectedZoneId(null);
        setCircles([]);
        setSelectedCircleId(null);
        setUnits([]);

        const res = await api.get(`/locations/zones?districtId=${selectedDistrictId}`);
        if (res.data.success) {
          setZones(res.data.zones);
        }
      } catch (err) {
        console.error('Failed to load zones:', err);
      } finally {
        setLoadingZones(false);
      }
    }
    loadZones();
  }, [selectedDistrictId]);

  // Fetch circles when zone changes
  useEffect(() => {
    if (!selectedZoneId) {
      setCircles([]);
      setSelectedCircleId(null);
      setUnits([]);
      return;
    }

    async function loadCircles() {
      try {
        setLoadingCircles(true);
        setSelectedCircleId(null);
        setUnits([]);

        const res = await api.get(`/locations/circles?zoneId=${selectedZoneId}`);
        if (res.data.success) {
          setCircles(res.data.circles);
        }
      } catch (err) {
        console.error('Failed to load circles:', err);
      } finally {
        setLoadingCircles(false);
      }
    }
    loadCircles();
  }, [selectedZoneId]);

  // Fetch available units when circle changes
  useEffect(() => {
    if (!selectedCircleId) {
      setUnits([]);
      return;
    }

    async function loadUnits() {
      try {
        setLoadingUnits(true);

        const res = await api.get(`/locations/units/available?circleId=${selectedCircleId}`);
        if (res.data.success) {
          setUnits(res.data.units);
        }
      } catch (err) {
        console.error('Failed to load units:', err);
      } finally {
        setLoadingUnits(false);
      }
    }
    loadUnits();
  }, [selectedCircleId]);

  // Execute student lookup by number/regNo
  const executeStudentLookup = async (queryNumber) => {
    const query = (queryNumber !== undefined ? queryNumber : searchNumber).trim();

    if (!query) {
      setSearchError('Please enter an Admission Number or Registration Number.');
      return;
    }

    setSearching(true);
    setSearchError('');
    setStudent(null);
    setStudentRegistrations([]);
    setSubmitError('');
    // The unit limit depends on the student, so start their selection fresh
    setSelectedUnits([]);
    setUnitLimitNotice('');

    try {
      const res = await api.get(`/students/lookup?number=${encodeURIComponent(query)}`);
      if (res.data.success) {
        setStudent(res.data.student);
        if (res.data.isAlreadyRegistered) {
          // Older API responses only have the single existingRegistration
          setStudentRegistrations(
            Array.isArray(res.data.registrations)
              ? res.data.registrations
              : [res.data.existingRegistration].filter(Boolean)
          );
        }
        // Default quantity: 100 for a first registration, 0 extra for a registered student
        setCalendarQuantity(res.data.isAlreadyRegistered ? 0 : 100);
        setQuantityError('');
      }
    } catch (err) {
      if (err.response && err.response.data && err.response.data.message) {
        setSearchError(err.response.data.message);
      } else {
        setSearchError('No student record found. Please verify your number.');
      }
    } finally {
      setSearching(false);
      setShowDropdown(false);
    }
  };

  // Form submit button search handler
  const handleStudentSearch = async (e) => {
    if (e) e.preventDefault();
    setShowDropdown(false);
    await executeStudentLookup();
  };

  // Select student from real-time live suggestions
  const selectStudent = async (item) => {
    setShowDropdown(false);
    setLiveSuggestions([]);
    setSearchNumber(item.regNo || item.admissionNo);
    await executeStudentLookup(item.regNo || item.admissionNo);
  };

  // Debounced Real-time Live Search Effect (triggers on >= 3 characters)
  useEffect(() => {
    const trimmed = searchNumber.trim();

    if (trimmed.length < 3) {
      setLiveSuggestions([]);
      setShowDropdown(false);
      setSearchingLive(false);
      setSelectedIndex(-1);
      return;
    }

    // If currently loaded student already matches, don't reopen dropdown
    if (student && (student.regNo === trimmed || student.admissionNo === trimmed)) {
      setShowDropdown(false);
      return;
    }

    setSearchingLive(true);
    const timer = setTimeout(async () => {
      try {
        const res = await api.get(`/students/live-search?q=${encodeURIComponent(trimmed)}`);
        if (res.data.success) {
          setLiveSuggestions(res.data.results || []);
          setShowDropdown(true);
          setSelectedIndex(-1);
        }
      } catch (err) {
        console.error('Real-time student search error:', err);
      } finally {
        setSearchingLive(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [searchNumber, student]);

  // Handle outside click to close suggestions dropdown
  useEffect(() => {
    function handleClickOutside(event) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target) &&
        searchInputRef.current &&
        !searchInputRef.current.contains(event.target)
      ) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Keyboard navigation for dropdown
  const handleKeyDown = (e) => {
    if (!showDropdown || liveSuggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < liveSuggestions.length - 1 ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1));
    } else if (e.key === 'Enter') {
      if (selectedIndex >= 0 && selectedIndex < liveSuggestions.length) {
        e.preventDefault();
        selectStudent(liveSuggestions[selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
    }
  };

  // Form submission handler
  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError('');

    if (!student) {
      setSubmitError('Please search and verify your student details first.');
      return;
    }

    if (isRegistered && !canSubmitSelected) {
      setSubmitError(
        `You have already used all ${maxUnits} unit slot${maxUnits === 1 ? '' : 's'}. No further registrations are allowed.`
      );
      return;
    }

    if (!confirmed) {
      setSubmitError('Please check the confirmation box: "Complete and make sure all details before submit".');
      return;
    }

    // Adding units keeps the registered calendar quantity; only new registrations choose one
    const parsedQuantity = canAddUnits
      ? Number(insideReg.calendars_requested) || 100
      : parseInt(calendarQuantity, 10);
    if (!canAddUnits && (calendarQuantity === '' || isNaN(parsedQuantity) || parsedQuantity < minCalendars || !Number.isInteger(Number(calendarQuantity)))) {
      setSubmitError(minCalendars > 0
        ? 'Minimum 100 calendars required (e.g., 100 Nos or more).'
        : 'Please enter a calendar quantity of 0 or more.');
      return;
    }

    let payload = {
      student_id: student.id,
      registration_type: registrationType,
      calendars_requested: parsedQuantity,
      confirmed: true
    };

    if (registrationType === 'inside_kerala') {
      if (selectedUnits.length === 0) {
        setSubmitError('Please select District, Zone, Circle, and at least one Unit.');
        return;
      }
      if (selectedUnits.length > unitLimit) {
        setSubmitError(canAddUnits
          ? `You can add only ${unitLimit} more unit${unitLimit === 1 ? '' : 's'}.`
          : `You can select a maximum of ${unitLimit} unit${unitLimit === 1 ? '' : 's'}.`);
        return;
      }
      // District / Zone / Circle are derived from the units on the server
      payload.unit_ids = selectedUnits.map((u) => u.id);
    } else {
      if (
        !outsideForm.state_name ||
        !outsideForm.outside_district.trim() ||
        !outsideForm.outside_zone.trim() ||
        !outsideForm.outside_circle.trim() ||
        !outsideForm.outside_unit.trim()
      ) {
        setSubmitError('Please fill out all required location fields (State, District, Zone, Circle, Unit).');
        return;
      }
      payload.state_name = outsideForm.state_name;
      payload.outside_district = outsideForm.outside_district.trim();
      payload.outside_zone = outsideForm.outside_zone.trim();
      payload.outside_circle = outsideForm.outside_circle.trim();
      payload.outside_unit = outsideForm.outside_unit.trim();
    }

    setSubmitting(true);
    try {
      const res = await api.post('/registrations', payload);
      if (res.data.success) {
        const regWithPlaces = {
          ...res.data.registration,
          calendars_requested: res.data.registration.calendarsRequested || parsedQuantity,
          additional_calendars: res.data.registration.additionalCalendars || 0,
          calendars_allotted: res.data.registration.calendarsAllotted || parsedQuantity,
          unit_name: res.data.registration.unit_name || selectedUnits.map((u) => u.name).join(', '),
          state_name: res.data.registration.state_name || outsideForm.state_name,
          outside_district: res.data.registration.outside_district || outsideForm.outside_district,
          outside_zone: res.data.registration.outside_zone || outsideForm.outside_zone,
          outside_circle: res.data.registration.outside_circle || outsideForm.outside_circle,
          outside_unit: res.data.registration.outside_unit || outsideForm.outside_unit
        };

        navigate('/confirmation', {
          state: {
            registration: regWithPlaces,
            student
          }
        });
      }
    } catch (err) {
      if (err.response?.data?.registrationClosed) {
        // Admin closed registration while the form was open: switch to the closed page
        setSettings((prev) => ({ ...prev, registrationOpen: false, closedMessage: err.response.data.message }));
      } else if (err.response && err.response.data && err.response.data.message) {
        setSubmitError(err.response.data.message);
      } else {
        setSubmitError('Failed to submit registration. Please check your network and try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Toggle a unit; enforces the admin-configured maximum.
  // With a limit of 1, picking another unit replaces the current one (original behaviour).
  const toggleUnit = (unit) => {
    setUnitLimitNotice('');
    if (selectedUnits.some((u) => u.id === unit.id)) {
      setSelectedUnits(selectedUnits.filter((u) => u.id !== unit.id));
      return;
    }
    const entry = {
      id: unit.id,
      name: unit.name,
      districtName: districts.find((d) => d.id === selectedDistrictId)?.name || '',
      zoneName: zones.find((z) => z.id === selectedZoneId)?.name || '',
      circleName: circles.find((c) => c.id === selectedCircleId)?.name || ''
    };
    if (unitLimit === 1) {
      setSelectedUnits([entry]);
    } else if (selectedUnits.length >= unitLimit) {
      setUnitLimitNotice(`You can select a maximum of ${unitLimit} units. Remove one to choose another.`);
    } else {
      setSelectedUnits([...selectedUnits, entry]);
    }
  };

  if (loadingSettings) {
    return (
      <div className="flex items-center justify-center gap-2 p-12 text-sm bg-white border shadow-sm rounded-2xl border-slate-200 text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>Loading registration form...</span>
      </div>
    );
  }

  if (!settings.registrationOpen) {
    return <RegistrationClosed title={settings.closedTitle} message={settings.closedMessage} />;
  }

  return (
    <div className="mb-8 overflow-hidden bg-white border shadow-sm rounded-2xl border-slate-200">
      {/* Header Banner with Markaz Primary Blue (#0c629e) */}
      <div className="p-5 text-center text-white bg-markaz-700 md:p-6">
        <h2 className="text-xl font-bold tracking-tight md:text-2xl">
          Markaz Calender Distribution 2026
        </h2>
        <p className="mt-1 text-xs text-blue-100 md:text-sm">
          {registrationType === 'inside_kerala'
            ? 'Inside Kerala Student Registration Form'
            : 'Registration for Non-Kerala Students (Outside Kerala)'}
        </p>
      </div>

      <div className="p-5 space-y-8 md:p-8">
        {/* STEP 1: AUTOMATIC STUDENT LOOKUP */}
        <div className="p-5 space-y-4 border bg-slate-50 md:p-6 rounded-xl border-slate-200">
          <div className="flex flex-col justify-between gap-2 pb-3 border-b sm:flex-row sm:items-center border-slate-200">
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center w-6 h-6 text-xs font-bold text-white rounded-full bg-markaz-700">
                1
              </span>
              <h3 className="text-base font-bold text-slate-900">
                Student Identification / Search
              </h3>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-500">
                Enter Admission Number or Registration Number
              </span>

            </div>
          </div>

          <div className="relative">
            <form onSubmit={handleStudentSearch} className="flex flex-col gap-3 sm:flex-row">
              <div className="relative flex-1">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Search className="w-4 h-4" />
                </div>
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchNumber}
                  onChange={(e) => setSearchNumber(e.target.value)}
                  onFocus={() => {
                    if (searchNumber.trim().length >= 3 && liveSuggestions.length > 0) {
                      setShowDropdown(true);
                    }
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder="Enter RegNo / Admn No or Name (e.g. 1602)..."
                  className="w-full pl-10 pr-24 py-2.5 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-markaz-600 focus:border-transparent font-medium shadow-xs"
                  required
                  autoComplete="off"
                />

                {/* Right inside input controls: live spinner, clear X, real-time indicator */}
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center gap-1.5">
                  {searchingLive && (
                    <Loader2 className="w-4 h-4 text-cyan-600 animate-spin" />
                  )}
                  {searchNumber && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchNumber('');
                        setLiveSuggestions([]);
                        setShowDropdown(false);
                        setStudent(null);
                        setStudentRegistrations([]);
                        setSearchError('');
                        searchInputRef.current?.focus();
                      }}
                      className="p-1 transition rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                      title="Clear search"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {searchNumber.trim().length >= 3 ? (
                    <span className="hidden sm:inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold bg-cyan-50 text-cyan-700 border border-cyan-200">
                      Live
                    </span>
                  ) : searchNumber.trim().length > 0 ? (
                    <span className="hidden sm:inline-flex text-[10px] font-medium text-slate-400">
                      {3 - searchNumber.trim().length} more
                    </span>
                  ) : null}
                </div>
              </div>

              <button
                type="submit"
                disabled={searching}
                className="inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg bg-markaz-700 hover:bg-markaz-800 disabled:bg-slate-400 text-white text-sm font-semibold shadow-sm transition active:scale-95 shrink-0"
              >
                {searching ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Searching...</span>
                  </>
                ) : (
                  <>
                    <Search className="w-4 h-4" />
                    <span>Search Student</span>
                  </>
                )}
              </button>
            </form>

            {/* Real-time live suggestions dropdown */}
            {showDropdown && searchNumber.trim().length >= 3 && (
              <div
                ref={dropdownRef}
                className="absolute top-full left-0 right-0 sm:right-36 mt-1.5 z-50 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden divide-y divide-slate-100 max-h-80 overflow-y-auto animate-in fade-in slide-in-from-top-1 duration-150"
              >
                <div className="px-3.5 py-2 bg-slate-50 flex items-center justify-between text-xs font-semibold text-slate-500">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
                    <span> matches ({liveSuggestions.length})</span>
                  </span>
                  <span className="text-[11px] text-slate-400">
                    Use ↑↓ arrows or click to select
                  </span>
                </div>

                {liveSuggestions.length > 0 ? (
                  liveSuggestions.map((item, idx) => {
                    const isSelected = selectedIndex === idx;
                    const isExactMatch =
                      item.regNo?.toLowerCase() === searchNumber.trim().toLowerCase() ||
                      item.admissionNo?.toLowerCase() === searchNumber.trim().toLowerCase();

                    return (
                      <div
                        key={item.id}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          selectStudent(item);
                        }}
                        onClick={() => selectStudent(item)}
                        className={`px-3.5 py-2.5 flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-markaz-50 border-l-4 border-markaz-600'
                            : isExactMatch
                            ? 'bg-cyan-50/60 hover:bg-cyan-100/60 border-l-4 border-cyan-500'
                            : 'hover:bg-slate-50 border-l-4 border-transparent'
                        }`}
                      >
                        <div className="flex items-center min-w-0 gap-3">
                          <div
                            className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
                              isExactMatch
                                ? 'bg-cyan-600 text-white shadow-xs'
                                : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            <User className="w-4 h-4" />
                          </div>

                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold truncate text-slate-900">
                                {item.candidateName}
                              </span>
                              {isExactMatch && (
                                <span className="px-1.5 py-0.2 rounded text-[10px] font-black uppercase tracking-wider bg-cyan-500 text-white">
                                  Exact Match
                                </span>
                              )}
                            </div>

                            <div className="flex flex-wrap items-center gap-1.5 mt-0.5 text-xs text-slate-500">
                              <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-mono font-bold text-[11px]">
                                Reg: {item.regNo}
                              </span>
                              {item.admissionNo && item.admissionNo !== item.regNo && (
                                <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-mono font-bold text-[11px]">
                                  Admn: {item.admissionNo}
                                </span>
                              )}
                              {item.class && (
                                <span className="text-slate-400">• Class {item.class}</span>
                              )}
                              {item.place && (
                                <span className="text-slate-400 truncate max-w-[140px]">• {item.place}</span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Status Tag */}
                        {/* Status + unit slot hint (older API responses fall back to the plain badge) */}
                        <div className="flex flex-col items-end gap-0.5 text-right shrink-0">
                          {(() => {
                            const slotsLeft = item.unitSlotsLeft;
                            const hasSlotInfo = typeof slotsLeft === 'number';
                            const slotText = (n) => `${n} unit slot${n === 1 ? '' : 's'} left`;

                            if (!item.isAlreadyRegistered) {
                              return (
                                <>
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                                    <Check className="w-3 h-3 text-emerald-600" />
                                    <span>Ready</span>
                                  </span>
                                  {hasSlotInfo && item.maxUnits > 1 && (
                                    <span className="text-[10px] font-semibold text-emerald-700">
                                      Up to {item.maxUnits} units
                                    </span>
                                  )}
                                </>
                              );
                            }

                            if (hasSlotInfo && slotsLeft > 0) {
                              // Registered, can still add units
                              return (
                                <>
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-sky-50 text-sky-800 border border-sky-200">
                                    <Plus className="w-3 h-3 text-sky-600" />
                                    <span>{slotText(slotsLeft)}</span>
                                  </span>
                                  <span className="text-[10px] font-semibold text-slate-500">
                                    Registered · {item.unitsHeld} of {item.maxUnits} units
                                  </span>
                                </>
                              );
                            }

                            return (
                              <>
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                                  <AlertCircle className="w-3 h-3 text-amber-600" />
                                  <span>Already Registered</span>
                                </span>
                                {hasSlotInfo && (
                                  <span className="text-[10px] font-semibold text-amber-700">
                                    {`No slots left · ${item.unitsHeld} of ${item.maxUnits} units used`}
                                  </span>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="p-4 space-y-1 text-xs text-center text-slate-500">
                    <p className="font-semibold text-slate-700">No matching student found</p>
                    <p className="text-[11px] text-slate-400">
                      Check your Admission Number, Registration Number, or name spelling.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Search Error Message */}
          {searchError && (
            <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs md:text-sm flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{searchError}</span>
            </div>
          )}

          {/* Student Information Card (Populated after successful lookup) */}
          {student && (
            <div className="p-4 mt-4 space-y-4 duration-300 bg-white border-2 shadow-sm rounded-xl border-markaz-600 md:p-5 animate-in fade-in">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-lg bg-markaz-50 text-markaz-700">
                    <User className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-base font-bold text-slate-900">
                      {student.candidateName}
                    </h4>
                    <span className="text-xs font-medium text-slate-500">
                      Verified Student Record
                    </span>
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Verified</span>
                </span>
              </div>

              {/* Student Fields Grid */}
              <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4 md:text-sm">
                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                  <span className="text-slate-500 block text-[11px] uppercase tracking-wider font-semibold">
                    REG NO
                  </span>
                  <span className="font-bold text-slate-900 text-sm mt-0.5 block">
                    {student.regNo}
                  </span>
                </div>

                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                  <span className="text-slate-500 block text-[11px] uppercase tracking-wider font-semibold">
                    ADMISSION NO
                  </span>
                  <span className="font-bold text-slate-900 text-sm mt-0.5 block">
                    {student.admissionNo || student.regNo}
                  </span>
                </div>

                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                  <span className="text-slate-500 block text-[11px] uppercase tracking-wider font-semibold">
                    CLASS
                  </span>
                  <span className="font-bold text-slate-900 text-sm mt-0.5 block">
                    {student.class}
                  </span>
                </div>

                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                  <span className="text-slate-500 block text-[11px] uppercase tracking-wider font-semibold">
                    HN (HAJER NO)
                  </span>
                  <span className="font-bold text-slate-900 text-sm mt-0.5 block">
                    {student.hn || 'N/A'}
                  </span>
                </div>

                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                  <span className="text-slate-500 block text-[11px] uppercase tracking-wider font-semibold">
                    PLACE
                  </span>
                  <span className="font-bold text-slate-900 text-sm mt-0.5 block">
                    {student.place || 'N/A'}
                  </span>
                </div>

                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                  <span className="text-slate-500 block text-[11px] uppercase tracking-wider font-semibold">
                    MOBILE
                  </span>
                  <span className="font-bold text-slate-900 text-sm mt-0.5 block">
                    {student.mobile || 'N/A'}
                  </span>
                </div>

                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                  <span className="text-slate-500 block text-[11px] uppercase tracking-wider font-semibold">
                    CALENDARS ALLOTTED
                  </span>
                  {isRegistered ? (
                    // Registered: total stored allotment across the student's registrations
                    // (each includes any admin-granted extra)
                    <span className="font-bold text-markaz-700 text-sm mt-0.5 block">
                      {registeredCalendarTotal}
                      {studentRegistrations.length > 1 ? (
                        <span className="block text-[11px] font-medium text-slate-500">
                          {calendarBreakdown}
                        </span>
                      ) : studentRegistrations[0].additional_calendars > 0 && (
                        <span className="ml-1 text-[11px] font-semibold text-emerald-700">
                          (+{studentRegistrations[0].additional_calendars} addl.)
                        </span>
                      )}
                    </span>
                  ) : (
                    // Not registered yet: mirror the quantity selected below
                    <span className={`font-bold text-sm mt-0.5 block ${quantityError ? 'text-red-600' : 'text-markaz-700'}`}>
                      {parseInt(calendarQuantity, 10) || 0}
                      <span className="ml-1 text-[11px] font-medium text-slate-500">Nos</span>
                    </span>
                  )}
                </div>
              </div>

              {/* Existing Registrations Panel
                  Lists the student's registrations (Kerala and/or Outside Kerala) and what they can still do:
                  units used + slots left are shared (Kerala units + Outside Kerala counts as 1). */}
              {isRegistered && (() => {
                const hasSlots = slotsLeft > 0;
                const tone = hasSlots
                  ? {
                      box: 'bg-emerald-50 border-emerald-300',
                      title: 'text-emerald-900',
                      muted: 'text-emerald-800',
                      icon: 'text-emerald-600',
                      card: 'bg-white border-emerald-200',
                      chip: 'bg-emerald-50 border-emerald-200 text-emerald-950'
                    }
                  : {
                      box: 'bg-amber-50 border-amber-300',
                      title: 'text-amber-900',
                      muted: 'text-amber-800',
                      icon: 'text-amber-600',
                      card: 'bg-white border-amber-200',
                      chip: 'bg-amber-50 border-amber-200 text-amber-950'
                    };

                const unitsOf = (reg) =>
                  Array.isArray(reg.units) && reg.units.length > 0
                    ? reg.units
                    : (reg.unit_name || '')
                        .split(',')
                        .map((name) => name.trim())
                        .filter(Boolean)
                        .map((name) => ({ unit_name: name }));

                return (
                  <div className={`p-4 md:p-5 space-y-3 border rounded-xl ${tone.box}`}>
                    {/* Heading + slot usage */}
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <div className={`flex items-center gap-2 text-sm font-bold ${tone.title}`}>
                        {hasSlots
                          ? <CheckCircle2 className={`w-4 h-4 ${tone.icon}`} />
                          : <AlertCircle className={`w-4 h-4 ${tone.icon}`} />}
                        <span>
                          {hasSlots
                            ? `Already Registered: ${slotsLeft} Unit Slot${slotsLeft === 1 ? '' : 's'} Left`
                            : 'Already Registered: All Unit Slots Used'}
                        </span>
                      </div>
                      <span className={`text-[11px] font-semibold ${tone.muted}`}>
                        {heldUnits} of {maxUnits} unit slot{maxUnits === 1 ? '' : 's'} used
                      </span>
                    </div>

                    {/* One card per registration */}
                    <div className="grid gap-2">
                      {studentRegistrations.map((reg) => {
                        const isInside = reg.registration_type === 'inside_kerala';
                        const regUnits = isInside ? unitsOf(reg) : [];
                        return (
                          <div key={reg.id} className={`p-3 space-y-2 border rounded-lg ${tone.card}`}>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-2 text-xs">
                                <span className={`px-2 py-0.5 rounded-md font-bold ${isInside ? 'bg-blue-100 text-markaz-800' : 'bg-emerald-100 text-emerald-800'}`}>
                                  {isInside ? 'Inside Kerala' : 'Outside Kerala'}
                                </span>
                                <span className="font-bold text-slate-800">{reg.registration_code}</span>
                                <span className="text-slate-500">
                                  · {new Date(reg.submitted_at).toLocaleDateString()}
                                  · {reg.calendars_allotted ?? reg.calendars_requested ?? 100} calendars
                                  {isInside && ` · ${regUnits.length} unit${regUnits.length === 1 ? '' : 's'}`}
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => navigate('/confirmation', { state: { registration: reg, student } })}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 transition"
                              >
                                <Printer className="w-3 h-3" />
                                <span>View & Print Slip</span>
                              </button>
                            </div>

                            {isInside ? (
                              <div className="flex flex-wrap gap-2">
                                {regUnits.map((u) => (
                                  <span key={u.id || u.unit_name} className={`inline-flex items-start gap-1.5 px-2.5 py-1.5 rounded-md border text-xs ${tone.chip}`}>
                                    <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                                    <span>
                                      <span className="block font-bold">{u.unit_name}</span>
                                      {u.circle_name && (
                                        <span className="block text-[11px] font-medium text-slate-500">
                                          {u.district_name} → {u.zone_name} → {u.circle_name}
                                        </span>
                                      )}
                                    </span>
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <p className="text-xs text-slate-700">
                                <Globe className="inline w-3.5 h-3.5 mr-1 -mt-0.5 text-emerald-600" />
                                <strong>{reg.state_name}</strong>: {reg.outside_district} → {reg.outside_zone} → {reg.outside_circle} → <strong>{reg.outside_unit}</strong>
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* What the student can still do */}
                    {hasSlots ? (
                      <div className="p-3 space-y-2 bg-white border rounded-lg border-emerald-200">
                        <p className="text-xs font-semibold text-slate-800">You can still:</p>
                        <ul className="space-y-1 text-xs list-disc list-inside text-slate-700">
                          <li>
                            {insideReg
                              ? <>Add up to <strong>{slotsLeft} more Kerala unit{slotsLeft === 1 ? '' : 's'}</strong> to {insideReg.registration_code} (calendar quantity stays the same)</>
                              : <>Register <strong>Inside Kerala</strong> with up to {slotsLeft} unit{slotsLeft === 1 ? '' : 's'}</>}
                          </li>
                          {canRegisterOutside && (
                            <li>
                              Register {outsideRegs.length > 0 ? 'another ' : ''}<strong>Outside Kerala</strong> unit (uses 1 slot, with its own calendar quantity)
                            </li>
                          )}
                        </ul>
                        <p className="text-xs font-medium text-slate-600">
                          നിങ്ങൾ ഇതിനകം രജിസ്റ്റർ ചെയ്തിട്ടുണ്ട്. ഇനി {slotsLeft} യൂണിറ്റ് കൂടി രജിസ്റ്റർ ചെയ്യാം.
                        </p>
                        <div className="flex flex-wrap gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => startRegistration('inside_kerala')}
                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-markaz-700 hover:bg-markaz-800 text-white rounded-lg text-xs font-semibold shadow-sm transition active:scale-95"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>{insideReg ? 'Add Kerala Units' : 'Register Inside Kerala'}</span>
                          </button>
                          {canRegisterOutside && (
                            <button
                              type="button"
                              onClick={() => startRegistration('outside_kerala')}
                              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-sm transition active:scale-95"
                            >
                              <Globe className="w-3.5 h-3.5" />
                              <span>{outsideRegs.length > 0 ? 'Register Another Outside Kerala' : 'Register Outside Kerala'}</span>
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <p className={`text-[11px] font-medium ${tone.muted}`}>
                        You have used all {maxUnits} unit slot{maxUnits === 1 ? '' : 's'} allowed per student, so no further registrations can be made.
                        If you need changes, please contact the Markaz Administration.
                      </p>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
        </div>

        {/* Steps 2 and 3 are hidden once a registered student has used every unit slot:
            there is nothing left for them to submit */}
        {!(isRegistered && slotsLeft === 0) && (
        <>
        {/* STEP 2: REGISTRATION CATEGORY SELECTOR */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-200">
            <span className="flex items-center justify-center w-6 h-6 text-xs font-bold text-white rounded-full bg-markaz-700">
              2
            </span>
            <h3 className="text-base font-bold text-slate-900">
              Select Registration Category
            </h3>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setRegistrationType('inside_kerala')}
              disabled={isRegistered && !canRegisterInside}
              className={`p-4 rounded-xl border text-left transition flex items-start gap-3 disabled:opacity-50 disabled:cursor-not-allowed ${
                registrationType === 'inside_kerala'
                  ? 'border-markaz-700 bg-blue-50/70 ring-2 ring-markaz-600 ring-offset-1'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <div
                className={`p-2.5 rounded-lg shrink-0 ${
                  registrationType === 'inside_kerala'
                    ? 'bg-markaz-700 text-white'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                <MapPin className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900">
                  Inside Kerala Registration
                </h4>
                {isRegistered && (
                  <p className="mt-1 text-xs text-slate-600">
                    {!canRegisterInside
                      ? 'No unit slots left'
                      : insideReg
                      ? `Add up to ${slotsLeft} more unit${slotsLeft === 1 ? '' : 's'} to ${insideReg.registration_code}`
                      : `New registration, up to ${slotsLeft} unit${slotsLeft === 1 ? '' : 's'}`}
                  </p>
                )}
              </div>
            </button>

            <button
              type="button"
              onClick={() => setRegistrationType('outside_kerala')}
              disabled={isRegistered && !canRegisterOutside}
              className={`p-4 rounded-xl border text-left transition flex items-start gap-3 disabled:opacity-50 disabled:cursor-not-allowed ${
                registrationType === 'outside_kerala'
                  ? 'border-emerald-600 bg-emerald-50/70 ring-2 ring-emerald-500 ring-offset-1'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <div
                className={`p-2.5 rounded-lg shrink-0 ${
                  registrationType === 'outside_kerala'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                <Globe className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900">
                  Outside Kerala Registration
                </h4>
                {isRegistered && (
                  <p className="mt-1 text-xs text-slate-600">
                    {!canRegisterOutside
                      ? 'No unit slots left'
                      : outsideRegs.length > 0
                      ? `${outsideRegs.length} registered · add another (uses 1 slot, own calendar quantity)`
                      : 'Uses 1 unit slot, with its own calendar quantity'}
                  </p>
                )}
              </div>
            </button>
          </div>
        </div>

        {/* STEP 3: REGISTRATION FORM */}
        <form onSubmit={handleSubmit} className="space-y-6">
          <div id="registration-step-3" className="flex items-center gap-2 pb-2 border-b border-slate-200 scroll-mt-4">
            <span className="flex items-center justify-center w-6 h-6 text-xs font-bold text-white rounded-full bg-markaz-700">
              3
            </span>
            <h3 className="text-base font-bold text-slate-900">
              {registrationType === 'inside_kerala'
                ? 'Inside Kerala Location Hierarchy'
                : 'Outside Kerala Location Details'}
            </h3>
          </div>

          {/* ========================================================
              CATEGORY A: INSIDE KERALA (CHECKBOX HIERARCHY WORKFLOW)
              Design tokens:
              - District background: #CCE1F2
              - Zone background:     #CCE1F2
              - Circle background:   #CCE1F2
              - Unit background:     #FBF7D5
             ======================================================== */}
          {registrationType === 'inside_kerala' ? (
            <div className="space-y-6">
              {/* Row 1: District, Zone, Circle as Cascading Dropdowns */}
              <div
                className="p-5 space-y-4 border border-blue-300 shadow-sm rounded-2xl"
                style={{ backgroundColor: '#CCE1F2' }}
              >
                <div className="flex flex-col justify-between gap-1 pb-2 border-b sm:flex-row sm:items-center border-blue-200/80">
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-markaz-700" />
                    <span className="text-sm font-bold text-slate-900">
                      Select District, Zone & Circle
                    </span>
                  </div>
                  <span className="text-xs font-medium text-blue-900">
                    Cascade selection: District → Zone → Circle
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  {/* 1. SELECT DISTRICT DROPDOWN */}
                  <div className="space-y-1.5">
                    <label className="flex items-center justify-between text-xs font-bold text-slate-900">
                      <span className="flex items-center gap-1">
                        Select District <span className="text-red-600">*</span>
                      </span>
                      {selectedDistrictId && (
                        <span className="text-[10px] font-bold text-white bg-markaz-700 px-2 py-0.5 rounded-full">
                          Selected
                        </span>
                      )}
                    </label>
                    <select
                      value={selectedDistrictId || ''}
                      onChange={(e) => {
                        const val = e.target.value ? parseInt(e.target.value, 10) : null;
                        setSelectedDistrictId(val);
                      }}
                      className="w-full px-3 py-2.5 bg-white border border-blue-300 rounded-xl text-slate-900 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-markaz-600 shadow-xs cursor-pointer"
                    >
                      <option value="">-- Choose District --</option>
                      {districts.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* 2. SELECT ZONE DROPDOWN */}
                  <div className="space-y-1.5">
                    <label className="flex items-center justify-between text-xs font-bold text-slate-900">
                      <span className="flex items-center gap-1">
                        Select Zone <span className="text-red-600">*</span>
                      </span>
                      {selectedZoneId && (
                        <span className="text-[10px] font-bold text-white bg-markaz-700 px-2 py-0.5 rounded-full">
                          Selected
                        </span>
                      )}
                    </label>
                    <select
                      disabled={!selectedDistrictId || loadingZones}
                      value={selectedZoneId || ''}
                      onChange={(e) => {
                        const val = e.target.value ? parseInt(e.target.value, 10) : null;
                        setSelectedZoneId(val);
                      }}
                      className="w-full px-3 py-2.5 bg-white border border-blue-300 rounded-xl text-slate-900 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-markaz-600 shadow-xs disabled:opacity-50 disabled:bg-slate-100 cursor-pointer"
                    >
                      <option value="">
                        {!selectedDistrictId
                          ? '-- Select District First --'
                          : loadingZones
                          ? 'Loading zones...'
                          : zones.length === 0
                          ? 'No zones available'
                          : '-- Choose Zone --'}
                      </option>
                      {zones.map((z) => (
                        <option key={z.id} value={z.id}>
                          {z.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* 3. SELECT CIRCLE DROPDOWN */}
                  <div className="space-y-1.5">
                    <label className="flex items-center justify-between text-xs font-bold text-slate-900">
                      <span className="flex items-center gap-1">
                        Select Circle <span className="text-red-600">*</span>
                      </span>
                      {selectedCircleId && (
                        <span className="text-[10px] font-bold text-white bg-markaz-700 px-2 py-0.5 rounded-full">
                          Selected
                        </span>
                      )}
                    </label>
                    <select
                      disabled={!selectedZoneId || loadingCircles}
                      value={selectedCircleId || ''}
                      onChange={(e) => {
                        const val = e.target.value ? parseInt(e.target.value, 10) : null;
                        setSelectedCircleId(val);
                      }}
                      className="w-full px-3 py-2.5 bg-white border border-blue-300 rounded-xl text-slate-900 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-markaz-600 shadow-xs disabled:opacity-50 disabled:bg-slate-100 cursor-pointer"
                    >
                      <option value="">
                        {!selectedZoneId
                          ? '-- Select Zone First --'
                          : loadingCircles
                          ? 'Loading circles...'
                          : circles.length === 0
                          ? 'No circles available'
                          : '-- Choose Circle --'}
                      </option>
                      {circles.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Row 2: SELECT UNIT (Dedicated row with background #FBF7D5) */}
              <div
                id="unit-selection"
                className="p-5 space-y-3 border shadow-sm rounded-xl border-amber-300"
                style={{ backgroundColor: '#FBF7D5' }}
              >
                <div className="flex flex-col justify-between gap-1 pb-2 border-b sm:flex-row sm:items-center border-amber-200">
                  <div className="space-y-0.5">
                    <label className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                      <span>
                        {canAddUnits
                          ? (unitLimit > 1 ? 'Select Additional Units' : 'Select Additional Unit')
                          : (unitLimit > 1 ? 'Select Units' : 'Select Unit')}
                      </span>
                      <span className="text-red-600">*</span>
                    </label>
                    {/* Malayalam instruction; reflects the unit slots left (original portal wording when the limit is 1) */}
                    <p className="text-xs font-medium text-amber-900">
                      {heldUnits > 0
                        ? `നിങ്ങൾ ഇതിനകം ${heldUnits} യൂണിറ്റ് സെലക്ട് ചെയ്തിട്ടുണ്ട്. ഇനി ${unitLimit} യൂണിറ്റ് കൂടി സെലക്ട് ചെയ്യാം (പരമാവധി ${maxUnits}). ഒരു യൂണിറ്റ് ഒരു വിദ്യാർത്ഥിക്ക് മാത്രമേ ലഭിക്കുകയുള്ളൂ. മറ്റുള്ളവർ സെലക്ട് ചെയ്ത യൂണിറ്റുകൾ ഇവിടെ കാണിക്കുകയില്ല*`
                        : maxUnits > 1
                        ? `ഒരു വിദ്യാർത്ഥിക്ക് പരമാവധി ${maxUnits} യൂണിറ്റുകൾ വരെ സെലക്ട് ചെയ്യാം. ഒരു യൂണിറ്റ് ഒരു വിദ്യാർത്ഥിക്ക് മാത്രമേ ലഭിക്കുകയുള്ളൂ. മറ്റുള്ളവർ സെലക്ട് ചെയ്ത യൂണിറ്റുകൾ ഇവിടെ കാണിക്കുകയില്ല*`
                        : 'ഒരു യൂണിറ്റ് ഒരു വിദ്യാർത്ഥിക്ക് മാത്രമേ സെലക്ട് ചെയ്യാൻ സാധിക്കുകയുള്ളൂ. സെലക്ട് ചെയ്ത യൂണിറ്റ് ഇവിടെ കാണിക്കുകയില്ല*'}
                    </p>
                    {heldUnits > 0 ? (
                      <p className="text-xs font-bold text-slate-800">
                        You have used {heldUnits} of {maxUnits} unit slots. You can select up to {unitLimit} more Kerala unit{unitLimit === 1 ? '' : 's'}, from one or more circles.
                      </p>
                    ) : maxUnits > 1 && (
                      <p className="text-xs font-bold text-slate-800">
                        You can select up to {maxUnits} units, from one or more circles.
                      </p>
                    )}
                  </div>
                  {selectedUnits.length > 0 && (
                    <span className="self-start px-3 py-1 text-xs font-bold rounded-full text-amber-900 bg-amber-200 sm:self-auto whitespace-nowrap">
                      {unitLimit > 1
                        ? `${selectedUnits.length} of ${unitLimit} Units Selected`
                        : '1 Unit Selected'}
                    </span>
                  )}
                </div>

                {/* Selected units (may span several circles); removable chips */}
                {unitLimit > 1 && selectedUnits.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {selectedUnits.map((u) => (
                      <span
                        key={u.id}
                        className="inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-lg bg-amber-600 text-white text-xs font-bold shadow-sm"
                      >
                        <span>{u.name}</span>
                        {u.circleName && (
                          <span className="font-medium text-amber-100">({u.circleName})</span>
                        )}
                        <button
                          type="button"
                          onClick={() => toggleUnit(u)}
                          title={`Remove ${u.name}`}
                          className="p-0.5 rounded hover:bg-amber-700 transition"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {unitLimitNotice && (
                  <div className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-red-700 border border-red-200 rounded-lg bg-red-50">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{unitLimitNotice}</span>
                  </div>
                )}

                {/* Dropdown or quick search for units */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block mb-1 text-xs font-bold text-slate-800">
                     Filter Available Units
                    </label>
                    <input
                      type="text"
                      disabled={!selectedCircleId}
                      value={unitFilter}
                      onChange={(e) => setUnitFilter(e.target.value)}
                      placeholder={selectedCircleId ? 'Filter available units...' : 'Select a circle first'}
                      className="w-full px-3 py-2 text-xs font-medium bg-white border rounded-lg border-amber-300 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-amber-500 disabled:opacity-50"
                    />
                  </div>
                </div>

                {/* Available Units Grid / Checkbox list */}
                <div className="p-2 overflow-y-auto border max-h-60 custom-scrollbar bg-white/60 rounded-xl border-amber-200">
                  {!selectedCircleId ? (
                    <div className="p-6 text-xs text-center text-slate-600">
                      Please select a Circle above to view currently available units.
                    </div>
                  ) : loadingUnits ? (
                    <div className="flex items-center justify-center p-6 text-xs text-center text-slate-600">
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading available units from database...
                    </div>
                  ) : units.length === 0 ? (
                    <div className="p-6 text-xs text-center text-amber-900">
                      No units available in this circle. All units may already have been confirmed by other students.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
                      {units
                        .filter((u) => u.name.toLowerCase().includes(unitFilter.toLowerCase()))
                        .map((u) => {
                          const isChecked = selectedUnits.some((s) => s.id === u.id);
                          // At the limit (when more than one is allowed), other units are dimmed
                          const atLimit = unitLimit > 1 && !isChecked && selectedUnits.length >= unitLimit;
                          return (
                            <label
                              key={u.id}
                              className={`flex items-center gap-2.5 p-2 rounded-lg cursor-pointer transition text-xs font-bold border ${
                                isChecked
                                  ? 'bg-amber-600 border-amber-700 text-white shadow-sm'
                                  : atLimit
                                  ? 'bg-white/60 border-amber-100 text-slate-400'
                                  : 'bg-white border-amber-200 hover:bg-amber-100/50 text-slate-900'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => toggleUnit(u)}
                                className="w-4 h-4 rounded cursor-pointer text-amber-600 focus:ring-0"
                              />
                              <span className="truncate">{u.name}</span>
                            </label>
                          );
                        })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* ========================================================
               CATEGORY B: OUTSIDE KERALA (TEXT INPUT ENTRY WORKFLOW)
               Exact replica of https://fr.markaz.in/reg-form-non-kerala-jamia-students.php
               Does NOT use checkbox hierarchy. Uses manual text inputs.
               ======================================================== */
            <div className="p-5 space-y-4 border bg-slate-50 md:p-6 rounded-xl border-slate-200">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* State Dropdown */}
                <div className="space-y-1.5">
                  <label className="flex items-center gap-1 text-xs font-bold text-slate-800">
                    <span>State</span>
                    <span className="text-red-600">*</span>
                  </label>
                  <select
                    value={outsideForm.state_name}
                    onChange={(e) => setOutsideForm({ ...outsideForm, state_name: e.target.value })}
                    className="w-full px-3 py-2 text-sm font-medium bg-white border rounded-lg border-slate-300 text-slate-900 focus:outline-none focus:ring-2 focus:ring-markaz-600"
                    required
                  >
                    {INDIAN_STATES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>

                {/* District Text Input */}
                <div className="space-y-1.5">
                  <label className="flex items-center gap-1 text-xs font-bold text-slate-800">
                    <span>District</span>
                    <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    value={outsideForm.outside_district}
                    onChange={(e) => setOutsideForm({ ...outsideForm, outside_district: e.target.value })}
                    placeholder="Enter district name"
                    className="w-full px-3 py-2 text-sm font-medium bg-white border rounded-lg border-slate-300 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-markaz-600"
                    required
                  />
                </div>

                {/* Zone Text Input */}
                <div className="space-y-1.5">
                  <label className="flex items-center gap-1 text-xs font-bold text-slate-800">
                    <span>Zone</span>
                    <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    value={outsideForm.outside_zone}
                    onChange={(e) => setOutsideForm({ ...outsideForm, outside_zone: e.target.value })}
                    placeholder="Enter zone name"
                    className="w-full px-3 py-2 text-sm font-medium bg-white border rounded-lg border-slate-300 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-markaz-600"
                    required
                  />
                </div>

                {/* Circle Text Input */}
                <div className="space-y-1.5">
                  <label className="flex items-center gap-1 text-xs font-bold text-slate-800">
                    <span>Circle</span>
                    <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    value={outsideForm.outside_circle}
                    onChange={(e) => setOutsideForm({ ...outsideForm, outside_circle: e.target.value })}
                    placeholder="Enter circle name"
                    className="w-full px-3 py-2 text-sm font-medium bg-white border rounded-lg border-slate-300 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-markaz-600"
                    required
                  />
                </div>

                {/* Unit Text Input */}
                <div className="space-y-1.5 sm:col-span-2">
                  <label className="flex items-center gap-1 text-xs font-bold text-slate-800">
                    <span>Unit</span>
                    <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    value={outsideForm.outside_unit}
                    onChange={(e) => setOutsideForm({ ...outsideForm, outside_unit: e.target.value })}
                    placeholder="Enter unit name"
                    className="w-full px-3 py-2 text-sm font-medium bg-white border rounded-lg border-slate-300 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-markaz-600"
                    required
                  />
                </div>
              </div>
            </div>
          )}

          {/* Calendars Wanted Notice (Student Selectable Quota) */}
          {canAddUnits ? (
            // Adding units: quantity was fixed at registration (admins can change it)
            <div className="flex flex-col justify-between gap-1 p-4 border bg-slate-50 rounded-xl border-slate-200 sm:flex-row sm:items-center">
              <div className="space-y-0.5">
                <span className="block text-xs font-bold text-markaz-700">Calendars Allotted (Total)</span>
                <p className="text-xs font-medium text-slate-600">
                  {outsideRegs.length > 0 ? `${calendarBreakdown}. ` : ''}
                  Unchanged when adding units. Contact the Markaz administration to change it.
                </p>
              </div>
              <span className="text-base font-bold text-slate-900">
                {registeredCalendarTotal} Nos
              </span>
            </div>
          ) : (
          <div className="flex flex-col justify-between gap-3 p-4 border bg-slate-50 rounded-xl border-slate-200 sm:flex-row sm:items-center">
            <div className="space-y-0.5">
              <label htmlFor="calendarQuantityInput" className="block text-xs font-bold cursor-pointer text-markaz-700">
                Calendars Required / Quota <span className="text-red-500">*</span>
              </label>
              <p className="text-xs font-medium text-slate-600">
                {isRegistered
                  ? `നിങ്ങൾക്ക് ഇതിനകം ${registeredCalendarTotal} കലണ്ടർ ഉണ്ട്. ഈ രജിസ്ട്രേഷന് ആവശ്യമായ കലണ്ടർ മാത്രം ചേർക്കുക (0 അല്ലെങ്കിൽ കൂടുതൽ).`
                  : 'ഓരോ വിദ്യാർത്ഥിക്കും 100 കലണ്ടർ ലഭിക്കും.'}
              </p>
              {isRegistered && (
                <p className="text-[11px] font-medium text-slate-500">
                  You already have {registeredCalendarTotal} calendars. Enter only the extra calendars needed for this registration (0 or more).
                </p>
              )}
            </div>
            <div className="flex flex-col w-full gap-1 sm:items-end sm:w-auto">
              <div className="flex items-center gap-2">
                <div className="inline-flex items-center overflow-hidden bg-white border rounded-lg border-slate-300 shadow-2xs focus-within:ring-2 focus-within:ring-markaz-600 focus-within:border-markaz-600">
                  <button
                    type="button"
                    disabled={toQuantity(calendarQuantity) <= minCalendars}
                    onClick={() => {
                      const next = Math.max(minCalendars, toQuantity(calendarQuantity) - 10);
                      setCalendarQuantity(next);
                      setQuantityError('');
                    }}
                    title={`Decrease by 10 (minimum ${minCalendars})`}
                    className="px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40 disabled:cursor-not-allowed border-r border-slate-200 font-bold transition select-none"
                  >
                    -10
                  </button>
                  <button
                    type="button"
                    disabled={toQuantity(calendarQuantity) <= minCalendars}
                    onClick={() => {
                      const next = Math.max(minCalendars, toQuantity(calendarQuantity) - 1);
                      setCalendarQuantity(next);
                      setQuantityError('');
                    }}
                    title={`Decrease by 1 (minimum ${minCalendars})`}
                    className="px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40 disabled:cursor-not-allowed border-r border-slate-200 font-bold transition select-none"
                  >
                    -
                  </button>
                  <input
                    id="calendarQuantityInput"
                    type="number"
                    min={minCalendars}
                    step="1"
                    value={calendarQuantity}
                    onChange={(e) => {
                      const val = e.target.value;
                      setCalendarQuantity(val);
                      const num = parseInt(val, 10);
                      if (val === '' || isNaN(num) || num < minCalendars || !Number.isInteger(Number(val))) {
                        setQuantityError(minCalendars > 0 ? 'Minimum 100 calendars required' : 'Enter 0 or more');
                      } else {
                        setQuantityError('');
                      }
                    }}
                    className={`w-20 px-2 py-1.5 text-center font-bold text-base bg-white text-slate-900 focus:outline-none ${
                      quantityError ? 'text-red-700 bg-red-50/50' : ''
                    }`}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setCalendarQuantity(toQuantity(calendarQuantity) + 1);
                      setQuantityError('');
                    }}
                    title="Increase by 1"
                    className="px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-100 hover:text-slate-900 border-l border-slate-200 font-bold transition select-none"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCalendarQuantity(toQuantity(calendarQuantity) + 10);
                      setQuantityError('');
                    }}
                    title="Increase by 10"
                    className="px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-100 hover:text-slate-900 border-l border-slate-200 font-bold transition select-none"
                  >
                    +10
                  </button>
                </div>
                <span className="text-xs font-semibold text-slate-500"></span>
              </div>
              {quantityError && (
                <span className="text-[11px] font-semibold text-red-600">{quantityError}</span>
              )}
              {/* Registered student starting a second registration: show the combined total */}
              {isRegistered && !quantityError && (
                <span className="text-[11px] font-semibold text-slate-600">
                  Total with existing {registeredCalendarTotal}: {registeredCalendarTotal + (parseInt(calendarQuantity, 10) || 0)} Nos
                </span>
              )}
            </div>
          </div>
          )}

          {/* Selected Place & Location Confirmation Summary */}
          {(registrationType === 'inside_kerala' ? selectedUnits.length > 0 : (outsideForm.outside_unit || outsideForm.outside_district)) && (
            <div className="p-4 space-y-2 text-xs border border-blue-200 rounded-xl bg-blue-50/70">
              <span className="text-[11px] font-bold uppercase tracking-wider text-markaz-800 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-markaz-700" />
                <span>Selected Place & Location Summary for Confirmation</span>
              </span>
              {registrationType === 'inside_kerala' ? (
                <div className="space-y-1.5">
                  {selectedUnits.map((u) => (
                    <div key={u.id} className="flex flex-wrap items-center gap-1.5 text-slate-800 text-xs font-medium">
                      <span className="text-slate-500">District:</span>
                      <span className="font-bold text-slate-900">{u.districtName || '—'}</span>
                      <span className="text-slate-400">→</span>
                      <span className="text-slate-500">Zone:</span>
                      <span className="font-bold text-slate-900">{u.zoneName || '—'}</span>
                      <span className="text-slate-400">→</span>
                      <span className="text-slate-500">Circle:</span>
                      <span className="font-bold text-slate-900">{u.circleName || '—'}</span>
                      <span className="text-slate-400">→</span>
                      <span className="font-bold text-amber-900">Unit:</span>
                      <span className="font-black px-2 py-0.5 rounded bg-amber-200 text-amber-950 border border-amber-300">
                        {u.name}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-1.5 text-slate-800 text-xs font-medium">
                  <span className="text-slate-500">State:</span>
                  <span className="font-bold text-slate-900">{outsideForm.state_name || '—'}</span>
                  <span className="text-slate-400">→</span>
                  <span className="text-slate-500">District:</span>
                  <span className="font-bold text-slate-900">{outsideForm.outside_district || '—'}</span>
                  <span className="text-slate-400">→</span>
                  <span className="text-slate-500">Zone:</span>
                  <span className="font-bold text-slate-900">{outsideForm.outside_zone || '—'}</span>
                  <span className="text-slate-400">→</span>
                  <span className="text-slate-500">Circle:</span>
                  <span className="font-bold text-slate-900">{outsideForm.outside_circle || '—'}</span>
                  <span className="text-slate-400">→</span>
                  <span className="font-bold text-amber-900">Unit:</span>
                  <span className="font-black px-2 py-0.5 rounded bg-amber-200 text-amber-950 border border-amber-300">
                    {outsideForm.outside_unit || '—'}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Confirmation Checkbox (Exact original label) */}
          <div className="p-4 border rounded-xl bg-slate-50 border-slate-200">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded text-markaz-700 focus:ring-markaz-600 cursor-pointer"
                required
              />
              <span className="text-xs font-semibold text-red-600 md:text-sm">
                Complete and make sure all details before submit*
              </span>
            </label>
          </div>

          {/* Submit Error Banner */}
          {submitError && (
            <div className="p-4 rounded-xl bg-red-50 border border-red-300 text-red-700 text-xs md:text-sm flex items-center gap-2.5">
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
              <span>{submitError}</span>
            </div>
          )}

          {/* Submit Button */}
          <div className="pt-2 text-center">
            <button
              type="submit"
              disabled={submitting || !student || (isRegistered && !canSubmitSelected)}
              className="inline-flex items-center justify-center gap-2 px-10 py-3.5 rounded-xl bg-markaz-700 hover:bg-markaz-800 disabled:bg-slate-400 text-white font-bold text-sm shadow-md hover:shadow-lg transition active:scale-95"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Submitting Registration...</span>
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  <span>
                    {canAddUnits
                      ? 'Add Units to Registration'
                      : isRegistered && registrationType === 'outside_kerala'
                      ? 'Submit Outside Kerala Registration'
                      : 'Submit Registration'}
                  </span>
                </>
              )}
            </button>
          </div>
        </form>
        </>
        )}
      </div>
    </div>
  );
}
