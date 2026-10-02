import React, { useState } from 'react';
import { FastForward, Play, RotateCcw, Clock } from 'lucide-react';

export default function SimulationBar({
  timeOffsetHours,
  onAdvanceTime,
  onResetTime,
  onRunScheduler,
  schedulerRunning
}) {
  const [lastActionMsg, setLastActionMsg] = useState(null);

  const handleAdvance = async (hours) => {
    const res = await onAdvanceTime(hours);
    if (res?.simulated_time_ist) {
      setLastActionMsg(`Clock advanced +${hours}h (${res.simulated_time_ist})`);
      setTimeout(() => setLastActionMsg(null), 4000);
    }
  };

  const handleReset = async () => {
    await onResetTime();
    setLastActionMsg('Simulation clock reset to Real-Time.');
    setTimeout(() => setLastActionMsg(null), 3000);
  };

  const handleRunNow = async () => {
    const res = await onRunScheduler();
    if (res?.result) {
      setLastActionMsg(`Scheduler executed: ${res.result.remindersSent} reminders, ${res.result.escalationsSent} escalations dispatched (${res.result.skippedDuplicates} duplicates prevented).`);
      setTimeout(() => setLastActionMsg(null), 5000);
    }
  };

  return (
    <div className="simulation-bar">
      <div className="sim-info">
        <span className="sim-badge">Test & Demo Engine</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <Clock size={14} />
          <span>
            Business Clock: <strong>{timeOffsetHours > 0 ? `+${timeOffsetHours}h Fast-Forwarded` : 'Real-Time IST (Asia/Kolkata)'}</strong>
          </span>
        </div>
        {lastActionMsg && (
          <span style={{ color: '#86efac', fontWeight: 600, fontSize: '0.75rem', marginLeft: '0.5rem' }}>
            ✓ {lastActionMsg}
          </span>
        )}
      </div>

      <div className="sim-controls">
        <span style={{ fontSize: '0.75rem', color: '#a5b4fc' }}>Fast-forward:</span>
        <button className="sim-btn" onClick={() => handleAdvance(12)} id="sim-add-12h">
          <FastForward size={12} /> +12h
        </button>
        <button className="sim-btn" onClick={() => handleAdvance(24)} id="sim-add-24h">
          <FastForward size={12} /> +24h (1st Reminder)
        </button>
        <button className="sim-btn" onClick={() => handleAdvance(48)} id="sim-add-48h">
          <FastForward size={12} /> +48h (2nd Reminder)
        </button>
        <button className="sim-btn" onClick={() => handleAdvance(72)} id="sim-add-72h">
          <FastForward size={12} /> +72h (Escalation)
        </button>
        {timeOffsetHours > 0 && (
          <button className="sim-btn" onClick={handleReset} style={{ background: 'rgba(239, 68, 68, 0.25)', borderColor: '#ef4444' }} id="sim-reset-time">
            <RotateCcw size={12} /> Reset Time
          </button>
        )}
        <button
          className="sim-btn"
          onClick={handleRunNow}
          disabled={schedulerRunning}
          style={{ background: '#3b82f6', borderColor: '#60a5fa', fontWeight: 600 }}
          id="sim-run-scheduler"
        >
          <Play size={12} /> {schedulerRunning ? 'Scanning...' : 'Run Scheduler Now'}
        </button>
      </div>
    </div>
  );
}
