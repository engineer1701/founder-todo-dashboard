import React, { useState, useEffect } from 'react';
import { useAuth } from './auth/AuthContext';
import Header from './components/Header';
import LoginView from './components/LoginView';
import SimulationBar from './components/SimulationBar';
import DashboardView from './components/DashboardView';
import EmployeeView from './components/EmployeeView';
import ReportsView from './components/ReportsView';
import MailboxView from './components/MailboxView';
import SettingsView from './components/SettingsView';
import AcceptanceTestsView from './components/AcceptanceTestsView';
import TaskDetailModal from './components/TaskDetailModal';
import CreateTaskModal from './components/CreateTaskModal';

const apiErrorMessage = (data, fallback) => data?.error?.message || data?.error || fallback;

export default function App() {
  const { user: currentUser, loading: authLoading, devToolsEnabled, logout, switchDevUser } = useAuth();
  const [activeNav, setActiveNav] = useState('dashboard');
  const [users, setUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [policies, setPolicies] = useState([]);
  const [dashboardData, setDashboardData] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [taskPage, setTaskPage] = useState(1);
  const [taskPageSize, setTaskPageSize] = useState(10);
  const [taskPagination, setTaskPagination] = useState({ page: 1, totalPages: 1, total: 0, limit: 10 });
  const [loading, setLoading] = useState(true);
  const [schedulerRunning, setSchedulerRunning] = useState(false);
  const [timeOffsetHours, setTimeOffsetHours] = useState(0);

  // Modals & Navigation Deep-linking
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [activeFilterCard, setActiveFilterCard] = useState(null);
  const [toasts, setToasts] = useState([]);

  const addToast = (message, type = 'info') => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  // Initial Data Fetch
  const fetchMetadata = async () => {
    try {
      if (!currentUser) return;
      const isManager = ['founder', 'admin'].includes(currentUser.role);
      if (!isManager && !import.meta.env.DEV) {
        setUsers([currentUser]);
        setDepartments([]);
        setPolicies([]);
        return;
      }

      const userEndpoint = isManager ? '/api/auth/users' : '/api/auth/dev-users';
      const usersRes = await fetch(userEndpoint, { credentials: 'include' });
      const usersData = await usersRes.json();
      if (usersData.success) setUsers(usersData.users);

      if (isManager) {
        const [deptsRes, policiesRes] = await Promise.all([
          fetch('/api/auth/departments', { credentials: 'include' }),
          fetch('/api/settings/reminders', { credentials: 'include' })
        ]);
        const deptsData = await deptsRes.json();
        const policiesData = await policiesRes.json();
        if (deptsData.success) setDepartments(deptsData.departments);
        if (policiesData.success) {
          setPolicies(policiesData.policies);
          if (policiesData.config?.simulated_now_offset_hours) {
            setTimeOffsetHours(parseFloat(policiesData.config.simulated_now_offset_hours) || 0);
          }
        }
      }
    } catch (err) {
      console.error('Error fetching metadata:', err);
    }
  };

  const fetchDashboardAndTasks = async () => {
    try {
      if (!currentUser) return;
      setLoading(true);
      const isManager = ['founder', 'admin'].includes(currentUser.role);
      const taskQuery = new URLSearchParams({ page: String(taskPage), limit: String(taskPageSize) });
      const requests = [fetch(`/api/tasks?${taskQuery.toString()}`, { credentials: 'include' })];
      if (isManager) requests.unshift(fetch('/api/dashboard', { credentials: 'include' }));
      const responses = await Promise.all(requests);
      const dashData = isManager ? await responses[0].json() : null;
      const tasksRes = responses[isManager ? 1 : 0];
      const tasksData = await tasksRes.json();

      setDashboardData(dashData?.success ? dashData : null);
      if (tasksData.success) {
        setTasks(tasksData.tasks);
        setTaskPagination({
          page: tasksData.page || 1,
          totalPages: tasksData.totalPages || 1,
          total: tasksData.total || 0,
          limit: tasksData.limit || taskPageSize
        });
      }
    } catch (err) {
      console.error('Error loading tasks:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && currentUser) fetchMetadata();
  }, [authLoading, currentUser]);

  useEffect(() => {
    if (currentUser) {
      if (currentUser.role === 'employee') setActiveNav('employee');
      fetchDashboardAndTasks();
    }
  }, [currentUser, taskPage, taskPageSize]);

  // Check URL parameters for direct task deep links (?task=TASK-101) - AT-11
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const taskParam = params.get('task');
    if (taskParam) {
      setSelectedTaskId(taskParam);
    }
  }, []);

  // Switch Logged-in User
  const handleSwitchUser = async (userId) => {
    try {
      await switchDevUser(userId);
      const user = users.find((item) => item.id === userId);
      setActiveNav(user?.role === 'employee' ? 'employee' : 'dashboard');
    } catch (error) {
      addToast(error.message, 'error');
    }
  };

  // Task Creation Handler
  const handleCreateTask = async (taskPayload) => {
    const res = await fetch('/api/tasks', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(taskPayload)
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(apiErrorMessage(data, 'Failed to create task'));
    }
    addToast(`Task ${data.taskId} allocated successfully!`, 'success');
    await fetchDashboardAndTasks();
  };

  // Status & Progress Update Handler (resets inactivity timer - AT-05)
  const handleUpdateStatus = async (taskId, status, remark, progress_pct) => {
    const res = await fetch(`/api/tasks/${taskId}/status`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status, remark, progress_pct })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(apiErrorMessage(data, 'Failed to update status'));
    }
    addToast(`Status updated: ${status}. Inactivity timer reset!`, 'success');
    await fetchDashboardAndTasks();
  };

  // Add Comment Handler
  const handleAddComment = async (taskId, comment) => {
    const res = await fetch(`/api/tasks/${taskId}/comments`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ comment })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(apiErrorMessage(data, 'Failed to add comment'));
    }
    addToast('Comment added', 'info');
    await fetchDashboardAndTasks();
  };

  // Add Attachment Handler
  const handleAddAttachment = async (taskId, file) => {
    if (!file) throw new Error('No file selected');
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`/api/tasks/${taskId}/attachments`, {
      method: 'POST',
      credentials: 'include',
      body: formData
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(apiErrorMessage(data, 'Failed to upload attachment'));
    }
    addToast(`Attachment uploaded: ${data.file_name}`, 'success');
    await fetchDashboardAndTasks();
    return data;
  };

  const handleCreateTaskRequest = async (taskId, payload) => {
    const res = await fetch(`/api/tasks/${taskId}/requests`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(apiErrorMessage(data, 'Failed to submit request'));
    }
    addToast(`Request sent: ${payload.request_type.toLowerCase()}`, 'success');
    await fetchDashboardAndTasks();
    return data;
  };

  const handleReviewTaskRequest = async (taskId, requestId, status, decisionNote = '') => {
    const res = await fetch(`/api/tasks/${taskId}/requests/${requestId}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, decision_note: decisionNote })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(apiErrorMessage(data, 'Failed to review request'));
    }
    addToast(`Request ${status.toLowerCase()}`, 'info');
    await fetchDashboardAndTasks();
    return data;
  };

  // Manual Nudge / Reminder Handler
  const handleManualRemind = async (taskId) => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/remind`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ message: 'Management follow-up request' })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(apiErrorMessage(data, 'Failed to remind'));
      addToast(`Follow-up nudge dispatched to assignee for ${taskId}!`, 'success');
      await fetchDashboardAndTasks();
    } catch (err) {
      alert(err.message);
    }
  };

  // Reassign Task Handler
  const handleReassign = async (taskId, assigneeIds, primaryUserId) => {
    const res = await fetch(`/api/tasks/${taskId}/assign`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ assignee_ids: assigneeIds, primary_user_id: primaryUserId })
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(apiErrorMessage(data, 'Failed to reassign'));
    addToast(`Task ${taskId} reassigned`, 'success');
    await fetchDashboardAndTasks();
  };

  // Reminder Policy Update Handler (AT-12)
  const handleUpdatePolicy = async (payload) => {
    const res = await fetch('/api/settings/reminders', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(apiErrorMessage(data, 'Failed to update policy'));
    addToast('Reminder policy updated dynamically without code restart (AT-12)', 'success');
    await fetchMetadata();
    await fetchDashboardAndTasks();
  };

  // Time Advance Simulation Handler
  const handleAdvanceTime = async (hours) => {
    const res = await fetch('/api/settings/simulate-time', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ advance_hours: hours })
    });
    const data = await res.json();
    if (data.success) {
      setTimeOffsetHours(data.offset_hours);
      addToast(`Time fast-forwarded +${hours} hours`, 'info');
      await fetchDashboardAndTasks();
    }
    return data;
  };

  // Reset Time Simulation Handler
  const handleResetTime = async () => {
    const res = await fetch('/api/settings/simulate-time', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reset: true })
    });
    const data = await res.json();
    if (data.success) {
      setTimeOffsetHours(0);
      addToast('Simulation clock reset to Real-Time', 'info');
      await fetchDashboardAndTasks();
    }
    return data;
  };

  // On-Demand Background Scheduler Runner
  const handleRunScheduler = async () => {
    setSchedulerRunning(true);
    try {
      const res = await fetch('/api/settings/scheduler/run', { method: 'POST', credentials: 'include' });
      const data = await res.json();
      if (data.success) {
        addToast(
          `Scheduler pass: ${data.result.remindersSent} reminders, ${data.result.escalationsSent} escalations dispatched.`,
          'success'
        );
        await fetchDashboardAndTasks();
      }
      return data;
    } catch (err) {
      alert('Error triggering scheduler: ' + err.message);
    } finally {
      setSchedulerRunning(false);
    }
  };

  if (authLoading) {
    return <main className="auth-loading">Checking your session…</main>;
  }
  if (!currentUser) return <LoginView />;

  return (
    <div className="app-container">
      {/* Header with Brand & Role Switcher */}
      <Header
        activeNav={activeNav}
        setActiveNav={setActiveNav}
        users={users}
        currentUser={currentUser}
        onSwitchUser={handleSwitchUser}
        onLogout={logout}
        devToolsEnabled={devToolsEnabled}
        onOpenCreateModal={() => setIsCreateModalOpen(true)}
      />

      {/* Simulation Bar for Live Time Travel & Fast Verification */}
      {devToolsEnabled && ['founder', 'admin'].includes(currentUser.role) && <SimulationBar
        timeOffsetHours={timeOffsetHours}
        onAdvanceTime={handleAdvanceTime}
        onResetTime={handleResetTime}
        onRunScheduler={handleRunScheduler}
        schedulerRunning={schedulerRunning}
      />}

      {/* Main View Router */}
      <main className="main-wrapper">
        {activeNav === 'dashboard' && (
          <DashboardView
            dashboardData={dashboardData}
            tasks={tasks}
            loading={loading}
            users={users}
            departments={departments}
            currentUser={currentUser}
            onRefresh={fetchDashboardAndTasks}
            onOpenCreateModal={() => setIsCreateModalOpen(true)}
            onSelectTask={(id) => setSelectedTaskId(id)}
            onManualRemind={handleManualRemind}
            activeFilterCard={activeFilterCard}
            setActiveFilterCard={setActiveFilterCard}
          />
        )}

        {activeNav === 'employee' && (
          <EmployeeView
            currentUser={currentUser}
            tasks={tasks}
            loading={loading}
            onSelectTask={(id) => setSelectedTaskId(id)}
            onQuickUpdateStatus={handleUpdateStatus}
          />
        )}

        {taskPagination.totalPages > 1 && (
          <div className="toolbar-card" style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Showing {taskPagination.total ? (taskPagination.page - 1) * taskPagination.limit + 1 : 0}–{Math.min(taskPagination.page * taskPagination.limit, taskPagination.total)} of {taskPagination.total} tasks
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <button
                className="btn-secondary"
                id="task-page-prev"
                disabled={taskPage <= 1}
                onClick={() => setTaskPage((page) => Math.max(1, page - 1))}
              >
                Previous
              </button>
              <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                Page {taskPagination.page} / {taskPagination.totalPages}
              </span>
              <button
                className="btn-secondary"
                id="task-page-next"
                disabled={taskPage >= taskPagination.totalPages}
                onClick={() => setTaskPage((page) => Math.min(taskPagination.totalPages, page + 1))}
              >
                Next
              </button>
            </div>
          </div>
        )}

        {activeNav === 'reports' && (
          <ReportsView departments={departments} />
        )}

        {activeNav === 'mailbox' && (
          <MailboxView
            isManager={['founder', 'admin'].includes(currentUser.role)}
            onOpenTaskFromEmail={(id) => {
              setSelectedTaskId(id);
              setActiveNav('dashboard');
            }}
          />
        )}

        {activeNav === 'tests' && (
          <AcceptanceTestsView />
        )}

        {activeNav === 'settings' && (
          <SettingsView
            policies={policies}
            onUpdatePolicy={handleUpdatePolicy}
          />
        )}
      </main>

      {/* Task Detail Modal */}
      {selectedTaskId && (
        <TaskDetailModal
          taskId={selectedTaskId}
          currentUser={currentUser}
          users={users}
          onClose={() => setSelectedTaskId(null)}
          onUpdateStatus={handleUpdateStatus}
          onAddComment={handleAddComment}
          onAddAttachment={handleAddAttachment}
          onCreateTaskRequest={handleCreateTaskRequest}
          onReviewTaskRequest={handleReviewTaskRequest}
          onManualRemind={handleManualRemind}
          onReassign={handleReassign}
        />
      )}

      {/* Create Task Modal */}
      {isCreateModalOpen && (
        <CreateTaskModal
          users={users}
          policies={policies}
          onClose={() => setIsCreateModalOpen(false)}
          onCreateTask={handleCreateTask}
        />
      )}

      {/* Floating Toast Alerts */}
      <div className="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
