import React, { useState, useEffect } from 'react';
import { Settings, Bell, Mail, Clock, Check, Save, RotateCcw } from 'lucide-react';

export default function SettingsView({ policies, onUpdatePolicy }) {
  const [activeTab, setActiveTab] = useState('policies'); // policies, templates, business
  const [selectedPolicyId, setSelectedPolicyId] = useState(1);
  const [policyForm, setPolicyForm] = useState({
    first_reminder_hours: 24,
    second_reminder_hours: 48,
    escalation_hours: 72,
    deadline_reminder_hours: 12,
    repeat_enabled: true
  });
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [policySavedMsg, setPolicySavedMsg] = useState(false);

  // Email Templates state
  const [templates, setTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState(null);
  const [templateSubject, setTemplateSubject] = useState('');
  const [templateBody, setTemplateBody] = useState('');
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateSavedMsg, setTemplateSavedMsg] = useState(false);

  // Load policies into form
  useEffect(() => {
    const current = policies.find((p) => p.id === parseInt(selectedPolicyId, 10));
    if (current) {
      setPolicyForm({
        first_reminder_hours: current.first_reminder_hours,
        second_reminder_hours: current.second_reminder_hours,
        escalation_hours: current.escalation_hours,
        deadline_reminder_hours: current.deadline_reminder_hours,
        repeat_enabled: !!current.repeat_enabled
      });
    }
  }, [selectedPolicyId, policies]);

  // Load templates
  const fetchTemplates = async () => {
    try {
      const res = await fetch('/api/settings/templates');
      const data = await res.json();
      if (data.success && data.templates?.length) {
        setTemplates(data.templates);
        if (!selectedTemplateId) {
          setSelectedTemplateId(data.templates[0].id);
          setTemplateSubject(data.templates[0].subject);
          setTemplateBody(data.templates[0].body);
        }
      }
    } catch (err) {
      console.error('Error fetching templates:', err);
    }
  };

  useEffect(() => {
    fetchTemplates();
  }, []);

  const handleSelectTemplate = (id) => {
    setSelectedTemplateId(id);
    const t = templates.find((item) => item.id === parseInt(id, 10));
    if (t) {
      setTemplateSubject(t.subject);
      setTemplateBody(t.body);
    }
  };

  const handleSavePolicy = async (e) => {
    e.preventDefault();
    try {
      setSavingPolicy(true);
      await onUpdatePolicy({
        policy_id: selectedPolicyId,
        ...policyForm
      });
      setPolicySavedMsg(true);
      setTimeout(() => setPolicySavedMsg(false), 3000);
    } catch (err) {
      alert('Error updating policy: ' + err.message);
    } finally {
      setSavingPolicy(false);
    }
  };

  const handleSaveTemplate = async (e) => {
    e.preventDefault();
    try {
      setSavingTemplate(true);
      const res = await fetch(`/api/settings/templates/${selectedTemplateId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: templateSubject,
          body: templateBody
        })
      });
      const data = await res.json();
      if (data.success) {
        setTemplateSavedMsg(true);
        setTimeout(() => setTemplateSavedMsg(false), 3000);
        await fetchTemplates();
      }
    } catch (err) {
      alert('Error saving template: ' + err.message);
    } finally {
      setSavingTemplate(false);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: '1.25rem' }}>
        <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.45rem', fontWeight: 700 }}>
          System Settings & Follow-Up Configuration
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          Configure dynamic reminder thresholds, escalation rules, and notification templates without code changes (Section 5.5, AT-12).
        </p>
      </div>

      <div className="tabs-container">
        <button
          className={`tab-btn ${activeTab === 'policies' ? 'active' : ''}`}
          onClick={() => setActiveTab('policies')}
          id="settings-tab-policies"
        >
          <Bell size={16} /> Reminder Policies & Escalations
        </button>

        <button
          className={`tab-btn ${activeTab === 'templates' ? 'active' : ''}`}
          onClick={() => setActiveTab('templates')}
          id="settings-tab-templates"
        >
          <Mail size={16} /> Email Templates (Section 11)
        </button>

        <button
          className={`tab-btn ${activeTab === 'business' ? 'active' : ''}`}
          onClick={() => setActiveTab('business')}
          id="settings-tab-business"
        >
          <Clock size={16} /> Business Hours & Timezone
        </button>
      </div>

      {/* TAB 1: REMINDER POLICIES */}
      {activeTab === 'policies' && (
        <div style={{ background: '#ffffff', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: '1.5rem', maxWidth: '800px' }}>
          <div style={{ marginBottom: '1.25rem' }}>
            <label className="form-label" style={{ fontSize: '0.9rem' }}>Select Policy to Configure</label>
            <select
              className="filter-select"
              value={selectedPolicyId}
              onChange={(e) => setSelectedPolicyId(parseInt(e.target.value, 10))}
              style={{ width: '100%', padding: '0.65rem' }}
              id="select-policy-dropdown"
            >
              {policies.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} (ID: {p.id})
                </option>
              ))}
            </select>
          </div>

          <form onSubmit={handleSavePolicy}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', marginBottom: '1.25rem' }}>
              <div className="form-group">
                <label className="form-label">
                  First Inactivity Reminder (Hours)
                </label>
                <input
                  type="number"
                  step="0.5"
                  className="form-input"
                  value={policyForm.first_reminder_hours}
                  onChange={(e) => setPolicyForm({ ...policyForm, first_reminder_hours: parseFloat(e.target.value) })}
                  required
                  id="policy-first-reminder-hours"
                />
                <span style={{ fontSize: '0.725rem', color: 'var(--text-muted)' }}>
                  Time elapsed without employee progress update before 1st notice.
                </span>
              </div>

              <div className="form-group">
                <label className="form-label">
                  Second Inactivity Reminder (Hours)
                </label>
                <input
                  type="number"
                  step="0.5"
                  className="form-input"
                  value={policyForm.second_reminder_hours}
                  onChange={(e) => setPolicyForm({ ...policyForm, second_reminder_hours: parseFloat(e.target.value) })}
                  required
                  id="policy-second-reminder-hours"
                />
                <span style={{ fontSize: '0.725rem', color: 'var(--text-muted)' }}>
                  Second notice warning of imminent Founder escalation.
                </span>
              </div>

              <div className="form-group">
                <label className="form-label">
                  Escalation Threshold (Hours)
                </label>
                <input
                  type="number"
                  step="0.5"
                  className="form-input"
                  value={policyForm.escalation_hours}
                  onChange={(e) => setPolicyForm({ ...policyForm, escalation_hours: parseFloat(e.target.value) })}
                  required
                  id="policy-escalation-hours"
                />
                <span style={{ fontSize: '0.725rem', color: 'var(--text-muted)' }}>
                  Triggers high-priority alert to Founder Vikram Singhania & Admin.
                </span>
              </div>

              <div className="form-group">
                <label className="form-label">
                  Approaching Deadline Alert (Hours Before)
                </label>
                <input
                  type="number"
                  step="0.5"
                  className="form-input"
                  value={policyForm.deadline_reminder_hours}
                  onChange={(e) => setPolicyForm({ ...policyForm, deadline_reminder_hours: parseFloat(e.target.value) })}
                  required
                  id="policy-deadline-hours"
                />
                <span style={{ fontSize: '0.725rem', color: 'var(--text-muted)' }}>
                  Advance notice sent before task deadline is reached.
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '1rem', borderTop: '1px solid var(--border-subtle)' }}>
              {policySavedMsg ? (
                <span style={{ color: '#16a34a', fontWeight: 600, fontSize: '0.85rem' }}>
                  ✓ Policy configuration saved and live in scheduler!
                </span>
              ) : (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Changes take effect immediately without restarting server.
                </span>
              )}

              <button type="submit" className="btn-primary" disabled={savingPolicy} id="save-policy-btn">
                <Save size={14} /> {savingPolicy ? 'Saving...' : 'Save Policy Settings'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* TAB 2: EMAIL TEMPLATES */}
      {activeTab === 'templates' && (
        <div style={{ background: '#ffffff', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: '1.5rem', maxWidth: '850px' }}>
          <div style={{ marginBottom: '1.25rem' }}>
            <label className="form-label" style={{ fontSize: '0.9rem' }}>Select Email Event Template (Section 11)</label>
            <select
              className="filter-select"
              value={selectedTemplateId || ''}
              onChange={(e) => handleSelectTemplate(e.target.value)}
              style={{ width: '100%', padding: '0.65rem' }}
              id="select-template-dropdown"
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.template_key} — {t.subject}
                </option>
              ))}
            </select>
          </div>

          <form onSubmit={handleSaveTemplate}>
            <div className="form-group" style={{ marginBottom: '1rem' }}>
              <label className="form-label">Subject Line</label>
              <input
                type="text"
                className="form-input"
                value={templateSubject}
                onChange={(e) => setTemplateSubject(e.target.value)}
                required
                id="template-subject-input"
              />
            </div>

            <div className="form-group" style={{ marginBottom: '1rem' }}>
              <label className="form-label">Email Body (HTML with Placeholders)</label>
              <textarea
                className="form-textarea"
                value={templateBody}
                onChange={(e) => setTemplateBody(e.target.value)}
                style={{ minHeight: '140px', fontFamily: 'monospace', fontSize: '0.85rem' }}
                required
                id="template-body-textarea"
              />
              <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                Supported placeholders: <code>{'{{task_id}}'}</code>, <code>{'{{task_title}}'}</code>, <code>{'{{assignee_name}}'}</code>, <code>{'{{creator_name}}'}</code>, <code>{'{{hours_inactive}}'}</code>, <code>{'{{deadline}}'}</code>, <code>{'{{task_link}}'}</code>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '1rem', borderTop: '1px solid var(--border-subtle)' }}>
              {templateSavedMsg ? (
                <span style={{ color: '#16a34a', fontWeight: 600, fontSize: '0.85rem' }}>
                  ✓ Template updated successfully!
                </span>
              ) : <div />}

              <button type="submit" className="btn-primary" disabled={savingTemplate} id="save-template-btn">
                <Save size={14} /> {savingTemplate ? 'Saving...' : 'Update Template'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* TAB 3: BUSINESS HOURS & TIMEZONE */}
      {activeTab === 'business' && (
        <div style={{ background: '#ffffff', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: '1.5rem', maxWidth: '700px' }}>
          <h4 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem' }}>
            Enterprise Timezone & Working Hours
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', fontSize: '0.875rem' }}>
            <div>
              <strong>Primary Operating Timezone:</strong>
              <div style={{ background: '#f8fafc', padding: '0.65rem 0.85rem', borderRadius: 'var(--radius-sm)', marginTop: '0.35rem' }}>
                Asia/Kolkata (IST — UTC+05:30)
              </div>
            </div>
            <div>
              <strong>Working Hours Window:</strong>
              <div style={{ background: '#f8fafc', padding: '0.65rem 0.85rem', borderRadius: 'var(--radius-sm)', marginTop: '0.35rem' }}>
                09:30 AM to 06:30 PM (Mon – Fri)
              </div>
            </div>
            <div>
              <strong>Scheduler Frequency:</strong>
              <div style={{ background: '#f8fafc', padding: '0.65rem 0.85rem', borderRadius: 'var(--radius-sm)', marginTop: '0.35rem' }}>
                Continuous inspection every 60 seconds with duplicate prevention logic.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
