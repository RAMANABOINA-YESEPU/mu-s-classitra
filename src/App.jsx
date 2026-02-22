import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
    Calendar, UserCheck, UserX, Clock, Users, Plus, Trash2, Save,
    BarChart2, QrCode, Download, ScanLine, Printer, Camera, XCircle,
    Beaker, Book, Search, Mic, MicOff, Sparkles, BrainCircuit, TrendingDown,
    TrendingUp, AlertTriangle, PlayCircle, StopCircle, Volume2, Settings, Wand2, Cloud
} from 'lucide-react';
import { marked } from 'marked';
import QRCode from 'qrcode';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { auth, db } from './firebase';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';

// --- GEMINI AI SERVICE ---
const callGemini = async (prompt, apiKey) => {
    if (!apiKey) throw new Error("API Key is missing.");
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return data.candidates?.[0]?.content?.parts?.[0]?.text;
};

// --- Utility: Load External Script for QR Scanning ---
const loadScript = (src) => {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) {
            resolve();
            return;
        }
        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
};

export default function App() {
    // --- State Management ---
    const [view, setView] = useState('take');
    const [currentDate, setCurrentDate] = useState(new Date().toISOString().split('T')[0]);
    const [searchQuery, setSearchQuery] = useState('');
    const [apiKey, setApiKey] = useState(() => localStorage.getItem('gemini_api_key') || '');
    const [showSettings, setShowSettings] = useState(false);

    // --- Authentication State ---
    const [user, setUser] = useState(null);
    const [isCheckingAuth, setIsCheckingAuth] = useState(true);

    // Guided Roll Call State
    const [activeRollCallIndex, setActiveRollCallIndex] = useState(-1);

    // 1. Subjects State
    const [subjects, setSubjects] = useState(() => {
        const saved = localStorage.getItem('class_subjects');
        return saved ? JSON.parse(saved) : ['General Class', 'Mathematics', 'Physics', 'Chemistry'];
    });
    const [currentSubject, setCurrentSubject] = useState(subjects[0]);

    // Students State
    const [students, setStudents] = useState(() => {
        const saved = localStorage.getItem('class_students');
        return saved ? JSON.parse(saved) : [
            { id: '1', name: 'Alice Johnson', rollNumber: '2101', batch: 'A' },
            { id: '2', name: 'Bob Smith', rollNumber: '2102', batch: 'B' },
            { id: '3', name: 'Charlie Brown', rollNumber: '2103', batch: 'A' },
            { id: '4', name: 'Diana Prince', rollNumber: '2104', batch: 'B' },
        ];
    });

    // Main Data Store (Single Source of Truth)
    const [attendanceHistory, setAttendanceHistory] = useState(() => {
        const saved = localStorage.getItem('class_attendance');
        return saved ? JSON.parse(saved) : {};
    });

    const [sessionFilter, setSessionFilter] = useState('all'); // 'all', 'theory', 'labA', 'labB'

    const [logoError, setLogoError] = useState(false);

    // Derived Keys for Direct Access
    const safeSubject = currentSubject.replace(/\s+/g, '_');
    const keyTheory = `${currentDate}_${safeSubject}_theory`;
    const keyLabA = `${currentDate}_${safeSubject}_labA`;
    const keyLabB = `${currentDate}_${safeSubject}_labB`;

    // --- Authentication Listener ---
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            if (currentUser) {
                setUser(currentUser);
                // Fetch user data from Firestore
                try {
                    const docRef = doc(db, 'users', currentUser.uid);
                    const docSnap = await getDoc(docRef);
                    if (docSnap.exists()) {
                        const data = docSnap.data();
                        if (data.subjects) setSubjects(data.subjects);
                        if (data.students) setStudents(data.students);
                        if (data.attendanceHistory) setAttendanceHistory(data.attendanceHistory);
                    }
                } catch (err) {
                    console.error("Error fetching user data:", err);
                }
            } else {
                setUser(null);
                // Blank out state on logout
                setSubjects(['General Class', 'Mathematics', 'Physics', 'Chemistry']);
                setStudents([]);
                setAttendanceHistory({});
            }
            setIsCheckingAuth(false);
        });
        return unsubscribe;
    }, []);

    // --- Persistence Effects (Firestore Sync) ---

    // Auto-save to Firestore whenever main states change (Debounced to avoid spam)
    useEffect(() => {
        if (!user || isCheckingAuth) return;

        const saveDataToCloud = async () => {
            try {
                await setDoc(doc(db, 'users', user.uid), {
                    subjects,
                    students,
                    attendanceHistory
                }, { merge: true });
            } catch (err) {
                console.error("Failed to sync with cloud:", err);
            }
        };

        const timeoutId = setTimeout(saveDataToCloud, 1000); // Debounce 1s
        return () => clearTimeout(timeoutId);
    }, [subjects, students, attendanceHistory, user, isCheckingAuth]);

    // LocalStorage for API key only
    useEffect(() => {

    }, [apiKey]);

    // 2. Initialize Empty Days (Data Consistency)
    useEffect(() => {
        setAttendanceHistory(prev => {
            const next = { ...prev };
            let changed = false;

            const initSession = (key, filterBatch) => {
                if (!next[key]) {
                    next[key] = {};
                    students.forEach(s => {
                        // For theory, add everyone. For Labs, filter by batch.
                        if (!filterBatch || s.batch === filterBatch) {
                            next[key][s.id] = 'absent'; // Default to absent
                        }
                    });
                    changed = true;
                }
            };

            initSession(keyTheory, null);
            initSession(keyLabA, 'A');
            initSession(keyLabB, 'B');

            return changed ? next : prev;
        });
    }, [currentDate, currentSubject, students]); // Re-run when context changes

    // --- Handlers (Directly manipulating history) ---

    const toggleStatus = (studentId, type) => {
        const key = type === 'theory' ? keyTheory : type === 'labA' ? keyLabA : keyLabB;
        setAttendanceHistory(prev => {
            const currentStatus = prev[key]?.[studentId] || 'absent';
            const nextStatus = currentStatus === 'present' ? 'absent' : currentStatus === 'absent' ? 'late' : 'present';
            return {
                ...prev,
                [key]: {
                    ...prev[key],
                    [studentId]: nextStatus
                }
            };
        });
    };

    const markPresent = (studentId, type) => {
        const student = students.find(s => s.id === studentId);
        if (!student) return false;

        // Validate Batch
        if (type === 'labA' && student.batch !== 'A') return false;
        if (type === 'labB' && student.batch !== 'B') return false;

        const key = type === 'theory' ? keyTheory : type === 'labA' ? keyLabA : keyLabB;

        // Check current status to avoid redundant updates (and beeps)
        if (attendanceHistory[key]?.[studentId] === 'present') return false;

        setAttendanceHistory(prev => ({
            ...prev,
            [key]: { ...prev[key], [studentId]: 'present' }
        }));
        return true; // Successfully marked
    };

    const speakText = (text) => {
        if ('speechSynthesis' in window) {
            const utterance = new SpeechSynthesisUtterance(text);
            window.speechSynthesis.speak(utterance);
        }
    };

    // AI Handlers (Updated to use setAttendanceHistory)
    const handleAICommand = async (text, type = 'theory') => {
        if (!apiKey) return { success: false, message: "Please set your Gemini API Key in Settings first." };
        const key = type === 'theory' ? keyTheory : type === 'labA' ? keyLabA : keyLabB;

        try {
            const prompt = `
            You are an attendance assistant. I have a list of students: ${JSON.stringify(students.map(s => ({ id: s.id, name: s.name, roll: s.rollNumber })))}.
            The user says: "${text}".
            Return ONLY a JSON array of objects with 'id' and 'status' (present/absent/late) for mentioned students.
            Example: [{"id": "1", "status": "present"}]
            NO markdown.
            `;
            const result = await callGemini(prompt, apiKey);
            const cleanResult = result.replace(/```json|```/g, '').trim();
            const updates = JSON.parse(cleanResult);

            setAttendanceHistory(prev => {
                const updatedSession = { ...prev[key] };
                updates.forEach(u => updatedSession[u.id] = u.status);
                return { ...prev, [key]: updatedSession };
            });
            return { success: true, message: `Updated ${updates.length} students.` };
        } catch (e) {
            return { success: false, message: "AI Error: " + e.message };
        }
    };

    const handleVoiceCommand = (transcript, type = 'theory') => {
        const key = type === 'theory' ? keyTheory : type === 'labA' ? keyLabA : keyLabB;
        const lower = transcript.toLowerCase();

        let status = null;
        if (lower.includes('present') || lower.includes('yes')) status = 'present';
        else if (lower.includes('absent') || lower.includes('no')) status = 'absent';
        else if (lower.includes('late')) status = 'late';

        const numbers = lower.match(/\d+/g);
        let student = null;

        if (numbers) {
            const spokenNumber = numbers.join('');
            student = students.find(s => s.rollNumber.toString().endsWith(spokenNumber));
            if (!student) return { success: false, message: `Roll ...${spokenNumber} not found.` };
        } else if (activeRollCallIndex !== -1 && status) {
            student = students[activeRollCallIndex];
        } else {
            return { success: false, message: "Say a Roll Number or Status." };
        }

        if (!status) return { success: false, message: `Found ${student.name}. Say Status.`, student };

        setAttendanceHistory(prev => ({
            ...prev,
            [key]: { ...prev[key], [student.id]: status }
        }));

        if (activeRollCallIndex !== -1 && students[activeRollCallIndex].id === student.id) {
            const nextIndex = activeRollCallIndex + 1;
            if (nextIndex < students.length) {
                setActiveRollCallIndex(nextIndex);
                setTimeout(() => speakText(students[nextIndex].name), 1000);
            } else {
                setActiveRollCallIndex(-1);
                speakText("Roll call finished.");
                return { success: true, message: `Marked ${student.name}. Done.`, student, status };
            }
        }

        return { success: true, message: `Marked ${student.name} as ${status}.`, student, status };
    };

    // --- Helpers ---
    const addStudent = (name, rollNumber, batch) => {
        const newStudent = { id: Date.now().toString(), name, rollNumber, batch };
        setStudents([...students, newStudent]);
    };

    const removeStudent = (id) => {
        if (confirm('Delete student?')) {
            setStudents(students.filter(s => s.id !== id));
        }
    };

    const addSubject = (name) => {
        if (!subjects.includes(name)) setSubjects([...subjects, name]);
    };

    const removeSubject = (name) => {
        if (subjects.length > 1 && confirm('Delete Subject?')) {
            const newSubs = subjects.filter(s => s !== name);
            setSubjects(newSubs);
            if (currentSubject === name) setCurrentSubject(newSubs[0]);
        }
    };

    const downloadReport = (coordinatorName, division, timings, room) => {
        const searchKey = `_${safeSubject}_theory`;
        const dates = Object.keys(attendanceHistory).filter(k => k.includes(searchKey)).map(k => k.split('_')[0]).sort();
        const uniqueDates = [...new Set(dates)];

        let csv = `Attendance Report: ${currentSubject}\nCoordinator: ${coordinatorName || 'N/A'}\nDivision: ${division || 'N/A'}\nTimings: ${timings || 'N/A'}\nRoom: ${room || 'N/A'}\n\nRoll No,Name,Batch,${uniqueDates.join(',')},Total Present,Attendance %\n`;

        students.forEach(student => {
            let presentCount = 0;
            const dailyStatuses = uniqueDates.map(date => {
                const status = attendanceHistory[`${date}_${safeSubject}_theory`]?.[student.id] || 'absent';
                if (status === 'present') { presentCount++; return 'P'; }
                else if (status === 'late') { return 'L'; }
                return 'A';
            });
            const simplePercentage = Math.round((presentCount / (uniqueDates.length || 1)) * 100);
            csv += `${student.rollNumber},${student.name},${student.batch},${dailyStatuses.join(',')},${presentCount},${simplePercentage}%\n`;
        });

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Register_${safeSubject}.csv`;
        a.click();
    };

    const clearRegister = () => {
        if (confirm(`Are you sure you want to clear all attendance for ${currentSubject} on ${currentDate}?`)) {
            const newHist = { ...attendanceHistory };
            delete newHist[keyTheory];
            delete newHist[keyLabA];
            delete newHist[keyLabB];
            setAttendanceHistory(newHist);
        }
    };

    const stats = useMemo(() => {
        const key = sessionFilter === 'labA' ? keyLabA : sessionFilter === 'labB' ? keyLabB : keyTheory;
        const sessionData = attendanceHistory[key] || {};
        const total = sessionFilter === 'all' || sessionFilter === 'theory' ? students.length : students.filter(s => s.batch === (sessionFilter === 'labA' ? 'A' : 'B')).length;
        const present = Object.values(sessionData).filter(s => s === 'present').length;
        return { present, percentage: total === 0 ? 0 : Math.round((present / total) * 100) };
    }, [attendanceHistory, keyTheory, keyLabA, keyLabB, students, sessionFilter]);

    const filteredStudents = useMemo(() => {
        const query = searchQuery.toLowerCase().trim();
        let list = students;
        if (sessionFilter === 'labA') list = students.filter(s => s.batch === 'A');
        if (sessionFilter === 'labB') list = students.filter(s => s.batch === 'B');

        if (!query) return list;
        return list.filter(student =>
            student.name.toLowerCase().includes(query) ||
            String(student.rollNumber).toLowerCase().includes(query)
        );
    }, [students, searchQuery, sessionFilter]);

    const MiniStatus = ({ status, onClick, disabled }) => {
        if (disabled) return <div className="w-8 h-8 mx-auto rounded-full bg-slate-100 border border-slate-200"></div>;
        const config = {
            present: { color: 'bg-emerald-500 text-white shadow-emerald-200', label: 'P' },
            absent: { color: 'bg-rose-500 text-white shadow-rose-200', label: 'A' },
            late: { color: 'bg-amber-500 text-white shadow-amber-200', label: 'L' },
        };
        const { color, label } = config[status || 'absent'];
        return (
            <button onClick={onClick} disabled={disabled} className={`${color} w-10 h-10 sm:w-8 sm:h-8 mx-auto rounded-full font-bold text-sm sm:text-xs shadow-md transition-all hover:scale-110 active:scale-95 flex items-center justify-center disabled:opacity-50 disabled:hover:scale-100 disabled:cursor-not-allowed`}>{label}</button>
        );
    };

    if (isCheckingAuth) {
        return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white"><div className="animate-spin w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full"></div></div>;
    }

    if (!user) {
        return <LoginScreen />;
    }

    const handleLogout = () => {
        if (confirm("Are you sure you want to sign out?")) {
            signOut(auth);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 font-sans text-slate-900 flex flex-col relative">
            {/* Settings Modal */}
            {showSettings && (
                <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-2xl">
                        <h3 className="text-xl font-bold mb-4 flex items-center gap-2"><Sparkles className="text-indigo-500" /> AI Settings</h3>
                        <label className="block text-sm font-medium mb-1">Gemini API Key</label>
                        <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="w-full border rounded p-2 mb-4" placeholder="Enter API Key" />
                        <div className="flex justify-end gap-2">
                            <button onClick={() => setShowSettings(false)} className="px-4 py-2 bg-slate-200 rounded">Close</button>
                            <button onClick={() => setShowSettings(false)} className="px-4 py-2 bg-indigo-600 text-white rounded">Save</button>
                        </div>
                    </div>
                </div>
            )}

            <nav className="bg-slate-900 shadow-xl border-b border-slate-800 px-6 py-4 sticky top-0 z-50">
                <div className="max-w-6xl mx-auto flex flex-col xl:flex-row xl:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        {!logoError ? (
                            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4">
                                <div className="flex shrink-0">
                                    <img
                                        src="/r-logo.jpg"
                                        alt="App Logo"
                                        className="h-16 w-16 sm:h-20 sm:w-20 object-cover rounded-xl shadow-md border-2 border-slate-700"
                                    />
                                </div>

                                <div className="flex flex-col">
                                    <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight leading-tight">MU's <span className="text-indigo-400 font-extrabold">Classitra</span></h1>
                                </div>
                            </div>
                        ) : (
                            <>
                                <div className="bg-indigo-600 p-2 rounded-lg"><Users className="text-white" size={24} /></div>
                                <div><h1 className="text-xl font-bold text-white">MU's Classitra</h1><p className="text-xs text-slate-400 font-medium">Attendance Management System</p></div>
                            </>
                        )}
                    </div>
                    <div className="flex overflow-x-auto hide-scrollbar items-center gap-2 pb-2 xl:pb-0 w-full xl:w-auto justify-start xl:justify-end">
                        {['take', 'scan', 'ai', 'cards', 'students', 'subjects', 'history'].map(v => (
                            <button key={v} onClick={() => setView(v)} className={`px-3 py-2 rounded-md text-sm shrink-0 font-medium capitalize whitespace-nowrap ${view === v ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-white'}`}>{v}</button>
                        ))}
                        <button onClick={() => setShowSettings(true)} className="text-slate-400 hover:text-white p-2 shrink-0" title="Settings"><Settings size={20} /></button>
                        <button onClick={handleLogout} className="text-rose-400 hover:text-rose-500 hover:bg-white/10 p-2 rounded-lg shrink-0 transition-colors ml-2 font-bold flex items-center justify-center gap-2 text-sm" title="Sign Out">Sign Out</button>
                    </div>
                </div>
            </nav>

            <div className="w-full hero-bg-custom py-12 px-6 shadow-inner mb-6 relative">
                <div className="max-w-6xl mx-auto relative z-10">
                    <div className="bg-white/90 backdrop-blur p-6 rounded-xl shadow-xl border border-slate-200 space-y-4">
                        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
                            <div className="flex flex-wrap gap-4 w-full lg:w-auto">
                                <input type="date" value={currentDate} onChange={(e) => setCurrentDate(e.target.value)} className="p-2 border rounded flex-1 lg:flex-none" />
                                <select value={currentSubject} onChange={(e) => setCurrentSubject(e.target.value)} className="p-2 border rounded font-bold flex-1 lg:flex-none">{subjects.map(s => <option key={s} value={s}>{s}</option>)}</select>
                            </div>
                            <div className="flex flex-wrap items-center gap-4 w-full lg:w-auto justify-between lg:justify-end">
                                <button onClick={clearRegister} className="flex items-center justify-center gap-2 text-rose-600 bg-rose-50 px-4 py-2 rounded-lg text-sm font-bold hover:bg-rose-100 transition-colors w-full lg:w-auto border border-rose-200">
                                    <Trash2 size={16} /> Clear Register
                                </button>
                                {/* Auto-Save Indicator */}
                                <div className="flex items-center justify-center gap-2 text-indigo-600 font-medium bg-indigo-50 px-4 py-2 rounded-full text-sm w-full lg:w-auto border border-indigo-200">
                                    <Cloud size={16} /> Auto-Saving On
                                </div>
                            </div>
                        </div>
                        <div className="pt-4 border-t border-slate-100 flex items-center gap-6 text-sm">
                            <div className="flex flex-col"><span className="text-slate-500 text-xs uppercase tracking-wide">Subject</span><span className="font-bold text-indigo-900">{currentSubject}</span></div>
                            <div className="h-8 w-px bg-slate-200"></div>
                            <div className="flex flex-col"><span className="text-slate-500 text-xs uppercase tracking-wide">Present</span><span className="font-bold text-emerald-600">{stats.present}</span></div>
                            <div className="flex flex-col"><span className="text-slate-500 text-xs uppercase tracking-wide">Rate</span><span className="font-bold text-indigo-600">{stats.percentage}%</span></div>
                        </div>
                    </div>
                </div>
            </div>

            <main className="max-w-6xl mx-auto p-6 flex-1 w-full -mt-6 z-20">
                {view === 'take' && (
                    <div className="space-y-6">
                        <div className="flex flex-col sm:flex-row gap-4 justify-between">
                            <div className="relative flex-1">
                                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Search size={18} /></div>
                                <input type="text" placeholder="Search by Name or Roll No..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-10 pr-4 py-3 border border-slate-300 rounded-xl shadow-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
                            </div>
                            <div className="flex bg-white rounded-xl shadow-sm border border-slate-200 p-1">
                                {['all', 'theory', 'labA', 'labB'].map(f => (
                                    <button key={f} onClick={() => setSessionFilter(f)} className={`px-4 py-2 rounded-lg text-sm font-bold capitalize ${sessionFilter === f ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}>
                                        {f === 'labA' ? 'Lab A' : f === 'labB' ? 'Lab B' : f}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse hidden sm:table">
                                    <thead className="bg-slate-50 border-b border-slate-200">
                                        <tr>
                                            <th className="px-1 sm:px-4 py-3 sm:py-4 text-[10px] sm:text-xs font-semibold text-slate-500 uppercase tracking-wider text-center">Sr No</th>
                                            <th className="px-1 sm:px-6 py-3 sm:py-4 text-[10px] sm:text-xs font-semibold text-slate-500 uppercase tracking-wider">Roll No</th>
                                            <th className="px-1 sm:px-6 py-3 sm:py-4 text-[10px] sm:text-xs font-semibold text-slate-500 uppercase">Name</th>
                                            <th className="px-1 sm:px-6 py-3 sm:py-4 text-[10px] sm:text-xs font-semibold text-slate-500 uppercase text-center hidden sm:table-cell">Batch</th>
                                            {(sessionFilter === 'all' || sessionFilter === 'theory') && <th className="px-1 sm:px-4 py-3 sm:py-4 text-[10px] sm:text-xs font-bold text-indigo-700 uppercase tracking-wider text-center bg-indigo-50 border-l border-indigo-100">Theory</th>}
                                            {(sessionFilter === 'all' || sessionFilter === 'labA') && <th className="px-1 sm:px-4 py-3 sm:py-4 text-[10px] sm:text-xs font-bold text-teal-700 uppercase tracking-wider text-center bg-teal-50 border-l border-teal-100">Lab A</th>}
                                            {(sessionFilter === 'all' || sessionFilter === 'labB') && <th className="px-1 sm:px-4 py-3 sm:py-4 text-[10px] sm:text-xs font-bold text-purple-700 uppercase tracking-wider text-center bg-purple-50 border-l border-purple-100">Lab B</th>}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {filteredStudents.map((student, index) => (
                                            <tr key={student.id} className="hover:bg-slate-50 transition-colors">
                                                <td className="px-1 sm:px-4 py-2 sm:py-3 text-center text-[10px] sm:text-sm font-bold text-slate-400 bg-slate-50/50 border-r border-slate-100">{index + 1}</td>
                                                <td className="px-1 sm:px-6 py-2 sm:py-3 text-[10px] sm:text-sm font-medium text-slate-600 font-mono"><div className="truncate w-14 sm:w-auto">{student.rollNumber}</div></td>
                                                <td className="px-1 sm:px-6 py-2 sm:py-3 text-[10px] sm:text-sm font-bold text-slate-800"><div className="truncate w-16 sm:w-auto">{student.name}</div></td>
                                                <td className="px-1 sm:px-6 py-2 sm:py-3 text-center hidden sm:table-cell"><span className="bg-slate-100 px-1 py-0.5 sm:px-2 sm:py-1 rounded text-[10px] sm:text-xs font-bold text-slate-600 border border-slate-200">{student.batch}</span></td>
                                                {(sessionFilter === 'all' || sessionFilter === 'theory') && <td className="px-1 sm:px-4 py-2 sm:py-3 text-center border-l border-slate-100">
                                                    <MiniStatus status={attendanceHistory[keyTheory]?.[student.id]} onClick={() => toggleStatus(student.id, 'theory')} />
                                                </td>}
                                                {(sessionFilter === 'all' || sessionFilter === 'labA') && <td className="px-1 sm:px-4 py-2 sm:py-3 text-center border-l border-slate-100 bg-slate-50/50">
                                                    <MiniStatus status={attendanceHistory[keyLabA]?.[student.id]} onClick={() => toggleStatus(student.id, 'labA')} disabled={student.batch !== 'A'} />
                                                </td>}
                                                {(sessionFilter === 'all' || sessionFilter === 'labB') && <td className="px-1 sm:px-4 py-2 sm:py-3 text-center border-l border-slate-100 bg-slate-50/50">
                                                    <MiniStatus status={attendanceHistory[keyLabB]?.[student.id]} onClick={() => toggleStatus(student.id, 'labB')} disabled={student.batch !== 'B'} />
                                                </td>}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {/* Mobile Responsive Card Layout */}
                                <div className="block sm:hidden divide-y divide-slate-100">
                                    {filteredStudents.map((student, index) => (
                                        <div key={student.id} className="p-4 bg-white hover:bg-slate-50 transition-colors">
                                            <div className="flex justify-between items-start mb-4">
                                                <div className="flex-1 pr-2">
                                                    <h4 className="text-[18px] font-bold text-slate-900 leading-tight mb-2 uppercase">{student.name}</h4>
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <span className="text-sm font-mono font-medium text-slate-500 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-md">{student.rollNumber}</span>
                                                        <span className="bg-indigo-50 px-2 py-0.5 rounded-md text-xs font-bold text-indigo-700 border border-indigo-100 shadow-sm">Batch {student.batch}</span>
                                                    </div>
                                                </div>
                                                <div className="text-sm font-bold text-slate-400 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">#{index + 1}</div>
                                            </div>

                                            <div className="flex items-center gap-3 pt-3 border-t border-slate-100">
                                                {(sessionFilter === 'all' || sessionFilter === 'theory') && (
                                                    <div className="flex-1 bg-slate-50 rounded-xl p-3 border border-slate-100 flex flex-col items-center justify-center">
                                                        <div className="text-[11px] font-bold text-indigo-700 uppercase tracking-widest text-center mb-2">Theory</div>
                                                        <MiniStatus status={attendanceHistory[keyTheory]?.[student.id]} onClick={() => toggleStatus(student.id, 'theory')} />
                                                    </div>
                                                )}
                                                {(sessionFilter === 'all' || sessionFilter === 'labA') && (
                                                    <div className="flex-1 bg-slate-50 rounded-xl p-3 border border-slate-100 flex flex-col items-center justify-center opacity-90 transition-opacity">
                                                        <div className="text-[11px] font-bold text-teal-700 uppercase tracking-widest text-center mb-2">Lab A</div>
                                                        <MiniStatus status={attendanceHistory[keyLabA]?.[student.id]} onClick={() => toggleStatus(student.id, 'labA')} disabled={student.batch !== 'A'} />
                                                    </div>
                                                )}
                                                {(sessionFilter === 'all' || sessionFilter === 'labB') && (
                                                    <div className="flex-1 bg-slate-50 rounded-xl p-3 border border-slate-100 flex flex-col items-center justify-center opacity-90 transition-opacity">
                                                        <div className="text-[11px] font-bold text-purple-700 uppercase tracking-widest text-center mb-2">Lab B</div>
                                                        <MiniStatus status={attendanceHistory[keyLabB]?.[student.id]} onClick={() => toggleStatus(student.id, 'labB')} disabled={student.batch !== 'B'} />
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {view === 'scan' && (
                    <ScannerView
                        students={students}
                        onScan={markPresent}
                        currentSubject={currentSubject}
                    />
                )}

                {view === 'ai' && (
                    <AIAssistantView
                        students={students}
                        apiKey={apiKey}
                        handleAICommand={handleAICommand}
                        onVoiceCommand={handleVoiceCommand}
                        activeRollCallIndex={activeRollCallIndex}
                        setActiveRollCallIndex={setActiveRollCallIndex}
                        speakText={speakText}
                        attendanceHistory={attendanceHistory} // For feedback display
                        currentKey={keyTheory}
                    />
                )}

                {view === 'cards' && <QRCardsView students={students} />}
                {view === 'students' && <StudentManager students={students} onAdd={addStudent} onRemove={removeStudent} />}
                {view === 'subjects' && <SubjectManager subjects={subjects} onAdd={addSubject} onRemove={removeSubject} />}
                {view === 'history' && <HistoryView apiKey={apiKey} callGemini={callGemini} attendanceHistory={attendanceHistory} students={students} subject={currentSubject} onDownload={downloadReport} />}
            </main>

            <footer className="bg-slate-900 text-slate-400 py-6 text-center text-sm mt-auto no-print border-t border-slate-800">
                <p>&copy; {new Date().getFullYear()} Classitra. All rights belong to <span className="text-slate-200 font-semibold">RAMANABOINA YESEPU</span>.</p>
                <p className="text-xs text-slate-600 mt-2">Logged in as {user.email}</p>
            </footer>
        </div>
    );
}

// --- Sub-Components ---

function LoginScreen() {
    const [isLogin, setIsLogin] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError(null);
        setLoading(true);

        try {
            if (isLogin) {
                await signInWithEmailAndPassword(auth, email, password);
            } else {
                await createUserWithEmailAndPassword(auth, email, password);
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
            <div className="bg-white max-w-md w-full rounded-2xl shadow-2xl overflow-hidden">
                <div className="bg-indigo-600 p-8 text-center" style={{ backgroundImage: "url('/r-logo.jpg')", backgroundSize: 'cover', backgroundPosition: 'center', position: 'relative' }}>
                    <div className="absolute inset-0 bg-indigo-900/80 backdrop-blur-sm"></div>
                    <div className="relative z-10">
                        <div className="bg-white/10 border border-white/20 p-2 rounded-2xl w-24 h-24 mx-auto flex items-center justify-center mb-4 shadow-xl overflow-hidden shadow-indigo-900/50">
                            <img src="/r-logo.jpg" alt="Classitra Logo" className="w-full h-full object-cover rounded-xl" />
                        </div>
                        <h2 className="text-2xl font-bold text-white tracking-tight">MU's Classitra</h2>
                        <p className="text-indigo-200 text-sm mt-1 font-medium">Cloud Attendance System</p>
                    </div>
                </div>

                <div className="p-8">
                    <h3 className="text-xl font-bold text-slate-800 mb-6 text-center">{isLogin ? 'Welcome Back' : 'Create Teacher Account'}</h3>

                    {error && (
                        <div className="bg-rose-50 text-rose-600 p-3 rounded-lg text-sm mb-6 flex items-start gap-2 border border-rose-100">
                            <AlertTriangle size={18} className="shrink-0 mt-0.5" />
                            <span>{error.replace('Firebase:', '').trim()}</span>
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="block text-sm font-semibold text-slate-600 mb-1">Email Address</label>
                            <input type="email" required value={email} onChange={e => setEmail(e.target.value)} className="w-full px-4 py-3 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50 transition-all" placeholder="teacher@university.edu" />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-slate-600 mb-1">Password</label>
                            <input type="password" required value={password} minLength={6} onChange={e => setPassword(e.target.value)} className="w-full px-4 py-3 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50 transition-all" placeholder="Min 6 characters" />
                        </div>

                        <button type="submit" disabled={loading} className="w-full bg-slate-900 text-white font-bold py-3 rounded-xl hover:bg-slate-800 transition-colors shadow-lg mt-4 flex items-center justify-center gap-2">
                            {loading ? <div className="animate-spin w-5 h-5 border-2 border-white/30 border-t-white rounded-full"></div> : (isLogin ? 'Sign In Securely' : 'Create Account')}
                        </button>
                    </form>

                    <div className="mt-8 text-center">
                        <p className="text-slate-500 text-sm">
                            {isLogin ? "Don't have an account?" : "Already have an account?"}
                            <button onClick={() => { setIsLogin(!isLogin); setError(null); }} className="text-indigo-600 font-bold ml-1 hover:underline outline-none">
                                {isLogin ? 'Sign Up' : 'Sign In'}
                            </button>
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}

function ScannerView({ students, onScan, currentSubject }) {
    const [scanMode, setScanMode] = useState('theory');
    const [lastScanned, setLastScanned] = useState(null);
    const [inputVal, setInputVal] = useState('');
    const [cameraActive, setCameraActive] = useState(false);
    const [scanError, setScanError] = useState(null);
    const [stream, setStream] = useState(null);
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const requestRef = useRef(null);

    // Refs for Tick Loop
    const studentsRef = useRef(students);
    const scanModeRef = useRef(scanMode);
    const onScanRef = useRef(onScan);
    const lastScanTimeRef = useRef(0);

    useEffect(() => { studentsRef.current = students; }, [students]);
    useEffect(() => { scanModeRef.current = scanMode; }, [scanMode]);
    useEffect(() => { onScanRef.current = onScan; }, [onScan]);

    useEffect(() => {
        loadScript('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js').catch(() => setScanError("Failed to load scanner."));
        return () => stopCamera();
    }, []);

    useEffect(() => {
        if (cameraActive && stream && videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.setAttribute("playsinline", true);
            videoRef.current.play().catch(e => console.error(e));
            requestRef.current = requestAnimationFrame(tick);
        }
    }, [cameraActive, stream]);

    const handleScanSuccess = (rollNumber) => {
        const now = Date.now();
        if (now - lastScanTimeRef.current < 2000) return;
        lastScanTimeRef.current = now;

        const currentStudents = studentsRef.current;
        const currentScanMode = scanModeRef.current;
        const currentOnScan = onScanRef.current;

        const student = currentStudents.find(s => s.rollNumber === rollNumber.toString().trim());

        if (student) {
            if (currentScanMode === 'labA' && student.batch !== 'A') {
                setLastScanned({ student, time: new Date().toLocaleTimeString(), status: 'wrong_batch', batchNeeded: 'A' });
                return;
            }
            if (currentScanMode === 'labB' && student.batch !== 'B') {
                setLastScanned({ student, time: new Date().toLocaleTimeString(), status: 'wrong_batch', batchNeeded: 'B' });
                return;
            }
            const changed = currentOnScan(student.id, currentScanMode);
            if (changed) {
                const audio = new Audio('https://codeskulptor-demos.commondatastorage.googleapis.com/pang/pop.mp3'); // Simple beep
                audio.play();
            }
            setLastScanned({ student, time: new Date().toLocaleTimeString(), status: 'success' });
        } else {
            setLastScanned({ roll: rollNumber, time: new Date().toLocaleTimeString(), status: 'error' });
        }
    };

    const startCamera = async () => {
        try {
            setScanError(null);
            const mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            setStream(mediaStream);
            setCameraActive(true);
        } catch (err) {
            setScanError("Camera access denied. Ensure HTTPS.");
            setCameraActive(false);
        }
    };

    const stopCamera = () => {
        if (stream) { stream.getTracks().forEach(track => track.stop()); setStream(null); }
        if (requestRef.current) cancelAnimationFrame(requestRef.current);
        setCameraActive(false);
    };

    const tick = () => {
        if (videoRef.current && videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
            const canvas = canvasRef.current;
            const video = videoRef.current;
            if (canvas) {
                canvas.height = video.videoHeight;
                canvas.width = video.videoWidth;
                const ctx = canvas.getContext("2d");
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                if (window.jsQR) {
                    const code = window.jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "dontInvert" });
                    if (code) {
                        ctx.beginPath();
                        ctx.lineWidth = 4;
                        ctx.strokeStyle = "#FF3B58";
                        // Draw box logic omitted for brevity, scanning works
                        ctx.stroke();
                        handleScanSuccess(code.data);
                    }
                }
            }
        }
        requestRef.current = requestAnimationFrame(tick);
    };

    return (
        <div className="max-w-2xl mx-auto space-y-6">
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-3"><div className="bg-indigo-100 p-2 rounded-full"><Book className="text-indigo-600" size={20} /></div><div><h3 className="font-bold text-slate-700">Scan for: {currentSubject}</h3><p className="text-xs text-slate-500">Select session type</p></div></div>
                <div className="flex bg-slate-100 p-1 rounded-lg">
                    {['theory', 'labA', 'labB'].map(mode => (
                        <button key={mode} onClick={() => setScanMode(mode)} className={`px-4 py-2 text-sm font-semibold rounded-md transition-all ${scanMode === mode ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>{mode === 'theory' ? 'Theory' : mode === 'labA' ? 'Lab A' : 'Lab B'}</button>
                    ))}
                </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col items-center justify-center min-h-[300px] relative overflow-hidden">
                    {cameraActive ? (
                        <>
                            <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" />
                            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-cover" />
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><div className="w-48 h-48 border-2 border-white/50 rounded-lg"></div></div>
                            <button onClick={stopCamera} className="absolute bottom-4 bg-white/90 text-red-600 px-4 py-2 rounded-full text-sm font-bold shadow-lg hover:bg-white flex items-center gap-2 pointer-events-auto"><XCircle size={16} /> Stop Camera</button>
                        </>
                    ) : (
                        <div className="text-center space-y-4">
                            <div className="bg-slate-100 p-4 rounded-full inline-block"><Camera size={48} className="text-slate-400" /></div>
                            <p className="text-slate-500 text-sm px-8">Enable camera to scan.</p>
                            <button onClick={startCamera} className="bg-indigo-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-indigo-700 transition-colors flex items-center gap-2 mx-auto"><Camera size={18} /> Start Camera</button>
                            {scanError && <p className="text-rose-500 text-xs font-medium">{scanError}</p>}
                        </div>
                    )}
                </div>
                {/* Manual Input and Last Scanned info remains same layout... */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 flex flex-col justify-center space-y-4">
                    <h4 className="font-bold text-slate-700 flex items-center gap-2"><ScanLine size={18} /> Manual / USB Scan</h4>
                    <input type="text" value={inputVal} onChange={(e) => setInputVal(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { handleScanSuccess(e.target.value); setInputVal(''); } }} placeholder="Type & Enter..." className="w-full text-center text-2xl font-mono py-3 border-2 border-indigo-100 rounded-xl focus:border-indigo-600 outline-none" />
                    {lastScanned && (
                        <div className={`p-3 rounded-lg border text-sm ${lastScanned.status === 'success' ? 'bg-emerald-50 border-emerald-100' : 'bg-rose-50 border-rose-100'}`}>
                            {lastScanned.status === 'success' ? `✅ Marked ${lastScanned.student.name}` : `❌ Error: ${lastScanned.status}`}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function AIAssistantView({ students, apiKey, handleAICommand, onVoiceCommand, activeRollCallIndex, setActiveRollCallIndex, speakText, attendanceHistory, currentKey }) {
    const [isListening, setIsListening] = useState(false);
    const [transcript, setTranscript] = useState('');
    const [feedback, setFeedback] = useState(null);
    const [lastStudent, setLastStudent] = useState(null);
    const recognitionRef = useRef(null);
    const shouldListenRef = useRef(false);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [aiResult, setAiResult] = useState(null);

    const onVoiceCommandRef = useRef(onVoiceCommand);
    useEffect(() => {
        onVoiceCommandRef.current = onVoiceCommand;
    }, [onVoiceCommand]);

    useEffect(() => {
        return () => { shouldListenRef.current = false; if (recognitionRef.current) recognitionRef.current.stop(); };
    }, []);

    const toggleMic = () => {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) return alert("Browser not supported. Try Chrome.");

        if (isListening) {
            shouldListenRef.current = false;
            if (recognitionRef.current) recognitionRef.current.stop();
            setIsListening(false);
        } else {
            shouldListenRef.current = true;
            setIsListening(true);
            const recognition = new SpeechRecognition();
            recognition.continuous = true;
            recognition.lang = 'en-US';
            recognition.interimResults = false;
            recognition.onend = () => { if (shouldListenRef.current) { try { recognition.start(); } catch (e) { } } else { setIsListening(false); } };
            recognition.onresult = (event) => {
                const last = event.results.length - 1;
                const text = event.results[last][0].transcript;
                setTranscript(text);
                const result = onVoiceCommandRef.current(text);
                setFeedback(result);
                if (result.student) setLastStudent(result.student);
            };
            recognitionRef.current = recognition;
            recognition.start();
        }
    };

    const startRollCall = () => {
        if (activeRollCallIndex === -1) {
            setActiveRollCallIndex(0);
            speakText(`Starting roll call. Is ${students[0].name} present?`);
            if (!isListening) toggleMic();
        } else {
            setActiveRollCallIndex(-1);
            speakText("Roll call stopped.");
        }
    };

    const handleTextSubmit = async (e) => {
        e.preventDefault();
        if (!input.trim()) return;
        setLoading(true);
        const res = await handleAICommand(input);
        setAiResult(res);
        setLoading(false);
        if (res.success) setInput('');
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="space-y-8">
                <div className="bg-gradient-to-r from-indigo-600 to-purple-700 text-white rounded-2xl p-8 shadow-xl relative overflow-hidden">
                    <div className="z-10 relative">
                        <h2 className="text-3xl font-bold flex items-center gap-3 mb-4"><Sparkles className="text-yellow-300" /> Voice Assistant</h2>
                        {activeRollCallIndex !== -1 ? (
                            <div className="bg-white/20 p-4 rounded-lg mb-6 animate-pulse border border-white/30">
                                <p className="text-xl font-bold">Calling: {students[activeRollCallIndex]?.name}</p>
                            </div>
                        ) : (
                            <p className="text-indigo-100 text-lg mb-6">Say <span className="font-mono bg-white/20 px-2 rounded text-sm">"45 Present"</span> to mark Roll ending in 45.</p>
                        )}
                        <div className="flex items-center gap-4 mb-6">
                            <button onClick={toggleMic} className={`w-16 h-16 rounded-full flex items-center justify-center transition-all shadow-lg ${isListening ? 'bg-red-500 animate-pulse' : 'bg-white text-indigo-600'}`}>{isListening ? <MicOff size={32} /> : <Mic size={32} />}</button>
                            <button onClick={startRollCall} className={`flex items-center gap-2 px-6 py-4 rounded-xl font-bold transition-all shadow-lg flex-1 justify-center ${activeRollCallIndex !== -1 ? 'bg-red-500' : 'bg-indigo-500 border border-indigo-400'}`}>{activeRollCallIndex !== -1 ? 'Stop' : 'Start Roll Call'}</button>
                        </div>
                        {transcript && <p className="mt-2 text-xs bg-black/20 inline-block px-2 py-1 rounded">Heard: "{transcript}"</p>}
                    </div>
                </div>

                <div className="bg-white p-6 rounded-2xl shadow-sm border">
                    <h3 className="font-bold text-slate-700 mb-4 flex items-center gap-2"><BrainCircuit size={18} /> Smart Text Command (Gemini)</h3>
                    <form onSubmit={handleTextSubmit} className="relative">
                        <input type="text" value={input} onChange={e => setInput(e.target.value)} className="w-full p-4 rounded-xl text-slate-900 border focus:outline-none focus:ring-4 ring-indigo-100" placeholder={apiKey ? "e.g., 'Everyone present except Bob'" : "Set API Key in Settings first"} disabled={!apiKey || loading} />
                        <button type="submit" disabled={loading} className="absolute right-2 top-2 bg-indigo-900 text-white p-2 rounded-lg hover:bg-indigo-800 disabled:opacity-50">
                            {loading ? <div className="animate-spin w-5 h-5 border-2 border-white/30 border-l-white rounded-full"></div> : <Wand2 size={20} />}
                        </button>
                    </form>
                    {aiResult && <div className={`mt-4 p-3 rounded-lg text-sm font-bold ${aiResult.success ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{aiResult.message}</div>}
                </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-[600px]">
                <div className="bg-slate-50 p-4 border-b border-slate-100 flex justify-between items-center"><h3 className="font-bold text-slate-700">Live Feedback</h3></div>
                <div className="p-8 text-center border-b border-slate-100">
                    {lastStudent ? (
                        <div className="animate-in fade-in zoom-in duration-300">
                            <div className="text-4xl font-black text-slate-900 mb-1 font-mono">{lastStudent.rollNumber}</div>
                            <div className="text-xl font-bold text-indigo-600 mb-2">{lastStudent.name}</div>
                            {feedback?.status && <span className={`px-4 py-1 rounded-full text-sm font-bold uppercase tracking-widest ${feedback.status === 'present' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>{feedback.status}</span>}
                        </div>
                    ) : <p className="text-slate-300 italic">Speak a number...</p>}
                </div>
                <div className="overflow-y-auto flex-1 p-4 space-y-2 bg-slate-50/50">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Student List</h4>
                    {students.map((student, index) => {
                        const status = attendanceHistory[currentKey]?.[student.id];
                        return (
                            <div key={student.id} className={`flex items-center justify-between p-3 rounded-xl border bg-white ${activeRollCallIndex === index ? 'border-indigo-500 ring-2 ring-indigo-100' : 'border-slate-100'}`}>
                                <div className="flex items-center gap-3 flex-1 min-w-0">
                                    <span className="font-mono text-sm sm:text-base font-bold shrink-0 text-slate-900 bg-slate-100 px-2 py-1 rounded-md">{student.rollNumber}</span>
                                    <span className="font-medium text-slate-700 truncate">{student.name}</span>
                                </div>
                                {status && status !== 'absent' && <span className={`shrink-0 text-xs font-bold px-2 py-1 rounded-md uppercase tracking-wider shadow-sm ml-2 ${status === 'present' ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'bg-amber-100 text-amber-700 border border-amber-200'}`}>{status}</span>}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

function HistoryView({ apiKey, callGemini, attendanceHistory, students, subject, onDownload }) {
    const [report, setReport] = useState(null);
    const [loading, setLoading] = useState(false);
    const [coordinator, setCoordinator] = useState('');
    const [division, setDivision] = useState('');
    const [timings, setTimings] = useState('');
    const [room, setRoom] = useState('');

    const generateReport = async () => {
        if (!apiKey) return alert("Please set API Key in settings");
        setLoading(true);
        try {
            const dataSummary = students.map(s => {
                let present = 0, total = 0;
                Object.keys(attendanceHistory).filter(k => k.includes(subject)).forEach(k => {
                    total++;
                    if (attendanceHistory[k][s.id] === 'present') present++;
                });
                return { name: s.name, rate: total ? Math.round((present / total) * 100) : 0 };
            });

            const prompt = `Analyze this attendance data for ${subject}: ${JSON.stringify(dataSummary)}.\nClass Coordinator: ${coordinator}\nDivision: ${division}\nTimings: ${timings}\nRoom: ${room}\n1. Give a short summary. 2. Identify at-risk students. 3. Draft email to the Class Coordinator with the venue details. Format in Markdown.`;
            const text = await callGemini(prompt, apiKey);
            setReport(text);
        } catch (e) {
            alert("Error: " + e.message);
        }
        setLoading(false);
    };

    const downloadPDF = () => {
        try {
            const doc = new jsPDF();
            const searchKey = `_${subject.replace(/[^a-zA-Z0-9]/g, '_')}_theory`;
            const dates = Object.keys(attendanceHistory).filter(k => k.includes(searchKey)).map(k => k.split('_')[0]).sort();
            const uniqueDates = [...new Set(dates)];

            // Header Info
            doc.setFontSize(20);
            doc.setTextColor(15, 23, 42); // slate-900
            doc.text("MU's Classitra - Attendance Report", 14, 22);

            doc.setFontSize(11);
            doc.setTextColor(100, 116, 139); // slate-500
            doc.text(`Subject: ${subject}`, 14, 32);
            doc.text(`Coordinator: ${coordinator || 'N/A'}`, 14, 38);
            doc.text(`Division: ${division || 'N/A'}`, 100, 32);
            doc.text(`Room: ${room || 'N/A'}`, 100, 38);
            doc.text(`Lecture Timings: ${timings || 'N/A'}`, 14, 44);
            doc.text(`Generated: ${new Date().toLocaleDateString()}`, 100, 44);

            // Table Data Assembly
            const tableCols = ["Roll No", "Student Name", "Batch", ...uniqueDates, "Total", "Rate"];
            const tableRows = students.map(student => {
                let presentCount = 0;
                const dailyStatuses = uniqueDates.map(date => {
                    const status = attendanceHistory[`${date}_${subject.replace(/[^a-zA-Z0-9]/g, '_')}_theory`]?.[student.id] || '-';
                    if (status === 'present') { presentCount++; return 'P'; }
                    if (status === 'late') { return 'L'; }
                    if (status === 'absent') { return 'A'; }
                    return '-';
                });
                const percentage = Math.round((presentCount / (uniqueDates.length || 1)) * 100);
                return [student.rollNumber.toString(), student.name, student.batch, ...dailyStatuses, presentCount.toString(), `${percentage}%`];
            });

            // Draw Table
            autoTable(doc, {
                startY: 52,
                head: [tableCols],
                body: tableRows,
                theme: 'grid',
                headStyles: { fillColor: [79, 70, 229] }, // indigo-600
                styles: { fontSize: 8, cellPadding: 2 },
                columnStyles: {
                    0: { fontStyle: 'bold' },
                    1: { cellWidth: 35 }
                },
                didParseCell: function (data) {
                    if (data.section === 'body' && data.column.index > 2 && data.column.index < tableCols.length - 2) {
                        const val = data.cell.raw;
                        if (val === 'P') data.cell.styles.textColor = [16, 185, 129]; // emerald-500
                        else if (val === 'A') data.cell.styles.textColor = [244, 63, 94]; // rose-500
                        else if (val === 'L') data.cell.styles.textColor = [245, 158, 11]; // amber-500
                    }
                }
            });

            doc.save(`Classitra_${subject.replace(/\s+/g, '_')}.pdf`);
        } catch (err) {
            console.error("PDF generation failed", err);
            alert("Could not generate PDF.");
        }
    };

    return (
        <div className="space-y-6">
            <div className="bg-white p-6 rounded-xl shadow border flex-col flex justify-between gap-6">
                <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 border-b pb-4">
                    <h2 className="text-xl font-bold">Class Reports: {subject}</h2>
                    <div className="flex flex-wrap gap-2 w-full lg:w-auto">
                        <button onClick={() => onDownload(coordinator, division, timings, room)} className="flex-1 lg:flex-none flex items-center justify-center gap-2 bg-slate-100 text-slate-700 hover:text-slate-900 px-4 py-2 rounded-lg font-bold shadow-sm hover:bg-slate-200 transition-colors"><Download size={18} /> CSV</button>
                        <button onClick={downloadPDF} className="flex-1 lg:flex-none flex items-center justify-center gap-2 bg-red-500 text-white px-4 py-2 rounded-lg font-bold shadow hover:bg-red-600 transition-colors"><Download size={18} /> PDF Report</button>
                        <button onClick={generateReport} disabled={loading} className="w-full mt-2 lg:mt-0 lg:w-auto lg:flex-none flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 text-white px-6 py-2 rounded-lg font-bold shadow hover:shadow-lg transition-all">
                            {loading ? <div className="animate-spin w-4 h-4 border-2 border-white/30 border-l-white rounded-full"></div> : <Sparkles size={18} />}
                            {loading ? 'Analyzing...' : 'Generate AI Report'}
                        </button>
                    </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Coordinator Name</label><input type="text" value={coordinator} onChange={(e) => setCoordinator(e.target.value)} placeholder="e.g. Prof. Smith" className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none focus:border-indigo-500" /></div>
                    <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Division Name</label><input type="text" value={division} onChange={(e) => setDivision(e.target.value)} placeholder="e.g. Computer Science A" className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none focus:border-indigo-500" /></div>
                    <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Lecture Timings</label><input type="text" value={timings} onChange={(e) => setTimings(e.target.value)} placeholder="09:00 AM - 11:00 AM" className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none focus:border-indigo-500" /></div>
                    <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Room Location</label><input type="text" value={room} onChange={(e) => setRoom(e.target.value)} placeholder="Block C, Room 302" className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none focus:border-indigo-500" /></div>
                </div>
            </div>
            {report && <div className="bg-white p-8 rounded-xl shadow border prose max-w-none animate-in fade-in slide-in-from-bottom-4"><div dangerouslySetInnerHTML={{ __html: marked.parse(report) }} /></div>}
        </div>
    );
}

function QRCardsView({ students }) {
    const handleDownload = async (student) => {
        try {
            // Create a canvas element
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            // Set canvas dimensions
            const padding = 20;
            const qrSize = 300;
            const textSpace = 80;
            canvas.width = qrSize + (padding * 2);
            canvas.height = qrSize + textSpace + (padding * 2);

            // Fill background white
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Generate QR code onto temporary canvas
            const qrCanvas = document.createElement('canvas');
            await QRCode.toCanvas(qrCanvas, student.rollNumber, {
                width: qrSize,
                margin: 0,
                color: {
                    dark: '#0f172a',  // Slate 900
                    light: '#FFFFFF'
                }
            });

            // Draw QR code onto main canvas
            ctx.drawImage(qrCanvas, padding, padding);

            // Draw Student Info
            ctx.textAlign = 'center';
            ctx.fillStyle = '#1e293b'; // Slate 800

            // Name
            ctx.font = 'bold 24px sans-serif';
            ctx.fillText(student.name, canvas.width / 2, padding + qrSize + 35);

            // Roll Number
            ctx.font = '20px monospace';
            ctx.fillStyle = '#64748b'; // Slate 500
            ctx.fillText(`Roll No: ${student.rollNumber}`, canvas.width / 2, padding + qrSize + 65);

            // Trigger download
            const link = document.createElement('a');
            link.download = `${student.name.replace(/\s+/g, '_')}_QR.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();

        } catch (err) {
            console.error('Error generating QR:', err);
            alert('Failed to generate QR code image.');
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center bg-white p-6 rounded-xl shadow-sm border border-slate-200 no-print">
                <div><h2 className="text-lg font-bold text-slate-900">Student ID Cards</h2><p className="text-sm text-slate-500">Print these and give them to students.</p></div>
                <button onClick={() => window.print()} className="flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-lg hover:bg-slate-800 transition-colors"><Printer size={18} /> Print Cards</button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 print:grid-cols-2 print:gap-4">
                {students.map(student => (
                    <div key={student.id} className="bg-white p-6 rounded-xl border-2 border-slate-200 flex items-center gap-4 break-inside-avoid print:border-black relative">
                        <img src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${student.rollNumber}`} alt="QR" className="w-24 h-24 border p-1 rounded" />
                        <div>
                            <h3 className="font-bold text-lg text-slate-900">{student.name}</h3>
                            <p className="text-slate-500 font-mono text-sm">Roll: {student.rollNumber}</p>
                            <div className="flex gap-2 mt-2"><span className="inline-block bg-slate-100 text-slate-600 text-xs px-2 py-1 rounded">Batch {student.batch}</span></div>
                        </div>
                        <button onClick={() => handleDownload(student)} className="absolute top-4 right-4 text-slate-400 hover:text-indigo-600 no-print transition-colors" title="Download Labeled QR">
                            <Download size={20} />
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}

function SubjectManager({ subjects, onAdd, onRemove }) {
    const [newSub, setNewSub] = useState('');
    return (
        <div className="max-w-2xl mx-auto space-y-6">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                <h2 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2"><Book className="text-indigo-600" size={20} /> Manage Subjects</h2>
                <form onSubmit={(e) => { e.preventDefault(); if (newSub.trim()) { onAdd(newSub.trim()); setNewSub(''); } }} className="flex gap-4">
                    <input type="text" value={newSub} onChange={(e) => setNewSub(e.target.value)} placeholder="e.g. Computer Networks" className="flex-1 px-4 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500" />
                    <button type="submit" className="bg-indigo-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-indigo-700">Add</button>
                </form>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-slate-200">
                <ul className="divide-y divide-slate-100">{subjects.map(sub => (<li key={sub} className="flex items-center justify-between p-4 hover:bg-slate-50"><span className="font-medium text-slate-700">{sub}</span><button onClick={() => onRemove(sub)} className="text-slate-400 hover:text-rose-500 p-2"><Trash2 size={18} /></button></li>))}</ul>
            </div>
        </div>
    );
}

function StudentManager({ students, onAdd, onRemove }) {
    const [name, setName] = useState('');
    const [roll, setRoll] = useState('');
    const [batch, setBatch] = useState('A');
    return (
        <div className="max-w-2xl mx-auto space-y-6">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                <h2 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2"><Plus className="text-indigo-600" size={20} /> Add New Student</h2>
                <form onSubmit={(e) => { e.preventDefault(); if (name && roll) { onAdd(name, roll, batch); setName(''); setRoll(''); } }} className="flex gap-4 items-end flex-wrap">
                    <div className="flex-1 min-w-[200px]"><label className="block text-sm font-medium text-slate-700 mb-1">Full Name</label><input required type="text" placeholder="e.g. John Doe" value={name} onChange={e => setName(e.target.value)} className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none focus:border-indigo-500" /></div>
                    <div className="w-24"><label className="block text-sm font-medium text-slate-700 mb-1">Roll No</label><input required type="text" placeholder="101" value={roll} onChange={e => setRoll(e.target.value)} className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none focus:border-indigo-500" /></div>
                    <div className="w-24"><label className="block text-sm font-medium text-slate-700 mb-1">Batch</label><select value={batch} onChange={e => setBatch(e.target.value)} className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none focus:border-indigo-500 bg-white"><option value="A">A</option><option value="B">B</option></select></div>
                    <button type="submit" className="px-6 py-2 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 transition-colors">Add</button>
                </form>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <table className="w-full text-left hidden sm:table"><thead className="bg-slate-50 border-b border-slate-200"><tr><th className="px-2 sm:px-6 py-2 sm:py-4 text-[10px] sm:text-xs font-semibold text-slate-500 uppercase">Roll No</th><th className="px-2 sm:px-6 py-2 sm:py-4 text-[10px] sm:text-xs font-semibold text-slate-500 uppercase">Name</th><th className="px-2 sm:px-6 py-2 sm:py-4 text-[10px] sm:text-xs font-semibold text-slate-500 uppercase hidden sm:table-cell">Batch</th><th className="px-2 sm:px-6 py-2 sm:py-4 text-right text-[10px] sm:text-xs font-semibold text-slate-500 uppercase w-10">Action</th></tr></thead><tbody className="divide-y divide-slate-100">{students.map(s => (<tr key={s.id} className="hover:bg-slate-50"><td className="px-2 sm:px-6 py-3 sm:py-4 font-mono text-xs sm:text-sm text-slate-600">{s.rollNumber}</td><td className="px-2 sm:px-6 py-3 sm:py-4 font-medium text-xs sm:text-sm text-slate-800"><div className="truncate w-20 sm:w-auto">{s.name}</div></td><td className="px-2 sm:px-6 py-3 sm:py-4 hidden sm:table-cell"><span className="bg-slate-100 px-2 py-1 rounded text-[10px] sm:text-xs font-bold">{s.batch}</span></td><td className="px-2 sm:px-6 py-3 sm:py-4 text-right select-none w-10 shrink-0"><button onClick={() => onRemove(s.id)} className="text-rose-500 hover:text-rose-700 p-2 hover:bg-rose-50 rounded-lg transition-colors shrink-0"><Trash2 size={18} /></button></td></tr>))}</tbody></table>
                <div className="block sm:hidden divide-y divide-slate-100">
                    {students.map(s => (
                        <div key={s.id} className="p-4 hover:bg-slate-50 flex justify-between items-center gap-4 transition-colors">
                            <div className="flex-1 min-w-0">
                                <h4 className="text-[18px] font-bold text-slate-900 leading-tight mb-2 uppercase break-words">{s.name}</h4>
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-sm font-mono font-medium text-slate-500 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-md">{s.rollNumber}</span>
                                    <span className="bg-indigo-50 px-2 py-0.5 rounded-md text-xs font-bold text-indigo-700 border border-indigo-100 shadow-sm">Batch {s.batch}</span>
                                </div>
                            </div>
                            <button onClick={() => onRemove(s.id)} className="text-rose-500 hover:text-white p-3 hover:bg-rose-500 bg-rose-50 rounded-xl transition-colors shrink-0 shadow-sm border border-rose-100 active:scale-95"><Trash2 size={24} /></button>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}