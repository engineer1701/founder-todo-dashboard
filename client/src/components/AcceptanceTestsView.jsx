import React, { useState, useEffect } from 'react';
import { ShieldCheck, Play, CheckCircle2, XCircle, Clock, Check } from 'lucide-react';

export default function AcceptanceTestsView() {
  const [testResults, setTestResults] = useState(null);
  const [running, setRunning] = useState(false);

  const runTests = async () => {
    try {
      setRunning(true);
      const res = await fetch('/api/tests/run');
      const data = await res.json();
      setTestResults(data);
    } catch (err) {
      alert('Error running acceptance tests: ' + err.message);
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    runTests();
  }, []);

  const summary = testResults?.summary || { total: 12, passed: 0, failed: 0 };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.45rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <ShieldCheck size={26} color="#16a34a" /> Automated Acceptance Test Suite (AT-01 – AT-12)
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Verification harness executing all 12 test specifications defined in Section 16 against live SQLite database.
          </p>
        </div>

        <button
          className="btn-primary"
          onClick={runTests}
          disabled={running}
          id="run-all-tests-btn"
          style={{ background: '#16a34a', borderColor: '#15803d' }}
        >
          <Play size={14} /> {running ? 'Running Test Suite...' : 'Re-Run All Acceptance Tests'}
        </button>
      </div>

      {/* Test Scorecard */}
      <div className="metrics-grid" style={{ marginBottom: '1.5rem', gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="metric-card">
          <div className="metric-header">
            <span>Total Test Specs</span>
            <ShieldCheck size={16} />
          </div>
          <div className="metric-val">{summary.total}</div>
        </div>

        <div className="metric-card">
          <div className="metric-header">
            <span style={{ color: '#16a34a' }}>Passed Tests</span>
            <CheckCircle2 size={16} color="#16a34a" />
          </div>
          <div className="metric-val" style={{ color: '#16a34a' }}>
            {summary.passed} / {summary.total}
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-header">
            <span>Failed Tests</span>
            <XCircle size={16} color={summary.failed > 0 ? '#dc2626' : '#94a3b8'} />
          </div>
          <div className="metric-val" style={{ color: summary.failed > 0 ? '#dc2626' : '#16a34a' }}>
            {summary.failed}
          </div>
        </div>
      </div>

      {/* Tests List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
        {running && !testResults ? (
          <div style={{ padding: '3rem', textAlign: 'center' }}>Executing acceptance assertions...</div>
        ) : (
          testResults?.results?.map((t) => {
            const isPassed = t.status === 'PASSED';
            return (
              <div
                key={t.id}
                style={{
                  background: '#ffffff',
                  border: '1px solid var(--border-subtle)',
                  borderLeft: isPassed ? '5px solid #16a34a' : '5px solid #dc2626',
                  borderRadius: 'var(--radius-md)',
                  padding: '1rem 1.25rem',
                  boxShadow: 'var(--shadow-xs)'
                }}
                id={`test-card-${t.id}`}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <span className="task-id-badge" style={{ background: isPassed ? '#dcfce7' : '#fee2e2', color: isPassed ? '#15803d' : '#b91c1c' }}>
                      {t.id}
                    </span>
                    <strong style={{ fontSize: '0.95rem' }}>{t.name}</strong>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      <Clock size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '2px' }} />
                      {t.duration_ms} ms
                    </span>
                    <span className={`badge ${isPassed ? 'badge-completed' : 'badge-overdue'}`}>
                      {isPassed ? '✓ PASSED' : '✕ FAILED'}
                    </span>
                  </div>
                </div>

                <div style={{ fontSize: '0.825rem', color: isPassed ? '#1e293b' : '#dc2626', background: isPassed ? '#f8fafc' : '#fef2f2', padding: '0.6rem 0.85rem', borderRadius: 'var(--radius-sm)', marginTop: '0.4rem', fontFamily: 'monospace' }}>
                  {t.details || t.error}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
