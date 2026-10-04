import React, { useState, useEffect } from 'react';
import { Mail, RefreshCw, Trash2, ExternalLink, Send, CheckCircle2 } from 'lucide-react';

export default function MailboxView({ onOpenTaskFromEmail, isManager }) {
  const [emails, setEmails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedEmail, setSelectedEmail] = useState(null);

  const fetchEmails = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/emails?limit=100');
      const data = await res.json();
      if (data.success) {
        setEmails(data.emails || []);
        if (data.emails?.length > 0 && !selectedEmail) {
          setSelectedEmail(data.emails[0]);
        }
      }
    } catch (err) {
      console.error('Error fetching sent emails:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEmails();
  }, []);

  const handleClearInbox = async () => {
    if (!window.confirm('Clear all simulated sent emails?')) return;
    try {
      await fetch('/api/emails/clear', { method: 'DELETE' });
      setEmails([]);
      setSelectedEmail(null);
    } catch (err) {
      alert('Error clearing mailbox: ' + err.message);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.45rem', fontWeight: 700 }}>
            Automated Reminder & Notification Simulator
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Live inspection inbox for emails dispatched by the reminder engine, assignment events, and escalations (Section 11, AT-11).
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn-secondary" onClick={fetchEmails} title="Refresh Live Mailbox">
            <RefreshCw size={14} /> Refresh
          </button>
          {isManager && emails.length > 0 && (
            <button className="btn-secondary" onClick={handleClearInbox} style={{ color: '#dc2626' }}>
              <Trash2 size={14} /> Clear Mailbox
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: '1.25rem', minHeight: '550px' }}>
        {/* Email List Left Column */}
        <div style={{ background: '#ffffff', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '0.75rem 1rem', background: '#f8fafc', borderBottom: '1px solid var(--border-subtle)', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>
            Dispatched Emails ({emails.length})
          </div>

          <div style={{ flex: 1, overflowY: 'auto', maxHeight: '550px' }}>
            {loading ? (
              <div style={{ padding: '2rem', textAlign: 'center' }}>Loading emails...</div>
            ) : emails.length === 0 ? (
              <div className="empty-state">
                <Mail size={32} />
                <p>No emails dispatched yet.</p>
                <span style={{ fontSize: '0.75rem' }}>Advance time or allocate a task to see email alerts.</span>
              </div>
            ) : (
              emails.map((e) => {
                const isSelected = selectedEmail?.id === e.id;
                return (
                  <div
                    key={e.id}
                    onClick={() => setSelectedEmail(e)}
                    style={{
                      padding: '0.85rem 1rem',
                      borderBottom: '1px solid var(--border-subtle)',
                      background: isSelected ? 'var(--primary-50)' : 'transparent',
                      cursor: 'pointer',
                      borderLeft: isSelected ? '4px solid var(--primary-600)' : '4px solid transparent',
                      transition: 'background var(--transition-fast)'
                    }}
                    id={`email-item-${e.id}`}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem', alignItems: 'center' }}>
                      <span className="badge badge-hold" style={{ fontSize: '0.7rem' }}>
                        {e.event_type}
                      </span>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        {new Date(e.sent_at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    </div>

                    <div style={{ fontWeight: 600, fontSize: '0.825rem', color: 'var(--text-main)', marginBottom: '0.2rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {e.subject}
                    </div>

                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      To: {e.recipient_name} ({e.recipient_email})
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Email Viewer Right Column */}
        <div style={{ background: '#ffffff', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {selectedEmail ? (
            <>
              {/* Email Header */}
              <div style={{ padding: '1.25rem', background: '#f8fafc', borderBottom: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-main)' }}>
                    {selectedEmail.subject}
                  </h3>
                  <span className="badge badge-progress">{selectedEmail.event_type}</span>
                </div>

                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                  <div>
                    <strong>Recipient:</strong> {selectedEmail.recipient_name} &lt;{selectedEmail.recipient_email}&gt;
                  </div>
                  <div>
                    <strong>Timestamp:</strong> {new Date(selectedEmail.sent_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                  </div>
                  {selectedEmail.task_id && (
                    <div style={{ marginTop: '0.35rem' }}>
                      <button
                        className="btn-primary"
                        style={{ padding: '0.3rem 0.75rem', fontSize: '0.775rem' }}
                        onClick={() => onOpenTaskFromEmail(selectedEmail.task_id)}
                        id="open-task-from-email-btn"
                      >
                        <ExternalLink size={12} /> Open Task {selectedEmail.task_id} Directly (AT-11)
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Rendered HTML Email Body */}
              <div
                style={{
                  padding: '1.75rem',
                  flex: 1,
                  overflowY: 'auto',
                  lineHeight: 1.6,
                  fontFamily: 'sans-serif'
                }}
                dangerouslySetInnerHTML={{ __html: selectedEmail.body_html }}
              />
            </>
          ) : (
            <div className="empty-state" style={{ margin: 'auto' }}>
              <Mail size={48} />
              <h4>Select an email from the left column to view rendered message</h4>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
