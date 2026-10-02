import React, { useState, useEffect } from 'react';
import Header from './components/Header';
import SimulationBar from './components/SimulationBar';
import DashboardView from './components/DashboardView';
import EmployeeView from './components/EmployeeView';
import ReportsView from './components/ReportsView';
import MailboxView from './components/MailboxView';
import SettingsView from './components/SettingsView';
import AcceptanceTestsView from './components/AcceptanceTestsView';
import TaskDetailModal from './components/TaskDetailModal';
import CreateTaskModal from './components/CreateTaskModal';

export default function App() {
  const [activeNav, setActiveNav] = useState('dashboard');
  const [users, setUsers] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [policies, setPolicies] = useState([]);
  const [dashboardData, setDashboardData] = useState(null);
  const [tasks, setTasks] = useState([]);
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
      const [usersRes, deptsRes, policiesRes] = await Promise.all([
        fetch('/api/auth/users'),
        fetch('/api/auth/departments'),
        fetch('/api/settings/reminders')
      ]);

      const usersData = await usersRes.json();
      const deptsData = await deptsRes.json();
      const policiesData = await policiesRes.json();

      if (usersData.success) {
        setUsers(usersData.users);
        if (!currentUser && usersData.users.length > 0) {
          // Default to Founder Vikram
          setCurrentUser(usersData.users[0]);
        }
      }
      if (deptsData.success) setDepartments(deptsData.departments);
      if (policiesData.success) {
        setPolicies(policiesData.policies);
        if (policiesData.config?.simulated_now_offset_hours) {
          setTimeOffsetHours(parseFloat(policiesData.config.simulated_now_offset_hours) || 0);
        }
      }
    } catch (err) {
      console.error('Error fetching metadata:', err);
    }
  };

  const fetchDashboardAndTasks = async () => {
    try {
      setLoading(true);
      const userId = currentUser?.id || 1;
      const [dashRes, tasksRes] = await Promise.all([
        fetch('/api/dashboard', { headers: { 'x-user-id': userId } }),
        fetch('/api/tasks', { headers: { 'x-user-id': userId } })
      ]);

      const dashData = await dashRes.json();
      const tasksData = await tasksRes.json();

      if (dashData.success) setDashboardData(dashData);
      if (tasksData.success) setTasks(tasksData.tasks);
    } catch (err) {
      console.error('Error loading tasks:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetadata();
  }, []);

  useEffect(() => {
    if (currentUser) {
      fetchDashboardAndTasks();
    }
  }, [currentUser]);

  // Check URL parameters for direct task deep links (?task=TASK-101) - AT-11
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const taskParam = params.get('task');
    if (taskParam) {
      setSelectedTaskId(taskParam);
    }
  }, []);

  // Switch Logged-in User
  const handleSwitchUser = (userId) => {
    const user = users.find((u) => u.id === userId);
    if (user) {
      setCurrentUser(user);
      if (user.role === 'employee') {
        setActiveNav('employee');
        addToast(`Switched to employee view: ${user.name}`, 'info');
      } else {
        addToast(`Switched to management view: ${user.name}`, 'info');
      }
    }
  };

  // Task Creation Handler
  const handleCreateTask = async (taskPayload) => {
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': currentUser?.id || 1
      },
      body: JSON.stringify(taskPayload)
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to create task');
    }
    addToast(`Task ${data.taskId} allocated successfully!`, 'success');
    await fetchDashboardAndTasks();
  };

  // Status & Progress Update Handler (resets inactivity timer - AT-05)
  const handleUpdateStatus = async (taskId, status, remark, progress_pct) => {
    const res = await fetch(`/api/tasks/${taskId}/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': currentUser?.id || 1
      },
      body: JSON.stringify({ status, remark, progress_pct })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to update status');
    }
    addToast(`Status updated: ${status}. Inactivity timer reset!`, 'success');
    await fetchDashboardAndTasks();
  };

  // Add Comment Handler
  const handleAddComment = async (taskId, comment) => {
    const res = await fetch(`/api/tasks/${taskId}/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': currentUser?.id || 1
      },
      body: JSON.stringify({ comment })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to add comment');
    }
    addToast('Comment added', 'info');
    await fetchDashboardAndTasks();
  };

  // Manual Nudge / Reminder Handler
  const handleManualRemind = async (taskId) => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/remind`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUser?.id || 1
        },
        body: JSON.stringify({ message: 'Management follow-up request' })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to remind');
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
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': currentUser?.id || 1
      },
      body: JSON.stringify({ assignee_ids: assigneeIds, primary_user_id: primaryUserId })
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to reassign');
    addToast(`Task ${taskId} reassigned`, 'success');
    await fetchDashboardAndTasks();
  };

  // Reminder Policy Update Handler (AT-12)
  const handleUpdatePolicy = async (payload) => {
    const res = await fetch('/api/settings/reminders', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to update policy');
    addToast('Reminder policy updated dynamically without code restart (AT-12)', 'success');
    await fetchMetadata();
    await fetchDashboardAndTasks();
  };

  // Time Advance Simulation Handler
  const handleAdvanceTime = async (hours) => {
    const res = await fetch('/api/settings/simulate-time', {
      method: 'POST',
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
      const res = await fetch('/api/settings/scheduler/run', { method: 'POST' });
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

  return (
    <div className="app-container">
      {/* Header with Brand & Role Switcher */}
      <Header
        activeNav={activeNav}
        setActiveNav={setActiveNav}
        users={users}
        currentUser={currentUser}
        onSwitchUser={handleSwitchUser}
        onOpenCreateModal={() => setIsCreateModalOpen(true)}
      />

      {/* Simulation Bar for Live Time Travel & Fast Verification */}
      <SimulationBar
        timeOffsetHours={timeOffsetHours}
        onAdvanceTime={handleAdvanceTime}
        onResetTime={handleResetTime}
        onRunScheduler={handleRunScheduler}
        schedulerRunning={schedulerRunning}
      />

      {/* Main View Router */}
      <main className="main-wrapper">
        {activeNav === 'dashboard' && (
          <DashboardView
            dashboardData={dashboardData}
            tasks={tasks}
            loading={loading}
            users={users}
            departments={departments}
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

        {activeNav === 'reports' && (
          <ReportsView departments={departments} />
        )}

        {activeNav === 'mailbox' && (
          <MailboxView
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
