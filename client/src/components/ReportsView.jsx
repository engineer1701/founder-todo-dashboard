import React, { useState, useEffect } from 'react';
import { BarChart3, Download, Users, CheckCircle, AlertTriangle, Clock, RefreshCw } from 'lucide-react';

export default function ReportsView({ departments }) {
  const [reportData, setReportData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedDept, setSelectedDept] = useState('');

  const fetchReports = async () => {
    try {
      setLoading(true);
      const url = selectedDept ? `/api/reports/tasks?department_id=${selectedDept}` : '/api/reports/tasks';
      const res = await fetch(url);
      const data = await res.json();
      if (data.success) {
        setReportData(data);
      }
    } catch (err) {
      console.error('Error fetching reports:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
  }, [selectedDept]);

  const handleExportCSV = () => {
    if (!reportData?.employeeReports) return;
    const headers = ['Employee Name', 'Department', 'Assigned Tasks', 'Completed', 'Pending', 'Overdue', 'No Update', 'Completion Rate %', 'Avg Completion Hours'];
    const rows = reportData.employeeReports.map(e => [
      `"${e.name}"`,
      `"${e.department || ''}"`,
      e.assigned_tasks,
      e.completed_tasks,
      e.pending_tasks,
      e.overdue_tasks,
      e.no_update_tasks,
      `${e.completion_rate_pct}%`,
      e.avg_completion_hours
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `founder_tasks_report_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const overall = reportData?.overall || {
    total_tasks: 0,
    total_completed: 0,
    total_pending: 0,
    total_overdue: 0,
    total_no_update: 0,
    overall_completion_rate: 0
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.45rem', fontWeight: 700 }}>
            Operational & Employee Performance Reports
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Real-time analytics on assigned work, delivery velocity, and follow-up delays (US-10).
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <select
            className="filter-select"
            value={selectedDept}
            onChange={(e) => setSelectedDept(e.target.value)}
            id="reports-department-select"
          >
            <option value="">All Departments</option>
            {departments.map(d => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>

          <button className="btn-secondary" onClick={fetchReports} title="Refresh Live Analytics">
            <RefreshCw size={14} />
          </button>

          <button className="btn-primary" onClick={handleExportCSV} id="export-csv-btn">
            <Download size={14} /> Export CSV
          </button>
        </div>
      </div>

      {/* Organizational Summary Cards */}
      <div className="metrics-grid" style={{ marginBottom: '1.75rem' }}>
        <div className="metric-card">
          <div className="metric-header">
            <span>Total Deliverables</span>
            <Users size={16} />
          </div>
          <div className="metric-val">{overall.total_tasks}</div>
        </div>

        <div className="metric-card">
          <div className="metric-header">
            <span>Completed Work</span>
            <CheckCircle size={16} color="#16a34a" />
          </div>
          <div className="metric-val" style={{ color: '#16a34a' }}>{overall.total_completed}</div>
        </div>

        <div className="metric-card">
          <div className="metric-header">
            <span>Pending Work</span>
            <Clock size={16} color="#3b82f6" />
          </div>
          <div className="metric-val" style={{ color: '#3b82f6' }}>{overall.total_pending}</div>
        </div>

        <div className="metric-card card-overdue">
          <div className="metric-header">
            <span>Overdue Tasks</span>
            <AlertTriangle size={16} color="#dc2626" />
          </div>
          <div className="metric-val">{overall.total_overdue}</div>
        </div>

        <div className="metric-card card-no-update">
          <div className="metric-header">
            <span>No-Update Inactive</span>
            <Clock size={16} color="#d97706" />
          </div>
          <div className="metric-val">{overall.total_no_update}</div>
        </div>

        <div className="metric-card">
          <div className="metric-header">
            <span>Completion Rate</span>
            <BarChart3 size={16} color="#2563eb" />
          </div>
          <div className="metric-val">{overall.overall_completion_rate}%</div>
        </div>
      </div>

      {/* Employee-wise Table */}
      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Employee & Role</th>
              <th>Department</th>
              <th>Assigned</th>
              <th>Completed</th>
              <th>Pending</th>
              <th>Overdue</th>
              <th>No Update</th>
              <th style={{ width: '180px' }}>Completion Rate</th>
              <th>Avg Completion Time</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="9" style={{ textAlign: 'center', padding: '2rem' }}>Loading report metrics...</td>
              </tr>
            ) : !reportData?.employeeReports?.length ? (
              <tr>
                <td colSpan="9" style={{ textAlign: 'center', padding: '2rem' }}>No employee records found.</td>
              </tr>
            ) : (
              reportData.employeeReports.map((emp) => (
                <tr key={emp.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <img
                        src={emp.avatar_url || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=160&q=80'}
                        alt={emp.name}
                        className="assignee-avatar"
                        style={{ width: '28px', height: '28px' }}
                      />
                      <div>
                        <div style={{ fontWeight: 600 }}>{emp.name}</div>
                        <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)' }}>{emp.designation}</div>
                      </div>
                    </div>
                  </td>

                  <td>{emp.department || 'General'}</td>
                  <td><strong>{emp.assigned_tasks}</strong></td>
                  <td><span style={{ color: '#16a34a', fontWeight: 600 }}>{emp.completed_tasks}</span></td>
                  <td>{emp.pending_tasks}</td>
                  <td>
                    {emp.overdue_tasks > 0 ? (
                      <span className="badge badge-overdue">{emp.overdue_tasks} Overdue</span>
                    ) : (
                      '0'
                    )}
                  </td>
                  <td>
                    {emp.no_update_tasks > 0 ? (
                      <span className="badge badge-awaiting">{emp.no_update_tasks} Inactive</span>
                    ) : (
                      '0'
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <div style={{ flex: 1, height: '6px', background: '#e2e8f0', borderRadius: '4px', overflow: 'hidden' }}>
                        <div
                          style={{
                            width: `${emp.completion_rate_pct}%`,
                            height: '100%',
                            background: '#2563eb'
                          }}
                        />
                      </div>
                      <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>{emp.completion_rate_pct}%</span>
                    </div>
                  </td>
                  <td>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {emp.avg_completion_hours !== 'N/A' ? `${emp.avg_completion_hours} hrs` : 'N/A'}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
